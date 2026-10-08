//! M0 durable recording journal. The immutable manifest is synced before capture;
//! only closed, synced chunks are eligible for recovery. SQLite references follow in M2.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifest {
    pub version: u32,
    pub attempt_id: String,
    pub idempotency_key: String,
    pub title: String,
    pub device_id: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub source_channels: u16,
    pub source_format: String,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecording {
    pub attempt_id: String,
    pub asset_id: String,
    pub title: String,
    pub created_at_ms: u64,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub source_channels: u16,
    pub source_format: String,
    pub bytes: u64,
    pub sha256: String,
    pub recovered: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableRecording {
    pub attempt_id: String,
    pub title: String,
    pub created_at_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub unavailable_reason: Option<String>,
}

pub fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid recording identifier.".into());
    }
    Ok(())
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn io_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::StorageFull => {
            "The disk is full. Captured chunks are kept for recovery.".into()
        }
        io::ErrorKind::PermissionDenied => {
            "Recording storage is not writable. Check folder permissions.".into()
        }
        _ => format!("Recording storage failed: {error}"),
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension("json.part");
    let bytes = serde_json::to_vec(value).map_err(|_| "Cannot serialize recording metadata.")?;
    let mut file = File::create(&temporary).map_err(io_error)?;
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    fs::rename(temporary, path).map_err(io_error)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > 16_384 {
        return Err("Recording metadata is too large.".into());
    }
    serde_json::from_reader(file).map_err(|_| "Recording metadata is unreadable.".into())
}

pub fn read_manifest(root: &Path, id: &str) -> Result<CaptureManifest> {
    validate_id(id)?;
    crate::audio::prepare::contained(root, &root.join("recovery").join(id).join("manifest.json"))?;
    let manifest: CaptureManifest =
        read_json(&root.join("recovery").join(id).join("manifest.json"))?;
    validate_id(&manifest.idempotency_key)?;
    if manifest.version != 1
        || manifest.attempt_id != id
        || !(8_000..=192_000).contains(&manifest.sample_rate)
        || !(1..=32).contains(&manifest.source_channels)
    {
        return Err("Recording metadata has an unsupported version or format.".into());
    }
    Ok(manifest)
}

pub struct ChunkWriter {
    directory: PathBuf,
    sample_rate: usize,
    pending: Vec<i16>,
    sequence: usize,
    pub frames: u64,
}

impl ChunkWriter {
    pub fn create(root: &Path, manifest: &CaptureManifest) -> Result<Self> {
        validate_id(&manifest.attempt_id)?;
        validate_id(&manifest.idempotency_key)?;
        let directory = root.join("recovery").join(&manifest.attempt_id);
        crate::audio::prepare::contained(root, &root.join("recovery"))?;
        // An existing journal must be recovered, never reused for a different take.
        fs::create_dir(&directory).map_err(io_error)?;
        write_json(&directory.join("manifest.json"), manifest)?;
        Ok(Self {
            directory,
            sample_rate: manifest.sample_rate as usize,
            pending: Vec::with_capacity(manifest.sample_rate as usize),
            sequence: 0,
            frames: 0,
        })
    }

    pub fn push(&mut self, sample: i16) -> Result<()> {
        self.pending.push(sample);
        self.frames += 1;
        if self.pending.len() == self.sample_rate {
            self.flush()?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let part = self.directory.join(format!("{:08}.part", self.sequence));
        let closed = self.directory.join(format!("{:08}.pcm", self.sequence));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .map_err(io_error)?;
        let bytes: Vec<_> = self
            .pending
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        file.write_all(&bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        drop(file);
        fs::rename(part, closed).map_err(io_error)?;
        self.sequence += 1;
        self.pending.clear();
        Ok(())
    }
}

fn closed_chunks(root: &Path, manifest: &CaptureManifest) -> Result<Vec<PathBuf>> {
    let directory = root.join("recovery").join(&manifest.attempt_id);
    crate::audio::prepare::contained(root, &directory)?;
    let mut chunks = Vec::new();
    for entry in fs::read_dir(directory).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".pcm") {
            if name.len() != 12 || !name.as_bytes()[..8].iter().all(u8::is_ascii_digit) {
                return Err("A recording chunk has an invalid name.".into());
            }
            chunks.push(entry.path());
        }
    }
    chunks.sort();
    for (sequence, path) in chunks.iter().enumerate() {
        crate::audio::prepare::contained(root, path)?;
        if path.file_name().unwrap().to_string_lossy() != format!("{sequence:08}.pcm") {
            return Err("A recording chunk is missing. The remaining audio is kept.".into());
        }
        let size = fs::metadata(path).map_err(io_error)?.len();
        if size == 0 || size % 2 != 0 || size > u64::from(manifest.sample_rate) * 2 {
            return Err("A recording chunk is incomplete. The remaining audio is kept.".into());
        }
    }
    Ok(chunks)
}

pub(crate) fn wav_header(rate: u32, bytes: u32) -> [u8; 44] {
    let mut h = [0; 44];
    h[..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(bytes + 36).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&bytes.to_le_bytes());
    h
}

pub(crate) fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let size = file.read(&mut buffer).map_err(io_error)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub fn read_saved(root: &Path, id: &str) -> Result<Option<SavedRecording>> {
    validate_id(id)?;
    let dir = root.join("recordings").join(id);
    let receipt = dir.join("saved.json");
    if !receipt.exists() {
        return Ok(None);
    }
    crate::audio::prepare::contained(root, &receipt)?;
    crate::audio::prepare::contained(root, &dir.join("audio.wav"))?;
    let saved: SavedRecording = read_json(&receipt)?;
    let mut file = File::open(dir.join("audio.wav")).map_err(io_error)?;
    let mut header = [0; 44];
    file.read_exact(&mut header).map_err(io_error)?;
    let bytes = saved
        .bytes
        .checked_sub(44)
        .and_then(|b| u32::try_from(b).ok())
        .filter(|b| *b <= u32::MAX - 36)
        .ok_or("Invalid saved recording size.")?;
    if saved.attempt_id != id
        || saved.asset_id != id
        || saved.channels != 1
        || !(8_000..=192_000).contains(&saved.sample_rate)
        || header != wav_header(saved.sample_rate, bytes)
        || file.metadata().map_err(io_error)?.len() != saved.bytes
        || saved.duration_ms != u64::from(bytes / 2) * 1000 / u64::from(saved.sample_rate)
        || saved.sha256.len() != 64
        || !saved.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !(1..=32).contains(&saved.source_channels)
    {
        return Err(
            "The saved recording failed verification. Its recovery chunks are kept.".into(),
        );
    }
    Ok(Some(saved))
}

pub fn finalize(root: &Path, id: &str, recovered: bool) -> Result<SavedRecording> {
    if let Some(saved) = read_saved(root, id)? {
        return Ok(saved);
    }
    let manifest = read_manifest(root, id)?;
    let chunks = closed_chunks(root, &manifest)?;
    let size = chunks.iter().try_fold(0u64, |sum, path| {
        fs::metadata(path)
            .map(|metadata| sum + metadata.len())
            .map_err(io_error)
    })?;
    if size == 0 {
        return Err("No complete audio chunks are available yet.".into());
    }
    let data_bytes = u32::try_from(size)
        .ok()
        .filter(|bytes| *bytes <= u32::MAX - 36)
        .ok_or("The recording exceeds the WAV size limit. Its chunks are kept.")?;
    let directory = root.join("recordings").join(id);
    crate::audio::prepare::contained(root, &root.join("recordings"))?;
    if !directory.exists() {
        fs::create_dir(&directory).map_err(io_error)?;
    }
    crate::audio::prepare::contained(root, &directory)?;
    let temp_path = directory.join("audio.wav.part");
    let final_path = directory.join("audio.wav");
    for path in [&temp_path, &final_path, &directory.join("saved.json.part")] {
        if path.exists() {
            crate::audio::prepare::contained(root, path)?;
        }
    }
    let mut output = File::create(&temp_path).map_err(io_error)?;
    output
        .write_all(&wav_header(manifest.sample_rate, data_bytes))
        .map_err(io_error)?;
    for path in chunks {
        io::copy(&mut File::open(path).map_err(io_error)?, &mut output).map_err(io_error)?;
    }
    output.sync_all().map_err(io_error)?;
    if output.metadata().map_err(io_error)?.len() != size + 44 {
        return Err("The final recording has an unexpected size. Its chunks are kept.".into());
    }
    drop(output);
    let sha256 = hash_file(&temp_path)?;
    if final_path.exists() {
        // A previous process may have died between finalizing the WAV and its receipt.
        if hash_file(&final_path)? != sha256 {
            return Err(
                "A different finalized recording already exists. Neither file was overwritten."
                    .into(),
            );
        }
        fs::remove_file(&temp_path).map_err(io_error)?;
    } else {
        fs::rename(&temp_path, &final_path).map_err(io_error)?;
    }
    let saved = SavedRecording {
        attempt_id: id.into(),
        asset_id: id.into(),
        title: manifest.title,
        created_at_ms: manifest.created_at_ms,
        duration_ms: (size / 2) * 1000 / u64::from(manifest.sample_rate),
        sample_rate: manifest.sample_rate,
        channels: 1,
        source_channels: manifest.source_channels,
        source_format: manifest.source_format,
        bytes: size + 44,
        sha256,
        recovered,
    };
    write_json(&directory.join("saved.json"), &saved)?;
    read_saved(root, id)?.ok_or("The recording receipt was not committed.".into())
}

fn journal_ids(root: &Path) -> Result<Vec<String>> {
    fs::read_dir(root.join("recovery"))
        .map_err(io_error)?
        .filter_map(|entry| match entry {
            Ok(entry) if entry.path().is_dir() => {
                let id = entry.file_name().to_string_lossy().into_owned();
                validate_id(&id).ok().map(|_| Ok(id))
            }
            Ok(_) => None,
            Err(error) => Some(Err(io_error(error))),
        })
        .collect()
}

pub fn list_saved(root: &Path) -> Result<Vec<SavedRecording>> {
    let mut list = Vec::new();
    for id in journal_ids(root)? {
        if let Ok(Some(saved)) = read_saved(root, &id) {
            list.push(saved);
        }
    }
    list.sort_by_key(|recording| std::cmp::Reverse(recording.created_at_ms));
    Ok(list)
}

pub fn list_recoverable(root: &Path) -> Result<Vec<RecoverableRecording>> {
    let mut list = Vec::new();
    for id in journal_ids(root)? {
        if matches!(read_saved(root, &id), Ok(Some(_))) {
            continue;
        }
        let result = read_manifest(root, &id);
        let (title, created_at_ms, duration_ms, reason) = match result {
            Ok(manifest) => match closed_chunks(root, &manifest) {
                Ok(chunks) => {
                    let bytes = chunks
                        .iter()
                        .try_fold(0u64, |sum, path| fs::metadata(path).map(|m| sum + m.len()))
                        .map_err(io_error)?;
                    (
                        manifest.title,
                        Some(manifest.created_at_ms),
                        Some(bytes / 2 * 1000 / u64::from(manifest.sample_rate)),
                        (bytes == 0).then(|| "No complete audio chunks were captured.".into()),
                    )
                }
                Err(error) => (
                    manifest.title,
                    Some(manifest.created_at_ms),
                    None,
                    Some(error),
                ),
            },
            Err(error) => ("Interrupted recording".into(), None, None, Some(error)),
        };
        list.push(RecoverableRecording {
            attempt_id: id,
            title,
            created_at_ms,
            duration_ms,
            unavailable_reason: reason,
        });
    }
    list.sort_by_key(|recording| std::cmp::Reverse(recording.created_at_ms));
    Ok(list)
}

/// Permanently removes the chunks of an interrupted take the user chose not to
/// recover (plan 2.5). Saved takes are refused: they belong to Trash.
pub fn discard_recoverable(root: &Path, id: &str) -> Result<()> {
    validate_id(id)?;
    if read_saved(root, id).ok().flatten().is_some() || root.join("recordings").join(id).join("saved.json").exists() {
        return Err("This take was saved. Move its session to Trash instead.".into());
    }
    let dir = root.join("recovery").join(id);
    if fs::symlink_metadata(&dir).is_err() {
        return Ok(());
    }
    crate::audio::prepare::contained(root, &dir)?;
    fs::remove_dir_all(&dir).map_err(io_error)
}

pub fn playback_path(root: &Path, id: &str) -> Result<PathBuf> {
    let saved = read_saved(root, id)?.ok_or("Saved recording not found.")?;
    let path = root.join("recordings").join(id).join("audio.wav");
    if hash_file(&path)? != saved.sha256 {
        return Err("The recording checksum failed verification. Its chunks are kept.".into());
    }
    Ok(path)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    pub struct TestRoot(pub PathBuf);
    impl TestRoot {
        pub fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "clearpractice-audio-{}-{}-{}",
                std::process::id(),
                now_ms(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            crate::app_paths::prepare_app_data(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    pub fn manifest(id: &str) -> CaptureManifest {
        CaptureManifest {
            version: 1,
            attempt_id: id.into(),
            idempotency_key: format!("op-{id}"),
            title: "Test take".into(),
            device_id: "test".into(),
            device_name: "Synthetic".into(),
            sample_rate: 48_000,
            source_channels: 2,
            source_format: "F32".into(),
            created_at_ms: now_ms(),
        }
    }

    /// Launch a separate recorder process and terminate it without cleanup.
    /// The parent reopens the journal exactly as a fresh app launch would.
    pub fn kill_child_and_recover(test_name: &str, id: &str) {
        use std::{
            io::BufRead,
            process::{Command, Stdio},
        };
        let root = TestRoot::new();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test_name, "--ignored", "--nocapture"])
            .env("CLEARPRACTICE_CRASH_TEST_ROOT", &root.0)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut captured_ms = None;
        for line in std::io::BufReader::new(stdout).lines() {
            let line = line.unwrap();
            if let Some(value) = line.strip_prefix("CAPTURED_MS=") {
                captured_ms = Some(value.parse::<u64>().unwrap());
                break;
            }
        }
        child.kill().expect("force-terminate only the test child");
        let status = child.wait().unwrap();
        assert!(
            !status.success(),
            "child must be killed, not gracefully stopped"
        );
        let captured_ms = captured_ms.expect("child reached its capture checkpoint");
        let recovered = finalize(&root.0, id, true).unwrap();
        assert!(captured_ms >= recovered.duration_ms);
        let lost_ms = captured_ms - recovered.duration_ms;
        assert!(lost_ms <= 2000, "lost {lost_ms} ms exceeds the 2 s target");
        playback_path(&root.0, id).unwrap();
        println!("Forced kill: captured {captured_ms} ms, recovered {} ms, lost {lost_ms} ms; checksum verified.", recovered.duration_ms);
    }

    #[test]
    #[ignore = "child process for forced-kill testing"]
    fn synthetic_crash_child() {
        let Some(root) = std::env::var_os("CLEARPRACTICE_CRASH_TEST_ROOT") else {
            return;
        };
        let mut writer = ChunkWriter::create(Path::new(&root), &manifest("forced-kill")).unwrap();
        for frame in 0..177_600 {
            writer.push((frame % 30_000) as i16).unwrap();
        }
        println!("CAPTURED_MS=3700");
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }

    #[test]
    fn forced_process_kill_recovers_within_two_seconds() {
        kill_child_and_recover(
            "storage::recording::tests::synthetic_crash_child",
            "forced-kill",
        );
    }

    #[test]
    fn stop_finalizes_exact_pcm_and_is_idempotent() {
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("one")).unwrap();
        for frame in 0..60_000 {
            writer.push((frame % 30_000) as i16).unwrap();
        }
        writer.flush().unwrap();
        let saved = finalize(&root.0, "one", false).unwrap();
        assert_eq!(saved.duration_ms, 1250);
        assert_eq!(saved.bytes, 120_044);
        assert_eq!(saved.channels, 1);
        assert_eq!(
            finalize(&root.0, "one", false).unwrap().sha256,
            saved.sha256
        );
        assert!(list_recoverable(&root.0).unwrap().is_empty());
        assert_eq!(list_saved(&root.0).unwrap().len(), 1);
        let bytes = fs::read(playback_path(&root.0, "one").unwrap()).unwrap();
        assert_eq!(&bytes[44..46], &0i16.to_le_bytes());
        assert_eq!(&bytes[46..48], &1i16.to_le_bytes());
    }

    #[test]
    fn recovery_ignores_partial_tail_and_preserves_closed_chunks() {
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("crash")).unwrap();
        for _ in 0..129_600 {
            writer.push(2345).unwrap();
        }
        drop(writer); // Simulated crash: last 0.7 s stays in memory.
        fs::write(root.0.join("recovery/crash/00000002.part"), [1, 2, 3]).unwrap();
        let entries = list_recoverable(&root.0).unwrap();
        assert_eq!(entries[0].duration_ms, Some(2000));
        let saved = finalize(&root.0, "crash", true).unwrap();
        assert!(saved.recovered);
        assert_eq!(saved.duration_ms, 2000);
    }

    #[test]
    fn discarding_removes_only_unsaved_interrupted_takes() {
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("lost")).unwrap();
        for _ in 0..48_000 {
            writer.push(7).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        assert_eq!(list_recoverable(&root.0).unwrap().len(), 1);
        discard_recoverable(&root.0, "lost").unwrap();
        assert!(list_recoverable(&root.0).unwrap().is_empty());
        assert!(discard_recoverable(&root.0, "lost").is_ok(), "idempotent");
        assert!(discard_recoverable(&root.0, "../x").is_err());

        let mut writer = ChunkWriter::create(&root.0, &manifest("kept")).unwrap();
        writer.push(1).unwrap();
        writer.flush().unwrap();
        drop(writer);
        finalize(&root.0, "kept", false).unwrap();
        assert!(discard_recoverable(&root.0, "kept").is_err(), "saved takes go through Trash");
        assert!(root.0.join("recovery/kept").exists());
    }

    #[test]
    fn missing_or_corrupt_chunks_never_report_saved() {
        let root = TestRoot::new();
        let _writer = ChunkWriter::create(&root.0, &manifest("broken")).unwrap();
        let path = root.0.join("recovery/broken/00000001.pcm");
        fs::write(&path, [1, 0]).unwrap();
        assert!(finalize(&root.0, "broken", true).is_err());
        fs::rename(path, root.0.join("recovery/broken/00000000.pcm")).unwrap();
        fs::write(root.0.join("recovery/broken/00000000.pcm"), [1]).unwrap();
        assert!(finalize(&root.0, "broken", true).is_err());
        assert!(read_saved(&root.0, "broken").unwrap().is_none());
    }

    #[test]
    fn rejects_paths_and_retains_chunks_when_finalization_fails() {
        let root = TestRoot::new();
        assert!(finalize(&root.0, "../escape", true).is_err());
        assert!(validate_id("C:\\file").is_err());
        let mut writer = ChunkWriter::create(&root.0, &manifest("retry")).unwrap();
        for _ in 0..48_000 {
            writer.push(1).unwrap();
        }
        fs::write(root.0.join("recordings/retry"), "blocked directory").unwrap();
        assert!(finalize(&root.0, "retry", false).is_err());
        assert!(root.0.join("recovery/retry/00000000.pcm").is_file());
        fs::remove_file(root.0.join("recordings/retry")).unwrap();
        assert_eq!(finalize(&root.0, "retry", true).unwrap().duration_ms, 1000);
    }
}
