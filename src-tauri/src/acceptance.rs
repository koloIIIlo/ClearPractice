//! Release acceptance checks (DEVELOPMENT_PLAN.md "Acceptance suite", §17).
//! Each test is named after its A-item and runs the real storage, audio and
//! API-controller code on a disposable profile. Nothing here reaches a real
//! provider: hosted requests stop before a key is read, and the only servers
//! are local ones on 127.0.0.1 standing in for a local model. Items that need
//! hardware or a person (A-1, A-2, A-4, A-10, A-20) have manual recipes in the
//! plan instead.
use crate::api::audio::{self, AudioPreviewOwner, AudioProvider, Parsed};
use crate::api::budget::{BudgetOwner, PriceQuote, Purpose};
use crate::api::coaching::{CoachingModel, PreviewOwner};
use crate::api::local_llm::LocalTarget;
use crate::audio::whisper::{Backend, Segment, Transcript};
use crate::backup;
use crate::storage::database::{coaching_runs::NewRun, DatabaseOwner};
use crate::storage::recording::{self, tests::{manifest, TestRoot}, ChunkWriter, SavedRecording};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Duration,
};

// ── Shared fixtures ─────────────────────────────────────────────────────────

/// A saved mono take at `rate`, one sample per call of `sample`.
fn take_with(root: &Path, id: &str, rate: u32, samples: usize, sample: impl Fn(usize) -> i16) -> SavedRecording {
    let mut m = manifest(id);
    m.sample_rate = rate;
    let mut writer = ChunkWriter::create(root, &m).unwrap();
    for i in 0..samples {
        writer.push(sample(i)).unwrap();
    }
    writer.flush().unwrap();
    drop(writer);
    recording::finalize(root, id, false).unwrap()
}

/// A voiced sound: a harmonic tone at `f0` Hz.
fn voice(i: usize, rate: u32, f0: f64) -> i16 {
    let phase = std::f64::consts::TAU * f0 * i as f64 / f64::from(rate);
    ((1..=5).map(|h| (phase * h as f64).sin() / h as f64).sum::<f64>() * 6_000.0) as i16
}

/// Two seconds of a 150 Hz voice at 48 kHz.
fn take(root: &Path, id: &str) -> SavedRecording {
    take_with(root, id, 48_000, 96_000, |i| voice(i, 48_000, 150.0))
}

/// Saves a local Whisper transcript with these timed parts, like a finished job.
fn local_transcript(db: &DatabaseOwner, attempt: &str, run: &str, parts: &[(&str, Option<u64>, Option<u64>)], now_ms: u64) {
    let segments: Vec<Segment> = parts
        .iter()
        .map(|(text, start, end)| Segment {
            text: (*text).into(),
            start_ms: *start,
            end_ms: *end,
            timing_source: "Estimated".into(),
            timing_unavailable_reason: start.is_none().then(|| "Worker timing exceeds the recording duration.".into()),
        })
        .collect();
    let transcript = Transcript {
        version: 1, run_id: run.into(), asset_id: attempt.into(), provider: "local-whisper".into(), model_id: "base".into(),
        model_sha256: "a".repeat(64), runtime_version: "1.9.1".into(), backend: Backend::Cpu, threads: 4, prompt: None,
        source_sha256: "b".repeat(64), prepared_sha256: "c".repeat(64), language: "en".into(),
        raw_text: parts.iter().map(|p| p.0).collect(), segments, elapsed_ms: 10, peak_ram_bytes: None,
        peak_ram_unavailable_reason: Some("not measured in tests".into()), created_at_ms: now_ms,
    };
    let job = format!("job-{run}");
    db.start_job(&job, attempt, now_ms).unwrap();
    db.save_local_transcript(&job, attempt, &transcript, now_ms).unwrap();
}

fn read_only(root: &Path) -> Connection {
    Connection::open_with_flags(root.join("database/app.sqlite"), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

fn cell(value: rusqlite::types::ValueRef) -> String {
    use rusqlite::types::ValueRef;
    match value {
        ValueRef::Null => "NULL".into(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => format!("{f:?}"),
        ValueRef::Text(t) => format!("'{}'", String::from_utf8_lossy(t)),
        ValueRef::Blob(b) => format!("blob:{}", sha256_bytes(b)),
    }
}

/// Every row of a query, rendered and sorted, for exact comparisons.
fn query_rows(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    let columns = stmt.column_count();
    let mut out: Vec<String> = stmt
        .query_map([], |r| Ok((0..columns).map(|i| cell(r.get_ref(i).unwrap())).collect::<Vec<_>>().join(" | ")))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    out.sort();
    out
}

fn rows(conn: &Connection, table: &str) -> Vec<String> {
    query_rows(conn, &format!("SELECT * FROM \"{table}\""))
}

/// Every table of a database except the backup history, which a restore cannot contain.
fn dump(conn: &Connection) -> BTreeMap<String, Vec<String>> {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    tables.into_iter().filter(|t| t != "backup_records").map(|t| { let r = rows(conn, &t); (t, r) }).collect()
}

/// SHA-256 of every file under `dir`, by path relative to it.
fn hashes(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for file in files(dir) {
        out.insert(file.strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/"), recording::hash_file(&file).unwrap());
    }
    out
}

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(files(&path));
            } else {
                out.push(path);
            }
        }
    }
    out
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))
}

/// Rebuilds a backup archive entry by entry (stored, uncompressed), letting a
/// test damage it. `edit` sees every entry after the manifest change; `None` drops it.
fn rewrite(source: &Path, target: &Path, edit: impl Fn(&str, Vec<u8>) -> Option<Vec<u8>>, change: impl Fn(&mut backup::Manifest)) {
    let mut input = zip::ZipArchive::new(fs::File::open(source).unwrap()).unwrap();
    let mut output = zip::ZipWriter::new(fs::File::create(target).unwrap());
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for index in 0..input.len() {
        let mut file = input.by_index(index).unwrap();
        let name = file.name().to_string();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        drop(file);
        if name == "manifest.json" {
            let mut m: backup::Manifest = serde_json::from_slice(&bytes).unwrap();
            change(&mut m);
            bytes = serde_json::to_vec(&m).unwrap();
        }
        let Some(bytes) = edit(&name, bytes) else { continue };
        output.start_file(name, stored).unwrap();
        output.write_all(&bytes).unwrap();
    }
    output.finish().unwrap();
}

fn quote(cost: u64) -> PriceQuote {
    PriceQuote { currency: "USD".into(), source: "https://deepgram.com/pricing".into(), effective_date: "2026-10-08".into(),
        model: "test-model".into(), billing_unit: "test unit".into(), rate_micro_usd: 1, maximum_cost_micro_usd: cost }
}

fn sha(seed: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(seed.as_bytes()))
}

/// A local stand-in for a llama.cpp server on 127.0.0.1: answers every request
/// with `content` as the model's message and keeps each raw request it received.
fn local_model(content: Value) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let body = json!({"choices":[{"finish_reason":"stop","message":{"content":content.to_string()}}],"usage":{"prompt_tokens":50,"completion_tokens":20}}).to_string();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { return };
            s.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 16 * 1024];
            loop {
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
                if let Some(end) = got.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&got[..end]).to_lowercase();
                    let length = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
                    if got.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            log.lock().unwrap().push(String::from_utf8_lossy(&got).into_owned());
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        }
    });
    (base, seen)
}

fn feedback_answer() -> Value {
    json!({"summary":"The point is clear.","oneImprovement":"Lead with the answer.","nextAttempt":"Say the point first.","corrections":[],"deliveryNotes":[]})
}

/// The app's Rust sources without their test modules, by path under `src/`.
fn production_sources() -> Vec<(String, String)> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    files(&src)
        .into_iter()
        .filter(|f| f.extension().is_some_and(|e| e == "rs"))
        .map(|f| (f.strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/"), fs::read_to_string(&f).unwrap()))
        .filter(|(name, _)| !name.starts_with("bin/") && name != "acceptance.rs" && !name.ends_with("/tests.rs"))
        .map(|(name, text)| {
            let code = text.lines().take_while(|l| *l != "#[cfg(test)]" && !l.trim_start().starts_with("mod tests")).collect::<Vec<_>>().join("\n");
            (name, code)
        })
        .collect()
}

/// A stand-in Whisper worker that fails at once: Windows' whoami rejects
/// Whisper's arguments and exits with an error, as a crashed worker would.
#[cfg(windows)]
fn failing_worker(root: &Path) -> crate::audio::whisper::WorkerConfig {
    use crate::audio::whisper::{RuntimeFile, WorkerConfig};
    let dir = root.join("fake-worker");
    fs::create_dir_all(&dir).unwrap();
    let exe = dir.join("whisper-cli.exe");
    fs::copy(Path::new(&std::env::var("SystemRoot").unwrap()).join("System32").join("whoami.exe"), &exe).unwrap();
    let model = dir.join("model.bin");
    fs::write(&model, b"not a real model").unwrap();
    WorkerConfig {
        version: 1, runtime_version: "1.9.1".into(), executable: exe.clone(),
        runtime_files: vec![RuntimeFile { name: "whisper-cli.exe".into(), bytes: fs::metadata(&exe).unwrap().len(), sha256: recording::hash_file(&exe).unwrap() }],
        model: model.clone(), model_id: "base".into(), model_sha256: recording::hash_file(&model).unwrap(), backend: Backend::Cpu, threads: 1, prompt: None,
    }
}

// ── A-3 Worker crash ────────────────────────────────────────────────────────

/// A-3: a worker that dies leaves the take's audio and notes as they were, the
/// job is marked failed, and the next recording and the next run still work.
#[cfg(windows)]
#[test]
fn a03_a_crashed_worker_keeps_audio_and_notes_and_the_next_recording_works() {
    use crate::audio::whisper::WhisperWorker;
    let root = TestRoot::new();
    let first = take(&root.0, "take-1");
    let db = DatabaseOwner::open(&root.0).unwrap();
    db.update_session("take-1", "Before the crash", "My note stays", &[], false).unwrap();
    let config = failing_worker(&root.0);
    let worker = WhisperWorker::new(root.0.clone());
    db.start_job("job-crash", "take-1", recording::now_ms()).unwrap();
    let error = worker.transcribe(&config, "take-1", "take-1--crash", &AtomicBool::new(false), |_| {}).unwrap_err();
    assert!(error.contains("could not finish") && error.contains("recording is preserved"), "{error}");
    db.finish_job("job-crash", "failed", Some(&error), recording::now_ms()).unwrap();

    assert_eq!(db.checked_recording("take-1").unwrap().sha256, first.sha256, "audio verified and unchanged");
    assert_eq!(recording::hash_file(&db.playback_path("take-1").unwrap()).unwrap(), first.sha256);
    let session = db.get_session("take-1").unwrap();
    assert_eq!((session["title"].as_str(), session["notes"].as_str()), (Some("Before the crash"), Some("My note stays")));
    let view = db.attempt_transcript("take-1").unwrap();
    assert!(view["revision"].is_null(), "no half transcript");
    assert_eq!(view["job"]["state"], "failed");
    assert!(!root.0.join("cache/whisper/take-1--crash/raw.json").exists());

    // The worker is free again (not stuck "already running") and the next take saves.
    let again = worker.transcribe(&config, "take-1", "take-1--retry", &AtomicBool::new(false), |_| {}).unwrap_err();
    assert!(again.contains("could not finish"), "{again}");
    let next = take(&root.0, "take-2");
    db.commit_recording(&next).unwrap();
    assert_eq!(db.checked_recording("take-2").unwrap().sha256, next.sha256);
    assert_eq!(db.list_sessions(None, None, false).unwrap().len(), 2);
}

// ── A-5 Transcript edits ────────────────────────────────────────────────────

/// A-5: a correction is a child revision with its own measures. The raw text,
/// its timed segments, its stored metrics and its filler decisions stay exactly
/// as they were, also after a second correction and a restart.
#[test]
fn a05_a_transcript_edit_keeps_the_raw_text_and_old_metrics_on_the_original_revision() {
    let root = TestRoot::new();
    take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    local_transcript(&db, "take", "take--1", &[(" So, uh, indexes help.", Some(0), Some(900)), (" They make reads fast.", Some(1_700), Some(2_000))], 2);
    db.set_filler_decision("take--1", 0, "uh", Some("confirmed"), 3).unwrap();
    let raw = |conn: &Connection| -> Vec<String> {
        let mut out = Vec::new();
        for (table, column) in [("transcript_revisions", "id"), ("transcript_segments", "revision_id"), ("annotations", "revision_id"), ("analysis_runs", "revision_id")] {
            out.extend(query_rows(conn, &format!("SELECT '{table}',* FROM {table} WHERE {column}='take--1'")));
        }
        out.extend(query_rows(conn, "SELECT metric,value,unit,source,unavailable_reason FROM metric_values WHERE run_id='take--1--measures-v1'"));
        out
    };
    let before = raw(&read_only(&root.0));
    assert!(before.iter().any(|r| r.starts_with("'filler_candidates' | 1.0")), "{before:?}");
    assert!(before.iter().any(|r| r.starts_with("'pauses_over_threshold' | 1.0")), "{before:?}");
    assert!(before.iter().any(|r| r.starts_with("'transcript_segments'")) && before.iter().any(|r| r.contains("'confirmed'")), "{before:?}");

    let first = db.save_transcript_correction("take", "take--1", "So indexes help. They make reads faster.", 4).unwrap();
    let second = db.save_transcript_correction("take", "take--1", "Indexes help: they make reads faster.", 5).unwrap();
    assert_eq!(raw(&read_only(&root.0)), before, "the raw revision and its metrics are untouched");

    let conn = read_only(&root.0);
    let revision = |id: &str| conn.query_row("SELECT source,parent_id,text FROM transcript_revisions WHERE id=?1", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?))).unwrap();
    assert_eq!(revision(&first), ("user".into(), Some("take--1".into()), "So indexes help. They make reads faster.".into()), "the first correction is kept");
    assert_eq!(revision(&second).1.as_deref(), Some("take--1"), "corrections hang off the raw revision");
    let metric = |run: &str, name: &str| conn.query_row("SELECT value,unavailable_reason FROM metric_values WHERE run_id=?1 AND metric=?2", [run, name], |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<String>>(1)?))).unwrap();
    assert_eq!(metric(&format!("{first}--measures-v1"), "filler_candidates"), (Some(0.0), None), "each revision has its own metrics");
    let (span, why) = metric(&format!("{first}--measures-v1"), "speech_span_ms");
    assert!(span.is_none() && why.is_some(), "a correction has no timings: a reason, never 0");

    let view = db.attempt_transcript("take").unwrap();
    assert_eq!(view["revision"]["id"], "take--1");
    assert_eq!(view["revision"]["text"], "So, uh, indexes help. They make reads fast.");
    assert_eq!(view["revision"]["measures"]["fillers"][0]["decision"], "confirmed");
    assert_eq!(view["revision"]["measures"]["pauses"].as_array().unwrap().len(), 1);
    assert_eq!(view["correction"]["id"], second.as_str());

    drop(conn);
    drop(db);
    let db = DatabaseOwner::open(&root.0).unwrap();
    assert_eq!(raw(&read_only(&root.0)), before, "still untouched after a restart");
    assert_eq!(db.attempt_transcript("take").unwrap()["correction"]["text"], "Indexes help: they make reads faster.");
}

// ── A-6 Timing after resampling and voice activity ──────────────────────────

/// A-6: a 48 kHz take with speech at 0–1.0 s, 1.8–2.6 s and 3.4–4.0 s (the last
/// part runs to the very end). After resampling to 16 kHz every part starts and
/// ends where it did; the waveform's pauses, a worker's segments (with the
/// usual small overrun of the final one) and the stored measures all sit on the
/// original timeline, and the final segment keeps its timing.
#[test]
fn a06_timing_survives_resampling_and_voice_activity_including_gaps_and_the_final_segment() {
    let root = TestRoot::new();
    let speaking = |ms: u64| ms < 1_000 || (1_800..2_600).contains(&ms) || ms >= 3_400;
    let saved = take_with(&root.0, "timing", 48_000, 192_000, |i| if speaking(i as u64 * 1_000 / 48_000) { voice(i, 48_000, 150.0) } else { 0 });
    assert_eq!(saved.duration_ms, 4_000);

    // Resampling keeps every boundary, including the final sample.
    let prepared = crate::audio::prepare::prepare(&root.0, "timing", &AtomicBool::new(false)).unwrap();
    assert_eq!((prepared.sample_rate, prepared.frames, prepared.duration_ms, prepared.source_frames), (16_000, 64_000, 4_000, 192_000));
    let wav = fs::read(crate::audio::prepare::prepared_path(&root.0, &prepared).unwrap()).unwrap();
    let data = wav.windows(4).position(|w| w == b"data").unwrap() + 8;
    let samples: Vec<i16> = wav[data..].chunks_exact(2).map(|p| i16::from_le_bytes([p[0], p[1]])).collect();
    assert_eq!(samples.len(), 64_000);
    let mut parts: Vec<(u64, u64)> = Vec::new();
    for (i, s) in samples.iter().enumerate() {
        if s.unsigned_abs() < 2_000 {
            continue;
        }
        let ms = i as u64 * 1_000 / 16_000;
        match parts.last_mut() {
            Some(last) if ms <= last.1 + 100 => last.1 = ms,
            _ => parts.push((ms, ms)),
        }
    }
    let expected = [(0, 1_000), (1_800, 2_600), (3_400, 4_000)];
    assert_eq!(parts.len(), 3, "{parts:?}");
    for ((start, end), (want_start, want_end)) in parts.iter().zip(expected) {
        assert!(start.abs_diff(want_start) <= 10 && end.abs_diff(want_end) <= 10, "{parts:?}");
    }

    // Pauses found in the original take's waveform.
    let db = DatabaseOwner::open(&root.0).unwrap();
    let peaks = db.waveform("timing").unwrap();
    let voice_activity = crate::analysis::voice_activity(&peaks.peaks, peaks.samples_per_peak, peaks.sample_rate);
    assert!(voice_activity.speech_start_ms.unwrap() <= 20 && voice_activity.speech_end_ms.unwrap() >= 3_980, "{voice_activity:?}");
    let pauses: Vec<(u64, u64)> = voice_activity.pauses.iter().map(|p| (p.start_ms, p.duration_ms)).collect();
    assert_eq!(pauses.len(), 2, "{pauses:?}");
    for ((start, length), want) in pauses.iter().zip([1_000, 2_600]) {
        assert!(start.abs_diff(want) <= 20 && length.abs_diff(800) <= 40, "{pauses:?}");
    }

    // A worker's segments (times from the 16 kHz copy) map onto the take; the
    // final one ends 300 ms past the audio and is clamped, not left untimed.
    let raw = br#"{"result":{"language":"en"},"transcription":[
        {"text":" Hello there.","offsets":{"from":0,"to":1000}},
        {"text":" Second idea.","offsets":{"from":1800,"to":2600}},
        {"text":" Last part.","offsets":{"from":3400,"to":4300}}]}"#;
    let (_, segments) = crate::audio::whisper::segments(raw, prepared.duration_ms).unwrap();
    assert_eq!((segments[2].start_ms, segments[2].end_ms, segments[2].timing_unavailable_reason.as_deref()), (Some(3_400), Some(4_000), None));
    let parts: Vec<(&str, Option<u64>, Option<u64>)> = segments.iter().map(|s| (s.text.as_str(), s.start_ms, s.end_ms)).collect();
    local_transcript(&db, "timing", "timing--1", &parts, 5);
    let view = db.attempt_transcript_with_voice("timing").unwrap();
    let measures = &view["revision"]["measures"];
    assert_eq!(measures["speechSpanMs"], 4_000);
    let stored: Vec<(u64, u64)> = measures["pauses"].as_array().unwrap().iter().map(|p| (p["startMs"].as_u64().unwrap(), p["durationMs"].as_u64().unwrap())).collect();
    assert_eq!(stored, [(1_000, 800), (2_600, 800)], "pauses between segments on the original timeline");
    let measured: Vec<u64> = measures["voice"]["pauses"].as_array().unwrap().iter().map(|p| p["startMs"].as_u64().unwrap()).collect();
    assert!(measured.iter().zip([1_000u64, 2_600]).all(|(a, b)| a.abs_diff(b) <= 20), "waveform pauses agree: {measured:?}");
    assert_eq!(view["revision"]["segments"][2]["endMs"], 4_000, "the final segment keeps its timing");
}

// ── A-7 Backup → restore into an empty profile ──────────────────────────────

/// A-7: a profile with every kind of record (takes, Trash, transcripts,
/// corrections, filler decisions, a cloud transcript, AI feedback, phrases,
/// prompts, favourites, reflections, stage choices, preferences) is backed up
/// and restored into an empty profile; every table and every file checksum match.
#[test]
fn a07_backup_restores_every_record_and_checksum_into_an_empty_profile() {
    let source = TestRoot::new();
    let a = take(&source.0, "take-a");
    take(&source.0, "take-b");
    let db = DatabaseOwner::open(&source.0).unwrap();
    db.update_session("take-a", "Explaining indexes", "My note", &["work".into()], true).unwrap();
    db.move_to_trash("take-b", recording::now_ms()).unwrap();
    local_transcript(&db, "take-a", "take-a--1", &[(" So, uh, indexes help.", Some(0), Some(1_500))], 2);
    db.set_filler_decision("take-a--1", 0, "uh", Some("dismissed"), 3).unwrap();
    let correction = db.save_transcript_correction("take-a", "take-a--1", "So indexes help.", 4).unwrap();
    let preview = AudioPreviewOwner::default().preview(&source.0, &a, AudioProvider::Assemblyai).unwrap();
    let cloud = audio::to_result(&preview, &a.sha256, Parsed { text: "So, uh, indexes help.".into(), words: vec![("So,".into(), 0, 200), ("uh,".into(), 250, 400), ("indexes".into(), 500, 900), ("help.".into(), 900, 1_300)], duration_ms: Some(2_000) }, Some("aai-1".into()), 3_500).unwrap();
    db.save_api_transcript(&cloud, &json!({"status":"completed","id":"aai-1"}), 5).unwrap();
    let feedback = feedback_answer();
    db.insert_coaching_run(&NewRun { id: "coach-1", attempt_id: "take-a", revision_id: &correction, provider: "OpenAI", model: "gpt-6-luna",
        payload_sha256: &sha("coach-1"), sent_text: "Task: x", transcript_text: "So indexes help.", delivery_impressions: false, provider_request_id: Some("req_1"),
        raw_response: "{\"status\":\"completed\"}", feedback: &feedback, input_tokens: Some(10), output_tokens: Some(5), estimated_cost_micro_usd: Some(8) }).unwrap();
    let phrase = db.add_phrase(&crate::storage::database::phrases::PhraseText { original: "more better", expression: "better", explanation: "One comparison word is enough.", examples: &["It's better to ask.".to_string()] }, Some("take-a"), crate::storage::database::phrases::today()).unwrap();
    db.review_phrase(&phrase.id, "good", crate::storage::database::phrases::today()).unwrap();
    db.add_user_prompt(&crate::storage::database::prompts::PromptInput { text: "Explain a trade-off you made.".into(), tags: vec!["work".into()],
        conditions: crate::storage::database::prompts::Conditions { familiarity: "unfamiliar".into(), preparation_seconds: 15, target_seconds: 90, audience: None, follow_up: false } }).unwrap();
    db.set_prompt_favorite("p-habit", true).unwrap();
    db.add_transfer_review(&crate::storage::database::transfer::TransferInput { local_date: "2026-10-12".into(), situation: "Explained a decision".into(), preparation: String::new(),
        listener_text: "You want to wait.".into(), clarification: String::new(), success: "The example".into(), self_report: "The reason came late.".into(), next_focus: "Lead with it".into() }).unwrap();
    db.record_progression("advance", "3 unfamiliar sessions on 2 days").unwrap();
    let mut prefs = crate::preferences::load(&db).unwrap();
    prefs.goals = vec!["clarity".into()];
    crate::preferences::save(&db, prefs).unwrap();

    let out = TestRoot::new();
    let folder = out.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let archive = folder.join(backup::create(&db, &folder, recording::now_ms()).unwrap().file_name);
    let expected = dump(&read_only(&source.0));
    assert!(expected["transcript_revisions"].len() == 3 && expected["coaching_runs"].len() == 1 && expected["api_runs"].len() == 1, "the profile is populated");

    let empty = TestRoot::new();
    drop(DatabaseOwner::open(&empty.0).unwrap()); // a fresh, empty profile
    let preview = backup::inspect(&empty.0, &archive, "stage-a07").unwrap();
    assert_eq!((preview.sessions, preview.trashed_sessions, preview.recordings), (1, 1, 2));
    backup::replace_profile(&empty.0, "stage-a07", recording::now_ms()).unwrap();
    let restored = DatabaseOwner::open(&empty.0).unwrap();
    backup::finish_restore(&empty.0).unwrap();

    let actual = dump(&read_only(&empty.0));
    assert_eq!(actual.keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>(), "same tables");
    for (table, rows) in &expected {
        assert_eq!(&actual[table], rows, "table {table} differs after restore");
    }
    assert_eq!(hashes(&empty.0.join("recordings")), hashes(&source.0.join("recordings")), "every recording and receipt matches");
    assert_eq!(restored.checked_recording("take-a").unwrap().sha256, a.sha256);
    assert_eq!(restored.attempt_transcript("take-a").unwrap(), db.attempt_transcript("take-a").unwrap());
}

// ── A-8 Damaged archives ────────────────────────────────────────────────────

/// A-8 (besides restore_rejects_traversal_newer_schema_bad_checksums_missing_audio_and_non_zips):
/// a truncated archive, a missing manifest, a database that is not one even with
/// a matching checksum, a missing receipt and an older-format manifest are all
/// refused; the live profile is unchanged and no staging folder is left behind.
#[test]
fn a08_truncated_or_damaged_archives_are_refused_and_the_profile_is_untouched() {
    let root = TestRoot::new();
    take(&root.0, "take-a");
    let db = DatabaseOwner::open(&root.0).unwrap();
    db.update_session("take-a", "Kept", "My note", &[], false).unwrap();
    let out = TestRoot::new();
    let folder = out.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let good = folder.join(backup::create(&db, &folder, recording::now_ms()).unwrap().file_name);
    let before = (dump(&read_only(&root.0)), hashes(&root.0.join("recordings")));
    let bad = folder.join("bad.zip");
    let refuse = |stage: &str, expect: &[&str]| {
        let error = backup::inspect(&root.0, &bad, stage).unwrap_err();
        assert!(expect.iter().any(|e| error.contains(e)), "{stage}: {error}");
        assert!(fs::read_dir(root.0.join("cache/restore")).map_or(true, |mut d| d.next().is_none()), "{stage} left staging behind");
    };

    let bytes = fs::read(&good).unwrap();
    fs::write(&bad, &bytes[..bytes.len() / 2]).unwrap();
    refuse("truncated", &["not a readable", "damaged", "missing"]);

    rewrite(&good, &bad, |name, b| (name != "manifest.json").then_some(b), |_| {});
    refuse("no-manifest", &["manifest missing"]);

    let garbage = b"this is not a database ".repeat(400);
    let garbage_sha = sha256_bytes(&garbage);
    rewrite(&good, &bad, |name, b| Some(if name == "database/app.sqlite" { garbage.clone() } else { b }), |m| {
        let entry = m.entries.iter_mut().find(|e| e.path == "database/app.sqlite").unwrap();
        entry.bytes = garbage.len() as u64;
        entry.sha256 = garbage_sha.clone();
    });
    refuse("not-a-database", &["damaged", "cannot be opened"]);

    rewrite(&good, &bad, |name, b| (!name.ends_with("saved.json")).then_some(b), |m| m.entries.retain(|e| !e.path.ends_with("saved.json")));
    refuse("no-receipt", &["take-a"]);

    rewrite(&good, &bad, |_, b| Some(b), |m| m.format_version = 99);
    refuse("other-format", &["not supported"]);

    assert_eq!((dump(&read_only(&root.0)), hashes(&root.0.join("recordings"))), before, "nothing changed");
    assert_eq!(db.get_session("take-a").unwrap()["title"], "Kept");
}

fn sha256_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

// ── A-9 Upgrading a populated older schema ──────────────────────────────────

/// Turns a current (v16) profile back into a populated v14 one.
fn downgrade_to_v14(root: &Path) {
    let conn = Connection::open(root.join("database/app.sqlite")).unwrap();
    conn.execute_batch("DROP INDEX practice_events_date; DROP TABLE practice_events; ALTER TABLE sessions DROP COLUMN activity_snapshot; DELETE FROM app_settings WHERE key='engagement_backfill_v1'; DROP TABLE progression_events; DROP TABLE transfer_reviews; DROP TABLE prompt_favorites; DROP TABLE user_prompts; ALTER TABLE sessions DROP COLUMN preferred_take; DROP INDEX coaching_runs_payload; DROP INDEX coaching_runs_attempt; DROP TABLE coaching_runs; PRAGMA user_version=14;").unwrap();
}

/// A-9 (besides populated_v1_database_upgrades_to_v2_with_a_snapshot and
/// failed_upgrade_keeps_a_verified_snapshot_and_rolls_back): a populated v14
/// profile (sessions, notes, transcripts, a correction, phrases) upgrades with a
/// verified snapshot first. When the upgrade fails part-way, the whole step rolls
/// back, the data and version stay as they were, and the next start recovers.
#[test]
fn a09_a_populated_older_profile_upgrades_and_a_failed_upgrade_recovers() {
    for fail_first in [false, true] {
        let root = TestRoot::new();
        take(&root.0, "old-take");
        {
            let db = DatabaseOwner::open(&root.0).unwrap();
            db.update_session("old-take", "Kept title", "Kept note", &[], false).unwrap();
            local_transcript(&db, "old-take", "old-take--1", &[(" Indexes, uh, help.", Some(0), Some(1_500))], 2);
            db.save_transcript_correction("old-take", "old-take--1", "Indexes help.", 3).unwrap();
            db.add_phrase(&crate::storage::database::phrases::PhraseText { original: "more better", expression: "better", explanation: "One comparison word.", examples: &[] }, None, crate::storage::database::phrases::today()).unwrap();
        }
        downgrade_to_v14(&root.0);
        // The v14 columns of every table that holds the user's data (v15 adds a column to sessions).
        let kept = |conn: &Connection| {
            let mut out: BTreeMap<String, Vec<String>> = ["attempts", "audio_assets", "transcript_revisions", "transcript_segments", "phrase_cards", "metric_values", "analysis_runs"]
                .iter().map(|t| (t.to_string(), rows(conn, t))).collect();
            out.insert("sessions".into(), query_rows(conn, "SELECT id,title,notes,tags,favorite,deleted_at_ms FROM sessions"));
            out
        };
        let before = kept(&read_only(&root.0));
        if fail_first {
            // Something in the way of the v15 step: it fails inside its transaction.
            Connection::open(root.0.join("database/app.sqlite")).unwrap().execute_batch("CREATE TABLE user_prompts (in_the_way TEXT);").unwrap();
            assert!(DatabaseOwner::open(&root.0).is_err());
            let conn = read_only(&root.0);
            assert_eq!(conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 14, "still the old version");
            let created: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name='coaching_runs'", [], |r| r.get(0)).unwrap();
            assert_eq!(created, 0, "the failed step left nothing half-made");
            let added: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='preferred_take'", [], |r| r.get(0)).unwrap();
            assert_eq!(added, 0, "its column change was rolled back too");
            assert_eq!(kept(&conn), before, "every row as it was");
            drop(conn);
            Connection::open(root.0.join("database/app.sqlite")).unwrap().execute_batch("DROP TABLE user_prompts;").unwrap();
            std::thread::sleep(Duration::from_millis(5)); // the next snapshot gets its own name
        }
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(db.get_session("old-take").unwrap()["notes"], "Kept note");
        assert_eq!(db.attempt_transcript("old-take").unwrap()["correction"]["text"], "Indexes help.");
        assert!(db.list_coaching_runs("old-take").unwrap().is_empty(), "new tables exist and start empty");
        assert_eq!(kept(&read_only(&root.0)), before, "no row lost or changed by the upgrade");
        let snapshots: Vec<PathBuf> = files(&root.0.join("database/snapshots")).into_iter().filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("before-v16-")).collect();
        assert_eq!(snapshots.len(), if fail_first { 2 } else { 1 }, "a snapshot before every upgrade attempt");
        for snapshot in snapshots {
            let copy = Connection::open_with_flags(&snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            assert_eq!(copy.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
            assert_eq!(copy.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 14);
            assert_eq!(copy.query_row("SELECT notes FROM sessions WHERE id='old-take'", [], |r| r.get::<_, String>(0)).unwrap(), "Kept note");
        }
    }
}

// ── A-11 Network inspection: local paths never build an HTTP client ────────

/// A-11, static half: every HTTP client the app builds is counted, and the
/// recording, storage, local transcription and prosody modules never name an
/// HTTP client, a socket or an API sender.
#[test]
fn a11_every_http_client_is_counted_and_local_modules_name_no_network_code() {
    let sources = production_sources();
    for (name, code) in &sources {
        assert_eq!(code.matches("Client::builder()").count(), code.matches("net_guard::client_built()").count(), "{name}: an HTTP client is built without being counted");
    }
    let local = ["audio/capture.rs", "audio/monitor.rs", "audio/peaks.rs", "audio/prepare.rs", "audio/transcription.rs", "audio/whisper.rs",
        "storage/recording.rs", "storage/database.rs", "storage/coaching_runs.rs", "storage/library.rs", "storage/phrases.rs", "storage/prompts.rs",
        "storage/transfer.rs", "storage/progression.rs", "storage/counts.rs", "transcribe.rs", "prosody.rs", "analysis.rs", "mic_test.rs",
        "backup/mod.rs", "backup/export.rs", "clips.rs", "models.rs", "storage_usage.rs", "diagnostics.rs", "app_paths.rs", "data_location.rs",
        "storage/engagement.rs", "engagement.rs", "activity.rs", "exercise_types.rs", "commands/engagement.rs"];
    let banned = ["reqwest", "Client::", "TcpStream", "UdpSocket", "std::net", "ApiTransport", "local_llm::chat", "send_reserved", "download_tool", "whisper_setup::", "linkaudio::"];
    for file in local {
        let (_, code) = sources.iter().find(|(n, _)| n == file).unwrap_or_else(|| panic!("{file} not found"));
        for word in banned {
            assert!(!code.contains(word), "{file} mentions {word}");
        }
    }
    // Hosted requests start only from explicit request_* commands, which the interface calls on Send.
    let lib = &sources.iter().find(|(n, _)| n == "lib.rs").unwrap().1;
    let mut current = "";
    for line in lib.lines() {
        if let Some(rest) = line.strip_prefix("async fn ").or_else(|| line.strip_prefix("fn ")) {
            current = rest.split('(').next().unwrap();
        }
        let sends = [".send(budget", ".send_take(", ".send_follow_up(", ".send_clip_names(", ".send_clip_picks(", ".send_phrase_suggestions(", ".send_take_local(", ".send_follow_up_local("];
        if sends.iter().any(|s| line.contains(s)) || line.trim() == ".send(" {
            assert!(current.starts_with("request_"), "{current} sends an API request but is not an explicit request command");
        }
    }
}

/// A-11, dynamic half: in a process of its own, recording, recovery, storage,
/// waveform, resampling, prosody, the local worker, measures, search, backup,
/// export and the diagnostic report run without building a single HTTP client.
#[test]
fn a11_recording_local_transcription_and_prosody_never_build_an_http_client() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "acceptance::a11_child_local_paths", "--ignored", "--nocapture", "--test-threads=1"])
        .env("CLEARPRACTICE_A11_CHILD", "1")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success() && stdout.contains("1 passed"), "child failed:\n{stdout}\n{}", String::from_utf8_lossy(&output.stderr));
}

#[test]
#[ignore = "child process of a11_recording_local_transcription_and_prosody_never_build_an_http_client"]
fn a11_child_local_paths() {
    if std::env::var("CLEARPRACTICE_A11_CHILD").is_err() {
        return;
    }
    assert_eq!(crate::net_guard::clients_built(), 0, "a fresh process");
    let root = TestRoot::new();
    // Recording and recovery of an interrupted take.
    let saved = take(&root.0, "take-1");
    let mut writer = ChunkWriter::create(&root.0, &manifest("interrupted")).unwrap();
    for i in 0..96_000 {
        writer.push(voice(i, 48_000, 120.0)).unwrap();
    }
    writer.flush().unwrap();
    drop(writer);
    assert_eq!(recording::list_recoverable(&root.0).unwrap().len(), 1);
    recording::finalize(&root.0, "interrupted", true).unwrap();
    let db = DatabaseOwner::open(&root.0).unwrap();
    db.commit_recording(&saved).unwrap();
    db.update_session("take-1", "Local only", "A note", &[], false).unwrap();
    // Waveform, the 16 kHz copy, intonation.
    db.waveform("take-1").unwrap();
    crate::audio::prepare::prepare(&root.0, "take-1", &AtomicBool::new(false)).unwrap();
    db.prosody("take-1").unwrap();
    // Local transcription: the worker (a stand-in that fails), then a result, measures and review.
    assert_eq!(crate::transcribe::preference(&db).unwrap().mode, crate::transcribe::TranscriptionMode::Local);
    assert!(crate::transcribe::load_config(&db).is_err());
    #[cfg(windows)]
    {
        let worker = crate::audio::whisper::WhisperWorker::new(root.0.clone());
        assert!(worker.transcribe(&failing_worker(&root.0), "take-1", "take-1--w", &AtomicBool::new(false), |_| {}).is_err());
    }
    let raw = br#"{"result":{"language":"en"},"transcription":[{"text":" So, uh, indexes help.","offsets":{"from":0,"to":1500}}]}"#;
    let (_, segments) = crate::audio::whisper::segments(raw, 2_000).unwrap();
    let parts: Vec<(&str, Option<u64>, Option<u64>)> = segments.iter().map(|s| (s.text.as_str(), s.start_ms, s.end_ms)).collect();
    local_transcript(&db, "take-1", "take-1--1", &parts, 3);
    db.attempt_transcript_with_voice("take-1").unwrap();
    db.set_filler_decision("take-1--1", 0, "uh", Some("confirmed"), 4).unwrap();
    db.save_transcript_correction("take-1", "take-1--1", "So indexes help.", 5).unwrap();
    db.take_coaching_input("take-1").unwrap();
    assert_eq!(db.search("indexes").unwrap().len(), 1);
    // Backup, restore check, session export, storage view and diagnostic report.
    let out = TestRoot::new();
    let summary = backup::create(&db, &out.0, recording::now_ms()).unwrap();
    backup::inspect(&root.0, &out.0.join(&summary.file_name), "stage-a11").unwrap();
    backup::discard_staging(&root.0, "stage-a11").unwrap();
    backup::export::export_session(&db, "take-1", &out.0.join("export.zip"), 0).unwrap();
    crate::storage_usage::usage(&root.0);
    crate::diagnostics::report(&db, json!({})).unwrap();

    assert_eq!(crate::net_guard::clients_built(), 0, "no HTTP client was built on any local path");
    // The counter works: building the API transport (without sending anything) counts one.
    crate::api::transport::ApiTransport::new().unwrap();
    assert_eq!(crate::net_guard::clients_built(), 1);
}

// ── A-12 Keys never stored ──────────────────────────────────────────────────

/// A-12: a key only lives in Windows Credential Manager. The key type cannot be
/// printed, cloned or serialised; plaintext reads happen only in the two API
/// adapters; a key passed to preferences is dropped; and after a full profile
/// (transcripts, cloud results, feedback, accounting, backup, export, report)
/// no file the app wrote contains the key or an authorization header.
#[test]
fn a12_keys_never_reach_sqlite_logs_exports_backups_or_reports() {
    const KEY: &str = "sk-acceptance-A12-0123456789abcdefXYZ";
    // The type: no derives, and Drop (which wipes it) is its only trait impl.
    let credentials = include_str!("credentials.rs");
    let lines: Vec<&str> = credentials.lines().collect();
    let at = lines.iter().position(|l| l.starts_with("pub struct Secret(")).unwrap();
    assert!(!lines[at - 1].trim_start().starts_with("#[derive"), "Secret must not derive anything");
    let impls: Vec<&&str> = lines.iter().filter(|l| l.contains("for Secret")).collect();
    assert_eq!(impls.len(), 1, "{impls:?}");
    assert!(impls[0].contains("impl Drop for Secret"));
    // Plaintext reads only in the adapters that send; no command returns a key.
    for (name, code) in production_sources() {
        if code.contains("credentials::read()") || code.contains("credentials::read_provider(") {
            assert!(name == "api/audio.rs" || name == "api/coaching.rs", "{name} reads a plaintext key");
        }
        if name != "credentials.rs" {
            assert!(!code.contains("CredReadW"), "{name} reads Credential Manager directly");
        }
    }
    for file in files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/storage")).into_iter().filter(|f| f.extension().is_some_and(|e| e == "sql")) {
        let schema = fs::read_to_string(&file).unwrap().to_lowercase();
        for word in ["api_key", "secret", "password", "credential", "authorization"] {
            assert!(!schema.contains(word), "{} has a {word} column", file.display());
        }
    }
    // The key in requests: hidden from Debug output, marked sensitive.
    let secret = crate::credentials::Secret::new(KEY.into()).unwrap();
    let transport = crate::api::transport::ApiTransport::new().unwrap();
    let request = transport.audio_request(reqwest::Method::POST, "https://api.deepgram.com/v1/listen?model=nova-3", "Token ", &secret, "audio/wav", Some(vec![0; 16])).unwrap();
    assert!(request.headers()[reqwest::header::AUTHORIZATION].is_sensitive());
    assert!(!format!("{request:?}").contains(KEY));
    // Errors never echo a key, and invalid keys are refused before Credential Manager is touched.
    for error in [crate::credentials::store(format!("{KEY} with a space")).unwrap_err(), crate::credentials::store_provider("other-provider", KEY.into()).unwrap_err()] {
        assert!(!error.contains(KEY), "{error}");
    }

    // A full profile.
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    let mut prefs: crate::preferences::Preferences = serde_json::from_value(json!({"apiKey": KEY, "openaiKey": KEY, "coachingMode": "api"})).unwrap();
    prefs.goal_note = "My own words".into();
    crate::preferences::save(&db, prefs).unwrap();
    local_transcript(&db, "take", "take--1", &[(" So, uh, indexes help.", Some(0), Some(1_500))], 2);
    db.save_transcript_correction("take", "take--1", "So indexes help.", 3).unwrap();
    let preview = AudioPreviewOwner::default().preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    let raw = json!({"metadata":{"request_id":"dg-1","duration":2.0},"results":{"channels":[{"alternatives":[{"transcript":"so uh indexes help","words":[]}]}]}});
    let parsed = audio::parse_deepgram(&raw).unwrap();
    let result = audio::to_result(&preview, &saved.sha256, parsed, Some("dg-1".into()), 4_300).unwrap();
    db.save_api_transcript(&result, &raw, 4).unwrap();
    let summary = audio::AudioResult { request_id: preview.request_id.clone(), provider: AudioProvider::Deepgram, model: "nova-3".into(), text: result.raw_text.clone(), word_count: 4,
        filler_count: 1, word_timings: false, word_timings_unavailable_reason: result.words.unavailable_reason.clone(), provider_request_id: Some("dg-1".into()), audio_duration_ms: Some(2_000), estimated_cost_micro_usd: 4_300 };
    audio::keep_unsaved(&root.0, &audio::ApiRun { summary, raw: raw.clone(), result }).unwrap();
    let feedback = feedback_answer();
    db.insert_coaching_run(&NewRun { id: "coach-1", attempt_id: "take", revision_id: "take--1", provider: "OpenAI", model: "gpt-6-luna", payload_sha256: &sha("p"),
        sent_text: "Task: x", transcript_text: "So, uh, indexes help.", delivery_impressions: false, provider_request_id: Some("req_1"), raw_response: "{}", feedback: &feedback,
        input_tokens: Some(1), output_tokens: Some(1), estimated_cost_micro_usd: Some(1) }).unwrap();
    let budget = BudgetOwner::open(&root.0).unwrap();
    budget.reserve("api-deepgram-1", Purpose::Transcription, &sha("a"), Some(quote(4_300))).unwrap();
    budget.mark_dispatched("api-deepgram-1", &sha("a")).unwrap();
    budget.settle("api-deepgram-1", Some(4_300), None, Some("dg-1".into())).unwrap();
    let out = TestRoot::new();
    backup::create(&db, &out.0, recording::now_ms()).unwrap();
    let export = out.0.join("export.zip");
    backup::export::export_session(&db, "take", &export, 0).unwrap();
    let report = crate::diagnostics::report(&db, json!({})).unwrap();
    drop(budget);
    drop(db);

    let needles: [&[u8]; 4] = [KEY.as_bytes(), b"authorization", b"bearer ", b"sk-acceptance"];
    let mut checked = 0;
    let mut check = |what: String, bytes: &[u8]| {
        checked += 1;
        for needle in needles {
            assert!(!contains(bytes, needle), "{what} contains {}", String::from_utf8_lossy(needle));
        }
    };
    for file in files(&root.0).into_iter().chain(files(&out.0)) {
        let bytes = fs::read(&file).unwrap();
        if file.extension().is_some_and(|e| e == "zip") {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).unwrap();
                let mut inner = Vec::new();
                entry.read_to_end(&mut inner).unwrap();
                let name = format!("{} → {}", file.display(), entry.name());
                drop(entry);
                check(name, &inner);
            }
        } else {
            check(file.display().to_string(), &bytes);
        }
    }
    check("diagnostic report".into(), report.as_bytes());
    assert!(checked > 20, "the scan saw the profile ({checked} files)");
}

// ── A-15 Provider or endpoint changes never forward a key ───────────────────

/// A-15 (besides every_called_endpoint_matches_the_key_slot_it_uses): each
/// provider's key slot names the host its requests go to; the transport refuses
/// any other host; a local model never gets a key, even after its address changes.
#[test]
fn a15_a_provider_or_endpoint_change_never_forwards_a_key() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let previews = AudioPreviewOwner::default();
    for provider in [AudioProvider::Deepgram, AudioProvider::Assemblyai] {
        let preview = previews.preview(&root.0, &saved, provider).unwrap();
        assert_eq!(crate::credentials::transcription_target(provider.key()).unwrap(), format!("ClearPractice/v1/https-{}", preview.recipient), "{provider:?}");
    }
    assert_ne!(crate::credentials::transcription_target("deepgram").unwrap(), crate::credentials::transcription_target("assemblyai").unwrap());
    assert!(crate::credentials::transcription_target("openai").is_err(), "no slot is shared with coaching");
    let coaching = PreviewOwner::default().preview("I want to be more clear.".into(), CoachingModel::Luna).unwrap();
    assert!(coaching.recipient.starts_with("https://api.openai.com/"));

    let transport = crate::api::transport::ApiTransport::new().unwrap();
    let key = crate::credentials::Secret::new("fake-a15-key".into()).unwrap();
    for url in ["https://api.deepgram.com.example.org/v1/listen", "https://example.org/https://api.deepgram.com/", "http://api.assemblyai.com/v2/upload", "https://api.openai.com/v1/responses", "https://127.0.0.1:8080/v1/chat/completions"] {
        assert!(transport.audio_request(reqwest::Method::POST, url, "Token ", &key, "audio/wav", None).is_err(), "{url} must not receive a key");
    }

    // Local model: the old address keeps only what was previewed for it; neither gets a key.
    let db = DatabaseOwner::open(&root.0).unwrap();
    local_transcript(&db, "take", "take--1", &[(" Indexes help.", Some(0), Some(1_500))], 2);
    let (first, first_seen) = local_model(feedback_answer());
    let (second, second_seen) = local_model(feedback_answer());
    let owner = PreviewOwner::default();
    let text = || crate::take_coaching::build(&db.take_coaching_input("take").unwrap(), &[], &[]).unwrap();
    let old = owner.preview_take(text(), CoachingModel::Luna, false, Some(LocalTarget { base: first.clone(), model: String::new() })).unwrap();
    assert!(old.recipient.starts_with(&first));
    tauri::async_runtime::block_on(owner.send_take_local("take", &old.request_id, &old.payload_sha256)).unwrap();
    let new = owner.preview_take(text(), CoachingModel::Luna, false, Some(LocalTarget { base: second.clone(), model: String::new() })).unwrap();
    tauri::async_runtime::block_on(owner.send_take_local("take", &new.request_id, &new.payload_sha256)).unwrap();
    for (seen, base) in [(&first_seen, &first), (&second_seen, &second)] {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "{base}: exactly the one request previewed for it");
        assert!(!seen[0].to_lowercase().contains("authorization:"), "{base}: no key header");
        assert!(seen[0].starts_with("POST /v1/chat/completions"));
    }
    assert!(crate::api::local_llm::validate_endpoint("http://192.168.1.20:8080").is_err(), "a LAN address is not local");
}

// ── A-16 Cache, retries and the combined budget ─────────────────────────────

/// A-16 (besides the budget and storage tests): both purposes share one ledger.
/// Simultaneous requests can never reserve beyond the limit; unknown prices never
/// reserve; a timed-out charge stays counted through Stop, restart and retry; and
/// identical requests are recognised for both purposes while a deliberate
/// retranscription or regeneration is stored next to the earlier result.
#[test]
fn a16_cache_reuse_retries_unknown_prices_and_the_combined_budget() {
    let root = TestRoot::new();
    let budget = BudgetOwner::open(&root.0).unwrap();
    let granted = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..12)
            .map(|i| {
                let budget = &budget;
                scope.spawn(move || {
                    let purpose = if i % 2 == 0 { Purpose::Coaching } else { Purpose::Transcription };
                    budget.reserve(&format!("request-{i}"), purpose, &sha(&i.to_string()), Some(quote(1_000_000))).is_ok()
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).filter(|ok| *ok).count()
    });
    assert_eq!(granted, 5, "USD 5 shared by both purposes, never more");
    let summary = budget.summary().unwrap();
    assert_eq!((summary.counted_micro_usd, summary.coaching_micro_usd + summary.transcription_micro_usd, summary.remaining_micro_usd), (5_000_000, 5_000_000, 0));
    for i in 0..12 {
        let _ = budget.release_unsent(&format!("request-{i}"));
    }
    assert_eq!(budget.summary().unwrap().counted_micro_usd, 0, "unsent reservations are released");
    for purpose in [Purpose::Coaching, Purpose::Transcription] {
        assert!(budget.reserve("unknown-price", purpose, &sha("u"), None).unwrap_err().contains("Price unknown"));
    }

    // A timed-out request: Uncertain, through Stop, restart and a retry attempt.
    budget.reserve("timed-out", Purpose::Transcription, &sha("t"), Some(quote(4_300))).unwrap();
    budget.mark_dispatched("timed-out", &sha("t")).unwrap();
    budget.settle("timed-out", None, None, None).unwrap(); // what the transport does on a timeout
    assert!(audio::stopped(&budget, "timed-out").contains("charge is uncertain"));
    assert!(budget.release_unsent("timed-out").is_err());
    drop(budget);
    let budget = BudgetOwner::open(&root.0).unwrap();
    let summary = budget.summary().unwrap();
    assert_eq!((summary.uncertain_micro_usd, summary.counted_micro_usd), (4_300, 4_300), "never reset to zero");
    assert!(budget.reserve("timed-out", Purpose::Transcription, &sha("t"), Some(quote(4_300))).unwrap_err().contains("new approved request ID"));

    // Identical requests are recognised; deliberate repeats are kept beside the first.
    let saved = take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    local_transcript(&db, "take", "take--1", &[(" Indexes help.", Some(0), Some(1_500))], 2);
    let previews = AudioPreviewOwner::default();
    let first = previews.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    let previous = |p: &audio::AudioPreview| db.previous_api_run("take", &p.audio_sha256, p.provider.key(), &p.model, &p.settings, audio::ADAPTER_VERSION).unwrap();
    assert!(previous(&first).is_none());
    let words = || Parsed { text: "Indexes help.".into(), words: vec![("Indexes".into(), 0, 600), ("help.".into(), 650, 1_200)], duration_ms: Some(2_000) };
    db.save_api_transcript(&audio::to_result(&first, &saved.sha256, words(), None, 4_300).unwrap(), &json!({}), 3).unwrap();
    std::thread::sleep(Duration::from_millis(3));
    let again = previews.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    assert_ne!(again.request_id, first.request_id, "a retranscription is a new request");
    assert!(previous(&again).is_some(), "the preview says it was already transcribed (a new paid run)");
    db.save_api_transcript(&audio::to_result(&again, &saved.sha256, words(), None, 4_300).unwrap(), &json!({}), 4).unwrap();
    let conn = read_only(&root.0);
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM api_runs WHERE attempt_id='take'"), 2, "both runs kept");
    assert_eq!(count("SELECT COUNT(*) FROM transcript_revisions WHERE attempt_id='take'"), 3, "local + two cloud revisions");

    let coaching = PreviewOwner::default();
    let text = || crate::take_coaching::build(&db.take_coaching_input("take").unwrap(), &[], &[]).unwrap();
    let asked = coaching.preview_take(text(), CoachingModel::Luna, false, None).unwrap();
    let feedback = feedback_answer();
    let run = |id: &'static str| NewRun { id, attempt_id: "take", revision_id: "take--1", provider: "OpenAI", model: "gpt-6-luna", payload_sha256: &asked.payload_sha256,
        sent_text: &asked.selected_text, transcript_text: "Indexes help.", delivery_impressions: false, provider_request_id: None, raw_response: "{}", feedback: &feedback,
        input_tokens: None, output_tokens: None, estimated_cost_micro_usd: None };
    db.insert_coaching_run(&run("coach-1")).unwrap();
    let same = coaching.preview_take(text(), CoachingModel::Luna, false, None).unwrap();
    assert_eq!(same.payload_sha256, asked.payload_sha256, "the same request has the same fingerprint");
    assert!(db.coaching_answered_at("take", &same.payload_sha256).unwrap().is_some(), "so the preview offers Ask again · may be billed");
    let other = coaching.preview_take(text(), CoachingModel::Sol, false, None).unwrap();
    assert!(db.coaching_answered_at("take", &other.payload_sha256).unwrap().is_none(), "another model is another request");
    db.insert_coaching_run(&run("coach-2")).unwrap();
    let runs = db.list_coaching_runs("take").unwrap();
    assert_eq!(runs.len(), 2, "a regenerated answer is kept beside the first");
    assert!(runs.iter().all(|r| r.cost_unavailable_reason.is_some() && r.estimated_cost_micro_usd.is_none()), "missing usage is explained, never 0");
}

// ── A-17 A changed transcript or redaction invalidates the coaching preview ─

/// A-17: an approval is bound to the transcript revision and the exact text. A
/// correction after the preview discards it (nothing is sent); hidden words make
/// a different request; feedback already given stays with the revision and text
/// it was made from. Uses a local stand-in model, so nothing leaves the computer.
#[test]
fn a17_a_changed_transcript_or_redaction_invalidates_the_preview_and_keeps_old_evidence() {
    let root = TestRoot::new();
    take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    local_transcript(&db, "take", "take--1", &[(" So, uh, an index makes reads fast.", Some(0), Some(1_500))], 2);
    let (base, seen) = local_model(feedback_answer());
    let owner = PreviewOwner::default();
    let target = || Some(LocalTarget { base: base.clone(), model: String::new() });
    let text = |hide: &[String]| crate::take_coaching::build(&db.take_coaching_input("take").unwrap(), &[], hide).unwrap();
    let current = || db.take_coaching_input("take").unwrap().revision_id;
    let send = |p: &crate::api::coaching::Preview| tauri::async_runtime::block_on(owner.send_take_local("take", &p.request_id, &p.payload_sha256));
    let store = |id: &str, answer: &crate::api::coaching::TakeAnswer| {
        db.insert_coaching_run(&NewRun { id, attempt_id: "take", revision_id: &answer.request.revision_id, provider: &answer.provider, model: &answer.model,
            payload_sha256: &answer.payload_sha256, sent_text: &answer.sent_text, transcript_text: &answer.request.transcript, delivery_impressions: false,
            provider_request_id: None, raw_response: &answer.raw.to_string(), feedback: &answer.feedback, input_tokens: None, output_tokens: None, estimated_cost_micro_usd: Some(0) }).unwrap();
    };

    // Feedback on the machine transcript.
    let first = owner.preview_take(text(&[]), CoachingModel::Luna, false, target()).unwrap();
    owner.ensure_take_revision(&first.request_id, &current()).unwrap();
    store("coach-1", &send(&first).unwrap());
    assert_eq!(seen.lock().unwrap().len(), 1);

    // A correction after the preview: the approval is discarded, nothing is sent.
    let stale = owner.preview_take(text(&[]), CoachingModel::Luna, false, target()).unwrap();
    let correction = db.save_transcript_correction("take", "take--1", "So an index makes reads faster.", 5).unwrap();
    assert_eq!(current(), correction);
    assert!(owner.ensure_take_revision(&stale.request_id, &current()).unwrap_err().contains("transcript changed"));
    assert!(send(&stale).is_err(), "the stale approval is gone");
    let follow_up = owner.preview_follow_up(crate::take_coaching::follow_up_text(&db.take_coaching_input("take").unwrap()).unwrap(), CoachingModel::Luna, target()).unwrap();
    db.save_transcript_correction("take", "take--1", "An index makes reads much faster.", 6).unwrap();
    assert!(owner.ensure_take_revision(&follow_up.request_id, &current()).is_err(), "follow-up approvals too");
    assert_eq!(seen.lock().unwrap().len(), 1, "nothing was sent");

    // Hidden words: another text, another fingerprint; one approval never covers the other.
    let plain = owner.preview_take(text(&[]), CoachingModel::Luna, false, target()).unwrap();
    let hidden = owner.preview_take(text(&["faster".into()]), CoachingModel::Luna, false, target()).unwrap();
    assert_ne!(plain.payload_sha256, hidden.payload_sha256);
    assert!(!hidden.selected_text.to_lowercase().contains("faster") && hidden.selected_text.contains("[hidden]"));
    assert!(tauri::async_runtime::block_on(owner.send_take_local("take", &hidden.request_id, &plain.payload_sha256)).is_err());
    assert_eq!(seen.lock().unwrap().len(), 1, "nothing was sent");

    // A fresh preview of the newest text goes through; old feedback keeps its revision and text.
    let fresh = owner.preview_take(text(&[]), CoachingModel::Luna, false, target()).unwrap();
    owner.ensure_take_revision(&fresh.request_id, &current()).unwrap();
    let answer = send(&fresh).unwrap();
    assert_eq!(answer.request.revision_id, current());
    store("coach-2", &answer);
    assert_eq!(seen.lock().unwrap().len(), 2);
    let runs = db.list_coaching_runs("take").unwrap();
    let old = runs.iter().find(|r| r.id == "coach-1").unwrap();
    assert_eq!((old.revision_id.as_str(), old.transcript_text.as_str()), ("take--1", "So, uh, an index makes reads fast."));
    assert_eq!(db.attempt_transcript("take").unwrap()["revision"]["text"], "So, uh, an index makes reads fast.", "the machine text is unchanged");
}

// ── A-21 Prosody on the original timeline ───────────────────────────────────

/// A-21 (besides intonation_frames_stay_aligned_to_the_original_timeline_after_resampling
/// and a_rising_sweep_rises_and_silence_is_a_gap_not_zero): a 44.1 kHz take with
/// 200 Hz speech, 400 ms of silence and 120 Hz speech. Frames are 10 ms steps of
/// the original take; the silence is a gap (null), never 0 Hz, also in the
/// stored track and the JSON the interface receives.
#[test]
fn a21_prosody_stays_on_the_original_timeline_and_silence_is_a_gap() {
    let root = TestRoot::new();
    let rate = 44_100;
    take_with(&root.0, "tone", rate, 70_560, |i| {
        let ms = i as u64 * 1_000 / u64::from(rate);
        if ms < 600 { voice(i, rate, 200.0) } else if ms < 1_000 { 0 } else { voice(i, rate, 120.0) }
    });
    let db = DatabaseOwner::open(&root.0).unwrap();
    let contour = db.prosody("tone").unwrap();
    assert_eq!((contour.hop_ms, contour.f0_hz.len()), (10, 160), "one frame per 10 ms of the 1.6 s take");
    let near = |i: usize, hz: f32| contour.f0_hz[i].is_some_and(|f| (f - hz).abs() < 4.0);
    assert!((5..=50).all(|i| near(i, 200.0)), "{:?}", &contour.f0_hz[5..=50]);
    assert!((105..=150).all(|i| near(i, 120.0)), "{:?}", &contour.f0_hz[105..=150]);
    for i in 62..=94 {
        assert!(contour.f0_hz[i].is_none(), "frame {i} in the silence must be a gap: {:?}", contour.f0_hz[i]);
        assert!(contour.rms_db[i].is_none_or(|db| db < -50.0), "frame {i}: {:?}", contour.rms_db[i]);
    }
    let shown = serde_json::to_value(&contour).unwrap();
    assert!(shown["f0Hz"][75].is_null() && shown["f0Hz"].as_array().unwrap().iter().all(|v| v.is_null() || v.as_f64().unwrap() > 0.0), "no zeros in the JSON");
    assert_eq!(db.prosody("tone").unwrap(), contour, "the stored track is the same");
}

// ── A-23 API audio previews never dispatch by themselves ────────────────────

/// A-23 (with api::audio::tests::a23_any_change_to_what_was_approved_rejects_the_approval):
/// preparing a preview, a restart (new preview owner), reopening the accounting
/// and restoring a backup never send or reserve anything; an old approval does
/// not survive a restart.
#[test]
fn a23_previews_restart_and_restore_never_dispatch_an_upload() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let budget = BudgetOwner::open(&root.0).unwrap();
    let previews = AudioPreviewOwner::default();
    let preview = previews.preview(&root.0, &saved, AudioProvider::Assemblyai).unwrap();
    assert!(previews.preview_audio(&preview.request_id).is_ok(), "the exact audio can be heard first");
    let summary = budget.summary().unwrap();
    assert_eq!((summary.counted_micro_usd, summary.reserved_micro_usd), (0, 0), "a preview reserves nothing");
    drop(previews); // the app closes: pending approvals live only in memory
    let restarted = AudioPreviewOwner::default();
    assert!(restarted.preview_audio(&preview.request_id).is_err(), "no approval survives a restart");
    drop(budget);
    let budget = BudgetOwner::open(&root.0).unwrap();
    assert_eq!(budget.summary().unwrap().counted_micro_usd, 0, "reopening the ledger sends nothing");
    // A backup and restore carry no approvals or reservations.
    let db = DatabaseOwner::open(&root.0).unwrap();
    let out = TestRoot::new();
    let archive = out.0.join(backup::create(&db, &out.0, recording::now_ms()).unwrap().file_name);
    let zip = zip::ZipArchive::new(fs::File::open(&archive).unwrap()).unwrap();
    let names: Vec<&str> = zip.file_names().collect();
    assert!(names.iter().all(|n| !n.starts_with("accounting/") && !n.starts_with("cache/")), "{names:?}");
}

// ── A-24 Untimed API transcripts and timing checks ──────────────────────────

/// A-24: an API transcript without timings can be corrected and the whole take
/// played; nothing pretends to be aligned and each gap says why. Returned
/// timings are checked against the original take: in range, in order, never repaired.
#[test]
fn a24_untimed_api_transcripts_allow_correction_and_playback_and_timings_are_checked() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    let previews = AudioPreviewOwner::default();
    let preview = previews.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    assert_eq!(preview.duration_ms, saved.duration_ms, "timings are checked against the original take's length");

    // Untimed: stored with the reason, correctable, whole-take playback.
    let untimed = audio::to_result(&preview, &saved.sha256, Parsed { text: "So, uh, indexes help.".into(), words: vec![], duration_ms: Some(2_000) }, None, 4_300).unwrap();
    assert!(untimed.words.value.is_none() && untimed.words.unavailable_reason.is_some() && !untimed.capabilities.word_timings);
    db.save_api_transcript(&untimed, &json!({}), 2).unwrap();
    let view = db.attempt_transcript("take").unwrap();
    let revision = &view["revision"];
    assert_eq!(revision["source"], "api");
    assert!(revision["segments"][0]["startMs"].is_null() && revision["segments"][0]["timingUnavailableReason"].as_str().is_some_and(|r| !r.is_empty()));
    assert!(revision["measures"]["paceWpm"].is_null() && revision["measures"]["paceUnavailableReason"].is_string());
    assert!(revision["measures"]["pausesUnavailableReason"].is_string());
    assert!(revision["measures"]["fillers"][0]["wordStartMs"].is_null(), "no fabricated word time for the filler");
    let correction = db.save_transcript_correction("take", &untimed.run_id, "So indexes help.", 3).unwrap();
    assert_eq!(db.attempt_transcript("take").unwrap()["correction"]["id"], correction.as_str());
    let playback = db.playback_path("take").unwrap();
    assert_eq!(recording::hash_file(&playback).unwrap(), saved.sha256, "the whole take plays");

    // Timed: kept only when every word is inside the take and in order.
    let words = |w: &[(&str, u64, u64)]| Parsed { text: "So indexes help.".into(), words: w.iter().map(|(t, s, e)| (t.to_string(), *s, *e)).collect(), duration_ms: Some(2_000) };
    let good = audio::to_result(&preview, &saved.sha256, words(&[("So", 0, 200), ("indexes", 300, 900), ("help.", 950, 2_000)]), None, 4_300).unwrap();
    assert_eq!(good.words.value.as_ref().unwrap().len(), 3);
    for bad in [
        vec![("So", 0, 200), ("indexes", 300, 900), ("help.", 950, 2_001)], // past the end of the take
        vec![("So", 500, 700), ("indexes", 300, 900)],                       // out of order
        vec![("So", 400, 300)],                                               // ends before it starts
        vec![("", 0, 100)],                                                    // empty word
    ] {
        let result = audio::to_result(&preview, &saved.sha256, words(&bad), None, 4_300).unwrap();
        assert!(result.words.value.is_none() && result.words.unavailable_reason.is_some(), "{bad:?} must be withheld, not repaired");
    }
    std::thread::sleep(Duration::from_millis(3));
    let timed_preview = previews.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    let timed = audio::to_result(&timed_preview, &saved.sha256, words(&[("So", 0, 200), ("indexes", 300, 900), ("help.", 950, 2_000)]), None, 4_300).unwrap();
    db.save_api_transcript(&timed, &json!({}), 4).unwrap();
    let segments = db.attempt_transcript("take").unwrap()["revision"]["segments"].clone();
    assert!(segments.as_array().unwrap().iter().all(|s| s["endMs"].as_u64().is_some_and(|e| e <= saved.duration_ms)));
}

// ── A-25 API failures leave recordings and history intact ───────────────────

/// A-25: oversize audio, malformed or truncated answers, results for other
/// audio, Stop before and after dispatch all leave the recording, every earlier
/// revision, run and measure as they were; a retry needs a new request and is
/// disclosed as a repeat; a new provider and model add a revision beside the old ones.
#[test]
fn a25_api_failures_cancel_oversize_and_malformed_output_leave_recordings_and_history_intact() {
    let root = TestRoot::new();
    let saved = take(&root.0, "take");
    let db = DatabaseOwner::open(&root.0).unwrap();
    local_transcript(&db, "take", "take--1", &[(" Well, uh, indexes help.", Some(0), Some(1_500))], 2);
    let correction = db.save_transcript_correction("take", "take--1", "Well, indexes help.", 3).unwrap();
    let previews = AudioPreviewOwner::default();
    let deepgram = previews.preview(&root.0, &saved, AudioProvider::Deepgram).unwrap();
    let timed = || Parsed { text: "Well, uh, indexes help.".into(), words: vec![("Well,".into(), 0, 300), ("uh,".into(), 350, 500), ("indexes".into(), 600, 1_000), ("help.".into(), 1_000, 1_400)], duration_ms: Some(2_000) };
    let first = audio::to_result(&deepgram, &saved.sha256, timed(), Some("dg-1".into()), 4_300).unwrap();
    db.save_api_transcript(&first, &json!({"metadata":{"request_id":"dg-1"}}), 4).unwrap();
    let history = || {
        let conn = read_only(&root.0);
        ["transcript_revisions", "transcript_segments", "api_runs", "analysis_runs", "metric_values", "annotations"].iter().map(|t| rows(&conn, t)).collect::<Vec<_>>()
    };
    let before = history();
    let budget = BudgetOwner::open(&root.0).unwrap();

    // Oversize: refused before anything could be approved.
    let audio_path = previews.preview_audio(&deepgram.request_id).unwrap();
    assert!(previews.preview_prepared(audio_path.clone(), "take", 15 * 60 * 1_000 + 1, 1_000, "a".repeat(64), saved.sha256.clone(), AudioProvider::Assemblyai).unwrap_err().contains("15 minutes"));
    assert!(previews.preview_prepared(audio_path, "take", 1_000, crate::api::transport::MAX_AUDIO_UPLOAD as u64 + 1, "a".repeat(64), saved.sha256.clone(), AudioProvider::Deepgram).is_err());
    // Malformed or truncated answers never become a transcript.
    for raw in [json!({}), json!({"results": {"channels": []}}), json!("{\"results\":"), json!({"results": {"channels": [{"alternatives": [{"transcript": 5}]}]}})] {
        assert!(audio::parse_deepgram(&raw).is_err(), "{raw}");
    }
    for raw in [json!({"status": "completed"}), json!({"text": null}), json!([])] {
        assert!(audio::parse_assemblyai(&raw).is_err(), "{raw}");
    }
    assert!(audio::to_result(&deepgram, &saved.sha256, Parsed { text: String::new(), words: vec![], duration_ms: None }, None, 4_300).is_err());
    // A result for different audio is refused by storage.
    let mut other = first.clone();
    other.run_id = "api-deepgram-other".into();
    other.source_sha256 = "e".repeat(64);
    assert!(db.save_api_transcript(&other, &json!({}), 5).is_err());
    // Stop before dispatch: nothing billed. After dispatch, or a malformed answer: Uncertain, never resent.
    budget.reserve("api-stop-early", Purpose::Transcription, &sha("1"), Some(quote(4_300))).unwrap();
    assert!(audio::stopped(&budget, "api-stop-early").contains("Nothing was billed"));
    for id in ["api-stop-late", "api-bad-json"] {
        budget.reserve(id, Purpose::Transcription, &sha(id), Some(quote(4_300))).unwrap();
        budget.mark_dispatched(id, &sha(id)).unwrap();
    }
    assert!(audio::stopped(&budget, "api-stop-late").contains("charge is uncertain"));
    budget.settle("api-bad-json", None, None, None).unwrap(); // what send() does with an unreadable answer
    assert_eq!(budget.summary().unwrap().uncertain_micro_usd, 8_600);
    assert!(budget.reserve("api-stop-late", Purpose::Transcription, &sha("api-stop-late"), Some(quote(4_300))).unwrap_err().contains("new approved request ID"), "a retry is a new, separately approved request");

    assert_eq!(history(), before, "transcripts, runs and measures unchanged");
    assert_eq!(db.checked_recording("take").unwrap().sha256, saved.sha256, "the recording is unchanged");
    assert!(db.previous_api_run("take", &deepgram.audio_sha256, "deepgram", "nova-3", &deepgram.settings, audio::ADAPTER_VERSION).unwrap().is_some(), "a retry is disclosed as a repeat");

    // Another provider and model: a new revision beside the old ones, nothing overwritten.
    let assembly = previews.preview(&root.0, &saved, AudioProvider::Assemblyai).unwrap();
    assert_eq!(assembly.audio_sha256, deepgram.audio_sha256, "the same prepared audio");
    assert_ne!(assembly.model, deepgram.model);
    let second = audio::to_result(&assembly, &saved.sha256, timed(), Some("aai-1".into()), 3_500).unwrap();
    db.save_api_transcript(&second, &json!({"id":"aai-1"}), 6).unwrap();
    let conn = read_only(&root.0);
    let revisions: Vec<(String, Option<String>, String)> = conn.prepare("SELECT id,provider,text FROM transcript_revisions ORDER BY created_at_ms,id").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
    assert_eq!(revisions.len(), 4, "{revisions:?}");
    assert!(revisions.iter().any(|r| r.0 == first.run_id && r.1.as_deref() == Some("deepgram") && r.2 == "Well, uh, indexes help."));
    assert!(revisions.iter().any(|r| r.0 == correction && r.2 == "Well, indexes help."));
    assert!(revisions.iter().any(|r| r.0 == second.run_id && r.1.as_deref() == Some("assemblyai")));
    assert_eq!(db.attempt_transcript("take").unwrap()["revision"]["id"], second.run_id.as_str(), "the newest is shown; the rest stay");
    assert_ne!(crate::credentials::transcription_target("deepgram").unwrap(), crate::credentials::transcription_target("assemblyai").unwrap(), "each provider keeps its own key");
}
