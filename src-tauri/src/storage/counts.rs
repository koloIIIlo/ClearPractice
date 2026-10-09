//! Row counts for the diagnostic report (6.7): counts and states only, never contents.
use super::DatabaseOwner;
use serde_json::{json, Map, Value};

type Result<T> = std::result::Result<T, String>;

/// Tables whose row counts help diagnose problems. Counts only, never contents.
const COUNTED: [&str; 16] = [
    "sessions", "attempts", "audio_assets", "jobs", "transcript_revisions", "annotations", "prosody_tracks", "api_runs",
    "coaching_runs", "reference_clips", "clip_sources", "phrase_cards", "phrase_reviews", "user_prompts", "transfer_reviews", "progression_events",
];

impl DatabaseOwner {
    /// Row counts and job states, for the diagnostic report.
    pub fn diagnostic_counts(&self) -> Result<Value> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut counts = Map::new();
        for table in COUNTED {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap_or(-1);
            counts.insert(table.into(), json!(n));
        }
        let mut stmt = conn.prepare("SELECT state, COUNT(*) FROM jobs GROUP BY state ORDER BY state").map_err(|e| e.to_string())?;
        let jobs: Map<String, Value> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, json!(r.get::<_, i64>(1)?))))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let integrity: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).unwrap_or_else(|_| "unavailable".into());
        Ok(json!({"rows": counts, "jobsByState": jobs, "integrity": integrity}))
    }
}

