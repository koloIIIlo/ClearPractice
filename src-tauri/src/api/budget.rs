//! M0 shared, durable API accounting before SQLite's M2 writer exists. Only
//! approved controllers may reserve/dispatch; this module never sends requests.
use crate::{audio::prepare::contained, storage::recording};
use chrono::{Datelike, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

type Result<T> = std::result::Result<T, String>;
const STOP: u64 = 5_000_000; // integer micro-USD
const WARN: u64 = 4_000_000;
const MAX_LEDGER: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Coaching,
    Transcription,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Reserved,
    Dispatched,
    Uncertain,
    Settled,
    Released,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceQuote {
    pub currency: String,
    pub source: String,
    pub effective_date: String,
    pub model: String,
    pub billing_unit: String,
    pub rate_micro_usd: u64,
    pub maximum_cost_micro_usd: u64,
}
impl PriceQuote {
    fn validate(&self) -> Result<()> {
        if self.currency != "USD"
            || self.source.len() > 512
            || !self.source.starts_with("https://")
            || chrono::NaiveDate::parse_from_str(&self.effective_date, "%Y-%m-%d").is_err()
            || self.model.is_empty()
            || self.model.len() > 128
            || self.model.chars().any(char::is_control)
            || self.billing_unit.is_empty()
            || self.billing_unit.len() > 128
            || self.rate_micro_usd == 0
            || self.maximum_cost_micro_usd == 0
            || self.maximum_cost_micro_usd > STOP
        {
            return Err(
                "A known dated USD price and bounded cost estimate are required before sending."
                    .into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub audio_duration_ms: Option<u64>,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    month: String,
    purpose: Purpose,
    payload_sha256: String,
    quote: PriceQuote,
    status: Status,
    actual_cost_micro_usd: Option<u64>,
    usage: Option<Usage>,
    provider_request_id: Option<String>,
    created_at_ms: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ledger {
    version: u32,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSummary {
    pub currency: String,
    pub month: String,
    pub stop_micro_usd: u64,
    pub warning_micro_usd: u64,
    pub counted_micro_usd: u64,
    pub coaching_micro_usd: u64,
    pub transcription_micro_usd: u64,
    pub uncertain_micro_usd: u64,
    pub remaining_micro_usd: u64,
    pub warning: bool,
}

fn month() -> String {
    let now = Utc::now();
    format!("{:04}-{:02}", now.year(), now.month())
}
fn amount(entry: &Entry) -> u64 {
    match entry.status {
        Status::Released => 0,
        Status::Settled => entry
            .actual_cost_micro_usd
            .unwrap_or(entry.quote.maximum_cost_micro_usd),
        _ => entry.quote.maximum_cost_micro_usd,
    }
}
fn summary(ledger: &Ledger, month: &str) -> Result<BudgetSummary> {
    let mut coaching = 0u64;
    let mut transcription = 0u64;
    let mut uncertain = 0u64;
    for entry in ledger.entries.iter().filter(|e| e.month == month) {
        let subtotal = if entry.purpose == Purpose::Coaching {
            &mut coaching
        } else {
            &mut transcription
        };
        *subtotal = subtotal
            .checked_add(amount(entry))
            .ok_or("API accounting overflow.")?;
        if entry.status == Status::Uncertain {
            uncertain = uncertain
                .checked_add(amount(entry))
                .ok_or("API accounting overflow.")?;
        }
    }
    let counted = coaching
        .checked_add(transcription)
        .ok_or("API accounting overflow.")?;
    Ok(BudgetSummary {
        currency: "USD".into(),
        month: month.into(),
        stop_micro_usd: STOP,
        warning_micro_usd: WARN,
        counted_micro_usd: counted,
        coaching_micro_usd: coaching,
        transcription_micro_usd: transcription,
        uncertain_micro_usd: uncertain,
        remaining_micro_usd: STOP.saturating_sub(counted),
        warning: counted >= WARN,
    })
}

/// Holds an exclusive native file handle for the full owner lifetime. The
/// controller must bind the reserved hash to the exact approved payload.
pub struct BudgetOwner {
    root: PathBuf,
    path: PathBuf,
    state: Mutex<Ledger>,
    _lock: File,
}
/// The ledger has its own folder: the app holds its lock file open, and a
/// restore moves `database/` aside. Keeping it apart also means a restore never
/// rolls spending back (backups exclude it on purpose).
const LEDGER_DIR: &str = "accounting";

/// Ledgers written before 2026-10-09 lived in `database/`; move them once.
fn move_legacy_ledger(root: &Path, path: &Path) -> Result<()> {
    let legacy = root.join("database/api-usage-v1.json");
    if path.exists() || fs::symlink_metadata(&legacy).is_err() {
        return Ok(());
    }
    contained(root, &legacy)?;
    fs::rename(&legacy, path).map_err(|_| "Cannot move API accounting to its new folder. New requests are disabled.")?;
    let _ = fs::remove_file(root.join("database/api-usage-v1.lock"));
    Ok(())
}

impl BudgetOwner {
    pub fn open(root: &Path) -> Result<Self> {
        let dir = root.join(LEDGER_DIR);
        fs::create_dir_all(&dir).map_err(|_| "Cannot create the API accounting folder.")?;
        contained(root, &dir)?;
        let path = dir.join("api-usage-v1.json");
        move_legacy_ledger(root, &path)?;
        for file in [
            &path,
            &path.with_extension("json.part"),
            &dir.join("api-usage-v1.lock"),
        ] {
            if fs::symlink_metadata(file).is_ok() {
                contained(root, file)?;
            }
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let lock = options
            .open(dir.join("api-usage-v1.lock"))
            .map_err(|_| {
                "Another app instance owns API accounting, or its folder is unavailable."
            })?;
        #[cfg(not(windows))]
        lock.try_lock()
            .map_err(|_| "Another app instance owns API accounting.")?;
        let mut ledger = if path.exists() {
            let file = File::open(&path)
                .map_err(|_| "Cannot read API accounting. New requests are disabled.")?;
            if file
                .metadata()
                .map_err(|_| "Cannot inspect API accounting.")?
                .len()
                > MAX_LEDGER
            {
                return Err("API accounting exceeds its safe size limit.".into());
            }
            let mut bytes = Vec::new();
            file.take(MAX_LEDGER + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read API accounting.")?;
            serde_json::from_slice::<Ledger>(&bytes).map_err(|_| "API accounting is damaged. New requests are disabled; retain the file for recovery.")?
        } else {
            Ledger {
                version: 1,
                entries: vec![],
            }
        };
        validate(&ledger)?;
        // Restart never dispatches pending work. Definitely-unsent reservations
        // can be released; dispatched requests remain conservatively counted.
        for entry in &mut ledger.entries {
            if entry.status == Status::Reserved {
                entry.status = Status::Released;
            }
            if entry.status == Status::Dispatched {
                entry.status = Status::Uncertain;
            }
        }
        let owner = Self {
            root: root.to_path_buf(),
            path,
            state: Mutex::new(ledger),
            _lock: lock,
        };
        owner.save(
            &*owner
                .state
                .lock()
                .map_err(|_| "API accounting owner failed.")?,
        )?;
        Ok(owner)
    }

    fn save(&self, ledger: &Ledger) -> Result<()> {
        contained(&self.root, &self.root.join(LEDGER_DIR))?;
        let bytes = serde_json::to_vec(ledger).map_err(|_| "Cannot encode API accounting.")?;
        if bytes.len() as u64 > MAX_LEDGER {
            return Err("API accounting is full; new requests are disabled.".into());
        }
        let part = self.path.with_extension("json.part");
        for path in [&part, &self.path] {
            if fs::symlink_metadata(path).is_ok() {
                contained(&self.root, path)?;
            }
        }
        let mut file = File::create(&part)
            .map_err(|_| "Cannot save API accounting; no request was authorized.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot sync API accounting; no request was authorized.")?;
        drop(file);
        fs::rename(part, &self.path)
            .map_err(|_| "Cannot commit API accounting; no request was authorized.")?;
        Ok(())
    }

    fn update(&self, change: impl FnOnce(&mut Ledger) -> Result<()>) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "API accounting owner failed.")?;
        let mut next = state.clone();
        change(&mut next)?;
        validate(&next)?;
        self.save(&next)?;
        *state = next;
        Ok(())
    }

    pub fn summary(&self) -> Result<BudgetSummary> {
        summary(
            &*self
                .state
                .lock()
                .map_err(|_| "API accounting owner failed.")?,
            &month(),
        )
    }

    pub fn reserve(
        &self,
        id: &str,
        purpose: Purpose,
        payload_sha256: &str,
        price: Option<PriceQuote>,
    ) -> Result<()> {
        recording::validate_id(id)?;
        let quote = price.ok_or("Price unknown. Set and verify a dated price before sending.")?;
        quote.validate()?;
        if payload_sha256.len() != 64
            || !payload_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Invalid approved payload fingerprint.".into());
        }
        let current_month = month();
        self.update(|ledger| {
            if ledger.entries.iter().any(|e| e.id == id) { return Err("This request already has a reservation. A retry needs a new approved request ID.".into()); }
            let remaining = summary(ledger, &current_month)?.remaining_micro_usd;
            if quote.maximum_cost_micro_usd > remaining { return Err("The shared monthly API limit would be exceeded. No request was sent.".into()); }
            ledger.entries.push(Entry { id: id.into(), month: current_month, purpose, payload_sha256: payload_sha256.into(), quote,
                status: Status::Reserved, actual_cost_micro_usd: None, usage: None, provider_request_id: None, created_at_ms: recording::now_ms() });
            Ok(())
        })
    }

    /// Persist BEFORE outbound I/O. On crash/timeout this reservation cannot
    /// be released as definitely unsent. Returns no send permission on failure.
    pub fn mark_dispatched(&self, id: &str, payload_sha256: &str) -> Result<()> {
        self.update(|ledger| {
            let entry = ledger
                .entries
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or("Request reservation is missing.")?;
            if entry.status != Status::Reserved
                || entry.payload_sha256 != payload_sha256
                || entry.month != month()
            {
                return Err(
                    "Request approval is stale or already used. Preview the request again.".into(),
                );
            }
            entry.status = Status::Dispatched;
            Ok(())
        })
    }

    pub fn release_unsent(&self, id: &str) -> Result<()> {
        self.update(|ledger| {
            let entry = ledger
                .entries
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or("Request reservation is missing.")?;
            if entry.status == Status::Released {
                return Ok(());
            }
            if entry.status != Status::Reserved {
                return Err(
                    "A submitted request may still be billed and cannot be released as unsent."
                        .into(),
                );
            }
            entry.status = Status::Released;
            Ok(())
        })
    }

    pub fn settle(
        &self,
        id: &str,
        actual_micro_usd: Option<u64>,
        usage: Option<Usage>,
        request_id: Option<String>,
    ) -> Result<()> {
        if request_id
            .as_ref()
            .is_some_and(|id| id.len() > 128 || id.chars().any(char::is_control))
        {
            return Err("Invalid provider request identifier.".into());
        }
        if let Some(usage) = &usage {
            if usage
                .unavailable_reason
                .as_ref()
                .is_some_and(|r| r.is_empty() || r.len() > 512)
                || (usage.input_tokens.is_none()
                    && usage.output_tokens.is_none()
                    && usage.audio_duration_ms.is_none()
                    && usage.unavailable_reason.is_none())
            {
                return Err("Missing provider usage needs an unavailable reason.".into());
            }
        }
        self.update(|ledger| {
            let entry = ledger
                .entries
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or("Request reservation is missing.")?;
            if entry.status != Status::Dispatched && entry.status != Status::Uncertain {
                return Err("The request cannot be settled in its current state.".into());
            }
            entry.actual_cost_micro_usd = actual_micro_usd;
            entry.usage = usage;
            entry.provider_request_id = request_id;
            entry.status = if actual_micro_usd.is_some() {
                Status::Settled
            } else {
                Status::Uncertain
            };
            Ok(())
        })
    }
}

fn validate(ledger: &Ledger) -> Result<()> {
    if ledger.version != 1 || ledger.entries.len() > 10_000 {
        return Err("Unsupported API accounting file; new requests are disabled.".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut months = std::collections::HashSet::new();
    for entry in &ledger.entries {
        recording::validate_id(&entry.id)?;
        entry.quote.validate()?;
        if !ids.insert(&entry.id)
            || chrono::NaiveDate::parse_from_str(&format!("{}-01", entry.month), "%Y-%m-%d")
                .is_err()
            || entry.payload_sha256.len() != 64
            || !entry
                .payload_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || (entry.status == Status::Settled) != entry.actual_cost_micro_usd.is_some()
        {
            return Err("Invalid API accounting data; new requests are disabled.".into());
        }
        months.insert(&entry.month);
    }
    for month in months {
        summary(ledger, month)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;
    fn quote(cost: u64) -> PriceQuote {
        PriceQuote {
            currency: "USD".into(),
            source: "https://developers.openai.com/api/docs/pricing".into(),
            effective_date: "2026-10-04".into(),
            model: "test-model".into(),
            billing_unit: "test-unit".into(),
            rate_micro_usd: 1,
            maximum_cost_micro_usd: cost,
        }
    }

    #[test]
    fn shares_the_stop_limit_and_serializes_concurrent_purposes() {
        let root = TestRoot::new();
        let owner = BudgetOwner::open(&root.0).unwrap();
        std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                owner.reserve(
                    "a",
                    Purpose::Coaching,
                    &"a".repeat(64),
                    Some(quote(3_000_000)),
                )
            });
            let b = scope.spawn(|| {
                owner.reserve(
                    "b",
                    Purpose::Transcription,
                    &"b".repeat(64),
                    Some(quote(3_000_000)),
                )
            });
            assert_ne!(a.join().unwrap().is_ok(), b.join().unwrap().is_ok());
        });
        assert_eq!(owner.summary().unwrap().counted_micro_usd, 3_000_000);
        owner
            .reserve(
                "last",
                Purpose::Transcription,
                &"c".repeat(64),
                Some(quote(2_000_000)),
            )
            .unwrap();
        let summary = owner.summary().unwrap();
        assert!(summary.warning);
        assert_eq!(summary.remaining_micro_usd, 0);
        assert!(owner
            .reserve(
                "overflow",
                Purpose::Coaching,
                &"d".repeat(64),
                Some(quote(1))
            )
            .is_err());
        assert!(BudgetOwner::open(&root.0).is_err());
    }

    #[test]
    fn keeps_uncertain_charges_after_restart_and_rejects_duplicates_and_stale_payloads() {
        let root = TestRoot::new();
        let owner = BudgetOwner::open(&root.0).unwrap();
        let hash = "a".repeat(64);
        owner
            .reserve("sent", Purpose::Coaching, &hash, Some(quote(100)))
            .unwrap();
        assert!(owner.mark_dispatched("sent", &"b".repeat(64)).is_err());
        owner.mark_dispatched("sent", &hash).unwrap();
        assert!(owner.mark_dispatched("sent", &hash).is_err());
        assert!(owner.release_unsent("sent").is_err());
        owner
            .reserve("unsent", Purpose::Transcription, &hash, Some(quote(50)))
            .unwrap();
        drop(owner);
        let owner = BudgetOwner::open(&root.0).unwrap();
        assert_eq!(owner.summary().unwrap().uncertain_micro_usd, 100);
        assert_eq!(owner.summary().unwrap().counted_micro_usd, 100);
        assert!(owner
            .reserve("sent", Purpose::Coaching, &hash, Some(quote(100)))
            .is_err());
        owner
            .settle(
                "sent",
                Some(20),
                Some(Usage {
                    input_tokens: Some(10),
                    output_tokens: Some(10),
                    audio_duration_ms: None,
                    unavailable_reason: None,
                }),
                Some("req_test".into()),
            )
            .unwrap();
        assert_eq!(owner.summary().unwrap().counted_micro_usd, 20);
        assert_eq!(owner.summary().unwrap().uncertain_micro_usd, 0);
    }

    #[test]
    fn unknown_prices_and_damaged_ledgers_never_authorize_a_request() {
        let root = TestRoot::new();
        let owner = BudgetOwner::open(&root.0).unwrap();
        assert!(owner
            .reserve("unknown", Purpose::Coaching, &"a".repeat(64), None)
            .is_err());
        assert!(owner
            .reserve("zero", Purpose::Coaching, &"a".repeat(64), Some(quote(0)))
            .is_err());
        owner
            .reserve(
                "unsent",
                Purpose::Coaching,
                &"a".repeat(64),
                Some(quote(100)),
            )
            .unwrap();
        owner.release_unsent("unsent").unwrap();
        assert_eq!(owner.summary().unwrap().counted_micro_usd, 0);
        drop(owner);
        fs::write(root.0.join("accounting/api-usage-v1.json"), b"broken").unwrap();
        assert!(BudgetOwner::open(&root.0).is_err());
    }

    #[test]
    fn a_ledger_from_the_database_folder_moves_to_its_own_folder_once() {
        let root = TestRoot::new();
        let owner = BudgetOwner::open(&root.0).unwrap();
        owner.reserve("kept", Purpose::Coaching, &"a".repeat(64), Some(quote(100))).unwrap();
        drop(owner);
        fs::create_dir_all(root.0.join("database")).unwrap();
        fs::rename(root.0.join("accounting/api-usage-v1.json"), root.0.join("database/api-usage-v1.json")).unwrap();
        fs::write(root.0.join("database/api-usage-v1.lock"), b"").unwrap();
        let owner = BudgetOwner::open(&root.0).unwrap();
        assert!(owner.summary().is_ok());
        assert!(fs::read_to_string(root.0.join("accounting/api-usage-v1.json")).unwrap().contains("kept"));
        assert!(!root.0.join("database/api-usage-v1.json").exists());
        assert!(!root.0.join("database/api-usage-v1.lock").exists());
        assert!(root.0.join("accounting/api-usage-v1.json").is_file());
    }
}
