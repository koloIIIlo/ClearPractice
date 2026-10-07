use crate::storage::recording::{self, CaptureManifest, ChunkWriter, SavedRecording};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample,
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
const BLOCK_SAMPLES: usize = 4096;
const QUEUE_BLOCKS: usize = 16;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub attempt_id: String,
    pub idempotency_key: String,
    pub device_id: Option<String>,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub attempt_id: String,
    pub phase: String,
    pub elapsed_ms: u64,
    pub monotonic_ms: u64,
    pub level: f32,
    pub clipping: bool,
    pub error: Option<String>,
    pub asset: Option<SavedRecording>,
}

impl RecordingStatus {
    fn preparing(id: &str) -> Self {
        Self {
            attempt_id: id.into(),
            phase: "preparing".into(),
            elapsed_ms: 0,
            monotonic_ms: 0,
            level: 0.0,
            clipping: false,
            error: None,
            asset: None,
        }
    }
    pub(crate) fn saved(asset: SavedRecording) -> Self {
        Self {
            attempt_id: asset.attempt_id.clone(),
            phase: "saved".into(),
            elapsed_ms: asset.duration_ms,
            monotonic_ms: 0,
            level: 0.0,
            clipping: false,
            error: None,
            asset: Some(asset),
        }
    }
}

pub type EventSink = Arc<dyn Fn(&str, &RecordingStatus) + Send + Sync>;

struct ActiveCapture {
    request: StartRequest,
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<RecordingStatus>>,
    worker: Option<JoinHandle<Result<SavedRecording>>>,
}

pub struct CaptureService {
    pub root: PathBuf,
    active: Mutex<Option<ActiveCapture>>,
    sink: EventSink,
}

impl CaptureService {
    pub fn new(root: PathBuf, sink: EventSink) -> Self {
        Self {
            root,
            active: Mutex::new(None),
            sink,
        }
    }

    pub fn status(&self) -> Result<Option<RecordingStatus>> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        active
            .as_ref()
            .map(|active| {
                active
                    .status
                    .lock()
                    .map(|s| s.clone())
                    .map_err(|_| "Capture state is unavailable.".into())
            })
            .transpose()
    }

    pub fn is_active(&self) -> bool {
        self.status()
            .ok()
            .flatten()
            .is_some_and(|s| matches!(s.phase.as_str(), "preparing" | "recording" | "finalizing"))
    }

    pub fn start(&self, request: StartRequest) -> Result<RecordingStatus> {
        recording::validate_id(&request.attempt_id)?;
        recording::validate_id(&request.idempotency_key)?;
        if request.title.len() > 2000
            || request.device_id.as_ref().is_some_and(|id| id.len() > 1024)
        {
            return Err("The recording request is too large.".into());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        if let Some(previous) = active.as_mut() {
            if previous.request == request {
                return previous
                    .status
                    .lock()
                    .map(|s| s.clone())
                    .map_err(|_| "Capture state is unavailable.".into());
            }
            let status = previous
                .status
                .lock()
                .map_err(|_| "Capture state is unavailable.")?
                .clone();
            if matches!(
                status.phase.as_str(),
                "preparing" | "recording" | "finalizing"
            ) {
                return Err("Another recording is already active. Stop and save it first.".into());
            }
            if let Some(worker) = previous.worker.take() {
                let _ = worker.join();
            }
        }
        if let Some(saved) = recording::read_saved(&self.root, &request.attempt_id)? {
            let manifest = recording::read_manifest(&self.root, &request.attempt_id)?;
            if manifest.idempotency_key != request.idempotency_key {
                return Err("This recording identifier belongs to another operation.".into());
            }
            return Ok(RecordingStatus::saved(saved));
        }
        if self
            .root
            .join("recovery")
            .join(&request.attempt_id)
            .exists()
        {
            return Err(
                "An interrupted take already uses this identifier. Recover it before retrying."
                    .into(),
            );
        }
        let status = Arc::new(Mutex::new(RecordingStatus::preparing(&request.attempt_id)));
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker_status = status.clone();
        let worker_stop = stop.clone();
        let root = self.root.clone();
        let sink = self.sink.clone();
        let worker_request = request.clone();
        let worker = thread::Builder::new()
            .name("clearpractice-capture-writer".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_capture(
                    &root,
                    &worker_request,
                    &worker_stop,
                    &worker_status,
                    &sink,
                    &ready_tx,
                ))).unwrap_or_else(|_| Err("The recording worker stopped unexpectedly. Completed chunks are kept for recovery.".into()));
                if let Err(error) = &result {
                    if let Ok(mut status) = worker_status.lock() {
                        status.phase = "interrupted".into();
                        status.error = Some(error.clone());
                        status.level = 0.0;
                        sink("recording_status", &status);
                    }
                    let _ = ready_tx.try_send(Err(error.clone()));
                }
                result
            })
            .map_err(|_| "Cannot start the recording worker.")?;
        *active = Some(ActiveCapture {
            request,
            stop: stop.clone(),
            status,
            worker: Some(worker),
        });
        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| {
                stop.store(true, Ordering::Release);
                "The microphone did not open in time. Try another device.".to_string()
            })?
    }

    pub fn stop(&self, id: &str) -> Result<SavedRecording> {
        recording::validate_id(id)?;
        // Serialize repeated Stop calls, so only one worker is joined and one receipt is committed.
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        if let Some(capture) = active
            .as_mut()
            .filter(|capture| capture.request.attempt_id == id)
        {
            capture.stop.store(true, Ordering::Release);
            if let Some(worker) = capture.worker.take() {
                return worker.join().map_err(|_| {
                    "Recording stopped unexpectedly. Its chunks are kept for recovery."
                })?;
            }
        }
        recording::read_saved(&self.root, id)?
            .ok_or("This take was interrupted. Recover its completed chunks.".into())
    }

    pub fn recover(&self, id: &str) -> Result<SavedRecording> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        if let Some(capture) = active.as_mut() {
            let status = capture
                .status
                .lock()
                .map_err(|_| "Capture state is unavailable.")?
                .clone();
            if matches!(
                status.phase.as_str(),
                "preparing" | "recording" | "finalizing"
            ) {
                return Err("Stop the active recording before recovering another take.".into());
            }
            if let Some(worker) = capture.worker.take() {
                let _ = worker.join();
            }
        }
        let saved = recording::finalize(&self.root, id, true)?;
        if let Some(capture) = active
            .as_ref()
            .filter(|capture| capture.request.attempt_id == id)
        {
            *capture
                .status
                .lock()
                .map_err(|_| "Capture state is unavailable.")? =
                RecordingStatus::saved(saved.clone());
        }
        (self.sink)("recording_saved", &RecordingStatus::saved(saved.clone()));
        Ok(saved)
    }
}

// Fixed capacity both per block and per queue. No allocation, blocking sends, disk
// access, or UI events occur in the device callback. Overrun is an explicit failure.
struct AudioBlock {
    samples: [f32; BLOCK_SAMPLES],
    len: usize,
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    tx: SyncSender<AudioBlock>,
    fault: Arc<AtomicU8>,
    stop: Arc<AtomicBool>,
) -> Result<cpal::Stream>
where
    T: SizedSample + Sample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let block_size = (BLOCK_SAMPLES / channels) * channels;
    let error_fault = fault.clone();
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data, _| {
                if stop.load(Ordering::Acquire) || fault.load(Ordering::Relaxed) != 0 {
                    return;
                }
                if data.len() % channels != 0 {
                    fault.store(3, Ordering::Release);
                    return;
                }
                for data in data.chunks(block_size) {
                    let mut block = AudioBlock {
                        samples: [0.0; BLOCK_SAMPLES],
                        len: data.len(),
                    };
                    for (output, sample) in block.samples.iter_mut().zip(data) {
                        *output = f32::from_sample(*sample);
                    }
                    if tx.try_send(block).is_err() {
                        fault.store(2, Ordering::Release);
                        break;
                    }
                }
            },
            move |error| {
                // CPAL documents these as notifications while the stream remains active.
                if matches!(error.kind(), cpal::ErrorKind::RealtimeDenied | cpal::ErrorKind::DeviceChanged) { return; }
                #[cfg(test)]
                eprintln!("Capture diagnostic: {error}");
                error_fault.store(if error.kind() == cpal::ErrorKind::Xrun { 2 } else { 1 }, Ordering::Release);
            },
            None,
        )
        .map_err(|error| {
            format!("Cannot open this microphone ({:?}). Check microphone permissions or select another device.", error.kind())
        })
}

fn pcm(sample: f32) -> i16 {
    if !sample.is_finite() {
        return 0;
    }
    (sample.clamp(-1.0, 1.0) * 32768.0)
        .round()
        .clamp(-32768.0, 32767.0) as i16
}

fn write_block(
    writer: &mut ChunkWriter,
    block: AudioBlock,
    channels: usize,
) -> Result<(f32, bool)> {
    let mut sum_squares = 0.0f64;
    let mut clipping = false;
    for frame in block.samples[..block.len].chunks_exact(channels) {
        let mono = frame
            .iter()
            .map(|&s| if s.is_finite() { s } else { 0.0 })
            .sum::<f32>()
            / channels as f32;
        sum_squares += f64::from(mono).powi(2);
        clipping |= frame.iter().any(|s| s.abs() >= 0.995);
        writer.push(pcm(mono))?;
    }
    let frames = block.len / channels;
    let rms = if frames == 0 {
        0.0
    } else {
        (sum_squares / frames as f64).sqrt() as f32
    };
    Ok((rms.clamp(0.0, 1.0), clipping))
}

fn run_capture(
    root: &std::path::Path,
    request: &StartRequest,
    stop: &AtomicBool,
    shared: &Mutex<RecordingStatus>,
    sink: &EventSink,
    ready: &SyncSender<Result<RecordingStatus>>,
) -> Result<SavedRecording> {
    let host = cpal::default_host();
    let device = match &request.device_id {
        Some(id) => host.device_by_id(&id.parse().map_err(|_| "Invalid microphone identifier.")?),
        None => host.default_input_device(),
    }
    .ok_or("The selected microphone is unavailable. Select another device.")?;
    let supported = device
        .default_input_config()
        .map_err(|_| "Cannot read the microphone format.")?;
    let config: cpal::StreamConfig = supported.clone().into();
    if !(1..=32).contains(&config.channels) || !(8_000..=192_000).contains(&config.sample_rate) {
        return Err("This microphone format is unsupported. Select another device.".into());
    }
    let manifest = CaptureManifest {
        version: 1,
        attempt_id: request.attempt_id.clone(),
        idempotency_key: request.idempotency_key.clone(),
        title: request.title.clone(),
        device_id: device
            .id()
            .map_err(|_| "Microphone disconnected.")?
            .to_string(),
        device_name: device.to_string(),
        sample_rate: config.sample_rate,
        source_channels: config.channels,
        source_format: format!("{:?}", supported.sample_format()),
        created_at_ms: recording::now_ms(),
    };
    let mut writer = ChunkWriter::create(root, &manifest)?;
    let (tx, rx): (SyncSender<AudioBlock>, Receiver<AudioBlock>) = mpsc::sync_channel(QUEUE_BLOCKS);
    let fault = Arc::new(AtomicU8::new(0));
    // The callback uses its own shared stop flag; the controller flag is checked by this worker.
    let callback_stop = Arc::new(AtomicBool::new(false));
    let stream = match supported.sample_format() {
        SampleFormat::F32 => {
            build_stream::<f32>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::F64 => {
            build_stream::<f64>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::I8 => {
            build_stream::<i8>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::I16 => {
            build_stream::<i16>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::I32 => {
            build_stream::<i32>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::I64 => {
            build_stream::<i64>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::U8 => {
            build_stream::<u8>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::U16 => {
            build_stream::<u16>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::U32 => {
            build_stream::<u32>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        SampleFormat::U64 => {
            build_stream::<u64>(&device, config, tx, fault.clone(), callback_stop.clone())
        }
        _ => Err("This microphone sample format is unsupported. Select another device.".into()),
    }?;
    stream
        .play()
        .map_err(|_| "Cannot start the microphone. Check Windows microphone permissions.")?;
    let started = Instant::now();
    {
        let mut status = shared.lock().map_err(|_| "Capture state is unavailable.")?;
        status.phase = "recording".into();
        sink("recording_status", &status);
        let _ = ready.try_send(Ok(status.clone()));
    }
    let mut last_event = Instant::now();
    let mut last_audio = Instant::now();
    let mut clipping = false;
    let mut peak_level = 0.0f32;
    let mut write_error = None;
    while !stop.load(Ordering::Acquire) && fault.load(Ordering::Acquire) == 0 {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(block) => {
                match write_block(&mut writer, block, manifest.source_channels as usize) {
                    Ok((level, clipped)) => {
                        peak_level = peak_level.max(level);
                        clipping |= clipped;
                    }
                    Err(error) => {
                        write_error = Some(error);
                        break;
                    }
                }
                last_audio = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fault.store(1, Ordering::Release);
            }
            Err(mpsc::RecvTimeoutError::Timeout)
                if last_audio.elapsed() > Duration::from_secs(3) =>
            {
                fault.store(1, Ordering::Release);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if last_event.elapsed() >= Duration::from_millis(100) {
            let mut status = shared.lock().map_err(|_| "Capture state is unavailable.")?;
            status.elapsed_ms = writer.frames * 1000 / u64::from(manifest.sample_rate);
            status.monotonic_ms = started.elapsed().as_millis() as u64;
            status.level = peak_level;
            status.clipping = clipping;
            sink("recording_level", &status);
            last_event = Instant::now();
            peak_level = 0.0;
            clipping = false;
        }
    }
    callback_stop.store(true, Ordering::Release);
    drop(stream); // Microphone is closed before finalization or a failure is reported.
    if write_error.is_none() {
        for block in rx.try_iter() {
            if let Err(error) = write_block(&mut writer, block, manifest.source_channels as usize) {
                write_error = Some(error);
                break;
            }
        }
    }
    if write_error.is_none() {
        writer.flush()?;
    }
    {
        let mut status = shared.lock().map_err(|_| "Capture state is unavailable.")?;
        status.elapsed_ms = writer.frames * 1000 / u64::from(manifest.sample_rate);
        status.monotonic_ms = started.elapsed().as_millis() as u64;
        status.level = 0.0;
    }
    if let Some(error) = write_error {
        return Err(error);
    }
    match fault.load(Ordering::Acquire) {
        1 => return Err("The microphone disconnected or stopped sending audio. Completed chunks are recoverable.".into()),
        2 => return Err("Recording could not keep up with incoming audio. The take was stopped; completed chunks are recoverable.".into()),
        3 => return Err("The microphone returned incomplete audio frames. Completed chunks are recoverable.".into()),
        _ => {},
    }
    {
        let mut status = shared.lock().map_err(|_| "Capture state is unavailable.")?;
        status.phase = "finalizing".into();
        sink("recording_status", &status);
    }
    let saved = recording::finalize(root, &request.attempt_id, false)?;
    {
        let mut status = shared.lock().map_err(|_| "Capture state is unavailable.")?;
        *status = RecordingStatus::saved(saved.clone());
        sink("recording_saved", &status);
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::{manifest, TestRoot};

    #[test]
    #[ignore = "child process that opens the microphone for forced-kill testing"]
    fn live_crash_child() {
        use std::io::Write;
        let Some(root) = std::env::var_os("CLEARPRACTICE_CRASH_TEST_ROOT") else {
            return;
        };
        let service = CaptureService::new(PathBuf::from(root), Arc::new(|_, _| {}));
        service
            .start(StartRequest {
                attempt_id: "live-kill".into(),
                idempotency_key: "live-kill-op".into(),
                device_id: None,
                title: "Temporary microphone durability test".into(),
            })
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            let status = service.status().unwrap().unwrap();
            assert_eq!(
                status.phase, "recording",
                "microphone interrupted: {:?}",
                status.error
            );
            if status.elapsed_ms >= 3700 {
                println!("CAPTURED_MS={}", status.elapsed_ms);
                std::io::stdout().flush().unwrap();
                loop {
                    thread::sleep(Duration::from_secs(1));
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        panic!("Microphone did not deliver enough audio for the crash test.");
    }

    #[test]
    #[ignore = "opens the live microphone and kills only the test process; run explicitly"]
    fn live_forced_kill_recovers_within_two_seconds() {
        for _ in 0..3 {
            crate::storage::recording::tests::kill_child_and_recover(
                "audio::capture::tests::live_crash_child",
                "live-kill",
            );
        }
    }

    #[test]
    fn downmixes_interleaved_frames_and_keeps_native_timing() {
        let root = TestRoot::new();
        let mut writer = ChunkWriter::create(&root.0, &manifest("stereo")).unwrap();
        let mut block = AudioBlock {
            samples: [0.0; BLOCK_SAMPLES],
            len: 4,
        };
        block.samples[..4].copy_from_slice(&[0.5, -0.5, 1.0, 0.0]);
        let (level, clipped) = write_block(&mut writer, block, 2).unwrap();
        writer.flush().unwrap();
        assert!(clipped);
        assert!((level - 0.353553).abs() < 0.0001);
        assert_eq!(writer.frames, 2);
        let bytes = std::fs::read(root.0.join("recovery/stereo/00000000.pcm")).unwrap();
        assert_eq!(bytes, [0, 0, 0, 64]);
        assert_eq!(pcm(-1.0), -32768);
        assert_eq!(pcm(1.0), 32767);
        assert_eq!(pcm(f32::NAN), 0);
    }

    #[test]
    #[ignore = "opens a live microphone for three seconds; run explicitly"]
    fn live_capture_saves_and_repeated_stop_returns_same_asset() {
        let root = TestRoot::new();
        let levels = Arc::new(Mutex::new(Vec::<RecordingStatus>::new()));
        let observed = levels.clone();
        let sink: EventSink = Arc::new(move |event, status| {
            if event == "recording_level" {
                observed.lock().unwrap().push(status.clone());
            }
        });
        let service = CaptureService::new(root.0.clone(), sink);
        let request = StartRequest {
            attempt_id: "hardware".into(),
            idempotency_key: "hardware-op".into(),
            device_id: None,
            title: "Microphone smoke test".into(),
        };
        let started = service.start(request.clone()).unwrap();
        assert_eq!(started.phase, "recording");
        assert_eq!(service.start(request).unwrap().attempt_id, "hardware");
        assert!(service
            .start(StartRequest {
                attempt_id: "other".into(),
                idempotency_key: "other".into(),
                device_id: None,
                title: "Rejected".into()
            })
            .is_err());
        thread::sleep(Duration::from_secs(3));
        let saved = service.stop("hardware").unwrap();
        let levels = levels.lock().unwrap();
        assert!(
            (10..=35).contains(&levels.len()),
            "expected rate-limited level events over three seconds"
        );
        assert!(levels
            .iter()
            .all(|s| (0.0..=1.0).contains(&s.level) && s.phase == "recording"));
        assert!(levels
            .windows(2)
            .all(|pair| pair[1].monotonic_ms >= pair[0].monotonic_ms + 100));
        assert!(saved.duration_ms >= 2500 && saved.duration_ms <= 4000);
        assert_eq!(service.stop("hardware").unwrap().sha256, saved.sha256);
        recording::playback_path(&root.0, "hardware").unwrap();
        println!(
            "Observed {} valid level events with monotonic timestamps.",
            levels.len()
        );
        println!(
            "Captured {} ms at {} Hz, {} source channels; SHA verified.",
            saved.duration_ms, saved.sample_rate, saved.source_channels
        );
    }
}
