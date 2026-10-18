//! Local content packs (M16.3). Not tied to takes; purging practice never
//! removes a pack. Removal is a tombstone. Backups copy the complete database.
use super::{db_error, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;

pub const MAX_PACK_BYTES: usize = 1_000_000;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredContentPack {
    pub json: String,
    pub imported_at_ms: i64,
}

/// Defence in depth after the strict TypeScript item validator, and before
/// returning a selected file to it. Content is data and is never executed.
pub fn basics(raw: &str) -> Result<Value> {
    if raw.len() > MAX_PACK_BYTES {
        return Err("Content packs must be at most 1 MB.".into());
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|_| "That content pack is not valid JSON.")?;
    let id = value["id"].as_str().unwrap_or("");
    let title = value["title"].as_str().unwrap_or("");
    if value["format"] != "clearpractice-content-pack"
        || value["version"].as_u64() != Some(1)
        || id.is_empty()
        || id.len() > 24
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || id.ends_with('-')
        || id.contains("--")
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || title.trim().is_empty()
        || title.chars().count() > 120
        || title.contains('\0')
        || !value["prompts"].is_array()
        || !value["drillTopics"].is_object()
        || !value["scenarios"].is_array()
        || !value["missions"].is_array()
        || value.as_object().is_none_or(|v| {
            v.keys().any(|k| {
                ![
                    "format",
                    "version",
                    "id",
                    "title",
                    "prompts",
                    "drillTopics",
                    "scenarios",
                    "missions",
                ]
                .contains(&k.as_str())
            })
        })
    {
        return Err("That content pack has an unsupported format or invalid details.".into());
    }
    Ok(value)
}
impl DatabaseOwner {
    pub fn import_content_pack(&self, raw: &str) -> Result<()> {
        let value = basics(raw)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage is busy.")?;
        // Stable IDs must never silently acquire different content. Removal and
        // reimport of an identical pack are allowed; changed content needs a new ID.
        let existing: Option<String> = conn
            .query_row(
                "SELECT json FROM content_packs WHERE id=?1",
                [value["id"].as_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if existing
            .is_some_and(|old| serde_json::from_str::<Value>(&old).ok().as_ref() != Some(&value))
        {
            return Err(
                "A different pack already uses that ID. Give the changed pack a new ID.".into(),
            );
        }
        conn.execute("INSERT INTO content_packs(id,title,version,json,imported_at_ms) VALUES(?1,?2,1,?3,?4) ON CONFLICT(id) DO UPDATE SET removed_at_ms=NULL", params![value["id"].as_str(), value["title"].as_str(), raw, recording::now_ms() as i64]).map_err(db_error)?;
        Ok(())
    }
    pub fn list_content_packs(&self) -> Result<Vec<StoredContentPack>> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage is busy.")?;
        let mut stmt = conn.prepare("SELECT json,imported_at_ms FROM content_packs WHERE removed_at_ms IS NULL ORDER BY imported_at_ms,id").map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(StoredContentPack {
                    json: r.get(0)?,
                    imported_at_ms: r.get(1)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }
    pub fn remove_content_pack(&self, id: &str) -> Result<()> {
        self.connection
            .lock()
            .map_err(|_| "Session storage is busy.")?
            .execute(
                "UPDATE content_packs SET removed_at_ms=?2 WHERE id=?1 AND removed_at_ms IS NULL",
                params![id, recording::now_ms() as i64],
            )
            .map_err(db_error)?;
        Ok(())
    }
}
use rusqlite::OptionalExtension;
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;
    pub fn sample() -> String {
        r#"{"format":"clearpractice-content-pack","version":1,"id":"local","title":"Local practice","prompts":[],"drillTopics":{},"scenarios":[],"missions":[]}"#.into()
    }
    #[test]
    fn content_packs_are_stored_and_removable() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.import_content_pack(&sample()).unwrap();
        db.import_content_pack(&sample()).unwrap();
        assert_eq!(db.list_content_packs().unwrap().len(), 1);
        let snapshot = root.0.join("pack-snapshot.sqlite");
        db.snapshot_to(&snapshot).unwrap();
        assert_eq!(
            rusqlite::Connection::open(snapshot)
                .unwrap()
                .query_row("SELECT count(*) FROM content_packs", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let mut ctx =
            super::super::engagement::tests::context("pack-session", "familiar", ["", "", ""]);
        ctx.prompt = "The pack wording as practised.".into();
        ctx.content_id = Some("pack-local--question".into());
        ctx.curriculum_version = Some(2);
        db.reserve("pack-take", "pack-op", "Pack take", Some(&ctx))
            .unwrap();
        let mut writer = crate::storage::recording::ChunkWriter::create(
            &root.0,
            &crate::storage::recording::tests::manifest("pack-take"),
        )
        .unwrap();
        for _ in 0..48_000 {
            writer.push(1000).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        let audio = recording::finalize(&root.0, "pack-take", false).unwrap();
        db.commit_recording(&audio).unwrap();
        db.remove_content_pack("local").unwrap();
        assert_eq!(
            db.get_session("pack-session").unwrap()["prompt"],
            "The pack wording as practised."
        );
        assert!(db.list_content_packs().unwrap().is_empty());
        drop(db);
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.list_content_packs().unwrap().is_empty());
        assert!(db
            .import_content_pack(&sample().replace("Local practice", "Changed practice"))
            .is_err());
        db.import_content_pack(&sample()).unwrap();
        assert_eq!(db.list_content_packs().unwrap().len(), 1);
        db.move_to_trash("pack-session", recording::now_ms())
            .unwrap();
        db.delete_permanently(&["pack-session".into()]).unwrap();
        assert_eq!(
            db.list_content_packs().unwrap().len(),
            1,
            "session purge keeps independent packs"
        );
        assert!(basics(&sample().replace("clearpractice-content-pack", "wrong")).is_err());
        assert!(basics(&sample().replace("local", "../local")).is_err());
        assert!(basics(&" ".repeat(MAX_PACK_BYTES + 1)).is_err());
    }
}
