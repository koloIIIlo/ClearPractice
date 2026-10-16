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
    /// The Studio's Ready state shows the live microphone level (nothing is recorded).
    pub level_before_recording: bool,
    /// Each new take is transcribed on this computer as soon as it is saved
    /// (local mode only; cloud transcription is always one previewed take at a time).
    pub auto_transcribe: bool,
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
    /// The guided tour was finished or skipped (it can be taken again from Help).
    pub tour_done: bool,
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
    /// Coaching prices you entered (5.9), by model ID; others use the built-in prices.
    pub coaching_prices: std::collections::BTreeMap<String, crate::api::coaching::PriceOverride>,
    /// "playful" shows the game layer (levels, effort points, celebrations); "calm"
    /// hides it. Progress is kept either way (roadmap 7.5, D-32).
    pub practice_style: String,
    /// The one-time Playful-or-Calm choice was made.
    pub style_chosen: bool,
    /// "full", "subtle" or "off"; reduced motion turns "full" into "subtle".
    pub celebrations: String,
    pub celebration_sounds: bool,
    /// The recorder shows a live pace meter from the audio (roadmap 8.8); off by default.
    pub live_pace: bool,
    /// Your own words to watch (8.11), counted in every take summary next to the
    /// default list: lowercase, at most 30 characters each, at most 20.
    pub watch_words: Vec<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { recording_sounds: true, recording_shortcuts: true, level_before_recording: true, auto_transcribe: true, input_device_id: None, session_length: "standard".into(),
            coaching_mode: "api".into(), coaching_model: CoachingModel::default(), delivery_impressions: false,
            onboarded: false, tour_done: false, goals: Vec::new(), goal_note: String::new(), difficulty_language: None,
            local_endpoint: "http://127.0.0.1:8080".into(), local_model: String::new(), budget_warning_micro_usd: 4_000_000, reminder_time: None,
            coaching_prices: Default::default(), practice_style: "playful".into(), style_chosen: false, celebrations: "full".into(), celebration_sounds: false,
            live_pace: false, watch_words: Vec::new() }
    }
}

fn validate(mut p: Preferences) -> Result<Preferences, String> {
    if !matches!(p.session_length.as_str(), "standard" | "short") {
        return Err("Unknown session length.".into());
    }
    if !matches!(p.coaching_mode.as_str(), "api" | "local" | "off") {
        return Err("Unknown coaching mode.".into());
    }
    if !matches!(p.practice_style.as_str(), "playful" | "calm") {
        return Err("Choose Playful or Calm.".into());
    }
    if !matches!(p.celebrations.as_str(), "full" | "subtle" | "off") {
        return Err("Choose full, subtle or no celebrations.".into());
    }
    p.local_endpoint = crate::api::local_llm::validate_endpoint(&p.local_endpoint)?;
    for (id, price) in &p.coaching_prices {
        if !crate::api::coaching::CoachingModel::all().iter().any(|m| m.id() == id) {
            return Err("Unknown model in the price list.".into());
        }
        price.validate()?;
    }
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
    let mut words: Vec<String> = Vec::new();
    for word in &p.watch_words {
        let word = word.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
        if word.chars().count() > 30 || word.chars().any(char::is_control) {
            return Err("Keep each word to watch under 30 characters.".into());
        }
        if !word.is_empty() && !words.contains(&word) {
            words.push(word);
        }
    }
    if words.len() > 20 {
        return Err("Watch up to 20 words of your own.".into());
    }
    p.watch_words = words;
    p.input_device_id = p.input_device_id.filter(|id| !id.trim().is_empty());
    if p.input_device_id.as_ref().is_some_and(|id| id.len() > 512) {
        return Err("The microphone ID is too long.".into());
    }
    Ok(p)
}

pub fn load(db: &DatabaseOwner) -> Result<Preferences, String> {
    let preferences = db
        .setting(KEY)?
        .and_then(|json| serde_json::from_str::<Preferences>(&json).ok())
        .and_then(|p| validate(p).ok())
        .unwrap_or_default();
    crate::api::coaching::set_price_overrides(&preferences.coaching_prices);
    Ok(preferences)
}

pub fn save(db: &DatabaseOwner, preferences: Preferences) -> Result<Preferences, String> {
    let preferences = validate(preferences)?;
    crate::api::coaching::set_price_overrides(&preferences.coaching_prices);
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

    #[test]
    fn watch_words_are_trimmed_deduplicated_and_limited() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(!load(&db).unwrap().live_pace, "live pace is off until you turn it on");
        let words = |list: &[&str]| Preferences { watch_words: list.iter().map(|w| w.to_string()).collect(), live_pace: true, ..Default::default() };
        let saved = save(&db, words(&[" Like ", "like", "", "  you   see ", "Right"])).unwrap();
        assert_eq!(saved.watch_words, ["like", "you see", "right"]);
        assert!(load(&db).unwrap().live_pace);
        assert!(save(&db, words(&["a".repeat(31).as_str()])).is_err());
        let many: Vec<String> = (0..21).map(|i| format!("word{i}")).collect();
        assert!(save(&db, words(&many.iter().map(String::as_str).collect::<Vec<_>>())).is_err());
        assert_eq!(load(&db).unwrap().watch_words, ["like", "you see", "right"], "a refused save keeps the list");
    }

    #[test]
    fn practice_style_round_trips_and_rejects_unknown_values() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let defaults = load(&db).unwrap();
        assert_eq!((defaults.practice_style.as_str(), defaults.style_chosen, defaults.celebrations.as_str(), defaults.celebration_sounds), ("playful", false, "full", false));
        let calm = Preferences { practice_style: "calm".into(), style_chosen: true, celebrations: "off".into(), celebration_sounds: true, ..Default::default() };
        assert_eq!(save(&db, calm.clone()).unwrap(), calm);
        assert_eq!(load(&db).unwrap(), calm);
        assert!(save(&db, Preferences { practice_style: "quiet".into(), ..Default::default() }).is_err());
        assert!(save(&db, Preferences { celebrations: "loud".into(), ..Default::default() }).is_err());
        // Preferences saved before 7.5 keep the defaults for the new fields.
        db.set_setting(KEY, r#"{"recordingSounds":false,"sessionLength":"short"}"#).unwrap();
        let old = load(&db).unwrap();
        assert_eq!((old.practice_style.as_str(), old.celebrations.as_str()), ("playful", "full"));
    }
}
