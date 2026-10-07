//! Provider-neutral, versioned result contract. Adapters validate their native
//! outputs before constructing this; capabilities never imply proven accuracy.
use super::whisper::Transcript;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptionProvider {
    LocalWhisper,
    Openai,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Available<T> {
    pub value: Option<T>,
    pub unavailable_reason: Option<String>,
}
impl<T> Available<T> {
    pub fn known(value: T) -> Self {
        Self {
            value: Some(value),
            unavailable_reason: None,
        }
    }
    pub fn missing(reason: &str) -> Self {
        Self {
            value: None,
            unavailable_reason: Some(reason.into()),
        }
    }
    fn valid(&self) -> bool {
        match (&self.value, &self.unavailable_reason) {
            (Some(_), None) => true,
            (None, Some(reason)) => !reason.is_empty() && reason.len() <= 512,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub segment_timings: bool,
    pub word_timings: bool,
    pub speaker_labels: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimedText {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub provenance: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptionUsage {
    pub input_tokens: Available<u64>,
    pub output_tokens: Available<u64>,
    pub audio_duration_ms: Available<u64>,
    pub estimated_cost_micro_usd: Available<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptionResult {
    pub version: u32,
    pub adapter_version: String,
    pub provider: TranscriptionProvider,
    pub run_id: String,
    pub request_id: Available<String>,
    pub asset_id: String,
    pub source_sha256: String,
    pub prepared_sha256: String,
    pub model_id: String,
    pub model_sha256: Available<String>,
    pub language: Available<String>,
    pub raw_text: String,
    pub capabilities: Capabilities,
    pub segments: Available<Vec<TimedText>>,
    pub words: Available<Vec<TimedText>>,
    pub speakers: Available<Vec<String>>,
    pub settings: Value,
    pub usage: TranscriptionUsage,
    pub created_at_ms: u64,
}

impl TranscriptionResult {
    pub fn from_local(local: &Transcript, duration_ms: u64) -> Result<Self, String> {
        let valid_segments = local
            .segments
            .iter()
            .all(|s| s.start_ms.is_some() && s.end_ms.is_some());
        let segments = if valid_segments {
            Available::known(
                local
                    .segments
                    .iter()
                    .map(|s| TimedText {
                        text: s.text.clone(),
                        start_ms: s.start_ms.unwrap(),
                        end_ms: s.end_ms.unwrap(),
                        provenance: "Estimated".into(),
                    })
                    .collect(),
            )
        } else {
            Available::missing("The worker returned at least one timing outside the original recording; raw segments remain in its native artifact")
        };
        let result = Self {
            version: 1,
            adapter_version: "whisper.cpp-1.9.1-v1".into(),
            provider: TranscriptionProvider::LocalWhisper,
            run_id: local.run_id.clone(),
            request_id: Available::missing("Local processing has no provider request ID"),
            asset_id: local.asset_id.clone(),
            source_sha256: local.source_sha256.clone(),
            prepared_sha256: local.prepared_sha256.clone(),
            model_id: local.model_id.clone(),
            model_sha256: Available::known(local.model_sha256.clone()),
            language: Available::known(local.language.clone()),
            raw_text: local.raw_text.clone(),
            capabilities: Capabilities {
                segment_timings: true,
                word_timings: false,
                speaker_labels: false,
            },
            segments,
            words: Available::missing(
                "Word alignment has not been verified for this local adapter",
            ),
            speakers: Available::missing("This local adapter does not perform speaker diarization"),
            settings: json!({"runtimeVersion":local.runtime_version,"backend":local.backend,"threads":local.threads,"prompt":local.prompt,
                "language":"en","task":"transcribe","beamSize":5,"bestOf":5,"flashAttention":true}),
            usage: TranscriptionUsage {
                input_tokens: Available::missing("Local Whisper has no API token billing"),
                output_tokens: Available::missing("Local Whisper has no API token billing"),
                audio_duration_ms: Available::known(duration_ms),
                estimated_cost_micro_usd: Available::known(0),
            },
            created_at_ms: local.created_at_ms,
        };
        result.validate(duration_ms)?;
        Ok(result)
    }

    pub fn validate(&self, duration_ms: u64) -> Result<(), String> {
        crate::storage::recording::validate_id(&self.run_id)?;
        crate::storage::recording::validate_id(&self.asset_id)?;
        let hash = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        if self.version != 1
            || self.adapter_version.is_empty()
            || self.adapter_version.len() > 128
            || self.model_id.is_empty()
            || self.raw_text.trim().is_empty()
            || self.raw_text.len() > 8 * 1024 * 1024
            || !hash(&self.source_sha256)
            || !hash(&self.prepared_sha256)
            || !self.request_id.valid()
            || !self.model_sha256.valid()
            || !self.language.valid()
            || !self.segments.valid()
            || !self.words.valid()
            || !self.speakers.valid()
            || !self.usage.input_tokens.valid()
            || !self.usage.output_tokens.valid()
            || !self.usage.audio_duration_ms.valid()
            || !self.usage.estimated_cost_micro_usd.valid()
            || self.model_sha256.value.as_ref().is_some_and(|s| !hash(s))
            || self.segments.value.is_some() && !self.capabilities.segment_timings
            || self.words.value.is_some() && !self.capabilities.word_timings
            || self.speakers.value.is_some() && !self.capabilities.speaker_labels
        {
            return Err("Invalid transcription result or unexplained missing capability.".into());
        }
        for timings in [&self.segments.value, &self.words.value]
            .into_iter()
            .flatten()
        {
            let mut previous = 0;
            for item in timings {
                if item.text.trim().is_empty()
                    || item.start_ms < previous
                    || item.end_ms < item.start_ms
                    || item.end_ms > duration_ms
                    || item.provenance != "Estimated"
                {
                    return Err(
                        "Transcription timing is invalid for the original recording.".into(),
                    );
                }
                previous = item.start_ms;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_adapter_preserves_identity_and_rejects_unearned_alignment() {
        let local = Transcript {
            version: 1,
            run_id: "run-1".into(),
            asset_id: "asset-1".into(),
            provider: "local-whisper".into(),
            model_id: "base".into(),
            model_sha256: "a".repeat(64),
            runtime_version: "1.9.1".into(),
            backend: super::super::whisper::Backend::Cpu,
            threads: 4,
            prompt: None,
            source_sha256: "b".repeat(64),
            prepared_sha256: "c".repeat(64),
            language: "en".into(),
            raw_text: "Hello".into(),
            segments: vec![super::super::whisper::Segment {
                text: "Hello".into(),
                start_ms: Some(0),
                end_ms: Some(100),
                timing_source: "Estimated".into(),
                timing_unavailable_reason: None,
            }],
            elapsed_ms: 50,
            peak_ram_bytes: None,
            peak_ram_unavailable_reason: Some("Not measured".into()),
            created_at_ms: 1,
        };
        let result = TranscriptionResult::from_local(&local, 100).unwrap();
        assert_eq!(result.source_sha256, local.source_sha256);
        assert_eq!(result.raw_text, "Hello");
        assert_eq!(result.usage.estimated_cost_micro_usd.value, Some(0));
        assert!(result.usage.input_tokens.value.is_none());
        assert!(result.words.value.is_none());
        let mut bad = result.clone();
        bad.words = Available::known(vec![TimedText {
            text: "Hello".into(),
            start_ms: 0,
            end_ms: 100,
            provenance: "Estimated".into(),
        }]);
        assert!(bad.validate(100).is_err());
        let mut bad = result.clone();
        bad.segments.value.as_mut().unwrap()[0].end_ms = 101;
        assert!(bad.validate(100).is_err());
        let mut missing = local;
        missing.segments[0].start_ms = None;
        missing.segments[0].end_ms = None;
        missing.segments[0].timing_unavailable_reason = Some("Outside source duration".into());
        let result = TranscriptionResult::from_local(&missing, 100).unwrap();
        assert!(result.segments.value.is_none());
        assert!(result.segments.unavailable_reason.is_some());
    }
    #[test]
    fn missing_values_require_a_reason_and_do_not_claim_capabilities() {
        let availability = Available::<u64>::missing("Provider did not return usage");
        assert!(availability.valid());
        assert!(!Available::<u64> {
            value: None,
            unavailable_reason: None
        }
        .valid());
        assert!(!Available::<u64> {
            value: Some(0),
            unavailable_reason: Some("Unknown".into())
        }
        .valid());
        assert!(Available::known(0u64).valid()); // Known zero local API cost, not absent usage.
        let json = serde_json::to_value(availability).unwrap();
        assert!(json["value"].is_null());
    }
}
