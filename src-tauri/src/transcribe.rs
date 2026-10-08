//! Local transcription in the app (plan 3.1–3.3, 3.11). The worker setup is
//! trusted native data: chosen in a native file picker, verified (runtime files
//! and model hashes) before it is stored, and re-verified by every run. One job
//! runs at a time; recording always takes priority.
use crate::audio::whisper::{Backend, WorkerConfig};
use crate::storage::database::DatabaseOwner;
use serde::{Deserialize, Serialize};
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

const PREFERENCE_KEY: &str = "transcription_preference";

/// How takes are transcribed by default (§10 Transcription Local / API). Cloud
/// mode never sends by itself: each take is still previewed and sent only after
/// an explicit Send, under the shared budget.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionMode {
    #[default]
    Local,
    Api,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preference {
    pub mode: TranscriptionMode,
    pub provider: crate::api::audio::AudioProvider,
}

impl Default for Preference {
    fn default() -> Self {
        Self { mode: TranscriptionMode::Local, provider: crate::api::audio::AudioProvider::Deepgram }
    }
}

/// The stored preference; anything missing or unreadable means local.
pub fn preference(owner: &DatabaseOwner) -> Result<Preference> {
    Ok(owner
        .setting(PREFERENCE_KEY)?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default())
}

pub fn set_preference(owner: &DatabaseOwner, preference: Preference) -> Result<Preference> {
    owner.set_setting(PREFERENCE_KEY, &serde_json::to_string(&preference).map_err(|e| e.to_string())?)?;
    Ok(preference)
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
    let mut config: WorkerConfig = serde_json::from_str(&stored)
        .map_err(|_| "The stored transcription setup is unreadable. Choose the setup file again.")?;
    // Prefer the app's own verified copy of the same model (plan 3.3).
    if let Some(installed) = crate::models::installed_path(owner.root(), &config.model_sha256) {
        config.model = installed;
    }
    Ok(config)
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
    fn the_preference_defaults_to_local_and_survives_a_restart() {
        use crate::storage::recording::tests::TestRoot;
        let root = TestRoot::new();
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(preference(&owner).unwrap(), Preference::default());
        let cloud = Preference { mode: TranscriptionMode::Api, provider: crate::api::audio::AudioProvider::Assemblyai };
        set_preference(&owner, cloud).unwrap();
        drop(owner);
        let owner = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(preference(&owner).unwrap(), cloud);
        assert_eq!(serde_json::to_value(cloud).unwrap(), serde_json::json!({"mode": "api", "provider": "assemblyai"}));
        owner.set_setting(PREFERENCE_KEY, "{\"mode\":\"telepathy\"}").unwrap();
        assert_eq!(preference(&owner).unwrap(), Preference::default(), "unreadable means local");
    }

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

        let saved = owner.attempt_transcript_with_voice("public").unwrap();
        println!("VOICE: {}", saved["revision"]["measures"]["voice"]);
        assert_eq!(saved["revision"]["measures"]["voice"]["method"], "peak-energy-v1");
        assert_eq!(saved["job"]["state"], "completed");
        let text = saved["revision"]["text"].as_str().unwrap().to_lowercase();
        println!("TRANSCRIPT: {text}");
        let measures = &saved["revision"]["measures"];
        println!("MEASURES: {measures}");
        assert!(measures["fillers"].as_array().unwrap().len() >= 5, "{measures}");
        assert_eq!(measures["source"], "Estimated");
        assert!(text.split_whitespace().count() > 50, "{text}");
        assert!(text.contains("uh") || text.contains("um"), "filler prompt should keep fillers: {text}");
        assert!(saved["revision"]["segments"].as_array().unwrap().iter().all(|s| s["timingSource"] == "Estimated"));
        assert!(root.0.join("cache/whisper").join(&run).is_dir());

        owner.move_to_trash("public", recording::now_ms()).unwrap();
        assert!(!owner.delete_permanently(&["public".into()]).unwrap());
        assert!(!root.0.join("cache/whisper").join(&run).exists());
        assert!(owner.attempt_transcript("public").unwrap()["revision"].is_null());
    }

    /// M3 exit gate: a worker that dies mid-run (killed from outside, like a
    /// crash) leaves the recording byte-identical, the job failed with a reason,
    /// and the next transcription works. Only this test's own whisper-cli.exe is
    /// stopped, matched by the temporary folder in its command line.
    /// `cargo test --lib worker_crash -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hardware_worker_crash_keeps_the_audio_and_the_next_run_works() {
        use crate::audio::whisper::WhisperWorker;
        use crate::storage::recording::{self, tests::TestRoot, CaptureManifest, ChunkWriter};
        let bench = Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench");
        let wav = std::fs::read(bench.join("samples/public-62s.wav")).unwrap();
        let root = TestRoot::new();
        for id in ["crash", "after"] {
            let manifest = CaptureManifest {
                version: 1, attempt_id: id.into(), idempotency_key: id.into(), title: id.into(),
                device_id: "fixture".into(), device_name: "Fixture".into(), sample_rate: 16_000, source_channels: 1,
                source_format: "i16".into(), created_at_ms: recording::now_ms(),
            };
            let mut writer = ChunkWriter::create(&root.0, &manifest).unwrap();
            for pair in wav[44..].chunks_exact(2) {
                writer.push(i16::from_le_bytes([pair[0], pair[1]])).unwrap();
            }
            writer.flush().unwrap();
            drop(writer);
            recording::finalize(&root.0, id, false).unwrap();
        }
        let owner = DatabaseOwner::open(&root.0).unwrap();
        import_config(&owner, &bench.join("runtime.local/config-selected.json")).unwrap();
        let config = load_config(&owner).unwrap();
        let before = recording::hash_file(&root.0.join("recordings/crash/audio.wav")).unwrap();

        // Kill the worker as soon as it reports progress.
        let marker = root.0.file_name().unwrap().to_string_lossy().into_owned();
        let killed = Arc::new(AtomicBool::new(false));
        let worker = WhisperWorker::new(root.0.clone());
        let run = run_id("crash", recording::now_ms());
        owner.start_job("job-crash", "crash", recording::now_ms()).unwrap();
        let flag = killed.clone();
        let result = worker.transcribe(&config, "crash", &run, &AtomicBool::new(false), |p| {
            let mid_run = p.phase == "running" && p.percent.is_some_and(|v| v > 0 && v < 95);
            if mid_run && !flag.swap(true, Ordering::SeqCst) {
                let script = format!("Get-CimInstance Win32_Process -Filter \"Name='whisper-cli.exe'\" | Where-Object {{ $_.CommandLine -like '*{marker}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}");
                let status = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).status().unwrap();
                assert!(status.success());
            }
        });
        assert!(killed.load(Ordering::SeqCst), "the worker reported progress before it was stopped");
        let error = result.expect_err("a killed worker must not produce a transcript");
        println!("CRASH: {error}");
        assert!(error.contains("preserved"), "{error}");
        owner.finish_job("job-crash", "failed", Some(&error), recording::now_ms()).unwrap();

        let view = owner.attempt_transcript("crash").unwrap();
        assert_eq!(view["job"]["state"], "failed");
        assert!(view["job"]["errorMessage"].as_str().unwrap().contains("preserved"));
        assert!(view["revision"].is_null(), "no partial transcript is saved");
        assert_eq!(recording::hash_file(&root.0.join("recordings/crash/audio.wav")).unwrap(), before, "audio byte-identical");
        owner.checked_recording("crash").unwrap();

        // The next run works, on the other take and on the same one.
        for id in ["after", "crash"] {
            let run = run_id(id, recording::now_ms());
            let job = format!("job-{id}-ok");
            owner.start_job(&job, id, recording::now_ms()).unwrap();
            let transcript = worker.transcribe(&config, id, &run, &AtomicBool::new(false), |_| {}).unwrap();
            owner.save_local_transcript(&job, id, &transcript, recording::now_ms()).unwrap();
            let view = owner.attempt_transcript(id).unwrap();
            assert_eq!(view["job"]["state"], "completed", "{id}");
            assert!(view["revision"]["text"].as_str().unwrap().split_whitespace().count() > 50, "{id}");
        }
    }

    /// M3 exit gate: timing survives resampling and VAD. The public sample is
    /// saved once at its own 16 kHz and once upsampled to 48 kHz (so the app's
    /// resampler runs); segment times, voice pauses and the final segment must
    /// agree between the two and fall inside the known clip boundaries.
    /// `cargo test --lib timing_survives -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hardware_timing_survives_resampling_including_gaps_and_the_final_segment() {
        use crate::audio::whisper::WhisperWorker;
        use crate::storage::recording::{self, tests::TestRoot, CaptureManifest, ChunkWriter};
        let bench = Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench");
        let wav = std::fs::read(bench.join("samples/public-62s.wav")).unwrap();
        let samples: Vec<i16> = wav[44..].chunks_exact(2).map(|p| i16::from_le_bytes([p[0], p[1]])).collect();
        let reference: serde_json::Value = serde_json::from_slice(&std::fs::read(bench.join("samples/public-62s-reference.json")).unwrap()).unwrap();
        let clips: Vec<(f64, f64)> = reference["clips"].as_array().unwrap().iter().map(|c| (c["startMs"].as_f64().unwrap(), c["endMs"].as_f64().unwrap())).collect();
        let duration = reference["durationMs"].as_f64().unwrap();

        let root = TestRoot::new();
        for (id, rate) in [("native", 16_000u32), ("upsampled", 48_000)] {
            let manifest = CaptureManifest {
                version: 1, attempt_id: id.into(), idempotency_key: id.into(), title: id.into(),
                device_id: "fixture".into(), device_name: "Fixture".into(), sample_rate: rate, source_channels: 1,
                source_format: "i16".into(), created_at_ms: recording::now_ms(),
            };
            let mut writer = ChunkWriter::create(&root.0, &manifest).unwrap();
            if rate == 16_000 {
                samples.iter().for_each(|s| writer.push(*s).unwrap());
            } else {
                // Linear interpolation ×3: same sound, so any timing shift comes from the pipeline.
                for (i, s) in samples.iter().enumerate() {
                    let next = f32::from(*samples.get(i + 1).unwrap_or(s));
                    for k in 0..3 {
                        let t = k as f32 / 3.0;
                        writer.push((f32::from(*s) * (1.0 - t) + next * t).round() as i16).unwrap();
                    }
                }
            }
            writer.flush().unwrap();
            drop(writer);
            recording::finalize(&root.0, id, false).unwrap();
        }
        let owner = DatabaseOwner::open(&root.0).unwrap();
        import_config(&owner, &bench.join("runtime.local/config-selected.json")).unwrap();
        let config = load_config(&owner).unwrap();
        let worker = WhisperWorker::new(root.0.clone());
        let mut views = Vec::new();
        for id in ["native", "upsampled"] {
            let run = run_id(id, recording::now_ms());
            owner.start_job(&format!("job-{id}"), id, recording::now_ms()).unwrap();
            let transcript = worker.transcribe(&config, id, &run, &AtomicBool::new(false), |_| {}).unwrap();
            owner.save_local_transcript(&format!("job-{id}"), id, &transcript, recording::now_ms()).unwrap();
            views.push(owner.attempt_transcript_with_voice(id).unwrap());
        }
        let starts = |v: &serde_json::Value| -> Vec<(f64, f64)> {
            v["revision"]["segments"].as_array().unwrap().iter()
                .filter_map(|s| Some((s["startMs"].as_f64()?, s["endMs"].as_f64()?))).collect()
        };
        for v in &views {
            let untimed = v["revision"]["segments"].as_array().unwrap().iter().filter(|s| s["startMs"].is_null()).count();
            assert_eq!(untimed, 0, "the padded final segment is clamped, not left untimed");
        }
        let (native, upsampled) = (starts(&views[0]), starts(&views[1]));
        println!("SEGMENTS native {} / upsampled {}", native.len(), upsampled.len());
        for segments in [&native, &upsampled] {
            assert!(segments.windows(2).all(|w| w[1].0 >= w[0].0), "segment starts are in order");
            assert!(segments.iter().all(|(a, b)| a <= b && *b <= duration + 50.0), "inside the take");
            // Every clip is covered by some segment (no region lost to VAD/resampling)…
            for (i, (a, b)) in clips.iter().enumerate() {
                assert!(segments.iter().any(|(s, e)| *s < *b && *e > *a), "clip {i} has no transcript segment");
            }
            // …and the final segment reaches into the final clip.
            let (_, last_end) = segments.last().unwrap();
            assert!(*last_end >= clips.last().unwrap().0, "final segment ends at {last_end} ms, before the last clip");
        }
        // Against ground truth: every clip start (where new speech begins) has a
        // segment starting within 250 ms of it, at 16 kHz and after resampling.
        // (Whisper may split long clips differently; that is not a timing shift.)
        for (name, segments) in [("native", &native), ("upsampled", &upsampled)] {
            for (i, (clip_start, _)) in clips.iter().enumerate() {
                let nearest = segments.iter().map(|(s, _)| (s - clip_start).abs()).fold(f64::MAX, f64::min);
                println!("CLIP {name} {i}: nearest segment start {nearest:.0} ms away");
                assert!(nearest <= 250.0, "{name}: clip {i} starts at {clip_start} ms but the nearest segment start is {nearest} ms away");
            }
        }
        // Gaps: voice pauses from each take's own waveform agree within 100 ms.
        let pauses = |v: &serde_json::Value| -> Vec<(f64, f64)> {
            v["revision"]["measures"]["voice"]["pauses"].as_array().unwrap().iter()
                .map(|p| (p["startMs"].as_f64().unwrap(), p["startMs"].as_f64().unwrap() + p["durationMs"].as_f64().unwrap())).collect()
        };
        let (pn, pu) = (pauses(&views[0]), pauses(&views[1]));
        println!("PAUSES native {pn:?}\nPAUSES upsampled {pu:?}");
        assert_eq!(pn.len(), pu.len(), "same pauses found");
        assert!(pn.iter().zip(&pu).all(|(a, b)| (a.0 - b.0).abs() <= 100.0 && (a.1 - b.1).abs() <= 100.0));
    }
}
