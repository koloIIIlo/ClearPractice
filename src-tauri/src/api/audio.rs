//! Optional API transcription spike (M0 0.22, D-20–D-23, D-21 revised): one
//! complete saved take, prepared as 16 kHz mono WAV, sent only after a
//! single-use preview approval. Adapters: Deepgram Nova-3 and AssemblyAI
//! Universal-3.5 Pro, both asked to keep fillers. Results are validated into the
//! provider-neutral `TranscriptionResult` and stored with the take as their own
//! transcript revision (3.16); they never replace local or corrected text.
use super::budget::{BudgetOwner, PriceQuote, Purpose, Usage};
use super::transport::{ApiTransport, MAX_AUDIO_UPLOAD};
use crate::audio::prepare;
use crate::audio::transcription::{
    Available, Capabilities, TimedText, TranscriptionProvider, TranscriptionResult, TranscriptionUsage,
};
use crate::storage::recording::{self, SavedRecording};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Mutex},
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;

/// Prices checked on the providers' own pages (D-21). Recorded usage always
/// uses the list price, even while sign-up credit covers it.
const PRICE_DATE: &str = "2026-10-08";
const MAX_AUDIO_MS: u64 = 15 * 60 * 1000;
const PREVIEW_TTL: Duration = Duration::from_secs(15 * 60);
pub const ADAPTER_VERSION: &str = "audio-api-v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AudioProvider {
    Deepgram,
    Assemblyai,
}

impl AudioProvider {
    pub fn key(self) -> &'static str {
        match self {
            Self::Deepgram => "deepgram",
            Self::Assemblyai => "assemblyai",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Deepgram => "Deepgram",
            Self::Assemblyai => "AssemblyAI",
        }
    }
    fn model(self) -> &'static str {
        match self {
            Self::Deepgram => "nova-3",
            Self::Assemblyai => "universal-3-5-pro",
        }
    }
    fn recipient(self) -> &'static str {
        match self {
            Self::Deepgram => "api.deepgram.com",
            Self::Assemblyai => "api.assemblyai.com",
        }
    }
    /// List price per started audio minute, in micro-USD.
    fn rate_per_minute(self) -> u64 {
        match self {
            Self::Deepgram => 4_300,  // USD 0.0043/min
            Self::Assemblyai => 3_500, // USD 0.21/h
        }
    }
    fn price_source(self) -> &'static str {
        match self {
            Self::Deepgram => "https://deepgram.com/pricing",
            Self::Assemblyai => "https://www.assemblyai.com/pricing",
        }
    }
    /// Exactly what is sent besides the audio; part of the approved fingerprint.
    fn settings(self) -> Value {
        match self {
            Self::Deepgram => json!({"model":"nova-3","language":"en","filler_words":true,"punctuate":true,"mip_opt_out":true}),
            Self::Assemblyai => json!({"speech_models":["universal-3-5-pro"],"language_code":"en","disfluencies":true,"punctuate":true,"format_text":true}),
        }
    }
    fn data_handling(self) -> &'static str {
        match self {
            Self::Deepgram => "Sent with mip_opt_out=true: Deepgram says opted-out audio is kept only as long as needed to process the request. Opting out may change Deepgram's price; check your account.",
            Self::Assemblyai => "Uploaded to AssemblyAI, then transcribed. Transcripts are kept 30 days by default and uploads are removed with them. Model-training use is controlled in your AssemblyAI dashboard (Data Controls).",
        }
    }
}

fn cost_for(provider: AudioProvider, duration_ms: u64) -> u64 {
    duration_ms.div_ceil(60_000).max(1) * provider.rate_per_minute()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPreview {
    pub request_id: String,
    pub provider: AudioProvider,
    pub provider_label: String,
    pub model: String,
    pub recipient: String,
    pub attempt_id: String,
    pub duration_ms: u64,
    pub bytes: u64,
    pub audio_sha256: String,
    pub settings: Value,
    pub estimated_cost_micro_usd: u64,
    pub price_source: String,
    pub price_date: String,
    pub data_handling: String,
    pub payload_sha256: String,
    /// When this exact audio was already transcribed with the same provider,
    /// model, settings and adapter (3.16). Sending again is a new paid run.
    pub previous_run_at: Option<String>,
}

struct Pending {
    preview: AudioPreview,
    audio_path: PathBuf,
    source_sha256: String,
    created: Instant,
}

#[derive(Default)]
pub struct AudioPreviewOwner(Mutex<HashMap<String, Pending>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioResult {
    pub request_id: String,
    pub provider: AudioProvider,
    pub model: String,
    pub text: String,
    pub word_count: usize,
    pub filler_count: usize,
    pub word_timings: bool,
    pub word_timings_unavailable_reason: Option<String>,
    pub provider_request_id: Option<String>,
    pub audio_duration_ms: Option<u64>,
    pub estimated_cost_micro_usd: u64,
}

fn fingerprint(preview: &AudioPreview) -> Result<String> {
    let bound = json!({
        "provider": preview.provider, "model": preview.model, "recipient": preview.recipient,
        "attemptId": preview.attempt_id, "audioSha256": preview.audio_sha256, "bytes": preview.bytes,
        "settings": preview.settings, "priceSource": preview.price_source, "priceDate": preview.price_date,
        "estimatedCostMicroUsd": preview.estimated_cost_micro_usd, "requestId": preview.request_id,
    });
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(&bound).map_err(|e| e.to_string())?)))
}

impl AudioPreviewOwner {
    /// Prepares the take and describes exactly what would be sent. Nothing is
    /// sent and no budget is reserved here.
    pub fn preview(&self, root: &Path, saved: &SavedRecording, provider: AudioProvider) -> Result<AudioPreview> {
        let audio = prepare::prepare(root, &saved.asset_id, &AtomicBool::new(false))?;
        let path = prepare::prepared_path(root, &audio)?;
        self.preview_prepared(path, &saved.asset_id, audio.duration_ms, audio.bytes, audio.sha256.clone(), saved.sha256.clone(), provider)
    }

    /// Previews any prepared 16 kHz mono WAV, e.g. a long recording being split
    /// into clips (4.4c). `owner_id` names what the audio belongs to.
    #[allow(clippy::too_many_arguments)]
    pub fn preview_prepared(
        &self,
        path: PathBuf,
        owner_id: &str,
        duration_ms: u64,
        bytes: u64,
        audio_sha256: String,
        source_sha256: String,
        provider: AudioProvider,
    ) -> Result<AudioPreview> {
        recording::validate_id(owner_id)?;
        if duration_ms > MAX_AUDIO_MS || bytes as usize > MAX_AUDIO_UPLOAD {
            return Err("This recording is longer than 15 minutes; API transcription is limited to shorter audio.".into());
        }
        let request_id = format!("api-{}-{}", provider.key(), recording::now_ms());
        recording::validate_id(&request_id)?;
        let mut preview = AudioPreview {
            request_id: request_id.clone(),
            provider,
            provider_label: provider.label().into(),
            model: provider.model().into(),
            recipient: provider.recipient().into(),
            attempt_id: owner_id.into(),
            duration_ms,
            bytes,
            audio_sha256,
            settings: provider.settings(),
            estimated_cost_micro_usd: cost_for(provider, duration_ms),
            price_source: provider.price_source().into(),
            price_date: PRICE_DATE.into(),
            data_handling: provider.data_handling().into(),
            payload_sha256: String::new(),
            previous_run_at: None,
        };
        preview.payload_sha256 = fingerprint(&preview)?;
        let mut pending = self.0.lock().map_err(|_| "Preview state is unavailable.")?;
        pending.retain(|_, p| p.created.elapsed() < PREVIEW_TTL);
        if pending.len() >= 8 {
            return Err("Too many open previews. Cancel one first.".into());
        }
        pending.insert(request_id, Pending { preview: preview.clone(), audio_path: path, source_sha256, created: Instant::now() });
        Ok(preview)
    }

    /// The prepared WAV of an open preview, so the user can hear exactly what
    /// would be sent (3.15). Gone once the preview is used, cancelled or expired.
    pub fn preview_audio(&self, request_id: &str) -> Result<PathBuf> {
        let pending = self.0.lock().map_err(|_| "Preview state is unavailable.")?;
        let item = pending.get(request_id).filter(|i| i.created.elapsed() < PREVIEW_TTL).ok_or("This preview expired or was already used. Preview again.")?;
        // Plain drive path for the asset protocol scope, not the `\\?\` form.
        let text = item.audio_path.to_string_lossy();
        Ok(PathBuf::from(text.strip_prefix(r"\\?\").filter(|rest| !rest.starts_with("UNC")).unwrap_or(&text)))
    }

    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut pending) = self.0.lock() {
            pending.remove(request_id);
        }
    }

    /// Single use: an approval is consumed whether or not the send succeeds.
    fn consume(&self, request_id: &str, payload_sha256: &str) -> Result<Pending> {
        let mut pending = self.0.lock().map_err(|_| "Preview state is unavailable.")?;
        let item = pending.remove(request_id).ok_or("This preview expired or was already used. Preview again.")?;
        if item.created.elapsed() >= PREVIEW_TTL || item.preview.payload_sha256 != payload_sha256 {
            return Err("The approval no longer matches this preview. Preview again.".into());
        }
        Ok(item)
    }

    /// Sends one approved take. Budget is reserved first; dispatch is recorded
    /// before any network I/O; the result is validated and returned for the
    /// caller to store with the take.
    pub async fn send(
        &self,
        budget: &BudgetOwner,
        request_id: &str,
        payload_sha256: &str,
    ) -> Result<ApiRun> {
        let item = self.consume(request_id, payload_sha256)?;
        let preview = item.preview;
        let audio = fs::read(&item.audio_path).map_err(|_| "The prepared audio is unavailable. Preview again.")?;
        if format!("{:x}", Sha256::digest(&audio)) != preview.audio_sha256 {
            return Err("The prepared audio changed after approval. Preview again.".into());
        }
        let quote = PriceQuote {
            currency: "USD".into(),
            source: preview.price_source.clone(),
            effective_date: PRICE_DATE.into(),
            model: preview.model.clone(),
            billing_unit: "started audio minute".into(),
            rate_micro_usd: preview.provider.rate_per_minute(),
            maximum_cost_micro_usd: preview.estimated_cost_micro_usd,
        };
        budget.reserve(request_id, Purpose::Transcription, payload_sha256, Some(quote))?;
        let key = match crate::credentials::read_provider(preview.provider.key()) {
            Ok(Some(key)) => key,
            Ok(None) => {
                budget.release_unsent(request_id)?;
                return Err(format!("Store your {} API key in Settings first. Nothing was sent.", preview.provider.label()));
            }
            Err(error) => {
                budget.release_unsent(request_id)?;
                return Err(error);
            }
        };
        let transport = ApiTransport::new()?;
        let (raw, provider_request_id) = match preview.provider {
            AudioProvider::Deepgram => {
                let url = format!(
                    "https://api.deepgram.com/v1/listen?model={}&language=en&filler_words=true&punctuate=true&mip_opt_out=true",
                    preview.model
                );
                let request = transport.audio_request(reqwest::Method::POST, &url, "Token ", &key, "audio/wav", Some(audio))?;
                let response = transport.send_reserved_audio(budget, request_id, payload_sha256, request).await?;
                let raw: Value = serde_json::from_slice(&response.bytes).map_err(|_| uncertain(budget, request_id, "Deepgram returned invalid JSON."))?;
                let id = response.request_id.or_else(|| raw["metadata"]["request_id"].as_str().map(String::from));
                (raw, id)
            }
            AudioProvider::Assemblyai => assemblyai(&transport, budget, request_id, payload_sha256, &key, audio, &preview).await?,
        };
        let parsed = match preview.provider {
            AudioProvider::Deepgram => parse_deepgram(&raw),
            AudioProvider::Assemblyai => parse_assemblyai(&raw),
        };
        let parsed = match parsed {
            Ok(parsed) => parsed,
            Err(error) => {
                budget.settle(request_id, None, None, provider_request_id.clone())?;
                return Err(format!("{error} Its charge is uncertain."));
            }
        };
        let billed_ms = parsed.duration_ms.unwrap_or(preview.duration_ms);
        let cost = cost_for(preview.provider, billed_ms);
        budget.settle(
            request_id,
            Some(cost),
            Some(Usage { input_tokens: None, output_tokens: None, audio_duration_ms: Some(billed_ms), unavailable_reason: None }),
            provider_request_id.clone(),
        )?;

        let result = to_result(&preview, &item.source_sha256, parsed, provider_request_id.clone(), cost)?;
        let measures = crate::analysis::measure(&[crate::analysis::SegmentInput { text: &result.raw_text, start_ms: None, end_ms: None }]);
        let summary = AudioResult {
            request_id: request_id.into(),
            provider: preview.provider,
            model: preview.model,
            text: result.raw_text.clone(),
            word_count: measures.word_count,
            filler_count: measures.fillers.len(),
            word_timings: result.words.value.is_some(),
            word_timings_unavailable_reason: result.words.unavailable_reason.clone(),
            provider_request_id,
            audio_duration_ms: Some(billed_ms),
            estimated_cost_micro_usd: cost,
        };
        Ok(ApiRun { summary, raw, result })
    }
}

/// Accounting after the user stopped waiting for a request (3.18). Before
/// dispatch nothing was sent and the reservation is released; after it the
/// provider may still finish and bill, so the charge stays Uncertain.
pub fn stopped(budget: &BudgetOwner, request_id: &str) -> String {
    if budget.release_unsent(request_id).is_ok() {
        "Stopped before anything was sent. Nothing was billed.".into()
    } else {
        let _ = budget.settle(request_id, None, None, None);
        "Stopped waiting. The provider may still finish and bill this request, so its charge is uncertain; nothing is retried.".into()
    }
}

/// Last resort when the session database cannot take a paid result: keep the raw
/// response and result in the app's cache so the charge is not wasted silently.
pub fn keep_unsaved(root: &Path, run: &ApiRun) -> Result<std::path::PathBuf> {
    recording::validate_id(&run.result.run_id)?;
    let dir = root.join("cache").join("api-transcription").join(&run.result.run_id);
    fs::create_dir_all(&dir).map_err(|_| "Cannot keep the API result.")?;
    prepare::contained(root, &dir)?;
    fs::write(dir.join("raw.json"), run.raw.to_string()).map_err(|_| "Cannot keep the API result.")?;
    fs::write(dir.join("transcription.json"), serde_json::to_vec_pretty(&run.result).map_err(|e| e.to_string())?).map_err(|_| "Cannot keep the API result.")?;
    Ok(dir)
}

/// A finished, settled API transcription: the summary shown to the user, plus
/// the raw response and validated result the caller stores (3.16).
pub struct ApiRun {
    pub summary: AudioResult,
    pub raw: Value,
    pub result: TranscriptionResult,
}

fn uncertain(budget: &BudgetOwner, id: &str, message: &str) -> String {
    let _ = budget.settle(id, None, None, None);
    format!("{message} Its charge is uncertain.")
}

/// Upload → submit → poll. Every step after the first runs on the already
/// dispatched reservation; a failure anywhere keeps the charge Uncertain.
async fn assemblyai(
    transport: &ApiTransport,
    budget: &BudgetOwner,
    id: &str,
    approved: &str,
    key: &crate::credentials::Secret,
    audio: Vec<u8>,
    preview: &AudioPreview,
) -> Result<(Value, Option<String>)> {
    let upload = transport.audio_request(reqwest::Method::POST, "https://api.assemblyai.com/v2/upload", "", key, "application/octet-stream", Some(audio))?;
    let uploaded: Value = serde_json::from_slice(&transport.send_reserved_audio(budget, id, approved, upload).await?.bytes)
        .map_err(|_| uncertain(budget, id, "AssemblyAI returned an invalid upload response."))?;
    let audio_url = uploaded["upload_url"].as_str().filter(|u| u.starts_with("https://")).ok_or_else(|| uncertain(budget, id, "AssemblyAI did not return an upload URL."))?;
    let mut body = preview.settings.clone();
    body["audio_url"] = json!(audio_url);
    let submit = transport.audio_request(reqwest::Method::POST, "https://api.assemblyai.com/v2/transcript", "", key, "application/json",
        Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?))?;
    let job: Value = serde_json::from_slice(&transport.send_dispatched(budget, id, submit).await?.bytes)
        .map_err(|_| uncertain(budget, id, "AssemblyAI returned an invalid job response."))?;
    let job_id = job["id"].as_str().filter(|j| recording::validate_id(j).is_ok()).ok_or_else(|| uncertain(budget, id, "AssemblyAI did not return a job ID."))?.to_string();
    let started = Instant::now();
    loop {
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_secs(3))).await.map_err(|e| e.to_string())?;
        let poll = transport.audio_request(reqwest::Method::GET, &format!("https://api.assemblyai.com/v2/transcript/{job_id}"), "", key, "", None)?;
        let status: Value = serde_json::from_slice(&transport.send_dispatched(budget, id, poll).await?.bytes)
            .map_err(|_| uncertain(budget, id, "AssemblyAI returned an invalid status response."))?;
        match status["status"].as_str() {
            Some("completed") => return Ok((status, Some(job_id))),
            Some("error") => {
                budget.settle(id, None, None, Some(job_id))?;
                return Err(format!("AssemblyAI could not transcribe this take: {}. Its charge is uncertain.", status["error"].as_str().unwrap_or("unknown error").chars().take(200).collect::<String>()));
            }
            Some("queued" | "processing") if started.elapsed() < Duration::from_secs(10 * 60) => continue,
            _ => {
                budget.settle(id, None, None, Some(job_id))?;
                return Err("AssemblyAI did not finish within 10 minutes. Its charge is uncertain; nothing is retried automatically.".into());
            }
        }
    }
}

/// Normalised provider output. Words carry provider times in milliseconds.
#[derive(Debug, PartialEq)]
pub struct Parsed {
    pub text: String,
    pub words: Vec<(String, u64, u64)>,
    pub duration_ms: Option<u64>,
}

pub fn parse_deepgram(raw: &Value) -> Result<Parsed> {
    let alternative = &raw["results"]["channels"][0]["alternatives"][0];
    let text = alternative["transcript"].as_str().ok_or("Deepgram returned no transcript.")?.trim().to_string();
    let words = alternative["words"]
        .as_array()
        .map(|words| {
            words
                .iter()
                .filter_map(|w| {
                    let text = w["punctuated_word"].as_str().or(w["word"].as_str())?;
                    let seconds = |v: &Value| v.as_f64().filter(|s| s.is_finite() && *s >= 0.0).map(|s| (s * 1000.0).round() as u64);
                    Some((text.to_string(), seconds(&w["start"])?, seconds(&w["end"])?))
                })
                .collect()
        })
        .unwrap_or_default();
    let duration_ms = raw["metadata"]["duration"].as_f64().filter(|d| d.is_finite() && *d >= 0.0).map(|d| (d * 1000.0).round() as u64);
    Ok(Parsed { text, words, duration_ms })
}

pub fn parse_assemblyai(raw: &Value) -> Result<Parsed> {
    let text = raw["text"].as_str().ok_or("AssemblyAI returned no transcript.")?.trim().to_string();
    let words = raw["words"]
        .as_array()
        .map(|words| {
            words
                .iter()
                .filter_map(|w| Some((w["text"].as_str()?.to_string(), w["start"].as_u64()?, w["end"].as_u64()?)))
                .collect()
        })
        .unwrap_or_default();
    let duration_ms = raw["audio_duration"].as_f64().filter(|d| d.is_finite() && *d >= 0.0).map(|d| (d * 1000.0).round() as u64);
    Ok(Parsed { text, words, duration_ms })
}

/// Validates into the provider-neutral contract. Word times outside the
/// prepared audio or out of order are withheld with a reason, never repaired.
pub fn to_result(preview: &AudioPreview, source_sha256: &str, parsed: Parsed, provider_request_id: Option<String>, cost: u64) -> Result<TranscriptionResult> {
    if parsed.text.is_empty() {
        return Err("The provider found no speech in this take.".into());
    }
    let mut previous = 0;
    let valid = !parsed.words.is_empty()
        && parsed.words.iter().all(|(text, start, end)| {
            let ok = !text.trim().is_empty() && *start >= previous && end >= start && *end <= preview.duration_ms;
            previous = *start;
            ok
        });
    let words = if valid {
        Available::known(parsed.words.into_iter().map(|(text, start_ms, end_ms)| TimedText { text, start_ms, end_ms, provenance: "Estimated".into() }).collect())
    } else {
        Available::missing("The provider returned no usable word timings within this recording")
    };
    let result = TranscriptionResult {
        version: 1,
        adapter_version: ADAPTER_VERSION.into(),
        provider: match preview.provider {
            AudioProvider::Deepgram => TranscriptionProvider::Deepgram,
            AudioProvider::Assemblyai => TranscriptionProvider::Assemblyai,
        },
        run_id: preview.request_id.clone(),
        request_id: provider_request_id.map_or_else(|| Available::missing("The provider returned no request ID"), Available::known),
        asset_id: preview.attempt_id.clone(),
        source_sha256: source_sha256.into(),
        prepared_sha256: preview.audio_sha256.clone(),
        model_id: preview.model.clone(),
        model_sha256: Available::missing("Hosted models have no published checksum"),
        language: Available::known("en".into()),
        raw_text: parsed.text,
        capabilities: Capabilities { segment_timings: false, word_timings: words.value.is_some(), speaker_labels: false },
        segments: Available::missing("This adapter keeps provider word timings; segments are not requested"),
        words,
        speakers: Available::missing("Speaker labels were not requested"),
        settings: preview.settings.clone(),
        usage: TranscriptionUsage {
            input_tokens: Available::missing("Billed by audio duration, not tokens"),
            output_tokens: Available::missing("Billed by audio duration, not tokens"),
            audio_duration_ms: parsed.duration_ms.map_or_else(|| Available::missing("The provider returned no audio duration"), Available::known),
            estimated_cost_micro_usd: Available::known(cost),
        },
        created_at_ms: recording::now_ms(),
    };
    result.validate(preview.duration_ms)?;
    Ok(result)
}

#[cfg(test)]
mod tests;
