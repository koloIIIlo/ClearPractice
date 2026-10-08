//! Pitch and loudness contours (milestone P: P.1, P.2, P.8). YIN (de Cheveigné
//! & Kawahara, 2002) in plain Rust: difference function, cumulative mean
//! normalised difference, absolute threshold, parabolic interpolation. Frames
//! are on the original timeline at a 10 ms hop; unvoiced or silent frames carry
//! `None`, never zero (§11: no prosody value is a score). All values Estimated.
use serde::Serialize;

pub const HOP_MS: u64 = 10;
const WINDOW_MS: u64 = 40;
/// Speaking voices: 60–500 Hz covers low and high adult voices.
const MIN_F0: f64 = 60.0;
const MAX_F0: f64 = 500.0;
const YIN_THRESHOLD: f64 = 0.15;
/// Frames quieter than this (dBFS RMS) are treated as silence.
const SILENCE_DB: f64 = -50.0;

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
    pub unavailable_reason: Option<String>,
}

/// YIN estimate for one frame, or `None` when no clear period is found.
pub fn yin(frame: &[f32], sample_rate: u32) -> Option<f64> {
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
            None if lag >= min_lag.max(2) && cmnd[lag] < YIN_THRESHOLD => found = Some(lag),
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
    let hop = (u64::from(sample_rate) * HOP_MS / 1000) as usize;
    let window = (u64::from(sample_rate) * WINDOW_MS / 1000) as usize;
    let mut f0 = Vec::new();
    let mut rms = Vec::new();
    if hop == 0 || window == 0 {
        return Contour { algorithm: "yin-v1", source: "Estimated", hop_ms: HOP_MS, sample_rate, f0_hz: f0, rms_db: rms, median_f0_hz: None, range_semitones: None, unavailable_reason: Some("Invalid sample rate.".into()) };
    }
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + window).min(samples.len());
        let frame = &samples[start..end];
        let energy = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / frame.len().max(1) as f64;
        let db = (energy > 0.0).then(|| 10.0 * energy.log10());
        rms.push(db.map(|d| d as f32));
        let voiced = db.is_some_and(|d| d > SILENCE_DB) && frame.len() == window;
        f0.push(if voiced { yin(frame, sample_rate).map(|v| v as f32) } else { None });
        start += hop;
    }
    let mut voiced: Vec<f32> = f0.iter().flatten().copied().collect();
    voiced.sort_by(|a, b| a.total_cmp(b));
    let enough = voiced.len() >= 50; // at least half a second of voicing
    let median = enough.then(|| percentile(&voiced, 0.5));
    let range = enough.then(|| 12.0 * (percentile(&voiced, 0.95) / percentile(&voiced, 0.05)).log2());
    Contour {
        algorithm: "yin-v1",
        source: "Estimated",
        hop_ms: HOP_MS,
        sample_rate,
        f0_hz: f0,
        rms_db: rms,
        median_f0_hz: median,
        range_semitones: range,
        unavailable_reason: (!enough).then(|| "Too little voiced speech for a pitch range.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    const RATE: u32 = 16_000;

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
        }
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
        println!("PROSODY: {:.2} s for {:.1} s audio, voiced {:.0}%, median {:?} Hz, range {:?} st", elapsed.as_secs_f64(), samples.len() as f64 / 16_000.0, voiced * 100.0, c.median_f0_hz, c.range_semitones);
        assert!(elapsed.as_secs_f64() <= 5.0, "P.8 CPU target");
        assert!((0.2..0.9).contains(&voiced), "speech is partly voiced");
        assert!((70.0..300.0).contains(&c.median_f0_hz.unwrap()));
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
        assert!(c.range_semitones.is_none() && c.unavailable_reason.is_some());
        assert!(contour(&voice(|_| 150.0, 0.2), RATE).unavailable_reason.is_some());
    }
}
