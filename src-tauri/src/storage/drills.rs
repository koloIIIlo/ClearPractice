//! Drills (roadmap M10): marks made during a take and each drill take's
//! result. Marks hold keys and numbers only, at most 200 per take; results are
//! computed on first request from what is stored (transcript, waveform, audio,
//! marks and the run's settings), cached, and recomputed when the take's
//! current transcript changes (A-30: numbers and keys only). Both are purged
//! with their take.
use super::insights::CURRENT_REVISION;
use super::{db_error, iso, DatabaseOwner, Result};
use crate::activity_results::{self, Mark, ResultInputs, Segment, DEFINITION_VERSION};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Marks a drill writes (10.1): a word shown, a slip you flagged, a card advanced, a cue shown.
pub const TAKE_EVENT_KINDS: [&str; 4] = ["word_shown", "self_flag", "card_advanced", "cue_shown"];
pub const MAX_TAKE_EVENTS: usize = 200;
const MAX_EVENT_DATA_BYTES: usize = 512;
/// No take is longer than four hours.
const MAX_AT_MS: u64 = 4 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TakeEventInput {
    pub at_ms: u64,
    pub kind: String,
    #[serde(default)]
    pub data: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeEvent {
    pub id: i64,
    pub attempt_id: String,
    pub at_ms: u64,
    pub kind: String,
    pub data: Value,
    pub created_at: String,
}

fn key_like(text: &str) -> bool {
    !text.is_empty() && text.len() <= 40 && text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// A mark's data: keys and numbers, or short lowercase keys as values. Never text you said.
fn validate_event(event: &TakeEventInput) -> Result<()> {
    let data_ok = event.data.iter().all(|(k, v)| {
        !k.is_empty()
            && k.len() <= 40
            && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            && match v {
                Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
                Value::String(s) => key_like(s),
                Value::Bool(_) => true,
                _ => false,
            }
    }) && serde_json::to_string(&event.data).is_ok_and(|s| s.len() <= MAX_EVENT_DATA_BYTES);
    if !TAKE_EVENT_KINDS.contains(&event.kind.as_str()) || event.at_ms > MAX_AT_MS || !data_ok {
        return Err("A mark from this round is invalid.".into());
    }
    Ok(())
}

/// What `activity_result` reads about a take before computing.
struct DrillTake {
    asset: String,
    kind: String,
    params: Map<String, Value>,
    step_index: Option<u32>,
    duration_ms: u64,
    revision: Option<String>,
    revision_source: Option<String>,
    cached: Option<(Option<String>, String)>,
}

impl DatabaseOwner {
    /// Stores a take's marks once it is saved (10.1). At most 200 per take; any
    /// cached result is dropped so the next request counts the new marks.
    pub fn add_take_events(&self, attempt_id: &str, events: &[TakeEventInput]) -> Result<u32> {
        recording::validate_id(attempt_id)?;
        for event in events {
            validate_event(event)?;
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let kind: Option<String> = tx
            .query_row(
                "SELECT e.type FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version \
                 WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL",
                [attempt_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        if !kind.as_deref().is_some_and(crate::exercise_types::is_drill) {
            return Err("This take isn't part of a drill.".into());
        }
        let stored: i64 = tx.query_row("SELECT count(*) FROM take_events WHERE attempt_id=?1", [attempt_id], |r| r.get(0)).map_err(db_error)?;
        if usize::try_from(stored).unwrap_or(usize::MAX).saturating_add(events.len()) > MAX_TAKE_EVENTS {
            return Err("A round keeps at most 200 marks.".into());
        }
        let now = recording::now_ms() as i64;
        for event in events {
            let data = serde_json::to_string(&event.data).map_err(|_| "A mark from this round is invalid.")?;
            tx.execute(
                "INSERT INTO take_events(attempt_id,at_ms,kind,data,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
                params![attempt_id, i64::try_from(event.at_ms).map_err(|_| "A mark from this round is invalid.")?, event.kind, data, now],
            )
            .map_err(db_error)?;
        }
        tx.execute("DELETE FROM activity_results WHERE attempt_id=?1", [attempt_id]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(events.len() as u32)
    }

    pub fn list_take_events(&self, attempt_id: &str) -> Result<Vec<TakeEvent>> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare("SELECT id,attempt_id,at_ms,kind,data,created_at_ms FROM take_events WHERE attempt_id=?1 ORDER BY at_ms,id").map_err(db_error)?;
        let rows = stmt
            .query_map([attempt_id], |r| {
                let data: String = r.get(4)?;
                Ok(TakeEvent {
                    id: r.get(0)?,
                    attempt_id: r.get(1)?,
                    at_ms: u64::try_from(r.get::<_, i64>(2)?).unwrap_or(0),
                    kind: r.get(3)?,
                    data: serde_json::from_str(&data).unwrap_or(Value::Object(Map::new())),
                    created_at: iso(r.get(5)?),
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    fn drill_take(&self, attempt_id: &str) -> Result<DrillTake> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let row = conn
            .query_row(
                &format!(
                    "SELECT a.asset_id,e.type,s.activity_snapshot,tc.challenge,aa.duration_ms,{CURRENT_REVISION},\
                     (SELECT ar.revision_id FROM activity_results ar WHERE ar.attempt_id=a.id AND ar.definition_version=?2),\
                     (SELECT ar.result FROM activity_results ar WHERE ar.attempt_id=a.id AND ar.definition_version=?2) \
                     FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                     JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version JOIN audio_assets aa ON aa.id=a.asset_id \
                     LEFT JOIN task_conditions tc ON tc.attempt_id=a.id \
                     WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL"
                ),
                params![attempt_id, DEFINITION_VERSION],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?,
                        r.get::<_, Option<String>>(7)?,
                    ))
                },
            )
            .optional()
            .map_err(db_error)?
            .ok_or("This take is unavailable.")?;
        let (asset, kind, snapshot, challenge, duration, revision, cached_revision, cached_result) = row;
        let kind = kind.filter(|k| crate::exercise_types::is_drill(k)).ok_or("This take isn't part of a drill.")?;
        let revision_source: Option<String> = match &revision {
            Some(id) => conn.query_row("SELECT source FROM transcript_revisions WHERE id=?1", [id], |r| r.get(0)).optional().map_err(db_error)?,
            None => None,
        };
        let params = snapshot
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.get("params").and_then(Value::as_object).cloned())
            .unwrap_or_default();
        let step_index = challenge
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|c| c["index"].as_u64())
            .and_then(|i| u32::try_from(i).ok());
        Ok(DrillTake {
            asset,
            kind,
            params,
            step_index,
            duration_ms: u64::try_from(duration).unwrap_or(0),
            revision,
            revision_source,
            cached: cached_result.map(|result| (cached_revision, result)),
        })
    }

    /// The take's current transcript as segments: your correction as one untimed segment, else the machine's.
    fn current_segments(&self, revision: &str, source: Option<&str>) -> Result<Vec<Segment>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        if source == Some("user") {
            let text: String = conn.query_row("SELECT text FROM transcript_revisions WHERE id=?1", [revision], |r| r.get(0)).map_err(db_error)?;
            return Ok(vec![Segment { text, start_ms: None, end_ms: None }]);
        }
        let ms = |v: Option<i64>| v.and_then(|v| u64::try_from(v).ok());
        let mut stmt = conn.prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
        let rows = stmt
            .query_map([revision], |r| Ok(Segment { text: r.get(0)?, start_ms: ms(r.get(1)?), end_ms: ms(r.get(2)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// A drill take's result (10.1), cached until its current transcript changes.
    /// Heavy work (the waveform, the audio) runs without holding the database.
    pub fn activity_result(&self, attempt_id: &str) -> Result<Value> {
        recording::validate_id(attempt_id)?;
        let take = self.drill_take(attempt_id)?;
        let with_id = |mut result: Value| {
            if let Some(o) = result.as_object_mut() {
                o.insert("attemptId".into(), Value::from(attempt_id));
                o.insert("definitionVersion".into(), Value::from(DEFINITION_VERSION));
            }
            result
        };
        if let Some((revision, result)) = &take.cached {
            if *revision == take.revision {
                if let Ok(result) = serde_json::from_str::<Value>(result) {
                    return Ok(with_id(result));
                }
            }
        }
        let segments = match &take.revision {
            Some(id) => Some(self.current_segments(id, take.revision_source.as_deref())?),
            None => None,
        };
        let measures = segments.as_ref().map(|segments| {
            let inputs: Vec<crate::analysis::SegmentInput> = segments.iter().map(|s| crate::analysis::SegmentInput { text: &s.text, start_ms: s.start_ms, end_ms: s.end_ms }).collect();
            crate::analysis::measure(&inputs)
        });
        let voice = match take.kind.as_str() {
            "emphasis" | "pace_ladder" => None,
            _ => self.waveform(&take.asset).ok().map(|p| crate::analysis::voice_activity(&p.peaks, p.samples_per_peak, p.sample_rate)),
        };
        let (rate_sps, rate_reason) = if take.kind == "pace_ladder" {
            match self.audio_measures(attempt_id) {
                Ok(m) => (m.rate_sps, m.unavailable_reason),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let prominence = if take.kind == "emphasis" {
            let sentence = take.step_index.and_then(|i| take.params.get("sentences").and_then(Value::as_array).and_then(|s| s.get(i as usize)).and_then(Value::as_str).map(String::from));
            match sentence {
                Some(sentence) => {
                    self.checked_recording(&take.asset)?;
                    let (samples, rate) = crate::prosody::prepared_samples(&self.root, &take.asset)?;
                    let words: Vec<&str> = sentence.split_whitespace().collect();
                    Some(crate::prosody::prominence(&samples, rate, &words))
                }
                None => None,
            }
        } else {
            None
        };
        let marks = self
            .list_take_events(attempt_id)?
            .into_iter()
            .map(|e| Mark { at_ms: e.at_ms, kind: e.kind, data: e.data.as_object().cloned().unwrap_or_default() })
            .collect();
        let result = activity_results::compute(&ResultInputs {
            kind: &take.kind,
            params: &take.params,
            step_index: take.step_index,
            duration_ms: take.duration_ms,
            segments,
            measures,
            voice,
            rate_sps,
            rate_reason,
            marks,
            prominence,
        });
        let text = serde_json::to_string(&result).map_err(|_| "The result could not be stored.")?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        // A take moved to Trash or purged meanwhile keeps no row.
        conn.execute(
            "INSERT OR REPLACE INTO activity_results(attempt_id,definition_version,revision_id,result,created_at_ms) \
             SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND capture_state='saved' AND deleted_at_ms IS NULL)",
            params![attempt_id, DEFINITION_VERSION, take.revision, text, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        Ok(with_id(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::{ActivityContext, ActivityStep};
    use crate::audio::whisper::{Backend, Segment as Spoken, Transcript};
    use crate::storage::database::engagement::tests::context;
    use crate::storage::database::PracticeContext;
    use crate::storage::recording::{tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
    use serde_json::json;
    use std::path::Path;

    fn audio(root: &Path, id: &str) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for _ in 0..48_000 {
            w.push(1000).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }

    fn drill(session: &str, kind: &str, params: Value, index: u32) -> PracticeContext {
        let mut c = context(session, "familiar", ["", "", ""]);
        c.exercise_id = format!("ex-{}", kind.replace('_', "-"));
        c.exercise_type = kind.into();
        c.activity = Some(ActivityContext { version: 1, seed: "seed-1".into(), group_id: None, params: params.as_object().cloned().unwrap_or_default() });
        c.step = Some(ActivityStep { index, key: format!("round-{index}"), prompt_id: None });
        c
    }

    fn take(db: &DatabaseOwner, root: &Path, id: &str, c: &PracticeContext) {
        db.reserve(id, &format!("op-{id}"), "Take", Some(c)).unwrap();
        db.commit_recording(&audio(root, id)).unwrap();
    }

    fn transcript(db: &DatabaseOwner, attempt: &str, parts: &[&str]) -> String {
        let segments: Vec<Spoken> = parts
            .iter()
            .enumerate()
            .map(|(i, text)| Spoken { text: (*text).into(), start_ms: Some(i as u64 * 300), end_ms: Some(i as u64 * 300 + 250), timing_source: "Estimated".into(), timing_unavailable_reason: None })
            .collect();
        let t = Transcript {
            version: 1, run_id: format!("run-{attempt}"), asset_id: attempt.into(), provider: "local-whisper".into(), model_id: "base".into(),
            model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(), backend: Backend::Cpu, threads: 4, prompt: None,
            source_sha256: "b".repeat(64), prepared_sha256: "c".repeat(64), language: "en".into(),
            raw_text: parts.concat(), segments, elapsed_ms: 10, peak_ram_bytes: None,
            peak_ram_unavailable_reason: Some("not measured in tests".into()), created_at_ms: 1_000,
        };
        db.start_job(&format!("job-{attempt}"), attempt, 1_000).unwrap();
        db.save_local_transcript(&format!("job-{attempt}"), attempt, &t, 1_000).unwrap();
        db.attempt_transcript(attempt).unwrap()["revision"]["id"].as_str().unwrap().to_string()
    }

    fn count(db: &DatabaseOwner, sql: &str) -> i64 {
        db.connection.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn event(at_ms: u64, kind: &str, data: Value) -> TakeEventInput {
        TakeEventInput { at_ms, kind: kind.into(), data: data.as_object().cloned().unwrap_or_default() }
    }

    #[test]
    fn take_events_are_validated_capped_and_purged_with_the_take() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "j1", &drill("s1", "jam", json!({}), 0));
        assert_eq!(db.add_take_events("j1", &[event(1_200, "self_flag", json!({})), event(40, "word_shown", json!({"index": 2, "word": "wb-umbrella"}))]).unwrap(), 2);
        let listed = db.list_take_events("j1").unwrap();
        assert_eq!(listed.iter().map(|e| (e.at_ms, e.kind.as_str())).collect::<Vec<_>>(), [(40, "word_shown"), (1_200, "self_flag")]);
        for bad in [
            event(10, "shouted", json!({})),
            event(10, "self_flag", json!({"note": "I was nervous"})),
            event(10, "self_flag", json!({"nested": {"a": 1}})),
            event(5 * 60 * 60 * 1000, "self_flag", json!({})),
        ] {
            assert!(db.add_take_events("j1", &[bad.clone()]).is_err(), "{bad:?}");
        }
        let many: Vec<TakeEventInput> = (0..199).map(|k| event(k, "self_flag", json!({}))).collect();
        assert!(db.add_take_events("j1", &many).is_err(), "at most 200 per take");
        assert_eq!(db.add_take_events("j1", &many[..198]).unwrap(), 198);
        // Ordinary practice keeps no marks and has no drill result.
        db.reserve("r1", "op-r1", "Take", Some(&context("s2", "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(&root.0, "r1")).unwrap();
        assert!(db.add_take_events("r1", &[event(10, "self_flag", json!({}))]).is_err());
        assert!(db.activity_result("r1").is_err());
        db.activity_result("j1").unwrap();
        db.move_take_to_trash("j1", 20).unwrap();
        assert!(db.activity_result("j1").is_err(), "a take in Trash has no result");
        db.delete_takes_permanently(&["j1".into()]).unwrap();
        assert_eq!(count(&db, "SELECT count(*) FROM take_events"), 0);
        assert_eq!(count(&db, "SELECT count(*) FROM activity_results"), 0);
    }

    #[test]
    fn activity_result_is_cached_and_recomputed_after_a_correction() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        take(&db, &root.0, "j1", &drill("s1", "jam", json!({}), 0));
        let before = db.activity_result("j1").unwrap();
        assert!(before["cleanSeconds"].is_null() && before["hesitations"].is_null(), "no transcript yet: {before}");
        let machine = transcript(&db, "j1", &["So um I", "uh like", "tea"]);
        let first = db.activity_result("j1").unwrap();
        assert_eq!((first["kind"].as_str(), first["hesitations"].as_u64(), first["attemptId"].as_str()), (Some("jam"), Some(2), Some("j1")));
        let stored = || {
            db.connection
                .lock()
                .unwrap()
                .query_row("SELECT revision_id,created_at_ms FROM activity_results WHERE attempt_id='j1'", [], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, i64>(1)?)))
                .unwrap()
        };
        let cached = stored();
        assert_eq!(cached.0.as_deref(), Some(machine.as_str()));
        assert_eq!(db.activity_result("j1").unwrap(), first, "served from the cache");
        assert_eq!(stored(), cached);
        // Your correction is the current transcript now: the result follows it.
        let correction = db.save_transcript_correction("j1", &machine, "So I like tea", 2_000).unwrap();
        assert_eq!(db.activity_result("j1").unwrap()["hesitations"], 0);
        assert_eq!(stored().0.as_deref(), Some(correction.as_str()));
        // A mark added later is counted on the next request.
        db.add_take_events("j1", &[event(300, "self_flag", json!({}))]).unwrap();
        assert_eq!(db.activity_result("j1").unwrap()["flags"], 1);
        let facts = db.practice_facts("2026-10-16").unwrap();
        let result = facts.takes[0].result.as_ref().expect("the cached result is in the facts");
        assert_eq!((result.get("hesitations"), result.get("flags")), (Some(&0.0), Some(&1.0)));
        assert_eq!(facts.sessions[0].activity.as_ref().map(|a| a["seed"].clone()), Some(json!("seed-1")));
    }

    #[test]
    fn drill_round_xp_once_per_session() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let jam = drill("s1", "jam", json!({}), 0);
        take(&db, &root.0, "j1", &jam);
        take(&db, &root.0, "j2", &jam);
        take(&db, &root.0, "e1", &drill("s2", "emphasis", json!({"sentences": ["I didn't say she stole my money"], "targets": ["2"]}), 0));
        db.reserve("r1", "op-r1", "Take", Some(&context("s3", "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&audio(&root.0, "r1")).unwrap();
        let rounds: Vec<(String, u32)> = db.list_practice_events(None).unwrap().into_iter().filter(|e| e.kind == "drill_round").map(|e| (e.ref_id, e.xp)).collect();
        // One per drill session, even for a three-second emphasis round; none for ordinary practice.
        assert_eq!(rounds, [("s1".to_string(), 15), ("s2".to_string(), 15)]);
    }
}
