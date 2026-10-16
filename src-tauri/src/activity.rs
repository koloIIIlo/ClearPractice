//! A run's settings and a take's step (roadmap 7.3). Drills, conversations and
//! rehearsals keep their seed and parameters with the session, and each take
//! the step it answered, so a past session always reads as it was played.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Serialized parameters may not exceed this many bytes.
const MAX_PARAMS_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityContext {
    pub version: u32,
    pub seed: String,
    /// Sessions that belong together (a Story Cubes evening, one event plan).
    #[serde(default)]
    pub group_id: Option<String>,
    /// Scalars or lists of short strings only.
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityStep {
    pub index: u32,
    pub key: String,
    /// The take's own prompt when a run asks several (the session keeps one prompt).
    #[serde(default)]
    pub prompt_id: Option<String>,
}

fn short_text(value: &str) -> bool {
    value.len() <= 512 && !value.contains('\0')
}

fn plain_param(value: &Value) -> bool {
    match value {
        Value::String(s) => short_text(s),
        Value::Number(_) | Value::Bool(_) => true,
        Value::Array(items) => items.len() <= 50 && items.iter().all(|i| i.as_str().is_some_and(short_text)),
        Value::Null | Value::Object(_) => false,
    }
}

impl ActivityContext {
    pub fn validate(&self) -> Result<(), String> {
        let seed_ok = !self.seed.is_empty()
            && self.seed.len() <= 64
            && self.seed.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        let group_ok = self.group_id.as_deref().is_none_or(|g| crate::storage::recording::validate_id(g).is_ok());
        let params_ok = self.params.iter().all(|(k, v)| !k.is_empty() && k.len() <= 40 && plain_param(v))
            && serde_json::to_string(&self.params).is_ok_and(|s| s.len() <= MAX_PARAMS_BYTES);
        if !(1..=1000).contains(&self.version) || !seed_ok || !group_ok || !params_ok {
            return Err("The activity's settings are invalid or too large.".into());
        }
        Ok(())
    }
}

impl ActivityStep {
    pub fn validate(&self) -> Result<(), String> {
        let key_ok = !self.key.is_empty()
            && self.key.len() <= 40
            && self.key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
        let prompt_ok = self.prompt_id.as_deref().is_none_or(|p| crate::storage::recording::validate_id(p).is_ok());
        if self.index > 50 || !key_ok || !prompt_ok {
            return Err("The take's step is invalid.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context(params: Value) -> ActivityContext {
        serde_json::from_value(json!({"version": 1, "seed": "Ab-12", "groupId": "evening-1", "params": params})).unwrap()
    }

    #[test]
    fn settings_accept_scalars_and_short_lists_only() {
        assert!(context(json!({"speakSeconds": 60, "topic": "A lost key", "icons": ["Key", "Moon"], "timed": true})).validate().is_ok());
        assert!(context(json!({"nested": {"a": 1}})).validate().is_err());
        assert!(context(json!({"missing": null})).validate().is_err());
        assert!(context(json!({"words": [1, 2]})).validate().is_err());
        assert!(context(json!({"big": "x".repeat(600)})).validate().is_err());
        let many: Map<String, Value> = (0..20).map(|i| (format!("key{i}"), json!("y".repeat(300)))).collect();
        assert!(context(Value::Object(many)).validate().is_err(), "over 4 KB in all");
    }

    #[test]
    fn seeds_groups_and_versions_are_checked() {
        let mut c = context(json!({}));
        c.seed = "has space".into();
        assert!(c.validate().is_err());
        let mut c = context(json!({}));
        c.group_id = Some("../evening".into());
        assert!(c.validate().is_err());
        let mut c = context(json!({}));
        c.version = 0;
        assert!(c.validate().is_err());
        assert!(serde_json::from_value::<ActivityContext>(json!({"version": 1, "seed": "a", "kind": "jam"})).is_err(), "unknown fields are refused");
    }

    #[test]
    fn steps_have_a_small_index_and_a_plain_key() {
        let step = |index: u32, key: &str| ActivityStep { index, key: key.into(), prompt_id: Some("p-sport-var".into()) };
        assert!(step(2, "fast").validate().is_ok());
        assert!(step(51, "fast").validate().is_err());
        assert!(step(1, "Fast").validate().is_err());
        assert!(step(1, "").validate().is_err());
        assert!(ActivityStep { index: 0, key: "turn".into(), prompt_id: Some("bad id".into()) }.validate().is_err());
    }
}
