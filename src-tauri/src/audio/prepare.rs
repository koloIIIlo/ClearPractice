//! Derived, regenerable speech input. Originals are immutable; conversion is
//! streamed off the capture thread, with filter latency removed and tail flushed.
use crate::storage::recording::{self, SavedRecording};
use rubato::{FftFixedInOut, Resampler};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

type Result<T> = std::result::Result<T, String>;
pub const RATE: u32 = 16_000;
const PROFILE: &str = "rubato-0.16.2-fft-v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedAudio {
    pub version: u32,
    pub asset_id: String,
    pub source_sha256: String,
    pub source_sample_rate: u32,
    pub source_frames: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
    pub duration_ms: u64,
    pub bytes: u64,
    pub sha256: String,
    pub algorithm: String,
    pub trimmed_delay_frames: usize,
}

pub(crate) fn expected_frames(frames: u64, rate: u32) -> u64 {
    (frames * u64::from(RATE) + u64::from(rate) / 2) / u64::from(rate)
}

fn cancelled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err("Audio preparation canceled. The original recording is preserved.".into())
    } else {
        Ok(())
    }
}

fn storage_error(_: std::io::Error) -> String {
    "Cannot prepare transcription audio. Check available space and folder permissions; the original recording is preserved.".into()
}

pub(crate) fn contained(root: &Path, path: &Path) -> Result<PathBuf> {
    if !path.starts_with(root) {
        return Err("Audio storage is outside the app data folder.".into());
    }
    let mut ancestor = path;
    while ancestor != root {
        let metadata = fs::symlink_metadata(ancestor).map_err(storage_error)?;
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = false;
        if metadata.file_type().is_symlink() || reparse {
            return Err(
                "Audio storage contains a link or junction. Choose a regular app data folder."
                    .into(),
            );
        }
        ancestor = ancestor.parent().ok_or("Invalid audio storage path.")?;
    }
    let root = root.canonicalize().map_err(storage_error)?;
    let path = path.canonicalize().map_err(storage_error)?;
    if !path.starts_with(&root) {
        return Err("Audio storage resolves outside the app data folder.".into());
    }
    Ok(path)
}

fn directory(root: &Path, saved: &SavedRecording) -> PathBuf {
    root.join("cache")
        .join("inference")
        .join(&saved.asset_id)
        .join(format!("{}-{PROFILE}", saved.sha256))
}

fn verify(path: &Path, audio: &PreparedAudio, saved: &SavedRecording) -> Result<()> {
    let source_frames = (saved.bytes - 44) / 2;
    let frames = expected_frames(source_frames, saved.sample_rate);
    if audio.version != 1
        || audio.asset_id != saved.asset_id
        || audio.source_sha256 != saved.sha256
        || audio.source_sample_rate != saved.sample_rate
        || audio.source_frames != source_frames
        || audio.frames != frames
        || audio.sample_rate != RATE
        || audio.channels != 1
        || audio.algorithm != PROFILE
        || audio.bytes != 44 + frames * 2
        || audio.duration_ms != frames * 1000 / u64::from(RATE)
    {
        return Err("Prepared audio metadata failed verification.".into());
    }
    let mut file = File::open(path).map_err(storage_error)?;
    let mut header = [0; 44];
    file.read_exact(&mut header).map_err(storage_error)?;
    if header != recording::wav_header(RATE, (frames * 2) as u32)
        || file.metadata().map_err(storage_error)?.len() != audio.bytes
        || recording::hash_file(path)? != audio.sha256
    {
        return Err("Prepared audio failed verification.".into());
    }
    Ok(())
}

/// Must be serialized by the analysis owner. The cancel flag also supports
/// yielding to microphone capture without changing the original recording.
pub fn prepare(root: &Path, asset_id: &str, cancel: &AtomicBool) -> Result<PreparedAudio> {
    cancelled(cancel)?;
    recording::validate_id(asset_id)?;
    let saved = recording::read_saved(root, asset_id)?.ok_or("Saved recording not found.")?;
    let source = contained(root, &recording::playback_path(root, asset_id)?)?;
    let source_frames = (saved.bytes - 44) / 2;
    let target_frames = expected_frames(source_frames, saved.sample_rate);
    if (saved.bytes - 44) % 2 != 0
        || target_frames == 0
        || target_frames > u64::from(RATE) * 60 * 60
    {
        return Err(
            "Transcription requires between one sample and one hour of saved audio.".into(),
        );
    }
    let dir = directory(root, &saved);
    // Check each existing ancestor before creating descendants, including junctions.
    contained(root, &root.join("cache"))?;
    fs::create_dir_all(root.join("cache").join("inference")).map_err(storage_error)?;
    contained(root, &root.join("cache").join("inference"))?;
    fs::create_dir_all(root.join("cache").join("inference").join(asset_id))
        .map_err(storage_error)?;
    contained(root, &root.join("cache").join("inference").join(asset_id))?;
    fs::create_dir_all(&dir).map_err(storage_error)?;
    contained(root, &dir)?;
    let final_path = dir.join("audio.wav");
    let receipt_path = dir.join("prepared.json");
    // Inspect links before opening or replacing any cache file.
    for name in [
        "audio.wav.part",
        "prepared.json.part",
        "audio.wav",
        "prepared.json",
    ] {
        let path = dir.join(name);
        if fs::symlink_metadata(&path).is_ok() {
            contained(root, &path)?;
        }
    }
    if receipt_path.exists() && final_path.exists() {
        let metadata = File::open(&receipt_path).map_err(storage_error)?;
        if metadata.metadata().map_err(storage_error)?.len() <= 16_384 {
            if let Ok(audio) = serde_json::from_reader::<_, PreparedAudio>(metadata) {
                contained(root, &final_path)?;
                if verify(&final_path, &audio, &saved).is_ok() {
                    return Ok(audio);
                }
            }
        }
    }
    let temporary = dir.join("audio.wav.part");
    let result = (|| {
        let mut input = BufReader::new(File::open(&source).map_err(storage_error)?);
        let mut header = [0; 44];
        input.read_exact(&mut header).map_err(storage_error)?;
        let mut output = BufWriter::new(File::create(&temporary).map_err(storage_error)?);
        output
            .write_all(&recording::wav_header(RATE, (target_frames * 2) as u32))
            .map_err(storage_error)?;
        let delay = convert(
            &mut input,
            &mut output,
            saved.sample_rate,
            source_frames,
            cancel,
        )?;
        output.flush().map_err(storage_error)?;
        output.get_ref().sync_all().map_err(storage_error)?;
        drop(output);
        cancelled(cancel)?;
        if recording::hash_file(&source)? != saved.sha256 {
            return Err("The original recording changed during preparation. Retry after checking the recording.".into());
        }
        let audio = PreparedAudio {
            version: 1,
            asset_id: asset_id.into(),
            source_sha256: saved.sha256.clone(),
            source_sample_rate: saved.sample_rate,
            source_frames,
            sample_rate: RATE,
            channels: 1,
            frames: target_frames,
            duration_ms: target_frames * 1000 / u64::from(RATE),
            bytes: 44 + target_frames * 2,
            sha256: recording::hash_file(&temporary)?,
            algorithm: PROFILE.into(),
            trimmed_delay_frames: delay,
        };
        verify(&temporary, &audio, &saved)?;
        fs::rename(&temporary, &final_path).map_err(storage_error)?;
        let metadata_part = dir.join("prepared.json.part");
        let mut metadata = File::create(&metadata_part).map_err(storage_error)?;
        serde_json::to_writer(&mut metadata, &audio)
            .map_err(|_| "Cannot save prepared audio metadata.")?;
        metadata.sync_all().map_err(storage_error)?;
        drop(metadata);
        fs::rename(metadata_part, receipt_path).map_err(storage_error)?;
        Ok(audio)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn prepared_path(root: &Path, audio: &PreparedAudio) -> Result<PathBuf> {
    let saved =
        recording::read_saved(root, &audio.asset_id)?.ok_or("Saved recording not found.")?;
    let path = contained(root, &directory(root, &saved).join("audio.wav"))?;
    verify(&path, audio, &saved)?;
    Ok(path)
}

pub(crate) fn convert(
    input: &mut impl Read,
    output: &mut impl Write,
    rate: u32,
    frames: u64,
    cancel: &AtomicBool,
) -> Result<usize> {
    if rate == RATE {
        let mut remaining = frames * 2;
        let mut bytes = [0; 8192];
        while remaining > 0 {
            cancelled(cancel)?;
            let n = remaining.min(bytes.len() as u64) as usize;
            input.read_exact(&mut bytes[..n]).map_err(storage_error)?;
            output.write_all(&bytes[..n]).map_err(storage_error)?;
            remaining -= n as u64;
        }
        return Ok(0);
    }
    // Odd output FFT sizes have a fractional sample of filter delay. Choose
    // an even output block so integer delay trimming preserves the time origin.
    let (mut a, mut b) = (rate as usize, RATE as usize);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    let input_step = rate as usize / a;
    let output_step = RATE as usize / a;
    let mut blocks = 1024usize.div_ceil(input_step);
    if blocks * output_step % 2 != 0 {
        blocks += 1;
    }
    let mut resampler =
        FftFixedInOut::<f64>::new(rate as usize, RATE as usize, blocks * input_step, 1)
            .map_err(|_| "The saved sample rate cannot be converted.")?;
    let delay = resampler.output_delay();
    let block_size = resampler.input_frames_next();
    let mut block = vec![vec![0.0; block_size]];
    let mut converted = resampler.output_buffer_allocate(true);
    let mut bytes = vec![0; block_size * 2];
    let mut remaining = frames;
    let mut seen = 0u64;
    let mut written = 0u64;
    let target = expected_frames(frames, rate);
    while written < target {
        cancelled(cancel)?;
        let n = remaining.min(block_size as u64) as usize;
        input
            .read_exact(&mut bytes[..n * 2])
            .map_err(storage_error)?;
        for (i, sample) in block[0].iter_mut().enumerate() {
            *sample = if i < n {
                f64::from(i16::from_le_bytes([bytes[2 * i], bytes[2 * i + 1]])) / 32768.0
            } else {
                0.0
            };
        }
        remaining -= n as u64;
        let (_, produced) = resampler
            .process_into_buffer(&block, &mut converted, None)
            .map_err(|_| "Audio conversion failed; the original is preserved.")?;
        for sample in &converted[0][..produced] {
            if seen >= delay as u64 && written < target {
                let pcm = (sample * 32768.0).round().clamp(-32768.0, 32767.0) as i16;
                output
                    .write_all(&pcm.to_le_bytes())
                    .map_err(storage_error)?;
                written += 1;
            }
            seen += 1;
        }
    }
    Ok(delay)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::{manifest, TestRoot};
    use std::f64::consts::TAU;

    fn converted(rate: u32, samples: &[i16]) -> Vec<i16> {
        let input: Vec<u8> = samples.iter().flat_map(|v| v.to_le_bytes()).collect();
        let mut output = Vec::new();
        convert(
            &mut input.as_slice(),
            &mut output,
            rate,
            samples.len() as u64,
            &AtomicBool::new(false),
        )
        .unwrap();
        output
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect()
    }

    #[test]
    fn duration_identity_and_short_final_blocks() {
        for rate in [8000, 16000, 44100, 48000, 96000, 192000] {
            for frames in [1, 37, 1024, rate as usize + 173] {
                let samples = vec![2345; frames];
                let output = converted(rate, &samples);
                assert_eq!(output.len() as u64, expected_frames(frames as u64, rate));
                if rate == RATE {
                    assert_eq!(output, samples);
                }
            }
        }
    }

    #[test]
    fn impulses_preserve_original_time_including_the_final_sample() {
        for rate in [8000, 44100, 48000, 96000] {
            let frames = rate as usize + 173;
            for position in [0, frames / 2, frames - 2] {
                let mut samples = vec![0; frames];
                samples[position] = 28000;
                let output = converted(rate, &samples);
                let peak = output
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, v)| v.unsigned_abs())
                    .unwrap()
                    .0;
                let expected =
                    (position as f64 * f64::from(RATE) / f64::from(rate)).round() as usize;
                assert!(
                    peak.abs_diff(expected) <= 1,
                    "{rate}: {position} -> {peak}, expected {expected}"
                );
                assert!(
                    output[peak].unsigned_abs() > 1000,
                    "{rate}: impulse at {position}, peak {peak} amplitude {}",
                    output[peak]
                );
            }
        }
    }

    #[test]
    fn rejects_aliasing_above_target_nyquist_and_preserves_speech_band() {
        let tone = |hz: f64| {
            (0..48000)
                .map(|i| (12000.0 * (TAU * hz * i as f64 / 48000.0).sin()) as i16)
                .collect::<Vec<_>>()
        };
        let rms = |v: &[i16]| {
            (v[1000..v.len() - 1000]
                .iter()
                .map(|v| f64::from(*v).powi(2))
                .sum::<f64>()
                / (v.len() - 2000) as f64)
                .sqrt()
        };
        let pass = rms(&converted(48000, &tone(1000.0)));
        let stop = rms(&converted(48000, &tone(12000.0)));
        assert!((8000.0..9000.0).contains(&pass), "passband RMS {pass}");
        assert!(
            stop / pass < 0.01,
            "alias rejection: pass {pass}, stop {stop}"
        );
    }

    #[test]
    fn prepared_cache_is_verified_regenerated_and_preserves_original() {
        let root = TestRoot::new();
        let mut writer = recording::ChunkWriter::create(&root.0, &manifest("resample")).unwrap();
        for n in 0..48017 {
            writer.push(if n == 24000 { 25000 } else { 0 }).unwrap();
        }
        writer.flush().unwrap();
        let saved = recording::finalize(&root.0, "resample", false).unwrap();
        let original = fs::read(recording::playback_path(&root.0, "resample").unwrap()).unwrap();
        let audio = prepare(&root.0, "resample", &AtomicBool::new(false)).unwrap();
        let path = prepared_path(&root.0, &audio).unwrap();
        let first = fs::read(&path).unwrap();
        assert_eq!(audio.source_sha256, saved.sha256);
        assert_eq!(audio.frames, 16006);
        assert_eq!(
            prepare(&root.0, "resample", &AtomicBool::new(false))
                .unwrap()
                .sha256,
            audio.sha256
        );
        fs::write(&path, b"broken cache").unwrap();
        let rebuilt = prepare(&root.0, "resample", &AtomicBool::new(false)).unwrap();
        assert_eq!(
            fs::read(prepared_path(&root.0, &rebuilt).unwrap()).unwrap(),
            first
        );
        assert_eq!(
            fs::read(recording::playback_path(&root.0, "resample").unwrap()).unwrap(),
            original
        );
        assert!(prepare(&root.0, "../outside", &AtomicBool::new(false)).is_err());
        assert!(prepare(&root.0, "resample", &AtomicBool::new(true)).is_err());
    }
}
