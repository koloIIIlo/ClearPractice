//! Interface preferences from Settings (recording sounds, shortcuts, the chosen
//! microphone, default session length, coaching choices), stored as one JSON
//! value in `app_settings`. Unknown or damaged values fall back to the defaults.
use crate::{api::coaching::CoachingModel, storage::database::DatabaseOwner};
use serde::{Deserialize, Serialize};

const KEY: &str = "ui_preferences";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub recording_sounds: bool,
    pub recording_shortcuts: bool,
    /// `None` follows the Windows default microphone.
    pub input_device_id: Option<String>,
    /// "standard" (about 13 minutes) or "short" (about 5 minutes).
    pub session_length: String,
    /// "api" shows AI feedback on takes (every request is previewed and sent
    /// only on Send); "off" hides it (5.10).
    pub coaching_mode: String,
    pub coaching_model: CoachingModel,
    /// D-27: how delivery may come across to a listener; off by default.
    pub delivery_impressions: bool,
    /// First-launch setup (4.19) finished or skipped.
    pub onboarded: bool,
    /// What you want to improve: clarity, hesitation, phrasing, confidence.
    pub goals: Vec<String>,
    pub goal_note: String,
    /// Where the difficulty shows: "english" or "both" (also your strongest language).
    pub difficulty_language: Option<String>,
    /// Local LLM (5.4): a loopback server address and an optional model name.
    pub local_endpoint: String,
    pub local_model: String,
    /// Your own warning level for the shared monthly API spending (3.17), in
    /// micro-USD; the USD 5 stop is fixed (D-7, D-22).
    pub budget_warning_micro_usd: u64,
    /// Daily reminder time ("HH:MM", local), or `None` for no reminder.
    pub reminder_time: Option<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { recording_sounds: true, recording_shortcuts: true, input_device_id: None, session_length: "standard".into(),
            coaching_mode: "api".into(), coaching_model: CoachingModel::default(), delivery_impressions: false,
            onboarded: false, goals: Vec::new(), goal_note: String::new(), difficulty_language: None,
            local_endpoint: "http://127.0.0.1:8080".into(), local_model: String::new(), budget_warning_micro_usd: 4_000_000, reminder_time: None }
    }
}

fn validate(mut p: Preferences) -> Result<Preferences, String> {
    if !matches!(p.session_length.as_str(), "standard" | "short") {
        return Err("Unknown session length.".into());
    }
    if !matches!(p.coaching_mode.as_str(), "api" | "local" | "off") {
        return Err("Unknown coaching mode.".into());
    }
    p.local_endpoint = crate::api::local_llm::validate_endpoint(&p.local_endpoint)?;
    if p.reminder_time.as_deref().is_some_and(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").is_err()) {
        return Err("Choose a reminder time like 18:00.".into());
    }
    if !(100_000..=5_000_000).contains(&p.budget_warning_micro_usd) {
        return Err("Choose a warning between USD 0.10 and USD 5.00.".into());
    }
    p.local_model = p.local_model.trim().to_string();
    if p.local_model.chars().count() > 120 || p.local_model.chars().any(char::is_control) {
        return Err("Keep the model name under 120 characters.".into());
    }
    p.goals.dedup();
    if p.goals.len() > 4 || p.goals.iter().any(|g| !matches!(g.as_str(), "clarity" | "hesitation" | "phrasing" | "confidence")) {
        return Err("Choose goals from the list.".into());
    }
    p.goal_note = p.goal_note.trim().to_string();
    if p.goal_note.chars().count() > 300 || p.goal_note.contains('\0') {
        return Err("Keep your goal under 300 characters.".into());
    }
    if p.difficulty_language.as_deref().is_some_and(|l| !matches!(l, "english" | "both")) {
        return Err("Unknown language choice.".into());
    }
    p.input_device_id = p.input_device_id.filter(|id| !id.trim().is_empty());
    if p.input_device_id.as_ref().is_some_and(|id| id.len() > 512) {
        return Err("The microphone ID is too long.".into());
    }
    Ok(p)
}

pub fn load(db: &DatabaseOwner) -> Result<Preferences, String> {
    Ok(db
        .setting(KEY)?
        .and_then(|json| serde_json::from_str::<Preferences>(&json).ok())
        .and_then(|p| validate(p).ok())
        .unwrap_or_default())
}

pub fn save(db: &DatabaseOwner, preferences: Preferences) -> Result<Preferences, String> {
    let preferences = validate(preferences)?;
    db.set_setting(KEY, &serde_json::to_string(&preferences).map_err(|e| e.to_string())?)?;
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    #[test]
    fn preferences_default_round_trip_and_reject_unknown_lengths() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(load(&db).unwrap(), Preferences::default());
        let chosen = Preferences { recording_sounds: false, input_device_id: Some("mic-2".into()), session_length: "short".into(), ..Default::default() };
        assert_eq!(save(&db, chosen.clone()).unwrap(), chosen);
        assert_eq!(load(&db).unwrap(), chosen);
        assert!(save(&db, Preferences { session_length: "long".into(), ..Default::default() }).is_err());
        assert!(save(&db, Preferences { coaching_mode: "cloud".into(), ..Default::default() }).is_err());
        assert!(save(&db, Preferences { coaching_mode: "local".into(), local_endpoint: "http://192.168.0.9:8080".into(), ..Default::default() }).is_err(), "loopback only");
        assert_eq!(save(&db, Preferences { coaching_mode: "local".into(), local_endpoint: "http://localhost:8080/".into(), ..Default::default() }).unwrap().local_endpoint, "http://localhost:8080");
        assert!(save(&db, Preferences { goals: vec!["fluency score".into()], ..Default::default() }).is_err());
        let goals = save(&db, Preferences { goals: vec!["clarity".into(), "hesitation".into()], goal_note: "  Explain designs at work ".into(), difficulty_language: Some("both".into()), onboarded: true, ..Default::default() }).unwrap();
        assert_eq!((goals.goal_note.as_str(), goals.onboarded), ("Explain designs at work", true));
        // Older stored preferences without the coaching fields keep the defaults.
        db.set_setting(KEY, r#"{"recordingSounds":false,"recordingShortcuts":true,"inputDeviceId":null,"sessionLength":"short"}"#).unwrap();
        let old = load(&db).unwrap();
        assert!(!old.recording_sounds && old.coaching_mode == "api" && !old.delivery_impressions && old.coaching_model == CoachingModel::Luna);
        db.set_setting(KEY, "{broken").unwrap();
        assert_eq!(load(&db).unwrap(), Preferences::default());
        let blank = save(&db, Preferences { input_device_id: Some("  ".into()), ..Default::default() }).unwrap();
        assert_eq!(blank.input_device_id, None);
    }
}
