//! Performance measurements on this computer (plan 6.5): start-up (process
//! start to the first screen), record response (Record pressed to the
//! microphone running) and search. Kept in memory for this run only, shown in
//! Settings → About and in the diagnostic report; never sent anywhere.
use serde::Serialize;
use std::{collections::BTreeMap, sync::Mutex, sync::OnceLock, time::Instant};

/// Release targets from the plan (milliseconds).
pub const TARGETS: [(&str, u64); 3] = [("startup", 2_000), ("recordResponse", 200), ("search", 250)];

static STARTED: OnceLock<Instant> = OnceLock::new();

/// Called first thing in `run()`.
pub fn mark_process_start() {
    let _ = STARTED.set(Instant::now());
}

pub fn uptime_ms() -> u64 {
    STARTED.get().map_or(0, |s| s.elapsed().as_millis() as u64)
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measure {
    pub latest_ms: u64,
    pub best_ms: u64,
    pub worst_ms: u64,
    pub count: u32,
    pub target_ms: u64,
}

#[derive(Default)]
pub struct Timings(Mutex<BTreeMap<String, Measure>>);

impl Timings {
    pub fn record(&self, kind: &str, ms: u64) -> Result<(), String> {
        let target = TARGETS.iter().find(|(k, _)| *k == kind).map(|(_, t)| *t).ok_or("Unknown measurement.")?;
        let ms = ms.min(600_000);
        let mut map = self.0.lock().map_err(|_| "Timings are unavailable.")?;
        let m = map.entry(kind.into()).or_insert(Measure { best_ms: u64::MAX, target_ms: target, ..Default::default() });
        m.latest_ms = ms;
        m.best_ms = m.best_ms.min(ms);
        m.worst_ms = m.worst_ms.max(ms);
        m.count = m.count.saturating_add(1);
        Ok(())
    }

    pub fn snapshot(&self) -> BTreeMap<String, Measure> {
        self.0.lock().map(|m| m.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_keep_latest_best_worst_and_their_target() {
        let t = Timings::default();
        t.record("search", 40).unwrap();
        t.record("search", 12).unwrap();
        t.record("search", 90).unwrap();
        assert!(t.record("mood", 1).is_err());
        let s = t.snapshot();
        assert_eq!(s["search"], Measure { latest_ms: 90, best_ms: 12, worst_ms: 90, count: 3, target_ms: 250 });
    }
}
