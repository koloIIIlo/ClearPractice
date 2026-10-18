//! Diagnostic report (plan 6.7). Reviewable before it is saved, and free of
//! personal content by default: only versions, counts, states and sizes. No
//! transcripts, notes, titles, prompts, file paths, device names, keys or
//! provider answers. Nothing is sent anywhere; you choose where to save it.
use crate::storage::database::{DatabaseOwner, SCHEMA_VERSION};
use serde_json::{json, Value};

type Result<T> = std::result::Result<T, String>;

/// Builds the report shown to you before saving.
pub fn report(db: &DatabaseOwner, extra: Value) -> Result<String> {
    let usage: Vec<Value> = crate::storage_usage::usage(db.root()).into_iter().map(|c| json!({"category": c.key, "bytes": c.bytes, "files": c.files})).collect();
    let preferences = crate::preferences::load(db)?;
    let value = json!({
        "report": "ClearPractice diagnostic report",
        "version": 1,
        "app": env!("CARGO_PKG_VERSION"),
        "schema": SCHEMA_VERSION,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpuThreads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        "createdAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "database": db.diagnostic_counts()?,
        "storage": usage,
        "settings": {
            "coachingMode": preferences.coaching_mode,
            "coachingModel": preferences.coaching_model.id(),
            "deliveryImpressions": preferences.delivery_impressions,
            "sessionLength": preferences.session_length,
            "recordingSounds": preferences.recording_sounds,
            "recordingShortcuts": preferences.recording_shortcuts,
            "chosenMicrophone": preferences.input_device_id.is_some(),
            "onboarded": preferences.onboarded,
        },
        "services": extra,
        "excluded": "No recordings, transcripts, notes, titles, prompts, phrases, file paths, device names, keys or provider answers.",
    });
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    #[test]
    fn the_report_holds_counts_and_states_but_no_personal_content() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.add_transfer_review(&crate::storage::database::transfer::TransferInput {
            local_date: "2026-10-09".into(), situation: "Talked to Anna about the Zurich office".into(), preparation: String::new(),
            listener_text: "secret words".into(), clarification: String::new(), success: String::new(), self_report: String::new(), next_focus: String::new(),
            flow: None, tags: Vec::new(), kind: None, extra: None,
        }).unwrap();
        let text = report(&db, json!({"openAiKey": true})).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["database"]["rows"]["transfer_reviews"], 1);
        assert_eq!(value["database"]["rows"]["phrase_cards"], 5, "starter phrases");
        assert_eq!(value["database"]["integrity"], "ok");
        assert_eq!(value["schema"], SCHEMA_VERSION);
        for private in ["Anna", "Zurich", "secret", &root.0.display().to_string()] {
            assert!(!text.contains(private), "{private} leaked");
        }
    }
}
