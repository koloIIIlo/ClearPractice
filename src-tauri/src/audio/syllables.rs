//! Speech rate from the audio itself (roadmap 8.8), after de Jong & Wempe
//! (2009): syllable nuclei are intensity peaks that stand out from their
//! surroundings and are voiced. No transcript is needed. Everything here is
//! Estimated and never a target speed (D-34): missing values carry a reason.
use crate::prosody::yin_with;
use serde::Serialize;
use std::collections::VecDeque;

pub const METHOD: &str = "nuclei-v1";
pub const DEFINITION_VERSION: u32 = 1;
/// Short frames keep neighbouring syllables apart (Praat's intensity window for
/// a 50 Hz minimum pitch is about this long in effect). 50 ms frames merged a
/// third of the syllables of the public sample (D-24) on 17 Oct.
const FRAME_MS: u32 = 25;
const HOP_MS: u32 = 5;
/// Peaks count only above the 99th-percentile intensity minus this.
const THRESHOLD_BELOW_DB: f32 = 25.0;
/// A nucleus stands out from the dips on both sides by at least this much.
const DIP_DB: f32 = 2.0;
/// Quiet stretches of at least this length are pauses.
const PAUSE_MS: u64 = 300;
const VOICING_WINDOW_MS: u32 = 40;
/// A nucleus is voiced when YIN finds a period at it or 10 ms either side, with
/// a looser threshold than the intonation contour's 0.15: de Jong & Wempe's
/// voicing check is lenient too. At 0.15 the check dropped 40% of real syllables.
const VOICING_THRESHOLD: f64 = 0.35;
const VOICING_SPREAD_MS: u32 = 10;
const MIN_NUCLEI: usize = 10;
const MIN_SPAN_MS: u64 = 5_000;
const SILENCE_DB: f32 = -120.0;
/// Below this nothing counts as speech, however quiet the room (digital silence).
const MIN_THRESHOLD_DB: f32 = -60.0;
/// Live counter: an 8 s window, a value every second, the threshold from the
/// last 30 s, and nothing until 3 s of speech.
const LIVE_WINDOW_MS: u64 = 8_000;
const LIVE_EVERY_MS: u64 = 1_000;
const LIVE_HISTORY_MS: u64 = 30_000;
const LIVE_MIN_VOICED_MS: u64 = 3_000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateResult {
    pub nuclei_ms: Vec<u64>,
    pub span_ms: Option<u64>,
    pub phonation_ms: Option<u64>,
    /// Nuclei ÷ (last nucleus − first nucleus), pauses included.
    pub rate_sps: Option<f64>,
    /// Nuclei ÷ time spent speaking (the span minus pauses).
    pub articulation_sps: Option<f64>,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRate {
    pub syllables_per_second: Option<f32>,
    pub voiced_ms: u32,
    pub window_ms: u32,
}

fn decibels(sum_squares: f64, samples: usize) -> f32 {
    if samples == 0 || sum_squares <= 0.0 {
        return SILENCE_DB;
    }
    (10.0 * (sum_squares / samples as f64).log10()).max(f64::from(SILENCE_DB)) as f32
}

/// Intensity in dB over 50 ms frames every 10 ms; frame `k` starts at `k` hops.
fn intensity(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    let hop = (sample_rate * HOP_MS / 1000) as usize;
    let frame = (sample_rate * FRAME_MS / 1000) as usize;
    if hop == 0 || samples.len() < frame {
        return Vec::new();
    }
    let mut squares = vec![0.0f64; samples.len() + 1];
    for (i, s) in samples.iter().enumerate() {
        squares[i + 1] = squares[i] + f64::from(*s) * f64::from(*s);
    }
    (0..=(samples.len() - frame) / hop).map(|k| decibels(squares[k * hop + frame] - squares[k * hop], frame)).collect()
}

fn percentile_99(values: &[f32]) -> f32 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    sorted[((sorted.len() - 1) * 99) / 100]
}

/// Is there a pitch in the 40 ms around `center` (a sample index), or 10 ms either side?
fn voiced_at(samples: &[f32], sample_rate: u32, center: usize) -> bool {
    let half = (sample_rate * VOICING_WINDOW_MS / 2000) as usize;
    let spread = (sample_rate * VOICING_SPREAD_MS / 1000) as usize;
    [Some(center), center.checked_sub(spread), Some(center + spread)].into_iter().flatten().any(|c| {
        let (Some(from), to) = (c.checked_sub(half), c + half) else { return false };
        to <= samples.len() && yin_with(&samples[from..to], sample_rate, VOICING_THRESHOLD).is_some()
    })
}

/// Candidate peaks: local maxima above the threshold, merged until each is at
/// least 2 dB above the lowest point on both sides.
fn peaks(db: &[f32], threshold: f32) -> Vec<usize> {
    let mut kept: Vec<usize> = Vec::new();
    for i in 1..db.len().saturating_sub(1) {
        if !(db[i] > db[i - 1] && db[i] >= db[i + 1] && db[i] > threshold) {
            continue;
        }
        if let Some(&last) = kept.last() {
            let dip = db[last..=i].iter().copied().fold(f32::INFINITY, f32::min);
            if db[last] - dip < DIP_DB || db[i] - dip < DIP_DB {
                if db[i] > db[last] {
                    *kept.last_mut().unwrap() = i;
                }
                continue;
            }
        } else if db[i] - db[..i].iter().copied().fold(f32::INFINITY, f32::min) < DIP_DB {
            continue;
        }
        kept.push(i);
    }
    // The last one also needs a dip after it.
    if let Some(&last) = kept.last() {
        if db[last] - db[last..].iter().copied().fold(f32::INFINITY, f32::min) < DIP_DB {
            kept.pop();
        }
    }
    kept
}

/// Speech rate of a whole take (mono samples).
pub fn detect(samples: &[f32], sample_rate: u32) -> RateResult {
    let unavailable = |nuclei_ms: Vec<u64>| RateResult {
        nuclei_ms,
        span_ms: None,
        phonation_ms: None,
        rate_sps: None,
        articulation_sps: None,
        unavailable_reason: Some("Needs at least 5 seconds of speech.".into()),
    };
    let db = intensity(samples, sample_rate);
    if db.len() < 3 {
        return unavailable(Vec::new());
    }
    let threshold = (percentile_99(&db) - THRESHOLD_BELOW_DB).max(MIN_THRESHOLD_DB);
    let hop = (sample_rate * HOP_MS / 1000) as usize;
    let half_frame = (sample_rate * FRAME_MS / 2000) as usize;
    let nuclei: Vec<usize> = peaks(&db, threshold).into_iter().filter(|&k| voiced_at(samples, sample_rate, k * hop + half_frame)).collect();
    let at_ms = |k: usize| k as u64 * u64::from(HOP_MS) + u64::from(FRAME_MS / 2);
    let nuclei_ms: Vec<u64> = nuclei.iter().map(|&k| at_ms(k)).collect();
    let (Some(&first), Some(&last)) = (nuclei.first(), nuclei.last()) else {
        return unavailable(nuclei_ms);
    };
    let span = at_ms(last) - at_ms(first);
    if nuclei.len() < MIN_NUCLEI || span < MIN_SPAN_MS {
        return unavailable(nuclei_ms);
    }
    // Quiet runs of at least 300 ms between the first and last nucleus.
    let mut paused_frames = 0u64;
    let mut run = 0u64;
    for &value in &db[first..=last] {
        if value < threshold {
            run += 1;
        } else {
            if run * u64::from(HOP_MS) >= PAUSE_MS {
                paused_frames += run;
            }
            run = 0;
        }
    }
    let phonation = span.saturating_sub(paused_frames * u64::from(HOP_MS)).max(1);
    let round = |v: f64| (v * 100.0).round() / 100.0;
    RateResult {
        span_ms: Some(span),
        phonation_ms: Some(phonation),
        rate_sps: Some(round(nuclei.len() as f64 * 1000.0 / span as f64)),
        articulation_sps: Some(round(nuclei.len() as f64 * 1000.0 / phonation as f64)),
        unavailable_reason: None,
        nuclei_ms,
    }
}

/// The live meter's counter (8.8), fed with mono blocks while recording. It
/// keeps 2 s of audio for the voicing check and a 1 dB histogram of the last
/// 30 s for the threshold, so each block costs O(n) plus a few pitch checks.
pub struct LiveCounter {
    /// Input is averaged in groups of `factor` samples (48 kHz → 16 kHz).
    factor: u32,
    decimated: f32,
    decimated_len: u32,
    sample_rate: u32,
    hop: usize,
    frame_hops: usize,
    pending: f64,
    pending_len: usize,
    hop_energy: VecDeque<f64>,
    audio: VecDeque<f32>,
    samples_seen: u64,
    frames: u64,
    history: VecDeque<u8>,
    histogram: [u32; 121],
    valley: f32,
    candidate: Option<(u64, f32)>,
    nuclei: VecDeque<u64>,
    voiced_frames: u64,
    since_emit: u64,
    last_rate: Option<f32>,
    last_speech_frame: u64,
}

impl LiveCounter {
    pub fn new(input_rate: u32) -> Self {
        let input_rate = input_rate.max(8_000);
        let factor = (input_rate / 16_000).max(1);
        let sample_rate = input_rate / factor;
        Self {
            factor,
            decimated: 0.0,
            decimated_len: 0,
            sample_rate,
            hop: (sample_rate * HOP_MS / 1000) as usize,
            frame_hops: (FRAME_MS / HOP_MS) as usize,
            pending: 0.0,
            pending_len: 0,
            hop_energy: VecDeque::new(),
            audio: VecDeque::new(),
            samples_seen: 0,
            frames: 0,
            history: VecDeque::new(),
            histogram: [0; 121],
            valley: f32::INFINITY,
            candidate: None,
            nuclei: VecDeque::new(),
            voiced_frames: 0,
            since_emit: 0,
            last_rate: None,
            last_speech_frame: 0,
        }
    }

    fn threshold(&self) -> f32 {
        let total: u32 = self.histogram.iter().sum();
        let needed = (u64::from(total) * 99).div_ceil(100) as u32;
        let mut seen = 0;
        for (bin, count) in self.histogram.iter().enumerate() {
            seen += count;
            if seen >= needed.max(1) {
                return (bin as f32 - 120.0 - THRESHOLD_BELOW_DB).max(MIN_THRESHOLD_DB);
            }
        }
        MIN_THRESHOLD_DB
    }

    fn voiced_frame(&self, frame: u64) -> bool {
        let center = frame * self.hop as u64 + (self.hop * self.frame_hops / 2) as u64;
        let start = self.samples_seen - self.audio.len() as u64;
        let half = u64::from(self.sample_rate * VOICING_WINDOW_MS / 2000);
        let spread = u64::from(self.sample_rate * VOICING_SPREAD_MS / 1000);
        [Some(center), center.checked_sub(spread), Some(center + spread)].into_iter().flatten().any(|c| {
            if c < start + half || c + half > self.samples_seen {
                return false;
            }
            let from = (c - half - start) as usize;
            let window: Vec<f32> = self.audio.range(from..from + 2 * half as usize).copied().collect();
            yin_with(&window, self.sample_rate, VOICING_THRESHOLD).is_some()
        })
    }

    fn frame(&mut self, db: f32) {
        let frame = self.frames;
        self.frames += 1;
        let bin = (db.clamp(SILENCE_DB, 0.0) + 120.0).round() as usize;
        self.histogram[bin] += 1;
        self.history.push_back(bin as u8);
        if self.history.len() as u64 > LIVE_HISTORY_MS / u64::from(HOP_MS) {
            let old = self.history.pop_front().unwrap() as usize;
            self.histogram[old] -= 1;
        }
        let threshold = self.threshold();
        if db > threshold {
            self.voiced_frames += 1;
            self.last_speech_frame = frame;
        }
        // Rise at least 2 dB from the valley, peak, then fall 2 dB: one nucleus.
        match self.candidate {
            None => {
                self.valley = self.valley.min(db);
                if db >= self.valley + DIP_DB && db > threshold {
                    self.candidate = Some((frame, db));
                }
            }
            Some((_, peak)) if db > peak => self.candidate = Some((frame, db)),
            Some((at, peak)) if db <= peak - DIP_DB => {
                if peak > threshold && self.voiced_frame(at) {
                    self.nuclei.push_back(at);
                }
                self.candidate = None;
                self.valley = db;
            }
            Some(_) => {}
        }
        let window = LIVE_WINDOW_MS / u64::from(HOP_MS);
        while self.nuclei.front().is_some_and(|&n| n + window < frame) {
            self.nuclei.pop_front();
        }
    }

    /// Feeds one block; returns a value once a second.
    pub fn push(&mut self, mono: &[f32]) -> Option<LiveRate> {
        let keep = (self.sample_rate * 2) as usize;
        for &sample in mono {
            self.decimated += if sample.is_finite() { sample } else { 0.0 };
            self.decimated_len += 1;
            if self.decimated_len < self.factor {
                continue;
            }
            let s = self.decimated / self.factor as f32;
            self.decimated = 0.0;
            self.decimated_len = 0;
            self.audio.push_back(s);
            if self.audio.len() > keep {
                self.audio.pop_front();
            }
            self.samples_seen += 1;
            self.pending += f64::from(s) * f64::from(s);
            self.pending_len += 1;
            if self.pending_len == self.hop {
                self.hop_energy.push_back(self.pending);
                self.pending = 0.0;
                self.pending_len = 0;
                if self.hop_energy.len() > self.frame_hops {
                    self.hop_energy.pop_front();
                }
                if self.hop_energy.len() == self.frame_hops {
                    let db = decibels(self.hop_energy.iter().sum(), self.hop * self.frame_hops);
                    self.frame(db);
                }
            }
        }
        self.since_emit += mono.len() as u64;
        let every = u64::from(self.sample_rate * self.factor) * LIVE_EVERY_MS / 1000;
        if self.since_emit < every {
            return None;
        }
        self.since_emit %= every;
        let voiced_ms = self.voiced_frames * u64::from(HOP_MS);
        let frame_ms = |n: u64| n * u64::from(HOP_MS);
        let silent = self.frames.saturating_sub(self.last_speech_frame) * u64::from(HOP_MS) > LIVE_EVERY_MS;
        if voiced_ms >= LIVE_MIN_VOICED_MS && !silent {
            // Like the take's rate: nuclei ÷ the time from the first to the last in the window.
            if let (Some(&first), Some(&last)) = (self.nuclei.front(), self.nuclei.back()) {
                if self.nuclei.len() >= 3 && last > first {
                    self.last_rate = Some(((self.nuclei.len() as f64 * 1000.0 / frame_ms(last - first) as f64) * 10.0).round() as f32 / 10.0);
                }
            }
        }
        // In a silence the meter holds its last value.
        Some(LiveRate {
            syllables_per_second: if voiced_ms >= LIVE_MIN_VOICED_MS { self.last_rate } else { None },
            voiced_ms: u32::try_from(voiced_ms).unwrap_or(u32::MAX),
            window_ms: LIVE_WINDOW_MS as u32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    const RATE: u32 = 16_000;

    /// A 150 Hz voice-like tone in raised-cosine bursts, `per_second` a second.
    fn bursts(per_second: f32, seconds: f32) -> Vec<f32> {
        let n = (RATE as f32 * seconds) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                let envelope = 0.5 * (1.0 - (TAU * per_second * t).cos());
                0.6 * envelope * ((TAU * 150.0 * t).sin() + 0.3 * (TAU * 300.0 * t).sin())
            })
            .collect()
    }

    fn noise_bursts(per_second: f32, seconds: f32) -> Vec<f32> {
        let mut state = 0x2545_f491u32;
        let n = (RATE as f32 * seconds) as usize;
        (0..n)
            .map(|i| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                let white = (state as f32 / u32::MAX as f32) * 2.0 - 1.0;
                let t = i as f32 / RATE as f32;
                0.6 * 0.5 * (1.0 - (TAU * per_second * t).cos()) * white
            })
            .collect()
    }

    #[test]
    fn counts_synthetic_voiced_bursts_within_ten_percent() {
        for per_second in [3.0f32, 4.0, 5.0] {
            let result = detect(&bursts(per_second, 10.0), RATE);
            let rate = result.rate_sps.unwrap_or_else(|| panic!("{per_second}: {:?}", result.unavailable_reason));
            assert!((rate - f64::from(per_second)).abs() <= f64::from(per_second) * 0.1, "{per_second} Hz: {rate} ({} nuclei)", result.nuclei_ms.len());
            let expected = (per_second * 10.0) as usize;
            assert!(result.nuclei_ms.len().abs_diff(expected) <= 1, "{per_second}: {} nuclei", result.nuclei_ms.len());
            assert!(result.articulation_sps.unwrap() >= rate, "phonation is never longer than the span");
        }
    }

    #[test]
    fn ignores_unvoiced_noise_bursts() {
        let result = detect(&noise_bursts(4.0, 10.0), RATE);
        assert!(result.nuclei_ms.len() <= 2, "{} nuclei in noise", result.nuclei_ms.len());
        assert_eq!(result.rate_sps, None);
        assert_eq!(result.unavailable_reason.as_deref(), Some("Needs at least 5 seconds of speech."));
    }

    #[test]
    fn needs_five_seconds_and_ten_nuclei() {
        let short = detect(&bursts(4.0, 4.0), RATE);
        assert_eq!((short.rate_sps, short.unavailable_reason.as_deref()), (None, Some("Needs at least 5 seconds of speech.")));
        assert!(!short.nuclei_ms.is_empty(), "the nuclei found are still listed");
        // Long enough but sparse: one burst a second for 8 s is fewer than ten nuclei.
        let sparse = detect(&bursts(1.0, 8.0), RATE);
        assert!(sparse.rate_sps.is_none());
        assert_eq!(detect(&[], RATE).unavailable_reason.as_deref(), Some("Needs at least 5 seconds of speech."));
        // A pause in the middle lowers the rate but not the articulation rate.
        let mut paused = bursts(4.0, 5.0);
        paused.extend(vec![0.0; RATE as usize * 2]);
        paused.extend(bursts(4.0, 5.0));
        let result = detect(&paused, RATE);
        assert!(result.articulation_sps.unwrap() > result.rate_sps.unwrap() * 1.1, "{result:?}");
    }

    #[test]
    fn live_counter_matches_offline_detect_on_the_same_signal_within_ten_percent() {
        let signal = bursts(4.0, 12.0);
        let offline = detect(&signal, RATE).rate_sps.unwrap();
        let mut live = LiveCounter::new(RATE);
        let values: Vec<LiveRate> = signal.chunks(4_096).filter_map(|block| live.push(block)).collect();
        assert!((10..=13).contains(&values.len()), "about one value a second: {}", values.len());
        let last = values.last().unwrap().syllables_per_second.unwrap();
        assert!((f64::from(last) - offline).abs() <= offline * 0.1, "live {last} vs offline {offline}");
        // A silence holds the last value instead of falling to zero.
        for block in vec![0.0f32; RATE as usize * 3].chunks(4_096) {
            if let Some(v) = live.push(block) {
                assert_eq!(v.syllables_per_second, Some(last));
            }
        }
    }

    /// Syllables of a written word by vowel groups (a rough count; a final
    /// silent "e" is dropped, every word has at least one).
    fn written_syllables(word: &str) -> usize {
        let w: String = word.to_lowercase().chars().filter(char::is_ascii_alphabetic).collect();
        if w.is_empty() {
            return 0;
        }
        let vowel = |c: char| "aeiouy".contains(c);
        let chars: Vec<char> = w.chars().collect();
        let mut groups = chars.iter().enumerate().filter(|(i, c)| vowel(**c) && (*i == 0 || !vowel(chars[i - 1]))).count();
        if w.ends_with('e') && !w.ends_with("le") && groups > 1 {
            groups -= 1;
        }
        groups.max(1)
    }

    /// The public sample (D-24) against its verbatim transcript, release build
    /// only: `cargo test --release --lib syllables -- --ignored --nocapture`.
    /// Needs `bench/samples/public-62s.wav` (see bench/README.md).
    #[test]
    #[ignore]
    fn rate_on_the_public_sample_is_close_to_transcript_syllables() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench/samples");
        let bytes = std::fs::read(dir.join("public-62s.wav")).unwrap();
        let samples: Vec<f32> = bytes[44..].chunks_exact(2).map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0).collect();
        let reference: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("public-62s-reference.json")).unwrap()).unwrap();
        let written: usize = reference["verbatim"].as_str().unwrap().split_whitespace().map(written_syllables).sum();
        let started = std::time::Instant::now();
        let result = detect(&samples, RATE);
        let detected = result.nuclei_ms.len();
        println!(
            "SYLLABLES: {detected} nuclei vs {written} written syllables ({:+.1}%), rate {:?}/s, articulation {:?}/s, {:.2} s for {:.1} s audio",
            (detected as f64 / written as f64 - 1.0) * 100.0,
            result.rate_sps,
            result.articulation_sps,
            started.elapsed().as_secs_f64(),
            samples.len() as f64 / f64::from(RATE)
        );
        assert!((detected as f64 / written as f64 - 1.0).abs() <= 0.15, "within ±15% of the transcript's syllables");
    }

    #[test]
    fn live_counter_reads_48_khz_microphone_blocks() {
        // The same bursts at 48 kHz (each sample three times), as a microphone delivers them.
        let signal: Vec<f32> = bursts(4.0, 12.0).into_iter().flat_map(|s| [s, s, s]).collect();
        let mut live = LiveCounter::new(48_000);
        let values: Vec<LiveRate> = signal.chunks(4_096).filter_map(|block| live.push(block)).collect();
        assert!((11..=13).contains(&values.len()), "{}", values.len());
        let last = values.last().unwrap().syllables_per_second.unwrap();
        assert!((last - 4.0).abs() <= 0.45, "{last}");
    }

    #[test]
    fn live_counter_is_silent_until_three_seconds_voiced() {
        let mut live = LiveCounter::new(RATE);
        let mut seen = Vec::new();
        for block in vec![0.0f32; RATE as usize * 2].chunks(4_096).map(<[f32]>::to_vec).chain(bursts(4.0, 8.0).chunks(4_096).map(<[f32]>::to_vec)) {
            if let Some(v) = live.push(&block) {
                seen.push(v);
            }
        }
        let first_value = seen.iter().position(|v| v.syllables_per_second.is_some()).expect("a value after enough speech");
        assert!(seen[..first_value].iter().all(|v| v.voiced_ms < 3_000 || v.syllables_per_second.is_none()));
        assert!(seen[first_value].voiced_ms >= 3_000, "{:?}", seen[first_value]);
        assert!(seen.iter().take(4).all(|v| v.syllables_per_second.is_none()), "two silent seconds and the first speech say nothing");
    }
}
