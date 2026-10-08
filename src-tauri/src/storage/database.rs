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
const VERSION: i64 = 2;
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
            migrate(&mut connection, include_str!("schema-v2.sql"))?;
        }
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(db_error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(db_error)?;
        let owner = Self {
            root: root.into(),
            connection: Mutex::new(connection),
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
        let mut stmt=conn.prepare("SELECT s.id,s.title,s.local_date,s.started_at_ms,e.type,s.favorite,s.notes,s.tags,s.status,COALESCE(SUM(aa.duration_ms),0),COUNT(a.asset_id) FROM sessions s JOIN session_steps st ON st.session_id=s.id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version JOIN attempts a ON a.step_id=st.id LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE s.deleted_at_ms IS NULL GROUP BY s.id HAVING COUNT(a.asset_id)>0 ORDER BY s.started_at_ms DESC,s.id DESC").map_err(db_error)?;
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
        let (prompt, outline, focus, notes): (
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ) = conn
            .query_row(
                "SELECT prompt_snapshot,outline_snapshot,focus,notes FROM sessions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(db_error)?;
        let mut stmt=conn.prepare("SELECT a.id,a.ordinal,a.created_at_ms,aa.duration_ms,aa.unavailable_reason,t.familiarity,t.preparation_seconds,t.target_seconds,t.audience,t.follow_up FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN audio_assets aa ON aa.id=a.asset_id LEFT JOIN task_conditions t ON t.attempt_id=a.id WHERE st.session_id=?1 ORDER BY a.ordinal").map_err(db_error)?;
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
        Ok(json!({"retentionDays":days,"items":items}))
    }

    /// Takes the recording library must not show: trashed sessions and unfinished purges.
    pub fn hidden_asset_ids(&self) -> Result<std::collections::HashSet<String>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt=conn.prepare("SELECT a.id FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id WHERE s.deleted_at_ms IS NOT NULL UNION SELECT id FROM purged_assets").map_err(db_error)?;
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
                tx.execute(&format!("INSERT OR IGNORE INTO purged_assets(id,purged_at_ms) SELECT id,?2 FROM ({takes})"),params![id,now]).map_err(db_error)?;
                tx.execute(&format!("DELETE FROM task_conditions WHERE attempt_id IN ({takes})"),[id]).map_err(db_error)?;
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
        let ids = self.trashed_before(i64::MAX)?;
        if ids.is_empty() {
            return Ok(false);
        }
        self.delete_permanently(&ids)
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
            conn.execute_batch("DROP TABLE purged_assets; DROP TABLE app_settings; DROP INDEX sessions_deleted; PRAGMA user_version=1;").unwrap();
        }
        drop(owner);
        let upgraded = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(upgraded.get_session("existing").unwrap()["title"], "Kept title");
        assert_eq!(upgraded.trash_retention_days().unwrap(), 30);
        let snapshots: Vec<_> = fs::read_dir(root.0.join("database/snapshots"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(snapshots.iter().any(|n| n.starts_with("before-v2-")));
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
