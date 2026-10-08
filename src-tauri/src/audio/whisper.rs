//! M0 local worker protocol. Configuration is trusted native data, never a
//! frontend path/command. Run on a background owner; capture can cancel it.
use super::prepare::{self, PreparedAudio};
use crate::storage::recording;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
const MAX_JSON: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Cpu,
    Cuda,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFile {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerConfig {
    pub version: u32,
    pub runtime_version: String,
    pub executable: PathBuf,
    pub runtime_files: Vec<RuntimeFile>,
    pub model: PathBuf,
    pub model_id: String,
    pub model_sha256: String,
    pub backend: Backend,
    pub threads: u8,
    pub prompt: Option<String>,
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl WorkerConfig {
    pub(crate) fn verify(&self) -> Result<()> {
        if self.version != 1
            || self.runtime_version != "1.9.1"
            || !(1..=4).contains(&self.threads)
            || !valid_hash(&self.model_sha256)
            || self
                .prompt
                .as_ref()
                .is_some_and(|p| p.len() > 512 || p.contains('\0'))
            || self.executable.file_name().and_then(|n| n.to_str()) != Some("whisper-cli.exe")
            || self.runtime_files.is_empty()
            || self.runtime_files.len() > 64
        {
            return Err("Invalid or unsupported Whisper worker configuration.".into());
        }
        recording::validate_id(&self.model_id)?;
        let dir = self
            .executable
            .parent()
            .ok_or("Whisper worker folder is unavailable.")?;
        let mut names = std::collections::HashSet::new();
        for item in &self.runtime_files {
            if item.name.is_empty()
                || item.name.len() > 128
                || !valid_hash(&item.sha256)
                || !item
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                || !names.insert(item.name.to_lowercase())
            {
                return Err("Invalid Whisper runtime manifest.".into());
            }
            let path = dir.join(&item.name);
            let metadata =
                fs::symlink_metadata(&path).map_err(|_| "A Whisper runtime file is missing.")?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != item.bytes
                || recording::hash_file(&path)? != item.sha256
            {
                return Err("A Whisper runtime file failed checksum verification.".into());
            }
        }
        if !names.contains("whisper-cli.exe") {
            return Err("The worker is absent from its verified manifest.".into());
        }
        for entry in fs::read_dir(dir).map_err(|_| "Cannot inspect the Whisper runtime folder.")? {
            let name = entry
                .map_err(|_| "Cannot inspect the Whisper runtime folder.")?
                .file_name();
            let name = name.to_string_lossy().to_lowercase();
            if name.ends_with(".dll") && !names.contains(&name) {
                return Err("The Whisper runtime contains an unverified library.".into());
            }
        }
        if recording::hash_file(&self.model)? != self.model_sha256 {
            return Err(
                "The Whisper model failed checksum verification. The recording is preserved."
                    .into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerProgress {
    pub run_id: String,
    pub phase: String,
    pub percent: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Segment {
    pub text: String,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub timing_source: String,
    pub timing_unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transcript {
    pub version: u32,
    pub run_id: String,
    pub asset_id: String,
    pub provider: String,
    pub model_id: String,
    pub model_sha256: String,
    pub runtime_version: String,
    pub backend: Backend,
    pub threads: u8,
    pub prompt: Option<String>,
    pub source_sha256: String,
    pub prepared_sha256: String,
    pub language: String,
    pub raw_text: String,
    pub segments: Vec<Segment>,
    pub elapsed_ms: u64,
    pub peak_ram_bytes: Option<u64>,
    pub peak_ram_unavailable_reason: Option<String>,
    pub created_at_ms: u64,
}

#[derive(Deserialize)]
struct RawOutput {
    result: RawLanguage,
    transcription: Vec<RawSegment>,
}
#[derive(Deserialize)]
struct RawLanguage {
    language: String,
}
#[derive(Deserialize)]
struct RawSegment {
    text: String,
    offsets: RawOffsets,
}
#[derive(Deserialize)]
struct RawOffsets {
    from: u64,
    to: u64,
}

fn segments(bytes: &[u8], duration_ms: u64) -> Result<(String, Vec<Segment>)> {
    let raw: RawOutput = serde_json::from_slice(bytes)
        .map_err(|_| "Whisper returned invalid JSON; retry transcription.")?;
    if raw.result.language != "en" || raw.transcription.len() > 20_000 {
        return Err("Whisper returned an unsupported language or oversized result.".into());
    }
    let mut previous = 0;
    let mut result = Vec::new();
    for segment in raw.transcription {
        if segment.text.len() > 64_000
            || segment.text.contains('\0')
            || segment.offsets.to < segment.offsets.from
            || segment.offsets.from < previous
        {
            return Err("Whisper returned invalid segments.".into());
        }
        previous = segment.offsets.from;
        let valid = segment.offsets.to <= duration_ms;
        result.push(Segment {
            text: segment.text,
            start_ms: valid.then_some(segment.offsets.from),
            end_ms: valid.then_some(segment.offsets.to),
            timing_source: "Estimated".into(),
            timing_unavailable_reason: (!valid)
                .then(|| "Worker timing exceeds the recording duration.".into()),
        });
    }
    // A worker success with no speech is not a completed transcript.
    if result.iter().all(|s| s.text.trim().is_empty()) {
        return Err(
            "Whisper found no speech. The recording is preserved for playback and retry.".into(),
        );
    }
    Ok((raw.result.language, result))
}

fn progress(line: &[u8]) -> Option<u8> {
    let line = std::str::from_utf8(line).ok()?;
    let value = line
        .strip_prefix("whisper_print_progress_callback: progress =")?
        .trim()
        .strip_suffix('%')?
        .trim();
    value.parse::<u8>().ok().filter(|p| *p <= 100)
}

/// Drop is a last-resort process guard: all error paths terminate and reap.
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(windows)]
fn peak_ram(child: &Child) -> Option<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    let ok = unsafe {
        K32GetProcessMemoryInfo(
            child.as_raw_handle(),
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };
    (ok != 0).then_some(counters.PeakWorkingSetSize as u64)
}
#[cfg(not(windows))]
fn peak_ram(_: &Child) -> Option<u64> {
    None
}

pub struct WhisperWorker {
    root: PathBuf,
    active: Mutex<()>,
}
impl WhisperWorker {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            active: Mutex::new(()),
        }
    }

    pub fn transcribe(
        &self,
        config: &WorkerConfig,
        asset_id: &str,
        run_id: &str,
        cancel: &AtomicBool,
        emit: impl Fn(WorkerProgress),
    ) -> Result<Transcript> {
        let _guard = self
            .active
            .try_lock()
            .map_err(|_| "A local transcription is already running.")?;
        recording::validate_id(run_id)?;
        recording::validate_id(asset_id)?;
        let notify = |phase: &str, percent| {
            emit(WorkerProgress {
                run_id: run_id.into(),
                phase: phase.into(),
                percent,
            })
        };
        notify("preparing", None);
        if cancel.load(Ordering::Relaxed) {
            notify("canceled", None);
            return Err("Transcription canceled; the recording is preserved.".into());
        }
        let result = (|| {
            config.verify()?;
            let audio = prepare::prepare(&self.root, asset_id, cancel)?;
            let path = prepare::prepared_path(&self.root, &audio)?;
            let parent = self.root.join("cache").join("whisper");
            prepare::contained(&self.root, &self.root.join("cache"))?;
            if !parent.exists() {
                fs::create_dir(&parent).map_err(|_| "Cannot create the transcription cache.")?;
            }
            prepare::contained(&self.root, &parent)?;
            let dir = parent.join(run_id);
            fs::create_dir(&dir)
                .map_err(|_| "Cannot reserve a new transcription run. Use a new run ID.")?;
            prepare::contained(&self.root, &dir)?;
            let result = self.run(config, &audio, &path, &dir, run_id, cancel, &notify);
            if result.is_err() {
                let _ = fs::remove_file(dir.join("raw.json"));
                let _ = fs::remove_file(dir.join("result.json.part"));
                let _ = fs::remove_file(dir.join("transcription.json.part"));
                let _ = fs::remove_file(dir.join("transcription.json"));
            }
            result
        })();
        notify(
            if result.is_ok() {
                "completed"
            } else if cancel.load(Ordering::Relaxed) {
                "canceled"
            } else {
                "failed"
            },
            None,
        );
        result
    }

    fn run(
        &self,
        config: &WorkerConfig,
        audio: &PreparedAudio,
        path: &Path,
        dir: &Path,
        run_id: &str,
        cancel: &AtomicBool,
        notify: &impl Fn(&str, Option<u8>),
    ) -> Result<Transcript> {
        if cancel.load(Ordering::Relaxed) {
            return Err("Transcription canceled; the recording is preserved.".into());
        }
        let mut command = Command::new(&config.executable);
        command
            .current_dir(
                config
                    .executable
                    .parent()
                    .ok_or("Missing worker directory.")?,
            )
            .args(["-m"])
            .arg(&config.model)
            .args(["-f"])
            .arg(path)
            .args(["-l", "en", "-t"])
            .arg(config.threads.to_string())
            .args(["-ojf", "-pp", "-of"])
            .arg(dir.join("raw"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if config.backend == Backend::Cpu {
            command.arg("-ng");
        }
        if let Some(prompt) = &config.prompt {
            command.arg("--prompt").arg(prompt);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000 | 0x00004000); // hidden, below normal priority
        }
        let started = Instant::now();
        let mut process = Process(command.spawn().map_err(|_| {
            "Cannot start the verified Whisper worker. Check its runtime prerequisites."
        })?);
        let stderr = process
            .0
            .stderr
            .take()
            .ok_or("Cannot read worker progress.")?;
        let (tx, rx) = mpsc::sync_channel(16);
        let drain = thread::spawn(move || {
            let mut stream = stderr;
            let mut chunk = [0; 2048];
            let mut line = Vec::with_capacity(4096);
            let mut discard = false;
            let mut used_cuda = false;
            while let Ok(n) = stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                for byte in &chunk[..n] {
                    if *byte == b'\n' {
                        if !discard {
                            if let Some(p) = progress(&line) {
                                let _ = tx.try_send(p);
                            }
                            used_cuda |= String::from_utf8_lossy(&line).contains("using CUDA");
                        }
                        line.clear();
                        discard = false;
                    } else if line.len() < 4096 {
                        line.push(*byte);
                    } else {
                        discard = true;
                    }
                }
            }
            used_cuda
        });
        notify("running", Some(0));
        let mut last = 0;
        let mut peak = None;
        let outcome = loop {
            if let Some(bytes) = peak_ram(&process.0) {
                peak = Some(peak.unwrap_or(0u64).max(bytes));
            }
            for p in rx.try_iter() {
                if p > last {
                    last = p;
                    notify("running", Some(p));
                }
            }
            if fs::metadata(dir.join("raw.json")).is_ok_and(|m| m.len() > MAX_JSON) {
                let _ = process.0.kill();
                let _ = process.0.wait();
                break Err("Whisper returned an oversized result.");
            }
            if cancel.load(Ordering::Relaxed) || started.elapsed() > Duration::from_secs(600) {
                let _ = process.0.kill();
                let _ = process.0.wait();
                break Err(if cancel.load(Ordering::Relaxed) {
                    "Transcription canceled; the recording is preserved."
                } else {
                    "Whisper exceeded the ten-minute worker limit. The recording is preserved."
                });
            }
            match process.0.try_wait() {
                Ok(Some(status)) => {
                    break if status.success() {
                        Ok(())
                    } else {
                        Err("Whisper could not finish. The recording is preserved; check the model/backend and retry.")
                    }
                }
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => {
                    let _ = process.0.kill();
                    let _ = process.0.wait();
                    break Err("Cannot monitor the Whisper worker.");
                }
            }
        };
        let used_cuda = drain.join().map_err(|_| "Worker progress reader failed.")?;
        for p in rx.try_iter() {
            if p > last {
                last = p;
                notify("running", Some(p));
            }
        }
        outcome?;
        if config.backend == Backend::Cuda && !used_cuda {
            return Err(
                "CUDA was selected but not used. Choose CPU explicitly or repair the GPU runtime."
                    .into(),
            );
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("Transcription canceled; the recording is preserved.".into());
        }
        let raw_path = dir.join("raw.json");
        let file = File::open(&raw_path).map_err(|_| "Whisper did not create a JSON result.")?;
        if file
            .metadata()
            .map_err(|_| "Cannot inspect the worker result.")?
            .len()
            > MAX_JSON
        {
            return Err("Whisper returned an oversized result.".into());
        }
        let mut raw = Vec::new();
        file.take(MAX_JSON + 1)
            .read_to_end(&mut raw)
            .map_err(|_| "Cannot read the worker result.")?;
        if raw.len() as u64 > MAX_JSON {
            return Err("Whisper returned an oversized result.".into());
        }
        let (language, segments) = segments(&raw, audio.duration_ms)?;
        let transcript = Transcript {
            version: 1,
            run_id: run_id.into(),
            asset_id: audio.asset_id.clone(),
            provider: "local-whisper".into(),
            model_id: config.model_id.clone(),
            model_sha256: config.model_sha256.clone(),
            runtime_version: config.runtime_version.clone(),
            backend: config.backend,
            threads: config.threads,
            prompt: config.prompt.clone(),
            source_sha256: audio.source_sha256.clone(),
            prepared_sha256: audio.sha256.clone(),
            language,
            raw_text: segments.iter().map(|s| s.text.as_str()).collect::<String>(),
            segments,
            elapsed_ms: started.elapsed().as_millis() as u64,
            peak_ram_bytes: peak,
            peak_ram_unavailable_reason: peak
                .is_none()
                .then(|| "Worker peak memory could not be read on this platform.".into()),
            created_at_ms: recording::now_ms(),
        };
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&raw_path)
            .and_then(|f| f.sync_all())
            .map_err(|_| "Cannot sync the raw transcript.")?;
        let common =
            super::transcription::TranscriptionResult::from_local(&transcript, audio.duration_ms)?;
        let common_part = dir.join("transcription.json.part");
        let mut common_file =
            File::create(&common_part).map_err(|_| "Cannot save the common transcript.")?;
        serde_json::to_writer(&mut common_file, &common)
            .map_err(|_| "Cannot encode the common transcript.")?;
        common_file
            .flush()
            .and_then(|_| common_file.sync_all())
            .map_err(|_| "Cannot sync the common transcript.")?;
        drop(common_file);
        fs::rename(common_part, dir.join("transcription.json"))
            .map_err(|_| "Cannot commit the common transcript.")?;
        let part = dir.join("result.json.part");
        let mut file = File::create(&part).map_err(|_| "Cannot save the transcript.")?;
        serde_json::to_writer(&mut file, &transcript)
            .map_err(|_| "Cannot encode the transcript.")?;
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot sync the transcript.")?;
        drop(file);
        fs::rename(part, dir.join("result.json")).map_err(|_| "Cannot commit the transcript.")?;
        notify("running", Some(100));
        Ok(transcript)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_workers_and_releases_the_owner_after_failure() {
        let root = crate::storage::recording::tests::TestRoot::new();
        let worker = WhisperWorker::new(root.0.clone());
        let config = WorkerConfig {
            version: 1,
            runtime_version: "1.9.1".into(),
            executable: root.0.join("whisper-cli.exe"),
            runtime_files: vec![RuntimeFile {
                name: "whisper-cli.exe".into(),
                bytes: 1,
                sha256: "0".repeat(64),
            }],
            model: root.0.join("model.bin"),
            model_id: "base".into(),
            model_sha256: "0".repeat(64),
            backend: Backend::Cpu,
            threads: 1,
            prompt: None,
        };
        let cancel = AtomicBool::new(false);
        let first = worker.transcribe(&config, "asset", "outer", &cancel, |p| {
            if p.phase == "preparing" {
                let busy = worker
                    .transcribe(&config, "asset", "inner", &cancel, |_| {})
                    .unwrap_err();
                assert!(busy.contains("already running"));
            }
        });
        assert!(first.unwrap_err().contains("missing"));
        cancel.store(true, Ordering::Relaxed);
        assert!(worker
            .transcribe(&config, "asset", "next", &cancel, |_| {})
            .unwrap_err()
            .contains("canceled"));
    }

    #[test]
    fn validates_output_without_inventing_alignment() {
        let raw = br#"{"result":{"language":"en"},"transcription":[{"text":" hello","offsets":{"from":0,"to":2000}},{"text":" world","offsets":{"from":2000,"to":4000}}]}"#;
        let (_, rows) = segments(raw, 3000).unwrap();
        assert_eq!(rows[0].start_ms, Some(0));
        assert_eq!(rows[0].timing_source, "Estimated");
        assert_eq!(rows[1].end_ms, None);
        assert!(rows[1].timing_unavailable_reason.is_some());
        for bad in [br#"{}"#.as_slice(), br#"{"result":{"language":"en"},"transcription":[]}"#,
            br#"{"result":{"language":"en"},"transcription":[{"text":"hello","offsets":{"from":10,"to":1}}]}"#] {
            assert!(segments(bad, 3000).is_err());
        }
    }

    #[test]
    fn progress_is_narrow_and_bounded() {
        assert_eq!(
            progress(b"whisper_print_progress_callback: progress =  35%"),
            Some(35)
        );
        assert_eq!(
            progress(b"whisper_print_progress_callback: progress = 101%"),
            None
        );
        assert_eq!(progress(b"secret transcript progress = 35%"), None);
        assert_eq!(progress(&[255, 254]), None);
    }
}
