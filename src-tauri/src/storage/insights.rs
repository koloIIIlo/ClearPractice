//! Insights (roadmap M8): saved phrases spotted in your takes (8.2), your
//! quick self-checks (8.3), speech rate from the audio (8.8) and A/B choices
//! between takes of different sessions (8.5). Rows hold IDs and numbers only
//! (A-30); every table here is purged with its take.
use super::{db_error, iso, DatabaseOwner, Result};
use crate::analysis::{self, PhrasePattern};
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// Self-check IDs (8.3); the drills of M10 use the later ones.
/// `stressed_target` is your own judgement in the emphasis game, kept apart from the estimate (A-35);
/// `final_check` answers a boss level's closing question.
pub const CHECK_IDS: [&str; 12] = ["point_first", "clear_ending", "varied_voice", "concrete_detail", "fair_other_side", "kept_main_point", "used_all_icons", "fit_child", "fit_colleague", "fit_expert", "stressed_target", "final_check"];
/// How far back adding or changing a phrase looks for earlier uses.
const RESCAN_DAYS: i64 = 365;
const RESCAN_MAX_TAKES: i64 = 2_000;

/// SQL for a take's current transcript revision (`a` is the attempts row):
/// your latest correction of its newest machine transcript, else that transcript.
pub(crate) const CURRENT_REVISION: &str = "COALESCE(\
     (SELECT c.id FROM transcript_revisions c WHERE c.source='user' AND c.parent_id=\
       (SELECT m.id FROM transcript_revisions m WHERE m.attempt_id=a.id AND m.source<>'user' ORDER BY m.created_at_ms DESC,m.id DESC LIMIT 1) \
      ORDER BY c.created_at_ms DESC,c.id DESC LIMIT 1),\
     (SELECT m.id FROM transcript_revisions m WHERE m.attempt_id=a.id AND m.source<>'user' ORDER BY m.created_at_ms DESC,m.id DESC LIMIT 1))";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseUse {
    pub phrase_id: String,
    pub attempt_id: String,
    pub session_id: String,
    pub revision_id: String,
    pub segment: u32,
    pub local_date: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheck {
    pub attempt_id: String,
    pub check_id: String,
    pub value: bool,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMeasures {
    pub attempt_id: String,
    pub method: &'static str,
    pub syllables: Option<u32>,
    pub span_ms: Option<u64>,
    pub phonation_ms: Option<u64>,
    pub rate_sps: Option<f64>,
    pub articulation_sps: Option<f64>,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub id: String,
    pub a_attempt: String,
    pub b_attempt: String,
    pub preferred: String,
    pub blind: bool,
    pub created_at: String,
}

/// A revision's words with the segment each came from. Corrections have no
/// segments and count as one.
fn revision_words(conn: &Connection, revision_id: &str) -> Result<Vec<(String, usize)>> {
    let mut stmt = conn.prepare("SELECT text FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
    let mut segments: Vec<String> = stmt.query_map([revision_id], |r| r.get(0)).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
    if segments.is_empty() {
        segments.push(conn.query_row("SELECT text FROM transcript_revisions WHERE id=?1", [revision_id], |r| r.get(0)).map_err(db_error)?);
    }
    Ok(segments.iter().enumerate().flat_map(|(i, text)| analysis::tokens(text).into_iter().map(move |t| (t, i))).collect())
}

fn insert_use(conn: &Connection, phrase_id: &str, attempt_id: &str, revision_id: &str, words: &[(String, usize)], pattern: &PhrasePattern, stemmed: &[(usize, String)], now_ms: i64) -> Result<bool> {
    let Some((from, to)) = pattern.find(stemmed) else { return Ok(false) };
    conn.execute(
        "INSERT OR REPLACE INTO phrase_uses(phrase_id,attempt_id,revision_id,segment,start_token,end_token,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![phrase_id, attempt_id, revision_id, words[from].1 as i64, from as i64, to as i64, now_ms],
    )
    .map_err(db_error)?;
    Ok(true)
}

/// Looks for every saved phrase in one revision; runs with its measures (8.2).
pub(crate) fn record_phrase_uses(conn: &Connection, attempt_id: &str, revision_id: &str, now_ms: i64) -> Result<u32> {
    let cards: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id,expression FROM phrase_cards WHERE deleted_at_ms IS NULL").map_err(db_error)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
    };
    if cards.is_empty() {
        return Ok(0);
    }
    let words = revision_words(conn, revision_id)?;
    let stemmed = analysis::stemmed(&words.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>());
    let mut found = 0;
    for (id, expression) in cards {
        if let Some(pattern) = PhrasePattern::new(&expression) {
            found += u32::from(insert_use(conn, &id, attempt_id, revision_id, &words, &pattern, &stemmed, now_ms)?);
        }
    }
    Ok(found)
}

impl DatabaseOwner {
    /// Finds one phrase again in the current transcripts of your takes from the
    /// last year (at most 2,000), after it was added or changed. Returns the
    /// number of takes it was found in.
    pub fn rescan_phrase(&self, card_id: &str) -> Result<u32> {
        recording::validate_id(card_id)?;
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        tx.execute("DELETE FROM phrase_uses WHERE phrase_id=?1", [card_id]).map_err(db_error)?;
        let expression: Option<String> = tx.query_row("SELECT expression FROM phrase_cards WHERE id=?1 AND deleted_at_ms IS NULL", [card_id], |r| r.get(0)).optional().map_err(db_error)?;
        let Some(pattern) = expression.as_deref().and_then(PhrasePattern::new) else {
            tx.commit().map_err(db_error)?;
            return Ok(0);
        };
        let now = recording::now_ms() as i64;
        let since = now - RESCAN_DAYS * 86_400_000;
        let takes: Vec<(String, String)> = {
            let mut stmt = tx
                .prepare(&format!(
                    "SELECT a.id,{CURRENT_REVISION} AS rev FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                     WHERE a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL AND a.created_at_ms>=?1 AND rev IS NOT NULL \
                     ORDER BY a.created_at_ms DESC LIMIT ?2"
                ))
                .map_err(db_error)?;
            let rows = stmt.query_map(params![since, RESCAN_MAX_TAKES], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
            rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
        };
        let mut found = 0;
        for (attempt, revision) in takes {
            let words = revision_words(&tx, &revision)?;
            let stemmed = analysis::stemmed(&words.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>());
            found += u32::from(insert_use(&tx, card_id, &attempt, &revision, &words, &pattern, &stemmed, now)?);
        }
        tx.commit().map_err(db_error)?;
        Ok(found)
    }

    /// Where your saved phrases turned up: current transcripts of takes in
    /// history, phrases not deleted. Newest first.
    pub fn list_phrase_uses(&self, card_id: Option<&str>) -> Result<Vec<PhraseUse>> {
        if let Some(id) = card_id {
            recording::validate_id(id)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT u.phrase_id,u.attempt_id,st.session_id,u.revision_id,u.segment,s.local_date FROM phrase_uses u \
                 JOIN attempts a ON a.id=u.attempt_id JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                 JOIN phrase_cards p ON p.id=u.phrase_id \
                 WHERE a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL AND p.deleted_at_ms IS NULL \
                 AND (?1 IS NULL OR u.phrase_id=?1) AND u.revision_id={CURRENT_REVISION} \
                 ORDER BY s.local_date DESC,a.created_at_ms DESC,u.phrase_id"
            ))
            .map_err(db_error)?;
        let rows = stmt
            .query_map([card_id], |r| {
                Ok(PhraseUse { phrase_id: r.get(0)?, attempt_id: r.get(1)?, session_id: r.get(2)?, revision_id: r.get(3)?, segment: r.get(4)?, local_date: r.get(5)? })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Saves (or with `None` clears) one of your yes/no notes about a take.
    pub fn set_self_check(&self, attempt_id: &str, check_id: &str, value: Option<bool>, now_ms: u64) -> Result<()> {
        recording::validate_id(attempt_id)?;
        if !CHECK_IDS.contains(&check_id) {
            return Err("Unknown self-check.".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND capture_state='saved' AND deleted_at_ms IS NULL)", [attempt_id], |r| r.get(0))
            .map_err(db_error)?;
        if !exists {
            return Err("This take is unavailable.".into());
        }
        match value {
            Some(value) => conn.execute(
                "INSERT INTO self_checks(attempt_id,check_id,value,created_at_ms) VALUES (?1,?2,?3,?4) ON CONFLICT(attempt_id,check_id) DO UPDATE SET value=excluded.value,created_at_ms=excluded.created_at_ms",
                params![attempt_id, check_id, value, now],
            ),
            None => conn.execute("DELETE FROM self_checks WHERE attempt_id=?1 AND check_id=?2", params![attempt_id, check_id]),
        }
        .map_err(db_error)?;
        Ok(())
    }

    pub fn list_self_checks(&self, attempt_id: &str) -> Result<Vec<SelfCheck>> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare("SELECT attempt_id,check_id,value,created_at_ms FROM self_checks WHERE attempt_id=?1 ORDER BY check_id").map_err(db_error)?;
        let rows = stmt
            .query_map([attempt_id], |r| Ok(SelfCheck { attempt_id: r.get(0)?, check_id: r.get(1)?, value: r.get(2)?, created_at: iso(r.get(3)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Speech rate from the take's audio (8.8): computed from the prepared
    /// audio on first request, then kept. Runs without holding the database.
    pub fn audio_measures(&self, attempt_id: &str) -> Result<AudioMeasures> {
        use crate::audio::syllables::{self, DEFINITION_VERSION, METHOD};
        recording::validate_id(attempt_id)?;
        type Row = (Option<u32>, Option<i64>, Option<i64>, Option<f64>, Option<f64>, Option<String>);
        let (asset, stored): (String, Option<Row>) = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let asset: String = conn
                .query_row("SELECT asset_id FROM attempts WHERE id=?1 AND capture_state='saved' AND deleted_at_ms IS NULL", [attempt_id], |r| r.get(0))
                .optional()
                .map_err(db_error)?
                .ok_or("This take is unavailable.")?;
            let stored = conn
                .query_row(
                    "SELECT syllables,span_ms,phonation_ms,rate_sps,articulation_sps,unavailable_reason FROM audio_measures WHERE attempt_id=?1 AND method=?2 AND definition_version=?3",
                    params![attempt_id, METHOD, DEFINITION_VERSION],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                )
                .optional()
                .map_err(db_error)?;
            (asset, stored)
        };
        let ms = |v: Option<i64>| v.and_then(|v| u64::try_from(v).ok());
        if let Some((syllables, span, phonation, rate, articulation, reason)) = stored {
            return Ok(AudioMeasures { attempt_id: attempt_id.into(), method: METHOD, syllables, span_ms: ms(span), phonation_ms: ms(phonation), rate_sps: rate, articulation_sps: articulation, unavailable_reason: reason });
        }
        self.checked_recording(&asset)?;
        let (samples, sample_rate) = crate::prosody::prepared_samples(&self.root, &asset)?;
        let result = syllables::detect(&samples, sample_rate);
        let syllables = u32::try_from(result.nuclei_ms.len()).ok();
        let to_i64 = |v: Option<u64>| v.and_then(|v| i64::try_from(v).ok());
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        // A take moved to Trash or purged meanwhile keeps no row.
        conn.execute(
            "INSERT OR IGNORE INTO audio_measures(attempt_id,method,definition_version,syllables,span_ms,phonation_ms,rate_sps,articulation_sps,unavailable_reason,created_at_ms) \
             SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND capture_state='saved' AND deleted_at_ms IS NULL)",
            params![attempt_id, METHOD, DEFINITION_VERSION, syllables, to_i64(result.span_ms), to_i64(result.phonation_ms), result.rate_sps, result.articulation_sps, result.unavailable_reason, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        Ok(AudioMeasures {
            attempt_id: attempt_id.into(),
            method: METHOD,
            syllables,
            span_ms: result.span_ms,
            phonation_ms: result.phonation_ms,
            rate_sps: result.rate_sps,
            articulation_sps: result.articulation_sps,
            unavailable_reason: result.unavailable_reason,
        })
    }

    /// Saves your A/B choice between takes of two different sessions (8.5).
    /// Takes of one session keep using the session's preferred take.
    pub fn save_comparison(&self, a_attempt: &str, b_attempt: &str, preferred: &str, blind: bool, now_ms: u64) -> Result<Comparison> {
        recording::validate_id(a_attempt)?;
        recording::validate_id(b_attempt)?;
        if !matches!(preferred, "a" | "b" | "same") {
            return Err("Choose A, B or About the same.".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let session = |id: &str| -> Result<String> {
            conn.query_row(
                "SELECT st.session_id FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| "One of these takes is unavailable.".to_string())
        };
        if session(a_attempt)? == session(b_attempt)? {
            return Err("Both takes are in one session: choose the preferred take there.".into());
        }
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("cmp-{now_ms}") } else { format!("cmp-{now_ms}-{n}") };
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM comparisons WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                break candidate;
            }
            n += 1;
        };
        conn.execute(
            "INSERT INTO comparisons(id,a_attempt,b_attempt,preferred,blind,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, a_attempt, b_attempt, preferred, blind, now],
        )
        .map_err(db_error)?;
        Ok(Comparison { id, a_attempt: a_attempt.into(), b_attempt: b_attempt.into(), preferred: preferred.into(), blind, created_at: iso(now) })
    }

    /// Your A/B choices that include this take, newest first.
    pub fn list_comparisons(&self, attempt_id: &str) -> Result<Vec<Comparison>> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,a_attempt,b_attempt,preferred,blind,created_at_ms FROM comparisons WHERE a_attempt=?1 OR b_attempt=?1 ORDER BY created_at_ms DESC,id DESC")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([attempt_id], |r| {
                Ok(Comparison { id: r.get(0)?, a_attempt: r.get(1)?, b_attempt: r.get(2)?, preferred: r.get(3)?, blind: r.get(4)?, created_at: iso(r.get(5)?) })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::whisper::{Backend, Segment, Transcript};
    use crate::storage::database::engagement::tests::context;
    use crate::storage::database::phrases::PhraseText;
    use crate::storage::recording::{tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
    use chrono::NaiveDate;
    use std::path::Path;

    /// A take of `seconds` with `sample(i)` at 48 kHz.
    fn audio(root: &Path, id: &str, seconds: u32, sample: impl Fn(usize) -> i16) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for i in 0..(48_000 * seconds as usize) {
            w.push(sample(i)).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }

    fn take(db: &DatabaseOwner, root: &Path, session: &str, id: &str) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(&context(session, "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(root, id, 1, |_| 1000)).unwrap();
    }

    fn transcript(db: &DatabaseOwner, attempt: &str, run: &str, parts: &[&str], now_ms: u64) {
        let segments: Vec<Segment> = parts
            .iter()
            .enumerate()
            .map(|(i, text)| Segment { text: (*text).into(), start_ms: Some(i as u64 * 1_000), end_ms: Some(i as u64 * 1_000 + 900), timing_source: "Estimated".into(), timing_unavailable_reason: None })
            .collect();
        let t = Transcript {
            version: 1, run_id: run.into(), asset_id: attempt.into(), provider: "local-whisper".into(), model_id: "base".into(),
            model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(), backend: Backend::Cpu, threads: 4, prompt: None,
            source_sha256: "b".repeat(64), prepared_sha256: "c".repeat(64), language: "en".into(),
            raw_text: parts.concat(), segments, elapsed_ms: 10, peak_ram_bytes: None,
            peak_ram_unavailable_reason: Some("not measured in tests".into()), created_at_ms: now_ms,
        };
        db.start_job(&format!("job-{run}"), attempt, now_ms).unwrap();
        db.save_local_transcript(&format!("job-{run}"), attempt, &t, now_ms).unwrap();
    }

    fn phrase(db: &DatabaseOwner, expression: &str) -> String {
        let today = NaiveDate::from_ymd_opt(2026, 10, 16).unwrap();
        db.add_phrase(&PhraseText { original: "from a take", expression, explanation: "", examples: &[] }, None, today).unwrap().id
    }

    fn count(db: &DatabaseOwner, sql: &str) -> i64 {
        db.connection.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn uses_are_recorded_for_new_revisions_and_rescanned_when_a_phrase_is_added() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "s1", "t1");
        transcript(&db, "t1", "t1--1", &[" Honestly, I lost track of the time.", " So I was late."], 10);
        // Added after the take: the rescan finds the earlier use.
        let id = phrase(&db, "lose track of time");
        let uses = db.list_phrase_uses(Some(&id)).unwrap();
        assert_eq!(uses, [PhraseUse { phrase_id: id.clone(), attempt_id: "t1".into(), session_id: "s1".into(), revision_id: "t1--1".into(), segment: 0, local_date: uses[0].local_date.clone() }]);
        // A new take with the phrase is found when its transcript is saved.
        take(&db, &root.0, "s2", "t2");
        transcript(&db, "t2", "t2--1", &[" First point.", " We always lose track of time in meetings."], 20);
        // Only this phrase: a starter phrase may turn up in the same words.
        let found: Vec<(String, u32)> = db.list_phrase_uses(Some(&id)).unwrap().into_iter().map(|u| (u.attempt_id, u.segment)).collect();
        assert_eq!(found.len(), 2);
        assert!(found.contains(&("t2".into(), 1)), "{found:?}");
        // A correction that drops the phrase is the take's current transcript now.
        db.save_transcript_correction("t2", "t2--1", "First point. We often run late in meetings.", 30).unwrap();
        assert_eq!(db.list_phrase_uses(Some(&id)).unwrap().len(), 1);
        // Changing the phrase scans again; a one-word phrase never matches.
        db.update_phrase(&id, &PhraseText { original: "from a take", expression: "late", explanation: "", examples: &[] }).unwrap();
        assert!(db.list_phrase_uses(Some(&id)).unwrap().is_empty());
        // Deleted phrases keep their rows but are not listed or in facts.
        let other = phrase(&db, "lose track of time");
        db.delete_phrase(&other).unwrap();
        assert!(db.list_phrase_uses(Some(&other)).unwrap().is_empty());
        assert_eq!(count(&db, &format!("SELECT count(*) FROM phrase_uses WHERE phrase_id='{other}'")), 1);
        let facts = db.practice_facts("2026-10-16").unwrap();
        assert!(facts.takes.iter().all(|t| !t.phrase_ids.contains(&other) && !t.phrase_ids.contains(&id)), "{:?}", facts.takes);
    }

    #[test]
    fn v2_backfill_adds_runs_without_touching_v1() {
        let root = TestRoot::new();
        {
            let db = DatabaseOwner::open(&root.0).unwrap();
            take(&db, &root.0, "s1", "t1");
            transcript(&db, "t1", "t1--1", &[" Uh, so the first thing I do is plan my day", " because otherwise I lose track of the time", " and then nothing gets done, so yeah."], 10);
            db.set_filler_decision("t1--1", 0, "uh", Some("confirmed"), 11).unwrap();
            // Back to how measures v1 left it: only a v1 run.
            db.connection.lock().unwrap().execute_batch(
                "DELETE FROM metric_values; DELETE FROM analysis_runs;
                 INSERT INTO analysis_runs(id,attempt_id,revision_id,kind,definition_version,settings,created_at_ms) VALUES ('t1--1--measures-v1','t1','t1--1','transcript-measures',1,'{}',10);
                 INSERT INTO metric_values(run_id,metric,value,unit,source) VALUES ('t1--1--measures-v1','word_count',99,'words','Estimated');",
            ).unwrap();
        }
        let db = DatabaseOwner::open(&root.0).unwrap();
        let metric = |run: &str, name: &str| -> Option<f64> {
            db.connection.lock().unwrap().query_row("SELECT value FROM metric_values WHERE run_id=?1 AND metric=?2", params![run, name], |r| r.get(0)).optional().unwrap().flatten()
        };
        assert_eq!(metric("t1--1--measures-v1", "word_count"), Some(99.0), "the v1 run is kept as it was");
        assert_eq!(metric("t1--1--measures-v2", "word_count"), Some(25.0));
        assert_eq!(metric("t1--1--measures-v2", "longest_run_words"), Some(25.0), "three segments 100 ms apart are one run");
        assert_eq!(metric("t1--1--measures-v2", "boundary_pauses"), Some(0.0));
        let reason: Option<String> = db.connection.lock().unwrap()
            .query_row("SELECT unavailable_reason FROM metric_values WHERE run_id='t1--1--measures-v2' AND metric='different_words_per_50'", [], |r| r.get(0)).unwrap();
        assert_eq!(reason.as_deref(), Some("Needs at least 50 words."));
        // Your hesitation decision is still attached under measures v2.
        let view = db.attempt_transcript("t1").unwrap();
        assert_eq!(view["revision"]["measures"]["fillers"][0]["decision"], "confirmed");
        assert_eq!(view["revision"]["measures"]["ending"]["hint"], "trails_off");
        assert_eq!(view["revision"]["measures"]["runs"]["longestWords"], 25);
        let facts = db.practice_facts("2026-10-16").unwrap();
        assert_eq!((facts.takes[0].fillers_confirmed, facts.takes[0].fillers_reviewed, facts.takes[0].longest_run), (Some(1), true, Some(25)));
    }

    #[test]
    fn uses_are_purged_with_the_take() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let id = phrase(&db, "make sense");
        take(&db, &root.0, "s1", "t1");
        transcript(&db, "t1", "t1--1", &[" That makes sense to me."], 10);
        assert!(db.practice_facts("2026-10-16").unwrap().takes[0].phrase_ids.contains(&id));
        db.move_take_to_trash("t1", 20).unwrap();
        assert!(db.list_phrase_uses(Some(&id)).unwrap().is_empty(), "Trash hides the use");
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM phrase_uses"), 0);
    }

    #[test]
    fn self_checks_round_trip_into_facts_and_are_purged() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "s1", "t1");
        db.set_self_check("t1", "point_first", Some(true), 10).unwrap();
        db.set_self_check("t1", "clear_ending", Some(false), 11).unwrap();
        db.set_self_check("t1", "clear_ending", Some(true), 12).unwrap();
        assert!(db.set_self_check("t1", "sounded_great", Some(true), 13).is_err(), "only known checks");
        assert!(db.set_self_check("missing", "point_first", Some(true), 13).is_err());
        let checks: Vec<(String, bool)> = db.list_self_checks("t1").unwrap().into_iter().map(|c| (c.check_id, c.value)).collect();
        assert_eq!(checks, [("clear_ending".into(), true), ("point_first".into(), true)]);
        db.set_self_check("t1", "point_first", None, 14).unwrap();
        let facts = db.practice_facts("2026-10-16").unwrap();
        assert_eq!(facts.takes[0].checks, [("clear_ending".to_string(), true)].into_iter().collect());
        db.move_take_to_trash("t1", 20).unwrap();
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM self_checks"), 0);
    }

    #[test]
    fn comparisons_are_purged_when_either_take_is() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "s1", "t1");
        take(&db, &root.0, "s1", "t1b");
        take(&db, &root.0, "s2", "t2");
        take(&db, &root.0, "s3", "t3");
        assert!(db.save_comparison("t1", "t1b", "a", false, 10).is_err(), "one session uses its preferred take");
        assert!(db.save_comparison("t1", "t2", "best", false, 10).is_err());
        let saved = db.save_comparison("t1", "t2", "b", true, 10).unwrap();
        assert_eq!((saved.preferred.as_str(), saved.blind), ("b", true));
        let second = db.save_comparison("t3", "t1", "same", false, 10).unwrap();
        assert_ne!(saved.id, second.id, "same millisecond, its own ID");
        assert_eq!(db.list_comparisons("t1").unwrap().len(), 2);
        db.move_take_to_trash("t2", 20).unwrap();
        db.delete_takes_permanently(&["t2".into()]).unwrap();
        assert_eq!(db.list_comparisons("t1").unwrap(), [second.clone()]);
        db.move_take_to_trash("t1", 20).unwrap();
        db.delete_takes_permanently(&["t1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM comparisons"), 0);
    }

    #[test]
    fn audio_measures_are_computed_once_and_purged_with_the_take() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.reserve("bursts", "op-bursts", "Take", Some(&context("s1", "familiar", ["", "", ""]))).unwrap();
        // Four voiced bursts a second for 8 s.
        let saved = audio(&root.0, "bursts", 8, |i| {
            let t = i as f64 / 48_000.0;
            let envelope = 0.5 * (1.0 - (std::f64::consts::TAU * 4.0 * t).cos());
            let tone: f64 = (1..=3).map(|h| (std::f64::consts::TAU * 150.0 * h as f64 * t).sin() / h as f64).sum();
            (envelope * tone * 8_000.0) as i16
        });
        db.commit_recording(&saved).unwrap();
        let first = db.audio_measures("bursts").unwrap();
        let rate = first.rate_sps.unwrap_or_else(|| panic!("{first:?}"));
        assert!((rate - 4.0).abs() < 0.4, "{rate}");
        assert_eq!(first.method, "nuclei-v1");
        assert_eq!(count(&db, "SELECT count(*) FROM audio_measures"), 1);
        assert_eq!(db.audio_measures("bursts").unwrap(), first, "served from the stored row");
        assert_eq!(db.practice_facts("2026-10-16").unwrap().takes[0].rate_sps, first.rate_sps);
        // A take too short for a rate keeps the reason.
        take(&db, &root.0, "s2", "short");
        let short = db.audio_measures("short").unwrap();
        assert_eq!((short.rate_sps, short.unavailable_reason.as_deref()), (None, Some("Needs at least 5 seconds of speech.")));
        db.move_take_to_trash("bursts", 20).unwrap();
        assert!(db.audio_measures("bursts").is_err(), "a take in Trash is unavailable");
        db.delete_takes_permanently(&["bursts".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM audio_measures WHERE attempt_id='bursts'"), 0);
    }
}
