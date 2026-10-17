//! Pitch and loudness contours (milestone P: P.1, P.2, P.8). YIN (de Cheveigné
//! & Kawahara, 2002) in plain Rust: difference function, cumulative mean
//! normalised difference, absolute threshold, parabolic interpolation. Frames
//! are on the original timeline at a 10 ms hop; unvoiced or silent frames carry
//! `None`, never zero (§11: no prosody value is a score). All values Estimated.
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex,
};

pub const HOP_MS: u64 = 10;
const WINDOW_MS: u64 = 40;
/// Speaking voices: 60–500 Hz covers low and high adult voices.
const MIN_F0: f64 = 60.0;
const MAX_F0: f64 = 500.0;
const YIN_THRESHOLD: f64 = 0.15;
/// Frames quieter than this (dBFS RMS) are treated as silence.
const SILENCE_DB: f64 = -50.0;
/// Samples at or above this magnitude count as clipped; more than 0.1% of the
/// take clipped makes ranges unreliable.
const CLIP_LEVEL: f32 = 0.97;
const CLIP_SHARE: f64 = 0.001;
/// Voiced loudness less than this far above the quiet unvoiced frames (the
/// room) means the noise is too close to the voice for reliable ranges.
const MIN_SNR_DB: f32 = 10.0;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Contour {
    pub algorithm: &'static str,
    pub source: &'static str,
    pub hop_ms: u64,
    pub sample_rate: u32,
    /// F0 in Hz per frame; `None` when unvoiced or silent.
    pub f0_hz: Vec<Option<f32>>,
    /// RMS loudness per frame in dBFS; `None` for digital silence.
    pub rms_db: Vec<Option<f32>>,
    pub median_f0_hz: Option<f32>,
    /// 5th–95th percentile pitch range in semitones; `None` with too little voicing.
    pub range_semitones: Option<f32>,
    /// Spread of loudness over voiced frames: 5th–95th percentile in dB (P.3).
    pub loudness_range_db: Option<f32>,
    pub unavailable_reason: Option<String>,
}

/// YIN estimate for one frame, or `None` when no clear period is found.
pub fn yin(frame: &[f32], sample_rate: u32) -> Option<f64> {
    yin_with(frame, sample_rate, YIN_THRESHOLD)
}

/// YIN with another absolute threshold: the speech-rate voicing check (8.8)
/// accepts a less clear period than the intonation contour does.
pub fn yin_with(frame: &[f32], sample_rate: u32, threshold: f64) -> Option<f64> {
    let rate = f64::from(sample_rate);
    let min_lag = (rate / MAX_F0).floor() as usize;
    let max_lag = ((rate / MIN_F0).ceil() as usize).min(frame.len() / 2);
    if max_lag <= min_lag + 2 {
        return None;
    }
    let width = frame.len() - max_lag;
    // d(τ) and its cumulative mean normalised form d'(τ), computed lag by lag and
    // stopped once the first dip below the threshold has bottomed out: voiced
    // frames rarely need the long lags, which halves the work.
    let difference = |lag: usize| -> f64 {
        let (a, b) = (&frame[..width], &frame[lag..lag + width]);
        f64::from(a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f32>())
    };
    let mut cmnd = vec![1.0f64; max_lag + 2];
    let mut running = 0.0f64;
    let mut found: Option<usize> = None;
    for lag in 1..=max_lag {
        let sum = difference(lag);
        running += sum;
        cmnd[lag] = if running > 0.0 { sum * lag as f64 / running } else { 1.0 };
        match found {
            None if lag >= min_lag.max(2) && cmnd[lag] < threshold => found = Some(lag),
            Some(best) if cmnd[lag] < cmnd[best] => found = Some(lag),
            Some(_) => break,
            None => {}
        }
    }
    let mut lag = found?;
    if lag >= max_lag {
        return None;
    }
    if cmnd[lag + 1] == 1.0 && lag + 1 <= max_lag {
        let sum = difference(lag + 1);
        cmnd[lag + 1] = if running + sum > 0.0 { sum * (lag + 1) as f64 / (running + sum) } else { 1.0 };
    }
    lag = lag.max(1);
    // Parabolic interpolation around the minimum for sub-sample precision.
    let (a, b, c) = (cmnd[lag - 1], cmnd[lag], cmnd[lag + 1]);
    let denominator = a - 2.0 * b + c;
    let offset = if denominator.abs() > f64::EPSILON { 0.5 * (a - c) / denominator } else { 0.0 };
    let period = lag as f64 + offset.clamp(-1.0, 1.0);
    let f0 = rate / period;
    (MIN_F0..=MAX_F0).contains(&f0).then_some(f0)
}

fn percentile(sorted: &[f32], p: f64) -> f32 {
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

/// Contour for mono samples in −1..1 on the original timeline.
pub fn contour(samples: &[f32], sample_rate: u32) -> Contour {
    contour_with(samples, sample_rate, &AtomicBool::new(false), |_, _| {}).unwrap_or_else(|reason| unavailable(sample_rate, &reason))
}

fn unavailable(sample_rate: u32, reason: &str) -> Contour {
    Contour { algorithm: "yin-v1", source: "Estimated", hop_ms: HOP_MS, sample_rate, f0_hz: vec![], rms_db: vec![], median_f0_hz: None, range_semitones: None, loudness_range_db: None, unavailable_reason: Some(reason.into()) }
}

/// Frames analysed per unit of parallel work (10 s of audio).
const CHUNK_FRAMES: usize = 1_000;

/// Same contour as [`contour`], computed on several cores for long recordings
/// (imported sources run to 15 minutes). Frames are independent, so the result
/// is identical. `progress` gets (frames done, frames total); `cancel` stops it.
pub fn contour_with(samples: &[f32], sample_rate: u32, cancel: &AtomicBool, progress: impl Fn(usize, usize) + Sync) -> Result<Contour, String> {
    let hop = (u64::from(sample_rate) * HOP_MS / 1000) as usize;
    let window = (u64::from(sample_rate) * WINDOW_MS / 1000) as usize;
    if hop == 0 || window == 0 {
        return Ok(unavailable(sample_rate, "Invalid sample rate."));
    }
    let total = samples.len().div_ceil(hop);
    let frame = |index: usize| -> (Option<f32>, Option<f32>) {
        let start = index * hop;
        let end = (start + window).min(samples.len());
        let frame = &samples[start..end];
        let energy = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / frame.len().max(1) as f64;
        let db = (energy > 0.0).then(|| 10.0 * energy.log10());
        let voiced = db.is_some_and(|d| d > SILENCE_DB) && frame.len() == window;
        (if voiced { yin(frame, sample_rate).map(|v| v as f32) } else { None }, db.map(|d| d as f32))
    };
    let chunks = total.div_ceil(CHUNK_FRAMES);
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, 8).min(chunks.max(1));
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results: Vec<Mutex<Vec<(Option<f32>, Option<f32>)>>> = (0..chunks).map(|_| Mutex::new(Vec::new())).collect();
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let chunk = next.fetch_add(1, Ordering::Relaxed);
                if chunk >= chunks || cancel.load(Ordering::Relaxed) {
                    break;
                }
                let range = chunk * CHUNK_FRAMES..((chunk + 1) * CHUNK_FRAMES).min(total);
                let count = range.len();
                let out: Vec<_> = range.map(frame).collect();
                if let Ok(mut slot) = results[chunk].lock() {
                    *slot = out;
                }
                progress(done.fetch_add(count, Ordering::Relaxed) + count, total);
            });
        }
    });
    if cancel.load(Ordering::Relaxed) {
        return Err("Stopped.".into());
    }
    let mut f0 = Vec::with_capacity(total);
    let mut rms = Vec::with_capacity(total);
    for slot in results {
        for (pitch, db) in slot.into_inner().map_err(|_| "Pitch analysis failed.")? {
            f0.push(pitch);
            rms.push(db);
        }
    }
    if f0.len() != total {
        return Err("Pitch analysis failed.".into());
    }
    let mut voiced: Vec<f32> = f0.iter().flatten().copied().collect();
    voiced.sort_by(|a, b| a.total_cmp(b));
    let enough = voiced.len() >= 50; // at least half a second of voicing
    let median = enough.then(|| percentile(&voiced, 0.5));
    let range = enough.then(|| 12.0 * (percentile(&voiced, 0.95) / percentile(&voiced, 0.05)).log2());
    let mut loud: Vec<f32> = f0.iter().zip(&rms).filter_map(|(f, r)| f.and(*r)).collect();
    loud.sort_by(|a, b| a.total_cmp(b));
    let clipped = samples.iter().filter(|s| s.abs() >= CLIP_LEVEL).count() as f64 > CLIP_SHARE * samples.len() as f64;
    // Noise floor: the quieter unvoiced frames (pauses), when there are at least 0.2 s of them.
    let mut quiet: Vec<f32> = f0.iter().zip(&rms).filter_map(|(f, r)| if f.is_none() { *r } else { None }).collect();
    quiet.sort_by(|a, b| a.total_cmp(b));
    let noisy = enough && quiet.len() >= 20 && percentile(&loud, 0.5) - percentile(&quiet, 0.2) < MIN_SNR_DB;
    let reason = if !enough {
        Some("Too little voiced speech for a pitch range.")
    } else if clipped {
        Some("The recording is clipped (too loud for the microphone), so pitch and loudness ranges are not reliable.")
    } else if noisy {
        Some("Background noise is too close to your voice level, so pitch and loudness ranges are not reliable.")
    } else {
        None
    };
    let reliable = reason.is_none();
    let range = range.filter(|_| reliable);
    let loudness = (enough && reliable).then(|| percentile(&loud, 0.95) - percentile(&loud, 0.05));
    Ok(Contour {
        algorithm: "yin-v1",
        source: "Estimated",
        hop_ms: HOP_MS,
        sample_rate,
        f0_hz: f0,
        rms_db: rms,
        median_f0_hz: median,
        range_semitones: range,
        loudness_range_db: loudness,
        unavailable_reason: reason.map(str::to_string),
    })
}

/// Analysis definition stored with every track (P.3); bump when frames would change.
pub const ALGORITHM: &str = "yin-v1";
pub const DEFINITION_VERSION: i64 = 1;

/// Settings recorded with each stored track, so a result can be traced to them.
/// One syllable nucleus of an emphasis take (10.6), scored against the take.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Nucleus {
    pub t_ms: u64,
    pub db: f32,
    /// Pitch in semitones above 100 Hz; `None` when no clear period was found.
    pub f0_st: Option<f32>,
    pub voiced_ms: u32,
    pub prominence: f32,
}

/// Which word carried the strongest beat (10.6), Estimated.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prominence {
    pub nuclei: Vec<Nucleus>,
    pub expected_syllables: u32,
    pub peak_word: Option<usize>,
    /// False when the nuclei found differ from the expected syllables by more than a quarter.
    pub aligned: bool,
    pub unavailable_reason: Option<String>,
}

/// A rough syllable count: vowel groups (y included), minus a silent final
/// "e", "ed" or "es", plus one for a syllabic "n't" ("didn't"); at least 1.
pub fn syllable_estimate(word: &str) -> u32 {
    let w: String = word.to_lowercase().chars().filter(|c| c.is_ascii_alphabetic() || *c == '\'').collect();
    let letters: Vec<char> = w.chars().filter(char::is_ascii_alphabetic).collect();
    let vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
    let mut count = 0u32;
    let mut previous = false;
    for &c in &letters {
        let v = vowel(c);
        if v && !previous {
            count += 1;
        }
        previous = v;
    }
    let n = letters.len();
    let before = |k: usize| n.checked_sub(k).and_then(|i| letters.get(i)).copied();
    if count > 1 {
        // "table" keeps its "-le" syllable; "stole" and "make" don't.
        let syllabic_le = w.ends_with("le") && before(3).is_some_and(|c| !vowel(c));
        let silent_e = w.ends_with('e') && !w.ends_with("ee") && !syllabic_le && before(2).is_some_and(|c| !vowel(c));
        let silent_ed = w.ends_with("ed") && n > 3 && before(3).is_some_and(|c| !matches!(c, 't' | 'd') && !vowel(c));
        let silent_es = w.ends_with("es") && n > 3 && before(3).is_some_and(|c| !matches!(c, 's' | 'x' | 'z' | 'c' | 'g' | 'h') && !vowel(c));
        if silent_e || silent_ed || silent_es {
            count -= 1;
        }
    }
    if w.ends_with("n't") && before(3).is_some_and(|c| !vowel(c)) {
        count += 1;
    }
    count.max(1)
}

fn z_scores(values: &[f32]) -> Vec<f32> {
    let n = values.len() as f32;
    let mean = values.iter().sum::<f32>() / n;
    let sd = (values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n).sqrt();
    values.iter().map(|v| if sd > 1e-6 { (v - mean) / sd } else { 0.0 }).collect()
}

/// The emphasis game's analysis (10.6). Each nucleus is scored relative to
/// this take: z(loudness) + z(pitch) + 0.5·z(length). The strongest one is
/// mapped to a word by spreading each word's estimated syllables over the
/// nuclei in order. With too few nuclei, or a count far from the sentence's,
/// nothing is claimed.
pub fn prominence(samples: &[f32], sample_rate: u32, words: &[&str]) -> Prominence {
    let expected: u32 = words.iter().map(|w| syllable_estimate(w)).sum();
    let found = crate::audio::syllables::nuclei_detail(samples, sample_rate);
    let half = (sample_rate * WINDOW_MS as u32 / 2000) as usize;
    let pitch: Vec<Option<f32>> = found
        .iter()
        .map(|n| {
            let (from, to) = (n.center.checked_sub(half)?, n.center + half);
            let hz = yin_with(samples.get(from..to)?, sample_rate, 0.35)?;
            Some((12.0 * (hz / 100.0).log2()) as f32)
        })
        .collect();
    let mut voiced_pitch: Vec<f32> = pitch.iter().flatten().copied().collect();
    voiced_pitch.sort_by(f32::total_cmp);
    let median = voiced_pitch.get(voiced_pitch.len() / 2).copied().unwrap_or(0.0);
    let loud = z_scores(&found.iter().map(|n| n.db).collect::<Vec<_>>());
    let high = z_scores(&pitch.iter().map(|p| p.unwrap_or(median)).collect::<Vec<_>>());
    let long = z_scores(&found.iter().map(|n| n.voiced_ms as f32).collect::<Vec<_>>());
    let nuclei: Vec<Nucleus> = found
        .iter()
        .enumerate()
        .map(|(k, n)| Nucleus { t_ms: n.t_ms, db: n.db, f0_st: pitch[k], voiced_ms: n.voiced_ms, prominence: loud[k] + high[k] + 0.5 * long[k] })
        .collect();
    if nuclei.len() < 2 || expected == 0 {
        return Prominence { nuclei, expected_syllables: expected, peak_word: None, aligned: false, unavailable_reason: Some("Too few beats were found in the recording.".into()) };
    }
    let aligned = (nuclei.len() as f32 - expected as f32).abs() / expected as f32 <= 0.25;
    let strongest = nuclei.iter().enumerate().max_by(|a, b| a.1.prominence.total_cmp(&b.1.prominence)).map(|(k, _)| k).unwrap_or(0);
    // The nucleus's position on the sentence's syllable scale, then the word that covers it.
    let position = (strongest as f32 + 0.5) * expected as f32 / nuclei.len() as f32;
    let mut covered = 0.0f32;
    let peak_word = words.iter().position(|w| {
        covered += syllable_estimate(w) as f32;
        position < covered
    });
    Prominence { nuclei, expected_syllables: expected, peak_word: if aligned { peak_word } else { None }, aligned, unavailable_reason: None }
}

pub fn settings() -> String {
    format!(r#"{{"hopMs":{HOP_MS},"windowMs":{WINDOW_MS},"minF0Hz":{MIN_F0},"maxF0Hz":{MAX_F0},"yinThreshold":{YIN_THRESHOLD},"silenceDb":{SILENCE_DB}}}"#)
}

/// A take's prepared 16 kHz mono audio (original timeline) as samples, shared
/// with the speech-rate estimate (8.8).
pub fn prepared_samples(root: &std::path::Path, asset_id: &str) -> Result<(Vec<f32>, u32), String> {
    use crate::audio::prepare;
    let audio = prepare::prepare(root, asset_id, &std::sync::atomic::AtomicBool::new(false))?;
    let bytes = std::fs::read(prepare::prepared_path(root, &audio)?).map_err(|_| "The prepared audio is unavailable.")?;
    let samples: Vec<f32> = bytes
        .get(44..)
        .ok_or("The prepared audio is damaged.")?
        .chunks_exact(2)
        .map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0)
        .collect();
    Ok((samples, audio.sample_rate))
}

/// Runs the contour on a take's prepared 16 kHz audio (original timeline). Frames
/// are returned at their stored precision, so a fresh result equals a stored one.
pub fn compute(root: &std::path::Path, asset_id: &str) -> Result<Contour, String> {
    let (samples, sample_rate) = prepared_samples(root, asset_id)?;
    let mut contour = contour(&samples, sample_rate);
    let (f0, rms) = decode_frames(&encode_frames(&contour))?;
    contour.f0_hz = f0;
    contour.rms_db = rms;
    Ok(contour)
}

const MAGIC: &[u8; 4] = b"CPPT";
const FORMAT: u16 = 1;
const NO_RMS: i16 = i16::MIN;

/// Compact frame artifact: `CPPT`, format u16, hop u16, rate u32, count u32, then
/// per frame F0 in 0.1 Hz as u16 (0 = unvoiced) and RMS in 0.01 dB as i16
/// (`i16::MIN` = silence). Little-endian. About 4 bytes per 10 ms.
pub fn encode_frames(c: &Contour) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 + c.f0_hz.len() * 4);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT.to_le_bytes());
    out.extend_from_slice(&(c.hop_ms.min(u64::from(u16::MAX)) as u16).to_le_bytes());
    out.extend_from_slice(&c.sample_rate.to_le_bytes());
    out.extend_from_slice(&(c.f0_hz.len() as u32).to_le_bytes());
    for (f0, rms) in c.f0_hz.iter().zip(c.rms_db.iter().chain(std::iter::repeat(&None))) {
        let f0 = f0.map_or(0, |hz| (hz * 10.0).round().clamp(1.0, f32::from(u16::MAX)) as u16);
        let rms = rms.map_or(NO_RMS, |db| (db * 100.0).round().clamp(f32::from(NO_RMS + 1), f32::from(i16::MAX)) as i16);
        out.extend_from_slice(&f0.to_le_bytes());
        out.extend_from_slice(&rms.to_le_bytes());
    }
    out
}

type Frames = (Vec<Option<f32>>, Vec<Option<f32>>);

pub fn decode_frames(bytes: &[u8]) -> Result<Frames, String> {
    let damaged = || "The stored intonation track is damaged.".to_string();
    if bytes.len() < 16 || &bytes[..4] != MAGIC || u16::from_le_bytes([bytes[4], bytes[5]]) != FORMAT {
        return Err(damaged());
    }
    let count = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
    let body = &bytes[16..];
    if body.len() != count.checked_mul(4).ok_or_else(damaged)? {
        return Err(damaged());
    }
    let mut f0 = Vec::with_capacity(count);
    let mut rms = Vec::with_capacity(count);
    for frame in body.chunks_exact(4) {
        let hz = u16::from_le_bytes([frame[0], frame[1]]);
        let db = i16::from_le_bytes([frame[2], frame[3]]);
        f0.push((hz != 0).then(|| f32::from(hz) / 10.0));
        rms.push((db != NO_RMS).then(|| f32::from(db) / 100.0));
    }
    Ok((f0, rms))
}

/// Header fields of a stored artifact: (hop_ms, sample_rate).
pub fn artifact_timing(bytes: &[u8]) -> Option<(u64, u32)> {
    (bytes.len() >= 16).then(|| (u64::from(u16::from_le_bytes([bytes[6], bytes[7]])), u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    const RATE: u32 = 16_000;

    /// Six syllable-like bursts of a 150 Hz voice with silence between them;
    /// `strong` is 6 dB louder, a semitone higher and half as long again.
    fn bursts(strong: Option<usize>, count: usize) -> Vec<f32> {
        let rate = f64::from(RATE);
        let silence = |ms: f64| vec![0.0f32; (ms / 1000.0 * rate) as usize];
        let mut out = silence(200.0);
        for k in 0..count {
            let loud = strong == Some(k);
            let (f0, gain, ms) = if loud { (150.0 * 2f64.powf(1.0 / 12.0), 0.3, 300.0) } else { (150.0, 0.15, 200.0) };
            let n = (ms / 1000.0 * rate) as usize;
            let mut phase = 0.0f64;
            for i in 0..n {
                // A short fade in and out, like a syllable's onset and release.
                let edge = ((i.min(n - i) as f64) / (0.02 * rate)).min(1.0);
                phase += TAU * f0 / rate;
                let s: f64 = (1..=6).map(|h| (phase * h as f64).sin() / h as f64).sum();
                out.push((gain * edge * s) as f32);
            }
            out.extend(silence(250.0));
        }
        out
    }

    #[test]
    fn prominence_picks_the_louder_higher_longer_syllable_in_synthetic_audio() {
        let words = ["one", "two", "three", "four", "five", "six"];
        let p = prominence(&bursts(Some(3), 6), RATE, &words);
        assert_eq!((p.nuclei.len(), p.expected_syllables, p.aligned), (6, 6, true), "{p:?}");
        assert_eq!(p.peak_word, Some(3));
        assert!(p.nuclei[3].f0_st.zip(p.nuclei[0].f0_st).is_some_and(|(high, low)| high - low > 0.5), "{p:?}");
        // The same audio with the stress elsewhere moves the peak.
        assert_eq!(prominence(&bursts(Some(1), 6), RATE, &words).peak_word, Some(1));
    }

    #[test]
    fn unaligned_when_nuclei_differ_by_more_than_a_quarter() {
        // Six beats for a sentence of twelve estimated syllables: nothing is claimed.
        let words = ["seventeen", "elephants", "remember", "tomorrow"];
        let p = prominence(&bursts(Some(2), 6), RATE, &words);
        assert_eq!(p.expected_syllables, 12);
        assert!(!p.aligned && p.peak_word.is_none());
        assert!(prominence(&[0.0; 16_000], RATE, &words).unavailable_reason.is_some(), "silence has no beats");
    }

    #[test]
    fn syllable_estimate_handles_silent_e_and_diphthongs() {
        let counts: Vec<u32> = ["make", "money", "stole", "didn't", "table", "played", "wanted", "boxes", "don't"].iter().map(|w| syllable_estimate(w)).collect();
        assert_eq!(counts, [1, 2, 1, 2, 2, 1, 2, 2, 1]);
    }

    /// A voice-like tone: fundamental plus decaying harmonics, so octave errors
    /// (the classic failure of autocorrelation trackers) would show up.
    fn voice(f0: impl Fn(f64) -> f64, seconds: f64) -> Vec<f32> {
        let n = (seconds * f64::from(RATE)) as usize;
        let mut phase = 0.0f64;
        (0..n)
            .map(|i| {
                let t = i as f64 / f64::from(RATE);
                phase += TAU * f0(t) / f64::from(RATE);
                let s: f64 = (1..=6).map(|h| (phase * h as f64).sin() / h as f64).sum();
                (0.3 * s) as f32
            })
            .collect()
    }

    #[test]
    fn steady_low_and_high_voices_are_tracked_without_octave_errors() {
        for target in [85.0, 120.0, 220.0, 380.0] {
            let c = contour(&voice(|_| target, 1.0), RATE);
            let voiced: Vec<f32> = c.f0_hz.iter().flatten().copied().collect();
            assert!(voiced.len() > 80, "{target} Hz: only {} voiced frames", voiced.len());
            for f in &voiced {
                let error = (f64::from(*f) / target).log2().abs() * 12.0;
                assert!(error < 0.5, "{target} Hz tracked as {f} Hz ({error:.2} semitones off)");
            }
            assert!(c.range_semitones.unwrap() < 0.5, "steady tone has almost no range");
            assert!(c.loudness_range_db.unwrap() < 1.0, "steady tone has steady loudness");
        }
    }

    #[test]
    fn long_recordings_are_measured_in_parallel_with_the_same_frames_progress_and_stop() {
        // 25 s spans three work chunks; the last chunk is partial.
        let mut samples = voice(|t| 120.0 + 40.0 * (t * 0.7).sin(), 25.0);
        for s in &mut samples[160_000..176_000] {
            *s = 0.0; // a silent second in the middle
        }
        let hop = (RATE as u64 * HOP_MS / 1000) as usize;
        let window = (RATE as u64 * WINDOW_MS / 1000) as usize;
        let reference: Vec<Option<f32>> = (0..samples.len().div_ceil(hop))
            .map(|i| {
                let frame = &samples[i * hop..(i * hop + window).min(samples.len())];
                let energy = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / frame.len() as f64;
                let loud = energy > 0.0 && 10.0 * energy.log10() > SILENCE_DB && frame.len() == window;
                if loud { yin(frame, RATE).map(|v| v as f32) } else { None }
            })
            .collect();
        let seen = Mutex::new(Vec::new());
        let c = contour_with(&samples, RATE, &AtomicBool::new(false), |done, total| seen.lock().unwrap().push((done, total))).unwrap();
        assert_eq!(c.f0_hz, reference);
        assert_eq!(c.f0_hz.len(), c.rms_db.len());
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.len(), 3);
        assert!(seen.iter().any(|(done, total)| done == total), "{seen:?}");
        assert!(contour_with(&samples, RATE, &AtomicBool::new(true), |_, _| {}).is_err(), "a stopped analysis returns nothing");
    }

    #[test]
    fn halving_the_amplitude_shows_about_six_db_of_loudness_range() {
        let mut samples = voice(|_| 150.0, 1.0);
        let half = samples.len() / 2;
        for s in &mut samples[half..] {
            *s *= 0.5;
        }
        let c = contour(&samples, RATE);
        let range = c.loudness_range_db.unwrap();
        assert!((5.0..7.0).contains(&range), "{range} dB");
    }

    #[test]
    fn a_rising_sweep_rises_and_silence_is_a_gap_not_zero() {
        // 1 s glide from 110 to 220 Hz (one octave = 12 semitones), then 0.5 s silence.
        let mut samples = voice(|t| 110.0 * 2f64.powf(t), 1.0);
        samples.extend(vec![0.0; RATE as usize / 2]);
        let c = contour(&samples, RATE);
        let first = c.f0_hz[10].unwrap();
        let last = c.f0_hz[90].unwrap();
        assert!(first < 130.0 && last > 190.0, "glide {first} → {last}");
        let range = c.range_semitones.unwrap();
        assert!((9.0..13.0).contains(&range), "about an octave, got {range}");
        assert!(c.f0_hz[120..].iter().all(Option::is_none), "silence is unvoiced");
        assert!(c.rms_db[130].is_none(), "digital silence has no loudness value, never 0");
        assert_eq!(c.hop_ms, 10);
        assert_eq!(c.f0_hz.len(), 150, "one frame per 10 ms on the original timeline");
    }

    /// Gate P (Praat comparison): writes the YIN contour of each 16 kHz mono
    /// PCM WAV in `CP_PITCH_FILES` (separated by `;`) to `CP_PITCH_OUT/<name>.csv`
    /// as frame-centre time and F0 (empty when unvoiced). Run on request:
    /// `cargo test --release --lib praat_comparison_dump -- --ignored`.
    #[test]
    #[ignore]
    fn praat_comparison_dump() {
        let (Ok(files), Ok(out)) = (std::env::var("CP_PITCH_FILES"), std::env::var("CP_PITCH_OUT")) else { return };
        for file in files.split(';').filter(|f| !f.is_empty()) {
            let path = std::path::Path::new(file);
            let bytes = std::fs::read(path).unwrap();
            let data = bytes.windows(4).position(|w| w == b"data").expect("data chunk") + 8;
            let samples: Vec<f32> = bytes[data..].chunks_exact(2).map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0).collect();
            let c = contour(&samples, RATE);
            let half = (WINDOW_MS / 2) as f64 / 1000.0;
            let rows: String = c.f0_hz.iter().enumerate()
                .map(|(i, f)| format!("{:.3},{}
", i as f64 * c.hop_ms as f64 / 1000.0 + half, f.map_or(String::new(), |v| format!("{v:.2}"))))
                .collect();
            let name = path.file_stem().unwrap().to_string_lossy();
            std::fs::write(std::path::Path::new(&out).join(format!("{name}.csv")), format!("time_s,f0_hz
{rows}")).unwrap();
        }
    }

    /// Real speech, optimised build only: `cargo test --release --lib prosody -- --ignored --nocapture`
    /// (P.8 target: ≤ 5 s per 60 s take; debug builds are many times slower).
    #[test]
    #[ignore]
    fn hardware_contour_of_the_public_sample_is_fast_and_plausible() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench/samples/public-62s.wav");
        let bytes = std::fs::read(path).unwrap();
        let samples: Vec<f32> = bytes[44..].chunks_exact(2).map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0).collect();
        let started = std::time::Instant::now();
        let c = contour(&samples, RATE);
        let elapsed = started.elapsed();
        let voiced = c.f0_hz.iter().flatten().count() as f64 / c.f0_hz.len() as f64;
        println!("PROSODY: {:.2} s for {:.1} s audio, voiced {:.0}%, median {:?} Hz, range {:?} st, loudness {:?} dB, reason {:?}", elapsed.as_secs_f64(), samples.len() as f64 / 16_000.0, voiced * 100.0, c.median_f0_hz, c.range_semitones, c.loudness_range_db, c.unavailable_reason);
        assert!(elapsed.as_secs_f64() <= 5.0, "P.8 CPU target");
        assert!((0.2..0.9).contains(&voiced), "speech is partly voiced");
        assert!((70.0..300.0).contains(&c.median_f0_hz.unwrap()));
        assert_eq!(c.unavailable_reason, None, "clean speech is neither clipped nor noisy");
        // P.1: how often YIN and McLeod agree on real speech (same frames, same gating).
        let hop = 160;
        let window = 640;
        let (mut both, mut agree, mut only_yin, mut only_mpm, mut frames) = (0, 0, 0, 0, 0);
        let mut start = 0;
        while start + window <= samples.len() {
            let frame = &samples[start..start + window];
            frames += 1;
            match (yin(frame, RATE), mpm(frame, RATE)) {
                (Some(a), Some(b)) => { both += 1; if (a / b).log2().abs() * 12.0 <= 1.0 { agree += 1; } }
                (Some(_), None) => only_yin += 1,
                (None, Some(_)) => only_mpm += 1,
                _ => {}
            }
            start += hop;
        }
        println!("P1 REAL: {frames} frames; both voiced {both}, agree within 1 st {agree} ({:.1}%); only YIN {only_yin}; only MPM {only_mpm}", agree as f64 * 100.0 / both.max(1) as f64);
    }

    #[test]
    fn noise_and_short_takes_report_why_values_are_missing() {
        let mut seed = 1u32;
        let noise: Vec<f32> = (0..RATE)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.4
            })
            .collect();
        let c = contour(&noise, RATE);
        let voiced = c.f0_hz.iter().flatten().count();
        assert!(voiced < 10, "white noise should be mostly unvoiced, got {voiced}");
        assert!(c.range_semitones.is_none() && c.loudness_range_db.is_none() && c.unavailable_reason.is_some());
        assert!(contour(&voice(|_| 150.0, 0.2), RATE).unavailable_reason.is_some());
    }

    fn noise(amplitude: f32, seconds: f64, seed: &mut u32) -> Vec<f32> {
        (0..(seconds * f64::from(RATE)) as usize)
            .map(|_| {
                *seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (*seed as f32 / u32::MAX as f32 - 0.5) * amplitude
            })
            .collect()
    }

    #[test]
    fn clipping_and_heavy_noise_leave_ranges_unavailable_with_a_reason() {
        let mut seed = 7u32;
        // Clean voice, then a quiet room pause: ranges available.
        let mut clean = voice(|_| 150.0, 1.0);
        clean.extend(noise(0.01, 0.5, &mut seed));
        let c = contour(&clean, RATE);
        assert!(c.unavailable_reason.is_none() && c.range_semitones.is_some(), "{:?}", c.unavailable_reason);

        // The same voice driven into the rails.
        let clipped: Vec<f32> = voice(|_| 150.0, 1.0).iter().map(|s| (s * 4.0).clamp(-1.0, 1.0)).collect();
        let c = contour(&clipped, RATE);
        assert!(c.unavailable_reason.as_deref().unwrap().contains("clipped"));
        assert!(c.range_semitones.is_none() && c.loudness_range_db.is_none());
        assert!(c.median_f0_hz.is_some(), "the line can still be drawn around the median");

        // Voice about 8 dB above loud room noise, which continues into the pause.
        let mut noisy: Vec<f32> = voice(|_| 150.0, 1.0).into_iter().zip(noise(0.36, 1.0, &mut seed)).map(|(v, n)| v + n).collect();
        noisy.extend(noise(0.36, 0.5, &mut seed));
        let c = contour(&noisy, RATE);
        assert!(c.unavailable_reason.as_deref().unwrap_or("none").contains("noise"), "{:?}", c.unavailable_reason);
        assert!(c.range_semitones.is_none() && c.loudness_range_db.is_none());
    }

    #[test]
    fn frames_round_trip_compactly_and_reject_damage() {
        let c = Contour { algorithm: ALGORITHM, source: "Estimated", hop_ms: 10, sample_rate: 16_000,
            f0_hz: vec![Some(120.04), None, Some(499.96)], rms_db: vec![Some(-20.123), None, Some(-95.0)],
            median_f0_hz: Some(120.0), range_semitones: None, loudness_range_db: None, unavailable_reason: None };
        let bytes = encode_frames(&c);
        assert_eq!(bytes.len(), 16 + 3 * 4);
        assert_eq!(artifact_timing(&bytes), Some((10, 16_000)));
        let (f0, rms) = decode_frames(&bytes).unwrap();
        assert_eq!(f0, vec![Some(120.0), None, Some(500.0)]);
        assert_eq!(rms, vec![Some(-20.12), None, Some(-95.0)]);
        // Stored precision is stable: re-encoding decoded frames changes nothing.
        let again = encode_frames(&Contour { f0_hz: f0, rms_db: rms, ..c });
        assert_eq!(again, bytes);
        assert!(decode_frames(&bytes[..bytes.len() - 1]).is_err(), "truncated");
        let mut wrong = bytes.clone();
        wrong[0] = b'X';
        assert!(decode_frames(&wrong).is_err(), "not a track");
    }

    /// McLeod pitch method (McLeod & Wyvill, 2005), test-only reference for P.1:
    /// normalised square difference, key maxima between zero crossings, first key
    /// maximum within 0.9 of the highest, parabolic interpolation, clarity ≥ 0.6.
    fn mpm(frame: &[f32], sample_rate: u32) -> Option<f64> {
        let rate = f64::from(sample_rate);
        let min_lag = (rate / MAX_F0).floor() as usize;
        let max_lag = ((rate / MIN_F0).ceil() as usize).min(frame.len() - 1);
        let nsdf: Vec<f64> = (0..=max_lag)
            .map(|lag| {
                let (mut r, mut m) = (0.0f64, 0.0f64);
                for j in 0..frame.len() - lag {
                    let (a, b) = (f64::from(frame[j]), f64::from(frame[j + lag]));
                    r += a * b;
                    m += a * a + b * b;
                }
                if m > 0.0 { 2.0 * r / m } else { 0.0 }
            })
            .collect();
        let mut peaks = Vec::new();
        let mut lag = 1;
        while lag < nsdf.len() && nsdf[lag] > 0.0 { lag += 1; } // skip the zero-lag lobe
        while lag < nsdf.len() - 1 {
            if nsdf[lag] > 0.0 {
                let mut best = lag;
                while lag < nsdf.len() - 1 && nsdf[lag] > 0.0 {
                    if nsdf[lag] > nsdf[best] { best = lag; }
                    lag += 1;
                }
                if best >= min_lag && best > 0 && best < nsdf.len() - 1 { peaks.push(best); }
            }
            lag += 1;
        }
        let highest = peaks.iter().map(|&p| nsdf[p]).fold(0.0, f64::max);
        let pick = *peaks.iter().find(|&&p| nsdf[p] >= 0.9 * highest)?;
        if nsdf[pick] < 0.6 { return None; }
        let (a, b, c) = (nsdf[pick - 1], nsdf[pick], nsdf[pick + 1]);
        let denominator = a - 2.0 * b + c;
        let shift = if denominator.abs() > f64::EPSILON { 0.5 * (a - c) / denominator } else { 0.0 };
        Some(rate / (pick as f64 + shift))
    }

    /// Voiced-frame recall and gross errors (> 1 semitone off) against a known glide.
    fn score(tracker: fn(&[f32], u32) -> Option<f64>, samples: &[f32], truth: impl Fn(f64) -> f64) -> (f64, f64) {
        let hop = (RATE as usize) * HOP_MS as usize / 1000;
        let window = (RATE as usize) * WINDOW_MS as usize / 1000;
        let (mut frames, mut found, mut gross) = (0usize, 0usize, 0usize);
        let mut start = 0;
        while start + window <= samples.len() {
            frames += 1;
            if let Some(f) = tracker(&samples[start..start + window], RATE) {
                found += 1;
                let centre = (start + window / 2) as f64 / f64::from(RATE);
                if (f / truth(centre)).log2().abs() * 12.0 > 1.0 { gross += 1; }
            }
            start += hop;
        }
        (found as f64 / frames as f64, gross as f64 / found.max(1) as f64)
    }

    /// P.1 comparison on harder input: white noise at falling SNRs and a weak
    /// microphone (−46 dBFS voice over a −60 dBFS floor), on low, mid and high
    /// voices gliding by half an octave. Prints the table recorded under D-17.
    #[test]
    fn yin_and_mcleod_compared_on_noisy_and_weak_voices() {
        let mut seed = 11u32;
        println!("P1 | voice | condition | YIN recall | YIN gross | MPM recall | MPM gross");
        let mut yin_worst_gross = 0.0f64;
        let mut yin_clean_recall = 1.0f64;
        for (name, low) in [("low", 90.0), ("mid", 140.0), ("high", 230.0)] {
            let truth = move |t: f64| low * 1.5f64.powf(t);
            let clean = voice(truth, 1.0);
            let signal_rms = (clean.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / clean.len() as f64).sqrt();
            for (condition, scale, snr_db) in [("clean", 1.0f32, None), ("20 dB", 1.0, Some(20.0)), ("10 dB", 1.0, Some(10.0)), ("5 dB", 1.0, Some(5.0)), ("weak mic", 0.02, Some(14.0))] {
                let noise_rms = snr_db.map_or(0.0, |snr: f64| signal_rms * f64::from(scale) / 10f64.powf(snr / 20.0));
                let amplitude = (noise_rms * 12f64.sqrt()) as f32; // uniform noise: rms = a / √12
                let input: Vec<f32> = clean.iter().zip(noise(amplitude, 1.0, &mut seed)).map(|(v, n)| v * scale + n).collect();
                let (yr, yg) = score(yin, &input, truth);
                let (mr, mg) = score(mpm, &input, truth);
                println!("P1 | {name} {low} Hz | {condition} | {:.0}% | {:.1}% | {:.0}% | {:.1}%", yr * 100.0, yg * 100.0, mr * 100.0, mg * 100.0);
                if snr_db.is_none_or(|s| s >= 10.0) { yin_worst_gross = yin_worst_gross.max(yg); }
                if snr_db.is_none() { yin_clean_recall = yin_clean_recall.min(yr); }
            }
        }
        // False voicing: pure noise should give no pitch at all.
        let hiss = noise(0.2, 1.0, &mut seed);
        let (yf, _) = score(yin, &hiss, |_| 100.0);
        let (mf, _) = score(mpm, &hiss, |_| 100.0);
        println!("P1 | none | white noise only | {:.0}% voiced | - | {:.0}% voiced | -", yf * 100.0, mf * 100.0);
        assert!(yf < 0.1, "YIN does not invent pitch in noise");
        assert!(yin_clean_recall > 0.9, "clean voices are tracked");
        assert!(yin_worst_gross < 0.05, "YIN gross errors stay under 5% down to 10 dB SNR and on a weak mic");
    }
}
