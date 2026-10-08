use super::*;
use crate::storage::recording::{finalize, tests::{manifest, TestRoot}, ChunkWriter};

fn take(root: &Path, id: &str) -> SavedRecording {
    let mut writer = ChunkWriter::create(root, &manifest(id)).unwrap();
    for n in 0..96_000 {
        writer.push(((n % 400) as i16 - 200) * 40).unwrap();
    }
    writer.flush().unwrap();
    drop(writer);
    finalize(root, id, false).unwrap()
}

#[test]
fn deepgram_and_assemblyai_responses_normalise_to_milliseconds() {
    let deepgram = json!({
        "metadata": {"request_id": "dg-1", "duration": 2.5},
        "results": {"channels": [{"alternatives": [{
            "transcript": "well uh indexes help",
            "words": [
                {"word": "well", "punctuated_word": "Well,", "start": 0.08, "end": 0.4, "confidence": 0.9},
                {"word": "uh", "start": 0.5, "end": 0.71, "confidence": 0.8}
            ]
        }]}]}
    });
    let parsed = parse_deepgram(&deepgram).unwrap();
    assert_eq!(parsed.text, "well uh indexes help");
    assert_eq!(parsed.words, vec![("Well,".into(), 80, 400), ("uh".into(), 500, 710)]);
    assert_eq!(parsed.duration_ms, Some(2_500));
    assert!(parse_deepgram(&json!({"results": {}})).is_err());

    let assembly = json!({"status": "completed", "text": " Um, so indexes. ", "audio_duration": 3.2,
        "words": [{"text": "Um,", "start": 120, "end": 380, "confidence": 0.7}, {"text": "so", "start": 400, "end": 520}]});
    let parsed = parse_assemblyai(&assembly).unwrap();
    assert_eq!(parsed.text, "Um, so indexes.");
    assert_eq!(parsed.words[0], ("Um,".into(), 120, 380));
    assert_eq!(parsed.duration_ms, Some(3_200));
}

#[test]
fn approvals_are_single_use_bound_to_the_payload_and_never_reserve_by_themselves() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let owner = AudioPreviewOwner::default();
    let preview = owner.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    assert_eq!(preview.duration_ms, 2_000);
    assert_eq!(preview.recipient, "api.deepgram.com");
    assert_eq!(preview.settings["filler_words"], true);
    assert_eq!(preview.settings["mip_opt_out"], true);
    assert_eq!(preview.estimated_cost_micro_usd, 4_300, "one started minute");
    assert_eq!(preview.payload_sha256.len(), 64);

    let audio = owner.preview_audio(&preview.request_id).unwrap();
    let shown = audio.to_string_lossy();
    assert!(shown.ends_with("audio.wav") && shown.contains(r"\cache\inference\take\") && !shown.starts_with(r"\\?\"), "{shown}");
    assert!(owner.consume(&preview.request_id, &"0".repeat(64)).is_err(), "wrong fingerprint");
    assert!(owner.preview_audio(&preview.request_id).is_err(), "gone with the preview");
    assert!(owner.consume(&preview.request_id, &preview.payload_sha256).is_err(), "consumed by the failed attempt");

    let again = owner.preview(&root.0, &saved, AudioProvider::Assemblyai).unwrap();
    assert_eq!(again.model, "universal-3-5-pro");
    assert_eq!(again.settings["disfluencies"], true);
    assert_eq!(again.estimated_cost_micro_usd, 3_500);
    owner.cancel(&again.request_id);
    assert!(owner.consume(&again.request_id, &again.payload_sha256).is_err(), "cancelled");

    // A preview reserves nothing: the shared budget is untouched.
    let budget = BudgetOwner::open(&root.0).unwrap();
    assert_eq!(budget.summary().unwrap().transcription_micro_usd, 0);
}

#[test]
fn results_validate_and_bad_word_timings_are_withheld_with_a_reason() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let preview = AudioPreviewOwner::default().preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    let good = Parsed { text: "Well, uh, yes.".into(), words: vec![("Well,".into(), 0, 300), ("uh,".into(), 350, 500), ("yes.".into(), 600, 900)], duration_ms: Some(2_000) };
    let result = to_result(&preview, &saved.sha256, good, Some("dg-1".into()), 4_300).unwrap();
    assert_eq!(result.words.value.as_ref().unwrap().len(), 3);
    assert!(result.capabilities.word_timings);
    assert_eq!(result.request_id.value.as_deref(), Some("dg-1"));
    assert_eq!(result.usage.estimated_cost_micro_usd.value, Some(4_300));

    let outside = Parsed { text: "Well.".into(), words: vec![("Well.".into(), 0, 9_999)], duration_ms: None };
    let result = to_result(&preview, &saved.sha256, outside, None, 4_300).unwrap();
    assert!(result.words.value.is_none() && result.words.unavailable_reason.is_some());
    assert!(!result.capabilities.word_timings);
    assert!(result.request_id.unavailable_reason.is_some());
    assert!(result.usage.audio_duration_ms.unavailable_reason.is_some());

    let empty = Parsed { text: String::new(), words: vec![], duration_ms: None };
    assert!(to_result(&preview, &saved.sha256, empty, None, 4_300).is_err());
}

#[test]
fn transport_only_builds_requests_for_the_two_fixed_hosts_with_hidden_keys() {
    let transport = ApiTransport::new().unwrap();
    let key = crate::credentials::Secret::new("fake-audio-key".into()).unwrap();
    let request = transport
        .audio_request(reqwest::Method::POST, "https://api.deepgram.com/v1/listen?model=nova-3", "Token ", &key, "audio/wav", Some(vec![1, 2, 3]))
        .unwrap();
    let auth = &request.headers()[reqwest::header::AUTHORIZATION];
    assert!(auth.is_sensitive());
    assert!(!format!("{:?}", request.headers()).contains("fake-audio-key"));
    assert!(transport.audio_request(reqwest::Method::POST, "https://example.com/steal", "", &key, "audio/wav", None).is_err());
    assert!(transport.audio_request(reqwest::Method::POST, "http://api.deepgram.com/v1/listen", "", &key, "audio/wav", None).is_err());
    assert!(transport
        .audio_request(reqwest::Method::POST, "https://api.assemblyai.com/v2/upload", "", &key, "application/octet-stream", Some(vec![0; MAX_AUDIO_UPLOAD + 1]))
        .is_err());
    assert_eq!(cost_for(AudioProvider::Deepgram, 61_000), 8_600, "billed per started minute");
}

#[test]
fn stopping_releases_unsent_requests_and_keeps_dispatched_ones_uncertain() {
    use super::super::budget::Purpose;
    let root = TestRoot::new();
    let budget = BudgetOwner::open(&root.0).unwrap();
    let quote = || PriceQuote { currency: "USD".into(), source: "https://deepgram.com/pricing".into(), effective_date: PRICE_DATE.into(),
        model: "nova-3".into(), billing_unit: "started audio minute".into(), rate_micro_usd: 4_300, maximum_cost_micro_usd: 4_300 };
    let hash = "a".repeat(64);
    budget.reserve("waiting", Purpose::Transcription, &hash, Some(quote())).unwrap();
    assert!(stopped(&budget, "waiting").contains("Nothing was billed"));
    assert_eq!(budget.summary().unwrap().counted_micro_usd, 0);

    budget.reserve("sent", Purpose::Transcription, &hash, Some(quote())).unwrap();
    budget.mark_dispatched("sent", &hash).unwrap();
    assert!(stopped(&budget, "sent").contains("charge is uncertain"));
    let summary = budget.summary().unwrap();
    assert_eq!((summary.uncertain_micro_usd, summary.counted_micro_usd), (4_300, 4_300));
}
