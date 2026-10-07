//! Full local backups and restore staging (§13, plan 2.18–2.19).
//!
//! A backup is one ZIP: an online SQLite snapshot, every committed recording with
//! its receipt, and a manifest of SHA-256 checksums. It is written as `.partial`,
//! re-read and verified, then renamed; a failure never touches earlier backups.
//! Restore first extracts into a staging folder and accepts nothing it cannot
//! verify: unexpected paths, links, unknown compression, size or checksum
//! mismatches, a newer schema, a damaged database or missing audio.
use crate::audio::prepare::contained;
use crate::storage::{
    database::{DatabaseOwner, SCHEMA_VERSION},
    recording::validate_id,
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

type Result<T> = std::result::Result<T, String>;

const FORMAT: &str = "clearpractice-backup";
const FORMAT_VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";
const DATABASE: &str = "database/app.sqlite";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
/// Deflated entries expanding more than this are treated as a decompression bomb.
const MAX_RATIO: u64 = 200;
pub const DESTINATION_KEY: &str = "backup_destination";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub backup_id: String,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at_ms: u64,
    pub includes_audio: bool,
    pub entries: Vec<Entry>,
    /// Recordings already unavailable when the backup was made, with reasons.
    pub unavailable_recordings: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub id: String,
    pub file_name: String,
    pub created_at_ms: u64,
    pub recordings: usize,
    pub unavailable_recordings: usize,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub staging_id: String,
    pub backup_id: String,
    pub created_at_ms: u64,
    pub app_version: String,
    pub schema_version: i64,
    pub sessions: i64,
    pub trashed_sessions: i64,
    pub recordings: i64,
    pub audio_bytes: u64,
    pub unavailable_recordings: usize,
}

fn io_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::StorageFull => "There is not enough space for the backup.".into(),
        io::ErrorKind::NotFound => "The backup location is unavailable.".into(),
        io::ErrorKind::PermissionDenied => "ClearPractice cannot write to that folder.".into(),
        _ => format!("Backup file error: {error}"),
    }
}

fn hex(digest: Sha256) -> String {
    format!("{:x}", digest.finalize())
}

fn staging_root(root: &Path, kind: &str) -> Result<PathBuf> {
    let cache = root.join("cache");
    fs::create_dir_all(cache.join(kind)).map_err(io_error)?;
    contained(root, &cache.join(kind))
        .map(|_| cache.join(kind))
}

/// Leftover staging folders from an interrupted backup or restore are regenerable.
pub fn clean_staging(root: &Path) {
    for kind in ["backup", "restore"] {
        let dir = root.join("cache").join(kind);
        if contained(root, &dir).is_ok() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

/// Removes one restore staging folder (a preview the user dismissed).
pub fn discard_staging(root: &Path, staging_id: &str) -> Result<()> {
    validate_id(staging_id)?;
    let dir = root.join("cache").join("restore").join(staging_id);
    if fs::symlink_metadata(&dir).is_err() {
        return Ok(());
    }
    contained(root, &dir)?;
    fs::remove_dir_all(&dir).map_err(io_error)
}

fn new_id(created_at_ms: u64) -> String {
    let local = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(created_at_ms as i64)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    format!("ClearPractice-backup-{}", local.format("%Y-%m-%d-%H%M%S"))
}

/// Streams `source` into the archive, hashing the uncompressed bytes.
fn add_file<W: Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    source: &Path,
    method: CompressionMethod,
) -> Result<Entry> {
    let options = SimpleFileOptions::default().compression_method(method);
    zip.start_file(name, options).map_err(|e| e.to_string())?;
    let mut input = BufReader::with_capacity(1 << 16, File::open(source).map_err(io_error)?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    let mut bytes = 0u64;
    loop {
        let read = input.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        zip.write_all(&buffer[..read]).map_err(io_error)?;
        bytes += read as u64;
    }
    Ok(Entry { path: name.into(), bytes, sha256: hex(digest) })
}

/// Reads one entry fully, refusing more bytes than declared, and returns its hash.
fn hash_entry(reader: &mut impl Read, declared: u64, sink: &mut impl Write) -> Result<(u64, String)> {
    let mut limited = reader.take(declared + 1);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    let mut bytes = 0u64;
    loop {
        let read = limited.read(&mut buffer).map_err(|_| "The backup archive is damaged.")?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        if bytes > declared {
            return Err("A backup entry is larger than declared.".into());
        }
        digest.update(&buffer[..read]);
        sink.write_all(&buffer[..read]).map_err(io_error)?;
    }
    Ok((bytes, hex(digest)))
}

pub fn create(owner: &DatabaseOwner, destination: &Path, created_at_ms: u64) -> Result<BackupSummary> {
    if !destination.is_dir() {
        return Err("The backup folder is unavailable. Choose a folder or reconnect the drive. Earlier backups were not changed.".into());
    }
    let id = new_id(created_at_ms);
    let file_name = format!("{id}.zip");
    let staging = staging_root(owner.root(), "backup")?.join(&id);
    fs::create_dir(&staging).map_err(|_| "A backup is already being created. Try again in a moment.")?;
    let partial = destination.join(format!("{id}.zip.partial"));
    let result = write_backup(owner, &staging, destination, &partial, &id, created_at_ms);
    let _ = fs::remove_dir_all(&staging);
    match result {
        Ok((summary, manifest_hash)) => {
            owner.record_backup(&id, created_at_ms, &file_name, Some(&manifest_hash), "verified")?;
            Ok(summary)
        }
        Err(error) => {
            let _ = fs::remove_file(&partial);
            let _ = owner.record_backup(&id, created_at_ms, &file_name, None, "failed");
            Err(error)
        }
    }
}

fn write_backup(
    owner: &DatabaseOwner,
    staging: &Path,
    destination: &Path,
    partial: &Path,
    id: &str,
    created_at_ms: u64,
) -> Result<(BackupSummary, String)> {
    let root = owner.root();
    let snapshot = staging.join("app.sqlite");
    owner.snapshot_to(&snapshot)?;

    // The asset list comes from the snapshot, so it matches the database we ship.
    let (schema_version, assets) = {
        let conn = Connection::open_with_flags(&snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "The database snapshot cannot be read.")?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|_| "The database snapshot cannot be read.")?;
        let mut stmt = conn
            .prepare("SELECT id,sha256,bytes,unavailable_reason FROM audio_assets ORDER BY id")
            .map_err(|_| "The database snapshot cannot be read.")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?)))
            .map_err(|_| "The database snapshot cannot be read.")?;
        let assets: Vec<_> = rows.collect::<rusqlite::Result<_>>().map_err(|_| "The database snapshot cannot be read.")?;
        (version, assets)
    };

    let final_path = destination.join(format!("{id}.zip"));
    if final_path.exists() {
        return Err("A backup with this name already exists. Try again in a moment.".into());
    }
    let file = File::create_new(partial).map_err(io_error)?;
    let mut zip = ZipWriter::new(BufWriter::with_capacity(1 << 16, file));
    let mut entries = vec![add_file(&mut zip, DATABASE, &snapshot, CompressionMethod::Deflated)?];
    let mut unavailable = BTreeMap::new();
    for (asset, sha256, bytes, reason) in &assets {
        validate_id(asset)?;
        if let Some(reason) = reason {
            unavailable.insert(asset.clone(), reason.clone());
            continue;
        }
        let dir = root.join("recordings").join(asset);
        let audio = dir.join("audio.wav");
        contained(root, &audio)?;
        let entry = add_file(&mut zip, &format!("recordings/{asset}/audio.wav"), &audio, CompressionMethod::Stored)?;
        if &entry.sha256 != sha256 || i64::try_from(entry.bytes).ok() != Some(*bytes) {
            return Err(format!("Recording {asset} changed or failed verification, so no backup was saved. Earlier backups were not changed."));
        }
        entries.push(entry);
        let receipt = dir.join("saved.json");
        contained(root, &receipt)?;
        entries.push(add_file(&mut zip, &format!("recordings/{asset}/saved.json"), &receipt, CompressionMethod::Deflated)?);
    }
    let manifest = Manifest {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        backup_id: id.into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        schema_version,
        created_at_ms,
        includes_audio: true,
        entries,
        unavailable_recordings: unavailable,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.start_file(MANIFEST, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
        .map_err(|e| e.to_string())?;
    zip.write_all(&manifest_bytes).map_err(io_error)?;
    let file = zip
        .finish()
        .map_err(|e| e.to_string())?
        .into_inner()
        .map_err(|e| io_error(e.into_error()))?;
    file.sync_all().map_err(io_error)?;
    drop(file);

    // Read the archive back before calling it a backup.
    verify_archive(partial, &manifest)?;
    fs::rename(partial, &final_path).map_err(io_error)?;
    let bytes = fs::metadata(&final_path).map_err(io_error)?.len();
    let recordings = manifest.entries.iter().filter(|e| e.path.ends_with("audio.wav")).count();
    Ok((
        BackupSummary {
            id: id.into(),
            file_name: format!("{id}.zip"),
            created_at_ms,
            recordings,
            unavailable_recordings: manifest.unavailable_recordings.len(),
            bytes,
        },
        hex(Sha256::new_with_prefix(&manifest_bytes)),
    ))
}

fn verify_archive(path: &Path, manifest: &Manifest) -> Result<()> {
    let mut zip = ZipArchive::new(BufReader::new(File::open(path).map_err(io_error)?))
        .map_err(|_| "The new backup could not be read back. Earlier backups were not changed.")?;
    if zip.len() != manifest.entries.len() + 1 {
        return Err("The new backup is incomplete. Earlier backups were not changed.".into());
    }
    for entry in &manifest.entries {
        let mut file = zip
            .by_name(&entry.path)
            .map_err(|_| "The new backup is incomplete. Earlier backups were not changed.")?;
        let (bytes, sha256) = hash_entry(&mut file, entry.bytes, &mut io::sink())?;
        if bytes != entry.bytes || sha256 != entry.sha256 {
            return Err("The new backup failed verification. Earlier backups were not changed.".into());
        }
    }
    Ok(())
}

/// Allowed archive paths: the manifest, the database, and per-recording audio and receipts.
fn allowed_path(name: &str) -> bool {
    if name == MANIFEST || name == DATABASE {
        return true;
    }
    let parts: Vec<&str> = name.split('/').collect();
    matches!(parts.as_slice(), ["recordings", id, file]
        if validate_id(id).is_ok() && (*file == "audio.wav" || *file == "saved.json"))
}

fn read_manifest(zip: &mut ZipArchive<BufReader<File>>) -> Result<Manifest> {
    let mut file = zip
        .by_name(MANIFEST)
        .map_err(|_| "This file is not a ClearPractice backup (manifest missing).")?;
    if file.size() > MAX_MANIFEST_BYTES {
        return Err("The backup manifest is too large.".into());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The backup archive is damaged.")?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "The backup manifest is unreadable.")?;
    if manifest.format != FORMAT || manifest.format_version != FORMAT_VERSION {
        return Err("This backup format is not supported by this version of ClearPractice.".into());
    }
    if manifest.schema_version > SCHEMA_VERSION {
        return Err("This backup was made by a newer ClearPractice version. Update the app to restore it.".into());
    }
    if manifest.schema_version < 1 {
        return Err("This backup has an unsupported database version.".into());
    }
    Ok(manifest)
}

/// Validates and extracts a backup into a new staging folder. Nothing outside
/// that folder changes; the folder is removed again on any failure.
pub fn inspect(root: &Path, archive: &Path, staging_id: &str) -> Result<RestorePreview> {
    validate_id(staging_id)?;
    let staging = staging_root(root, "restore")?.join(staging_id);
    fs::create_dir(&staging).map_err(io_error)?;
    let result = stage(archive, &staging, staging_id);
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn stage(archive: &Path, staging: &Path, staging_id: &str) -> Result<RestorePreview> {
    let mut zip = ZipArchive::new(BufReader::new(File::open(archive).map_err(io_error)?))
        .map_err(|_| "This file is not a readable ClearPractice backup.")?;
    if zip.len() > MAX_ENTRIES {
        return Err("The backup has too many entries.".into());
    }
    let manifest = read_manifest(&mut zip)?;
    let expected: BTreeMap<&str, &Entry> =
        manifest.entries.iter().map(|e| (e.path.as_str(), e)).collect();
    if expected.len() != manifest.entries.len() || !expected.contains_key(DATABASE) {
        return Err("The backup manifest is invalid.".into());
    }

    let mut seen = BTreeSet::new();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|_| "The backup archive is damaged.")?;
        let name = file.name().to_string();
        if file.is_dir()
            || file.is_symlink()
            || file.enclosed_name().is_none()
            || !allowed_path(&name)
            || !seen.insert(name.clone())
        {
            return Err(format!("The backup contains an unexpected entry ({name}). Nothing was restored."));
        }
        if !matches!(file.compression(), CompressionMethod::Stored | CompressionMethod::Deflated) {
            return Err("The backup uses unsupported compression.".into());
        }
        if name == MANIFEST {
            continue;
        }
        let entry = expected
            .get(name.as_str())
            .ok_or_else(|| format!("The backup contains an unlisted entry ({name})."))?;
        if file.size() != entry.bytes
            || (file.compression() == CompressionMethod::Deflated
                && file.size() > file.compressed_size().saturating_mul(MAX_RATIO).max(1 << 20))
        {
            return Err("A backup entry has an implausible size. Nothing was restored.".into());
        }
        let target = staging.join(&name);
        fs::create_dir_all(target.parent().ok_or("Invalid backup entry.")?).map_err(io_error)?;
        let mut out = BufWriter::new(File::create_new(&target).map_err(io_error)?);
        let (bytes, sha256) = hash_entry(&mut file, entry.bytes, &mut out)?;
        out.flush().map_err(io_error)?;
        if bytes != entry.bytes || sha256 != entry.sha256 {
            return Err(format!("{name} failed its checksum. Nothing was restored."));
        }
    }
    if seen.len() != expected.len() + 1 {
        return Err("The backup is missing files listed in its manifest. Nothing was restored.".into());
    }
    check_database(staging, &manifest, staging_id)
}

fn check_database(staging: &Path, manifest: &Manifest, staging_id: &str) -> Result<RestorePreview> {
    let conn = Connection::open_with_flags(staging.join(DATABASE), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "The backup database cannot be opened.")?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "The backup database is damaged.")?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| "The backup database is damaged.")?;
    if integrity != "ok" {
        return Err("The backup database is damaged.".into());
    }
    if version != manifest.schema_version {
        return Err("The backup database version does not match its manifest.".into());
    }
    let db = |e: rusqlite::Error| format!("The backup database is incomplete ({e}).");
    let mut stmt = conn
        .prepare("SELECT id,relative_path,sha256,bytes,unavailable_reason FROM audio_assets")
        .map_err(db)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, Option<String>>(4)?)))
        .map_err(db)?;
    let mut recordings = 0;
    let mut audio_bytes = 0u64;
    for row in rows {
        let (id, relative, sha256, bytes, reason) = row.map_err(db)?;
        validate_id(&id)?;
        if reason.is_some() {
            continue;
        }
        let audio = format!("recordings/{id}/audio.wav");
        let listed = manifest.entries.iter().find(|e| e.path == audio);
        if relative != audio
            || listed.is_none_or(|e| e.sha256 != sha256 || i64::try_from(e.bytes).ok() != Some(bytes))
            || !staging.join(format!("recordings/{id}/saved.json")).is_file()
        {
            return Err(format!("The backup is missing or has a different copy of recording {id}. Nothing was restored."));
        }
        recordings += 1;
        audio_bytes += bytes as u64;
    }
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map_err(db);
    Ok(RestorePreview {
        staging_id: staging_id.into(),
        backup_id: manifest.backup_id.clone(),
        created_at_ms: manifest.created_at_ms,
        app_version: manifest.app_version.clone(),
        schema_version: manifest.schema_version,
        sessions: count("SELECT COUNT(*) FROM sessions WHERE deleted_at_ms IS NULL")?,
        trashed_sessions: count("SELECT COUNT(*) FROM sessions WHERE deleted_at_ms IS NOT NULL")?,
        recordings,
        audio_bytes,
        unavailable_recordings: manifest.unavailable_recordings.len(),
    })
}

// ── Replace current profile (plan 2.20) ──────────────────────────────────────
//
// The caller closes the database first. A synced journal is written before
// anything moves, so a crash at any point can be undone at the next start: the
// pre-restore folders are renamed (same volume, so instant) into
// `restore-rollback/<name>/` and kept there as rollback material.

const JOURNAL: &str = "restore-in-progress.json";
const PROFILE_DIRS: [&str; 3] = ["database", "recordings", "recovery"];

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    staging_id: String,
    rollback: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    /// Folder inside the app data folder that keeps the data from before the restore.
    pub rollback_folder: String,
}

fn rename(from: &Path, to: &Path) -> Result<()> {
    fs::rename(from, to).map_err(|e| format!("Restore could not move {} ({e}).", from.display()))
}

/// Moves the current profile aside and the staged backup into place. If any
/// step fails, the previous profile is put back before this returns.
pub fn replace_profile(root: &Path, staging_id: &str, now_ms: u64) -> Result<RestoreOutcome> {
    validate_id(staging_id)?;
    if root.join(JOURNAL).exists() {
        return Err("An earlier restore did not finish. Restart ClearPractice to put your data back first.".into());
    }
    let staging = root.join("cache").join("restore").join(staging_id);
    if !staging.join(DATABASE).is_file() {
        return Err("This backup check has expired. Check the backup again.".into());
    }
    contained(root, &staging)?;
    let local = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms as i64)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    let name = format!("before-restore-{}", local.format("%Y-%m-%d-%H%M%S"));
    let rollback = root.join("restore-rollback").join(&name);
    fs::create_dir_all(root.join("restore-rollback")).map_err(io_error)?;
    // A fresh folder only: reusing one could put older rollback data back.
    fs::create_dir(&rollback).map_err(|_| "A restore just ran. Try again in a moment.")?;
    contained(root, &rollback)?;

    let journal = serde_json::to_vec(&Journal { staging_id: staging_id.into(), rollback: name.clone() })
        .map_err(|e| e.to_string())?;
    let mut file = File::create_new(root.join(JOURNAL)).map_err(io_error)?;
    file.write_all(&journal).and_then(|_| file.sync_all()).map_err(io_error)?;
    drop(file);

    let swapped = (|| {
        for dir in PROFILE_DIRS {
            if root.join(dir).exists() {
                rename(&root.join(dir), &rollback.join(dir))?;
            }
        }
        rename(&staging.join("database"), &root.join("database"))?;
        if staging.join("recordings").is_dir() {
            rename(&staging.join("recordings"), &root.join("recordings"))?;
        } else {
            fs::create_dir(root.join("recordings")).map_err(io_error)?;
        }
        fs::create_dir(root.join("recovery")).map_err(io_error)
    })();
    if let Err(error) = swapped {
        roll_back(root)?;
        return Err(format!("{error} Your previous data was put back."));
    }
    Ok(RestoreOutcome { rollback_folder: format!("restore-rollback/{name}") })
}

/// Call after the restored database opened successfully.
pub fn finish_restore(root: &Path) -> Result<()> {
    fs::remove_file(root.join(JOURNAL)).map_err(io_error)
}

/// Puts the pre-restore profile back after a failed swap or reopen, or at start
/// when a journal shows an interrupted restore. Does nothing without a journal.
pub fn roll_back(root: &Path) -> Result<()> {
    let Ok(bytes) = fs::read(root.join(JOURNAL)) else {
        return Ok(());
    };
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|_| "The restore journal is unreadable.")?;
    validate_id(&journal.staging_id)?;
    if !journal.rollback.starts_with("before-restore-") || validate_id(&journal.rollback).is_err() {
        return Err("The restore journal is invalid.".into());
    }
    let rollback = root.join("restore-rollback").join(&journal.rollback);
    let staging = root.join("cache").join("restore").join(&journal.staging_id);
    for dir in PROFILE_DIRS {
        let previous = rollback.join(dir);
        if !previous.exists() {
            continue;
        }
        let current = root.join(dir);
        if current.exists() {
            // Restored copies are reproducible from the backup file; never merge them.
            fs::create_dir_all(&staging).map_err(io_error)?;
            if fs::rename(&current, staging.join(dir)).is_err() {
                fs::remove_dir_all(&current).map_err(io_error)?;
            }
        }
        rename(&previous, &current)?;
    }
    let _ = fs::remove_dir(&rollback);
    fs::remove_file(root.join(JOURNAL)).map_err(io_error)
}

#[cfg(test)]
mod tests;
