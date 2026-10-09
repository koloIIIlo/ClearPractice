//! One connection owner serializes all storage work. Files remain immutable;
//! receipts survive a failed reference transaction and are reconciled on reopen.
use super::recording::{self, SavedRecording};
use crate::audio::prepare::contained;
use chrono::{DateTime, Local, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

type Result<T> = std::result::Result<T, String>;

#[path = "library.rs"]
pub mod library;
#[path = "phrases.rs"]
pub mod phrases;
#[path = "coaching_runs.rs"]
pub mod coaching_runs;
const VERSION: i64 = 15;
/// Database schema this build reads and writes; newer backups are refused.
pub const SCHEMA_VERSION: i64 = VERSION;
const DAY_MS: i64 = 86_400_000;
/// Trash retention a user may choose; 30 days is the default (§6 Sessions).
pub const RETENTION_CHOICES: [u32; 4] = [1, 7, 14, 30];
fn db_error(_: rusqlite::Error) -> String {
    "Session storage is unavailable. Your recording files are preserved.".into()
}
fn io_error(_: std::io::Error) -> String {
    "Session storage cannot be accessed. Check space and folder permissions.".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PracticeContext {
    pub session_id: String,
    pub exercise_id: String,
    pub exercise_version: u32,
    pub exercise_type: String,
    pub prompt: String,
    pub outline: Outline,
    pub conditions: Conditions,
    /// Bundled curriculum version and item used (4.5); absent for older callers.
    #[serde(default)]
    pub curriculum_version: Option<u32>,
    #[serde(default)]
    pub content_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outline {
    pub point: String,
    pub reason: String,
    pub example: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conditions {
    pub familiarity: String,
    pub preparation_seconds: u32,
    pub target_seconds: u32,
    pub audience: Option<String>,
    pub follow_up: bool,
}
impl PracticeContext {
    fn validate(&self) -> Result<()> {
        recording::validate_id(&self.session_id)?;
        recording::validate_id(&self.exercise_id)?;
        if self.exercise_version == 0
            || self.exercise_version > 10_000
            || !["repeat", "thought_groups", "imitate", "expression"]
                .contains(&self.exercise_type.as_str())
            || !["familiar", "unfamiliar"].contains(&self.conditions.familiarity.as_str())
            || !(1..=3600).contains(&self.conditions.target_seconds)
            || self.conditions.preparation_seconds > 3600
            || self
                .conditions
                .audience
                .as_ref()
                .is_some_and(|s| s.len() > 512)
            || [
                &self.prompt,
                &self.outline.point,
                &self.outline.reason,
                &self.outline.example,
            ]
            .iter()
            .any(|s| s.len() > 8192 || s.contains('\0'))
        {
            return Err("Practice details are invalid or too long.".into());
        }
        Ok(())
    }
}

pub struct DatabaseOwner {
    root: PathBuf,
    connection: Mutex<Connection>,
    /// `total_changes()` when the temporary search index was last rebuilt.
    search_built_at: Mutex<Option<u64>>,
}
impl DatabaseOwner {
    pub fn open(root: &Path) -> Result<Self> {
        let folder = root.join("database");
        contained(root, &folder)?;
        let path = folder.join("app.sqlite");
        let existed = path.exists();
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let candidate = folder.join(format!("app.sqlite{suffix}"));
            if candidate.exists() {
                contained(root, &candidate)?;
            }
        }
        let mut connection = Connection::open(&path).map_err(db_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(db_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(db_error)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        if version > VERSION {
            return Err(
                "This database needs a newer ClearPractice version. It was not changed.".into(),
            );
        }
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(db_error)?;
        if integrity != "ok" {
            return Err(
                "The session database needs recovery. Recording files are preserved.".into(),
            );
        }
        if version < VERSION {
            if existed {
                snapshot(
                    &connection,
                    root,
                    &format!("before-v{VERSION}-{}", recording::now_ms()),
                )?;
            }
            if version < 1 {
                migrate(&mut connection, include_str!("schema-v1.sql"))?;
            }
            if version < 2 {
                migrate(&mut connection, include_str!("schema-v2.sql"))?;
            }
            if version < 3 {
                migrate(&mut connection, include_str!("schema-v3.sql"))?;
            }
            if version < 4 {
                migrate(&mut connection, include_str!("schema-v4.sql"))?;
            }
            if version < 5 {
                migrate(&mut connection, include_str!("schema-v5.sql"))?;
            }
            if version < 6 {
                migrate(&mut connection, include_str!("schema-v6.sql"))?;
            }
            if version < 7 {
                migrate(&mut connection, include_str!("schema-v7.sql"))?;
            }
            if version < 8 {
                migrate(&mut connection, include_str!("schema-v8.sql"))?;
            }
            if version < 9 {
                migrate(&mut connection, include_str!("schema-v9.sql"))?;
            }
            if version < 10 {
                migrate(&mut connection, include_str!("schema-v10.sql"))?;
            }
            if version < 11 {
                migrate(&mut connection, include_str!("schema-v11.sql"))?;
            }
            if version < 12 {
                migrate(&mut connection, include_str!("schema-v12.sql"))?;
            }
            if version < 13 {
                migrate(&mut connection, include_str!("schema-v13.sql"))?;
            }
            if version < 14 {
                migrate(&mut connection, include_str!("schema-v14.sql"))?;
            }
            migrate(&mut connection, include_str!("schema-v15.sql"))?;
        }
        backfill_measures(&connection)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(db_error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(db_error)?;
        let owner = Self {
            root: root.into(),
            connection: Mutex::new(connection),
            search_built_at: Mutex::new(None),
        };
        owner.reconcile()?;
        Ok(owner)
    }

    pub fn reserve(
        &self,
        id: &str,
        key: &str,
        title: &str,
        context: Option<&PracticeContext>,
    ) -> Result<()> {
        recording::validate_id(id)?;
        recording::validate_id(key)?;
        if title.len() > 8192 || title.contains('\0') {
            return Err("Recording title is invalid.".into());
        }
        if let Some(c) = context {
            c.validate()?;
        }
        let request = json!({"title":title,"context":context}).to_string();
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let prior: Option<(String,String,String)>=tx.query_row("SELECT id,idempotency_key,request_snapshot FROM attempts WHERE id=?1 OR idempotency_key=?2",params![id,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
        if let Some((prior_id, prior_key, prior_request)) = prior {
            if prior_id != id || prior_key != key || prior_request != request {
                return Err(
                    "This recording operation was already used with different details.".into(),
                );
            }
            return Ok(());
        }
        insert_reservation(&tx, id, key, title, context, recording::now_ms(), &request)?;
        tx.commit().map_err(db_error)
    }

    pub fn commit_recording(&self, saved: &SavedRecording) -> Result<()> {
        recording::validate_id(&saved.asset_id)?;
        if saved.asset_id != saved.attempt_id {
            return Err("Recording identity does not match.".into());
        }
        let path = recording::playback_path(&self.root, &saved.asset_id)?;
        contained(&self.root, &path)?;
        // Trust native verified receipts, never a UI-supplied path or hash.
        let receipt = recording::read_saved(&self.root, &saved.asset_id)?
            .ok_or("Recording receipt is missing.")?;
        if serde_json::to_value(saved).ok() != serde_json::to_value(&receipt).ok() {
            return Err("Recording receipt changed.".into());
        }
        let bytes =
            i64::try_from(saved.bytes).map_err(|_| "Recording size exceeds storage limits.")?;
        let duration = i64::try_from(saved.duration_ms)
            .map_err(|_| "Recording duration exceeds storage limits.")?;
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let prior: Option<(String, i64)> = tx
            .query_row(
                "SELECT sha256,bytes FROM audio_assets WHERE id=?1",
                [&saved.asset_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        if let Some((hash, prior_bytes)) = prior {
            if hash != saved.sha256 || prior_bytes != bytes {
                return Err(
                    "Stored recording identity changed; the reference was not overwritten.".into(),
                );
            }
        } else {
            let reserved: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1)",
                    [&saved.attempt_id],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if !reserved {
                insert_reservation(
                    &tx,
                    &saved.attempt_id,
                    &format!("legacy-{}", saved.attempt_id),
                    &saved.title,
                    None,
                    saved.created_at_ms,
                    "legacy-json-receipt",
                )?;
            }
            tx.execute("INSERT INTO audio_assets(id,relative_path,sha256,bytes,sample_rate,channels,duration_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![saved.asset_id,format!("recordings/{}/audio.wav",saved.asset_id),saved.sha256,bytes,saved.sample_rate,saved.channels,duration]).map_err(db_error)?;
        }
        tx.execute(
            "UPDATE attempts SET capture_state='saved',asset_id=?1 WHERE id=?2",
            params![saved.asset_id, saved.attempt_id],
        )
        .map_err(db_error)?;
        tx.execute(
            "UPDATE audio_assets SET unavailable_reason=NULL WHERE id=?1",
            [&saved.asset_id],
        )
        .map_err(db_error)?;
        tx.execute("UPDATE session_steps SET status='completed' WHERE id=(SELECT step_id FROM attempts WHERE id=?1)",[&saved.attempt_id]).map_err(db_error)?;
        tx.execute("UPDATE sessions SET status='completed' WHERE id=(SELECT session_id FROM session_steps WHERE id=(SELECT step_id FROM attempts WHERE id=?1))",[&saved.attempt_id]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }

    fn reconcile(&self) -> Result<()> {
        // Files of an interrupted permanent delete are removed before anything is imported.
        let _ = self.finish_purges();
        for saved in recording::list_saved(&self.root)? {
            if self.is_purged(&saved.asset_id)? {
                continue;
            }
            // A bad individual asset must not hide healthy history or modify it.
            let known = {
                let conn=self.connection.lock().map_err(|_|"Session storage owner is unavailable.")?;
                conn.query_row("SELECT EXISTS(SELECT 1 FROM audio_assets WHERE id=?1)",[&saved.asset_id],|r|r.get::<_,bool>(0)).map_err(db_error)?
            };
            if known && self.checked_recording(&saved.asset_id).is_err() { continue; }
            if recording::playback_path(&self.root, &saved.asset_id).is_ok() {
                self.commit_recording(&saved)?;
            }
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("UPDATE attempts SET capture_state='interrupted' WHERE capture_state IN ('preparing','recording','finalizing')",[]).map_err(db_error)?;
        conn.execute("UPDATE jobs SET state='interrupted',error_message='ClearPractice closed before this transcription finished. The recording is unchanged; transcribe it again.' WHERE state IN ('queued','running')",[]).map_err(db_error)?;
        conn.execute("UPDATE sessions SET status='interrupted' WHERE id IN (SELECT s.session_id FROM session_steps s JOIN attempts a ON a.step_id=s.id WHERE a.capture_state='interrupted')",[]).map_err(db_error)?;
        let ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM audio_assets")
                .map_err(db_error)?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(db_error)?;
            rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
        };
        drop(conn);
        for id in ids {
            let reason = self.checked_recording(&id).err();
            let conn=self.connection.lock().map_err(|_|"Session storage owner is unavailable.")?;
            conn.execute(
                "UPDATE audio_assets SET unavailable_reason=?1 WHERE id=?2",
                params![reason, id],
            )
            .map_err(db_error)?;
        }
        // Expiry is retried on every start; it must never block access to history.
        let _ = self.purge_expired(recording::now_ms());
        Ok(())
    }

    pub fn checked_recording(&self, id:&str) -> Result<SavedRecording> {
        recording::validate_id(id)?;
        let (relative,hash,bytes,rate,channels,duration):(String,String,i64,u32,u16,i64) = {
            let conn=self.connection.lock().map_err(|_|"Session storage owner is unavailable.")?;
            conn.query_row("SELECT relative_path,sha256,bytes,sample_rate,channels,duration_ms FROM audio_assets WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(db_error)?.ok_or("The recording has no committed session reference. Reopen the app to reconcile its receipt.")?
        };
        if relative != format!("recordings/{id}/audio.wav") { return Err("The recording reference has an invalid path.".into()); }
        let saved=recording::read_saved(&self.root,id)?.ok_or("Saved recording receipt is missing.")?;
        if saved.sha256!=hash || i64::try_from(saved.bytes).ok()!=Some(bytes)
            || saved.sample_rate!=rate || saved.channels!=channels || i64::try_from(saved.duration_ms).ok()!=Some(duration) {
            return Err("Recording identity differs from the committed asset. Its original reference was preserved.".into());
        }
        let path=recording::playback_path(&self.root,id)?;
        contained(&self.root,&path)?;
        Ok(saved)
    }

    pub fn playback_path(&self,id:&str) -> Result<PathBuf> {
        self.checked_recording(id)?;
        Ok(self.root.join("recordings").join(id).join("audio.wav"))
    }

    /// A take's intonation (P.3): served from its stored track when the record,
    /// source audio and artifact checksum all agree, otherwise computed and stored.
    pub fn prosody(&self, id: &str) -> Result<crate::prosody::Contour> {
        use crate::prosody::{self as p, Contour};
        use sha2::Digest as _;
        let saved = self.checked_recording(id)?;
        let attempt: String = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            conn.query_row("SELECT id FROM attempts WHERE asset_id=?1 AND capture_state='saved'", [id], |r| r.get(0))
                .optional().map_err(db_error)?.ok_or("This take is unavailable.")?
        };
        type Row = (String, String, i64, Option<f64>, Option<f64>, Option<f64>, Option<String>);
        let stored: Option<Row> = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            conn.query_row(
                "SELECT artifact_path,artifact_sha256,hop_ms,median_f0_hz,range_semitones,loudness_range_db,unavailable_reason FROM prosody_tracks WHERE attempt_id=?1 AND algorithm=?2 AND definition_version=?3 AND source_sha256=?4",
                params![attempt, p::ALGORITHM, p::DEFINITION_VERSION, saved.sha256],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            ).optional().map_err(db_error)?
        };
        if let Some((path, sha, hop, median, range, loudness, reason)) = stored {
            let file = self.root.join(&path);
            let bytes = (path.starts_with("cache/prosody/") && contained(&self.root, &file).is_ok())
                .then(|| fs::read(&file).ok()).flatten();
            if let Some(bytes) = bytes.filter(|b| format!("{:x}", sha2::Sha256::digest(b)) == sha) {
                if let (Ok((f0_hz, rms_db)), Some((hop_ms, sample_rate))) = (p::decode_frames(&bytes), p::artifact_timing(&bytes)) {
                    if i64::try_from(hop_ms).ok() == Some(hop) {
                        let narrow = |v: Option<f64>| v.map(|x| x as f32);
                        return Ok(Contour { algorithm: p::ALGORITHM, source: "Estimated", hop_ms, sample_rate, f0_hz, rms_db,
                            median_f0_hz: narrow(median), range_semitones: narrow(range), loudness_range_db: narrow(loudness), unavailable_reason: reason });
                    }
                }
            }
        }
        // Missing, stale or altered: rebuild from the audio and replace the record.
        let contour = p::compute(&self.root, id)?;
        let bytes = p::encode_frames(&contour);
        let sha = format!("{:x}", sha2::Sha256::digest(&bytes));
        let now = recording::now_ms();
        let run_id = format!("{attempt}--prosody-{now}");
        let relative = format!("cache/prosody/{attempt}--{}-{}-d{}.bin", &saved.sha256[..16], p::ALGORITHM, p::DEFINITION_VERSION);
        let file = self.root.join(&relative);
        let dir = self.root.join("cache").join("prosody");
        fs::create_dir_all(&dir).map_err(io_error)?;
        contained(&self.root, &dir)?;
        let part = file.with_extension("part");
        fs::write(&part, &bytes).map_err(io_error)?;
        fs::rename(&part, &file).map_err(io_error)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT OR REPLACE INTO prosody_tracks(id,attempt_id,run_id,algorithm,settings,hop_ms,definition_version,source_sha256,artifact_path,artifact_sha256,frame_count,median_f0_hz,range_semitones,loudness_range_db,unavailable_reason,created_at_ms) VALUES (?1,?2,?1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![run_id, attempt, p::ALGORITHM, p::settings(), i64::try_from(contour.hop_ms).map_err(|_| "Invalid hop.")?, p::DEFINITION_VERSION, saved.sha256, relative, sha,
                i64::try_from(contour.f0_hz.len()).map_err(|_| "Too many frames.")?, contour.median_f0_hz.map(f64::from), contour.range_semitones.map(f64::from),
                contour.loudness_range_db.map(f64::from), contour.unavailable_reason, i64::try_from(now).map_err(|_| "Invalid date.")?],
        ).map_err(db_error)?;
        Ok(contour)
    }

    pub fn waveform(&self, id: &str) -> Result<crate::audio::peaks::WaveformPeaks> {
        let saved = self.checked_recording(id)?;
        crate::audio::peaks::load_or_build(&self.root, &saved)
    }

    pub fn list_sessions(
        &self,
        query: Option<&str>,
        exercise: Option<&str>,
        favorites: bool,
    ) -> Result<Vec<Value>> {
        if query.is_some_and(|q| q.len() > 8192) {
            return Err("Search text is too long.".into());
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT s.id,s.title,s.local_date,s.started_at_ms,e.type,s.favorite,s.notes,s.tags,s.status,COALESCE(SUM(aa.duration_ms),0),COUNT(a.asset_id) FROM sessions s JOIN session_steps st ON st.session_id=s.id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version LEFT JOIN attempts a ON a.step_id=st.id AND a.deleted_at_ms IS NULL LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE s.deleted_at_ms IS NULL GROUP BY s.id HAVING COUNT(a.asset_id)>0 OR s.status='completed' ORDER BY s.started_at_ms DESC,s.id DESC").map_err(db_error)?;
        let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"localDate":r.get::<_,String>(2)?,"startedAt":iso(r.get(3)?),"exerciseType":r.get::<_,Option<String>>(4)?,"favorite":r.get::<_,bool>(5)?,"hasNote":!r.get::<_,String>(6)?.is_empty(),"tags":serde_json::from_str::<Value>(&r.get::<_,String>(7)?).unwrap_or(json!([])),"status":r.get::<_,String>(8)?,"durationMs":r.get::<_,i64>(9)?,"attemptCount":r.get::<_,i64>(10)?}))).map_err(db_error)?;
        let mut out = Vec::new();
        for row in rows {
            let s = row.map_err(db_error)?;
            if favorites && s["favorite"] != true {
                continue;
            }
            if exercise.is_some_and(|e| s["exerciseType"].as_str() != Some(e)) {
                continue;
            }
            if let Some(q) = query {
                let notes: String = conn
                    .query_row(
                        "SELECT notes FROM sessions WHERE id=?1",
                        [s["id"].as_str().unwrap_or("")],
                        |r| r.get(0),
                    )
                    .map_err(db_error)?;
                if !format!(
                    "{} {notes} {}",
                    s["title"].as_str().unwrap_or(""),
                    s["tags"]
                )
                .to_lowercase()
                .contains(&q.to_lowercase())
                {
                    continue;
                }
            }
            out.push(s);
        }
        Ok(out)
    }

    pub fn get_session(&self, id: &str) -> Result<Value> {
        recording::validate_id(id)?;
        let mut summary = self
            .list_sessions(None, None, false)?
            .into_iter()
            .find(|s| s["id"] == id)
            .ok_or("This session is unavailable.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        #[allow(clippy::type_complexity)]
        let (prompt, outline, focus, notes, curriculum_version, content_id, ease, takeaway, preferred_take): (
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT prompt_snapshot,outline_snapshot,focus,notes,curriculum_version,content_id,ease,takeaway,preferred_take FROM sessions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
            )
            .map_err(db_error)?;
        let mut stmt=conn.prepare("SELECT a.id,a.ordinal,a.created_at_ms,aa.duration_ms,aa.unavailable_reason,t.familiarity,t.preparation_seconds,t.target_seconds,t.audience,t.follow_up FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN audio_assets aa ON aa.id=a.asset_id LEFT JOIN task_conditions t ON t.attempt_id=a.id WHERE st.session_id=?1 AND a.deleted_at_ms IS NULL ORDER BY a.ordinal").map_err(db_error)?;
        let mut conditions = Value::Null;
        let mut attempts = Vec::new();
        let mut rows = stmt.query([id]).map_err(db_error)?;
        while let Some(r) = rows.next().map_err(db_error)? {
            if conditions.is_null() {
                if let Some(f) = r.get::<_, Option<String>>(5).map_err(db_error)? {
                    conditions = json!({"familiarity":f,"preparationSeconds":r.get::<_,u32>(6).map_err(db_error)?,"targetSeconds":r.get::<_,u32>(7).map_err(db_error)?,"audience":r.get::<_,Option<String>>(8).map_err(db_error)?,"followUp":r.get::<_,bool>(9).map_err(db_error)?});
                }
            }
            let ordinal: u32 = r.get(1).map_err(db_error)?;
            attempts.push(json!({"id":r.get::<_,String>(0).map_err(db_error)?,"ordinal":ordinal,"captureState":"saved","analysisState":null,"durationMs":r.get::<_,i64>(3).map_err(db_error)?,"createdAt":iso(r.get(2).map_err(db_error)?),"firstTake":ordinal==1,"audioUnavailableReason":r.get::<_,Option<String>>(4).map_err(db_error)?}));
        }
        summary["prompt"] = json!(prompt.unwrap_or_default());
        summary["outline"] = outline
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({"point":"","reason":"","example":""}));
        summary["focus"] = json!(focus);
        summary["notes"] = json!(notes);
        summary["curriculumVersion"] = json!(curriculum_version);
        summary["contentId"] = json!(content_id);
        summary["ease"] = json!(ease);
        summary["takeaway"] = json!(takeaway);
        // A take that has since been deleted no longer counts as the preference.
        summary["preferredTake"] = json!(preferred_take.filter(|p| p == "same" || attempts.iter().any(|a| a["id"] == p.as_str())));
        summary["conditions"] = conditions.clone();
        summary["conditionsUnavailableReason"] = if conditions.is_null() {
            json!("This older recording did not store task conditions.")
        } else {
            Value::Null
        };
        summary["attempts"] = json!(attempts);
        Ok(summary)
    }

    pub fn update_session(
        &self,
        id: &str,
        title: &str,
        notes: &str,
        tags: &[String],
        favorite: bool,
    ) -> Result<()> {
        recording::validate_id(id)?;
        if title.trim().is_empty()
            || title.len() > 512
            || notes.len() > 32_768
            || tags.len() > 20
            || tags
                .iter()
                .any(|s| s.is_empty() || s.len() > 64 || s.contains('\0'))
            || title.contains('\0')
            || notes.contains('\0')
        {
            return Err(
                "Use a title up to 512 characters, notes up to 32 KB, and up to 20 short tags."
                    .into(),
            );
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let count=conn.execute("UPDATE sessions SET title=?1,notes=?2,tags=?3,favorite=?4 WHERE id=?5 AND deleted_at_ms IS NULL",params![title.trim(),notes,serde_json::to_string(tags).map_err(|_|"Invalid tags.")?,favorite,id]).map_err(db_error)?;
        if count != 1 {
            return Err("This session is unavailable.".into());
        }
        Ok(())
    }

    /// The one thing to improve in the next take of a repeated answer (4.6).
    /// `None` clears it. Stored on the session so review shows what was tried.
    pub fn set_session_focus(&self, id: &str, focus: Option<&str>) -> Result<()> {
        recording::validate_id(id)?;
        let focus = focus.map(str::trim).filter(|f| !f.is_empty());
        if focus.is_some_and(|f| f.len() > 160 || f.contains('\0')) {
            return Err("Keep the focus to one short phrase (up to 160 characters).".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute("UPDATE sessions SET focus=?1 WHERE id=?2 AND deleted_at_ms IS NULL", params![focus, id])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This session is unavailable.".into());
        }
        Ok(())
    }

    /// End-of-practice reflection (4.11): an ease rating 1–5 (Your note, not a
    /// score) and one takeaway. `None` leaves a value unchanged.
    pub fn set_session_reflection(&self, id: &str, ease: Option<u8>, takeaway: Option<&str>) -> Result<()> {
        recording::validate_id(id)?;
        if ease.is_some_and(|e| !(1..=5).contains(&e)) {
            return Err("Choose an ease rating from 1 to 5.".into());
        }
        let takeaway = takeaway.map(str::trim);
        if takeaway.is_some_and(|t| t.len() > 500 || t.contains('\0')) {
            return Err("Keep the takeaway under 500 characters.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute(
                "UPDATE sessions SET ease=COALESCE(?1,ease),takeaway=COALESCE(?2,takeaway) WHERE id=?3 AND deleted_at_ms IS NULL",
                params![ease, takeaway.map(|t| if t.is_empty() { None } else { Some(t) }).flatten(), id],
            )
            .map_err(db_error)?;
        if count != 1 {
            return Err("This session is unavailable.".into());
        }
        Ok(())
    }

    /// Which take felt clearer (4.14): one of this session's takes, "same", or
    /// `None` to clear. Your own judgement; never derived from measures.
    pub fn set_preferred_take(&self, id: &str, preferred: Option<&str>) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        if let Some(take) = preferred.filter(|p| *p != "same") {
            let ours: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE a.id=?1 AND st.session_id=?2 AND a.deleted_at_ms IS NULL)",
                    params![take, id],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if !ours {
                return Err("Choose one of this session's takes.".into());
            }
        }
        let count = conn
            .execute("UPDATE sessions SET preferred_take=?1 WHERE id=?2 AND deleted_at_ms IS NULL", params![preferred, id])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This session is unavailable.".into());
        }
        Ok(())
    }

    pub fn insert_clip(&self, clip: &crate::clips::Clip) -> Result<()> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("INSERT INTO reference_clips(id,origin,title,source,transcript,duration_ms,sha256,created_at_ms,description,feature,folder_id,source_id,source_start_ms,source_end_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![clip.id, clip.origin, clip.title, clip.source, clip.transcript, i64::try_from(clip.duration_ms).map_err(|_| "Invalid duration.")?, clip.sha256,
                i64::try_from(clip.created_at_ms).map_err(|_| "Invalid date.")?, clip.description, clip.feature, clip.folder_id, clip.source_id,
                clip.source_start_ms.map(|v| v as i64), clip.source_end_ms.map(|v| v as i64)]).map_err(db_error)?;
        Ok(())
    }

    pub fn has_clip(&self, id: &str) -> bool {
        self.connection.lock().ok().and_then(|conn| conn.query_row("SELECT EXISTS(SELECT 1 FROM reference_clips WHERE id=?1)", [id], |r| r.get(0)).ok()).unwrap_or(false)
    }

    /// Reference clips whose audio is present, bundled first, then newest imports.
    pub fn list_clips(&self) -> Result<Vec<crate::clips::Clip>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare("SELECT id,origin,title,source,transcript,duration_ms,sha256,created_at_ms,description,feature,folder_id,source_id,source_start_ms,source_end_ms FROM reference_clips ORDER BY origin='user', created_at_ms DESC, id").map_err(db_error)?;
        let rows = stmt.query_map([], |r| Ok(crate::clips::Clip {
            id: r.get(0)?, origin: r.get(1)?, title: r.get(2)?, source: r.get(3)?, transcript: r.get(4)?, description: r.get(8)?, feature: r.get(9)?,
            duration_ms: r.get::<_, i64>(5)?.max(0) as u64, sha256: r.get(6)?, created_at_ms: r.get::<_, i64>(7)?.max(0) as u64,
            folder_id: r.get(10)?, source_id: r.get(11)?, source_start_ms: r.get::<_, Option<i64>>(12)?.map(|v| v.max(0) as u64), source_end_ms: r.get::<_, Option<i64>>(13)?.map(|v| v.max(0) as u64),
        })).map_err(db_error)?;
        let clips: Vec<crate::clips::Clip> = rows.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        Ok(clips.into_iter().filter(|c| crate::clips::clip_path(&self.root, &c.id).is_ok_and(|p| p.is_file())).collect())
    }

    pub fn clip_playback_path(&self, id: &str) -> Result<PathBuf> {
        recording::validate_id(id)?;
        let exists: bool = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            conn.query_row("SELECT EXISTS(SELECT 1 FROM reference_clips WHERE id=?1)", [id], |r| r.get(0)).map_err(db_error)?
        };
        if !exists {
            return Err("This clip is no longer available.".into());
        }
        let path = crate::clips::clip_path(&self.root, id)?;
        contained(&self.root, &path)?;
        Ok(path)
    }

    /// Deletes an imported clip and its audio. Bundled clips stay.
    pub fn delete_clip(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let count = conn.execute("DELETE FROM reference_clips WHERE id=?1 AND origin='user'", [id]).map_err(db_error)?;
            if count != 1 {
                return Err("Only clips you imported can be deleted.".into());
            }
        }
        crate::clips::remove_files(&self.root, id)
    }

    pub fn trash_retention_days(&self) -> Result<u32> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key='trash_retention_days'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        // An unreadable setting falls back to the longest retention, never a shorter one.
        Ok(value
            .and_then(|v| v.parse().ok())
            .filter(|d| RETENTION_CHOICES.contains(d))
            .unwrap_or(30))
    }

    pub fn set_trash_retention_days(&self, days: u32) -> Result<()> {
        if !RETENTION_CHOICES.contains(&days) {
            return Err("Choose 1, 7, 14 or 30 days.".into());
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("INSERT INTO app_settings(key,value) VALUES ('trash_retention_days',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[days.to_string()]).map_err(db_error)?;
        Ok(())
    }

    pub fn move_to_trash(&self, id: &str, now_ms: u64) -> Result<()> {
        recording::validate_id(id)?;
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let capturing: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE st.session_id=?1 AND a.capture_state IN ('preparing','recording','finalizing'))",[id],|r|r.get(0)).map_err(db_error)?;
        if capturing {
            return Err("Stop the recording before moving this session to Trash.".into());
        }
        let count = tx
            .execute(
                "UPDATE sessions SET deleted_at_ms=?1 WHERE id=?2 AND deleted_at_ms IS NULL",
                params![now, id],
            )
            .map_err(db_error)?;
        if count != 1 {
            return Err("This session is unavailable.".into());
        }
        tx.commit().map_err(db_error)
    }

    pub fn restore_from_trash(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute(
                "UPDATE sessions SET deleted_at_ms=NULL WHERE id=?1 AND deleted_at_ms IS NOT NULL",
                [id],
            )
            .map_err(db_error)?;
        if count != 1 {
            return Err("This session is no longer in Trash.".into());
        }
        Ok(())
    }

    pub fn list_trash(&self) -> Result<Value> {
        let days = self.trash_retention_days()?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT s.id,s.title,s.local_date,s.deleted_at_ms,COUNT(a.asset_id),COALESCE(SUM(aa.duration_ms),0),COALESCE(SUM(aa.bytes),0),COUNT(a.id)-COUNT(a.asset_id) FROM sessions s LEFT JOIN session_steps st ON st.session_id=s.id LEFT JOIN attempts a ON a.step_id=st.id LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE s.deleted_at_ms IS NOT NULL GROUP BY s.id ORDER BY s.deleted_at_ms DESC,s.id").map_err(db_error)?;
        let rows=stmt.query_map([],|r|{let deleted:i64=r.get(3)?;Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"localDate":r.get::<_,String>(2)?,"deletedAt":iso(deleted),"purgeAt":iso(deleted+i64::from(days)*DAY_MS),"attemptCount":r.get::<_,i64>(4)?,"durationMs":r.get::<_,i64>(5)?,"audioBytes":r.get::<_,i64>(6)?,"unsavedTakeCount":r.get::<_,i64>(7)?}))}).map_err(db_error)?;
        let items = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let mut stmt=conn.prepare("SELECT a.id,s.id,s.title,a.ordinal,a.deleted_at_ms,COALESCE(aa.duration_ms,0),COALESCE(aa.bytes,0) FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.deleted_at_ms IS NOT NULL AND s.deleted_at_ms IS NULL ORDER BY a.deleted_at_ms DESC,a.id").map_err(db_error)?;
        let takes=stmt.query_map([],|r|{let deleted:i64=r.get(4)?;Ok(json!({"id":r.get::<_,String>(0)?,"sessionId":r.get::<_,String>(1)?,"sessionTitle":r.get::<_,String>(2)?,"ordinal":r.get::<_,i64>(3)?,"deletedAt":iso(deleted),"purgeAt":iso(deleted+i64::from(days)*DAY_MS),"durationMs":r.get::<_,i64>(5)?,"audioBytes":r.get::<_,i64>(6)?}))}).map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;
        Ok(json!({"retentionDays":days,"items":items,"takes":takes}))
    }

    /// Takes the recording library must not show: trashed sessions and unfinished purges.
    pub fn hidden_asset_ids(&self) -> Result<std::collections::HashSet<String>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT a.id FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id WHERE s.deleted_at_ms IS NOT NULL OR a.deleted_at_ms IS NOT NULL UNION SELECT id FROM purged_assets").map_err(db_error)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    pub fn is_purged(&self, id: &str) -> Result<bool> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM purged_assets WHERE id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(db_error)
    }

    /// Permanently deletes sessions that are already in Trash. Rows and tombstones
    /// commit together, then files are removed. Returns true when file removal is
    /// still pending; it is retried on the next start and the session never reappears.
    pub fn delete_permanently(&self, ids: &[String]) -> Result<bool> {
        if ids.is_empty() || ids.len() > 1000 {
            return Err("Select between 1 and 1000 sessions.".into());
        }
        for id in ids {
            recording::validate_id(id)?;
        }
        {
            let mut conn = self
                .connection
                .lock()
                .map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.transaction().map_err(db_error)?;
            let now = i64::try_from(recording::now_ms()).map_err(|_| "Invalid date.")?;
            let takes = "SELECT a.id FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE st.session_id=?1";
            for id in ids {
                let trashed: Option<bool> = tx
                    .query_row(
                        "SELECT deleted_at_ms IS NOT NULL FROM sessions WHERE id=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(db_error)?;
                if trashed != Some(true) {
                    return Err("Only sessions in Trash can be deleted permanently.".into());
                }
                purge_take_rows(&tx, takes, id, now)?;
                tx.execute("DELETE FROM attempts WHERE step_id IN (SELECT id FROM session_steps WHERE session_id=?1)",[id]).map_err(db_error)?;
                tx.execute("DELETE FROM audio_assets WHERE id IN (SELECT id FROM purged_assets) AND id NOT IN (SELECT asset_id FROM attempts WHERE asset_id IS NOT NULL)",[]).map_err(db_error)?;
                tx.execute("DELETE FROM session_steps WHERE session_id=?1", [id])
                    .map_err(db_error)?;
                tx.execute("DELETE FROM sessions WHERE id=?1", [id])
                    .map_err(db_error)?;
            }
            tx.commit().map_err(db_error)?;
        }
        Ok(self.finish_purges().is_err())
    }

    pub fn empty_trash(&self) -> Result<bool> {
        let takes = self.trashed_takes_before(i64::MAX)?;
        let mut pending = !takes.is_empty() && self.delete_takes_permanently(&takes)?;
        let ids = self.trashed_before(i64::MAX)?;
        if !ids.is_empty() {
            pending |= self.delete_permanently(&ids)?;
        }
        Ok(pending)
    }

    /// Moves one saved take to Trash (2.23). It disappears from its session,
    /// search, the library and new jobs; the other takes keep their numbers.
    pub fn move_take_to_trash(&self, attempt_id: &str, now_ms: u64) -> Result<()> {
        recording::validate_id(attempt_id)?;
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn.execute(
            "UPDATE attempts SET deleted_at_ms=?1 WHERE id=?2 AND capture_state='saved' AND deleted_at_ms IS NULL AND step_id IN (SELECT st.id FROM session_steps st JOIN sessions s ON s.id=st.session_id WHERE s.deleted_at_ms IS NULL)",
            params![now, attempt_id],
        ).map_err(db_error)?;
        if count != 1 {
            return Err("This take is unavailable.".into());
        }
        Ok(())
    }

    pub fn restore_take(&self, attempt_id: &str) -> Result<()> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute("UPDATE attempts SET deleted_at_ms=NULL WHERE id=?1 AND deleted_at_ms IS NOT NULL", [attempt_id])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This take is no longer in Trash.".into());
        }
        Ok(())
    }

    /// Permanently deletes takes that are in Trash, with everything derived
    /// from them. Returns true when file removal is still pending.
    pub fn delete_takes_permanently(&self, ids: &[String]) -> Result<bool> {
        if ids.is_empty() || ids.len() > 1000 {
            return Err("Select between 1 and 1000 takes.".into());
        }
        for id in ids {
            recording::validate_id(id)?;
        }
        {
            let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.transaction().map_err(db_error)?;
            let now = i64::try_from(recording::now_ms()).map_err(|_| "Invalid date.")?;
            let takes = "SELECT id FROM attempts WHERE id=?1 AND deleted_at_ms IS NOT NULL";
            for id in ids {
                let trashed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND deleted_at_ms IS NOT NULL)", [id], |r| r.get(0)).map_err(db_error)?;
                if !trashed {
                    return Err("Only takes in Trash can be deleted permanently.".into());
                }
                purge_take_rows(&tx, takes, id, now)?;
                tx.execute("DELETE FROM attempts WHERE id=?1", [id]).map_err(db_error)?;
                tx.execute("DELETE FROM audio_assets WHERE id IN (SELECT id FROM purged_assets) AND id NOT IN (SELECT asset_id FROM attempts WHERE asset_id IS NOT NULL)",[]).map_err(db_error)?;
            }
            tx.commit().map_err(db_error)?;
        }
        Ok(self.finish_purges().is_err())
    }

    fn trashed_takes_before(&self, cutoff: i64) -> Result<Vec<String>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        // Takes of a trashed session are purged with their session.
        let mut stmt = conn.prepare("SELECT a.id FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id WHERE a.deleted_at_ms IS NOT NULL AND a.deleted_at_ms<=?1 AND s.deleted_at_ms IS NULL ORDER BY a.deleted_at_ms LIMIT 1000").map_err(db_error)?;
        let rows = stmt.query_map([cutoff], |r| r.get(0)).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    fn trashed_before(&self, cutoff: i64) -> Result<Vec<String>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT id FROM sessions WHERE deleted_at_ms IS NOT NULL AND deleted_at_ms<=?1 ORDER BY deleted_at_ms LIMIT 1000").map_err(db_error)?;
        let rows = stmt.query_map([cutoff], |r| r.get(0)).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    fn purge_expired(&self, now_ms: u64) -> Result<()> {
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let cutoff = now - i64::from(self.trash_retention_days()?) * DAY_MS;
        let ids = self.trashed_before(cutoff)?;
        if !ids.is_empty() {
            self.delete_permanently(&ids)?;
        }
        let takes = self.trashed_takes_before(cutoff)?;
        if !takes.is_empty() {
            self.delete_takes_permanently(&takes)?;
        }
        Ok(())
    }

    fn finish_purges(&self) -> Result<()> {
        let ids: Vec<String> = {
            let conn = self
                .connection
                .lock()
                .map_err(|_| "Session storage owner is unavailable.")?;
            let mut stmt = conn
                .prepare("SELECT id FROM purged_assets")
                .map_err(db_error)?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(db_error)?;
            rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
        };
        let mut failed = None;
        for id in ids {
            match remove_take_files(&self.root, &id) {
                Ok(()) => {
                    let conn = self
                        .connection
                        .lock()
                        .map_err(|_| "Session storage owner is unavailable.")?;
                    conn.execute("DELETE FROM purged_assets WHERE id=?1", [&id])
                        .map_err(db_error)?;
                }
                Err(error) => failed = Some(error),
            }
        }
        failed.map_or(Ok(()), Err)
    }

    /// Records a running transcription job for a saved take that is not in Trash.
    pub fn start_job(&self, job_id: &str, attempt_id: &str, now_ms: u64) -> Result<()> {
        recording::validate_id(job_id)?;
        recording::validate_id(attempt_id)?;
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let usable: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL AND aa.unavailable_reason IS NULL)",[attempt_id],|r|r.get(0)).map_err(db_error)?;
        if !usable {
            return Err("This take is unavailable for transcription.".into());
        }
        conn.execute("INSERT INTO jobs(id,kind,state,attempts,attempt_id,created_at_ms) VALUES (?1,'transcribe','running',1,?2,?3)",params![job_id,attempt_id,now]).map_err(db_error)?;
        Ok(())
    }

    pub fn finish_job(&self, job_id: &str, state: &str, error: Option<&str>, now_ms: u64) -> Result<()> {
        if !["completed", "failed", "canceled"].contains(&state) {
            return Err("Invalid job state.".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("UPDATE jobs SET state=?1,error_message=?2,finished_at_ms=?3 WHERE id=?4 AND state='running'",params![state,error,now,job_id]).map_err(db_error)?;
        Ok(())
    }

    /// Saves a verified local result as a new immutable revision and completes its job.
    pub fn save_local_transcript(
        &self,
        job_id: &str,
        attempt_id: &str,
        transcript: &crate::audio::whisper::Transcript,
        now_ms: u64,
    ) -> Result<()> {
        recording::validate_id(&transcript.run_id)?;
        if transcript.asset_id != attempt_id {
            return Err("The transcript belongs to a different take.".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let text: String = transcript
            .segments
            .iter()
            .map(|s| s.text.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        tx.execute("INSERT INTO transcript_revisions(id,attempt_id,source,run_id,provider,model_id,model_sha256,backend,prompt,source_sha256,language,text,worker_elapsed_ms,created_at_ms) VALUES (?1,?2,'local',?1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![transcript.run_id,attempt_id,transcript.provider,transcript.model_id,transcript.model_sha256,serde_json::to_value(transcript.backend).ok().and_then(|v|v.as_str().map(String::from)),transcript.prompt,transcript.source_sha256,transcript.language,text,i64::try_from(transcript.elapsed_ms).ok(),now]).map_err(db_error)?;
        for (position, segment) in transcript.segments.iter().enumerate() {
            tx.execute("INSERT INTO transcript_segments(revision_id,position,text,start_ms,end_ms,timing_source,timing_unavailable_reason) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![transcript.run_id,position as i64,segment.text,segment.start_ms.and_then(|v|i64::try_from(v).ok()),segment.end_ms.and_then(|v|i64::try_from(v).ok()),segment.timing_source,segment.timing_unavailable_reason]).map_err(db_error)?;
        }
        record_measures(&tx, attempt_id, &transcript.run_id, now)?;
        tx.execute("UPDATE jobs SET state='completed',finished_at_ms=?1,input_revision=?2 WHERE id=?3",params![now,transcript.run_id,job_id]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }

    /// Saves an approved, validated API transcription (3.16) as its own revision
    /// (source `api`) plus its run record and raw response. Segments are built
    /// from the provider's word timings, split at sentence ends; without usable
    /// timings the text is one untimed segment with the reason. Saving the same
    /// run twice is a no-op, so a retried save never duplicates text.
    pub fn save_api_transcript(
        &self,
        result: &crate::audio::transcription::TranscriptionResult,
        raw: &Value,
        now_ms: u64,
    ) -> Result<()> {
        recording::validate_id(&result.run_id)?;
        recording::validate_id(&result.asset_id)?;
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let provider = serde_json::to_value(result.provider).map_err(|e| e.to_string())?;
        let provider = provider.as_str().ok_or("Invalid provider.")?;
        let mut segments: Vec<(String, Option<u64>, Option<u64>, Option<String>)> = Vec::new();
        match (&result.segments.value, &result.words.value) {
            (Some(timed), _) => segments.extend(timed.iter().map(|s| (s.text.trim().to_string(), Some(s.start_ms), Some(s.end_ms), None))),
            (None, Some(words)) => {
                let mut current: Vec<&crate::audio::transcription::TimedText> = Vec::new();
                for (i, word) in words.iter().enumerate() {
                    current.push(word);
                    let sentence_end = word.text.trim_end().ends_with(['.', '?', '!']);
                    if sentence_end || current.len() >= 40 || i + 1 == words.len() {
                        let text = current.iter().map(|w| w.text.trim()).collect::<Vec<_>>().join(" ");
                        segments.push((text, Some(current[0].start_ms), Some(word.end_ms), None));
                        current.clear();
                    }
                }
            }
            (None, None) => segments.push((
                result.raw_text.trim().to_string(),
                None,
                None,
                Some(result.words.unavailable_reason.clone().unwrap_or_else(|| "The provider returned no timings.".into())),
            )),
        }
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let saved: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM attempts a JOIN audio_assets aa ON aa.id=a.asset_id WHERE a.id=?1 AND a.capture_state='saved' AND aa.sha256=?2)", params![result.asset_id, result.source_sha256], |r| r.get(0)).map_err(db_error)?;
        if !saved {
            return Err("This take is no longer available, so the API transcript was not saved.".into());
        }
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM api_runs WHERE id=?1)", [&result.run_id], |r| r.get(0)).map_err(db_error)?;
        if exists {
            return Ok(());
        }
        tx.execute("INSERT INTO transcript_revisions(id,attempt_id,source,run_id,provider,model_id,source_sha256,language,text,created_at_ms) VALUES (?1,?2,'api',?1,?3,?4,?5,?6,?7,?8)",
            params![result.run_id, result.asset_id, provider, result.model_id, result.source_sha256, result.language.value, result.raw_text.trim(), now]).map_err(db_error)?;
        for (position, (text, start, end, reason)) in segments.iter().enumerate() {
            tx.execute("INSERT INTO transcript_segments(revision_id,position,text,start_ms,end_ms,timing_source,timing_unavailable_reason) VALUES (?1,?2,?3,?4,?5,'Estimated',?6)",
                params![result.run_id, position as i64, text, start.and_then(|v| i64::try_from(v).ok()), end.and_then(|v| i64::try_from(v).ok()), reason]).map_err(db_error)?;
        }
        tx.execute("INSERT INTO api_runs(id,attempt_id,provider,model_id,provider_request_id,audio_sha256,source_sha256,settings,raw_response,result,word_timings,audio_duration_ms,estimated_cost_micro_usd,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![result.run_id, result.asset_id, provider, result.model_id, result.request_id.value, result.prepared_sha256, result.source_sha256,
                result.settings.to_string(), raw.to_string(), serde_json::to_string(result).map_err(|e| e.to_string())?, result.words.value.is_some(),
                result.usage.audio_duration_ms.value.and_then(|v| i64::try_from(v).ok()), result.usage.estimated_cost_micro_usd.value.and_then(|v| i64::try_from(v).ok()), now]).map_err(db_error)?;
        record_measures(&tx, &result.asset_id, &result.run_id, now)?;
        tx.commit().map_err(db_error)
    }

    /// The newest earlier API run on exactly this audio, provider, model,
    /// settings and adapter version, if any (3.16 cache key), as an ISO date.
    pub fn previous_api_run(&self, attempt_id: &str, audio_sha256: &str, provider: &str, model: &str, settings: &Value, adapter: &str) -> Result<Option<String>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row(
            "SELECT created_at_ms FROM api_runs WHERE attempt_id=?1 AND audio_sha256=?2 AND provider=?3 AND model_id=?4 AND settings=?5 AND json_extract(result,'$.adapterVersion')=?6 ORDER BY created_at_ms DESC LIMIT 1",
            params![attempt_id, audio_sha256, provider, model, settings.to_string(), adapter],
            |r| r.get::<_, i64>(0),
        ).optional().map_err(db_error).map(|at| at.map(iso))
    }

    /// Confirms or dismisses one filler candidate of a machine revision, or clears
    /// the decision (`None`). The candidate must still exist with the same word.
    pub fn set_filler_decision(&self, revision_id: &str, candidate: u32, word: &str, decision: Option<&str>, now_ms: u64) -> Result<()> {
        recording::validate_id(revision_id)?;
        if decision.is_some_and(|d| d != "confirmed" && d != "dismissed") {
            return Err("Choose Confirm or Dismiss.".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let source: Option<String> = conn.query_row("SELECT source FROM transcript_revisions WHERE id=?1",[revision_id],|r|r.get(0)).optional().map_err(db_error)?;
        if source.as_deref().is_none_or(|s| s == "user") {
            return Err("This transcript is no longer available.".into());
        }
        let segments: Vec<(String, Option<i64>, Option<i64>)> = {
            let mut stmt = conn.prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
            let rows = stmt.query_map([revision_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(db_error)?;
            rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
        };
        let inputs: Vec<crate::analysis::SegmentInput> = segments
            .iter()
            .map(|(text, start, end)| crate::analysis::SegmentInput {
                text,
                start_ms: start.and_then(|v| u64::try_from(v).ok()),
                end_ms: end.and_then(|v| u64::try_from(v).ok()),
            })
            .collect();
        let measures = crate::analysis::measure(&inputs);
        if measures.fillers.get(candidate as usize).is_none_or(|f| f.word != word) {
            return Err("That filler candidate has changed. Reopen the transcript.".into());
        }
        match decision {
            Some(decision) => conn.execute("INSERT INTO annotations(revision_id,definition_version,kind,candidate,word,decision,decided_at_ms) VALUES (?1,?2,'filler',?3,?4,?5,?6) ON CONFLICT(revision_id,definition_version,kind,candidate) DO UPDATE SET decision=excluded.decision,decided_at_ms=excluded.decided_at_ms",
                params![revision_id, crate::analysis::DEFINITION_VERSION, candidate, word, decision, now]),
            None => conn.execute("DELETE FROM annotations WHERE revision_id=?1 AND definition_version=?2 AND kind='filler' AND candidate=?3",
                params![revision_id, crate::analysis::DEFINITION_VERSION, candidate]),
        }
        .map_err(db_error)?;
        Ok(())
    }

    /// Saves your corrected wording as a child revision of a machine transcript.
    /// The original revision, its segments and measures are never changed.
    pub fn save_transcript_correction(&self, attempt_id: &str, parent_id: &str, text: &str, now_ms: u64) -> Result<String> {
        recording::validate_id(attempt_id)?;
        recording::validate_id(parent_id)?;
        if text.trim().is_empty() || text.len() > 64_000 || text.contains('\0') {
            return Err("Write the corrected transcript (up to 64 KB).".into());
        }
        let now = i64::try_from(now_ms).map_err(|_| "Invalid date.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let parent: Option<String> = conn.query_row("SELECT source FROM transcript_revisions WHERE id=?1 AND attempt_id=?2",params![parent_id,attempt_id],|r|r.get(0)).optional().map_err(db_error)?;
        match parent.as_deref() {
            None => return Err("The transcript you corrected is no longer available.".into()),
            Some("user") => return Err("Corrections start from the machine transcript.".into()),
            Some(_) => {}
        }
        // Saving the text it started from would only add a duplicate revision.
        let latest: Option<String> = conn.query_row("SELECT text FROM transcript_revisions WHERE parent_id=?1 AND attempt_id=?2 AND source='user' ORDER BY created_at_ms DESC LIMIT 1",params![parent_id,attempt_id],|r|r.get(0)).optional().map_err(db_error)?.flatten();
        let base = match latest {
            Some(text) => text,
            None => {
                let mut stmt = conn.prepare("SELECT text FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
                let parts = stmt.query_map([parent_id], |r| r.get::<_, String>(0)).map_err(db_error)?.collect::<std::result::Result<Vec<_>, _>>().map_err(db_error)?;
                parts.join(" ")
            }
        };
        let words = |t: &str| t.split_whitespace().collect::<Vec<_>>().join(" ");
        if words(text) == words(&base) {
            return Err("Nothing changed. Change a word to save a correction.".into());
        }
        let id = format!("{parent_id}--edit-{now_ms}");
        recording::validate_id(&id)?;
        let mut conn = conn;
        let tx = conn.transaction().map_err(db_error)?;
        tx.execute("INSERT INTO transcript_revisions(id,attempt_id,parent_id,source,text,created_at_ms) VALUES (?1,?2,?3,'user',?4,?5)",params![id,attempt_id,parent_id,text.trim(),now]).map_err(db_error)?;
        record_measures(&tx, attempt_id, &id, now)?;
        tx.commit().map_err(db_error)?;
        Ok(id)
    }

    /// The transcript view plus voice activity measured from the take's own
    /// waveform (plan 3.5). Runs after the transcript query has released the
    /// connection, because the waveform check needs it too.
    pub fn attempt_transcript_with_voice(&self, attempt_id: &str) -> Result<Value> {
        let mut view = self.attempt_transcript(attempt_id)?;
        if view["revision"].is_object() {
            let voice = match self.waveform(attempt_id) {
                Ok(peaks) => serde_json::to_value(crate::analysis::voice_activity(&peaks.peaks, peaks.samples_per_peak, peaks.sample_rate)),
                Err(error) => Ok(json!({"method":"peak-energy-v1","source":"Estimated","speechStartMs":null,"speechEndMs":null,"pauses":[],"unavailableReason":error})),
            }
            .map_err(|e| e.to_string())?;
            view["revision"]["measures"]["voice"] = voice;
        }
        Ok(view)
    }

    /// The newest transcript revision of a take plus its newest job, either may be null.
    pub fn attempt_transcript(&self, attempt_id: &str) -> Result<Value> {
        recording::validate_id(attempt_id)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let job = conn.query_row("SELECT id,state,error_message,created_at_ms,finished_at_ms FROM jobs WHERE attempt_id=?1 ORDER BY created_at_ms DESC,id DESC LIMIT 1",[attempt_id],
            |r|Ok(json!({"id":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"errorMessage":r.get::<_,Option<String>>(2)?,"createdAt":r.get::<_,Option<i64>>(3)?.map(iso),"finishedAt":r.get::<_,Option<i64>>(4)?.map(iso)}))).optional().map_err(db_error)?;
        let revision = conn.query_row("SELECT id,source,provider,model_id,backend,prompt,language,text,worker_elapsed_ms,created_at_ms FROM transcript_revisions WHERE attempt_id=?1 AND source<>'user' ORDER BY created_at_ms DESC,id DESC LIMIT 1",[attempt_id],
            |r|Ok(json!({"id":r.get::<_,String>(0)?,"source":r.get::<_,String>(1)?,"provider":r.get::<_,Option<String>>(2)?,"modelId":r.get::<_,Option<String>>(3)?,"backend":r.get::<_,Option<String>>(4)?,"prompt":r.get::<_,Option<String>>(5)?,"language":r.get::<_,Option<String>>(6)?,"text":r.get::<_,String>(7)?,"workerElapsedMs":r.get::<_,Option<i64>>(8)?,"createdAt":iso(r.get(9)?)}))).optional().map_err(db_error)?;
        let revision = match revision {
            Some(mut revision) => {
                let mut stmt = conn.prepare("SELECT text,start_ms,end_ms,timing_source,timing_unavailable_reason FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
                let rows = stmt.query_map([revision["id"].as_str().unwrap_or("")],|r|Ok(json!({"text":r.get::<_,String>(0)?,"startMs":r.get::<_,Option<i64>>(1)?,"endMs":r.get::<_,Option<i64>>(2)?,"timingSource":r.get::<_,String>(3)?,"timingUnavailableReason":r.get::<_,Option<String>>(4)?}))).map_err(db_error)?;
                let segments: Vec<Value> = rows.collect::<rusqlite::Result<_>>().map_err(db_error)?;
                let inputs: Vec<crate::analysis::SegmentInput> = segments
                    .iter()
                    .map(|s| crate::analysis::SegmentInput {
                        text: s["text"].as_str().unwrap_or(""),
                        start_ms: s["startMs"].as_u64(),
                        end_ms: s["endMs"].as_u64(),
                    })
                    .collect();
                let mut measures = serde_json::to_value(crate::analysis::measure(&inputs)).map_err(|e| e.to_string())?;
                let mut decided = conn.prepare("SELECT candidate,decision FROM annotations WHERE revision_id=?1 AND definition_version=?2 AND kind='filler'").map_err(db_error)?;
                let decisions: std::collections::HashMap<i64, String> = decided
                    .query_map(params![revision["id"].as_str().unwrap_or(""), crate::analysis::DEFINITION_VERSION], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map_err(db_error)?
                    .collect::<rusqlite::Result<_>>()
                    .map_err(db_error)?;
                if let Some(fillers) = measures["fillers"].as_array_mut() {
                    for (index, filler) in fillers.iter_mut().enumerate() {
                        filler["decision"] = decisions.get(&(index as i64)).map_or(Value::Null, |d| json!(d));
                    }
                }
                revision["measures"] = measures;
                revision["segments"] = Value::Array(segments);
                revision
            }
            None => Value::Null,
        };
        let correction = match revision["id"].as_str() {
            Some(original) => conn.query_row("SELECT id,text,created_at_ms FROM transcript_revisions WHERE attempt_id=?1 AND source='user' AND parent_id=?2 ORDER BY created_at_ms DESC,id DESC LIMIT 1",params![attempt_id,original],
                |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,i64>(2)?))).optional().map_err(db_error)?
                .map(|(id,text,created)| {
                    let measures = crate::analysis::measure(&[crate::analysis::SegmentInput { text: &text, start_ms: None, end_ms: None }]);
                    json!({"id":id,"parentId":original,"text":text,"createdAt":iso(created),"fillerCount":measures.fillers.len(),"wordCount":measures.word_count})
                }),
            None => None,
        };
        Ok(json!({"attemptId":attempt_id,"revision":revision,"correction":correction,"job":job.unwrap_or(Value::Null)}))
    }

    /// Full-text search over titles, notes, tags, prompts, transcripts and your
    /// corrections (plan 3.13). The FTS5 index lives in a TEMP table rebuilt only
    /// when this connection has written since the last search; only sessions
    /// shown in history are indexed, so Trash never appears in results.
    pub fn search(&self, query: &str) -> Result<Vec<Value>> {
        if query.len() > 512 {
            return Err("Search text is too long.".into());
        }
        let terms: Vec<String> = query
            .split(|c: char| !c.is_alphanumeric() && c != '\'')
            .filter(|t| !t.is_empty())
            .take(8)
            .map(|t| format!("\"{}\"*", t.replace('"', "")))
            .collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut built = self
            .search_built_at
            .lock()
            .map_err(|_| "Search is unavailable.")?;
        if *built != Some(conn.total_changes()) {
            let visible = "s.deleted_at_ms IS NULL AND EXISTS(SELECT 1 FROM session_steps st2 JOIN attempts a2 ON a2.step_id=st2.id WHERE st2.session_id=s.id AND a2.asset_id IS NOT NULL AND a2.deleted_at_ms IS NULL)";
            conn.execute_batch(&format!(
                "CREATE VIRTUAL TABLE IF NOT EXISTS temp.search_index USING fts5(session_id UNINDEXED, field UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
                 DELETE FROM temp.search_index;
                 INSERT INTO temp.search_index(session_id,field,body) SELECT s.id,'title',s.title FROM sessions s WHERE {visible};
                 INSERT INTO temp.search_index(session_id,field,body) SELECT s.id,'note',s.notes FROM sessions s WHERE s.notes<>'' AND {visible};
                 INSERT INTO temp.search_index(session_id,field,body) SELECT s.id,'tags',s.tags FROM sessions s WHERE s.tags<>'[]' AND {visible};
                 INSERT INTO temp.search_index(session_id,field,body) SELECT s.id,'prompt',s.prompt_snapshot FROM sessions s WHERE s.prompt_snapshot IS NOT NULL AND {visible};
                 INSERT INTO temp.search_index(session_id,field,body) SELECT s.id,CASE tr.source WHEN 'user' THEN 'correction' ELSE 'transcript' END,tr.text
                   FROM transcript_revisions tr JOIN attempts a ON a.id=tr.attempt_id JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id WHERE a.deleted_at_ms IS NULL AND {visible};"
            ))
            .map_err(db_error)?;
            *built = Some(conn.total_changes());
        }
        let mut stmt = conn
            .prepare("SELECT i.session_id,i.field,snippet(search_index,2,'','','…',12),s.title FROM temp.search_index i JOIN sessions s ON s.id=i.session_id WHERE search_index MATCH ?1 ORDER BY bm25(search_index) LIMIT 200")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([terms.join(" ")], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
            })
            .map_err(db_error)?;
        let mut seen = std::collections::HashSet::new();
        let mut hits = Vec::new();
        for row in rows {
            let (id, field, snippet, title) = row.map_err(db_error)?;
            if !seen.insert(id.clone()) {
                continue; // One hit per session, its best-ranked field.
            }
            let excerpt = match field.as_str() {
                "title" => None,
                "note" => Some(format!("Your note: {snippet}")),
                "transcript" => Some(format!("Transcript: {snippet}")),
                "correction" => Some(format!("Your correction: {snippet}")),
                "prompt" => Some(format!("Prompt: {snippet}")),
                _ => Some(format!("Tags: {}", snippet.replace(['[', ']', '"'], ""))),
            };
            hits.push(json!({"kind":"session","id":id,"title":title,"excerpt":excerpt,"href":format!("/sessions/{id}")}));
            if hits.len() == 20 {
                break;
            }
        }
        Ok(hits)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Online snapshot to a new file inside the app data folder (backup staging).
    pub fn snapshot_to(&self, destination: &Path) -> Result<()> {
        let parent = destination.parent().ok_or("Invalid snapshot path.")?;
        contained(&self.root, parent)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        online_copy(&conn, destination)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row("SELECT value FROM app_settings WHERE key=?1", [key], |r| r.get(0))
            .optional()
            .map_err(db_error)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("INSERT INTO app_settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(db_error)?;
        Ok(())
    }

    pub fn record_backup(
        &self,
        id: &str,
        created_at_ms: u64,
        destination: &str,
        manifest_hash: Option<&str>,
        status: &str,
    ) -> Result<()> {
        let created = i64::try_from(created_at_ms).map_err(|_| "Invalid date.")?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("INSERT OR REPLACE INTO backup_records(id,created_at_ms,destination,manifest_hash,validation_status) VALUES (?1,?2,?3,?4,?5)",params![id,created,destination,manifest_hash,status]).map_err(db_error)?;
        Ok(())
    }

    pub fn last_verified_backup_ms(&self) -> Result<Option<u64>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let last: Option<i64> = conn
            .query_row(
                "SELECT MAX(created_at_ms) FROM backup_records WHERE validation_status='verified'",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        Ok(last.and_then(|ms| u64::try_from(ms).ok()))
    }

    pub fn verified_backup_files(&self) -> Result<Vec<String>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT destination FROM backup_records WHERE validation_status='verified'")
            .map_err(db_error)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Most recent backup attempts first, successful or not.
    pub fn backups(&self) -> Result<Vec<Value>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT id,created_at_ms,destination,validation_status FROM backup_records ORDER BY created_at_ms DESC,id DESC LIMIT 20").map_err(db_error)?;
        let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"createdAt":iso(r.get(1)?),"fileName":r.get::<_,String>(2)?,"status":r.get::<_,String>(3)?}))).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    pub fn snapshot(&self, id: &str) -> Result<PathBuf> {
        recording::validate_id(id)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        snapshot(&conn, &self.root, id)
    }
}

/// Deletes every row derived from the takes `takes` selects (with `?1` = `id`)
/// and writes their purge tombstones; shared by session and single-take purges.
fn purge_take_rows(tx: &Transaction, takes: &str, id: &str, now: i64) -> Result<()> {
    tx.execute(&format!("INSERT OR IGNORE INTO purged_assets(id,purged_at_ms) SELECT id,?2 FROM ({takes})"),params![id,now]).map_err(db_error)?;
    for table in ["task_conditions", "api_runs", "coaching_runs"] {
        tx.execute(&format!("DELETE FROM {table} WHERE attempt_id IN ({takes})"),[id]).map_err(db_error)?;
    }
    tx.execute(&format!("DELETE FROM metric_values WHERE run_id IN (SELECT id FROM analysis_runs WHERE attempt_id IN ({takes}))"),[id]).map_err(db_error)?;
    tx.execute(&format!("DELETE FROM analysis_runs WHERE attempt_id IN ({takes})"),[id]).map_err(db_error)?;
    tx.execute(&format!("DELETE FROM annotations WHERE revision_id IN (SELECT id FROM transcript_revisions WHERE attempt_id IN ({takes}))"),[id]).map_err(db_error)?;
    tx.execute(&format!("DELETE FROM transcript_segments WHERE revision_id IN (SELECT id FROM transcript_revisions WHERE attempt_id IN ({takes}))"),[id]).map_err(db_error)?;
    for table in ["transcript_revisions", "jobs", "prosody_tracks"] {
        tx.execute(&format!("DELETE FROM {table} WHERE attempt_id IN ({takes})"),[id]).map_err(db_error)?;
    }
    Ok(())
}

/// Stores the transcript measures of one revision as an analysis run with one
/// value (or reason) per metric (3.4). Corrections have no segments and are
/// measured as one untimed segment, like the transcript view does. Idempotent.
fn record_measures(conn: &Connection, attempt_id: &str, revision_id: &str, now_ms: i64) -> Result<()> {
    use crate::analysis::{self, SegmentInput};
    let version = i64::from(analysis::DEFINITION_VERSION);
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM analysis_runs WHERE revision_id=?1 AND kind='transcript-measures' AND definition_version=?2)", params![revision_id, version], |r| r.get(0)).map_err(db_error)?;
    if exists {
        return Ok(());
    }
    let segments: Vec<(String, Option<i64>, Option<i64>)> = {
        let mut stmt = conn.prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position").map_err(db_error)?;
        let rows = stmt.query_map([revision_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
    };
    let text: String = conn.query_row("SELECT text FROM transcript_revisions WHERE id=?1", [revision_id], |r| r.get(0)).map_err(db_error)?;
    let inputs: Vec<SegmentInput> = if segments.is_empty() {
        vec![SegmentInput { text: &text, start_ms: None, end_ms: None }]
    } else {
        segments.iter().map(|(t, s, e)| SegmentInput { text: t, start_ms: s.and_then(|v| u64::try_from(v).ok()), end_ms: e.and_then(|v| u64::try_from(v).ok()) }).collect()
    };
    let m = analysis::measure(&inputs);
    let run_id = format!("{revision_id}--measures-v{version}");
    let settings = json!({"pauseThresholdMs": m.pause_threshold_ms, "fillerLexicon": "unambiguous-v1"}).to_string();
    conn.execute("INSERT INTO analysis_runs(id,attempt_id,revision_id,kind,definition_version,settings,created_at_ms) VALUES (?1,?2,?3,'transcript-measures',?4,?5,?6)",
        params![run_id, attempt_id, revision_id, version, settings, now_ms]).map_err(db_error)?;
    let untimed = "No segment timings were available.";
    let count = |n: usize| Some(n as f64);
    let pauses_reason = m.pauses_unavailable_reason.as_deref();
    let values: [(&str, Option<f64>, &str, Option<&str>); 6] = [
        ("word_count", count(m.word_count), "words", None),
        ("filler_candidates", count(m.fillers.len()), "words", None),
        ("repeated_words", count(m.repeated_words.len()), "words", None),
        ("speech_span_ms", m.speech_span_ms.map(|v| v as f64), "ms", Some(untimed)),
        ("pace_wpm", m.pace_wpm, "words/min", m.pace_unavailable_reason.as_deref()),
        ("pauses_over_threshold", pauses_reason.is_none().then(|| m.pauses.len() as f64), "pauses", pauses_reason),
    ];
    for (metric, value, unit, reason) in values {
        let reason = if value.is_some() { None } else { Some(reason.unwrap_or("Not available for this transcript.")) };
        conn.execute("INSERT INTO metric_values(run_id,metric,value,unit,source,unavailable_reason) VALUES (?1,?2,?3,?4,?5,?6)",
            params![run_id, metric, value, unit, m.source, reason]).map_err(db_error)?;
    }
    Ok(())
}

/// Gives every stored revision its measures for the current definition version
/// (after an upgrade, or when the definitions change).
fn backfill_measures(conn: &Connection) -> Result<()> {
    let version = i64::from(crate::analysis::DEFINITION_VERSION);
    let missing: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT r.id,r.attempt_id FROM transcript_revisions r WHERE NOT EXISTS (SELECT 1 FROM analysis_runs a WHERE a.revision_id=r.id AND a.kind='transcript-measures' AND a.definition_version=?1)").map_err(db_error)?;
        let rows = stmt.query_map([version], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)?
    };
    let now = i64::try_from(recording::now_ms()).map_err(|_| "Invalid date.")?;
    for (revision, attempt) in missing {
        record_measures(conn, &attempt, &revision, now)?;
    }
    Ok(())
}

/// Removes one take's audio, receipt, recovery chunks and derived caches. Links
/// or junctions are refused, so nothing outside the app data folder is touched.
fn remove_take_files(root: &Path, id: &str) -> Result<()> {
    recording::validate_id(id)?;
    let cache = root.join("cache");
    for path in [
        root.join("recordings").join(id),
        root.join("recovery").join(id),
        cache.join("inference").join(id),
        cache.join("peaks").join(format!("{id}.json")),
    ] {
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        contained(root, &path)?;
        if metadata.is_dir() {
            fs::remove_dir_all(&path).map_err(io_error)?;
        } else {
            fs::remove_file(&path).map_err(io_error)?;
        }
    }
    // Intonation artifacts are named `<attempt>--<hash>-<algorithm>…`.
    if let Ok(entries) = fs::read_dir(cache.join("prosody")) {
        let prefix = format!("{id}--");
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                contained(root, &entry.path())?;
                fs::remove_file(entry.path()).map_err(io_error)?;
            }
        }
    }
    // Transcription runs are named `<attempt>--<time>` (see transcribe::run_id).
    let runs = cache.join("whisper");
    if let Ok(entries) = fs::read_dir(&runs) {
        let prefix = format!("{id}--");
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                contained(root, &entry.path())?;
                fs::remove_dir_all(entry.path()).map_err(io_error)?;
            }
        }
    }
    Ok(())
}

fn iso(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn insert_reservation(
    tx: &Transaction<'_>,
    id: &str,
    key: &str,
    title: &str,
    context: Option<&PracticeContext>,
    ms: u64,
    request: &str,
) -> Result<()> {
    let ms = i64::try_from(ms).map_err(|_| "Invalid recording date.")?;
    let session = context.map_or(id, |c| c.session_id.as_str());
    let step = format!("step-{session}");
    let local = DateTime::<Utc>::from_timestamp_millis(ms)
        .ok_or("Invalid recording date.")?
        .with_timezone(&Local);
    tx.execute("INSERT OR IGNORE INTO sessions(id,profile_id,title,local_date,timezone_offset_seconds,started_at_ms,status,prompt_snapshot,outline_snapshot) VALUES (?1,'local',?2,?3,?4,?5,'in_progress',?6,?7)",params![session,title,local.format("%Y-%m-%d").to_string(),local.offset().local_minus_utc(),ms,context.map(|c|&c.prompt),context.map(|c|serde_json::to_string(&c.outline).unwrap())]).map_err(db_error)?;
    if let Some(c) = context {
        if c.content_id.as_ref().is_some_and(|id| id.len() > 96 || recording::validate_id(id).is_err()) {
            return Err("Invalid curriculum item.".into());
        }
        // The first take fixes what the session used; later takes never rewrite it.
        tx.execute("UPDATE sessions SET curriculum_version=?1,content_id=?2 WHERE id=?3 AND curriculum_version IS NULL AND content_id IS NULL",
            params![c.curriculum_version, c.content_id, session]).map_err(db_error)?;
    }
    let trashed: bool = tx
        .query_row(
            "SELECT deleted_at_ms IS NOT NULL FROM sessions WHERE id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if trashed {
        return Err("This session is in Trash. Restore it or start a new session.".into());
    }
    let (exercise, version, kind) = context.map_or(("legacy-recording", 1, None), |c| {
        (
            c.exercise_id.as_str(),
            c.exercise_version,
            Some(c.exercise_type.as_str()),
        )
    });
    tx.execute(
        "INSERT OR IGNORE INTO exercise_definitions(id,version,type) VALUES (?1,?2,?3)",
        params![exercise, version, kind],
    )
    .map_err(db_error)?;
    let recorded_kind: Option<String> = tx
        .query_row(
            "SELECT type FROM exercise_definitions WHERE id=?1 AND version=?2",
            params![exercise, version],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if recorded_kind.as_deref() != kind {
        return Err("Exercise version does not match its stored definition.".into());
    }
    tx.execute("INSERT OR IGNORE INTO session_steps(id,session_id,exercise_id,exercise_version,position,status) VALUES (?1,?2,?3,?4,1,'in_progress')",params![step,session,exercise,version]).map_err(db_error)?;
    let used:(String,u32,Option<String>)=tx.query_row("SELECT st.exercise_id,st.exercise_version,s.prompt_snapshot FROM session_steps st JOIN sessions s ON s.id=st.session_id WHERE st.id=?1",[&step],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?;
    if used.0 != exercise
        || used.1 != version
        || used.2.as_deref() != context.map(|c| c.prompt.as_str())
    {
        return Err("Start a new session when changing the exercise or prompt.".into());
    }
    let ordinal: u32 = tx
        .query_row(
            "SELECT COALESCE(MAX(ordinal),0)+1 FROM attempts WHERE step_id=?1",
            [&step],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    tx.execute("INSERT INTO attempts(id,step_id,repetition_group_id,ordinal,capture_state,created_at_ms,idempotency_key,request_snapshot) VALUES (?1,?2,?3,?4,'preparing',?5,?6,?7)",params![id,step,session,ordinal,ms,key,request]).map_err(db_error)?;
    let c = context.map(|c| &c.conditions);
    tx.execute("INSERT INTO task_conditions(attempt_id,familiarity,preparation_seconds,target_seconds,audience,follow_up,unavailable_reason) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![id,c.map(|c|&c.familiarity),c.map(|c|c.preparation_seconds),c.map(|c|c.target_seconds),c.and_then(|c|c.audience.as_ref()),c.map(|c|c.follow_up),c.is_none().then_some("Task conditions were not recorded.")]).map_err(db_error)?;
    tx.execute(
        "UPDATE sessions SET status='in_progress' WHERE id=?1",
        [session],
    )
    .map_err(db_error)?;
    Ok(())
}
fn migrate(conn: &mut Connection, sql: &str) -> Result<()> {
    let tx = conn.transaction().map_err(db_error)?;
    tx.execute_batch(sql).map_err(db_error)?;
    tx.commit().map_err(db_error)
}
fn snapshot(conn: &Connection, root: &Path, id: &str) -> Result<PathBuf> {
    let folder = root.join("database").join("snapshots");
    if !folder.exists() {
        fs::create_dir(&folder).map_err(io_error)?;
    }
    contained(root, &folder)?;
    let destination = folder.join(format!("{id}.sqlite"));
    online_copy(conn, &destination)?;
    Ok(destination)
}

/// Consistent copy of a live database through SQLite's backup API, verified with
/// integrity_check, synced, then renamed into place.
fn online_copy(conn: &Connection, destination: &Path) -> Result<()> {
    let temporary = destination.with_extension("sqlite.part");
    if destination.exists() || temporary.exists() {
        return Err("A database snapshot with this identifier already exists.".into());
    }
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(io_error)?;
    let mut target = Connection::open(&temporary).map_err(db_error)?;
    {
        let backup = rusqlite::backup::Backup::new(conn, &mut target).map_err(db_error)?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .map_err(db_error)?;
    }
    let integrity: String = target
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(db_error)?;
    if integrity != "ok" {
        return Err("The database snapshot did not pass validation.".into());
    }
    drop(target);
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&temporary)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    fs::rename(temporary, destination).map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::{
        tests::{manifest, TestRoot},
        ChunkWriter,
    };
    fn saved(root: &Path, id: &str) -> SavedRecording {
        let mut w = ChunkWriter::create(root, &manifest(id)).unwrap();
        for _ in 0..48_000 {
            w.push(1000).unwrap();
        }
        w.flush().unwrap();
        drop(w);
        recording::finalize(root, id, false).unwrap()
    }
    #[test]
    fn legacy_reconcile_restart_edits_and_online_snapshot() {
        let root = TestRoot::new();
        let asset = saved(&root.0, "legacy");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(owner.list_sessions(None, None, false).unwrap().len(), 1);
        assert!(owner.get_session("legacy").unwrap()["conditions"].is_null());
        owner.commit_recording(&asset).unwrap();
        owner
            .update_session("legacy", "Renamed", "Your note", &["test".into()], true)
            .unwrap();
        let copy = owner.snapshot("verified").unwrap();
        let snap = Connection::open(copy).unwrap();
        assert_eq!(
            snap.query_row("SELECT title FROM sessions", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Renamed"
        );
        drop(owner);
        let reopened = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(
            reopened
                .list_sessions(Some("your note"), None, true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(reopened.get_session("legacy").unwrap()["title"], "Renamed");
        fs::remove_file(root.0.join("recordings/legacy/audio.wav")).unwrap();
        drop(reopened);
        let reopened = DatabaseOwner::open(&root.0).unwrap();
        assert!(
            reopened.get_session("legacy").unwrap()["attempts"][0]["audioUnavailableReason"]
                .is_string()
        );
    }
    #[test]
    fn reservations_are_idempotent_and_fk_and_migrations_fail_closed() {
        let root = TestRoot::new();
        let owner = DatabaseOwner::open(&root.0).unwrap();
        owner.reserve("a", "op-a", "Take", None).unwrap();
        owner.reserve("a", "op-a", "Take", None).unwrap();
        assert!(owner.reserve("a", "other", "Take", None).is_err());
        assert!(owner.reserve("b", "op-a", "Take", None).is_err());
        assert!(owner.reserve("../a", "key", "Take", None).is_err());
        let mut conn = owner.connection.lock().unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "journal_mode", |r| r.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        assert!(conn.execute("INSERT INTO session_steps VALUES ('bad','absent','legacy-recording',1,1,'waiting')",[]).is_err());
        assert!(migrate(
            &mut conn,
            "CREATE TABLE should_rollback (id TEXT); INSERT INTO nonexistent VALUES (1);"
        )
        .is_err());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='should_rollback'",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            0
        );
        drop(conn);
        drop(owner);
        let conn = Connection::open(root.0.join("database/app.sqlite")).unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        drop(conn);
        assert!(DatabaseOwner::open(&root.0)
            .unwrap_err_or_message()
            .contains("newer"));
    }
    #[test]
    fn failed_upgrade_keeps_a_verified_snapshot_and_rolls_back() {
        let root = TestRoot::new();
        let path = root.0.join("database/app.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (old_note TEXT); INSERT INTO sessions VALUES ('keep me');",
        )
        .unwrap();
        drop(conn);
        assert!(DatabaseOwner::open(&root.0).is_err());
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT old_note FROM sessions", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "keep me"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='profiles'",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            0
        );
        let copies: Vec<_> = fs::read_dir(root.0.join("database/snapshots"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(copies.len(), 1);
        let copy = Connection::open(&copies[0]).unwrap();
        assert_eq!(
            copy.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert_eq!(
            copy.query_row("SELECT old_note FROM sessions", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "keep me"
        );
    }
    #[test]
    fn single_takes_go_to_trash_restore_and_purge_while_the_session_stays() {
        let root = TestRoot::new();
        let owner = DatabaseOwner::open(&root.0).unwrap();
        let context = PracticeContext {
            session_id: "session".into(), exercise_id: "ex-repeat".into(), exercise_version: 1, exercise_type: "repeat".into(),
            prompt: "Explain a trade-off".into(),
            outline: Outline { point: String::new(), reason: String::new(), example: String::new() },
            conditions: Conditions { familiarity: "familiar".into(), preparation_seconds: 15, target_seconds: 60, audience: None, follow_up: false },
            curriculum_version: Some(1), content_id: Some("p-habit".into()),
        };
        for n in 1..=2 {
            owner.reserve(&format!("take-{n}"), &format!("op-{n}"), "Test take", Some(&context)).unwrap();
            owner.commit_recording(&saved(&root.0, &format!("take-{n}"))).unwrap();
        }
        owner.update_session("session", "Trade-offs", "Keep this note", &[], false).unwrap();
        // The session records the curriculum version and item it used (4.5).
        let detail = owner.get_session("session").unwrap();
        assert_eq!((detail["curriculumVersion"].as_i64(), detail["contentId"].as_str()), (Some(1), Some("p-habit")));
        let takes = |o: &DatabaseOwner| -> Vec<u64> {
            o.get_session("session").unwrap()["attempts"].as_array().unwrap().iter().map(|a| a["ordinal"].as_u64().unwrap()).collect()
        };
        assert_eq!(takes(&owner), [1, 2]);

        // Move take 1 to Trash: hidden everywhere, take 2 keeps its number.
        owner.move_take_to_trash("take-1", 10).unwrap();
        assert!(owner.move_take_to_trash("take-1", 11).is_err(), "already in Trash");
        assert_eq!(takes(&owner), [2]);
        assert_eq!(owner.list_sessions(None, None, false).unwrap()[0]["attemptCount"], 1);
        assert!(owner.hidden_asset_ids().unwrap().contains("take-1"));
        assert!(owner.start_job("job-x", "take-1", 12).is_err(), "no new jobs on a trashed take");
        let trash = owner.list_trash().unwrap();
        assert_eq!(trash["items"].as_array().unwrap().len(), 0, "the session itself is not in Trash");
        assert_eq!(trash["takes"][0]["id"], "take-1");
        assert_eq!(trash["takes"][0]["ordinal"], 1);
        assert_eq!(trash["takes"][0]["sessionTitle"], "Trade-offs");

        // Restore brings it back with its number.
        owner.restore_take("take-1").unwrap();
        assert_eq!(takes(&owner), [1, 2]);
        assert!(owner.restore_take("take-1").is_err());

        // Permanent delete removes the take's files and rows; restart does not re-import it.
        owner.move_take_to_trash("take-1", 20).unwrap();
        assert!(owner.delete_takes_permanently(&["take-2".into()]).is_err(), "only takes in Trash");
        assert!(!owner.delete_takes_permanently(&["take-1".into()]).unwrap());
        assert!(!root.0.join("recordings/take-1").exists());
        assert!(owner.list_trash().unwrap()["takes"].as_array().unwrap().is_empty());
        drop(owner);
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(takes(&owner), [2]);

        // The chosen focus for the next take is stored on the session (4.6).
        owner.set_session_focus("session", Some("  State the point earlier ")).unwrap();
        assert_eq!(owner.get_session("session").unwrap()["focus"], "State the point earlier");
        assert!(owner.set_session_focus("session", Some(&"x".repeat(161))).is_err());
        owner.set_session_focus("session", None).unwrap();
        assert!(owner.get_session("session").unwrap()["focus"].is_null());

        // The completion reflection is the user's own note (4.11).
        owner.set_session_reflection("session", Some(4), Some(" Pause before the example ")).unwrap();
        owner.set_session_reflection("session", None, None).unwrap(); // leaves both unchanged
        let detail = owner.get_session("session").unwrap();
        assert_eq!((detail["ease"].as_i64(), detail["takeaway"].as_str()), (Some(4), Some("Pause before the example")));
        // Which take felt clearer (4.14) is the user's own choice among this session's takes.
        assert!(detail["preferredTake"].is_null());
        let take = detail["attempts"][0]["id"].as_str().unwrap().to_string();
        owner.set_preferred_take("session", Some(&take)).unwrap();
        assert_eq!(owner.get_session("session").unwrap()["preferredTake"], take.as_str());
        owner.set_preferred_take("session", Some("same")).unwrap();
        assert_eq!(owner.get_session("session").unwrap()["preferredTake"], "same");
        assert!(owner.set_preferred_take("session", Some("not-a-take")).is_err());
        owner.set_preferred_take("session", None).unwrap();
        assert!(owner.get_session("session").unwrap()["preferredTake"].is_null());
        assert!(owner.set_session_reflection("session", Some(6), None).is_err());
        assert!(owner.set_session_reflection("session", Some(0), None).is_err());

        // Removing the last take keeps the session and its note.
        owner.move_take_to_trash("take-2", 30).unwrap();
        assert!(owner.empty_trash().is_ok());
        let sessions = owner.list_sessions(None, None, false).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["attemptCount"], 0);
        assert_eq!(owner.get_session("session").unwrap()["notes"], "Keep this note");
        assert!(!root.0.join("recordings/take-2").exists());
    }

    #[test]
    fn expired_single_takes_are_purged_with_the_retention_setting() {
        let root = TestRoot::new();
        saved(&root.0, "old");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        owner.move_take_to_trash("old", 1).unwrap();
        owner.purge_expired(1 + 31 * DAY_MS as u64).unwrap();
        assert!(owner.list_trash().unwrap()["takes"].as_array().unwrap().is_empty());
        assert!(!root.0.join("recordings/old").exists());
    }

    #[test]
    fn concurrent_retakes_keep_conditions_and_identity_across_restart() {
        let root = TestRoot::new();
        let owner = std::sync::Arc::new(DatabaseOwner::open(&root.0).unwrap());
        let context = PracticeContext {
            session_id: "session".into(),
            exercise_id: "ex-repeat".into(),
            exercise_version: 1,
            exercise_type: "repeat".into(),
            prompt: "Explain a trade-off".into(),
            outline: Outline {
                point: "Point".into(),
                reason: "Reason".into(),
                example: "Example".into(),
            },
            conditions: Conditions {
                familiarity: "unfamiliar".into(),
                preparation_seconds: 30,
                target_seconds: 60,
                audience: Some("A colleague".into()),
                follow_up: false,
            },
            curriculum_version: None,
            content_id: None,
        };
        let handles: Vec<_> = (0..4)
            .map(|n| {
                let owner = owner.clone();
                let context = context.clone();
                std::thread::spawn(move || {
                    owner
                        .reserve(
                            &format!("take-{n}"),
                            &format!("op-{n}"),
                            "Test take",
                            Some(&context),
                        )
                        .unwrap()
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        for n in 0..4 {
            owner
                .commit_recording(&saved(&root.0, &format!("take-{n}")))
                .unwrap();
        }
        let detail = owner.get_session("session").unwrap();
        assert_eq!(detail["attempts"].as_array().unwrap().len(), 4);
        assert_eq!(detail["conditions"]["familiarity"], "unfamiliar");
        assert_eq!(detail["outline"]["reason"], "Reason");
        assert_eq!(detail["durationMs"], 4000);
        let mut changed = context.clone();
        changed.prompt = "Different topic".into();
        assert!(owner
            .reserve("conflict", "op-conflict", "Test take", Some(&changed))
            .is_err());
        let conn = owner.connection.lock().unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM attempts", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(DISTINCT ordinal) FROM attempts", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            4
        );
        drop(conn);
        drop(owner);
        let reopened = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(
            reopened.get_session("session").unwrap()["conditions"]["audience"],
            "A colleague"
        );
        assert_eq!(
            reopened
                .list_sessions(None, Some("repeat"), false)
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn changed_file_and_receipt_never_replace_a_committed_identity_or_hide_healthy_sessions() {
        let root=TestRoot::new();
        let mut asset=saved(&root.0,"changed");saved(&root.0,"healthy");
        let owner=DatabaseOwner::open(&root.0).unwrap();
        assert!(owner.checked_recording("changed").is_ok());drop(owner);
        let path=root.0.join("recordings/changed/audio.wav");
        let mut bytes=fs::read(&path).unwrap();bytes[44]^=1;fs::write(&path,bytes).unwrap();
        asset.sha256=recording::hash_file(&path).unwrap();
        fs::write(root.0.join("recordings/changed/saved.json"),serde_json::to_vec(&asset).unwrap()).unwrap();
        let reopened=DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(reopened.list_sessions(None,None,false).unwrap().len(),2);
        assert!(reopened.checked_recording("changed").is_err());
        assert!(reopened.playback_path("healthy").is_ok());
        assert!(reopened.get_session("changed").unwrap()["attempts"][0]["audioUnavailableReason"].is_string());
    }
    fn context_for(session: &str) -> PracticeContext {
        PracticeContext {
            session_id: session.into(),
            exercise_id: "legacy-recording".into(),
            exercise_version: 1,
            exercise_type: "repeat".into(),
            prompt: "Prompt".into(),
            outline: Outline {
                point: String::new(),
                reason: String::new(),
                example: String::new(),
            },
            conditions: Conditions {
                familiarity: "familiar".into(),
                preparation_seconds: 0,
                target_seconds: 60,
                audience: None,
                follow_up: false,
            },
            curriculum_version: None,
            content_id: None,
        }
    }
    #[test]
    fn trash_restore_and_permanent_delete_remove_files_without_reimport() {
        let root = TestRoot::new();
        saved(&root.0, "keep");
        saved(&root.0, "gone");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        owner.waveform("gone").unwrap();
        let now = recording::now_ms();
        owner.move_to_trash("gone", now).unwrap();
        assert!(owner.move_to_trash("gone", now).is_err());
        assert_eq!(owner.list_sessions(None, None, false).unwrap().len(), 1);
        assert!(owner.get_session("gone").is_err());
        assert!(owner.hidden_asset_ids().unwrap().contains("gone"));
        let trash = owner.list_trash().unwrap();
        assert_eq!(trash["retentionDays"], 30);
        assert_eq!(trash["items"][0]["attemptCount"], 1);
        assert_eq!(trash["items"][0]["durationMs"], 1000);
        // A new take can't silently land in a trashed session.
        assert!(owner
            .reserve("late", "op-late", "Take", Some(&context_for("gone")))
            .unwrap_err()
            .contains("Trash"));

        owner.restore_from_trash("gone").unwrap();
        assert!(owner.restore_from_trash("gone").is_err());
        assert!(!owner.hidden_asset_ids().unwrap().contains("gone"));
        assert!(owner.delete_permanently(&["gone".into()]).is_err());

        owner.move_to_trash("gone", now).unwrap();
        assert!(!owner.delete_permanently(&["gone".into()]).unwrap());
        for path in ["recordings/gone", "recovery/gone", "cache/peaks/gone.json"] {
            assert!(!root.0.join(path).exists(), "{path} remains");
        }
        assert!(root.0.join("recordings/keep/audio.wav").exists());
        assert!(owner.list_trash().unwrap()["items"].as_array().unwrap().is_empty());
        drop(owner);
        let reopened = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(reopened.list_sessions(None, None, false).unwrap().len(), 1);
        assert!(reopened.checked_recording("keep").is_ok());
    }
    #[test]
    fn populated_v1_database_upgrades_to_v2_with_a_snapshot() {
        let root = TestRoot::new();
        saved(&root.0, "existing");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        owner
            .update_session("existing", "Kept title", "", &[], false)
            .unwrap();
        {
            let conn = owner.connection.lock().unwrap();
            conn.execute_batch("ALTER TABLE sessions DROP COLUMN preferred_take; DROP INDEX coaching_runs_payload; DROP INDEX coaching_runs_attempt; DROP TABLE coaching_runs; DROP INDEX phrase_reviews_card; DROP INDEX phrase_cards_due; DROP TABLE phrase_reviews; DROP TABLE phrase_cards; DROP INDEX reference_clips_source; DROP INDEX reference_clips_folder; ALTER TABLE reference_clips DROP COLUMN source_end_ms; ALTER TABLE reference_clips DROP COLUMN source_start_ms; ALTER TABLE reference_clips DROP COLUMN source_id; ALTER TABLE reference_clips DROP COLUMN folder_id; DROP INDEX clip_source_picks_source; DROP TABLE clip_source_picks; DROP TABLE clip_sources; DROP TABLE clip_folders; ALTER TABLE reference_clips DROP COLUMN description; ALTER TABLE reference_clips DROP COLUMN feature; DROP TABLE reference_clips; ALTER TABLE sessions DROP COLUMN ease; ALTER TABLE sessions DROP COLUMN takeaway; ALTER TABLE sessions DROP COLUMN curriculum_version; ALTER TABLE sessions DROP COLUMN content_id; DROP INDEX attempts_deleted; ALTER TABLE attempts DROP COLUMN deleted_at_ms; DROP INDEX analysis_runs_attempt; DROP TABLE metric_values; DROP TABLE analysis_runs; DROP INDEX api_runs_attempt; DROP TABLE api_runs; DROP TABLE prosody_tracks; DROP TABLE annotations; DROP TABLE transcript_segments; DROP TABLE transcript_revisions; DROP INDEX jobs_attempt; ALTER TABLE jobs DROP COLUMN attempt_id; ALTER TABLE jobs DROP COLUMN created_at_ms; ALTER TABLE jobs DROP COLUMN finished_at_ms; ALTER TABLE jobs DROP COLUMN error_message; DROP TABLE purged_assets; DROP TABLE app_settings; DROP INDEX sessions_deleted; PRAGMA user_version=1;").unwrap();
        }
        drop(owner);
        let upgraded = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(upgraded.get_session("existing").unwrap()["title"], "Kept title");
        assert_eq!(upgraded.trash_retention_days().unwrap(), 30);
        let snapshots: Vec<_> = fs::read_dir(root.0.join("database/snapshots"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(snapshots.iter().any(|n| n.starts_with("before-v15-")));
        assert!(upgraded.attempt_transcript("existing").unwrap()["revision"].is_null());
    }
    fn api_result(take: &SavedRecording, run: &str, words: Option<Vec<(&str, u64, u64)>>) -> crate::audio::transcription::TranscriptionResult {
        use crate::audio::transcription::*;
        let words = words.map_or_else(
            || Available::missing("The provider returned no usable word timings within this recording"),
            |w| Available::known(w.into_iter().map(|(t, s, e)| TimedText { text: t.into(), start_ms: s, end_ms: e, provenance: "Estimated".into() }).collect()),
        );
        TranscriptionResult {
            version: 1, adapter_version: "test".into(), provider: TranscriptionProvider::Deepgram, run_id: run.into(),
            request_id: Available::known("dg-req-1".into()), asset_id: take.asset_id.clone(), source_sha256: take.sha256.clone(),
            prepared_sha256: "d".repeat(64), model_id: "nova-3".into(), model_sha256: Available::missing("Hosted models have no published checksum"),
            language: Available::known("en".into()), raw_text: "So, uh, I think. It works?".into(),
            capabilities: Capabilities { segment_timings: false, word_timings: words.value.is_some(), speaker_labels: false },
            segments: Available::missing("not requested"), words, speakers: Available::missing("not requested"),
            settings: json!({"filler_words": true}),
            usage: TranscriptionUsage { input_tokens: Available::missing("audio"), output_tokens: Available::missing("audio"),
                audio_duration_ms: Available::known(1000), estimated_cost_micro_usd: Available::known(4300) },
            created_at_ms: 1,
        }
    }
    #[test]
    fn api_transcripts_are_their_own_revision_with_run_raw_response_and_purge() {
        let root = TestRoot::new();
        let take = saved(&root.0, "take");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        let timed = api_result(&take, "api-deepgram-1", Some(vec![("So,", 0, 100), ("uh,", 120, 200), ("I", 220, 260), ("think.", 270, 400), ("It", 500, 550), ("works?", 560, 900)]));
        owner.save_api_transcript(&timed, &json!({"metadata": {"request_id": "dg-req-1"}}), 5).unwrap();
        owner.save_api_transcript(&timed, &json!({}), 6).unwrap(); // a retried save is a no-op
        let view = owner.attempt_transcript("take").unwrap();
        assert_eq!(view["revision"]["source"], "api");
        assert_eq!(view["revision"]["provider"], "deepgram");
        assert_eq!(view["revision"]["modelId"], "nova-3");
        let segments = view["revision"]["segments"].as_array().unwrap();
        assert_eq!(segments.len(), 2, "split at sentence ends");
        assert_eq!(segments[0]["text"], "So, uh, I think.");
        assert_eq!((segments[1]["startMs"].as_i64(), segments[1]["endMs"].as_i64()), (Some(500), Some(900)));
        assert_eq!(view["revision"]["measures"]["fillers"].as_array().unwrap().len(), 1, "filler review works on API text");
        let (raw, request, cost): (String, Option<String>, Option<i64>) = owner.connection.lock().unwrap()
            .query_row("SELECT raw_response,provider_request_id,estimated_cost_micro_usd FROM api_runs WHERE id='api-deepgram-1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert!(raw.contains("dg-req-1") && request.as_deref() == Some("dg-req-1") && cost == Some(4300));

        let previous = |sha: &str, settings: Value| owner.previous_api_run("take", sha, "deepgram", "nova-3", &settings, "test").unwrap();
        assert!(previous(&"d".repeat(64), json!({"filler_words": true})).is_some(), "same audio and settings: already transcribed");
        assert!(previous(&"d".repeat(64), json!({"filler_words": false})).is_none(), "other settings are a different request");
        assert!(previous(&"f".repeat(64), json!({"filler_words": true})).is_none(), "other audio is a different request");
        // Measures are stored per revision and definition version (3.4).
        let metric = |run: &str, name: &str| -> (Option<f64>, Option<String>) {
            owner.connection.lock().unwrap().query_row("SELECT value,unavailable_reason FROM metric_values WHERE run_id=?1 AND metric=?2", params![run, name], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(metric("api-deepgram-1--measures-v1", "word_count"), (Some(5.0), None), "fillers are not counted as words");
        assert_eq!(metric("api-deepgram-1--measures-v1", "filler_candidates"), (Some(1.0), None));
        assert_eq!(metric("api-deepgram-1--measures-v1", "speech_span_ms"), (Some(900.0), None));
        let (pace, why) = metric("api-deepgram-1--measures-v1", "pace_wpm");
        assert!(pace.is_none() && why.is_some(), "pace needs 15 s of speech: a reason, never 0");
        let correction = owner.save_transcript_correction("take", "api-deepgram-1", "So I think it works.", 6).unwrap();
        assert_eq!(metric(&format!("{correction}--measures-v1"), "filler_candidates"), (Some(0.0), None));
        let (span, why) = metric(&format!("{correction}--measures-v1"), "speech_span_ms");
        assert!(span.is_none() && why.is_some(), "corrections are untimed");
        // Missing runs (an upgrade, or new definitions) are backfilled on open.
        owner.connection.lock().unwrap().execute_batch("DELETE FROM metric_values; DELETE FROM analysis_runs;").unwrap();
        drop(owner);
        let owner = DatabaseOwner::open(&root.0).unwrap();
        let runs: i64 = owner.connection.lock().unwrap().query_row("SELECT COUNT(*) FROM analysis_runs", [], |r| r.get(0)).unwrap();
        assert_eq!(runs, 2, "both revisions measured again");

        // Untimed: one segment with the reason, and a later run is a separate revision.
        owner.save_api_transcript(&api_result(&take, "api-deepgram-2", None), &json!({}), 7).unwrap();
        let view = owner.attempt_transcript("take").unwrap();
        assert_eq!(view["revision"]["id"], "api-deepgram-2");
        assert!(view["revision"]["segments"][0]["startMs"].is_null());
        assert!(view["revision"]["segments"][0]["timingUnavailableReason"].as_str().unwrap().contains("no usable word timings"));
        let revisions: i64 = owner.connection.lock().unwrap().query_row("SELECT COUNT(*) FROM transcript_revisions WHERE attempt_id='take'", [], |r| r.get(0)).unwrap();
        assert_eq!(revisions, 3, "two API runs and the correction");

        // 3.19: filler review works on API text with and without timings, and
        // pauses still come from the take's own audio, not from the provider.
        owner.set_filler_decision("api-deepgram-1", 0, "uh", Some("confirmed"), 9).unwrap();
        owner.set_filler_decision("api-deepgram-2", 0, "uh", Some("dismissed"), 9).unwrap();
        let view = owner.attempt_transcript_with_voice("take").unwrap();
        let measures = &view["revision"]["measures"];
        assert_eq!(measures["fillers"][0]["decision"], "dismissed", "untimed API revision keeps its own decisions");
        assert!(measures["paceWpm"].is_null() && measures["paceUnavailableReason"].is_string(), "no timings: pace withheld with a reason");
        assert_eq!(measures["voice"]["method"], "peak-energy-v1", "pauses measured from the local audio");

        // A result for different audio than the saved take is refused.
        let mut other = api_result(&take, "api-deepgram-3", None);
        other.source_sha256 = "e".repeat(64);
        assert!(owner.save_api_transcript(&other, &json!({}), 8).is_err());

        owner.move_to_trash("take", 10).unwrap();
        owner.delete_permanently(&["take".into()]).unwrap();
        let runs: i64 = owner.connection.lock().unwrap().query_row("SELECT COUNT(*) FROM api_runs", [], |r| r.get(0)).unwrap();
        assert_eq!(runs, 0, "API runs and raw responses are purged with the take");
        let metrics: i64 = owner.connection.lock().unwrap().query_row("SELECT (SELECT COUNT(*) FROM analysis_runs)+(SELECT COUNT(*) FROM metric_values)", [], |r| r.get(0)).unwrap();
        assert_eq!(metrics, 0, "stored measures are purged with the take");
    }
    #[test]
    fn corrections_are_child_revisions_and_leave_the_original_untouched() {
        let root = TestRoot::new();
        saved(&root.0, "take");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert!(owner.save_transcript_correction("take", "missing", "Hi", 1).is_err());
        let transcript = crate::audio::whisper::Transcript {
            version: 1, run_id: "take--1".into(), asset_id: "take".into(), provider: "whisper.cpp".into(),
            model_id: "base".into(), model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(),
            backend: crate::audio::whisper::Backend::Cpu, threads: 4, prompt: None, source_sha256: "b".repeat(64),
            prepared_sha256: "c".repeat(64), language: "en".into(), raw_text: " Index is, uh, fast.".into(),
            segments: vec![crate::audio::whisper::Segment { text: " Index is, uh, fast.".into(), start_ms: Some(0), end_ms: Some(900), timing_source: "Estimated".into(), timing_unavailable_reason: None }],
            elapsed_ms: 10, peak_ram_bytes: None, peak_ram_unavailable_reason: None, created_at_ms: 1,
        };
        owner.start_job("job-1", "take", 1).unwrap();
        owner.save_local_transcript("job-1", "take", &transcript, 2).unwrap();
        assert!(owner.save_transcript_correction("take", "take--1", "   ", 3).is_err());
        let same = owner.save_transcript_correction("take", "take--1", "Index  is, uh,
fast.", 3).unwrap_err();
        assert!(same.contains("Nothing changed"), "{same}");
        let id = owner.save_transcript_correction("take", "take--1", "Indexes are, uh, fast.", 3).unwrap();
        assert!(owner.save_transcript_correction("take", &id, "Again", 4).is_err(), "corrections hang off the machine transcript");
        assert!(owner.save_transcript_correction("take", "take--1", " Indexes are, uh, fast. ", 5).unwrap_err().contains("Nothing changed"), "same as the latest correction");
        let view = owner.attempt_transcript("take").unwrap();
        assert_eq!(view["revision"]["id"], "take--1");
        assert_eq!(view["revision"]["text"], "Index is, uh, fast.");
        assert_eq!(view["correction"]["text"], "Indexes are, uh, fast.");
        assert_eq!(view["correction"]["fillerCount"], 1);
        // Filler decisions attach to this revision's candidates only.
        assert!(view["revision"]["measures"]["fillers"][0]["decision"].is_null());
        assert!(owner.set_filler_decision("take--1", 0, "um", Some("confirmed"), 5).is_err(), "word must match");
        assert!(owner.set_filler_decision("take--1", 3, "uh", Some("confirmed"), 5).is_err(), "candidate must exist");
        assert!(owner.set_filler_decision(&id, 0, "uh", Some("confirmed"), 5).is_err(), "corrections have no candidates");
        assert!(owner.set_filler_decision("take--1", 0, "uh", Some("maybe"), 5).is_err());
        owner.set_filler_decision("take--1", 0, "uh", Some("dismissed"), 5).unwrap();
        owner.set_filler_decision("take--1", 0, "uh", Some("confirmed"), 6).unwrap();
        assert_eq!(owner.attempt_transcript("take").unwrap()["revision"]["measures"]["fillers"][0]["decision"], "confirmed");
        owner.set_filler_decision("take--1", 0, "uh", None, 7).unwrap();
        assert!(owner.attempt_transcript("take").unwrap()["revision"]["measures"]["fillers"][0]["decision"].is_null());
        owner.set_filler_decision("take--1", 0, "uh", Some("confirmed"), 8).unwrap();
        // Trash purges corrections together with their originals.
        owner.move_to_trash("take", 10).unwrap();
        owner.delete_permanently(&["take".into()]).unwrap();
        assert!(owner.attempt_transcript("take").unwrap()["revision"].is_null());
    }
    #[test]
    fn take_coaching_reads_the_newest_text_and_runs_are_kept_cached_and_purged_with_the_take() {
        use super::coaching_runs::NewRun;
        let root = TestRoot::new();
        saved(&root.0, "take");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert!(owner.take_coaching_input("take").unwrap_err().contains("Transcribe this take first"));
        let transcript = crate::audio::whisper::Transcript {
            version: 1, run_id: "take--1".into(), asset_id: "take".into(), provider: "whisper.cpp".into(),
            model_id: "base".into(), model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(),
            backend: crate::audio::whisper::Backend::Cpu, threads: 4, prompt: None, source_sha256: "b".repeat(64),
            prepared_sha256: "c".repeat(64), language: "en".into(), raw_text: " Index is, uh, fast.".into(),
            segments: vec![crate::audio::whisper::Segment { text: " Index is, uh, fast.".into(), start_ms: Some(0), end_ms: Some(900), timing_source: "Estimated".into(), timing_unavailable_reason: None }],
            elapsed_ms: 10, peak_ram_bytes: None, peak_ram_unavailable_reason: None, created_at_ms: 1,
        };
        owner.start_job("job-1", "take", 1).unwrap();
        owner.save_local_transcript("job-1", "take", &transcript, 2).unwrap();
        let input = owner.take_coaching_input("take").unwrap();
        assert_eq!((input.revision_id.as_str(), input.text.as_str(), input.corrected), ("take--1", "Index is, uh, fast.", false));
        assert_eq!(input.timed_parts, vec![("Index is, uh, fast.".to_string(), 0, 900)]);
        assert_eq!(input.fillers, 1);
        // Your correction is what gets sent; the timed parts stay the machine's.
        let correction = owner.save_transcript_correction("take", "take--1", "Indexes are fast.", 3).unwrap();
        let input = owner.take_coaching_input("take").unwrap();
        assert_eq!((input.revision_id.as_str(), input.text.as_str(), input.corrected), (correction.as_str(), "Indexes are fast.", true));
        assert_eq!(input.timed_parts.len(), 1);

        let feedback = json!({"summary":"s","oneImprovement":"o","nextAttempt":"n","corrections":[],"deliveryNotes":[]});
        let run = |id: &'static str, hash: &'static str| NewRun { id, attempt_id: "take", revision_id: &correction, provider: "OpenAI", model: "gpt-6-luna",
            payload_sha256: hash, sent_text: "Task: x", transcript_text: "Indexes are fast.", delivery_impressions: false, provider_request_id: Some("req_1"),
            raw_response: "{}", feedback: &feedback, input_tokens: Some(10), output_tokens: None, estimated_cost_micro_usd: None };
        let hash = "d".repeat(64);
        let leaked: &'static str = Box::leak(hash.clone().into_boxed_str());
        assert!(owner.coaching_answered_at("take", &hash).unwrap().is_none());
        let first = owner.insert_coaching_run(&run("coach-1", leaked)).unwrap();
        assert_eq!(first.feedback["summary"], "s");
        assert!(first.cost_unavailable_reason.is_some(), "missing usage is explained, never 0");
        assert!(owner.coaching_answered_at("take", &hash).unwrap().is_some());
        owner.insert_coaching_run(&run("coach-2", leaked)).unwrap();
        assert!(owner.insert_coaching_run(&run("coach-2", leaked)).is_err(), "a run is stored once");
        assert_eq!(owner.list_coaching_runs("take").unwrap().len(), 2);
        // Trash purges feedback with the take.
        owner.move_to_trash("take", 10).unwrap();
        owner.delete_permanently(&["take".into()]).unwrap();
        assert!(owner.list_coaching_runs("take").unwrap().is_empty());
    }

    #[test]
    fn take_intonation_is_stored_checked_regenerated_and_purged_with_the_take() {
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("tone")).unwrap();
        let mut phase = 0.0f64;
        for _ in 0..72_000 {
            phase += std::f64::consts::TAU * 150.0 / 48_000.0;
            let s: f64 = (1..=5).map(|h| (phase * h as f64).sin() / h as f64).sum();
            writer.push((s * 8_000.0) as i16).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        recording::finalize(&root.0, "tone", false).unwrap();
        let owner = DatabaseOwner::open(&root.0).unwrap();
        let contour = owner.prosody("tone").unwrap();
        let median = contour.median_f0_hz.unwrap();
        assert!((median - 150.0).abs() < 3.0, "median {median}");
        assert_eq!(contour.f0_hz.len(), 150, "10 ms frames over 1.5 s on the original timeline");
        let cached: Vec<_> = fs::read_dir(root.0.join("cache/prosody")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(cached.len(), 1);
        assert_eq!(owner.prosody("tone").unwrap(), contour, "served from the stored track unchanged");
        let (path, frames, settings): (String, i64, String) = owner.connection.lock().unwrap()
            .query_row("SELECT artifact_path,frame_count,settings FROM prosody_tracks WHERE attempt_id='tone'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(frames, 150);
        assert!(settings.contains("\"hopMs\":10"), "{settings}");
        assert_eq!(fs::metadata(root.0.join(&path)).unwrap().len(), 16 + 150 * 4, "compact artifact");
        // An altered artifact fails its checksum and is rebuilt, not trusted.
        let mut bytes = fs::read(root.0.join(&path)).unwrap();
        bytes[20] ^= 0xff;
        fs::write(root.0.join(&path), &bytes).unwrap();
        assert_eq!(owner.prosody("tone").unwrap(), contour, "rebuilt after tampering");
        // A missing artifact is regenerated too (backups leave caches out).
        fs::remove_file(root.0.join(&path)).unwrap();
        assert_eq!(owner.prosody("tone").unwrap(), contour, "regenerated");
        let rows: i64 = owner.connection.lock().unwrap().query_row("SELECT COUNT(*) FROM prosody_tracks", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "one track per take and definition");
        owner.move_to_trash("tone", 1).unwrap();
        owner.delete_permanently(&["tone".into()]).unwrap();
        assert_eq!(fs::read_dir(root.0.join("cache/prosody")).unwrap().count(), 0);
        let rows: i64 = owner.connection.lock().unwrap().query_row("SELECT COUNT(*) FROM prosody_tracks", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0, "track records purged with the take");
    }
    #[test]
    fn intonation_frames_stay_aligned_to_the_original_timeline_after_resampling() {
        // A 48 kHz take stepping from 150 Hz to 220 Hz at exactly 0.75 s (P.8, A-6):
        // after resampling to 16 kHz, frames that end before the step read 150 Hz
        // and frames that start at it read 220 Hz.
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("step")).unwrap();
        let mut phase = 0.0f64;
        for i in 0..72_000 {
            let f0 = if i < 36_000 { 150.0 } else { 220.0 };
            phase += std::f64::consts::TAU * f0 / 48_000.0;
            let s: f64 = (1..=5).map(|h| (phase * h as f64).sin() / h as f64).sum();
            writer.push((s * 8_000.0) as i16).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        recording::finalize(&root.0, "step", false).unwrap();
        let owner = DatabaseOwner::open(&root.0).unwrap();
        let c = owner.prosody("step").unwrap();
        let near = |i: usize, hz: f32| c.f0_hz[i].is_some_and(|f| (f - hz).abs() < 3.0);
        // Frame i covers i·10 ms to i·10 + 40 ms.
        assert!((60..=71).all(|i| near(i, 150.0)), "before the step: {:?}", &c.f0_hz[60..=71]);
        assert!((75..=90).all(|i| near(i, 220.0)), "from the step: {:?}", &c.f0_hz[75..=90]);
    }
    #[test]
    fn search_finds_titles_notes_and_transcripts_follows_edits_and_skips_trash() {
        let root = TestRoot::new();
        saved(&root.0, "indexes");
        saved(&root.0, "habits");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        owner.update_session("indexes", "Explaining database indexes", "Slow on the second point", &["work".into()], false).unwrap();
        owner.update_session("habits", "A habit to change", "", &[], false).unwrap();
        let transcript = crate::audio::whisper::Transcript {
            version: 1, run_id: "habits--1".into(), asset_id: "habits".into(), provider: "whisper.cpp".into(),
            model_id: "base".into(), model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(),
            backend: crate::audio::whisper::Backend::Cpu, threads: 4, prompt: None, source_sha256: "b".repeat(64),
            prepared_sha256: "c".repeat(64), language: "en".into(), raw_text: String::new(),
            segments: vec![crate::audio::whisper::Segment { text: " I check my phone, uh, every morning.".into(), start_ms: Some(0), end_ms: Some(900), timing_source: "Estimated".into(), timing_unavailable_reason: None }],
            elapsed_ms: 10, peak_ram_bytes: None, peak_ram_unavailable_reason: None, created_at_ms: 1,
        };
        owner.start_job("job-1", "habits", 1).unwrap();
        owner.save_local_transcript("job-1", "habits", &transcript, 2).unwrap();

        let ids = |q: &str| owner.search(q).unwrap().iter().map(|h| h["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(ids("index"), ["indexes"], "prefix match on the title");
        assert_eq!(owner.search("second").unwrap()[0]["excerpt"], "Your note: Slow on the second point");
        assert_eq!(ids("phone morn"), ["habits"], "all terms, from the transcript");
        assert!(owner.search("phone").unwrap()[0]["excerpt"].as_str().unwrap().starts_with("Transcript:"));
        assert!(ids("\"\" *").is_empty() && ids("").is_empty());
        assert!(ids("NEAR(\"x\") OR").is_empty(), "query syntax is treated as text");

        owner.save_transcript_correction("habits", "habits--1", "I check my tablet every morning.", 3).unwrap();
        assert_eq!(ids("tablet"), ["habits"], "edits are indexed on the next search");
        owner.move_to_trash("habits", 4).unwrap();
        assert!(ids("tablet").is_empty(), "Trash is not searchable");
    }
    #[cfg(windows)]
    #[test]
    fn interrupted_purge_resumes_on_start_and_retention_expires_old_trash() {
        let root = TestRoot::new();
        saved(&root.0, "locked");
        saved(&root.0, "old");
        saved(&root.0, "recent");
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert!(owner.set_trash_retention_days(3).is_err());
        owner.set_trash_retention_days(7).unwrap();

        // An open handle makes file removal fail after the purge transaction commits.
        let handle = {
            use std::os::windows::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(root.0.join("recordings/locked/audio.wav"))
                .unwrap()
        };
        owner.move_to_trash("locked", recording::now_ms()).unwrap();
        assert!(owner.delete_permanently(&["locked".into()]).unwrap());
        assert!(owner.is_purged("locked").unwrap());
        assert!(owner.hidden_asset_ids().unwrap().contains("locked"));
        assert!(owner.get_session("locked").is_err());

        let day = DAY_MS as u64;
        owner.move_to_trash("old", recording::now_ms() - 8 * day).unwrap();
        owner.move_to_trash("recent", recording::now_ms() - 6 * day).unwrap();
        drop(handle);
        drop(owner);

        // Restart: the receipt is not re-imported, its files go, and only expired Trash is purged.
        let reopened = DatabaseOwner::open(&root.0).unwrap();
        assert!(!root.0.join("recordings/locked").exists());
        assert!(!reopened.is_purged("locked").unwrap());
        assert!(!root.0.join("recordings/old").exists());
        assert!(root.0.join("recordings/recent/audio.wav").exists());
        let trash = reopened.list_trash().unwrap();
        assert_eq!(trash["retentionDays"], 7);
        assert_eq!(trash["items"].as_array().unwrap().len(), 1);
        assert_eq!(trash["items"][0]["id"], "recent");
        assert!(reopened.list_sessions(None, None, false).unwrap().is_empty());
    }
    trait ErrorMessage {
        fn unwrap_err_or_message(self) -> String;
    }
    impl ErrorMessage for Result<DatabaseOwner> {
        fn unwrap_err_or_message(self) -> String {
            match self {
                Err(e) => e,
                Ok(_) => panic!("Expected failure"),
            }
        }
    }
}
