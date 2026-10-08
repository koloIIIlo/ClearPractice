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

/// The transcript's timed sentences, kept next to the staged audio so the AI can
/// choose passages from them later (4.4e).
pub fn save_segments(root: &Path, staging_id: &str, segments: &[(String, u64, u64)]) -> Result<()> {
    let dir = clips::staging_dir(root, staging_id)?;
    prepare::contained(root, &dir)?;
    fs::write(dir.join("segments.json"), serde_json::to_vec(segments).map_err(|e| e.to_string())?).map_err(|_| "Cannot keep the transcript.".into())
}

pub fn load_segments(root: &Path, staging_id: &str) -> Result<Vec<(String, u64, u64)>> {
    let dir = clips::staging_dir(root, staging_id)?;
    prepare::contained(root, &dir)?;
    serde_json::from_slice(&fs::read(dir.join("segments.json")).map_err(|_| "Transcribe the recording first.")?).map_err(|_| "The transcript is damaged. Transcribe again.".into())
}

/// Locally measured delivery of one sentence (4.4e, P.9). Values are Estimated;
/// `None` means not enough voiced audio to say.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceInfo {
    pub index: usize,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    /// Pitch change over the last 250 ms of voicing, in semitones.
    pub ending_semitones: Option<f32>,
    pub range_semitones: Option<f32>,
    /// Mean loudness of voiced frames relative to the whole recording's median, dB.
    pub loudness_db: Option<f32>,
    pub words_per_minute: Option<u32>,
    pub pause_before_ms: Option<u64>,
}

/// Measures every sentence from a 10 ms pitch/loudness contour of the recording.
pub fn measure_sentences(segments: &[(String, u64, u64)], f0: &[Option<f32>], rms: &[Option<f32>], hop_ms: u64) -> Vec<SentenceInfo> {
    let mut voiced_loudness: Vec<f32> = f0.iter().zip(rms).filter_map(|(f, r)| f.and(*r)).collect();
    voiced_loudness.sort_by(|a, b| a.total_cmp(b));
    let median = voiced_loudness.get(voiced_loudness.len() / 2).copied();
    segments
        .iter()
        .enumerate()
        .map(|(index, (text, start, end))| {
            let (from, to) = ((*start / hop_ms) as usize, ((*end / hop_ms) as usize).min(f0.len()));
            let frames: Vec<(usize, f32)> = (from.min(to)..to).filter_map(|i| f0[i].map(|f| (i, f))).collect();
            let semis = |hz: f32| 12.0 * hz.log2();
            let ending_semitones = (frames.len() >= 10).then(|| {
                let last = frames.last().unwrap().0;
                let tail: Vec<f32> = frames.iter().filter(|(i, _)| *i + 25 > last).map(|(_, f)| semis(*f)).collect();
                let edge = (tail.len() / 4).max(1);
                let mean = |v: &[f32]| v.iter().sum::<f32>() / v.len() as f32;
                ((mean(&tail[tail.len() - edge..]) - mean(&tail[..edge])) * 10.0).round() / 10.0
            });
            let range_semitones = (frames.len() >= 20).then(|| {
                let mut s: Vec<f32> = frames.iter().map(|(_, f)| semis(*f)).collect();
                s.sort_by(|a, b| a.total_cmp(b));
                let p = |q: f32| s[((s.len() - 1) as f32 * q).round() as usize];
                ((p(0.95) - p(0.05)) * 10.0).round() / 10.0
            });
            let loud: Vec<f32> = frames.iter().filter_map(|(i, _)| rms.get(*i).copied().flatten()).collect();
            let loudness_db = median.filter(|_| !loud.is_empty()).map(|m| ((loud.iter().sum::<f32>() / loud.len() as f32 - m) * 10.0).round() / 10.0);
            let words = text.split_whitespace().count() as u64;
            let words_per_minute = (*end > *start + 1_000 && words >= 3).then(|| (words * 60_000 / (*end - *start)) as u32);
            let pause_before_ms = index.checked_sub(1).map(|p| start.saturating_sub(segments[p].2));
            SentenceInfo { index: index + 1, start_ms: *start, end_ms: *end, text: text.clone(), ending_semitones, range_semitones, loudness_db, words_per_minute, pause_before_ms }
        })
        .collect()
}

fn clock(ms: u64) -> String {
    format!("{}:{:04.1}", ms / 60_000, (ms % 60_000) as f64 / 1000.0)
}

/// The annotated transcript sent to the AI: one line per sentence with its
/// measured delivery (text only; never audio).
pub fn annotated_transcript(sentences: &[SentenceInfo]) -> String {
    sentences
        .iter()
        .map(|s| {
            let mut parts = vec![format!("[{}] {}–{} \"{}\"", s.index, clock(s.start_ms), clock(s.end_ms), s.text.trim())];
            if let Some(e) = s.ending_semitones {
                let dir = if e >= 1.5 { "rising" } else if e <= -1.5 { "falling" } else { "level" };
                parts.push(format!("ending {dir} {e:+.1} st"));
            }
            if let Some(r) = s.range_semitones {
                parts.push(format!("pitch range {r:.1} st"));
            }
            if let Some(l) = s.loudness_db {
                parts.push(if l >= 10.0 { format!("raised voice {l:+.0} dB") } else { format!("loudness {l:+.0} dB") });
            }
            if let Some(w) = s.words_per_minute {
                parts.push(format!("{w} wpm"));
            }
            if let Some(p) = s.pause_before_ms.filter(|p| *p >= 300) {
                parts.push(format!("pause before {:.1} s", p as f64 / 1000.0));
            }
            parts.join(" | ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Measures the staged recording's sentences from its own audio.
pub fn annotate_staged(root: &Path, staging_id: &str) -> Result<(Vec<SentenceInfo>, String)> {
    let segments = load_segments(root, staging_id)?;
    let (path, _) = resample_staged(root, staging_id, &AtomicBool::new(false))?;
    let bytes = fs::read(&path).map_err(|_| "The prepared audio is unavailable.")?;
    let _ = fs::remove_file(&path);
    let samples: Vec<f32> = bytes.get(44..).unwrap_or(&[]).chunks_exact(2).map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0).collect();
    let contour = crate::prosody::contour(&samples, prepare::RATE);
    let sentences = measure_sentences(&segments, &contour.f0_hz, &contour.rms_db, contour.hop_ms);
    let text = annotated_transcript(&sentences);
    Ok((sentences, text))
}

/// A passage chosen by the AI, turned into a clip proposal with its suggestions.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickedClip {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub title: String,
    pub description: String,
    pub feature: String,
    pub reason: String,
}

/// Converts AI picks (sentence ranges) to clips: 5–30 s, no overlaps, whole sentences.
pub fn picks_to_clips(segments: &[(String, u64, u64)], picks: &[crate::api::coaching::ClipPick]) -> Vec<PickedClip> {
    let mut out: Vec<PickedClip> = Vec::new();
    let mut sorted: Vec<&crate::api::coaching::ClipPick> = picks.iter().collect();
    sorted.sort_by_key(|p| p.first);
    for p in sorted {
        let (first, last) = (p.first as usize - 1, p.last as usize - 1);
        let Some(range) = segments.get(first..=last) else { continue };
        let (start, end) = (range[0].1, range[range.len() - 1].2);
        if end <= start || !(5_000..=30_000).contains(&(end - start)) || out.last().is_some_and(|prev| start < prev.end_ms) {
            continue;
        }
        out.push(PickedClip {
            start_ms: start,
            end_ms: end,
            text: range.iter().map(|s| s.0.trim()).collect::<Vec<_>>().join(" "),
            title: p.title.clone(),
            description: p.description.trim().into(),
            feature: p.feature.clone(),
            reason: p.reason.trim().into(),
        });
    }
    out
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
    fn measures_each_sentence_and_writes_an_annotated_line() {
        // 10 ms frames: sentence 1 glides down an octave-ish fifth, sentence 2 rises and is louder.
        let mut f0 = Vec::new();
        let mut rms = Vec::new();
        for i in 0..200 {
            f0.push(Some(200.0 * (2f32).powf(-(i as f32) / 200.0 * 0.5))); // 200 → ~141 Hz
            rms.push(Some(-20.0));
        }
        for _ in 0..50 { f0.push(None); rms.push(Some(-60.0)); } // 0.5 s pause
        for i in 0..150 {
            f0.push(Some(150.0 * (2f32).powf(i as f32 / 150.0 * 0.5)));
            rms.push(Some(-8.0));
        }
        let segments = vec![seg("We start here and go down.", 0, 2_000), seg("Is that right?", 2_500, 4_000)];
        let s = measure_sentences(&segments, &f0, &rms, 10);
        assert!(s[0].ending_semitones.unwrap() < 0.0 && s[1].ending_semitones.unwrap() > 0.0, "{s:?}");
        assert_eq!(s[1].pause_before_ms, Some(500));
        assert!(s[1].loudness_db.unwrap() > 5.0, "louder than the median");
        let text = annotated_transcript(&s);
        assert!(text.starts_with("[1] 0:00.0–0:02.0 \"We start here and go down.\""), "{text}");
        assert!(text.contains("pause before 0.5 s"));
        assert!(text.lines().count() == 2);
    }

    #[test]
    fn ai_picks_become_whole_sentence_clips_without_overlaps_or_bad_lengths() {
        use crate::api::coaching::ClipPick;
        let segments: Vec<_> = (0..6u64).map(|i| seg(&format!("Sentence {i}."), i * 6_000, i * 6_000 + 5_500)).collect();
        let pick = |first, last, title: &str| ClipPick { first, last, title: title.into(), description: "d".into(), feature: "rhythm".into(), reason: "r".into() };
        let clips = picks_to_clips(&segments, &[pick(3, 4, "Second"), pick(1, 2, "First"), pick(2, 3, "Overlaps"), pick(5, 5, "Five s ok"), pick(6, 6, "")]);
        assert_eq!(clips.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["First", "Second", "Five s ok", ""]);
        assert_eq!((clips[0].start_ms, clips[0].end_ms), (0, 11_500));
        assert_eq!(clips[0].text, "Sentence 0. Sentence 1.");
        assert!(picks_to_clips(&segments, &[pick(1, 6, "Too long")]).is_empty(), "35 s is too long");
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
