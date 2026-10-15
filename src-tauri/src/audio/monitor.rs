//! Live input level before recording (the Studio's Ready state). The selected
//! microphone is opened only to measure loudness: no audio is written, kept or
//! sent. The stream closes on stop, before a take or microphone test starts,
//! and by itself after a time limit in case the page that asked is gone.
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample,
};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

/// Monitoring ends by itself after this long without being renewed.
const MAX_MONITOR: Duration = Duration::from_secs(15 * 60);
/// Level events per second, as during recording.
const EVENT_EVERY: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputLevel {
    /// RMS of the loudest block since the previous event, 0–1 (the recording meter's scale).
    pub level: f32,
    pub clipping: bool,
}

pub type LevelSink = Arc<dyn Fn(InputLevel) + Send + Sync>;

struct Active {
    stop: Arc<AtomicBool>,
    worker: JoinHandle<()>,
    device_id: Option<String>,
}

#[derive(Default)]
pub struct LevelMonitor {
    active: Mutex<Option<Active>>,
}

impl LevelMonitor {
    /// Starts monitoring `device_id` (`None`: the Windows default), or keeps the
    /// running monitor if it already uses that device. Returns once the microphone is open.
    pub fn start(&self, device_id: Option<String>, sink: LevelSink) -> Result<(), String> {
        if device_id.as_ref().is_some_and(|id| id.len() > 1024) {
            return Err("Invalid microphone identifier.".into());
        }
        let mut active = self.active.lock().map_err(|_| "The level monitor is unavailable.")?;
        if active.as_ref().is_some_and(|a| a.device_id == device_id && !a.worker.is_finished()) {
            return Ok(());
        }
        if let Some(previous) = active.take() {
            previous.stop.store(true, Ordering::Release);
            let _ = previous.worker.join();
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
        let worker_stop = stop.clone();
        let worker_device = device_id.clone();
        let worker = thread::Builder::new()
            .name("clearpractice-level-monitor".into())
            .spawn(move || {
                if let Err(error) = run(worker_device.as_deref(), &worker_stop, &sink, &ready_tx) {
                    let _ = ready_tx.try_send(Err(error));
                }
            })
            .map_err(|_| "Cannot start the level monitor.")?;
        *active = Some(Active { stop: stop.clone(), worker, device_id });
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                if let Some(failed) = active.take() {
                    let _ = failed.worker.join();
                }
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                Err("The microphone did not open in time.".into())
            }
        }
    }

    /// Closes the microphone, if it is being monitored.
    pub fn stop(&self) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(running) = active.take() {
                running.stop.store(true, Ordering::Release);
                let _ = running.worker.join();
            }
        }
    }
}

fn run(device_id: Option<&str>, stop: &AtomicBool, sink: &LevelSink, ready: &SyncSender<Result<(), String>>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(id) => host.device_by_id(&id.parse().map_err(|_| "Invalid microphone identifier.")?),
        None => host.default_input_device(),
    }
    .ok_or("The selected microphone is unavailable.")?;
    let supported = device.default_input_config().map_err(|_| "Cannot read the microphone format.")?;
    let config: cpal::StreamConfig = supported.clone().into();
    if !(1..=32).contains(&config.channels) {
        return Err("This microphone format is unsupported.".into());
    }
    let channels = usize::from(config.channels);
    // The loudest block since the last event, as f32 bits, and whether any sample clipped.
    let peak = Arc::new(AtomicU32::new(0));
    let clipped = Arc::new(AtomicBool::new(false));
    let (p, c) = (peak.clone(), clipped.clone());
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, channels, p, c),
        SampleFormat::F64 => build::<f64>(&device, config, channels, p, c),
        SampleFormat::I8 => build::<i8>(&device, config, channels, p, c),
        SampleFormat::I16 => build::<i16>(&device, config, channels, p, c),
        SampleFormat::I32 => build::<i32>(&device, config, channels, p, c),
        SampleFormat::I64 => build::<i64>(&device, config, channels, p, c),
        SampleFormat::U8 => build::<u8>(&device, config, channels, p, c),
        SampleFormat::U16 => build::<u16>(&device, config, channels, p, c),
        SampleFormat::U32 => build::<u32>(&device, config, channels, p, c),
        SampleFormat::U64 => build::<u64>(&device, config, channels, p, c),
        _ => Err("This microphone sample format is unsupported.".into()),
    }?;
    stream.play().map_err(|_| "Cannot start the microphone. Check Windows microphone permissions.")?;
    let _ = ready.try_send(Ok(()));
    let started = Instant::now();
    while !stop.load(Ordering::Acquire) && started.elapsed() < MAX_MONITOR {
        thread::sleep(EVENT_EVERY);
        let level = f32::from_bits(peak.swap(0, Ordering::AcqRel));
        sink(InputLevel { level: level.clamp(0.0, 1.0), clipping: clipped.swap(false, Ordering::AcqRel) });
    }
    drop(stream); // The microphone is released before the final zero level.
    sink(InputLevel { level: 0.0, clipping: false });
    Ok(())
}

fn build<T>(device: &cpal::Device, config: cpal::StreamConfig, channels: usize, peak: Arc<AtomicU32>, clipped: Arc<AtomicBool>) -> Result<cpal::Stream, String>
where
    T: SizedSample + Sample,
    f32: FromSample<T>,
{
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                // No allocation or locking in the device callback.
                let (level, clips) = block_level(data, channels);
                let mut current = peak.load(Ordering::Relaxed);
                while level > f32::from_bits(current) {
                    match peak.compare_exchange_weak(current, level.to_bits(), Ordering::AcqRel, Ordering::Relaxed) {
                        Ok(_) => break,
                        Err(seen) => current = seen,
                    }
                }
                if clips {
                    clipped.store(true, Ordering::Release);
                }
            },
            |_| {},
            None,
        )
        .map_err(|error| format!("Cannot open this microphone ({:?}).", error.kind()))
}

/// RMS of the mono mix of interleaved frames (as recording measures it), and
/// whether any sample reached full scale.
fn block_level<T>(data: &[T], channels: usize) -> (f32, bool)
where
    T: Sample,
    f32: FromSample<T>,
{
    let mut sum_squares = 0.0f64;
    let mut frames = 0usize;
    let mut clips = false;
    for frame in data.chunks_exact(channels.max(1)) {
        let mut mono = 0.0f32;
        for sample in frame {
            let value = f32::from_sample(*sample);
            let value = if value.is_finite() { value } else { 0.0 };
            clips |= value.abs() >= 0.995;
            mono += value;
        }
        mono /= frame.len() as f32;
        sum_squares += f64::from(mono).powi(2);
        frames += 1;
    }
    let rms = if frames == 0 { 0.0 } else { (sum_squares / frames as f64).sqrt() as f32 };
    (rms.clamp(0.0, 1.0), clips)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_level_is_the_rms_of_the_mono_mix() {
        // Stereo frames whose channels cancel are silent; equal channels keep their level.
        assert_eq!(block_level(&[0.5f32, -0.5, 0.5, -0.5], 2), (0.0, false));
        let (level, clips) = block_level(&[0.5f32, 0.5, -0.5, -0.5], 2);
        assert!((level - 0.5).abs() < 1e-6);
        assert!(!clips);
        assert!(block_level(&[1.0f32, 0.0], 2).1, "a full-scale sample counts as clipping");
        assert_eq!(block_level::<f32>(&[], 1), (0.0, false));
        let (int_level, _) = block_level(&[i16::MAX / 2, i16::MIN / 2], 1);
        assert!((int_level - 0.5).abs() < 0.01);
    }

    #[test]
    fn stop_without_a_monitor_is_harmless() {
        LevelMonitor::default().stop();
    }

    /// Live microphone: `cargo test --lib level_monitor -- --ignored`.
    #[test]
    #[ignore]
    fn level_monitor_hardware_reports_levels_and_releases_the_microphone() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let monitor = LevelMonitor::default();
        monitor.start(None, Arc::new(move |l| sink_seen.lock().unwrap().push(l))).unwrap();
        thread::sleep(Duration::from_millis(550));
        monitor.stop();
        let seen = seen.lock().unwrap();
        assert!(seen.len() >= 4, "about ten events a second");
        assert_eq!(seen.last().copied(), Some(InputLevel { level: 0.0, clipping: false }));
    }
}
