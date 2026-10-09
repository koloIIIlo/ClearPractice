//! Storage view by category (plan 6.6). Clearing the cache removes only data
//! the app can rebuild from your recordings (waveform peaks, pitch contours,
//! prepared 16 kHz copies, microphone tests, finished downloads). It never
//! touches recordings, clips, imported sources, the database, saved provider
//! results or an import in progress.
use crate::audio::prepare::contained;
use serde::Serialize;
use std::{fs, path::Path};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub key: &'static str,
    pub label: &'static str,
    pub note: &'static str,
    pub bytes: u64,
    pub files: u64,
    pub clearable: bool,
}

const CATEGORIES: [(&str, &str, &str, &[&str], bool); 8] = [
    ("recordings", "Recordings", "Your takes and anything recovered after a crash.", &["recordings", "recovery"], false),
    ("clips", "Reference clips", "Bundled and imported clips for Listen and imitate.", &["clips"], false),
    ("sources", "Imported recordings", "Originals kept in the import history.", &["sources", "imports"], false),
    ("database", "Sessions database", "Notes, transcripts, measures and upgrade snapshots.", &["database"], false),
    ("models", "Models and tools", "Transcription models and yt-dlp you installed.", &["models", "tools"], false),
    ("results", "Saved provider results", "Raw answers and transcription runs kept with your takes.", &["cache/coaching", "cache/api-transcription", "cache/whisper"], false),
    ("cache", "Rebuildable cache", "Waveforms, pitch contours, prepared audio, microphone tests and finished downloads. Rebuilt when needed.", CLEARABLE, true),
    ("other", "Other", "Spending records, an import in progress and restore safety copies.", &["accounting", "cache/clip-staging", "cache/restore", "restore-rollback"], false),
];

/// The only folders Clear cache removes.
pub const CLEARABLE: &[&str] = &["cache/peaks", "cache/prosody", "cache/clip-prosody", "cache/inference", "cache/mic-test", "cache/link-download"];

/// Size and file count of a folder; links are counted but never followed.
fn measure(path: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(path) else { return (0, 0) };
    if !meta.is_dir() {
        return (meta.len(), 1);
    }
    let mut total = (0, 0);
    for entry in fs::read_dir(path).into_iter().flatten().flatten() {
        let (b, f) = measure(&entry.path());
        total = (total.0 + b, total.1 + f);
    }
    total
}

pub fn usage(root: &Path) -> Vec<Category> {
    CATEGORIES
        .iter()
        .map(|(key, label, note, dirs, clearable)| {
            let (bytes, files) = dirs.iter().map(|d| measure(&root.join(d))).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
            Category { key, label, note, bytes, files, clearable: *clearable }
        })
        .collect()
}

/// Removes the rebuildable cache; returns the bytes freed.
pub fn clear_cache(root: &Path) -> Result<u64> {
    let mut freed = 0;
    for dir in CLEARABLE {
        let path = root.join(dir);
        if fs::symlink_metadata(&path).is_err() {
            continue;
        }
        contained(root, &path)?;
        let (bytes, _) = measure(&path);
        fs::remove_dir_all(&path).map_err(|_| "Part of the cache is in use. Close any open preview and try again; nothing else was removed.")?;
        freed += bytes;
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    #[test]
    fn clearing_the_cache_frees_only_rebuildable_files() {
        let root = TestRoot::new();
        let write = |rel: &str, bytes: usize| {
            let p = root.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, vec![1u8; bytes]).unwrap();
        };
        write("recordings/take/audio.wav", 1000);
        write("cache/peaks/take.json", 10);
        write("cache/prosody/take.bin", 20);
        write("cache/inference/take/x/audio.wav", 300);
        write("cache/coaching/req/raw.json", 40);
        write("cache/clip-staging/s/full.wav", 50);
        let before = usage(&root.0);
        let get = |list: &[Category], key: &str| list.iter().find(|c| c.key == key).unwrap().clone();
        assert_eq!((get(&before, "recordings").bytes, get(&before, "recordings").files), (1000, 1));
        assert_eq!(get(&before, "cache").bytes, 330);
        assert!(get(&before, "cache").clearable && !get(&before, "results").clearable);
        assert_eq!(clear_cache(&root.0).unwrap(), 330);
        let after = usage(&root.0);
        assert_eq!(get(&after, "cache").bytes, 0);
        assert_eq!(get(&after, "recordings").bytes, 1000);
        assert_eq!(get(&after, "results").bytes, 40, "saved provider results stay");
        assert_eq!(get(&after, "other").bytes, 50, "an import in progress stays");
        assert_eq!(clear_cache(&root.0).unwrap(), 0);
    }
}
