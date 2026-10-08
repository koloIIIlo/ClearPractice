//! Microphone test (plan 2.12, onboarding step 2): record five seconds and play
//! them back. It reuses the verified capture path with its own root under
//! `cache/mic-test`, so test clips never enter session history, SQLite or
//! backups, and they are wiped at start and before every new test.
use crate::audio::capture::{CaptureService, EventSink};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const TEST_MS: u64 = 5_000;

pub struct MicTest {
    pub capture: CaptureService,
    pub root: PathBuf,
}

impl MicTest {
    pub fn new(app_root: &Path, sink: EventSink) -> io::Result<Self> {
        let root = app_root.join("cache").join("mic-test");
        reset(&root)?;
        Ok(Self { capture: CaptureService::new(root.clone(), sink), root })
    }

    /// Removes the previous test clip. Refused while a test is recording.
    pub fn clear(&self) -> Result<(), String> {
        if self.capture.is_active() {
            return Err("A microphone test is already running.".into());
        }
        reset(&self.root).map_err(|e| format!("Cannot prepare the microphone test ({e})."))
    }
}

fn reset(root: &Path) -> io::Result<()> {
    if root.exists() {
        fs::remove_dir_all(root)?;
    }
    fs::create_dir_all(root.join("recordings"))?;
    fs::create_dir_all(root.join("recovery"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::capture::StartRequest;
    use crate::storage::recording::{playback_path, tests::TestRoot};
    use std::sync::Arc;

    /// Live microphone: `cargo test --lib mic_test -- --ignored`.
    #[test]
    #[ignore]
    fn hardware_records_a_short_test_clip_outside_session_storage() {
        let root = TestRoot::new();
        let test = MicTest::new(&root.0, Arc::new(|_, _| {})).unwrap();
        let request = StartRequest {
            attempt_id: "mic-test-1".into(),
            idempotency_key: "mic-test-1".into(),
            device_id: None,
            title: "Microphone test".into(),
        };
        test.capture.start(request).unwrap();
        assert!(test.clear().is_err(), "cannot wipe a running test");
        std::thread::sleep(std::time::Duration::from_millis(1_500));
        let saved = test.capture.stop("mic-test-1").unwrap();
        assert!(saved.duration_ms >= 1_000, "{saved:?}");
        let clip = playback_path(&test.root, "mic-test-1").unwrap();
        assert!(clip.starts_with(root.0.join("cache/mic-test")));
        assert!(!root.0.join("recordings/mic-test-1").exists(), "never stored with sessions");
        test.clear().unwrap();
        assert!(!clip.exists());
    }
}
