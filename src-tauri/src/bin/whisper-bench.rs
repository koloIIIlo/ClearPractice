//! Explicit, offline M0 harness. It does not touch the installed app's data.
use clearpractice_lib::{
    audio::whisper::{WhisperWorker, WorkerConfig},
    storage::recording::{self, CaptureManifest},
};
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        return Err(
            "Usage: whisper-bench CONFIG.json SAMPLE.wav NEW_OUTPUT_DIRECTORY verify|benchmark"
                .into(),
        );
    }
    let config: WorkerConfig = serde_json::from_slice(&fs::read(&args[0])?)?;
    let sample = fs::read(&args[1])?;
    let frames = pcm(&sample)?;
    let root = PathBuf::from(&args[2]);
    if root.exists() {
        return Err("The output directory must be new; previous runs are preserved.".into());
    }
    if !matches!(args[3].as_str(), "verify" | "benchmark") {
        return Err("Choose verify or benchmark.".into());
    }
    for name in ["cache", "recordings", "recovery"] {
        fs::create_dir_all(root.join(name))?;
    }
    let root = root.canonicalize()?;
    let manifest = CaptureManifest {
        version: 1,
        attempt_id: "benchmark".into(),
        idempotency_key: "benchmark".into(),
        title: "Explicit M0 benchmark input".into(),
        device_id: "fixture".into(),
        device_name: "Imported benchmark fixture".into(),
        sample_rate: 16000,
        source_channels: 1,
        source_format: "i16".into(),
        created_at_ms: recording::now_ms(),
    };
    let mut writer = recording::ChunkWriter::create(&root, &manifest)?;
    for sample in frames.chunks_exact(2) {
        writer.push(i16::from_le_bytes([sample[0], sample[1]]))?;
    }
    writer.flush()?;
    let saved = recording::finalize(&root, "benchmark", false)?;
    let worker = WhisperWorker::new(root.clone());
    let cancel = AtomicBool::new(false);
    let mut results = Vec::new();
    let runs = if args[3] == "benchmark" { 4 } else { 1 };
    for n in 0..runs {
        let run_id = format!("run-{n}");
        let job_started = std::time::Instant::now();
        let result = worker.transcribe(&config, "benchmark", &run_id, &cancel, |p| {
            if p.percent.is_none() {
                println!("{}: {}", p.run_id, p.phase);
            }
        });
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let failure = json!({"version":1,"runId":run_id,"backend":config.backend,"modelId":config.model_id,
                    "modelSha256":config.model_sha256,"sourceSha256":saved.sha256,"durationMs":saved.duration_ms,
                    "totalJobMs":job_started.elapsed().as_millis() as u64,"error":error,"completedTrials":results,
                    "originalPreserved":recording::playback_path(&root,"benchmark").is_ok(),
                    "peakVramBytes":null,"peakVramUnavailableReason":"Per-process VRAM unavailable in this harness"});
                fs::write(
                    root.join("failure.json"),
                    serde_json::to_vec_pretty(&failure)?,
                )?;
                return Err(error.into());
            }
        };
        if saved.sha256 != result.source_sha256 {
            return Err("Transcript source hash mismatch.".into());
        }
        if result.peak_ram_bytes.is_some_and(|b| b == 0) {
            return Err("Invalid peak RAM measurement.".into());
        }
        println!(
            "{}: {} ms, peak RAM {:?} bytes, {} segments",
            result.run_id,
            result.elapsed_ms,
            result.peak_ram_bytes,
            result.segments.len()
        );
        results.push(json!({"runId":result.run_id,"elapsedMs":result.elapsed_ms,"totalJobMs":job_started.elapsed().as_millis() as u64,"peakRamBytes":result.peak_ram_bytes,
            "peakRamUnavailableReason":result.peak_ram_unavailable_reason,"segmentCount":result.segments.len()}));
    }
    // Cancel a real process immediately after launch, not merely a queued flag.
    let cancellation = worker.transcribe(&config, "benchmark", "cancel-test", &cancel, |p| {
        if p.phase == "running" {
            cancel.store(true, Ordering::Relaxed);
        }
    });
    if !cancellation.is_err_and(|e| e.contains("canceled"))
        || root.join("cache/whisper/cancel-test/result.json").exists()
    {
        return Err("Worker cancellation failed.".into());
    }
    if recording::playback_path(&root, "benchmark").is_err() {
        return Err("Cancellation changed the original recording.".into());
    }
    cancel.store(false, Ordering::Relaxed);
    let mut corrupt = config.clone();
    corrupt.model_sha256 = "0".repeat(64);
    if worker
        .transcribe(&corrupt, "benchmark", "checksum-test", &cancel, |_| {})
        .is_ok()
    {
        return Err("An unverified model was accepted.".into());
    }
    let mut warm: Vec<u64> = results
        .iter()
        .skip(1)
        .filter_map(|r| r["elapsedMs"].as_u64())
        .collect();
    warm.sort_unstable();
    let report = json!({
        "version":1,"createdAtMs":recording::now_ms(),"purpose":"M0 feasibility; independent reference scoring is a separate public_sample.py step",
        "durationMs":saved.duration_ms,"sourceSha256":saved.sha256,"modelId":config.model_id,"modelSha256":config.model_sha256,
        "runtimeVersion":config.runtime_version,"backend":config.backend,"threads":config.threads,"prompt":config.prompt,
        "trials":results,"firstTrial":"First process of this invocation; OS/model cache state is not controlled",
        "warmMedianMs":warm.get(1),"warmMinMs":warm.first(),"warmMaxMs":warm.last(),
        "peakVramBytes":null,"peakVramUnavailableReason":"Per-process GPU memory measurement is not implemented in this harness",
        "fillerRecall":null,"fillerUnavailableReason":"A hand-marked verbatim reference is required",
        "cancellationVerified":true,"originalPreserved":true,"checksumRejectionVerified":true,
    });
    fs::write(
        root.join("benchmark.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("Verified cancellation, source preservation, and checksum rejection. Report saved.");
    Ok(())
}

fn pcm(wav: &[u8]) -> Result<&[u8], Box<dyn std::error::Error>> {
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("The sample must be a RIFF WAV.".into());
    }
    let mut offset: usize = 12;
    let mut format = false;
    let mut data = None;
    while offset + 8 <= wav.len() {
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into()?) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|e| *e <= wav.len())
            .ok_or("Truncated sample WAV.")?;
        if &wav[offset..offset + 4] == b"fmt " {
            let expected = [1, 0, 1, 0, 128, 62, 0, 0, 0, 125, 0, 0, 2, 0, 16, 0];
            if size < 16 || wav[start..start + 16] != expected {
                return Err("The harness sample must be 16 kHz mono 16-bit PCM.".into());
            }
            format = true;
        }
        if &wav[offset..offset + 4] == b"data" {
            data = Some(&wav[start..end]);
        }
        offset = end.checked_add(size % 2).ok_or("Invalid WAV chunk.")?;
    }
    let data = data.ok_or("The sample has no PCM data.")?;
    if !format || data.is_empty() || data.len() % 2 != 0 || data.len() > 16_000 * 2 * 3600 {
        return Err("Invalid or oversized benchmark audio.".into());
    }
    Ok(data)
}
