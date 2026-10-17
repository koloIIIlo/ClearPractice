//! Practice events (roadmap 7.4, D-31) and the facts snapshot (7.6). The XP
//! rules live in `crate::engagement`. Events are written in the same
//! transaction as the action that earned them and are never removed: Trash and
//! permanent deletion keep them, so effort is never taken away.
use super::{db_error, iso, DatabaseOwner, Result};
use crate::engagement::{take_awards, EventKind, NewEvent, RULES_VERSION};
use crate::storage::recording;
use chrono::{DateTime, Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

/// app_settings key marking that history was turned into events once.
const BACKFILL_KEY: &str = "engagement_backfill_v1";
/// Bumped when facts gain fields, so the interface can tell what to expect.
pub const FACTS_VERSION: u32 = 4;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeEvent {
    pub id: i64,
    pub kind: String,
    pub ref_id: String,
    pub local_date: String,
    pub session_id: Option<String>,
    pub attempt_id: Option<String>,
    pub xp: u32,
    pub backfilled: bool,
    pub created_at: String,
}

/// The local calendar date of a moment, as stored sessions use it.
pub(crate) fn local_date(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_default()
        .with_timezone(&Local)
        .format("%Y-%m-%d")
        .to_string()
}

pub(crate) fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// Records the event once (UNIQUE(kind, ref_id)). Above a daily cap the event
/// is still recorded, with 0 XP. Returns whether it was new.
pub(crate) fn award(conn: &Connection, event: &NewEvent) -> Result<bool> {
    let xp = match event.kind.daily_cap() {
        Some(cap) => {
            let earned: i64 = conn
                .query_row(
                    "SELECT count(*) FROM practice_events WHERE kind=?1 AND local_date=?2 AND xp>0",
                    params![event.kind.as_str(), event.local_date],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if earned >= i64::from(cap) { 0 } else { event.kind.xp() }
        }
        None => event.kind.xp(),
    };
    let added = conn
        .execute(
            "INSERT OR IGNORE INTO practice_events(kind,ref_id,local_date,session_id,attempt_id,xp,rules_version,backfilled,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![event.kind.as_str(), event.ref_id, event.local_date, event.session_id, event.attempt_id, xp, RULES_VERSION, event.backfilled, event.created_at_ms],
        )
        .map_err(db_error)?;
    Ok(added == 1)
}

/// `take_saved`, and `retake` for later takes, for one saved take (7.4).
pub(crate) fn award_take(conn: &Connection, attempt_id: &str, ordinal: u32, duration_ms: u64, session_id: &str, local_date: &str, created_at_ms: i64, backfilled: bool) -> Result<()> {
    let (take, retake) = take_awards(ordinal, duration_ms);
    for (earned, kind) in [(take, EventKind::TakeSaved), (retake, EventKind::Retake)] {
        if earned {
            award(conn, &NewEvent { kind, ref_id: attempt_id, local_date, session_id: Some(session_id), attempt_id: Some(attempt_id), created_at_ms, backfilled })?;
        }
    }
    Ok(())
}

/// `drill_round` once per drill session (M10), on its first saved take of any
/// length (an emphasis round lasts about three seconds).
pub(crate) fn award_drill_round(conn: &Connection, attempt_id: &str, session_id: &str, local_date: &str, created_at_ms: i64, backfilled: bool) -> Result<()> {
    let kind: Option<String> = conn
        .query_row(
            "SELECT e.type FROM session_steps st JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version WHERE st.session_id=?1 LIMIT 1",
            [session_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_error)?
        .flatten();
    if kind.as_deref().is_some_and(crate::exercise_types::is_drill) {
        award(conn, &NewEvent { kind: EventKind::DrillRound, ref_id: session_id, local_date, session_id: Some(session_id), attempt_id: Some(attempt_id), created_at_ms, backfilled })?;
    }
    Ok(())
}

/// Whether every hesitation candidate of a machine revision has your decision.
/// A revision without candidates has nothing to review.
pub(crate) fn every_candidate_decided(conn: &Connection, revision_id: &str) -> Result<bool> {
    let segments: Vec<(String, Option<i64>, Option<i64>)> = {
        let mut stmt = conn.prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
        let rows = stmt.query_map([revision_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
    };
    let inputs: Vec<crate::analysis::SegmentInput> = segments
        .iter()
        .map(|(text, start, end)| crate::analysis::SegmentInput { text, start_ms: start.and_then(|v| u64::try_from(v).ok()), end_ms: end.and_then(|v| u64::try_from(v).ok()) })
        .collect();
    let candidates = crate::analysis::measure(&inputs).fillers.len();
    let decided: i64 = conn
        .query_row(
            "SELECT count(*) FROM annotations WHERE revision_id=?1 AND definition_version=?2 AND kind='filler'",
            params![revision_id, crate::analysis::FILLER_DEFINITION_VERSION],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    Ok(candidates > 0 && usize::try_from(decided).unwrap_or(0) >= candidates)
}

fn event_row(r: &rusqlite::Row) -> rusqlite::Result<PracticeEvent> {
    Ok(PracticeEvent {
        id: r.get(0)?,
        kind: r.get(1)?,
        ref_id: r.get(2)?,
        local_date: r.get(3)?,
        session_id: r.get(4)?,
        attempt_id: r.get(5)?,
        xp: r.get(6)?,
        backfilled: r.get(7)?,
        created_at: iso(r.get(8)?),
    })
}
const EVENT_COLUMNS: &str = "id,kind,ref_id,local_date,session_id,attempt_id,xp,backfilled,created_at_ms";

/// Turns existing history into events once, after the upgrade to v16: your
/// history already counts (the "head start"). Takes in Trash count too, as
/// effort is never taken away. Each event keeps its original date and is
/// marked as backfilled so nothing celebrates it.
pub(crate) fn backfill_practice_events(conn: &Connection) -> Result<()> {
    let done: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM app_settings WHERE key=?1)", [BACKFILL_KEY], |r| r.get(0)).map_err(db_error)?;
    if done {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(db_error)?;
    let event = |kind, ref_id: &str, local_date: &str, session_id: Option<&str>, attempt_id: Option<&str>, created_at_ms| {
        award(&tx, &NewEvent { kind, ref_id, local_date, session_id, attempt_id, created_at_ms, backfilled: true })
    };
    {
        let mut stmt = tx.prepare("SELECT a.id,a.ordinal,s.id,s.local_date,a.created_at_ms,aa.duration_ms FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.capture_state='saved' ORDER BY a.created_at_ms,a.id").map_err(db_error)?;
        let takes: Vec<(String, u32, String, String, i64, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        for (attempt, ordinal, session, date, created, duration) in takes {
            award_take(&tx, &attempt, ordinal, u64::try_from(duration).unwrap_or(0), &session, &date, created, true)?;
        }
    }
    {
        let mut stmt = tx.prepare("SELECT id,local_date,started_at_ms,(ease IS NOT NULL OR takeaway IS NOT NULL),tags FROM sessions ORDER BY started_at_ms,id").map_err(db_error)?;
        let sessions: Vec<(String, String, i64, bool, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        for (id, date, started, reflected, tags) in sessions {
            if reflected {
                event(EventKind::ReflectionSaved, &id, &date, Some(&id), None, started)?;
            }
            if serde_json::from_str::<Vec<String>>(&tags).is_ok_and(|t| t.iter().any(|t| t == "baseline")) {
                event(EventKind::BaselineSaved, &id, &date, Some(&id), None, started)?;
            }
        }
    }
    {
        // The newest machine revision of each take, as the transcript view shows it.
        let mut stmt = tx.prepare("SELECT r.attempt_id,r.id,(SELECT MAX(decided_at_ms) FROM annotations n WHERE n.revision_id=r.id) FROM transcript_revisions r WHERE r.source<>'user' AND r.id=(SELECT r2.id FROM transcript_revisions r2 WHERE r2.attempt_id=r.attempt_id AND r2.source<>'user' ORDER BY r2.created_at_ms DESC,r2.id DESC LIMIT 1)").map_err(db_error)?;
        let revisions: Vec<(String, String, Option<i64>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        for (attempt, revision, decided_at) in revisions {
            if let Some(at) = decided_at.filter(|_| every_candidate_decided(&tx, &revision).unwrap_or(false)) {
                event(EventKind::TranscriptReviewed, &attempt, &local_date(at), None, Some(&attempt), at)?;
            }
        }
    }
    {
        let mut stmt = tx.prepare("SELECT id,created_at_ms FROM phrase_cards WHERE id NOT LIKE 'phrase-starter-%' ORDER BY created_at_ms,id").map_err(db_error)?;
        let cards: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        for (id, created) in cards {
            event(EventKind::PhraseSaved, &id, &local_date(created), None, None, created)?;
        }
        let mut stmt = tx.prepare("SELECT id,reviewed_at_ms FROM phrase_reviews ORDER BY reviewed_at_ms,id").map_err(db_error)?;
        let reviews: Vec<(i64, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        for (id, at) in reviews {
            event(EventKind::PhraseReviewed, &format!("review-{id}"), &local_date(at), None, None, at)?;
        }
        let mut stmt = tx.prepare("SELECT id,local_date,created_at_ms FROM transfer_reviews ORDER BY created_at_ms,id").map_err(db_error)?;
        let transfers: Vec<(String, String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        for (id, date, created) in transfers {
            event(EventKind::TransferReview, &id, &date, None, None, created)?;
        }
    }
    tx.execute("INSERT INTO app_settings(key,value) VALUES (?1,?2)", params![BACKFILL_KEY, recording::now_ms().to_string()]).map_err(db_error)?;
    tx.commit().map_err(db_error)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactSession {
    pub id: String,
    pub local_date: String,
    pub started_at: String,
    pub exercise_type: Option<String>,
    pub content_id: Option<String>,
    pub tags: Vec<String>,
    pub familiarity: Option<String>,
    pub preparation_seconds: Option<u32>,
    pub target_seconds: Option<u32>,
    pub audience: bool,
    pub follow_up: bool,
    /// Point, reason and example filled in the outline.
    pub outline: [bool; 3],
    pub ease: Option<u8>,
    pub focus: Option<String>,
    pub takeaway: bool,
    pub status: String,
    pub take_count: u32,
    pub duration_ms: u64,
    pub preferred_take: Option<String>,
    /// Facts v4 (M10): a run's settings (7.3), as stored with the session.
    pub activity: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactTake {
    pub id: String,
    pub session_id: String,
    pub ordinal: u32,
    pub local_date: String,
    pub created_at: String,
    pub duration_ms: u64,
    pub step_key: Option<String>,
    pub transcribed: bool,
    pub revision_id: Option<String>,
    pub words: Option<u32>,
    pub pace_wpm: Option<f64>,
    pub speech_span_ms: Option<u64>,
    pub filler_candidates: Option<u32>,
    pub fillers_confirmed: Option<u32>,
    pub fillers_reviewed: bool,
    pub pauses_over_threshold: Option<u32>,
    pub prosody_viewed: bool,
    pub has_ai_feedback: bool,
    // Facts v2 (roadmap M8): measures v2 of the same revision, saved phrases
    // spotted in the take's current transcript, your self-checks, the pitch
    // range of its intonation track and its speech rate from the audio.
    pub mean_run: Option<f64>,
    pub longest_run: Option<u32>,
    pub mid_clause_pauses: Option<u32>,
    pub boundary_pauses: Option<u32>,
    pub watch_per_100: Option<f64>,
    pub hedges_per_100: Option<f64>,
    pub different_per_50: Option<f64>,
    pub phrase_ids: Vec<String>,
    /// Self-check ID → your answer.
    pub checks: std::collections::BTreeMap<String, bool>,
    pub pitch_range_st: Option<f64>,
    pub rate_sps: Option<f64>,
    /// Facts v4 (M10): a drill take's cached result for its current transcript, numbers only.
    pub result: Option<std::collections::BTreeMap<String, f64>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactTransfer {
    pub id: String,
    pub local_date: String,
    pub has_listener_words: bool,
    pub needed_clarification: bool,
    pub has_success: bool,
    pub has_next_focus: bool,
    /// Facts v3 (9.16): how your speaking flowed and the kinds of conversation, Your note.
    pub flow: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactPhrase {
    pub id: String,
    pub created_at: String,
    pub starter: bool,
    pub deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactPhraseReview {
    pub card_id: String,
    pub local_date: String,
    pub rating: String,
}

/// Everything the rule engines read, in one call (7.6): sessions and takes in
/// history (not in Trash) with the measures of each take's newest machine
/// revision, reflections, phrases and their reviews, and stage choices.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeFacts {
    pub facts_version: u32,
    pub generated_at: String,
    pub today: String,
    pub transcription_available: bool,
    pub sessions: Vec<FactSession>,
    pub takes: Vec<FactTake>,
    pub transfer_reviews: Vec<FactTransfer>,
    pub phrases: Vec<FactPhrase>,
    pub phrase_reviews: Vec<FactPhraseReview>,
    pub progression: Vec<super::progression::ProgressionEvent>,
    /// Facts v3 (M9 achievements): prompts you wrote and blind A/B choices you saved.
    pub user_prompts: u32,
    pub blind_comparisons: u32,
}

fn count_rows(conn: &Connection, sql: &str) -> Result<u32> {
    conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map(|n| u32::try_from(n).unwrap_or(0)).map_err(db_error)
}

fn filled(text: &Option<String>) -> bool {
    text.as_deref().is_some_and(|t| !t.trim().is_empty())
}

fn count(value: Option<f64>) -> Option<u32> {
    value.filter(|v| v.is_finite() && *v >= 0.0).map(|v| v.round() as u32)
}

impl DatabaseOwner {
    pub fn list_practice_events(&self, from: Option<&str>) -> Result<Vec<PracticeEvent>> {
        if from.is_some_and(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_err()) {
            return Err("Choose a date like 2026-10-12.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {EVENT_COLUMNS} FROM practice_events WHERE ?1 IS NULL OR local_date>=?1 ORDER BY local_date,created_at_ms,id"))
            .map_err(db_error)?;
        let rows = stmt.query_map([from], event_row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Practice complete (7.4): one event per finished sequence, when at least
    /// one of its sessions has a saved take. Returns the event, or None.
    pub fn record_sequence_completed(&self, session_ids: &[String], date: &str) -> Result<Option<PracticeEvent>> {
        if session_ids.is_empty() || session_ids.len() > 10 {
            return Err("A sequence has between 1 and 10 sessions.".into());
        }
        for id in session_ids {
            recording::validate_id(id)?;
        }
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err("Choose a date like 2026-10-12.".into());
        }
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let mut practised = false;
        for id in session_ids {
            practised |= tx
                .query_row("SELECT EXISTS(SELECT 1 FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE st.session_id=?1 AND a.capture_state='saved')", [id], |r| r.get::<_, bool>(0))
                .map_err(db_error)?;
        }
        if !practised {
            return Ok(None);
        }
        let ref_id = format!("{date}:{}", session_ids[0]);
        award(&tx, &NewEvent { kind: EventKind::SequenceCompleted, ref_id: &ref_id, local_date: date, session_id: Some(&session_ids[0]), attempt_id: None, created_at_ms: recording::now_ms() as i64, backfilled: false })?;
        let event = tx
            .query_row(&format!("SELECT {EVENT_COLUMNS} FROM practice_events WHERE kind=?1 AND ref_id=?2"), params![EventKind::SequenceCompleted.as_str(), ref_id], event_row)
            .optional()
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(event)
    }

    /// The facts snapshot (7.6). About six single-pass queries.
    pub fn practice_facts(&self, today: &str) -> Result<PracticeFacts> {
        let progression = self.list_progression_events()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let transcription_available: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM app_settings WHERE key=?1)", [crate::transcribe::CONFIG_KEY], |r| r.get(0))
            .map_err(db_error)?;

        let mut stmt = conn.prepare(
            "SELECT s.id,s.local_date,s.started_at_ms,e.type,s.content_id,s.tags,s.ease,s.focus,s.takeaway,s.status,s.outline_snapshot,s.preferred_take,\
             (SELECT COUNT(*) FROM attempts a WHERE a.step_id=st.id AND a.capture_state='saved' AND a.deleted_at_ms IS NULL),\
             (SELECT COALESCE(SUM(aa.duration_ms),0) FROM attempts a JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.step_id=st.id AND a.capture_state='saved' AND a.deleted_at_ms IS NULL),\
             tc.familiarity,tc.preparation_seconds,tc.target_seconds,tc.audience,tc.follow_up,s.activity_snapshot \
             FROM sessions s JOIN session_steps st ON st.session_id=s.id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version \
             LEFT JOIN task_conditions tc ON tc.attempt_id=(SELECT a.id FROM attempts a WHERE a.step_id=st.id ORDER BY a.ordinal LIMIT 1) \
             WHERE s.deleted_at_ms IS NULL ORDER BY s.started_at_ms,s.id",
        ).map_err(db_error)?;
        let sessions: Vec<FactSession> = stmt
            .query_map([], |r| {
                let outline: Option<String> = r.get(10)?;
                let outline = outline.and_then(|o| serde_json::from_str::<Value>(&o).ok()).unwrap_or(Value::Null);
                let part = |k: &str| outline[k].as_str().is_some_and(|t| !t.trim().is_empty());
                let tags: String = r.get(5)?;
                let audience: Option<String> = r.get(17)?;
                Ok(FactSession {
                    id: r.get(0)?,
                    local_date: r.get(1)?,
                    started_at: iso(r.get(2)?),
                    exercise_type: r.get(3)?,
                    content_id: r.get(4)?,
                    tags: serde_json::from_str(&tags).unwrap_or_default(),
                    ease: r.get(6)?,
                    focus: r.get(7)?,
                    takeaway: filled(&r.get(8)?),
                    status: r.get(9)?,
                    outline: [part("point"), part("reason"), part("example")],
                    preferred_take: r.get(11)?,
                    take_count: r.get(12)?,
                    duration_ms: u64::try_from(r.get::<_, i64>(13)?).unwrap_or(0),
                    familiarity: r.get(14)?,
                    preparation_seconds: r.get(15)?,
                    target_seconds: r.get(16)?,
                    audience: audience.is_some_and(|a| !a.trim().is_empty()),
                    follow_up: r.get::<_, Option<bool>>(18)?.unwrap_or(false),
                    activity: r.get::<_, Option<String>>(19)?.and_then(|s| serde_json::from_str(&s).ok()),
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?
            .into_iter()
            .filter(|s| s.take_count > 0 || s.status == "completed")
            .collect();

        // Measures of every take's newest machine revision, by revision.
        let mut metrics: HashMap<String, HashMap<String, Option<f64>>> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT ar.revision_id,mv.metric,mv.value FROM analysis_runs ar JOIN metric_values mv ON mv.run_id=ar.id WHERE ar.kind='transcript-measures' AND ar.definition_version=?1")
                .map_err(db_error)?;
            let rows = stmt
                .query_map([crate::analysis::DEFINITION_VERSION], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<f64>>(2)?)))
                .map_err(db_error)?;
            for row in rows {
                let (revision, metric, value) = row.map_err(db_error)?;
                metrics.entry(revision).or_default().insert(metric, value);
            }
        }
        let mut decisions: HashMap<String, (u32, u32)> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT revision_id,SUM(decision='confirmed'),COUNT(*) FROM annotations WHERE definition_version=?1 AND kind='filler' GROUP BY revision_id")
                .map_err(db_error)?;
            let rows = stmt
                .query_map([crate::analysis::FILLER_DEFINITION_VERSION], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?, r.get::<_, u32>(2)?)))
                .map_err(db_error)?;
            for row in rows {
                let (revision, confirmed, total) = row.map_err(db_error)?;
                decisions.insert(revision, (confirmed, total));
            }
        }
        let mut phrase_uses: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT u.attempt_id,u.phrase_id FROM phrase_uses u JOIN attempts a ON a.id=u.attempt_id JOIN phrase_cards p ON p.id=u.phrase_id \
                     WHERE p.deleted_at_ms IS NULL AND u.revision_id={} ORDER BY u.attempt_id,u.phrase_id",
                    super::insights::CURRENT_REVISION
                ))
                .map_err(db_error)?;
            for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(db_error)? {
                let (attempt, phrase) = row.map_err(db_error)?;
                phrase_uses.entry(attempt).or_default().push(phrase);
            }
        }
        let mut checks: HashMap<String, std::collections::BTreeMap<String, bool>> = HashMap::new();
        {
            let mut stmt = conn.prepare("SELECT attempt_id,check_id,value FROM self_checks").map_err(db_error)?;
            for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, bool>(2)?))).map_err(db_error)? {
                let (attempt, check, value) = row.map_err(db_error)?;
                checks.entry(attempt).or_default().insert(check, value);
            }
        }
        let mut stmt = conn.prepare(&format!(
            "SELECT a.id,st.session_id,a.ordinal,s.local_date,a.created_at_ms,aa.duration_ms,tc.challenge,\
             (SELECT r.id FROM transcript_revisions r WHERE r.attempt_id=a.id AND r.source<>'user' ORDER BY r.created_at_ms DESC,r.id DESC LIMIT 1),\
             EXISTS(SELECT 1 FROM prosody_tracks p WHERE p.attempt_id=a.id),EXISTS(SELECT 1 FROM coaching_runs c WHERE c.attempt_id=a.id),\
             (SELECT p.range_semitones FROM prosody_tracks p WHERE p.attempt_id=a.id AND p.algorithm=?1 AND p.definition_version=?2),\
             (SELECT m.rate_sps FROM audio_measures m WHERE m.attempt_id=a.id AND m.method=?3 AND m.definition_version=?4),\
             (SELECT ar.result FROM activity_results ar WHERE ar.attempt_id=a.id AND ar.definition_version=?5 AND ar.revision_id IS {}) \
             FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id JOIN audio_assets aa ON aa.id=a.asset_id \
             LEFT JOIN task_conditions tc ON tc.attempt_id=a.id \
             WHERE a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL ORDER BY a.created_at_ms,a.id",
            super::insights::CURRENT_REVISION
        )).map_err(db_error)?;
        let takes = stmt
            .query_map(params![crate::prosody::ALGORITHM, crate::prosody::DEFINITION_VERSION, crate::audio::syllables::METHOD, crate::audio::syllables::DEFINITION_VERSION, crate::activity_results::DEFINITION_VERSION], |r| {
                let id: String = r.get(0)?;
                let challenge: Option<String> = r.get(6)?;
                let revision: Option<String> = r.get(7)?;
                let measures = revision.as_ref().and_then(|id| metrics.get(id));
                let value = |key: &str| measures.and_then(|m| m.get(key).copied().flatten());
                let candidates = count(value("filler_candidates"));
                let (confirmed, decided) = revision.as_ref().and_then(|id| decisions.get(id).copied()).unwrap_or((0, 0));
                Ok(FactTake {
                    mean_run: value("mean_run_words"),
                    longest_run: count(value("longest_run_words")),
                    mid_clause_pauses: count(value("mid_clause_pauses")),
                    boundary_pauses: count(value("boundary_pauses")),
                    watch_per_100: value("watch_words_per_100"),
                    hedges_per_100: value("hedges_per_100"),
                    different_per_50: value("different_words_per_50"),
                    phrase_ids: phrase_uses.get(&id).cloned().unwrap_or_default(),
                    checks: checks.get(&id).cloned().unwrap_or_default(),
                    pitch_range_st: r.get(10)?,
                    rate_sps: r.get(11)?,
                    result: r.get::<_, Option<String>>(12)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()).map(|v| crate::activity_results::numbers(&v)),
                    id,
                    session_id: r.get(1)?,
                    ordinal: r.get(2)?,
                    local_date: r.get(3)?,
                    created_at: iso(r.get(4)?),
                    duration_ms: u64::try_from(r.get::<_, i64>(5)?).unwrap_or(0),
                    step_key: challenge.and_then(|c| serde_json::from_str::<Value>(&c).ok()).and_then(|c| c["key"].as_str().map(String::from)),
                    transcribed: revision.is_some(),
                    words: count(value("word_count")),
                    pace_wpm: value("pace_wpm"),
                    speech_span_ms: value("speech_span_ms").filter(|v| *v >= 0.0).map(|v| v as u64),
                    filler_candidates: candidates,
                    fillers_confirmed: revision.as_ref().map(|_| confirmed),
                    fillers_reviewed: revision.is_some() && candidates.is_some_and(|c| decided >= c),
                    pauses_over_threshold: count(value("pauses_over_threshold")),
                    revision_id: revision,
                    prosody_viewed: r.get(8)?,
                    has_ai_feedback: r.get(9)?,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;

        let mut stmt = conn
            .prepare("SELECT id,local_date,listener_text,clarification,success,next_focus,flow,tags FROM transfer_reviews WHERE deleted_at_ms IS NULL ORDER BY local_date,created_at_ms")
            .map_err(db_error)?;
        let transfer_reviews = stmt
            .query_map([], |r| {
                Ok(FactTransfer {
                    id: r.get(0)?,
                    local_date: r.get(1)?,
                    has_listener_words: filled(&r.get(2)?),
                    needed_clarification: filled(&r.get(3)?),
                    has_success: filled(&r.get(4)?),
                    has_next_focus: filled(&r.get(5)?),
                    flow: r.get(6)?,
                    tags: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let mut stmt = conn.prepare("SELECT id,created_at_ms,deleted_at_ms IS NOT NULL FROM phrase_cards ORDER BY created_at_ms,id").map_err(db_error)?;
        let phrases = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(FactPhrase { starter: id.starts_with("phrase-starter-"), id, created_at: iso(r.get(1)?), deleted: r.get(2)? })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let mut stmt = conn.prepare("SELECT card_id,reviewed_at_ms,rating FROM phrase_reviews ORDER BY reviewed_at_ms,id").map_err(db_error)?;
        let phrase_reviews = stmt
            .query_map([], |r| Ok(FactPhraseReview { card_id: r.get(0)?, local_date: local_date(r.get(1)?), rating: r.get(2)? }))
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(PracticeFacts {
            facts_version: FACTS_VERSION,
            generated_at: iso(recording::now_ms() as i64),
            today: today.into(),
            transcription_available,
            user_prompts: count_rows(&conn, "SELECT count(*) FROM user_prompts WHERE deleted_at_ms IS NULL")?,
            blind_comparisons: count_rows(&conn, "SELECT count(*) FROM comparisons WHERE blind=1")?,
            sessions,
            takes,
            transfer_reviews,
            phrases,
            phrase_reviews,
            progression,
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::storage::database::{Conditions, Outline, PracticeContext};
    use crate::storage::recording::{tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
    use std::path::Path;

    fn audio(root: &Path, id: &str, seconds: u32) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for _ in 0..(48_000 * seconds) {
            w.push(1000).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }

    pub(crate) fn context(session: &str, familiarity: &str, outline: [&str; 3]) -> PracticeContext {
        PracticeContext {
            session_id: session.into(),
            exercise_id: "ex-repeat".into(),
            exercise_version: 1,
            exercise_type: "repeat".into(),
            prompt: format!("Prompt for {session}"),
            outline: Outline { point: outline[0].into(), reason: outline[1].into(), example: outline[2].into() },
            conditions: Conditions { familiarity: familiarity.into(), preparation_seconds: 15, target_seconds: 60, audience: None, follow_up: false },
            curriculum_version: Some(1),
            content_id: Some("p-habit".into()),
            activity: None,
            step: None,
        }
    }

    fn record(db: &DatabaseOwner, root: &Path, session: &str, id: &str, seconds: u32) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(&context(session, "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(root, id, seconds)).unwrap();
    }

    fn of_kind<'a>(events: &'a [PracticeEvent], kind: &str) -> Vec<&'a PracticeEvent> {
        events.iter().filter(|e| e.kind == kind).collect()
    }

    fn transcribe(db: &DatabaseOwner, take: &str, text: &str) -> String {
        let transcript = crate::audio::whisper::Transcript {
            version: 1, run_id: format!("{take}--1"), asset_id: take.into(), provider: "whisper.cpp".into(),
            model_id: "base".into(), model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(),
            backend: crate::audio::whisper::Backend::Cpu, threads: 4, prompt: None, source_sha256: "b".repeat(64),
            prepared_sha256: "c".repeat(64), language: "en".into(), raw_text: text.into(),
            segments: vec![crate::audio::whisper::Segment { text: text.into(), start_ms: Some(0), end_ms: Some(20_000), timing_source: "Estimated".into(), timing_unavailable_reason: None }],
            elapsed_ms: 10, peak_ram_bytes: None, peak_ram_unavailable_reason: None, created_at_ms: 1,
        };
        db.start_job(&format!("job-{take}"), take, 1).unwrap();
        db.save_local_transcript(&format!("job-{take}"), take, &transcript, 2).unwrap();
        format!("{take}--1")
    }

    const WORDS: &str = "Um so the first thing I do every morning is open the window and then I make a cup of tea, uh, before I check any messages at all because it helps me think";

    fn phrase_text() -> super::super::phrases::PhraseText<'static> {
        super::super::phrases::PhraseText { original: "at the end", expression: "in the end", explanation: "", examples: &[] }
    }

    #[test]
    fn take_awards_follow_duration_and_ordinal_rules() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 12);
        record(&db, &root.0, "s", "t2", 9);
        record(&db, &root.0, "s", "t3", 10);
        let events = db.list_practice_events(None).unwrap();
        let takes: Vec<&str> = of_kind(&events, "take_saved").iter().map(|e| e.ref_id.as_str()).collect();
        assert_eq!(takes, ["t1", "t3"], "under ten seconds earns nothing");
        let retakes: Vec<&str> = of_kind(&events, "retake").iter().map(|e| e.ref_id.as_str()).collect();
        assert_eq!(retakes, ["t3"]);
        let session_date: String = db.get_session("s").unwrap()["localDate"].as_str().unwrap().into();
        assert!(events.iter().all(|e| e.local_date == session_date && !e.backfilled && e.session_id.as_deref() == Some("s")));
        assert_eq!(events.iter().map(|e| e.xp).sum::<u32>(), 25);
    }

    #[test]
    fn award_is_idempotent_for_the_same_kind_and_ref() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 10);
        // Receipts are reconciled on every start; that must never add a second award.
        drop(db);
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.commit_recording(&recording::read_saved(&root.0, "t1").unwrap().unwrap()).unwrap();
        assert_eq!(of_kind(&db.list_practice_events(None).unwrap(), "take_saved").len(), 1);
        let conn = db.connection.lock().unwrap();
        let event = NewEvent { kind: EventKind::TransferReview, ref_id: "r1", local_date: "2026-10-12", session_id: None, attempt_id: None, created_at_ms: 1, backfilled: false };
        assert!(award(&conn, &event).unwrap());
        assert!(!award(&conn, &event).unwrap());
    }

    #[test]
    fn phrase_review_cap_records_events_but_stops_xp_after_ten_a_day() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 12).unwrap();
        let card = db.add_phrase(&phrase_text(), None, today).unwrap();
        for _ in 0..12 {
            db.review_phrase(&card.id, "good", today).unwrap();
        }
        let events = db.list_practice_events(None).unwrap();
        let reviews = of_kind(&events, "phrase_reviewed");
        assert_eq!(reviews.len(), 12, "every review is recorded");
        assert_eq!(reviews.iter().filter(|e| e.xp == 2).count(), 10);
        assert_eq!(reviews.iter().filter(|e| e.xp == 0).count(), 2);
        assert_eq!(of_kind(&events, "phrase_saved")[0].xp, 5);
        assert!(reviews.iter().all(|e| e.local_date == "2026-10-12"));
    }

    #[test]
    fn transcript_reviewed_only_when_every_candidate_has_a_decision() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 10);
        let revision = transcribe(&db, "t1", WORDS);
        db.set_filler_decision(&revision, 0, "um", Some("confirmed"), 10).unwrap();
        assert!(of_kind(&db.list_practice_events(None).unwrap(), "transcript_reviewed").is_empty(), "one of two decided");
        db.set_filler_decision(&revision, 1, "uh", Some("dismissed"), 11).unwrap();
        db.set_filler_decision(&revision, 1, "uh", Some("confirmed"), 12).unwrap();
        let reviewed = of_kind(&db.list_practice_events(None).unwrap(), "transcript_reviewed").len();
        assert_eq!(reviewed, 1, "awarded once, however often you change your mind");
    }

    #[test]
    fn reflections_baselines_transfers_and_sequences_award_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 10);
        db.set_session_reflection("s", Some(4), None).unwrap();
        db.set_session_reflection("s", None, Some("Pause before the example")).unwrap();
        db.update_session("s", "Baseline", "", &["baseline".into()], false).unwrap();
        db.update_session("s", "Baseline", "note", &["baseline".into()], true).unwrap();
        let review = db
            .add_transfer_review(&super::super::transfer::TransferInput {
                local_date: "2026-10-10".into(),
                situation: "Explained my job".into(),
                preparation: String::new(),
                listener_text: String::new(),
                clarification: String::new(),
                success: String::new(),
                self_report: String::new(),
                next_focus: String::new(),
                flow: None,
                tags: Vec::new(),
            })
            .unwrap();
        assert!(db.record_sequence_completed(&["missing".into()], "2026-10-12").unwrap().is_none(), "no take, no event");
        let first = db.record_sequence_completed(&["s".into()], "2026-10-12").unwrap().unwrap();
        let again = db.record_sequence_completed(&["s".into()], "2026-10-12").unwrap().unwrap();
        assert_eq!((first.id, first.xp), (again.id, 20));
        assert!(db.record_sequence_completed(&[], "2026-10-12").is_err());
        assert!(db.record_sequence_completed(&["s".into()], "12/10/2026").is_err());
        let events = db.list_practice_events(None).unwrap();
        assert_eq!(of_kind(&events, "reflection_saved").len(), 1);
        assert_eq!(of_kind(&events, "baseline_saved").len(), 1);
        let transfer = of_kind(&events, "transfer_review");
        assert_eq!((transfer.len(), transfer[0].ref_id.as_str(), transfer[0].local_date.as_str()), (1, review.id.as_str(), "2026-10-10"));
        assert_eq!(db.list_practice_events(Some("2026-10-11")).unwrap().iter().filter(|e| e.kind == "transfer_review").count(), 0);
        assert!(db.list_practice_events(Some("yesterday")).is_err());
    }

    #[test]
    fn events_survive_trash_and_permanent_deletion() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 10);
        record(&db, &root.0, "s", "t2", 10);
        db.move_take_to_trash("t2", 5).unwrap();
        db.delete_takes_permanently(&["t2".into()]).unwrap();
        db.move_to_trash("s", 6).unwrap();
        db.delete_permanently(&["s".into()]).unwrap();
        let events = db.list_practice_events(None).unwrap();
        assert_eq!(of_kind(&events, "take_saved").len(), 2, "effort is never taken away (A-28)");
        assert_eq!(events.iter().map(|e| e.xp).sum::<u32>(), 25);
    }

    #[test]
    fn events_hold_ids_and_numbers_only() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 10);
        let revision = transcribe(&db, "t1", WORDS);
        db.set_filler_decision(&revision, 0, "um", Some("confirmed"), 10).unwrap();
        db.set_filler_decision(&revision, 1, "uh", Some("confirmed"), 10).unwrap();
        db.set_session_reflection("s", Some(3), Some("A private takeaway")).unwrap();
        let conn = db.connection.lock().unwrap();
        let rows: Vec<(String, String)> = conn
            .prepare("SELECT ref_id,data FROM practice_events")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(rows.len() >= 3);
        for (ref_id, data) in rows {
            assert!(ref_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b)), "{ref_id}");
            assert_eq!(data, "{}");
        }
    }

    #[test]
    fn backfill_runs_once_marks_rows_and_respects_caps() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "s", "t1", 12);
        record(&db, &root.0, "s", "t2", 12);
        db.move_take_to_trash("t2", 5).unwrap();
        db.set_session_reflection("s", Some(4), None).unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 12).unwrap();
        let card = db.add_phrase(&phrase_text(), None, today).unwrap();
        for _ in 0..12 {
            db.review_phrase(&card.id, "good", today).unwrap();
        }
        let sorted = |mut v: Vec<(String, String, u32)>| {
            v.sort();
            v
        };
        let live = sorted(db.list_practice_events(None).unwrap().into_iter().map(|e| (e.kind, e.ref_id, e.xp)).collect());
        {
            let conn = db.connection.lock().unwrap();
            conn.execute_batch("DELETE FROM practice_events; DELETE FROM app_settings WHERE key='engagement_backfill_v1';").unwrap();
        }
        drop(db);
        let db = DatabaseOwner::open(&root.0).unwrap();
        let events = db.list_practice_events(None).unwrap();
        assert!(events.iter().all(|e| e.backfilled), "history is marked so nothing celebrates it");
        let rebuilt = sorted(events.iter().map(|e| (e.kind.clone(), e.ref_id.clone(), e.xp)).collect());
        // The phrase reviews' local dates come from the clock in the backfill
        // (12 Oct in the live run), so compare kinds, references and XP only.
        assert_eq!(rebuilt, live, "the backfill awards what live play awarded, the take in Trash included");
        drop(db);
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(db.list_practice_events(None).unwrap().len(), events.len(), "runs once");
    }

    #[test]
    fn facts_include_only_saved_untrashed_takes_and_their_current_revision_measures() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.reserve("t1", "op-t1", "Take", Some(&context("s", "unfamiliar", ["Point", "", "Example"]))).unwrap();
        db.commit_recording(&audio(&root.0, "t1", 2)).unwrap();
        db.reserve("t2", "op-t2", "Take", Some(&context("s", "unfamiliar", ["Point", "", "Example"]))).unwrap();
        db.commit_recording(&audio(&root.0, "t2", 1)).unwrap();
        record(&db, &root.0, "gone", "t3", 1);
        db.move_take_to_trash("t2", 5).unwrap();
        db.move_to_trash("gone", 6).unwrap();
        let revision = transcribe(&db, "t1", WORDS);
        db.set_filler_decision(&revision, 0, "um", Some("confirmed"), 10).unwrap();
        let facts = db.practice_facts("2026-10-12").unwrap();
        assert_eq!((facts.facts_version, facts.today.as_str(), facts.transcription_available), (FACTS_VERSION, "2026-10-12", false));
        assert_eq!(facts.sessions.len(), 1, "a session in Trash is left out");
        let s = &facts.sessions[0];
        assert_eq!((s.id.as_str(), s.exercise_type.as_deref(), s.familiarity.as_deref(), s.preparation_seconds), ("s", Some("repeat"), Some("unfamiliar"), Some(15)));
        assert_eq!(s.outline, [true, false, true], "from the outline");
        assert_eq!((s.take_count, s.duration_ms), (1, 2000), "the take in Trash is left out");
        assert_eq!(facts.takes.len(), 1);
        let t = &facts.takes[0];
        assert_eq!((t.id.as_str(), t.transcribed, t.revision_id.as_deref()), ("t1", true, Some(revision.as_str())));
        assert_eq!((t.filler_candidates, t.fillers_confirmed, t.fillers_reviewed), (Some(2), Some(1), false));
        assert!(t.words.is_some_and(|w| w > 20) && t.pace_wpm.is_some(), "{t:?}");
        db.set_filler_decision(&revision, 1, "uh", Some("dismissed"), 11).unwrap();
        assert!(db.practice_facts("2026-10-12").unwrap().takes[0].fillers_reviewed);
    }

    #[test]
    fn facts_agree_with_session_and_transcript_views() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        record(&db, &root.0, "a", "a1", 1);
        record(&db, &root.0, "a", "a2", 2);
        record(&db, &root.0, "b", "b1", 1);
        transcribe(&db, "a2", WORDS);
        let facts = db.practice_facts("2026-10-12").unwrap();
        assert_eq!(facts.sessions.len(), 2);
        for session in &facts.sessions {
            let detail = db.get_session(&session.id).unwrap();
            assert_eq!(u64::from(session.take_count), detail["attempts"].as_array().unwrap().len() as u64);
            assert_eq!(session.duration_ms, detail["durationMs"].as_u64().unwrap());
        }
        let view = db.attempt_transcript("a2").unwrap();
        let take = facts.takes.iter().find(|t| t.id == "a2").unwrap();
        assert_eq!(take.pace_wpm, view["revision"]["measures"]["paceWpm"].as_f64());
        assert_eq!(take.words, view["revision"]["measures"]["wordCount"].as_u64().map(|w| w as u32));
    }

    /// Realistic history written straight into the tables, for facts and
    /// performance tests: one session a day with `takes_per_day` saved takes,
    /// each transcribed with stored measures. The audio files don't exist.
    pub(crate) fn seed_history(db: &DatabaseOwner, days: u32, takes_per_day: u32) {
        let mut conn = db.connection.lock().unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute("INSERT OR IGNORE INTO exercise_definitions(id,version,type) VALUES ('ex-repeat',1,'repeat')", []).unwrap();
        let start = chrono::NaiveDate::from_ymd_opt(2024, 10, 1).unwrap();
        for day in 0..days {
            let date = (start + chrono::Duration::days(i64::from(day))).format("%Y-%m-%d").to_string();
            let at = 1_727_740_800_000_i64 + i64::from(day) * 86_400_000;
            let session = format!("seed-{day}");
            let outline = r#"{"point":"P","reason":"","example":"E"}"#;
            tx.execute(
                "INSERT INTO sessions(id,profile_id,title,local_date,timezone_offset_seconds,started_at_ms,status,prompt_snapshot,outline_snapshot,ease) VALUES (?1,'local','Seeded',?2,0,?3,'completed','Prompt',?4,3)",
                params![session, date, at, outline],
            )
            .unwrap();
            tx.execute("INSERT INTO session_steps(id,session_id,exercise_id,exercise_version,position,status) VALUES (?1,?2,'ex-repeat',1,1,'completed')", params![format!("step-{session}"), session]).unwrap();
            for n in 1..=takes_per_day {
                let take = format!("seed-{day}-{n}");
                let revision = format!("{take}--1");
                tx.execute(
                    "INSERT INTO audio_assets(id,relative_path,sha256,bytes,sample_rate,channels,duration_ms) VALUES (?1,?2,?3,96044,48000,1,60000)",
                    params![take, format!("recordings/{take}/audio.wav"), "e".repeat(64)],
                )
                .unwrap();
                tx.execute(
                    "INSERT INTO attempts(id,step_id,repetition_group_id,ordinal,capture_state,asset_id,created_at_ms,idempotency_key,request_snapshot) VALUES (?1,?2,?3,?4,'saved',?1,?5,?6,'{}')",
                    params![take, format!("step-{session}"), session, n, at + i64::from(n) * 120_000, format!("op-{take}")],
                )
                .unwrap();
                tx.execute(
                    "INSERT INTO task_conditions(attempt_id,familiarity,preparation_seconds,target_seconds,follow_up) VALUES (?1,?2,15,60,0)",
                    params![take, if day % 3 == 0 { "unfamiliar" } else { "familiar" }],
                )
                .unwrap();
                tx.execute("INSERT INTO transcript_revisions(id,attempt_id,source,text,created_at_ms) VALUES (?1,?2,'local','Seeded words',?3)", params![revision, take, at]).unwrap();
                let run = format!("{revision}--measures-v{}", crate::analysis::DEFINITION_VERSION);
                tx.execute(
                    "INSERT INTO analysis_runs(id,attempt_id,revision_id,kind,definition_version,settings,created_at_ms) VALUES (?1,?2,?3,'transcript-measures',?4,'{}',?5)",
                    params![run, take, revision, crate::analysis::DEFINITION_VERSION, at],
                )
                .unwrap();
                for (metric, value, unit) in [
                    ("word_count", 130.0, "words"), ("filler_candidates", 4.0, "words"), ("repeated_words", 1.0, "words"), ("speech_span_ms", 58_000.0, "ms"),
                    ("pace_wpm", 134.5, "words/min"), ("pauses_over_threshold", 3.0, "pauses"), ("mean_run_words", 7.5, "words"), ("longest_run_words", 18.0, "words"),
                    ("mid_clause_pauses", 1.0, "pauses"), ("boundary_pauses", 2.0, "pauses"), ("watch_words_per_100", 1.5, "per 100 words"),
                    ("hedges_per_100", 2.3, "per 100 words"), ("different_words_per_50", 36.2, "words"),
                ] {
                    tx.execute("INSERT INTO metric_values(run_id,metric,value,unit,source) VALUES (?1,?2,?3,?4,'Estimated')", params![run, metric, value, unit]).unwrap();
                }
            }
        }
        tx.commit().unwrap();
    }

    #[test]
    fn seeded_history_reads_back_as_facts() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        seed_history(&db, 5, 3);
        let facts = db.practice_facts("2026-10-12").unwrap();
        assert_eq!((facts.sessions.len(), facts.takes.len()), (5, 15));
        assert!(facts.takes.iter().all(|t| t.transcribed && t.pace_wpm == Some(134.5) && t.filler_candidates == Some(4)));
        assert_eq!(facts.sessions[0].outline, [true, false, true]);
    }

    /// A-36: two years of daily practice (730 sessions, 4 takes a day).
    #[test]
    #[ignore = "benchmark: cargo test --lib --release -- --ignored practice_facts_two_years"]
    fn practice_facts_two_years_under_80ms() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        seed_history(&db, 730, 4);
        let _ = db.practice_facts("2026-10-12").unwrap();
        let started = std::time::Instant::now();
        let facts = db.practice_facts("2026-10-12").unwrap();
        let elapsed = started.elapsed();
        println!("practice_facts: {} sessions, {} takes in {elapsed:?}", facts.sessions.len(), facts.takes.len());
        assert_eq!(facts.takes.len(), 2920);
        assert!(elapsed.as_millis() <= 80, "{elapsed:?}");
    }

    /// The interface parses facts with strict schemas; its fixture
    /// (src/lib/ipc/fixtures/facts-v4.json) must have exactly these fields.
    #[test]
    fn facts_serialize_with_the_same_fields_as_the_interface_fixture() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.reserve("t1", "op-t1", "Take", Some(&context("s", "unfamiliar", ["P", "", "E"]))).unwrap();
        db.commit_recording(&audio(&root.0, "t1", 1)).unwrap();
        db.add_transfer_review(&super::super::transfer::TransferInput {
            local_date: "2026-10-14".into(), situation: "Explained my job".into(), preparation: String::new(), listener_text: "Your job sounds fun".into(),
            clarification: String::new(), success: String::new(), self_report: String::new(), next_focus: String::new(), flow: Some("smooth".into()), tags: vec!["story".into()],
        }).unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 16).unwrap();
        let card = db.add_phrase(&phrase_text(), None, today).unwrap();
        db.review_phrase(&card.id, "good", today).unwrap();
        db.record_progression("advance", "Three sessions").unwrap();
        let actual = serde_json::to_value(db.practice_facts("2026-10-16").unwrap()).unwrap();
        let fixture: Value = serde_json::from_str(include_str!("../../../src/lib/ipc/fixtures/facts-v4.json")).unwrap();
        let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(keys(&actual), keys(&fixture));
        for list in ["sessions", "takes", "transferReviews", "phrases", "phraseReviews", "progression"] {
            assert_eq!(keys(&actual[list][0]), keys(&fixture[list][0]), "{list}");
        }
        assert_eq!(actual["factsVersion"], fixture["factsVersion"]);
        assert_eq!(actual["sessions"][0]["outline"], serde_json::json!([true, false, true]));
    }
}
