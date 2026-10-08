//! Interface preferences from Settings (recording sounds, shortcuts, the chosen
//! microphone, default session length), stored as one JSON value in
//! `app_settings`. Unknown or damaged values fall back to the defaults.
use crate::storage::database::DatabaseOwner;
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
}

impl Default for Preferences {
    fn default() -> Self {
        Self { recording_sounds: true, recording_shortcuts: true, input_device_id: None, session_length: "standard".into() }
    }
}

fn validate(mut p: Preferences) -> Result<Preferences, String> {
    if !matches!(p.session_length.as_str(), "standard" | "short") {
        return Err("Unknown session length.".into());
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
        db.set_setting(KEY, "{broken").unwrap();
        assert_eq!(load(&db).unwrap(), Preferences::default());
        let blank = save(&db, Preferences { input_device_id: Some("  ".into()), ..Default::default() }).unwrap();
        assert_eq!(blank.input_device_id, None);
    }
}
