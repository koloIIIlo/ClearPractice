//! Listener packs you saved and the answers you imported (roadmap 14.4). The
//! zip itself is written by `listener_pack.rs`; these are its rows. A
//! listener's words are kept apart from your own notes, and whether they got
//! your main point is your judgement (Your note), never read from their words.
use super::engagement::{award, local_date};
use super::insights::CURRENT_REVISION;
use super::{db_error, iso, DatabaseOwner, Result};
use crate::engagement::{EventKind, NewEvent};
use crate::listener_pack::Answers;
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// What a pack is made from: the take, its session's title and the take's
/// current transcript (used only when you include it).
#[derive(Clone, Debug, PartialEq)]
pub struct PackSource {
    pub attempt_id: String,
    pub asset_id: String,
    pub session_id: String,
    pub title: String,
    pub duration_ms: u64,
    pub transcript: Option<String>,
}

/// A pack as it was saved.
pub struct NewPack<'a> {
    pub id: &'a str,
    pub attempt_id: &'a str,
    pub questions: &'a [String],
    pub from: &'a str,
    pub include_transcript: bool,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerPack {
    pub id: String,
    pub session_id: String,
    pub attempt_id: String,
    pub questions: Vec<String>,
    pub from: String,
    pub include_transcript: bool,
    pub created_at: String,
    /// Answer files imported for this pack.
    pub answer_files: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerAnswer {
    pub question: String,
    pub answer: String,
}

/// A listener's words about one take, with the questions they answered.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerFeedback {
    pub id: String,
    pub pack_id: String,
    pub session_id: String,
    pub attempt_id: String,
    pub listener_name: String,
    pub answers: Vec<ListenerAnswer>,
    /// As the listener's page wrote it; shown as given.
    pub answered_at: Option<String>,
    pub imported_at: String,
    /// Whether they got your main point: your judgement, null until you say.
    pub main_point_understood: Option<bool>,
}

/// An import, and whether this exact file was imported before (then nothing changed).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerImport {
    pub feedback: ListenerFeedback,
    pub already_imported: bool,
}

const PACK_SELECT: &str = "SELECT p.id,p.session_id,p.attempt_id,p.questions,p.from_name,p.include_transcript,p.created_at_ms,\
     (SELECT count(*) FROM listener_feedback f WHERE f.pack_id=p.id) FROM listener_packs p";

fn pack_row(r: &rusqlite::Row) -> rusqlite::Result<ListenerPack> {
    Ok(ListenerPack {
        id: r.get(0)?,
        session_id: r.get(1)?,
        attempt_id: r.get(2)?,
        questions: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
        from: r.get(4)?,
        include_transcript: r.get::<_, i64>(5)? == 1,
        created_at: iso(r.get(6)?),
        answer_files: r.get(7)?,
    })
}

const FEEDBACK_SELECT: &str = "SELECT f.id,f.pack_id,p.session_id,p.attempt_id,f.listener_name,f.answers,p.questions,f.answered_at,f.imported_at_ms,f.main_point_understood \
     FROM listener_feedback f JOIN listener_packs p ON p.id=f.pack_id";

fn feedback_row(r: &rusqlite::Row) -> rusqlite::Result<ListenerFeedback> {
    let answers: Vec<String> = serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default();
    let questions: Vec<String> = serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default();
    Ok(ListenerFeedback {
        id: r.get(0)?,
        pack_id: r.get(1)?,
        session_id: r.get(2)?,
        attempt_id: r.get(3)?,
        listener_name: r.get(4)?,
        answers: questions.into_iter().zip(answers).map(|(question, answer)| ListenerAnswer { question, answer }).collect(),
        answered_at: r.get(7)?,
        imported_at: iso(r.get(8)?),
        main_point_understood: r.get::<_, Option<i64>>(9)?.map(|v| v == 1),
    })
}

fn feedback(conn: &Connection, id: &str) -> Result<ListenerFeedback> {
    conn.query_row(&format!("{FEEDBACK_SELECT} WHERE f.id=?1"), [id], feedback_row).map_err(db_error)
}

impl DatabaseOwner {
    /// The take a pack is made from (14.4): saved, not in Trash, with its session's title.
    pub fn listener_pack_source(&self, attempt_id: &str) -> Result<PackSource> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row(
            &format!(
                "SELECT a.id,a.asset_id,s.id,s.title,aa.duration_ms,(SELECT text FROM transcript_revisions WHERE id={CURRENT_REVISION}) FROM attempts a \
                 JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id JOIN audio_assets aa ON aa.id=a.asset_id \
                 WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL"
            ),
            [attempt_id],
            |r| {
                Ok(PackSource {
                    attempt_id: r.get(0)?,
                    asset_id: r.get(1)?,
                    session_id: r.get(2)?,
                    title: r.get(3)?,
                    duration_ms: r.get::<_, Option<i64>>(4)?.and_then(|d| u64::try_from(d).ok()).unwrap_or(0),
                    transcript: r.get::<_, Option<String>>(5)?.filter(|t| !t.trim().is_empty()),
                })
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "This take is unavailable.".into())
    }

    /// Records a pack once its file is saved.
    pub fn save_listener_pack(&self, pack: &NewPack) -> Result<ListenerPack> {
        recording::validate_id(pack.id)?;
        let questions = crate::listener_pack::clean_questions(pack.questions)?;
        let from = crate::listener_pack::clean_name(pack.from)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let session: String = conn
            .query_row(
                "SELECT st.session_id FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE a.id=?1 AND a.capture_state='saved'",
                [pack.attempt_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        conn.execute(
            "INSERT INTO listener_packs(id,session_id,attempt_id,questions,from_name,include_transcript,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![pack.id, session, pack.attempt_id, serde_json::to_string(&questions).map_err(|e| e.to_string())?, from, pack.include_transcript, pack.created_at_ms],
        )
        .map_err(db_error)?;
        conn.query_row(&format!("{PACK_SELECT} WHERE p.id=?1"), [pack.id], pack_row).map_err(db_error)
    }

    /// A pack ID nobody has used: it travels in the pack and comes back with the answers.
    pub fn new_listener_pack_id(&self) -> Result<String> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let now = recording::now_ms();
        for n in 0..1000u32 {
            let id = if n == 0 { format!("pack-{now}") } else { format!("pack-{now}-{n}") };
            let used: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM listener_packs WHERE id=?1)", [&id], |r| r.get(0)).map_err(db_error)?;
            if !used {
                return Ok(id);
            }
        }
        Err("Could not create an ID.".into())
    }

    /// A session's packs (or all of them), newest first.
    pub fn list_listener_packs(&self, session_id: Option<&str>) -> Result<Vec<ListenerPack>> {
        if let Some(id) = session_id {
            recording::validate_id(id)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare(&format!("{PACK_SELECT} WHERE ?1 IS NULL OR p.session_id=?1 ORDER BY p.created_at_ms DESC,p.id")).map_err(db_error)?;
        let rows = stmt.query_map([session_id], pack_row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Imports a listener's checked answers (14.4): the pack must exist and the
    /// answers match its questions; the same file a second time changes nothing.
    /// Earns `listener_answers` once per file.
    pub fn import_listener_answers(&self, answers: &Answers, file_sha256: &str) -> Result<ListenerImport> {
        if file_sha256.len() != 64 || !file_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid file.".into());
        }
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        if let Some(id) = tx.query_row("SELECT id FROM listener_feedback WHERE file_sha256=?1", [file_sha256], |r| r.get::<_, String>(0)).optional().map_err(db_error)? {
            return Ok(ListenerImport { feedback: feedback(&tx, &id)?, already_imported: true });
        }
        let (session, attempt, questions): (String, String, String) = tx
            .query_row("SELECT session_id,attempt_id,questions FROM listener_packs WHERE id=?1", [&answers.pack_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .map_err(db_error)?
            .ok_or("These answers are for a pack this computer didn't make, or for a take that was deleted for good.")?;
        let questions: Vec<String> = serde_json::from_str(&questions).unwrap_or_default();
        if questions.len() != answers.answers.len() {
            return Err("These answers don't match the pack's questions, so nothing was imported.".into());
        }
        let now = recording::now_ms() as i64;
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("listener-{now}") } else { format!("listener-{now}-{n}") };
            let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM listener_feedback WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !used {
                break candidate;
            }
            n += 1;
        };
        tx.execute(
            "INSERT INTO listener_feedback(id,pack_id,listener_name,answers,answered_at,file_sha256,imported_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id, answers.pack_id, answers.name, serde_json::to_string(&answers.answers).map_err(|e| e.to_string())?, answers.answered_at, file_sha256.to_ascii_lowercase(), now],
        )
        .map_err(db_error)?;
        award(&tx, &NewEvent { kind: EventKind::ListenerAnswers, ref_id: &id, local_date: &local_date(now), session_id: Some(&session), attempt_id: Some(&attempt), created_at_ms: now, backfilled: false })?;
        let saved = feedback(&tx, &id)?;
        tx.commit().map_err(db_error)?;
        Ok(ListenerImport { feedback: saved, already_imported: false })
    }

    /// A session's listener answers (or all of them), newest first.
    pub fn list_listener_feedback(&self, session_id: Option<&str>) -> Result<Vec<ListenerFeedback>> {
        if let Some(id) = session_id {
            recording::validate_id(id)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare(&format!("{FEEDBACK_SELECT} WHERE ?1 IS NULL OR p.session_id=?1 ORDER BY f.imported_at_ms DESC,f.id")).map_err(db_error)?;
        let rows = stmt.query_map([session_id], feedback_row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Your judgement of whether the listener got your main point (Your note).
    pub fn set_listener_judgement(&self, feedback_id: &str, understood: Option<bool>) -> Result<ListenerFeedback> {
        recording::validate_id(feedback_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn.execute("UPDATE listener_feedback SET main_point_understood=?2 WHERE id=?1", params![feedback_id, understood]).map_err(db_error)?;
        if count != 1 {
            return Err("These answers no longer exist.".into());
        }
        feedback(&conn, feedback_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::database::engagement::tests::{audio, context, transcribe};
    use crate::storage::recording::tests::TestRoot;

    fn take(db: &DatabaseOwner, root: &TestRoot, id: &str) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(&context(&format!("s-{id}"), "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(&root.0, id, 12)).unwrap();
    }

    fn pack(db: &DatabaseOwner, attempt: &str, questions: &[&str]) -> ListenerPack {
        let id = db.new_listener_pack_id().unwrap();
        let questions: Vec<String> = questions.iter().map(|q| (*q).to_string()).collect();
        db.save_listener_pack(&NewPack { id: &id, attempt_id: attempt, questions: &questions, from: "Alex", include_transcript: false, created_at_ms: 1_000 }).unwrap()
    }

    fn answers(pack_id: &str, count: usize) -> Answers {
        Answers { pack_id: pack_id.into(), name: "Sam".into(), answers: (0..count).map(|i| format!("Answer {i}")).collect(), answered_at: Some("2026-10-18T10:00:00.000Z".into()) }
    }

    fn xp(db: &DatabaseOwner) -> Vec<String> {
        db.connection.lock().unwrap().prepare("SELECT ref_id FROM practice_events WHERE kind='listener_answers' ORDER BY id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    }

    #[test]
    fn answers_are_validated_strictly_and_imported_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root, "t1");
        transcribe(&db, "t1", "We should delay the release by two weeks.");
        let source = db.listener_pack_source("t1").unwrap();
        assert_eq!((source.session_id.as_str(), source.duration_ms), ("s-t1", 12_000));
        assert_eq!(source.transcript.as_deref(), Some("We should delay the release by two weeks."));
        let made = pack(&db, "t1", &["What was my main point?", "Where did you get lost, if anywhere?", "What helped you follow?"]);
        assert_eq!((made.session_id.as_str(), made.answer_files, made.include_transcript), ("s-t1", 0, false));
        assert!(db.import_listener_answers(&answers(&made.id, 2), &"a".repeat(64)).is_err(), "one answer per question");
        assert!(db.import_listener_answers(&answers(&made.id, 3), "not-a-hash").is_err());
        let first = db.import_listener_answers(&answers(&made.id, 3), &"a".repeat(64)).unwrap();
        assert!(!first.already_imported);
        assert_eq!(first.feedback.answers[0], ListenerAnswer { question: "What was my main point?".into(), answer: "Answer 0".into() });
        assert_eq!((first.feedback.listener_name.as_str(), first.feedback.main_point_understood), ("Sam", None));
        let again = db.import_listener_answers(&answers(&made.id, 3), &"a".repeat(64)).unwrap();
        assert!(again.already_imported && again.feedback == first.feedback, "the same file changes nothing");
        assert_eq!(db.list_listener_feedback(Some("s-t1")).unwrap().len(), 1);
        // A different file for the same pack is a second listener.
        db.import_listener_answers(&answers(&made.id, 3), &"b".repeat(64)).unwrap();
        assert_eq!(xp(&db).len(), 2, "listener_answers once per answer file");
        assert_eq!(db.list_listener_packs(Some("s-t1")).unwrap()[0].answer_files, 2);
        let judged = db.set_listener_judgement(&first.feedback.id, Some(true)).unwrap();
        assert_eq!(judged.main_point_understood, Some(true));
        assert!(db.set_listener_judgement("missing", Some(true)).is_err());
        let facts = db.practice_facts("2026-10-18").unwrap();
        assert_eq!(facts.listener_answers.iter().filter(|a| a.main_point_answered).count(), 1);
        // A take deleted for good takes its packs and answers with it.
        db.move_take_to_trash("t1", 20).unwrap();
        assert!(db.listener_pack_source("t1").is_err(), "no pack from a take in Trash");
        db.delete_takes_permanently(&["t1".to_string()]).unwrap();
        assert!(db.list_listener_packs(None).unwrap().is_empty() && db.list_listener_feedback(None).unwrap().is_empty());
        assert!(db.import_listener_answers(&answers(&made.id, 3), &"c".repeat(64)).is_err());
    }

    #[test]
    fn answers_for_an_unknown_pack_are_refused() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root, "t1");
        assert!(db.listener_pack_source("t1").unwrap().transcript.is_none());
        let error = db.import_listener_answers(&answers("pack-from-elsewhere", 3), &"a".repeat(64)).unwrap_err();
        assert!(error.contains("didn't make"), "{error}");
        assert!(db.list_listener_feedback(None).unwrap().is_empty() && xp(&db).is_empty());
        assert!(db.save_listener_pack(&NewPack { id: "pack-x", attempt_id: "missing", questions: &["Q?".into()], from: "", include_transcript: false, created_at_ms: 1 }).is_err());
        assert!(db.save_listener_pack(&NewPack { id: "pack-x", attempt_id: "t1", questions: &[], from: "", include_transcript: false, created_at_ms: 1 }).is_err());
    }
}
