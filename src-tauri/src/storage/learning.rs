//! The learning engine (roadmap M11): your guesses before seeing a take's
//! measures (11.5), guided programmes (11.6) and Catch it runs (11.6). Rows
//! hold IDs, keys and numbers only (A-30). Predictions and Catch it runs are
//! purged with their take; programmes are kept, and a step's reference stops
//! resolving after a purge.
use super::engagement::{award, local_date};
use super::{db_error, iso, DatabaseOwner, Result};
use crate::engagement::{EventKind, NewEvent};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

/// Hesitation buckets and pace buckets (11.5).
pub const HESITATION_BUCKETS: [&str; 3] = ["0-1", "2-4", "5+"];
pub const PACE_BUCKETS: [&str; 3] = ["slower", "usual", "faster"];
/// Programmes this build offers (content in `src/content/programmes.ts`).
pub const PROGRAMMES: [&str; 1] = ["fillers-4w"];
pub const MAX_CATCH_PRESSES: usize = 500;
pub const MAX_CATCH_TOTAL: u32 = 200;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prediction {
    pub attempt_id: String,
    pub kind: String,
    pub predicted: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammeStepRow {
    pub step_id: String,
    pub ref_id: Option<String>,
    pub done_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammeRun {
    pub id: String,
    pub programme: String,
    pub week: u32,
    pub started_at: String,
    /// When the current week began, for steps that count "since the week started".
    pub week_started_at: String,
    pub week_started_date: String,
    pub completed_at: Option<String>,
    pub stopped_at: Option<String>,
    pub steps: Vec<ProgrammeStepRow>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatchRun {
    pub id: String,
    pub attempt_id: String,
    pub presses: Vec<u64>,
    pub caught: u32,
    pub total: u32,
    pub created_at: String,
}

fn key_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

impl DatabaseOwner {
    /// Your guess for one kind (11.5), kept once: the first answer stands, so a
    /// guess can't be changed after the measures were shown. The first guess
    /// on a take earns `prediction` (5 XP, at most 5 a day). Returns whether it was new.
    pub fn set_prediction(&self, attempt_id: &str, kind: &str, predicted: &str) -> Result<bool> {
        recording::validate_id(attempt_id)?;
        let allowed: &[&str] = match kind {
            "hesitations" => &HESITATION_BUCKETS,
            "pace" => &PACE_BUCKETS,
            _ => return Err("Unknown kind of guess.".into()),
        };
        if !allowed.contains(&predicted) {
            return Err("That guess isn't one of the choices.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let (session, date): (String, String) = tx
            .query_row(
                "SELECT s.id,s.local_date FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                 WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL",
                [attempt_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        let now = recording::now_ms() as i64;
        let added = tx
            .execute("INSERT OR IGNORE INTO self_predictions(attempt_id,kind,predicted,created_at_ms) VALUES (?1,?2,?3,?4)", params![attempt_id, kind, predicted, now])
            .map_err(db_error)?;
        if added == 1 {
            award(&tx, &NewEvent { kind: EventKind::Prediction, ref_id: attempt_id, local_date: &date, session_id: Some(&session), attempt_id: Some(attempt_id), created_at_ms: now, backfilled: false })?;
        }
        tx.commit().map_err(db_error)?;
        Ok(added == 1)
    }

    /// Your guesses, newest first; from a local date on when given.
    pub fn list_predictions(&self, from: Option<&str>) -> Result<Vec<Prediction>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let since = match from {
            Some(date) => chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map_err(|_| "Invalid date.")?
                .and_hms_opt(0, 0, 0)
                .and_then(|d| d.and_local_timezone(chrono::Local).earliest())
                .map_or(0, |d| d.timestamp_millis()),
            None => 0,
        };
        let mut stmt = conn
            .prepare("SELECT attempt_id,kind,predicted,created_at_ms FROM self_predictions WHERE created_at_ms>=?1 ORDER BY created_at_ms DESC,attempt_id,kind")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([since], |r| Ok(Prediction { attempt_id: r.get(0)?, kind: r.get(1)?, predicted: r.get(2)?, created_at: iso(r.get(3)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    fn programme_run(&self, conn: &rusqlite::Connection, id: &str) -> Result<Option<ProgrammeRun>> {
        let run = conn
            .query_row(
                "SELECT id,programme,week,started_at_ms,week_started_at_ms,completed_at_ms,stopped_at_ms FROM programmes WHERE id=?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, u32>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                        r.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(db_error)?;
        let Some((id, programme, week, started, week_started, completed, stopped)) = run else { return Ok(None) };
        let mut stmt = conn.prepare("SELECT step_id,ref_id,done_at_ms FROM programme_steps WHERE programme_id=?1 ORDER BY done_at_ms,step_id").map_err(db_error)?;
        let steps = stmt
            .query_map([&id], |r| Ok(ProgrammeStepRow { step_id: r.get(0)?, ref_id: r.get(1)?, done_at: iso(r.get(2)?) }))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        Ok(Some(ProgrammeRun {
            id,
            programme,
            week,
            started_at: iso(started),
            week_started_at: iso(week_started),
            week_started_date: local_date(week_started),
            completed_at: completed.map(iso),
            stopped_at: stopped.map(iso),
            steps,
        }))
    }

    /// The latest programme run, active or not.
    pub fn programme_state(&self) -> Result<Option<ProgrammeRun>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let latest: Option<String> = conn
            .query_row("SELECT id FROM programmes ORDER BY started_at_ms DESC,id DESC LIMIT 1", [], |r| r.get(0))
            .optional()
            .map_err(db_error)?;
        match latest {
            Some(id) => self.programme_run(&conn, &id),
            None => Ok(None),
        }
    }

    /// Starts a programme; one runs at a time, so an active run is returned as it is.
    pub fn start_programme(&self, programme: &str) -> Result<ProgrammeRun> {
        if !PROGRAMMES.contains(&programme) {
            return Err("Unknown programme.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let active: Option<String> = conn
            .query_row("SELECT id FROM programmes WHERE completed_at_ms IS NULL AND stopped_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1", [], |r| r.get(0))
            .optional()
            .map_err(db_error)?;
        let id = match active {
            Some(id) => id,
            None => {
                let now = recording::now_ms() as i64;
                let id = format!("prog-{now}");
                conn.execute("INSERT INTO programmes(id,programme,week,started_at_ms,week_started_at_ms) VALUES (?1,?2,1,?3,?3)", params![id, programme, now]).map_err(db_error)?;
                id
            }
        };
        self.programme_run(&conn, &id)?.ok_or_else(|| "The programme could not be started.".into())
    }

    fn active_run(conn: &rusqlite::Connection, id: &str) -> Result<()> {
        let active: bool = conn
            .query_row("SELECT completed_at_ms IS NULL AND stopped_at_ms IS NULL FROM programmes WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(db_error)?
            .ok_or("This programme doesn't exist.")?;
        if !active {
            return Err("This programme has finished. Start it again to go on.".into());
        }
        Ok(())
    }

    /// Marks a step done, once, whether it was detected or ticked; earns `programme_step` (10 XP) once.
    pub fn complete_programme_step(&self, programme_id: &str, step_id: &str, ref_id: Option<&str>) -> Result<bool> {
        recording::validate_id(programme_id)?;
        if !key_id(step_id) || ref_id.is_some_and(|r| recording::validate_id(r).is_err()) {
            return Err("This step is invalid.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        Self::active_run(&tx, programme_id)?;
        let now = recording::now_ms() as i64;
        let existed: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM programme_steps WHERE programme_id=?1 AND step_id=?2)", params![programme_id, step_id], |r| r.get(0))
            .map_err(db_error)?;
        // Redoing a step in a repeated week moves its date on; it earns only the first time.
        tx.execute(
            "INSERT INTO programme_steps(programme_id,step_id,ref_id,done_at_ms) VALUES (?1,?2,?3,?4)              ON CONFLICT(programme_id,step_id) DO UPDATE SET done_at_ms=excluded.done_at_ms,ref_id=COALESCE(excluded.ref_id,programme_steps.ref_id)",
            params![programme_id, step_id, ref_id, now],
        )
        .map_err(db_error)?;
        if !existed {
            let reference = format!("{programme_id}:{step_id}");
            award(&tx, &NewEvent { kind: EventKind::ProgrammeStep, ref_id: &reference, local_date: &local_date(now), session_id: None, attempt_id: None, created_at_ms: now, backfilled: false })?;
        }
        tx.commit().map_err(db_error)?;
        Ok(!existed)
    }

    /// Moves to a week (repeat, move on), restarting its clock; `finished` completes the programme.
    pub fn set_programme_week(&self, programme_id: &str, week: u32, finished: bool) -> Result<ProgrammeRun> {
        recording::validate_id(programme_id)?;
        if !(1..=12).contains(&week) {
            return Err("That week doesn't exist.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        Self::active_run(&conn, programme_id)?;
        let now = recording::now_ms() as i64;
        conn.execute(
            "UPDATE programmes SET week=?2,week_started_at_ms=?3,completed_at_ms=CASE WHEN ?4 THEN ?3 ELSE NULL END WHERE id=?1",
            params![programme_id, week, now, finished],
        )
        .map_err(db_error)?;
        self.programme_run(&conn, programme_id)?.ok_or_else(|| "This programme doesn't exist.".into())
    }

    /// Stops a programme; what you did stays.
    pub fn stop_programme(&self, programme_id: &str) -> Result<()> {
        recording::validate_id(programme_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        Self::active_run(&conn, programme_id)?;
        conn.execute("UPDATE programmes SET stopped_at_ms=?2 WHERE id=?1", params![programme_id, recording::now_ms() as i64]).map_err(db_error)?;
        Ok(())
    }

    /// A Catch it run (11.6): your presses (ms into the take) and how many fillers they caught.
    pub fn save_catch_run(&self, attempt_id: &str, presses: &[u64], caught: u32, total: u32) -> Result<CatchRun> {
        recording::validate_id(attempt_id)?;
        if caught > total || total > MAX_CATCH_TOTAL || presses.len() > MAX_CATCH_PRESSES {
            return Err("This Catch it result is invalid.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let (session, date, duration): (String, String, i64) = tx
            .query_row(
                "SELECT s.id,s.local_date,aa.duration_ms FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id JOIN audio_assets aa ON aa.id=a.asset_id \
                 WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL",
                [attempt_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        if presses.iter().any(|p| i64::try_from(*p).map_or(true, |p| p > duration)) {
            return Err("A press falls outside the take.".into());
        }
        let now = recording::now_ms() as i64;
        let id = format!("catch-{attempt_id}-{now}");
        let presses_json = serde_json::to_string(presses).map_err(|_| "This Catch it result is invalid.")?;
        tx.execute("INSERT INTO catch_runs(id,attempt_id,presses,caught,total,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)", params![id, attempt_id, presses_json, caught, total, now])
            .map_err(db_error)?;
        award(&tx, &NewEvent { kind: EventKind::CatchRun, ref_id: &id, local_date: &date, session_id: Some(&session), attempt_id: Some(attempt_id), created_at_ms: now, backfilled: false })?;
        tx.commit().map_err(db_error)?;
        Ok(CatchRun { id, attempt_id: attempt_id.into(), presses: presses.to_vec(), caught, total, created_at: iso(now) })
    }

    pub fn list_catch_runs(&self, attempt_id: Option<&str>) -> Result<Vec<CatchRun>> {
        if let Some(id) = attempt_id {
            recording::validate_id(id)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,attempt_id,presses,caught,total,created_at_ms FROM catch_runs WHERE ?1 IS NULL OR attempt_id=?1 ORDER BY created_at_ms DESC,id")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([attempt_id], |r| {
                let presses: String = r.get(2)?;
                Ok(CatchRun { id: r.get(0)?, attempt_id: r.get(1)?, presses: serde_json::from_str(&presses).unwrap_or_default(), caught: r.get(3)?, total: r.get(4)?, created_at: iso(r.get(5)?) })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// "Not this one" on a re-answer (11.1): recorded once so it doesn't return; it earns nothing.
    pub fn skip_reanswer(&self, prompt_id: &str, step: u32) -> Result<()> {
        recording::validate_id(prompt_id)?;
        if ![1, 7, 30].contains(&step) {
            return Err("That re-answer step doesn't exist.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let now = recording::now_ms() as i64;
        let reference = format!("{prompt_id}:{step}");
        award(&conn, &NewEvent { kind: EventKind::ReanswerSkipped, ref_id: &reference, local_date: &local_date(now), session_id: None, attempt_id: None, created_at_ms: now, backfilled: false })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::database::engagement::tests::context;
    use crate::storage::recording::{tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
    use std::path::Path;

    fn audio(root: &Path, id: &str, seconds: usize) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for _ in 0..48_000 * seconds {
            w.push(1000).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }

    fn take(db: &DatabaseOwner, root: &Path, id: &str, seconds: usize) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(&context(&format!("s-{id}"), "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(root, id, seconds)).unwrap();
    }

    fn count(db: &DatabaseOwner, sql: &str) -> i64 {
        db.connection.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn predictions_are_stored_once_per_kind_and_purged_with_the_take() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "t1", 1);
        assert!(db.set_prediction("t1", "hesitations", "2-4").unwrap());
        assert!(!db.set_prediction("t1", "hesitations", "0-1").unwrap(), "the first guess stands");
        assert!(db.set_prediction("t1", "pace", "usual").unwrap());
        assert!(db.set_prediction("t1", "pace", "fast").is_err());
        assert!(db.set_prediction("t1", "mood", "usual").is_err());
        let listed = db.list_predictions(None).unwrap();
        assert_eq!(listed.iter().map(|p| (p.kind.as_str(), p.predicted.as_str())).collect::<Vec<_>>().len(), 2);
        assert!(listed.iter().any(|p| p.kind == "hesitations" && p.predicted == "2-4"));
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='prediction'"), 1, "one award per take");
        db.move_take_to_trash("t1", 20).unwrap();
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM self_predictions"), 0);
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='prediction'"), 1, "effort is never taken away");
    }

    #[test]
    fn programme_steps_are_recorded_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.start_programme("fillers-12w").is_err());
        let run = db.start_programme("fillers-4w").unwrap();
        assert_eq!(db.start_programme("fillers-4w").unwrap().id, run.id, "one run at a time");
        assert!(db.complete_programme_step(&run.id, "w1-catch-3", None).unwrap());
        assert!(!db.complete_programme_step(&run.id, "w1-catch-3", Some("t1")).unwrap());
        let redone = db.programme_state().unwrap().unwrap();
        assert_eq!((redone.steps.len(), redone.steps[0].ref_id.as_deref()), (1, Some("t1")), "redoing a step updates it in place");
        assert!(db.complete_programme_step(&run.id, "Week One!", None).is_err());
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='programme_step'"), 1);
        let moved = db.set_programme_week(&run.id, 2, false).unwrap();
        assert_eq!((moved.week, moved.steps.len()), (2, 1));
        assert!(db.set_programme_week(&run.id, 13, false).is_err());
        let done = db.set_programme_week(&run.id, 4, true).unwrap();
        assert!(done.completed_at.is_some());
        assert!(db.complete_programme_step(&run.id, "w4-real-2", None).is_err(), "a finished run takes no more steps");
        let again = db.start_programme("fillers-4w").unwrap();
        assert_ne!(again.id, run.id);
        db.stop_programme(&again.id).unwrap();
        assert!(db.programme_state().unwrap().unwrap().stopped_at.is_some());
    }

    #[test]
    fn catch_runs_are_validated_and_purged_with_the_take() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "t1", 2);
        let run = db.save_catch_run("t1", &[300, 1_200], 2, 3).unwrap();
        assert_eq!((run.caught, run.total, run.presses.len()), (2, 3, 2));
        assert!(db.save_catch_run("t1", &[300], 4, 3).is_err(), "caught is at most total");
        assert!(db.save_catch_run("t1", &[300], 1, 201).is_err());
        assert!(db.save_catch_run("t1", &vec![10; 501], 1, 3).is_err());
        assert!(db.save_catch_run("t1", &[2_500], 1, 3).is_err(), "presses fall inside the take");
        assert_eq!(db.list_catch_runs(Some("t1")).unwrap().len(), 1);
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='catch_run'"), 1);
        db.move_take_to_trash("t1", 20).unwrap();
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM catch_runs"), 0);
    }

    #[test]
    fn a_skipped_reanswer_is_recorded_once_with_no_xp() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.skip_reanswer("p-habit", 7).unwrap();
        db.skip_reanswer("p-habit", 7).unwrap();
        assert!(db.skip_reanswer("p-habit", 3).is_err());
        assert_eq!(count(&db, "SELECT count(*) FROM practice_events WHERE kind='reanswer_skipped' AND ref_id='p-habit:7' AND xp=0"), 1);
    }
}
