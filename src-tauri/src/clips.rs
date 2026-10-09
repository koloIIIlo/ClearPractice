//! Reference clips for Listen and imitate (plan 4.4, 4.4a). A clip is a short
//! mono WAV under `clips/<id>/audio.wav` with a database record (title, source
//! or credit, optional transcript). User clips are imported from a local file:
//! decoded natively, staged whole for preview, then trimmed to 3–30 seconds.
//! Nothing is uploaded; the user is responsible for the right to keep a clip.
use crate::audio::prepare::contained;
use crate::storage::recording::{self, hash_file, wav_header};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    errors::Error as DecodeError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

type Result<T> = std::result::Result<T, String>;

pub const MIN_CLIP_MS: u64 = 3_000;
pub const MAX_CLIP_MS: u64 = 30_000;
/// Longer sources should be trimmed elsewhere first; this bounds memory and disk.
const MAX_SOURCE_SECONDS: u64 = 15 * 60;
const MAX_SOURCE_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub staging_id: String,
    pub file_name: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub origin: String,
    pub title: String,
    pub source: String,
    pub transcript: Option<String>,
    pub description: Option<String>,
    /// emphasis, rhythm or endings
    pub feature: Option<String>,
    pub duration_ms: u64,
    pub sha256: String,
    pub created_at_ms: u64,
    /// Library folder (4.4h); `None` = unfiled.
    pub folder_id: Option<String>,
    /// The imported recording and range it was cut from (4.4i).
    pub source_id: Option<String>,
    pub source_start_ms: Option<u64>,
    pub source_end_ms: Option<u64>,
}

/// Decodes any supported file (WAV, MP3, M4A/AAC, FLAC, OGG Vorbis) to mono f32.
pub fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    let size = fs::metadata(path).map_err(|_| "The file cannot be read.")?.len();
    if size > MAX_SOURCE_BYTES {
        return Err("This file is too large. Trim it to a few minutes first.".into());
    }
    let file = File::open(path).map_err(|_| "The file cannot be read.")?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|_| "This file is not a supported audio format (WAV, MP3, M4A, FLAC or OGG).")?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("This file has no audio track.")?;
    let track_id = track.id;
    let rate = track.codec_params.sample_rate.ok_or("The audio sample rate is unknown.")?;
    if !(8_000..=192_000).contains(&rate) {
        return Err("The audio sample rate is not supported.".into());
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "This audio codec is not supported.")?;
    let limit = (u64::from(rate) * MAX_SOURCE_SECONDS) as usize;
    let mut mono = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(DecodeError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(DecodeError::ResetRequired) => break,
            Err(_) => return Err("The audio file is damaged.".into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buffer) => {
                let spec = *buffer.spec();
                let channels = spec.channels.count().max(1);
                let mut samples = SampleBuffer::<f32>::new(buffer.capacity() as u64, spec);
                samples.copy_interleaved_ref(buffer);
                mono.extend(samples.samples().chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32));
                if mono.len() > limit {
                    return Err("This file is longer than 15 minutes. Trim it first.".into());
                }
            }
            Err(DecodeError::DecodeError(_)) => continue, // skip a corrupt frame
            Err(_) => return Err("The audio file could not be decoded.".into()),
        }
    }
    if mono.is_empty() {
        return Err("The file contains no audio.".into());
    }
    Ok((mono, rate))
}

fn write_wav(path: &Path, samples: &[f32], rate: u32) -> Result<()> {
    let bytes = u32::try_from(samples.len() * 2).map_err(|_| "The clip is too long.")?;
    let part = path.with_extension("part");
    let mut file = File::create(&part).map_err(|_| "Cannot write the clip.")?;
    let mut data = Vec::with_capacity(44 + samples.len() * 2);
    data.extend_from_slice(&wav_header(rate, bytes));
    for s in samples {
        data.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    file.write_all(&data).and_then(|_| file.sync_all()).map_err(|_| "Cannot write the clip.")?;
    drop(file);
    fs::rename(&part, path).map_err(|_| "Cannot write the clip.".into())
}

fn read_wav(path: &Path) -> Result<(Vec<f32>, u32)> {
    let mut bytes = Vec::new();
    File::open(path).and_then(|mut f| f.read_to_end(&mut bytes)).map_err(|_| "The staged clip is unavailable. Choose the file again.")?;
    if bytes.len() < 44 || &bytes[..4] != b"RIFF" {
        return Err("The staged clip is damaged. Choose the file again.".into());
    }
    let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    Ok((bytes[44..].chunks_exact(2).map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0).collect(), rate))
}

pub fn staging_dir(root: &Path, staging_id: &str) -> Result<PathBuf> {
    recording::validate_id(staging_id)?;
    Ok(root.join("cache").join("clip-staging").join(staging_id))
}

pub fn clip_path(root: &Path, id: &str) -> Result<PathBuf> {
    recording::validate_id(id)?;
    Ok(root.join("clips").join(id).join("audio.wav"))
}

/// What a staged recording is and where it came from (4.4i). Written next to
/// the staged audio; once the recording is transcribed it becomes a source in
/// the import history, and `source_id` links the staging copy to it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageMeta {
    /// "file" or "link"
    pub origin: String,
    pub file_name: String,
    pub title: String,
    pub link: Option<String>,
    pub credit: String,
    pub duration_ms: u64,
    /// The untouched original (compressed formats stay small) kept for the history.
    pub original: Option<String>,
    pub source_id: Option<String>,
}

const AUDIO_EXTENSIONS: [&str; 8] = ["wav", "mp3", "m4a", "aac", "mp4", "flac", "ogg", "oga"];

pub fn read_meta(root: &Path, staging_id: &str) -> Result<StageMeta> {
    let dir = staging_dir(root, staging_id)?;
    contained(root, &dir)?;
    serde_json::from_slice(&fs::read(dir.join("meta.json")).map_err(|_| "This recording is no longer staged. Choose it again.")?)
        .map_err(|_| "This recording's details are damaged. Choose it again.".into())
}

pub fn write_meta(root: &Path, staging_id: &str, meta: &StageMeta) -> Result<()> {
    let dir = staging_dir(root, staging_id)?;
    contained(root, &dir)?;
    fs::write(dir.join("meta.json"), serde_json::to_vec(meta).map_err(|e| e.to_string())?).map_err(|_| "Cannot keep the recording's details.".into())
}

/// Decodes the chosen file into a whole mono copy for preview and trimming, and
/// keeps the original next to it for the import history.
pub fn stage(root: &Path, file: &Path) -> Result<Staged> {
    let file_name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let title = file.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = StageMeta { origin: "file".into(), file_name, title, ..Default::default() };
    stage_with(root, file, meta, true)
}

/// Stages `file` with the given details. `keep_original` copies the file in
/// (fresh imports); a source reopened from the history already keeps its own.
pub fn stage_with(root: &Path, file: &Path, mut meta: StageMeta, keep_original: bool) -> Result<Staged> {
    let (samples, rate) = decode_mono(file)?;
    let now = recording::now_ms();
    let mut n = 0u32;
    let (staging_id, dir) = loop {
        let id = if n == 0 { format!("stage-{now}") } else { format!("stage-{now}-{n}") };
        let dir = staging_dir(root, &id)?;
        if !dir.exists() {
            break (id, dir);
        }
        n += 1;
    };
    fs::create_dir_all(&dir).map_err(|_| "Cannot prepare the clip.")?;
    contained(root, &dir)?;
    write_wav(&dir.join("full.wav"), &samples, rate)?;
    meta.duration_ms = samples.len() as u64 * 1000 / u64::from(rate);
    if keep_original {
        let ext = file.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).filter(|e| AUDIO_EXTENSIONS.contains(&e.as_str()));
        if let Some(ext) = ext {
            let name = format!("original.{ext}");
            // Without the original the recording can still be cut now; it just
            // cannot be reopened from the history later.
            if fs::copy(file, dir.join(&name)).is_ok() {
                meta.original = Some(name);
            }
        }
    }
    write_meta(root, &staging_id, &meta)?;
    Ok(Staged { staging_id, file_name: meta.file_name.clone(), duration_ms: meta.duration_ms })
}

pub fn discard_staging(root: &Path, staging_id: &str) {
    if let Ok(dir) = staging_dir(root, staging_id) {
        if contained(root, &dir).is_ok() {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

pub struct ClipDetails<'a> {
    pub title: &'a str,
    pub source: &'a str,
    pub transcript: Option<&'a str>,
    pub description: Option<&'a str>,
    pub feature: Option<&'a str>,
}

impl ClipDetails<'_> {
    fn validate(&self) -> Result<()> {
        let bad = |s: &str, max: usize| s.len() > max || s.contains('\0');
        if self.feature.is_some_and(|f| !["emphasis", "rhythm", "endings"].contains(&f)) || self.description.is_some_and(|d| bad(d, 300)) {
            return Err("Keep the description under 300 characters and choose emphasis, rhythm or endings.".into());
        }
        if self.title.trim().is_empty() || bad(self.title, 200) || bad(self.source, 500) || self.transcript.is_some_and(|t| bad(t, 4000)) {
            return Err("Give the clip a title (up to 200 characters); keep the source under 500 and the transcript under 4,000.".into());
        }
        Ok(())
    }
}

/// A staged recording's decoded audio, read once for several clips.
pub struct StagedAudio {
    samples: Vec<f32>,
    rate: u32,
}

pub fn load_staged(root: &Path, staging_id: &str) -> Result<StagedAudio> {
    let dir = staging_dir(root, staging_id)?;
    contained(root, &dir)?;
    let (samples, rate) = read_wav(&dir.join("full.wav"))?;
    Ok(StagedAudio { samples, rate })
}

/// Keeps `start_ms..end_ms` of a staged file as a new clip and removes the staging copy.
pub fn commit(root: &Path, staging_id: &str, start_ms: u64, end_ms: u64, details: &ClipDetails, origin: &str, keep_staging: bool) -> Result<Clip> {
    let audio = load_staged(root, staging_id)?;
    let clip = commit_from(root, &audio, start_ms, end_ms, details, origin)?;
    if !keep_staging {
        discard_staging(root, staging_id);
    }
    Ok(clip)
}

/// Cuts one clip from already loaded staged audio (several clips, one read).
pub fn commit_from(root: &Path, audio: &StagedAudio, start_ms: u64, end_ms: u64, details: &ClipDetails, origin: &str) -> Result<Clip> {
    details.validate()?;
    if end_ms <= start_ms || end_ms - start_ms < MIN_CLIP_MS || end_ms - start_ms > MAX_CLIP_MS {
        return Err("Keep a section between 3 and 30 seconds long.".into());
    }
    let (samples, rate) = (&audio.samples, audio.rate);
    let at = |ms: u64| ((ms * u64::from(rate) / 1000) as usize).min(samples.len());
    let (from, to) = (at(start_ms), at(end_ms));
    if to <= from || ((to - from) as u64) * 1000 / u64::from(rate) < MIN_CLIP_MS {
        return Err("That section is outside the file. Choose times within its length.".into());
    }
    let now = recording::now_ms();
    // Several clips can be cut from one file within the same millisecond.
    let mut n = 0u32;
    let id = loop {
        let candidate = if n == 0 { format!("clip-{now}") } else { format!("clip-{now}-{n}") };
        if !clip_path(root, &candidate)?.parent().is_some_and(Path::exists) {
            break candidate;
        }
        n += 1;
    };
    let path = clip_path(root, &id)?;
    let clip_dir = path.parent().ok_or("Cannot store the clip.")?;
    fs::create_dir_all(clip_dir).map_err(|_| "Cannot store the clip.")?;
    contained(root, clip_dir)?;
    write_wav(&path, &samples[from..to], rate)?;
    Ok(Clip {
        id,
        origin: origin.into(),
        title: details.title.trim().into(),
        source: details.source.trim().into(),
        transcript: details.transcript.map(str::trim).filter(|t| !t.is_empty()).map(String::from),
        description: details.description.map(str::trim).filter(|t| !t.is_empty()).map(String::from),
        feature: details.feature.map(String::from),
        duration_ms: ((to - from) as u64) * 1000 / u64::from(rate),
        sha256: hash_file(&path)?,
        created_at_ms: now,
        folder_id: None,
        source_id: None,
        source_start_ms: None,
        source_end_ms: None,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledManifest {
    clips: Vec<BundledEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledEntry {
    id: String,
    file: String,
    sha256: String,
    title: String,
    source: String,
    transcript: Option<String>,
    #[serde(default)]
    feature: Option<String>,
}

/// Installs the bundled clips (4.4) listed in `dir/manifest.json` that are not
/// installed yet. Each source file must match its manifest checksum; it is
/// decoded once into the same mono WAV form as imported clips. Returns how many
/// were installed. A bad entry is skipped and reported, never half-installed.
pub fn install_bundled(
    root: &Path,
    dir: &Path,
    installed: impl Fn(&str) -> bool,
    mut insert: impl FnMut(&Clip) -> Result<()>,
) -> Result<(usize, Vec<String>)> {
    let manifest: BundledManifest = serde_json::from_slice(&fs::read(dir.join("manifest.json")).map_err(|_| "The bundled clip list is missing.")?)
        .map_err(|_| "The bundled clip list is damaged.")?;
    let (mut count, mut problems) = (0, Vec::new());
    for entry in manifest.clips {
        if recording::validate_id(&entry.id).is_err() || entry.file.contains(['/', '\\']) || installed(&entry.id) {
            continue;
        }
        let result = (|| {
            let file = dir.join(&entry.file);
            if format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(fs::read(&file).map_err(|_| "missing file")?)) != entry.sha256 {
                return Err("checksum mismatch".to_string());
            }
            let (samples, rate) = decode_mono(&file)?;
            let path = clip_path(root, &entry.id)?;
            let clip_dir = path.parent().ok_or("bad path")?;
            fs::create_dir_all(clip_dir).map_err(|_| "Cannot store the clip.")?;
            contained(root, clip_dir)?;
            write_wav(&path, &samples, rate)?;
            let clip = Clip {
                id: entry.id.clone(),
                origin: "bundled".into(),
                title: entry.title.clone(),
                source: entry.source.clone(),
                transcript: entry.transcript.clone(),
                description: None,
                feature: entry.feature.as_deref().and_then(|f| match f.to_ascii_lowercase().as_str() {
                    "emphasis" => Some("emphasis".to_string()),
                    "phrase rhythm" | "rhythm" => Some("rhythm".to_string()),
                    "clear endings" | "endings" => Some("endings".to_string()),
                    _ => None,
                }),
                duration_ms: samples.len() as u64 * 1000 / u64::from(rate),
                sha256: hash_file(&path)?,
                created_at_ms: recording::now_ms(),
                folder_id: None,
                source_id: None,
                source_start_ms: None,
                source_end_ms: None,
            };
            insert(&clip).inspect_err(|_| {
                let _ = remove_files(root, &entry.id);
            })
        })();
        match result {
            Ok(()) => count += 1,
            Err(error) => problems.push(format!("{}: {error}", entry.id)),
        }
    }
    Ok((count, problems))
}

// ── Pitch lines for reference clips (plan P.6) ──────────────────────────────

/// The contour a clip's pitch line is drawn from, kept in `cache/clip-prosody/`
/// under the clip's checksum and the algorithm version, so a changed clip or a
/// new pitch tracker is measured again and old results are never reused.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedContour {
    hop_ms: u64,
    sample_rate: u32,
    f0_hz: Vec<Option<f32>>,
    rms_db: Vec<Option<f32>>,
    median_f0_hz: Option<f32>,
    range_semitones: Option<f32>,
    loudness_range_db: Option<f32>,
    unavailable_reason: Option<String>,
}

fn contour_cache(root: &Path, id: &str, sha256: &str) -> Result<PathBuf> {
    recording::validate_id(id)?;
    if sha256.len() < 16 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("The clip's checksum is invalid.".into());
    }
    Ok(root.join("cache").join("clip-prosody").join(format!(
        "{id}--{}-{}-d{}.json",
        &sha256[..16],
        crate::prosody::ALGORITHM,
        crate::prosody::DEFINITION_VERSION
    )))
}

/// The pitch and loudness contour of a clip (16 kHz analysis on the clip's own
/// timeline). Measured once and kept; later calls read the kept result.
pub fn clip_contour(root: &Path, id: &str, sha256: &str) -> Result<crate::prosody::Contour> {
    use crate::prosody::{self as p, Contour};
    let cache = contour_cache(root, id, sha256)?;
    let from = |c: CachedContour| Contour {
        algorithm: p::ALGORITHM,
        source: "Estimated",
        hop_ms: c.hop_ms,
        sample_rate: c.sample_rate,
        f0_hz: c.f0_hz,
        rms_db: c.rms_db,
        median_f0_hz: c.median_f0_hz,
        range_semitones: c.range_semitones,
        loudness_range_db: c.loudness_range_db,
        unavailable_reason: c.unavailable_reason,
    };
    if let Ok(cached) = fs::read(&cache).map_err(|_| ()).and_then(|b| serde_json::from_slice::<CachedContour>(&b).map_err(|_| ())) {
        return Ok(from(cached));
    }
    let path = clip_path(root, id)?;
    contained(root, &path)?;
    let mut bytes = Vec::new();
    File::open(&path).and_then(|mut f| f.read_to_end(&mut bytes)).map_err(|_| "This clip's audio is unavailable.")?;
    if bytes.len() < 44 || &bytes[..4] != b"RIFF" {
        return Err("This clip's audio is damaged.".into());
    }
    let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    let pcm = &bytes[44..];
    let mut speech = Vec::new();
    crate::audio::prepare::convert(&mut &pcm[..], &mut speech, rate, (pcm.len() / 2) as u64, &std::sync::atomic::AtomicBool::new(false))?;
    let samples: Vec<f32> = speech.chunks_exact(2).map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0).collect();
    let mut contour = p::contour(&samples, crate::audio::prepare::RATE);
    // Stored precision, so a fresh result equals a kept one (as for takes).
    let (f0, rms) = p::decode_frames(&p::encode_frames(&contour))?;
    contour.f0_hz = f0;
    contour.rms_db = rms;
    let kept = CachedContour {
        hop_ms: contour.hop_ms,
        sample_rate: contour.sample_rate,
        f0_hz: contour.f0_hz.clone(),
        rms_db: contour.rms_db.clone(),
        median_f0_hz: contour.median_f0_hz,
        range_semitones: contour.range_semitones,
        loudness_range_db: contour.loudness_range_db,
        unavailable_reason: contour.unavailable_reason.clone(),
    };
    if let Some(dir) = cache.parent() {
        if fs::create_dir_all(dir).is_ok() && contained(root, dir).is_ok() {
            let part = cache.with_extension("part");
            if fs::write(&part, serde_json::to_vec(&kept).map_err(|e| e.to_string())?).is_ok() {
                let _ = fs::rename(&part, &cache);
            }
        }
    }
    Ok(contour)
}

/// Removes a clip's files (after its record is deleted).
pub fn remove_files(root: &Path, id: &str) -> Result<()> {
    let path = clip_path(root, id)?;
    if let Some(dir) = path.parent().filter(|d| d.exists()) {
        contained(root, dir)?;
        fs::remove_dir_all(dir).map_err(|_| "Cannot remove the clip files.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn tone_wav(path: &Path, seconds: u32, rate: u32, channels: u16) {
        let frames = (seconds * rate) as usize;
        let mut data = Vec::new();
        for i in 0..frames {
            let s = ((i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 12_000.0) as i16;
            for _ in 0..channels {
                data.extend_from_slice(&s.to_le_bytes());
            }
        }
        let mut h = wav_header(rate, data.len() as u32);
        h[22..24].copy_from_slice(&channels.to_le_bytes());
        h[28..32].copy_from_slice(&(rate * 2 * u32::from(channels)).to_le_bytes());
        h[32..34].copy_from_slice(&(2 * channels).to_le_bytes());
        let mut file = File::create(path).unwrap();
        file.write_all(&h).unwrap();
        file.write_all(&data).unwrap();
    }

    #[test]
    fn a_clips_pitch_line_is_measured_once_and_kept_under_its_checksum() {
        let root = recording::tests::TestRoot::new();
        // 2 s of a 150 Hz voice at 48 kHz, as an installed clip.
        let rate = 48_000u32;
        let mut phase = 0.0f64;
        let samples: Vec<f32> = (0..rate * 2)
            .map(|_| {
                phase += std::f64::consts::TAU * 150.0 / f64::from(rate);
                ((1..=5).map(|h| (phase * h as f64).sin() / h as f64).sum::<f64>() * 0.25) as f32
            })
            .collect();
        let path = clip_path(&root.0, "clip-tone").unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_wav(&path, &samples, rate).unwrap();
        let sha = hash_file(&path).unwrap();
        let first = clip_contour(&root.0, "clip-tone", &sha).unwrap();
        assert_eq!(first.sample_rate, 16_000);
        let median = first.median_f0_hz.unwrap();
        assert!((median - 150.0).abs() < 3.0, "{median}");
        assert!(contour_cache(&root.0, "clip-tone", &sha).unwrap().is_file());
        // Kept: the audio can go away and the same contour still comes back.
        fs::remove_file(&path).unwrap();
        assert_eq!(clip_contour(&root.0, "clip-tone", &sha).unwrap(), first);
        // A different checksum is a different clip version: measured again (and fails here).
        assert!(clip_contour(&root.0, "clip-tone", &"f".repeat(64)).is_err());
        assert!(contour_cache(&root.0, "../x", &sha).is_err());
    }

    #[test]
    fn imports_a_stereo_file_trims_it_to_mono_and_rejects_bad_ranges() {
        let root = TestRoot::new();
        let source = root.0.join("talk.wav");
        tone_wav(&source, 40, 44_100, 2);
        let staged = stage(&root.0, &source).unwrap();
        assert_eq!(staged.file_name, "talk.wav");
        assert_eq!(staged.duration_ms, 40_000);
        let details = ClipDetails { title: "Opening", source: "My recording", transcript: Some(" Hello there. "), description: None, feature: Some("emphasis") };
        assert!(commit(&root.0, &staged.staging_id, 0, 2_000, &details, "user", false).is_err(), "too short");
        assert!(commit(&root.0, &staged.staging_id, 0, 31_000, &details, "user", false).is_err(), "too long");
        assert!(commit(&root.0, &staged.staging_id, 1_000, 11_000, &ClipDetails { title: " ", ..details }, "user", false).is_err(), "needs a title");
        let clip = commit(&root.0, &staged.staging_id, 5_000, 17_500, &details, "user", false).unwrap();
        assert_eq!(clip.duration_ms, 12_500);
        assert_eq!(clip.transcript.as_deref(), Some("Hello there."));
        let (samples, rate) = read_wav(&clip_path(&root.0, &clip.id).unwrap()).unwrap();
        assert_eq!((samples.len(), rate), (12_500 * 441 / 10, 44_100), "mono at the source rate");
        assert!(!staging_dir(&root.0, &staged.staging_id).unwrap().exists(), "staging removed");
        remove_files(&root.0, &clip.id).unwrap();
        assert!(!clip_path(&root.0, &clip.id).unwrap().exists());
    }

    #[test]
    fn installs_bundled_clips_once_and_skips_files_that_fail_their_checksum() {
        let root = TestRoot::new();
        let pack = root.0.join("pack");
        fs::create_dir(&pack).unwrap();
        tone_wav(&pack.join("good.wav"), 5, 22_050, 1);
        tone_wav(&pack.join("bad.wav"), 5, 22_050, 1);
        let sha = |p: &Path| format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(fs::read(p).unwrap()));
        let manifest = serde_json::json!({"version": 1, "clips": [
            {"id": "voa-good", "file": "good.wav", "sha256": sha(&pack.join("good.wav")), "title": "Good", "source": "VOA", "transcript": "Hello."},
            {"id": "voa-bad", "file": "bad.wav", "sha256": "0".repeat(64), "title": "Bad", "source": "VOA", "transcript": null},
            {"id": "voa-escape", "file": "../x.wav", "sha256": "0".repeat(64), "title": "Escape", "source": "VOA", "transcript": null}
        ]});
        fs::write(pack.join("manifest.json"), manifest.to_string()).unwrap();
        let installed = std::cell::RefCell::new(Vec::<Clip>::new());
        let (count, problems) = install_bundled(&root.0, &pack, |id| installed.borrow().iter().any(|c| c.id == id), |c| { installed.borrow_mut().push(c.clone()); Ok(()) }).unwrap();
        assert_eq!(count, 1);
        assert_eq!(problems, ["voa-bad: checksum mismatch"]);
        let clip = installed.borrow()[0].clone();
        assert_eq!((clip.origin.as_str(), clip.duration_ms, clip.transcript.as_deref()), ("bundled", 5_000, Some("Hello.")));
        assert!(clip_path(&root.0, "voa-good").unwrap().is_file());
        assert!(!clip_path(&root.0, "voa-bad").unwrap().exists());
        // A second start installs nothing new.
        let (again, _) = install_bundled(&root.0, &pack, |id| installed.borrow().iter().any(|c| c.id == id), |_| Ok(())).unwrap();
        assert_eq!(again, 0);
    }

    /// The real bundled pack decodes and matches its manifest.
    #[test]
    fn the_shipped_voa_pack_installs_completely() {
        let root = TestRoot::new();
        let pack = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/clips");
        let mut clips = Vec::new();
        let (count, problems) = install_bundled(&root.0, &pack, |_| false, |c| { clips.push(c.clone()); Ok(()) }).unwrap();
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(count, 10);
        assert!(clips.iter().all(|c| (10_000..=20_000).contains(&c.duration_ms) && c.source.contains("learningenglish.voanews.com")), "{clips:?}");
    }

    #[test]
    fn rejects_files_that_are_not_audio() {
        let root = TestRoot::new();
        let fake = root.0.join("notes.mp3");
        fs::write(&fake, b"definitely not audio").unwrap();
        assert!(stage(&root.0, &fake).unwrap_err().contains("not a supported audio format"));
    }

    /// Real MP3 and M4A decoding, using ffmpeg to make the files:
    /// `cargo test --lib clips -- --ignored`
    #[test]
    #[ignore]
    fn hardware_decodes_mp3_and_m4a_made_by_ffmpeg() {
        let root = TestRoot::new();
        let wav = root.0.join("tone.wav");
        tone_wav(&wav, 6, 48_000, 2);
        for ext in ["mp3", "m4a"] {
            let out = root.0.join(format!("tone.{ext}"));
            let status = std::process::Command::new("ffmpeg").args(["-loglevel", "error", "-y", "-i"]).arg(&wav).arg(&out).status().unwrap();
            assert!(status.success());
            let (samples, rate) = decode_mono(&out).unwrap();
            let seconds = samples.len() as f64 / f64::from(rate);
            assert!((5.9..6.2).contains(&seconds), "{ext}: {seconds} s");
        }
    }
}
