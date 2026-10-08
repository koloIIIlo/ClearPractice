//! Local transcription in the app (plan 3.1–3.3, 3.11). The worker setup is
//! trusted native data: chosen in a native file picker, verified (runtime files
//! and model hashes) before it is stored, and re-verified by every run. One job
//! runs at a time; recording always takes priority.
use crate::audio::whisper::{Backend, WorkerConfig};
use crate::storage::database::DatabaseOwner;
use serde::Serialize;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

type Result<T> = std::result::Result<T, String>;

pub const CONFIG_KEY: &str = "transcription_local_config";
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub configured: bool,
    pub model_id: Option<String>,
    pub backend: Option<Backend>,
    pub prompt: Option<String>,
    /// Set when no usable setup is stored.
    pub unavailable_reason: Option<String>,
}

/// Transcription runs are named `<attempt>--<started ms>` so Trash can find and
/// remove every run folder that belongs to a take.
pub fn run_id(attempt_id: &str, now_ms: u64) -> String {
    format!("{attempt_id}--{now_ms}")
}

pub fn load_config(owner: &DatabaseOwner) -> Result<WorkerConfig> {
    let stored = owner
        .setting(CONFIG_KEY)?
        .ok_or("Set up local transcription in Settings → Transcription first.")?;
    serde_json::from_str(&stored)
        .map_err(|_| "The stored transcription setup is unreadable. Choose the setup file again.".into())
}

pub fn status(owner: &DatabaseOwner) -> Result<SetupStatus> {
    Ok(match load_config(owner) {
        Ok(config) => SetupStatus {
            configured: true,
            model_id: Some(config.model_id),
            backend: Some(config.backend),
            prompt: config.prompt,
            unavailable_reason: None,
        },
        Err(reason) => SetupStatus {
            configured: false,
            model_id: None,
            backend: None,
            prompt: None,
            unavailable_reason: Some(reason),
        },
    })
}

/// Reads a worker configuration file, verifies every runtime file and the
/// model checksum, and only then stores it. A failure keeps the previous setup.
pub fn import_config(owner: &DatabaseOwner, file: &Path) -> Result<SetupStatus> {
    let size = std::fs::metadata(file)
        .map_err(|_| "The setup file cannot be read.")?
        .len();
    if size > MAX_CONFIG_BYTES {
        return Err("This is not a ClearPractice transcription setup file.".into());
    }
    let bytes = std::fs::read(file).map_err(|_| "The setup file cannot be read.")?;
    let config: WorkerConfig = serde_json::from_slice(&bytes)
        .map_err(|_| "This is not a ClearPractice transcription setup file.")?;
    config.verify()?;
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    owner.set_setting(CONFIG_KEY, &json)?;
    status(owner)
}

struct Running {
    job_id: String,
    attempt_id: String,
    cancel: Arc<AtomicBool>,
}

/// Tracks the single running job so it can be cancelled and so recording,
/// restore and a second request can see it.
#[derive(Default)]
pub struct ActiveJob(Mutex<Option<Running>>);

impl ActiveJob {
    pub fn begin(&self, job_id: &str, attempt_id: &str) -> Result<Arc<AtomicBool>> {
        let mut active = self.0.lock().map_err(|_| "Transcription state is unavailable.")?;
        if active.is_some() {
            return Err("Another transcription is running. Wait for it or cancel it first.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(Running { job_id: job_id.into(), attempt_id: attempt_id.into(), cancel: cancel.clone() });
        Ok(cancel)
    }

    pub fn end(&self, job_id: &str) {
        if let Ok(mut active) = self.0.lock() {
            if active.as_ref().is_some_and(|r| r.job_id == job_id) {
                *active = None;
            }
        }
    }

    /// Asks the running job to stop; returns the attempt it belonged to.
    pub fn cancel(&self) -> Option<String> {
        let active = self.0.lock().ok()?;
        let running = active.as_ref()?;
        running.cancel.store(true, Ordering::Release);
        Some(running.attempt_id.clone())
    }

    pub fn is_active(&self) -> bool {
        self.0.lock().map(|a| a.is_some()).unwrap_or(true)
    }

    pub fn attempt(&self) -> Option<String> {
        self.0.lock().ok()?.as_ref().map(|r| r.attempt_id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_job_at_a_time_and_cancel_reaches_the_running_job() {
        let jobs = ActiveJob::default();
        let flag = jobs.begin("job-1", "take-a").unwrap();
        assert!(jobs.is_active());
        assert!(jobs.begin("job-2", "take-b").is_err());
        assert_eq!(jobs.cancel().as_deref(), Some("take-a"));
        assert!(flag.load(Ordering::Acquire));
        jobs.end("job-other");
        assert!(jobs.is_active(), "only the owning job can end itself");
        jobs.end("job-1");
        assert!(!jobs.is_active());
        assert!(jobs.cancel().is_none());
        assert_eq!(run_id("take-a", 5), "take-a--5");
    }

    /// Real hardware run: `cargo test --lib transcribe -- --ignored`. Uses the
    /// verified M0 setup and public sample from `bench/` (see bench/README.md).
    #[test]
    #[ignore]
    fn hardware_transcribes_a_saved_take_into_sqlite_and_trash_removes_the_run() {
        use crate::audio::whisper::WhisperWorker;
        use crate::storage::recording::{self, tests::TestRoot, ChunkWriter, CaptureManifest};
        let bench = Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench");
        let wav = std::fs::read(bench.join("samples/public-62s.wav")).unwrap();
        let root = TestRoot::new();
        let manifest = CaptureManifest {
            version: 1, attempt_id: "public".into(), idempotency_key: "public".into(), title: "Public sample".into(),
            device_id: "fixture".into(), device_name: "Fixture".into(), sample_rate: 16_000, source_channels: 1,
            source_format: "i16".into(), created_at_ms: recording::now_ms(),
        };
        let mut writer = ChunkWriter::create(&root.0, &manifest).unwrap();
        for pair in wav[44..].chunks_exact(2) {
            writer.push(i16::from_le_bytes([pair[0], pair[1]])).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        recording::finalize(&root.0, "public", false).unwrap();
        let owner = DatabaseOwner::open(&root.0).unwrap();

        let setup = import_config(&owner, &bench.join("runtime.local/config-selected.json")).unwrap();
        assert!(setup.configured);
        let config = load_config(&owner).unwrap();
        let started = recording::now_ms();
        let run = run_id("public", started);
        owner.start_job("job-1", "public", started).unwrap();
        let worker = WhisperWorker::new(root.0.clone());
        let transcript = worker
            .transcribe(&config, "public", &run, &AtomicBool::new(false), |_| {})
            .unwrap();
        owner.save_local_transcript("job-1", "public", &transcript, recording::now_ms()).unwrap();

        let saved = owner.attempt_transcript("public").unwrap();
        assert_eq!(saved["job"]["state"], "completed");
        let text = saved["revision"]["text"].as_str().unwrap().to_lowercase();
        println!("TRANSCRIPT: {text}");
        assert!(text.split_whitespace().count() > 50, "{text}");
        assert!(text.contains("uh") || text.contains("um"), "filler prompt should keep fillers: {text}");
        assert!(saved["revision"]["segments"].as_array().unwrap().iter().all(|s| s["timingSource"] == "Estimated"));
        assert!(root.0.join("cache/whisper").join(&run).is_dir());

        owner.move_to_trash("public", recording::now_ms()).unwrap();
        assert!(!owner.delete_permanently(&["public".into()]).unwrap());
        assert!(!root.0.join("cache/whisper").join(&run).exists());
        assert!(owner.attempt_transcript("public").unwrap()["revision"].is_null());
    }
}
