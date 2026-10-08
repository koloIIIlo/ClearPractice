//! Import history (plan 4.4i, D-28). A recording the user imported and
//! transcribed becomes a source: its original file is kept in
//! `sources/<id>/` (outside backups, since it can be large), its transcript and
//! earlier AI choices in SQLite. Reopening a source stages it again with the
//! saved transcript and measures, so nothing is transcribed or measured twice,
//! and lists the clips already cut from it so new proposals can be compared.
use crate::audio::prepare::contained;
use crate::clips;
use crate::clipsplit;
use crate::storage::database::{
    library::{NewSource, PickRun, SavedRange, Source},
    DatabaseOwner,
};
use crate::storage::recording::{self, hash_file};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;

const MEASURES: &str = "measures.json";

pub fn source_dir(root: &Path, id: &str) -> Result<PathBuf> {
    recording::validate_id(id)?;
    Ok(root.join("sources").join(id))
}

pub fn audio_path(root: &Path, id: &str, audio_file: &str) -> Result<PathBuf> {
    if audio_file.contains(['/', '\\']) || !audio_file.starts_with("original.") {
        return Err("The source's audio name is invalid.".into());
    }
    Ok(source_dir(root, id)?.join(audio_file))
}

/// Adds a freshly transcribed staged recording to the history, or updates the
/// transcript of a reopened one. Returns the source ID, or `None` when the
/// original file could not be kept (the clips can still be cut now).
pub fn remember(db: &DatabaseOwner, root: &Path, staging_id: &str, segments: &[(String, u64, u64)], transcribed_with: &str) -> Result<Option<String>> {
    let mut meta = clips::read_meta(root, staging_id)?;
    if let Some(id) = meta.source_id.as_deref() {
        if db.has_source(id)? {
            db.update_source_transcript(id, segments, transcribed_with)?;
            return Ok(Some(id.to_string()));
        }
    }
    let Some(original) = meta.original.clone() else { return Ok(None) };
    let staged = clips::staging_dir(root, staging_id)?.join(&original);
    contained(root, &staged)?;
    let now = recording::now_ms();
    let mut n = 0u32;
    let (id, dir) = loop {
        let id = if n == 0 { format!("source-{now}") } else { format!("source-{now}-{n}") };
        let dir = source_dir(root, &id)?;
        if !dir.exists() {
            break (id, dir);
        }
        n += 1;
    };
    fs::create_dir_all(&dir).map_err(|_| "Cannot keep the recording in the import history.")?;
    contained(root, &dir)?;
    let target = dir.join(&original);
    let stored = (|| {
        fs::copy(&staged, &target).map_err(|_| "Cannot keep the recording in the import history.")?;
        let sha = hash_file(&target)?;
        let title = if meta.title.trim().is_empty() { meta.file_name.clone() } else { meta.title.clone() };
        db.insert_source(&NewSource {
            id: &id,
            title: title.chars().take(200).collect::<String>().trim(),
            origin: if meta.origin == "link" { "link" } else { "file" },
            link: meta.link.as_deref(),
            credit: &meta.credit.chars().take(500).collect::<String>(),
            file_name: &meta.file_name,
            audio_file: &original,
            audio_sha256: &sha,
            duration_ms: meta.duration_ms.max(1),
            segments,
            transcribed_with,
        })
    })();
    if let Err(error) = stored {
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }
    meta.source_id = Some(id.clone());
    clips::write_meta(root, staging_id, &meta)?;
    Ok(Some(id))
}

/// Copies measures taken on a staged copy to its source, so a reopened source
/// is not measured again.
pub fn keep_measures(root: &Path, staging_id: &str) {
    let Ok(meta) = clips::read_meta(root, staging_id) else { return };
    let (Some(id), Ok(staging)) = (meta.source_id, clips::staging_dir(root, staging_id)) else { return };
    if let Ok(dir) = source_dir(root, &id) {
        if dir.is_dir() && contained(root, &dir).is_ok() {
            let _ = fs::copy(staging.join(MEASURES), dir.join(MEASURES));
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub source: Source,
    pub staged: clips::Staged,
    pub candidates: Vec<clipsplit::Candidate>,
    pub saved: Vec<SavedRange>,
    pub picks: Vec<PickRun>,
}

/// Stages a source from the history with its saved transcript and measures.
pub fn open(db: &DatabaseOwner, root: &Path, id: &str) -> Result<Opened> {
    let (source, segments) = db.get_source(id)?;
    let audio = audio_path(root, id, &source.audio_file)?;
    if !audio.is_file() {
        return Err("This recording's audio is not on this computer (backups leave it out). Import the file or link again.".into());
    }
    contained(root, &audio)?;
    let meta = clips::StageMeta {
        origin: source.origin.clone(),
        file_name: source.file_name.clone(),
        title: source.title.clone(),
        link: source.link.clone(),
        credit: source.credit.clone(),
        source_id: Some(id.to_string()),
        ..Default::default()
    };
    let staged = clips::stage_with(root, &audio, meta, false)?;
    clipsplit::save_segments(root, &staged.staging_id, &segments)?;
    let measures = source_dir(root, id)?.join(MEASURES);
    if measures.is_file() {
        let _ = fs::copy(&measures, clips::staging_dir(root, &staged.staging_id)?.join(MEASURES));
    }
    Ok(Opened { candidates: clipsplit::propose(&segments), saved: db.source_saved_ranges(id)?, picks: db.list_pick_runs(id)?, source, staged })
}

/// Removes a source and its audio; clips cut from it stay.
pub fn delete(db: &DatabaseOwner, root: &Path, id: &str) -> Result<()> {
    db.delete_source_record(id)?;
    let dir = source_dir(root, id)?;
    if dir.exists() {
        contained(root, &dir)?;
        fs::remove_dir_all(&dir).map_err(|_| "The recording was removed from the history, but its audio file could not be deleted.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn wav(path: &Path, seconds: u32) {
        let rate = 16_000u32;
        let pcm: Vec<u8> = (0..rate * seconds).flat_map(|i| (((i % 80) as i16 - 40) * 200).to_le_bytes()).collect();
        let mut bytes = recording::wav_header(rate, pcm.len() as u32).to_vec();
        bytes.extend_from_slice(&pcm);
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn a_transcribed_import_is_kept_reopened_with_its_transcript_and_deleted_without_its_clips() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let file = root.0.join("Interview.wav");
        wav(&file, 12);
        let staged = clips::stage(&root.0, &file).unwrap();
        let meta = clips::read_meta(&root.0, &staged.staging_id).unwrap();
        assert_eq!((meta.title.as_str(), meta.original.as_deref(), meta.duration_ms), ("Interview", Some("original.wav"), 12_000));
        let segments = vec![("First idea here.".to_string(), 0u64, 5_000u64), ("Second idea here.".to_string(), 5_000, 11_000)];
        clipsplit::save_segments(&root.0, &staged.staging_id, &segments).unwrap();
        let id = remember(&db, &root.0, &staged.staging_id, &segments, "local").unwrap().unwrap();
        // Transcribing the same staged copy again updates, never duplicates.
        assert_eq!(remember(&db, &root.0, &staged.staging_id, &segments[..1], "deepgram").unwrap().as_deref(), Some(id.as_str()));
        assert_eq!(db.list_sources().unwrap().len(), 1);
        clipsplit::save_segments(&root.0, &staged.staging_id, &segments).unwrap();
        db.update_source_transcript(&id, &segments, "local").unwrap();
        let source = &db.list_sources().unwrap()[0];
        assert!(source.audio_available);
        assert_eq!(source.title, "Interview");

        // Cut a clip from it, as save_clip_sections does.
        let details = clips::ClipDetails { title: "Both ideas", source: "", transcript: None, description: None, feature: None };
        let clip = clips::commit(&root.0, &staged.staging_id, 0, 11_000, &details, "user", false).unwrap();
        db.insert_clip(&clip).unwrap();
        db.place_clip(&clip.id, None, Some((&id, 0, 11_000))).unwrap();

        let opened = open(&db, &root.0, &id).unwrap();
        assert_eq!(opened.staged.duration_ms, 12_000);
        assert_eq!(clipsplit::load_segments(&root.0, &opened.staged.staging_id).unwrap(), segments);
        assert_eq!(opened.saved.len(), 1);
        assert_eq!(clips::read_meta(&root.0, &opened.staged.staging_id).unwrap().source_id.as_deref(), Some(id.as_str()));

        delete(&db, &root.0, &id).unwrap();
        assert!(!source_dir(&root.0, &id).unwrap().exists());
        assert!(db.has_clip(&clip.id), "clips outlive their source");
        assert!(open(&db, &root.0, &id).is_err());
    }

    #[test]
    fn a_source_whose_audio_is_missing_says_so() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let file = root.0.join("talk.wav");
        wav(&file, 4);
        let staged = clips::stage(&root.0, &file).unwrap();
        let id = remember(&db, &root.0, &staged.staging_id, &[("Hi.".into(), 0, 1_000)], "local").unwrap().unwrap();
        fs::remove_dir_all(source_dir(&root.0, &id).unwrap()).unwrap();
        assert!(!db.list_sources().unwrap()[0].audio_available);
        assert!(open(&db, &root.0, &id).unwrap_err().contains("not on this computer"));
        assert!(audio_path(&root.0, &id, "../x").is_err());
    }
}
