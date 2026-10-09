//! AI feedback on a take (M5, P.9): what a coaching request is built from, and
//! the stored runs. A run keeps the exact text that was sent and the revision
//! it came from, so a later correction never rewrites old feedback.
use super::{db_error, iso, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

/// Everything a take's coaching request is built from, read in one go.
#[derive(Clone, Debug)]
pub struct TakeInput {
    pub attempt_id: String,
    /// The machine revision, or the learner's correction of it when there is one.
    pub revision_id: String,
    pub text: String,
    pub corrected: bool,
    /// Timed parts of the machine transcript; empty when any part is untimed.
    pub timed_parts: Vec<(String, u64, u64)>,
    pub prompt: Option<String>,
    pub focus: Option<String>,
    pub familiarity: Option<String>,
    pub ordinal: u32,
    pub duration_ms: u64,
    pub pace_wpm: Option<f64>,
    pub pauses: Option<usize>,
    pub fillers: usize,
}

/// A stored feedback run as the review screen shows it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachingRun {
    pub id: String,
    pub attempt_id: String,
    pub revision_id: String,
    pub provider: String,
    pub model: String,
    pub payload_sha256: String,
    pub sent_text: String,
    pub transcript_text: String,
    pub delivery_impressions: bool,
    pub feedback: Value,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub estimated_cost_micro_usd: Option<u64>,
    pub cost_unavailable_reason: Option<String>,
    pub created_at: String,
}

/// What a finished request saves.
pub struct NewRun<'a> {
    pub id: &'a str,
    pub attempt_id: &'a str,
    pub revision_id: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub payload_sha256: &'a str,
    pub sent_text: &'a str,
    pub transcript_text: &'a str,
    pub delivery_impressions: bool,
    pub provider_request_id: Option<&'a str>,
    pub raw_response: &'a str,
    pub feedback: &'a Value,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub estimated_cost_micro_usd: Option<u64>,
}

const COLUMNS: &str = "id,attempt_id,revision_id,provider,model_id,payload_sha256,sent_text,transcript_text,delivery_impressions,result,input_tokens,output_tokens,estimated_cost_micro_usd,created_at_ms";

fn row(r: &rusqlite::Row) -> rusqlite::Result<CoachingRun> {
    let result: String = r.get(9)?;
    let cost: Option<i64> = r.get(12)?;
    Ok(CoachingRun {
        id: r.get(0)?,
        attempt_id: r.get(1)?,
        revision_id: r.get(2)?,
        provider: r.get(3)?,
        model: r.get(4)?,
        payload_sha256: r.get(5)?,
        sent_text: r.get(6)?,
        transcript_text: r.get(7)?,
        delivery_impressions: r.get::<_, i64>(8)? == 1,
        feedback: serde_json::from_str(&result).unwrap_or(Value::Null),
        input_tokens: r.get::<_, Option<i64>>(10)?.and_then(|v| u64::try_from(v).ok()),
        output_tokens: r.get::<_, Option<i64>>(11)?.and_then(|v| u64::try_from(v).ok()),
        estimated_cost_micro_usd: cost.and_then(|v| u64::try_from(v).ok()),
        cost_unavailable_reason: cost.is_none().then(|| "The provider did not report usage; the full reservation stays counted.".into()),
        created_at: iso(r.get(13)?),
    })
}

impl DatabaseOwner {
    /// Reads a saved take's newest transcript (your correction if you made one),
    /// its task, focus and measures. Fails with a plain reason when there is
    /// nothing to send yet.
    pub fn take_coaching_input(&self, attempt_id: &str) -> Result<TakeInput> {
        let view = self.attempt_transcript_with_voice(attempt_id)?;
        let revision = view["revision"].as_object().ok_or("Transcribe this take first. Feedback is based on its transcript.")?;
        let machine_id = revision["id"].as_str().unwrap_or_default().to_string();
        let (revision_id, text, corrected) = match view["correction"]["text"].as_str() {
            Some(text) => (view["correction"]["id"].as_str().unwrap_or_default().to_string(), text.to_string(), true),
            None => (machine_id, revision["text"].as_str().unwrap_or_default().to_string(), false),
        };
        if text.trim().is_empty() {
            return Err("This take's transcript is empty. Transcribe it again or correct it first.".into());
        }
        let segments = revision["segments"].as_array().cloned().unwrap_or_default();
        let timed: Option<Vec<(String, u64, u64)>> = segments
            .iter()
            .map(|s| Some((s["text"].as_str()?.trim().to_string(), s["startMs"].as_u64()?, s["endMs"].as_u64()?)))
            .collect();
        let measures = &revision["measures"];
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let (ordinal, prompt, focus, familiarity, duration): (i64, Option<String>, Option<String>, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT a.ordinal,s.prompt_snapshot,s.focus,tc.familiarity,aa.duration_ms FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id
                 LEFT JOIN task_conditions tc ON tc.attempt_id=a.id LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.id=?1 AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL",
                [attempt_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        Ok(TakeInput {
            attempt_id: attempt_id.into(),
            revision_id,
            text,
            corrected,
            timed_parts: timed.filter(|t| !t.is_empty()).unwrap_or_default(),
            prompt: prompt.filter(|p| !p.trim().is_empty()),
            focus: focus.filter(|f| !f.trim().is_empty()),
            familiarity,
            ordinal: u32::try_from(ordinal).unwrap_or(1),
            duration_ms: duration.and_then(|d| u64::try_from(d).ok()).unwrap_or(0),
            pace_wpm: measures["paceWpm"].as_f64(),
            // Pauses from the take's own audio when available, else from the transcript's timings.
            pauses: measures["voice"]["pauses"].as_array().filter(|_| measures["voice"]["unavailableReason"].is_null())
                .or_else(|| measures["pauses"].as_array().filter(|_| measures["pausesUnavailableReason"].is_null()))
                .map(Vec::len),
            fillers: measures["fillers"].as_array().map_or(0, |f| f.iter().filter(|c| c["decision"] != "dismissed").count()),
        })
    }

    pub fn insert_coaching_run(&self, run: &NewRun) -> Result<CoachingRun> {
        recording::validate_id(run.id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO coaching_runs(id,attempt_id,revision_id,provider,model_id,payload_sha256,sent_text,transcript_text,delivery_impressions,provider_request_id,raw_response,result,input_tokens,output_tokens,estimated_cost_micro_usd,created_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                run.id, run.attempt_id, run.revision_id, run.provider, run.model, run.payload_sha256, run.sent_text, run.transcript_text,
                i64::from(run.delivery_impressions), run.provider_request_id, run.raw_response, run.feedback.to_string(),
                run.input_tokens.and_then(|v| i64::try_from(v).ok()), run.output_tokens.and_then(|v| i64::try_from(v).ok()),
                run.estimated_cost_micro_usd.and_then(|v| i64::try_from(v).ok()), recording::now_ms() as i64
            ],
        )
        .map_err(db_error)?;
        conn.query_row(&format!("SELECT {COLUMNS} FROM coaching_runs WHERE id=?1"), [run.id], row).map_err(db_error)
    }

    /// A take's feedback, newest first.
    pub fn list_coaching_runs(&self, attempt_id: &str) -> Result<Vec<CoachingRun>> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM coaching_runs WHERE attempt_id=?1 ORDER BY created_at_ms DESC,id DESC"))
            .map_err(db_error)?;
        let rows = stmt.query_map([attempt_id], row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// When an identical request (same text, model and settings) was already
    /// answered for this take, the time it was answered (5.7 cache).
    pub fn coaching_answered_at(&self, attempt_id: &str, payload_sha256: &str) -> Result<Option<String>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row(
            "SELECT created_at_ms FROM coaching_runs WHERE attempt_id=?1 AND payload_sha256=?2 ORDER BY created_at_ms DESC LIMIT 1",
            params![attempt_id, payload_sha256],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(db_error)
        .map(|v| v.map(iso))
    }
}

