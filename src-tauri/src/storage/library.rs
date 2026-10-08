//! Clip library folders (plan 4.4h) and import history (plan 4.4i, D-28):
//! records only. Files are handled in `clips` and `sources`.
use super::{db_error, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub clip_count: u32,
    pub created_at_ms: u64,
}

/// One imported and transcribed recording in the history.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub title: String,
    pub origin: String,
    pub link: Option<String>,
    pub credit: String,
    pub file_name: String,
    pub audio_file: String,
    pub duration_ms: u64,
    pub transcribed_with: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub clip_count: u32,
    pub pick_count: u32,
    /// False when this profile lacks the source's audio (for example after a
    /// restore, since backups leave source audio out).
    pub audio_available: bool,
}

pub struct NewSource<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub origin: &'a str,
    pub link: Option<&'a str>,
    pub credit: &'a str,
    pub file_name: &'a str,
    pub audio_file: &'a str,
    pub audio_sha256: &'a str,
    pub duration_ms: u64,
    pub segments: &'a [(String, u64, u64)],
    pub transcribed_with: &'a str,
}

/// A clip already cut from a source, so new proposals can be compared with it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRange {
    pub clip_id: String,
    pub title: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// One earlier AI choice for a source (4.4i), kept to compare with new ones.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickRun {
    pub id: String,
    pub model: String,
    pub tone_hint: bool,
    pub picks: Vec<crate::clipsplit::PickedClip>,
    pub created_at_ms: u64,
}

fn ms(v: i64) -> u64 {
    v.max(0) as u64
}

fn clean_name(name: &str, max: usize, what: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > max || name.contains('\0') {
        return Err(format!("Give the {what} a name of up to {max} characters."));
    }
    Ok(name.to_string())
}

impl DatabaseOwner {
    // ── Folders ────────────────────────────────────────────────────────────

    pub fn list_clip_folders(&self) -> Result<Vec<Folder>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT f.id, f.name, f.created_at_ms, (SELECT count(*) FROM reference_clips c WHERE c.folder_id=f.id) FROM clip_folders f ORDER BY f.name COLLATE NOCASE, f.id")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)?, created_at_ms: ms(r.get(2)?), clip_count: r.get::<_, i64>(3)?.max(0) as u32 }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    pub fn create_clip_folder(&self, name: &str) -> Result<Folder> {
        let name = clean_name(name, 80, "folder")?;
        let now = recording::now_ms();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let taken: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM clip_folders WHERE name=?1 COLLATE NOCASE)", [&name], |r| r.get(0))
            .map_err(db_error)?;
        if taken {
            return Err(format!("A folder called \u{201c}{name}\u{201d} already exists."));
        }
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("folder-{now}") } else { format!("folder-{now}-{n}") };
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM clip_folders WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                break candidate;
            }
            n += 1;
        };
        conn.execute("INSERT INTO clip_folders(id,name,created_at_ms) VALUES (?1,?2,?3)", params![id, name, now as i64]).map_err(db_error)?;
        Ok(Folder { id, name, clip_count: 0, created_at_ms: now })
    }

    pub fn rename_clip_folder(&self, id: &str, name: &str) -> Result<()> {
        recording::validate_id(id)?;
        let name = clean_name(name, 80, "folder")?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let taken: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM clip_folders WHERE name=?1 COLLATE NOCASE AND id<>?2)", params![name, id], |r| r.get(0))
            .map_err(db_error)?;
        if taken {
            return Err(format!("A folder called \u{201c}{name}\u{201d} already exists."));
        }
        match conn.execute("UPDATE clip_folders SET name=?1 WHERE id=?2", params![name, id]).map_err(db_error)? {
            1 => Ok(()),
            _ => Err("This folder no longer exists.".into()),
        }
    }

    /// Deletes a folder; its clips stay, unfiled.
    pub fn delete_clip_folder(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        tx.execute("UPDATE reference_clips SET folder_id=NULL WHERE folder_id=?1", [id]).map_err(db_error)?;
        let removed = tx.execute("DELETE FROM clip_folders WHERE id=?1", [id]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        if removed == 1 { Ok(()) } else { Err("This folder no longer exists.".into()) }
    }

    /// Files clips in a folder (`None` = unfiled). Bundled clips can be filed too.
    pub fn move_clips(&self, ids: &[String], folder_id: Option<&str>) -> Result<()> {
        if ids.is_empty() || ids.len() > 500 {
            return Err("Choose between 1 and 500 clips.".into());
        }
        for id in ids {
            recording::validate_id(id)?;
        }
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        if let Some(folder) = folder_id {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM clip_folders WHERE id=?1)", [folder], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                return Err("This folder no longer exists.".into());
            }
        }
        for id in ids {
            if tx.execute("UPDATE reference_clips SET folder_id=?1 WHERE id=?2", params![folder_id, id]).map_err(db_error)? != 1 {
                return Err("A clip you chose no longer exists.".into());
            }
        }
        tx.commit().map_err(db_error)
    }

    /// Updates a clip's title, description and feature (library editing).
    pub fn update_clip(&self, id: &str, title: &str, description: Option<&str>, feature: Option<&str>) -> Result<()> {
        recording::validate_id(id)?;
        let title = clean_name(title, 200, "clip")?;
        let description = description.map(str::trim).filter(|d| !d.is_empty());
        if description.is_some_and(|d| d.chars().count() > 300 || d.contains('\0')) || feature.is_some_and(|f| !["emphasis", "rhythm", "endings"].contains(&f)) {
            return Err("Keep the description under 300 characters and choose emphasis, rhythm or endings.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        match conn.execute("UPDATE reference_clips SET title=?1, description=?2, feature=?3 WHERE id=?4", params![title, description, feature, id]).map_err(db_error)? {
            1 => Ok(()),
            _ => Err("This clip no longer exists.".into()),
        }
    }

    // ── Sources (import history) ───────────────────────────────────────────

    pub fn insert_source(&self, s: &NewSource) -> Result<()> {
        recording::validate_id(s.id)?;
        let segments = serde_json::to_string(s.segments).map_err(|e| e.to_string())?;
        let now = recording::now_ms() as i64;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO clip_sources(id,title,origin,link,credit,file_name,audio_file,audio_sha256,duration_ms,segments,transcribed_with,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
            params![s.id, s.title.trim(), s.origin, s.link, s.credit.trim(), s.file_name, s.audio_file, s.audio_sha256, i64::try_from(s.duration_ms).map_err(|_| "Invalid duration.")?, segments, s.transcribed_with, now],
        )
        .map_err(db_error)?;
        Ok(())
    }

    pub fn has_source(&self, id: &str) -> Result<bool> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row("SELECT EXISTS(SELECT 1 FROM clip_sources WHERE id=?1)", [id], |r| r.get(0)).map_err(db_error)
    }

    /// A new transcript for a source (transcribed again, perhaps in the cloud).
    pub fn update_source_transcript(&self, id: &str, segments: &[(String, u64, u64)], transcribed_with: &str) -> Result<()> {
        recording::validate_id(id)?;
        let segments = serde_json::to_string(segments).map_err(|e| e.to_string())?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        match conn
            .execute("UPDATE clip_sources SET segments=?1, transcribed_with=?2, updated_at_ms=?3 WHERE id=?4", params![segments, transcribed_with, recording::now_ms() as i64, id])
            .map_err(db_error)?
        {
            1 => Ok(()),
            _ => Err("This recording is no longer in the import history.".into()),
        }
    }

    pub fn update_source_details(&self, id: &str, title: &str, credit: &str) -> Result<()> {
        recording::validate_id(id)?;
        let title = clean_name(title, 200, "recording")?;
        if credit.chars().count() > 500 || credit.contains('\0') {
            return Err("Keep the credit under 500 characters.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        match conn
            .execute("UPDATE clip_sources SET title=?1, credit=?2, updated_at_ms=?3 WHERE id=?4", params![title, credit.trim(), recording::now_ms() as i64, id])
            .map_err(db_error)?
        {
            1 => Ok(()),
            _ => Err("This recording is no longer in the import history.".into()),
        }
    }

    pub fn list_sources(&self) -> Result<Vec<Source>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(
                "SELECT s.id,s.title,s.origin,s.link,s.credit,s.file_name,s.audio_file,s.duration_ms,s.transcribed_with,s.created_at_ms,s.updated_at_ms,
                 (SELECT count(*) FROM reference_clips c WHERE c.source_id=s.id), (SELECT count(*) FROM clip_source_picks p WHERE p.source_id=s.id)
                 FROM clip_sources s ORDER BY s.updated_at_ms DESC, s.id",
            )
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Source {
                    id: r.get(0)?, title: r.get(1)?, origin: r.get(2)?, link: r.get(3)?, credit: r.get(4)?, file_name: r.get(5)?, audio_file: r.get(6)?,
                    duration_ms: ms(r.get(7)?), transcribed_with: r.get(8)?, created_at_ms: ms(r.get(9)?), updated_at_ms: ms(r.get(10)?),
                    clip_count: r.get::<_, i64>(11)?.max(0) as u32, pick_count: r.get::<_, i64>(12)?.max(0) as u32, audio_available: false,
                })
            })
            .map_err(db_error)?;
        let mut sources: Vec<Source> = rows.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        for s in &mut sources {
            s.audio_available = crate::sources::audio_path(&self.root, &s.id, &s.audio_file).is_ok_and(|p| p.is_file());
        }
        Ok(sources)
    }

    pub fn get_source(&self, id: &str) -> Result<(Source, Vec<(String, u64, u64)>)> {
        recording::validate_id(id)?;
        let segments: Option<String> = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            conn.query_row("SELECT segments FROM clip_sources WHERE id=?1", [id], |r| r.get(0)).optional().map_err(db_error)?
        };
        let segments = segments.ok_or("This recording is no longer in the import history.")?;
        let source = self.list_sources()?.into_iter().find(|s| s.id == id).ok_or("This recording is no longer in the import history.")?;
        let segments = serde_json::from_str(&segments).map_err(|_| "The saved transcript is damaged. Transcribe the recording again.")?;
        Ok((source, segments))
    }

    pub fn source_saved_ranges(&self, id: &str) -> Result<Vec<SavedRange>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,title,source_start_ms,source_end_ms FROM reference_clips WHERE source_id=?1 AND source_start_ms IS NOT NULL AND source_end_ms IS NOT NULL ORDER BY source_start_ms")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([id], |r| Ok(SavedRange { clip_id: r.get(0)?, title: r.get(1)?, start_ms: ms(r.get(2)?), end_ms: ms(r.get(3)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Removes a source record; its clips stay (no longer linked to it).
    pub fn delete_source_record(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        tx.execute("UPDATE reference_clips SET source_id=NULL, source_start_ms=NULL, source_end_ms=NULL WHERE source_id=?1", [id]).map_err(db_error)?;
        tx.execute("DELETE FROM clip_source_picks WHERE source_id=?1", [id]).map_err(db_error)?;
        let removed = tx.execute("DELETE FROM clip_sources WHERE id=?1", [id]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        if removed == 1 { Ok(()) } else { Err("This recording is no longer in the import history.".into()) }
    }

    pub fn insert_pick_run(&self, source_id: &str, model: &str, tone_hint: bool, picks: &[crate::clipsplit::PickedClip]) -> Result<PickRun> {
        recording::validate_id(source_id)?;
        let now = recording::now_ms();
        let id = format!("picks-{now}");
        let json = serde_json::to_string(picks).map_err(|e| e.to_string())?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO clip_source_picks(id,source_id,model,tone_hint,picks,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, source_id, model, tone_hint as i64, json, now as i64],
        )
        .map_err(db_error)?;
        Ok(PickRun { id, model: model.into(), tone_hint, picks: picks.to_vec(), created_at_ms: now })
    }

    pub fn list_pick_runs(&self, source_id: &str) -> Result<Vec<PickRun>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT id,model,tone_hint,picks,created_at_ms FROM clip_source_picks WHERE source_id=?1 ORDER BY created_at_ms DESC, id DESC")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([source_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?)))
            .map_err(db_error)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, model, tone, picks, at) = row.map_err(db_error)?;
            // A damaged entry is skipped rather than hiding the whole history.
            if let Ok(picks) = serde_json::from_str(&picks) {
                out.push(PickRun { id, model, tone_hint: tone != 0, picks, created_at_ms: ms(at) });
            }
        }
        Ok(out)
    }

    /// Records where a just-saved clip is filed and which source range it came from.
    pub fn place_clip(&self, id: &str, folder_id: Option<&str>, source: Option<(&str, u64, u64)>) -> Result<()> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "UPDATE reference_clips SET folder_id=?1, source_id=?2, source_start_ms=?3, source_end_ms=?4 WHERE id=?5",
            params![folder_id, source.map(|s| s.0), source.map(|s| s.1 as i64), source.map(|s| s.2 as i64), id],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn clip(id: &str, origin: &str) -> crate::clips::Clip {
        crate::clips::Clip {
            id: id.into(), origin: origin.into(), title: format!("Clip {id}"), source: "s".into(), transcript: None, description: None, feature: None,
            duration_ms: 5_000, sha256: "a".repeat(64), created_at_ms: 1, folder_id: None, source_id: None, source_start_ms: None, source_end_ms: None,
        }
    }

    #[test]
    fn folders_file_clips_and_deleting_a_folder_keeps_its_clips() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        db.insert_clip(&clip("clip-a", "user")).unwrap();
        db.insert_clip(&clip("voa-1", "bundled")).unwrap();
        let talks = db.create_clip_folder("  Talks ").unwrap();
        assert_eq!(talks.name, "Talks");
        assert!(db.create_clip_folder("talks").unwrap_err().contains("already exists"));
        assert!(db.create_clip_folder("   ").is_err());
        let other = db.create_clip_folder("Other").unwrap();
        db.move_clips(&["clip-a".into(), "voa-1".into()], Some(&talks.id)).unwrap();
        assert!(db.move_clips(&["clip-a".into()], Some("folder-missing")).is_err());
        assert!(db.move_clips(&["missing".into()], None).is_err());
        let folders = db.list_clip_folders().unwrap();
        assert_eq!(folders.iter().map(|f| (f.name.as_str(), f.clip_count)).collect::<Vec<_>>(), [("Other", 0), ("Talks", 2)]);
        assert!(db.rename_clip_folder(&other.id, "TALKS").is_err());
        db.rename_clip_folder(&other.id, "Speeches").unwrap();
        db.delete_clip_folder(&talks.id).unwrap();
        // Clips are never lost with their folder.
        assert!(db.has_clip("clip-a") && db.has_clip("voa-1"));
        db.update_clip("clip-a", "Renamed", Some(" Calm pace "), Some("rhythm")).unwrap();
        assert!(db.update_clip("clip-a", "", None, None).is_err());
        assert!(db.update_clip("clip-a", "T", None, Some("loud")).is_err());
        assert_eq!(db.list_clip_folders().unwrap().len(), 1);
    }

    #[test]
    fn sources_keep_transcripts_saved_ranges_and_ai_choices_and_leave_clips_when_deleted() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let segments = vec![("One.".to_string(), 0u64, 4_000u64), ("Two.".to_string(), 4_000, 9_000)];
        db.insert_source(&NewSource {
            id: "source-1", title: "A talk", origin: "link", link: Some("https://www.youtube.com/watch?v=abc"), credit: "Speaker", file_name: "talk.m4a",
            audio_file: "original.m4a", audio_sha256: &"b".repeat(64), duration_ms: 9_000, segments: &segments, transcribed_with: "local",
        })
        .unwrap();
        let (source, loaded) = db.get_source("source-1").unwrap();
        assert_eq!(loaded, segments);
        assert!(!source.audio_available, "no audio file in this test profile");
        db.insert_clip(&clip("clip-a", "user")).unwrap();
        db.place_clip("clip-a", None, Some(("source-1", 0, 9_000))).unwrap();
        assert_eq!(db.source_saved_ranges("source-1").unwrap(), [SavedRange { clip_id: "clip-a".into(), title: "Clip clip-a".into(), start_ms: 0, end_ms: 9_000 }]);
        let pick = crate::clipsplit::PickedClip { start_ms: 0, end_ms: 9_000, text: "One. Two.".into(), title: "Both".into(), description: "d".into(), feature: "rhythm".into(), reason: "r".into() };
        db.insert_pick_run("source-1", "gpt-6-luna", true, std::slice::from_ref(&pick)).unwrap();
        let runs = db.list_pick_runs("source-1").unwrap();
        assert_eq!((runs.len(), runs[0].tone_hint, runs[0].picks[0].title.as_str()), (1, true, "Both"));
        let listed = db.list_sources().unwrap();
        assert_eq!((listed[0].clip_count, listed[0].pick_count), (1, 1));
        db.update_source_transcript("source-1", &segments[..1], "deepgram").unwrap();
        assert_eq!(db.get_source("source-1").unwrap().0.transcribed_with, "deepgram");
        db.update_source_details("source-1", "Renamed talk", "New credit").unwrap();
        db.delete_source_record("source-1").unwrap();
        assert!(db.has_clip("clip-a"), "clips outlive their source");
        assert!(db.source_saved_ranges("source-1").unwrap().is_empty());
        assert!(db.list_sources().unwrap().is_empty());
    }
}
