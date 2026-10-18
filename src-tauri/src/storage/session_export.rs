//! Structured additions to a readable session export. Keep this allowlist
//! session-scoped: profile-wide notes, ledgers and imported packs stay in backups.
use super::{db_error, DatabaseOwner, Result};
use rusqlite::{types::ValueRef, Connection};
use serde_json::{Map, Value};

fn rows(conn: &Connection, sql: &str, session_id: &str) -> Result<Value> {
    let mut stmt = conn.prepare(sql).map_err(db_error)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| (*s).into()).collect();
    let rows = stmt.query_map([session_id], |row| {
        let mut object = Map::new();
        for (index, name) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => n.into(),
                ValueRef::Real(n) => n.into(),
                ValueRef::Text(s) => String::from_utf8_lossy(s).into_owned().into(),
                ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidColumnType(index, name.clone(), rusqlite::types::Type::Blob)),
            };
            object.insert(name.clone(), value);
        }
        Ok(Value::Object(object))
    }).map_err(db_error)?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<_>>().map_err(db_error)?))
}

impl DatabaseOwner {
    /// v16-v25 session-linked rows, including historical revisions and stored
    /// snapshots. Do not recompute results or follow references to global content.
    /// Earlier schemas do not specify export policy: take-owned rows follow
    /// transcripts/coaching; global content follows v21's backup-only notes.
    pub(crate) fn session_export_tables(&self, session_id: &str) -> Result<Value> {
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let takes = "SELECT a.id FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE st.session_id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL";
        let conversations = "SELECT id FROM conversations WHERE session_id=?1";
        let mut tables = Map::new();
        for table in ["phrase_uses", "self_checks", "audio_measures", "take_events", "activity_results", "self_predictions", "catch_runs", "upgrade_runs", "rehearsals", "listener_packs"] {
            let sql = format!("SELECT * FROM {table} WHERE attempt_id IN ({takes}) ORDER BY rowid");
            tables.insert(table.into(), rows(&tx, &sql, session_id)?);
        }
        for table in ["practice_events", "personal_records"] {
            tables.insert(table.into(), rows(&tx, &format!("SELECT * FROM {table} WHERE session_id=?1 OR attempt_id IN ({takes}) ORDER BY rowid"), session_id)?);
        }
        for table in ["conversation_turns", "conversation_feedback"] {
            tables.insert(table.into(), rows(&tx, &format!("SELECT * FROM {table} WHERE conversation_id IN ({conversations}) ORDER BY rowid"), session_id)?);
        }
        for (table, sql) in [
            ("exercise_definitions", "SELECT e.* FROM exercise_definitions e WHERE EXISTS(SELECT 1 FROM session_steps st WHERE st.session_id=?1 AND st.exercise_id=e.id AND st.exercise_version=e.version) ORDER BY e.id,e.version".to_string()),
            ("segment_marks", format!("SELECT * FROM segment_marks WHERE revision_id IN (SELECT id FROM transcript_revisions WHERE attempt_id IN ({takes})) ORDER BY rowid")),
            ("comparisons", format!("SELECT * FROM comparisons WHERE a_attempt IN ({takes}) OR b_attempt IN ({takes}) ORDER BY rowid")),
            ("conversations", format!("SELECT * FROM conversations WHERE id IN ({conversations}) ORDER BY rowid")),
            ("listener_feedback", format!("SELECT * FROM listener_feedback WHERE pack_id IN (SELECT id FROM listener_packs WHERE attempt_id IN ({takes})) ORDER BY rowid")),
        ] {
            tables.insert(table.into(), rows(&tx, &sql, session_id)?);
        }
        tx.commit().map_err(db_error)?;
        Ok(Value::Object(tables))
    }
}
