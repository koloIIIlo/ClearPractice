//! Compact waveform peaks for playback (§9 step 10, plan 2.15). The WebView draws
//! these instead of downloading and decoding whole WAV files. Peaks are a
//! regenerable cache keyed by the verified audio checksum; the original
//! recording is only ever read.
use crate::storage::recording::SavedRecording;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;

const CACHE_VERSION: u32 = 1;
const PEAKS_PER_SECOND: u64 = 100;
/// Long takes get coarser buckets so the payload stays small.
const MAX_PEAKS: u64 = 20_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPeaks {
    pub version: u32,
    pub asset_id: String,
    pub sha256: String,
    pub sample_rate: u32,
    pub duration_ms: u64,
    pub samples_per_peak: u32,
    /// Absolute maximum of each bucket, 0–32767.
    pub peaks: Vec<u16>,
}

fn io_error(error: std::io::Error) -> String {
    format!("Waveform cache error: {error}")
}

fn cache_path(root: &Path, id: &str) -> PathBuf {
    root.join("cache").join("peaks").join(format!("{id}.json"))
}

pub fn samples_per_peak(sample_rate: u32, samples: u64) -> u32 {
    let base = (u64::from(sample_rate) / PEAKS_PER_SECOND).max(1);
    let capped = samples.div_ceil(MAX_PEAKS).max(1);
    u32::try_from(base.max(capped)).unwrap_or(u32::MAX)
}

/// Reads the 16-bit mono PCM body after the 44-byte header written by capture.
pub fn compute(audio: &Path, saved: &SavedRecording) -> Result<WaveformPeaks> {
    let data_bytes = saved
        .bytes
        .checked_sub(44)
        .ok_or("Invalid saved recording size.")?;
    let samples = data_bytes / 2;
    let per_peak = samples_per_peak(saved.sample_rate, samples);
    let mut reader = BufReader::with_capacity(65_536, File::open(audio).map_err(io_error)?);
    let mut header = [0u8; 44];
    reader.read_exact(&mut header).map_err(io_error)?;

    let mut peaks =
        Vec::with_capacity(usize::try_from(samples.div_ceil(u64::from(per_peak))).unwrap_or(0));
    let (mut current, mut in_bucket, mut remaining) = (0u16, 0u32, samples);
    let mut buffer = [0u8; 65_536];
    while remaining > 0 {
        let want =
            usize::try_from((remaining * 2).min(buffer.len() as u64)).unwrap_or(buffer.len());
        reader.read_exact(&mut buffer[..want]).map_err(io_error)?;
        for pair in buffer[..want].chunks_exact(2) {
            let amplitude = i16::from_le_bytes([pair[0], pair[1]])
                .unsigned_abs()
                .min(32_767);
            current = current.max(amplitude);
            in_bucket += 1;
            if in_bucket == per_peak {
                peaks.push(current);
                (current, in_bucket) = (0, 0);
            }
        }
        remaining -= (want / 2) as u64;
    }
    if in_bucket > 0 {
        peaks.push(current);
    }
    Ok(WaveformPeaks {
        version: CACHE_VERSION,
        asset_id: saved.asset_id.clone(),
        sha256: saved.sha256.clone(),
        sample_rate: saved.sample_rate,
        duration_ms: saved.duration_ms,
        samples_per_peak: per_peak,
        peaks,
    })
}

fn read_cache(path: &Path, saved: &SavedRecording) -> Option<WaveformPeaks> {
    let cached: WaveformPeaks = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let samples = saved.bytes.checked_sub(44)? / 2;
    let fresh = cached.version == CACHE_VERSION
        && cached.asset_id == saved.asset_id
        && cached.sha256 == saved.sha256
        && cached.sample_rate == saved.sample_rate
        && cached.duration_ms == saved.duration_ms
        && cached.samples_per_peak == samples_per_peak(saved.sample_rate, samples)
        && cached.peaks.len() as u64 == samples.div_ceil(u64::from(cached.samples_per_peak))
        && cached.peaks.iter().all(|p| *p <= 32_767);
    fresh.then_some(cached)
}

fn write_cache(root: &Path, path: &Path, peaks: &WaveformPeaks) -> Result<()> {
    let dir = path.parent().ok_or("Invalid waveform cache path.")?;
    fs::create_dir_all(dir).map_err(io_error)?;
    crate::audio::prepare::contained(root, dir)?;
    let temp = dir.join(format!("{}.tmp", peaks.asset_id));
    let mut file = File::create(&temp).map_err(io_error)?;
    file.write_all(&serde_json::to_vec(peaks).map_err(|e| e.to_string())?)
        .map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    fs::rename(&temp, path).map_err(io_error)
}

/// `saved` must already be verified against its committed asset reference.
/// A cache that cannot be written is not an error: the peaks are returned anyway.
pub fn load_or_build(root: &Path, saved: &SavedRecording) -> Result<WaveformPeaks> {
    let path = cache_path(root, &saved.asset_id);
    if path.exists() && crate::audio::prepare::contained(root, &path).is_ok() {
        if let Some(cached) = read_cache(&path, saved) {
            return Ok(cached);
        }
    }
    let audio = root
        .join("recordings")
        .join(&saved.asset_id)
        .join("audio.wav");
    crate::audio::prepare::contained(root, &audio)?;
    let peaks = compute(&audio, saved)?;
    let _ = write_cache(root, &path, &peaks);
    Ok(peaks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::{tests::TestRoot, wav_header};

    fn write_take(root: &Path, id: &str, rate: u32, samples: &[i16]) -> SavedRecording {
        let dir = root.join("recordings").join(id);
        fs::create_dir_all(&dir).unwrap();
        let mut bytes = wav_header(rate, (samples.len() * 2) as u32).to_vec();
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        fs::write(dir.join("audio.wav"), &bytes).unwrap();
        SavedRecording {
            attempt_id: id.into(),
            asset_id: id.into(),
            title: String::new(),
            created_at_ms: 0,
            duration_ms: samples.len() as u64 * 1000 / u64::from(rate),
            sample_rate: rate,
            channels: 1,
            source_channels: 1,
            source_format: "F32".into(),
            bytes: bytes.len() as u64,
            sha256: crate::storage::recording::hash_file(&dir.join("audio.wav")).unwrap(),
            recovered: false,
        }
    }

    #[test]
    fn buckets_absolute_maxima_including_the_final_partial_bucket() {
        let root = TestRoot::new();
        // 8 kHz → 80 samples per peak; 170 samples → 3 buckets, last one partial.
        let mut samples = vec![0i16; 170];
        samples[10] = -1_000;
        samples[100] = 2_000;
        samples[169] = i16::MIN;
        let saved = write_take(&root.0, "take-a", 8_000, &samples);
        let peaks = load_or_build(&root.0, &saved).unwrap();
        assert_eq!(peaks.samples_per_peak, 80);
        assert_eq!(peaks.peaks, vec![1_000, 2_000, 32_767]);
    }

    #[test]
    fn long_takes_are_capped_and_cache_follows_the_audio_checksum() {
        assert_eq!(samples_per_peak(48_000, 48_000 * 60), 480);
        assert_eq!(samples_per_peak(48_000, 48_000 * 600), 1_440);

        let root = TestRoot::new();
        let saved = write_take(&root.0, "take-b", 8_000, &[500; 160]);
        assert_eq!(
            load_or_build(&root.0, &saved).unwrap().peaks,
            vec![500, 500]
        );
        assert!(cache_path(&root.0, "take-b").exists());

        // Different audio under the same ID must never reuse the old cache.
        let changed = write_take(&root.0, "take-b", 8_000, &[900; 160]);
        assert_eq!(
            load_or_build(&root.0, &changed).unwrap().peaks,
            vec![900, 900]
        );

        // A corrupt cache is regenerated, not trusted.
        fs::write(cache_path(&root.0, "take-b"), b"{not json").unwrap();
        assert_eq!(
            load_or_build(&root.0, &changed).unwrap().peaks,
            vec![900, 900]
        );
    }
}
