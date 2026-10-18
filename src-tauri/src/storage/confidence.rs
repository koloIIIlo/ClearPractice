//! The confidence pack (roadmap M12): your exposure ladder (12.2), pre-talk
//! routine runs (12.3), sentences you liked (12.5) and the week's best moments
//! (12.5). Ratings and notes are your own (Your note) and are never measured
//! from your voice. Nothing here leaves this computer (A-32).
use super::engagement::{award, local_date};
use super::{db_error, iso, DatabaseOwner, Result};
use crate::engagement::{EventKind, NewEvent};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// A ladder holds up to this many steps.
pub const MAX_STEPS: usize = 30;
/// An attempt is planned (a before rating only), done, done in part, or not done this time.
pub const OUTCOMES: [&str; 4] = ["planned", "yes", "partly", "not_this_time"];
/// The routine's steps (content in `src/content/routine.ts`).
pub const ROUTINE_STEPS: [&str; 5] = ["breathe", "warm_up", "reframe", "unload", "encourage"];
/// The reel shows at most this many sentences.
pub const MAX_MOMENTS: usize = 3;
/// Sentences the rules may pick have this many words.
const MOMENT_WORDS: std::ops::RangeInclusive<usize> = 8..=25;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureStep {
    pub id: String,
    pub position: u32,
    pub title: String,
    pub template_id: Option<String>,
    pub created_at: String,
}

/// One step of the ladder as you save it: an existing step keeps its ID.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub template_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureAttempt {
    pub id: String,
    pub step_id: String,
    pub local_date: String,
    pub before_rating: Option<u8>,
    pub after_rating: Option<u8>,
    pub outcome: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptInput {
    pub step_id: String,
    /// The day you did it (or plan to), on the local calendar.
    pub local_date: String,
    #[serde(default)]
    pub before_rating: Option<u8>,
    #[serde(default)]
    pub after_rating: Option<u8>,
    pub outcome: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRun {
    pub id: String,
    pub local_date: String,
    pub steps: Vec<String>,
    pub kept_note: Option<String>,
    pub event_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutineInput {
    pub steps: Vec<String>,
    /// The worry text, only when you chose to keep it.
    #[serde(default)]
    pub kept_note: Option<String>,
    #[serde(default)]
    pub event_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMark {
    pub revision_id: String,
    pub segment: u32,
    pub kind: String,
}

/// A sentence for the week's reel: your take's own segment and its stored
/// segment times, never manufactured word times (§11).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moment {
    pub attempt_id: String,
    pub session_id: String,
    pub ordinal: u32,
    pub revision_id: String,
    pub segment: u32,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub local_date: String,
    /// You liked it; otherwise the rules picked it.
    pub liked: bool,
}

fn key_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn valid_date(date: &str) -> Result<()> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map(|_| ()).map_err(|_| "Choose a day.".to_string())
}

const ATTEMPT_COLUMNS: &str = "id,step_id,local_date,before_rating,after_rating,outcome,note,created_at_ms";

fn attempt_row(r: &rusqlite::Row) -> rusqlite::Result<ExposureAttempt> {
    Ok(ExposureAttempt {
        id: r.get(0)?,
        step_id: r.get(1)?,
        local_date: r.get(2)?,
        before_rating: r.get(3)?,
        after_rating: r.get(4)?,
        outcome: r.get(5)?,
        note: r.get(6)?,
        created_at: iso(r.get(7)?),
    })
}

impl AttemptInput {
    fn validate(&self) -> Result<()> {
        recording::validate_id(&self.step_id)?;
        valid_date(&self.local_date)?;
        if !OUTCOMES.contains(&self.outcome.as_str()) {
            return Err("Choose whether you did it from the list.".into());
        }
        if [self.before_rating, self.after_rating].iter().any(|r| r.is_some_and(|v| v > 10)) {
            return Err("Discomfort is rated from 0 to 10.".into());
        }
        if self.outcome == "planned" && (self.before_rating.is_none() || self.after_rating.is_some()) {
            return Err("A plan has a before rating only.".into());
        }
        if self.note.chars().count() > 1000 || self.note.contains('\0') {
            return Err("Keep the note under 1,000 characters.".into());
        }
        Ok(())
    }
}

/// A fresh ID for a row of `table`: the time, then a counter if it is taken.
fn fresh_id(conn: &rusqlite::Connection, table: &str, prefix: &str, now: i64) -> Result<String> {
    for n in 0..1000u32 {
        let candidate = if n == 0 { format!("{prefix}-{now}") } else { format!("{prefix}-{now}-{n}") };
        let taken: bool = conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [&candidate], |r| r.get(0)).map_err(db_error)?;
        if !taken {
            return Ok(candidate);
        }
    }
    Err("Could not create an ID.".into())
}

impl DatabaseOwner {
    /// Your ladder, lowest step first (deleted steps are left out).
    pub fn list_exposure_steps(&self) -> Result<Vec<ExposureStep>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,position,title,template_id,created_at_ms FROM exposure_steps WHERE deleted_at_ms IS NULL ORDER BY position,created_at_ms")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok(ExposureStep { id: r.get(0)?, position: r.get(1)?, title: r.get(2)?, template_id: r.get(3)?, created_at: iso(r.get(4)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Saves the whole ladder in order (12.2): existing steps are renamed and
    /// moved, new ones added, and steps left out are deleted softly, so their
    /// attempts stay with your history.
    pub fn save_exposure_steps(&self, steps: &[StepInput]) -> Result<Vec<ExposureStep>> {
        if steps.len() > MAX_STEPS {
            return Err("A ladder has up to 30 steps.".into());
        }
        let mut seen = HashSet::new();
        for s in steps {
            let chars = s.title.trim().chars().count();
            if !(3..=160).contains(&chars) || s.title.chars().any(char::is_control) {
                return Err("Give each step a short line of 3 to 160 characters.".into());
            }
            if s.template_id.as_deref().is_some_and(|t| !key_id(t)) {
                return Err("Unknown template.".into());
            }
            if let Some(id) = &s.id {
                recording::validate_id(id)?;
                if !seen.insert(id.clone()) {
                    return Err("A step appears twice.".into());
                }
            }
        }
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let now = recording::now_ms() as i64;
            let existing: HashSet<String> = tx
                .prepare("SELECT id FROM exposure_steps WHERE deleted_at_ms IS NULL")
                .map_err(db_error)?
                .query_map([], |r| r.get(0))
                .map_err(db_error)?
                .collect::<rusqlite::Result<_>>()
                .map_err(db_error)?;
            for (i, s) in steps.iter().enumerate() {
                let position = i as i64 + 1;
                match &s.id {
                    Some(id) if existing.contains(id) => {
                        tx.execute("UPDATE exposure_steps SET position=?2,title=?3 WHERE id=?1", params![id, position, s.title.trim()]).map_err(db_error)?;
                    }
                    Some(_) => return Err("This step no longer exists. Reopen the ladder and try again.".into()),
                    None => {
                        let id = fresh_id(&tx, "exposure_steps", "step", now)?;
                        tx.execute(
                            "INSERT INTO exposure_steps(id,position,title,template_id,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
                            params![id, position, s.title.trim(), s.template_id, now],
                        )
                        .map_err(db_error)?;
                    }
                }
            }
            for id in existing.difference(&seen) {
                tx.execute("UPDATE exposure_steps SET deleted_at_ms=?2 WHERE id=?1", params![id, now]).map_err(db_error)?;
            }
            tx.commit().map_err(db_error)?;
        }
        self.list_exposure_steps()
    }

    /// Attempts of one step, or of all, oldest first (deleted ones are left out).
    pub fn list_exposure_attempts(&self, step_id: Option<&str>) -> Result<Vec<ExposureAttempt>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {ATTEMPT_COLUMNS} FROM exposure_attempts WHERE deleted_at_ms IS NULL AND (?1 IS NULL OR step_id=?1) ORDER BY local_date,created_at_ms,id"))
            .map_err(db_error)?;
        let rows = stmt.query_map([step_id], attempt_row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    fn award_exposure(conn: &rusqlite::Connection, attempt: &ExposureAttempt) -> Result<()> {
        if matches!(attempt.outcome.as_str(), "yes" | "partly") {
            let now = recording::now_ms() as i64;
            award(conn, &NewEvent { kind: EventKind::ExposureStep, ref_id: &attempt.id, local_date: &attempt.local_date, session_id: None, attempt_id: None, created_at_ms: now, backfilled: false })?;
        }
        Ok(())
    }

    /// A plan (before rating) or an attempt you made. Done, fully or in part,
    /// earns `exposure_step` once (30 XP); "Not this time" is fine and earns nothing.
    pub fn add_exposure_attempt(&self, input: &AttemptInput) -> Result<ExposureAttempt> {
        input.validate()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let active: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM exposure_steps WHERE id=?1 AND deleted_at_ms IS NULL)", [&input.step_id], |r| r.get(0))
            .map_err(db_error)?;
        if !active {
            return Err("This step is no longer on your ladder.".into());
        }
        let now = recording::now_ms() as i64;
        let id = fresh_id(&tx, "exposure_attempts", "exposure", now)?;
        tx.execute(
            "INSERT INTO exposure_attempts(id,step_id,local_date,before_rating,after_rating,outcome,note,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![id, input.step_id, input.local_date, input.before_rating, input.after_rating, input.outcome, input.note.trim(), now],
        )
        .map_err(db_error)?;
        let saved = tx.query_row(&format!("SELECT {ATTEMPT_COLUMNS} FROM exposure_attempts WHERE id=?1"), [&id], attempt_row).map_err(db_error)?;
        Self::award_exposure(&tx, &saved)?;
        tx.commit().map_err(db_error)?;
        Ok(saved)
    }

    /// Completes a plan or corrects an attempt; it stays on its step.
    pub fn update_exposure_attempt(&self, id: &str, input: &AttemptInput) -> Result<ExposureAttempt> {
        recording::validate_id(id)?;
        input.validate()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let step: String = tx
            .query_row("SELECT step_id FROM exposure_attempts WHERE id=?1 AND deleted_at_ms IS NULL", [id], |r| r.get(0))
            .optional()
            .map_err(db_error)?
            .ok_or("This attempt no longer exists.")?;
        if step != input.step_id {
            return Err("An attempt stays on its own step.".into());
        }
        tx.execute(
            "UPDATE exposure_attempts SET local_date=?2,before_rating=?3,after_rating=?4,outcome=?5,note=?6 WHERE id=?1",
            params![id, input.local_date, input.before_rating, input.after_rating, input.outcome, input.note.trim()],
        )
        .map_err(db_error)?;
        let saved = tx.query_row(&format!("SELECT {ATTEMPT_COLUMNS} FROM exposure_attempts WHERE id=?1"), [id], attempt_row).map_err(db_error)?;
        Self::award_exposure(&tx, &saved)?;
        tx.commit().map_err(db_error)?;
        Ok(saved)
    }

    /// Removes an attempt from the ladder; effort earned stays (A-28).
    pub fn delete_exposure_attempt(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let n = conn
            .execute("UPDATE exposure_attempts SET deleted_at_ms=?2 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, recording::now_ms() as i64])
            .map_err(db_error)?;
        if n != 1 {
            return Err("This attempt no longer exists.".into());
        }
        Ok(())
    }

    /// A finished pre-talk routine (12.3): which steps you did, and the worry
    /// note only if you kept it. Earns `routine` (10 XP).
    pub fn save_routine_run(&self, input: &RoutineInput) -> Result<RoutineRun> {
        let mut steps: Vec<String> = Vec::new();
        for step in &input.steps {
            if !ROUTINE_STEPS.contains(&step.as_str()) {
                return Err("Unknown routine step.".into());
            }
            if !steps.contains(step) {
                steps.push(step.clone());
            }
        }
        if steps.is_empty() {
            return Err("Do at least one step of the routine.".into());
        }
        let note = input.kept_note.as_deref().map(str::trim).filter(|n| !n.is_empty());
        if note.is_some_and(|n| n.chars().count() > 4000 || n.contains('\0')) {
            return Err("Keep the note under 4,000 characters.".into());
        }
        if let Some(event) = &input.event_id {
            recording::validate_id(event)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let now = recording::now_ms() as i64;
        let id = fresh_id(&tx, "routine_runs", "routine", now)?;
        let date = local_date(now);
        tx.execute(
            "INSERT INTO routine_runs(id,local_date,steps,kept_note,event_id,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, date, serde_json::to_string(&steps).map_err(|e| e.to_string())?, note, input.event_id, now],
        )
        .map_err(db_error)?;
        award(&tx, &NewEvent { kind: EventKind::Routine, ref_id: &id, local_date: &date, session_id: None, attempt_id: None, created_at_ms: now, backfilled: false })?;
        tx.commit().map_err(db_error)?;
        Ok(RoutineRun { id, local_date: date, steps, kept_note: note.map(String::from), event_id: input.event_id.clone(), created_at: iso(now) })
    }

    /// Removes a routine run and the note you kept with it; effort earned stays (A-28).
    pub fn delete_routine_run(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let n = conn
            .execute("UPDATE routine_runs SET deleted_at_ms=?2 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, recording::now_ms() as i64])
            .map_err(db_error)?;
        if n != 1 {
            return Err("This routine is no longer listed.".into());
        }
        Ok(())
    }

    /// Routine runs, newest first (removed ones are left out).
    pub fn list_routine_runs(&self) -> Result<Vec<RoutineRun>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,local_date,steps,kept_note,event_id,created_at_ms FROM routine_runs WHERE deleted_at_ms IS NULL ORDER BY created_at_ms DESC,id DESC")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                let steps: String = r.get(2)?;
                Ok(RoutineRun { id: r.get(0)?, local_date: r.get(1)?, steps: serde_json::from_str(&steps).unwrap_or_default(), kept_note: r.get(3)?, event_id: r.get(4)?, created_at: iso(r.get(5)?) })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Likes or unlikes one sentence of a machine transcript (12.5).
    pub fn set_segment_mark(&self, revision_id: &str, segment: u32, liked: bool) -> Result<()> {
        recording::validate_id(revision_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let segments: i64 = conn
            .query_row(
                "SELECT count(*) FROM transcript_segments ts JOIN transcript_revisions tr ON tr.id=ts.revision_id JOIN attempts a ON a.id=tr.attempt_id \
                 WHERE ts.revision_id=?1 AND tr.source<>'user' AND a.deleted_at_ms IS NULL",
                [revision_id],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if i64::from(segment) >= segments {
            return Err("This sentence is no longer in the transcript.".into());
        }
        if liked {
            conn.execute(
                "INSERT OR IGNORE INTO segment_marks(revision_id,segment,kind,created_at_ms) VALUES (?1,?2,'liked',?3)",
                params![revision_id, segment, recording::now_ms() as i64],
            )
            .map_err(db_error)?;
        } else {
            conn.execute("DELETE FROM segment_marks WHERE revision_id=?1 AND segment=?2 AND kind='liked'", params![revision_id, segment]).map_err(db_error)?;
        }
        Ok(())
    }

    /// Sentences you liked in any revision of one take.
    pub fn list_segment_marks(&self, attempt_id: &str) -> Result<Vec<SegmentMark>> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT m.revision_id,m.segment,m.kind FROM segment_marks m JOIN transcript_revisions tr ON tr.id=m.revision_id WHERE tr.attempt_id=?1 ORDER BY m.revision_id,m.segment")
            .map_err(db_error)?;
        let rows = stmt.query_map([attempt_id], |r| Ok(SegmentMark { revision_id: r.get(0)?, segment: r.get(1)?, kind: r.get(2)? })).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// The week's best moments (12.5): sentences you liked first, then
    /// complete sentences of 8 to 25 words with no hesitation candidate, no
    /// pause inside a clause next to them and no "and" or "so" at the start,
    /// longer runs first. At most three, from two takes or more when possible.
    /// Only takes in history whose newest machine transcript has segment times.
    pub fn best_moments(&self, week_start: &str) -> Result<Vec<Moment>> {
        let start = chrono::NaiveDate::parse_from_str(week_start, "%Y-%m-%d").map_err(|_| "Invalid date.")?;
        let end = (start + chrono::Duration::days(6)).format("%Y-%m-%d").to_string();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let takes: Vec<(String, String, u32, String, i64)> = conn
            .prepare(
                "SELECT a.id,s.id,a.ordinal,s.local_date,a.created_at_ms FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                 WHERE a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL AND s.local_date BETWEEN ?1 AND ?2 ORDER BY a.created_at_ms DESC,a.id",
            )
            .map_err(db_error)?
            .query_map(params![week_start, end], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        // (liked, run words, recency rank, segment) orders the candidates.
        struct Candidate {
            moment: Moment,
            liked: bool,
            run_words: usize,
            rank: usize,
        }
        let mut candidates: Vec<Candidate> = Vec::new();
        for (rank, (attempt, session, ordinal, date, _)) in takes.iter().enumerate() {
            let Some(revision): Option<String> = conn
                .query_row("SELECT id FROM transcript_revisions WHERE attempt_id=?1 AND source<>'user' ORDER BY created_at_ms DESC,id DESC LIMIT 1", [attempt], |r| r.get(0))
                .optional()
                .map_err(db_error)?
            else {
                continue;
            };
            let segments: Vec<(String, Option<i64>, Option<i64>)> = conn
                .prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position")
                .map_err(db_error)?
                .query_map([&revision], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(db_error)?
                .collect::<rusqlite::Result<_>>()
                .map_err(db_error)?;
            let inputs: Vec<crate::analysis::SegmentInput> = segments
                .iter()
                .map(|(text, s, e)| crate::analysis::SegmentInput { text, start_ms: s.and_then(|v| u64::try_from(v).ok()), end_ms: e.and_then(|v| u64::try_from(v).ok()) })
                .collect();
            let measures = crate::analysis::measure(&inputs);
            let dismissed: HashSet<i64> = conn
                .prepare("SELECT candidate FROM annotations WHERE revision_id=?1 AND definition_version=?2 AND kind='filler' AND decision='dismissed'")
                .map_err(db_error)?
                .query_map(params![revision, crate::analysis::FILLER_DEFINITION_VERSION], |r| r.get(0))
                .map_err(db_error)?
                .collect::<rusqlite::Result<_>>()
                .map_err(db_error)?;
            let hesitant: HashSet<usize> = measures.fillers.iter().enumerate().filter(|(i, _)| !dismissed.contains(&(*i as i64))).map(|(_, f)| f.segment).collect();
            let mid_clause: HashSet<usize> = measures
                .pauses
                .iter()
                .zip(measures.pause_kinds.iter())
                .filter(|(_, kind)| **kind == "mid_clause")
                .flat_map(|(p, _)| [p.after_segment, p.after_segment + 1])
                .collect();
            let liked: HashSet<u32> = conn
                .prepare("SELECT segment FROM segment_marks WHERE revision_id=?1 AND kind='liked'")
                .map_err(db_error)?
                .query_map([&revision], |r| r.get(0))
                .map_err(db_error)?
                .collect::<rusqlite::Result<_>>()
                .map_err(db_error)?;
            // Words in the run (speech between pauses) each segment belongs to.
            let mut breaks: Vec<usize> = measures.pauses.iter().map(|p| p.after_segment).collect();
            breaks.sort_unstable();
            let run_of = |i: usize| breaks.iter().filter(|&&b| b < i).count();
            let mut run_words: HashMap<usize, usize> = HashMap::new();
            for (i, (text, _, _)) in segments.iter().enumerate() {
                *run_words.entry(run_of(i)).or_default() += crate::analysis::tokens(text).len();
            }
            for (i, (text, s, e)) in segments.iter().enumerate() {
                let (Some(start), Some(end)) = (s.and_then(|v| u64::try_from(v).ok()), e.and_then(|v| u64::try_from(v).ok())) else { continue };
                if end <= start {
                    continue;
                }
                let words = crate::analysis::tokens(text);
                let is_liked = liked.contains(&(i as u32));
                let by_rule = MOMENT_WORDS.contains(&words.len())
                    && !hesitant.contains(&i)
                    && !mid_clause.contains(&i)
                    && !matches!(words.first().map(String::as_str), Some("and" | "so"));
                if !is_liked && !by_rule {
                    continue;
                }
                candidates.push(Candidate {
                    moment: Moment {
                        attempt_id: attempt.clone(),
                        session_id: session.clone(),
                        ordinal: *ordinal,
                        revision_id: revision.clone(),
                        segment: i as u32,
                        text: text.trim().to_string(),
                        start_ms: start,
                        end_ms: end,
                        local_date: date.clone(),
                        liked: is_liked,
                    },
                    liked: is_liked,
                    run_words: run_words.get(&run_of(i)).copied().unwrap_or(0),
                    rank,
                });
            }
        }
        // Liked first (newer takes first); then longer runs, newer takes, earlier sentences.
        candidates.sort_by(|a, b| {
            b.liked
                .cmp(&a.liked)
                .then_with(|| if a.liked { std::cmp::Ordering::Equal } else { b.run_words.cmp(&a.run_words) })
                .then_with(|| a.rank.cmp(&b.rank))
                .then_with(|| a.moment.segment.cmp(&b.moment.segment))
        });
        // One per take first, so the reel comes from two takes or more when it can.
        let mut chosen: Vec<usize> = Vec::new();
        let mut takes_used: HashSet<&str> = HashSet::new();
        for (i, c) in candidates.iter().enumerate() {
            if chosen.len() == MAX_MOMENTS {
                break;
            }
            if takes_used.insert(c.moment.attempt_id.as_str()) {
                chosen.push(i);
            }
        }
        for i in 0..candidates.len() {
            if chosen.len() == MAX_MOMENTS {
                break;
            }
            if !chosen.contains(&i) {
                chosen.push(i);
            }
        }
        chosen.sort_unstable();
        Ok(chosen.into_iter().map(|i| candidates[i].moment.clone()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::whisper::{Backend, Segment as Spoken, Transcript};
    use crate::storage::database::engagement::tests::context;
    use crate::storage::recording::{tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
    use std::path::Path;

    fn audio(root: &Path, id: &str) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for _ in 0..48_000 * 3 {
            w.push(1000).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }

    fn take(db: &DatabaseOwner, root: &Path, id: &str) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(&context(&format!("s-{id}"), "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(root, id)).unwrap();
    }

    /// A local transcript whose segments follow each other closely, or with
    /// the given gaps (ms) before a segment; `None` times leave a segment untimed.
    fn transcript(db: &DatabaseOwner, attempt: &str, parts: &[(&str, Option<u64>)]) -> String {
        let mut at = 0u64;
        let segments: Vec<Spoken> = parts
            .iter()
            .map(|(text, gap)| match gap {
                Some(gap) => {
                    let start = at + gap;
                    at = start + 2_000;
                    Spoken { text: (*text).into(), start_ms: Some(start), end_ms: Some(at), timing_source: "Estimated".into(), timing_unavailable_reason: None }
                }
                None => Spoken { text: (*text).into(), start_ms: None, end_ms: None, timing_source: "Estimated".into(), timing_unavailable_reason: Some("no timing".into()) },
            })
            .collect();
        let t = Transcript {
            version: 1, run_id: format!("run-{attempt}"), asset_id: attempt.into(), provider: "local-whisper".into(), model_id: "base".into(),
            model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(), backend: Backend::Cpu, threads: 4, prompt: None,
            source_sha256: "b".repeat(64), prepared_sha256: "c".repeat(64), language: "en".into(),
            raw_text: parts.iter().map(|(t, _)| *t).collect::<Vec<_>>().join(" "), segments, elapsed_ms: 10, peak_ram_bytes: None,
            peak_ram_unavailable_reason: Some("not measured in tests".into()), created_at_ms: 1_000,
        };
        db.start_job(&format!("job-{attempt}"), attempt, 1_000).unwrap();
        db.save_local_transcript(&format!("job-{attempt}"), attempt, &t, 1_000).unwrap();
        format!("run-{attempt}")
    }

    fn count(db: &DatabaseOwner, sql: &str) -> i64 {
        db.connection.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn step(title: &str) -> StepInput {
        StepInput { id: None, title: title.into(), template_id: Some("meetings".into()) }
    }

    fn attempt(step_id: &str, outcome: &str, before: Option<u8>, after: Option<u8>) -> AttemptInput {
        AttemptInput { step_id: step_id.into(), local_date: "2026-10-18".into(), before_rating: before, after_rating: after, outcome: outcome.into(), note: String::new() }
    }

    fn week_start() -> String {
        let today = chrono::NaiveDate::parse_from_str(&local_date(recording::now_ms() as i64), "%Y-%m-%d").unwrap();
        (today - chrono::Duration::days(3)).format("%Y-%m-%d").to_string()
    }

    #[test]
    fn ladder_order_is_saved_and_soft_deletes_keep_attempts() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let saved = db.save_exposure_steps(&[step("Record yourself alone"), step("Send a voice message"), step("Ask one question in a meeting")]).unwrap();
        assert_eq!(saved.iter().map(|s| (s.position, s.title.as_str())).collect::<Vec<_>>(), [(1, "Record yourself alone"), (2, "Send a voice message"), (3, "Ask one question in a meeting")]);
        let first = &saved[0];
        db.add_exposure_attempt(&attempt(&first.id, "yes", Some(6), Some(2))).unwrap();
        // Move the third up, rename the second, drop the first.
        let reordered = db
            .save_exposure_steps(&[
                StepInput { id: Some(saved[2].id.clone()), title: "Ask a question in a team meeting".into(), template_id: None },
                StepInput { id: Some(saved[1].id.clone()), title: " Send a voice message to a friend ".into(), template_id: None },
            ])
            .unwrap();
        assert_eq!(reordered.iter().map(|s| (s.position, s.title.as_str())).collect::<Vec<_>>(), [(1, "Ask a question in a team meeting"), (2, "Send a voice message to a friend")]);
        assert_eq!(count(&db, "SELECT count(*) FROM exposure_steps WHERE deleted_at_ms IS NOT NULL"), 1);
        assert_eq!(db.list_exposure_attempts(Some(&first.id)).unwrap().len(), 1, "the deleted step keeps its attempts");
        assert!(db.add_exposure_attempt(&attempt(&first.id, "yes", None, Some(1))).is_err(), "no new attempts on a deleted step");
        assert!(db.save_exposure_steps(&[StepInput { id: Some("step-gone".into()), title: "A step".into(), template_id: None }]).is_err());
        assert!(db.save_exposure_steps(&[step("ok"), step("Two")]).is_err(), "3 to 160 characters");
        assert!(db.save_exposure_steps(&vec![step("A step"); 31]).is_err(), "30 steps at most");
        let twice = Some(reordered[0].id.clone());
        assert!(db.save_exposure_steps(&[StepInput { id: twice.clone(), title: "One".into(), template_id: None }, StepInput { id: twice, title: "Two".into(), template_id: None }]).is_err());
    }

    #[test]
    fn ratings_are_0_to_10_and_notes_limited() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let s = db.save_exposure_steps(&[step("Ask one question in a meeting")]).unwrap().remove(0);
        assert!(db.add_exposure_attempt(&attempt(&s.id, "yes", Some(11), None)).is_err());
        assert!(db.add_exposure_attempt(&attempt(&s.id, "maybe", Some(3), None)).is_err());
        assert!(db.add_exposure_attempt(&attempt(&s.id, "planned", None, None)).is_err(), "a plan has a before rating");
        assert!(db.add_exposure_attempt(&attempt(&s.id, "planned", Some(5), Some(2))).is_err(), "and no after rating yet");
        assert!(db.add_exposure_attempt(&AttemptInput { note: "x".repeat(1001), ..attempt(&s.id, "yes", None, Some(2)) }).is_err());
        assert!(db.add_exposure_attempt(&AttemptInput { local_date: "18 Oct".into(), ..attempt(&s.id, "yes", None, Some(2)) }).is_err());
        let plan = db.add_exposure_attempt(&attempt(&s.id, "planned", Some(7), None)).unwrap();
        let done = db.update_exposure_attempt(&plan.id, &AttemptInput { note: " Asked about the deadline ".into(), ..attempt(&s.id, "partly", Some(7), Some(4)) }).unwrap();
        assert_eq!((done.before_rating, done.after_rating, done.outcome.as_str(), done.note.as_str()), (Some(7), Some(4), "partly", "Asked about the deadline"));
        let other = db.save_exposure_steps(&[StepInput { id: Some(s.id.clone()), title: s.title.clone(), template_id: None }, step("Give a one-minute update")]).unwrap().remove(1);
        assert!(db.update_exposure_attempt(&plan.id, &attempt(&other.id, "yes", None, Some(1))).is_err(), "an attempt stays on its step");
        db.delete_exposure_attempt(&plan.id).unwrap();
        assert!(db.list_exposure_attempts(None).unwrap().is_empty());
        assert!(db.delete_exposure_attempt(&plan.id).is_err());
    }

    #[test]
    fn done_attempts_award_xp_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let s = db.save_exposure_steps(&[step("Ask one question in a meeting")]).unwrap().remove(0);
        db.add_exposure_attempt(&attempt(&s.id, "not_this_time", Some(8), Some(8))).unwrap();
        let plan = db.add_exposure_attempt(&attempt(&s.id, "planned", Some(6), None)).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='exposure_step'"), 0, "not this time and a plan earn nothing");
        db.update_exposure_attempt(&plan.id, &attempt(&s.id, "yes", Some(6), Some(3))).unwrap();
        db.update_exposure_attempt(&plan.id, &attempt(&s.id, "yes", Some(6), Some(2))).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='exposure_step'"), 1);
        assert_eq!(count(&db, "SELECT sum(xp) FROM practice_events WHERE kind='exposure_step'"), 30);
        db.delete_exposure_attempt(&plan.id).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='exposure_step'"), 1, "effort is never taken away");
    }

    #[test]
    fn routine_runs_keep_the_note_only_when_asked() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let run = db.save_routine_run(&RoutineInput { steps: vec!["breathe".into(), "reframe".into(), "breathe".into()], kept_note: Some("   ".into()), event_id: None }).unwrap();
        assert_eq!((run.steps.clone(), run.kept_note.clone()), (vec!["breathe".to_string(), "reframe".to_string()], None));
        let kept = db.save_routine_run(&RoutineInput { steps: vec!["unload".into()], kept_note: Some(" The demo might fail ".into()), event_id: None }).unwrap();
        assert_eq!(kept.kept_note.as_deref(), Some("The demo might fail"));
        assert!(db.save_routine_run(&RoutineInput { steps: Vec::new(), kept_note: None, event_id: None }).is_err());
        assert!(db.save_routine_run(&RoutineInput { steps: vec!["power_pose".into()], kept_note: None, event_id: None }).is_err());
        assert!(db.save_routine_run(&RoutineInput { steps: vec!["unload".into()], kept_note: Some("x".repeat(4001)), event_id: None }).is_err());
        assert_eq!(db.list_routine_runs().unwrap().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), [kept.id.as_str(), run.id.as_str()]);
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='routine'"), 2);
        db.delete_routine_run(&kept.id).unwrap();
        assert_eq!(db.list_routine_runs().unwrap().len(), 1);
        assert!(db.delete_routine_run(&kept.id).is_err());
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='routine'"), 2, "effort is never taken away");
    }

    #[test]
    fn segment_marks_are_purged_with_the_revision() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "t1");
        let revision = transcript(&db, "t1", &[("I plan the day the evening before, with a short list.", Some(0)), ("Then I sleep.", Some(100))]);
        db.set_segment_mark(&revision, 0, true).unwrap();
        db.set_segment_mark(&revision, 0, true).unwrap();
        assert!(db.set_segment_mark(&revision, 2, true).is_err(), "no such sentence");
        assert_eq!(db.list_segment_marks("t1").unwrap(), [SegmentMark { revision_id: revision.clone(), segment: 0, kind: "liked".into() }]);
        db.set_segment_mark(&revision, 1, true).unwrap();
        db.set_segment_mark(&revision, 1, false).unwrap();
        assert_eq!(db.list_segment_marks("t1").unwrap().len(), 1);
        db.move_take_to_trash("t1", 20).unwrap();
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM segment_marks"), 0);
    }

    #[test]
    fn best_moments_prefer_liked_then_rule_matches_and_use_segment_times_only() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "t1");
        let r1 = transcript(&db, "t1", &[
            ("Um, the first thing I do is open the window every single morning.", Some(0)),
            ("The first thing I do is open the window, because fresh air wakes me up.", Some(1_500)),
            ("So that is the whole of my morning routine before I start work.", Some(1_500)),
            ("Short one.", Some(1_500)),
        ]);
        take(&db, &root.0, "t2");
        transcript(&db, "t2", &[("In the end, I realised the map I was holding was upside down.", Some(0)), ("We laughed.", Some(100))]);
        db.set_segment_mark(&r1, 3, true).unwrap();
        let moments = db.best_moments(&week_start()).unwrap();
        let picked: Vec<(&str, u32, bool)> = moments.iter().map(|m| (m.attempt_id.as_str(), m.segment, m.liked)).collect();
        // The liked sentence leads even though it is short; then one sentence from each take.
        assert_eq!(picked[0], ("t1", 3, true));
        assert_eq!(moments.len(), 3);
        assert!(picked.contains(&("t1", 1, false)), "a complete sentence with no hesitation candidate");
        assert!(picked.iter().any(|(a, _, _)| *a == "t2"), "two takes or more");
        assert!(!picked.contains(&("t1", 0, false)), "a sentence with a filler candidate is never picked by the rules");
        assert!(!picked.contains(&("t1", 2, false)), "nor one that starts with so");
        let liked = &moments[0];
        assert_eq!((liked.start_ms, liked.end_ms, liked.text.as_str()), (10_500, 12_500, "Short one."), "the stored segment times");
    }

    #[test]
    fn best_moments_skip_trashed_takes_and_untimed_revisions() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "t1");
        transcript(&db, "t1", &[("The first thing I do is open the window, because fresh air wakes me up.", Some(0))]);
        take(&db, &root.0, "t2");
        transcript(&db, "t2", &[("In the end, I realised the map I was holding was upside down.", None)]);
        assert_eq!(db.best_moments(&week_start()).unwrap().iter().map(|m| m.attempt_id.as_str()).collect::<Vec<_>>(), ["t1"]);
        db.move_take_to_trash("t1", 20).unwrap();
        assert!(db.best_moments(&week_start()).unwrap().is_empty());
        assert!(db.best_moments("last week").is_err());
    }
}
