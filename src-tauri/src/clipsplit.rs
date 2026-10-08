//! Split a long recording into practice clips (plan 4.4c). The staged file is
//! resampled to 16 kHz, transcribed with the verified local Whisper worker, and
//! cut into 10–20 s candidates that start and end on whole sentences, skipping
//! long pauses. The user reviews, renames and keeps the candidates they want.
use crate::audio::{prepare, whisper};
use crate::clips;
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;

const MIN_CANDIDATE_MS: u64 = 8_000;
const MAX_CANDIDATE_MS: u64 = 20_000;
/// A pause this long ends a candidate: clips should not contain dead air.
const MAX_GAP_MS: u64 = 1_500;
pub const MAX_CANDIDATES: usize = 40;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub title: String,
}

fn ends_sentence(text: &str) -> bool {
    text.trim_end().ends_with(['.', '?', '!', '"', '\u{201d}'])
}

/// A short title from the clip's own words: its first sentence, at most ~8 words.
pub fn title_for(text: &str) -> String {
    let first = text.trim().split_inclusive(['.', '?', '!']).next().unwrap_or("").trim();
    let words: Vec<&str> = first.split_whitespace().collect();
    let mut title = words.iter().take(8).copied().collect::<Vec<_>>().join(" ");
    title = title.trim_end_matches([',', ';', ':']).to_string();
    if words.len() > 8 {
        title.push('…');
    }
    title
}

/// Groups timed segments into candidates of 8–20 s (10–20 s preferred) that end
/// on a sentence and contain no long pause. Pure, so it is easy to test.
pub fn propose(segments: &[(String, u64, u64)]) -> Vec<Candidate> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < segments.len() && out.len() < MAX_CANDIDATES {
        let start = segments[i].1;
        let mut best: Option<usize> = None;
        let mut j = i;
        while j < segments.len() {
            let (text, s, e) = &segments[j];
            if *e < *s || *e - start > MAX_CANDIDATE_MS || (j > i && *s - segments[j - 1].2.min(*s) > MAX_GAP_MS) {
                break;
            }
            if *e - start >= MIN_CANDIDATE_MS && ends_sentence(text) {
                best = Some(j);
                if *e - start >= 10_000 {
                    break; // long enough; prefer the first natural end past 10 s
                }
            }
            j += 1;
        }
        match best {
            Some(end) => {
                let text = segments[i..=end].iter().map(|s| s.0.trim()).collect::<Vec<_>>().join(" ");
                out.push(Candidate { start_ms: start, end_ms: segments[end].2, title: title_for(&text), text });
                i = end + 1;
            }
            None => i += 1,
        }
    }
    out
}

/// Writes a 16 kHz mono copy of a staged file for the worker, next to it.
pub fn resample_staged(root: &Path, staging_id: &str, cancel: &AtomicBool) -> Result<(PathBuf, u64)> {
    let dir = clips::staging_dir(root, staging_id)?;
    prepare::contained(root, &dir)?;
    let source = dir.join("full.wav");
    let mut input = BufReader::new(File::open(&source).map_err(|_| "The staged recording is unavailable. Choose the file again.")?);
    let mut header = [0u8; 44];
    input.read_exact(&mut header).map_err(|_| "The staged recording is damaged.")?;
    let rate = u32::from_le_bytes([header[24], header[25], header[26], header[27]]);
    let frames = u64::from(u32::from_le_bytes([header[40], header[41], header[42], header[43]])) / 2;
    let target = prepare::expected_frames(frames, rate);
    let path = dir.join("speech-16k.wav");
    let mut output = BufWriter::new(File::create(&path).map_err(|_| "Cannot prepare the recording for transcription.")?);
    output
        .write_all(&crate::storage::recording::wav_header(prepare::RATE, (target * 2) as u32))
        .map_err(|_| "Cannot prepare the recording for transcription.")?;
    prepare::convert(&mut input, &mut output, rate, frames, cancel)?;
    output.flush().map_err(|_| "Cannot prepare the recording for transcription.")?;
    Ok((path, target * 1000 / u64::from(prepare::RATE)))
}

/// Transcribes a staged file with the verified local worker. `progress` gets
/// 0–100; `cancel` stops the worker. Returns timed segments only.
pub fn transcribe_local(
    config: &whisper::WorkerConfig,
    root: &Path,
    staging_id: &str,
    cancel: &AtomicBool,
    progress: impl Fn(u8),
) -> Result<Vec<(String, u64, u64)>> {
    config.verify()?;
    let (audio, duration_ms) = resample_staged(root, staging_id, cancel)?;
    let dir = audio.parent().ok_or("Cannot prepare the transcription.")?.to_path_buf();
    let mut command = Command::new(&config.executable);
    command
        .current_dir(config.executable.parent().ok_or("Missing worker directory.")?)
        .arg("-m")
        .arg(&config.model)
        .arg("-f")
        .arg(&audio)
        .args(["-l", "en", "-t"])
        .arg(config.threads.to_string())
        .args(["-ojf", "-pp", "-of"])
        .arg(dir.join("raw"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if config.backend == whisper::Backend::Cpu {
        command.arg("-ng");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00004000); // hidden, below normal priority
    }
    let mut child = command.spawn().map_err(|_| "Cannot start the verified Whisper worker. Check Settings → Transcription.")?;
    let stderr = child.stderr.take().ok_or("Cannot read worker progress.")?;
    let (tx, rx) = std::sync::mpsc::sync_channel::<u8>(16);
    let reader = thread::spawn(move || {
        let mut stream = stderr;
        let mut chunk = [0u8; 2048];
        let mut line = Vec::new();
        while let Ok(n) = stream.read(&mut chunk) {
            if n == 0 {
                break;
            }
            for byte in &chunk[..n] {
                if *byte == b'\n' {
                    if let Some(p) = whisper::progress(&line) {
                        let _ = tx.try_send(p);
                    }
                    line.clear();
                } else if line.len() < 4096 {
                    line.push(*byte);
                }
            }
        }
    });
    let started = Instant::now();
    let outcome = loop {
        for p in rx.try_iter() {
            progress(p);
        }
        if cancel.load(Ordering::Relaxed) || started.elapsed() > Duration::from_secs(20 * 60) {
            let _ = child.kill();
            let _ = child.wait();
            break Err(if cancel.load(Ordering::Relaxed) { "Stopped. Nothing was saved." } else { "Transcription took longer than 20 minutes and was stopped." });
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) => break Err("Whisper could not finish this recording."),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = child.kill();
                break Err("Cannot monitor the Whisper worker.");
            }
        }
    };
    let _ = reader.join();
    outcome?;
    let raw = fs::read(dir.join("raw.json")).map_err(|_| "Whisper did not produce a transcript.")?;
    let _ = fs::remove_file(dir.join("raw.json"));
    let _ = fs::remove_file(&audio);
    let (_, segments) = whisper::segments(&raw, duration_ms)?;
    Ok(segments
        .into_iter()
        .filter_map(|s| Some((s.text.trim().to_string(), s.start_ms?, s.end_ms?)))
        .filter(|(t, _, _)| !t.is_empty())
        .collect())
}

/// Turns provider word timings into sentence segments for `propose` (cloud split).
pub fn segments_from_words(words: &[crate::audio::transcription::TimedText]) -> Vec<(String, u64, u64)> {
    let mut out = Vec::new();
    let mut current: Vec<&crate::audio::transcription::TimedText> = Vec::new();
    for (i, word) in words.iter().enumerate() {
        current.push(word);
        let gap_next = words.get(i + 1).map(|n| n.start_ms.saturating_sub(word.end_ms));
        if ends_sentence(&word.text) || gap_next.is_some_and(|g| g > MAX_GAP_MS) || i + 1 == words.len() {
            let text = current.iter().map(|w| w.text.trim()).collect::<Vec<_>>().join(" ");
            out.push((text, current[0].start_ms, word.end_ms));
            current.clear();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(text: &str, s: u64, e: u64) -> (String, u64, u64) {
        (text.into(), s, e)
    }

    #[test]
    fn proposes_whole_sentence_clips_of_ten_to_twenty_seconds_without_long_pauses() {
        let segments = vec![
            seg("And now, words and their stories.", 0, 4_000),
            seg("Imagine you are sitting in a grassy field.", 6_000, 9_500),
            seg("And you have only one job,", 9_800, 12_000),
            seg("to watch the grass grow.", 12_000, 14_500),
            seg("That does not sound very interesting.", 15_000, 17_800),
            // a 3 s pause: the next candidate starts fresh
            seg("In fact, it sounds really boring.", 20_800, 23_000),
            seg("One very long run-on segment that never ends a sentence", 23_100, 50_000),
            seg("Short.", 51_000, 52_000),
        ];
        let candidates = propose(&segments);
        // The intro is cut off by the 2 s gap after it; the 3 s pause ends the
        // first clip; the run-on segment is longer than 20 s; "Short." is too short.
        assert_eq!(candidates.len(), 1, "{candidates:?}");
        let c = &candidates[0];
        assert_eq!((c.start_ms, c.end_ms), (6_000, 17_800), "first natural end past 10 s");
        assert!(c.text.starts_with("Imagine you are") && c.text.ends_with("very interesting."));
        assert_eq!(c.title, "Imagine you are sitting in a grassy field.");
    }

    #[test]
    fn cloud_word_timings_become_sentence_segments() {
        use crate::audio::transcription::TimedText;
        let w = |t: &str, s: u64, e: u64| TimedText { text: t.into(), start_ms: s, end_ms: e, provenance: "Estimated".into() };
        let words = [w("Imagine", 0, 400), w("this.", 450, 900), w("Then", 3_000, 3_300), w("silence", 3_400, 3_900), w("again", 6_000, 6_400)];
        assert_eq!(segments_from_words(&words), vec![
            ("Imagine this.".to_string(), 0, 900),
            ("Then silence".to_string(), 3_000, 3_900), // a long pause ends a segment too
            ("again".to_string(), 6_000, 6_400),
        ]);
    }

    #[test]
    fn titles_use_the_first_sentence_and_stay_short() {
        assert_eq!(title_for("Do you have a signature dish? Our signature is how we sign."), "Do you have a signature dish?");
        assert_eq!(title_for("When temperatures drop and a cold snap comes, that means one thing."), "When temperatures drop and a cold snap comes…");
    }

    #[test]
    fn never_proposes_more_than_the_limit() {
        let segments: Vec<_> = (0..200u64).map(|i| seg("A full sentence that is long enough to count.", i * 12_000, i * 12_000 + 11_000)).collect();
        assert_eq!(propose(&segments).len(), MAX_CANDIDATES);
    }

    /// Real run on the public sample: `cargo test --lib split_a_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hardware_split_a_real_recording_into_whole_sentence_clips() {
        let bench = Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench");
        let root = crate::storage::recording::tests::TestRoot::new();
        let staged = clips::stage(&root.0, &bench.join("samples/public-62s.wav")).unwrap();
        let config: whisper::WorkerConfig = serde_json::from_slice(&fs::read(bench.join("runtime.local/config-selected.json")).unwrap()).unwrap();
        let last = std::sync::atomic::AtomicU8::new(0);
        let segments = transcribe_local(&config, &root.0, &staged.staging_id, &AtomicBool::new(false), |p| last.store(p, Ordering::Relaxed)).unwrap();
        let candidates = propose(&segments);
        for c in &candidates {
            println!("CLIP {:.1}-{:.1} s | {} | {}", c.start_ms as f64 / 1000.0, c.end_ms as f64 / 1000.0, c.title, c.text);
        }
        assert!(!candidates.is_empty());
        assert!(candidates.iter().all(|c| (8_000..=20_000).contains(&(c.end_ms - c.start_ms)) && ends_sentence(&c.text)));
        assert!(!clips::staging_dir(&root.0, &staged.staging_id).unwrap().join("speech-16k.wav").exists(), "worker copy cleaned up");
    }
}
