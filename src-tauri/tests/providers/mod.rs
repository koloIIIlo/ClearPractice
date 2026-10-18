//! Offline contracts built from documented, scrubbed provider response shapes.
use super::*;
use crate::api::{audio, transport};
use crate::storage::recording::tests::TestRoot;

const TAKE: &str = include_str!("../fixtures/providers/openai-take.json");
const FOLLOW: &str = include_str!("../fixtures/providers/openai-follow-up.json");
const PHRASES: &str = include_str!("../fixtures/providers/openai-phrases.json");
const PARTNER: &str = include_str!("../fixtures/providers/openai-partner.json");
const DEEPGRAM: &str = include_str!("../fixtures/providers/deepgram.json");
const ASSEMBLY: &str = include_str!("../fixtures/providers/assemblyai.json");
const UNAUTHORIZED: &str = include_str!("../fixtures/providers/401.json");
const RATE_LIMIT: &str = include_str!("../fixtures/providers/429.json");
const MALFORMED: &str = include_str!("../fixtures/providers/malformed.txt");

fn json(text: &str) -> Value { transport::response_json(text.as_bytes(), "Provider").unwrap() }

#[test]
fn fixtures_parse_openai() {
    let model = CoachingModel::Luna;
    let take = parse_take(&json(TAKE), model, "I want to be more clear.", 0, false).unwrap();
    assert_eq!(take["corrections"][0]["quote"], "more clear");
    assert_eq!(parse_follow_up(&json(FOLLOW), model).unwrap().question, "Can you give an example?");
    let phrases = parse_phrase_suggestions(&json(PHRASES), model, "Session 1: Example\nI want to be more clear.").unwrap();
    assert_eq!(phrases[0].expression, "clearer");
    let raw = json(PARTNER);
    let turn = crate::conversation::parse_partner_turn(answer_text(&raw, model).unwrap(), 0, false).unwrap();
    assert_eq!(turn.reply, "What happened next?");
}

#[test]
fn fixtures_parse_transcription() {
    let root = TestRoot::new();
    for (provider, fixture) in [(audio::AudioProvider::Deepgram, DEEPGRAM), (audio::AudioProvider::Assemblyai, ASSEMBLY)] {
        let preview = audio::AudioPreviewOwner::default().preview_prepared(root.0.join("unused.wav"), "contract", 1000, 32044, "a".repeat(64), "b".repeat(64), provider).unwrap();
        let raw = json(fixture);
        let parsed = match provider { audio::AudioProvider::Deepgram => audio::parse_deepgram(&raw), audio::AudioProvider::Assemblyai => audio::parse_assemblyai(&raw) }.unwrap();
        assert_eq!(parsed.words[0], ("Hello".into(), 100, 400));
        let result = audio::to_result(&preview, &"b".repeat(64), parsed, Some("scrubbed".into()), preview.estimated_cost_micro_usd).unwrap();
        assert_eq!(result.raw_text, "Hello there.");
        assert_eq!(result.words.value.unwrap().len(), 2);
    }
}

#[test]
fn fixtures_parse_errors_without_panicking() {
    // HTTP errors are handled before decoding, identically for every task adapter.
    for adapter in ["take", "follow-up", "phrases", "partner", "Deepgram", "AssemblyAI"] {
        for (status, body, expected) in [(401, UNAUTHORIZED, "rejected the credentials"), (429, RATE_LIMIT, "rate or account limit")] {
            assert!(json(body).is_object());
            assert!(transport::status_error(status, matches!(adapter, "Deepgram" | "AssemblyAI")).contains(expected), "{adapter}");
        }
        let error = transport::response_json(MALFORMED.as_bytes(), adapter).unwrap_err();
        assert!(error.contains("invalid JSON"), "{adapter}: {error}");
    }
    // Valid JSON with a malformed task body also fails each real parser safely.
    let raw = json!({"status":"completed","model":"gpt-6-luna","output":[{"type":"message","content":[{"type":"output_text","text":"{}"}]}]});
    assert!(parse_take(&raw, CoachingModel::Luna, "Hello", 0, false).unwrap_err().contains("expected format"));
    assert!(parse_follow_up(&raw, CoachingModel::Luna).unwrap_err().contains("expected format"));
    assert!(parse_phrase_suggestions(&raw, CoachingModel::Luna, "Session 1:\nHello").unwrap_err().contains("expected format"));
    assert!(crate::conversation::parse_partner_turn(answer_text(&raw, CoachingModel::Luna).unwrap(), 0, false).is_err());
    assert!(audio::parse_deepgram(&json!({})).unwrap_err().contains("no transcript"));
    assert!(audio::parse_assemblyai(&json!({})).unwrap_err().contains("no transcript"));
}

/// Manual opt-in only: run ONLY with the user's OK. Costs under USD 0.01 total
/// at the app's documented list prices: one tiny Luna response (256 output
/// tokens maximum), one second of synthetic silence per transcription provider
/// (one started minute each: $0.0043 + $0.0035). Reads the app's endpoint-bound
/// Windows Credential Manager slots, never environment keys. No personal audio.
/// Close the desktop app first: this uses its locked, shared spending ledger.
/// Synthetic responses are kept under cache/provider-contracts in the profile.
/// `cargo test --lib -- --ignored live_contract`
#[test]
#[ignore = "Requires the user's OK, stored keys, network access and a small charge"]
fn live_contract() {
    let root = TestRoot::new(); // synthetic WAV only; never reads a practice recording
    let default = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("Windows local app data is unavailable")).join("com.clearpractice.app");
    let location = crate::data_location::resolve(&default);
    assert!(location.problem.is_none(), "Resolve the app's data-folder problem before running this check");
    let budget = BudgetOwner::open(&location.root).expect("Close ClearPractice first so the shared ledger can be locked");
    let run_id = new_request_id("live-contract");
    let artifacts = location.root.join("cache/provider-contracts").join(&run_id);
    fs::create_dir_all(&artifacts).unwrap();
    let key = credentials::read().unwrap().expect("Store an OpenAI key in Settings first");
    // Check all keys before any billed call.
    let dg = credentials::read_provider("deepgram").unwrap().expect("Store a Deepgram key first");
    let aa = credentials::read_provider("assemblyai").unwrap().expect("Store an AssemblyAI key first");
    tauri::async_runtime::block_on(async {
        let transport = ApiTransport::new().unwrap();
        let body = json!({"model":"gpt-6-luna","store":false,"max_output_tokens":256,"instructions":"Ask one short follow-up. Keep why empty.","input":"Hello.",
            "text":{"format":{"type":"json_schema","name":"contract","strict":true,"schema":follow_up_schema()}}});
        let hash = fingerprint(&body).unwrap();
        budget.reserve(&run_id, Purpose::Coaching, &hash, Some(PriceQuote { currency:"USD".into(), source:"https://developers.openai.com/api/docs/models/gpt-6-luna".into(), effective_date:PRICE_DATE.into(), model:"gpt-6-luna".into(), billing_unit:"text tokens".into(), rate_micro_usd:1, maximum_cost_micro_usd:500 })).unwrap();
        let response = transport.send_reserved_coaching(&budget, &run_id, &hash, &key, &body).await.unwrap();
        fs::write(artifacts.join("openai.json"), &response.bytes).unwrap();
        let raw = transport::response_json(&response.bytes, "OpenAI").unwrap();
        let usage = raw["usage"]["input_tokens"].as_u64().zip(raw["usage"]["output_tokens"].as_u64());
        let cost = usage.and_then(|(i, o)| i.checked_add(o)).and_then(|n| CoachingModel::Luna.settle(n));
        budget.settle(&run_id, cost, None, response.request_id).unwrap();
        parse_follow_up(&raw, CoachingModel::Luna).unwrap();
        let path = root.0.join("silence.wav");
        // PCM16 mono, 16 kHz, one second; no extra audio dependency.
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF"); wav.extend_from_slice(&32036u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt "); wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes()); wav.extend_from_slice(&32000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes()); wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data"); wav.extend_from_slice(&32000u32.to_le_bytes());
        wav.resize(32044, 0);
        fs::write(&path, wav).unwrap();
        let bytes = fs::read(&path).unwrap();
        let sha = format!("{:x}", Sha256::digest(&bytes));
        for (provider, key) in [(audio::AudioProvider::Deepgram, dg), (audio::AudioProvider::Assemblyai, aa)] {
            let preview = audio::AudioPreviewOwner::default().preview_prepared(path.clone(), "live-audio", 1000, bytes.len() as u64, sha.clone(), sha.clone(), provider).unwrap();
            let id = &preview.request_id;
            budget.reserve(id, Purpose::Transcription, &preview.payload_sha256, Some(PriceQuote { currency:"USD".into(), source:preview.price_source.clone(), effective_date:preview.price_date.clone(), model:preview.model.clone(), billing_unit:"started minute".into(), rate_micro_usd:preview.estimated_cost_micro_usd, maximum_cost_micro_usd:preview.estimated_cost_micro_usd })).unwrap();
            match provider {
                audio::AudioProvider::Deepgram => {
                    let request = transport.audio_request(reqwest::Method::POST, "https://api.deepgram.com/v1/listen?model=nova-3&language=en&filler_words=true&mip_opt_out=true", "Token ", &key, "audio/wav", Some(bytes.clone())).unwrap();
                    let response = transport.send_reserved_audio(&budget, id, &preview.payload_sha256, request).await.unwrap();
                    fs::write(artifacts.join("deepgram.json"), &response.bytes).unwrap();
                    budget.settle(id, Some(preview.estimated_cost_micro_usd), None, response.request_id).unwrap();
                    audio::parse_deepgram(&transport::response_json(&response.bytes, "Deepgram").unwrap()).unwrap();
                }
                audio::AudioProvider::Assemblyai => {
                    let (raw, provider_id) = audio::assemblyai(&transport, &budget, id, &preview.payload_sha256, &key, bytes.clone(), &preview).await.unwrap();
                    fs::write(artifacts.join("assemblyai.json"), serde_json::to_vec_pretty(&raw).unwrap()).unwrap();
                    budget.settle(id, Some(preview.estimated_cost_micro_usd), None, provider_id).unwrap();
                    audio::parse_assemblyai(&raw).unwrap();
                }
            }
        }
    });
}
