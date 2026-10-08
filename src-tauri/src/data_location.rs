//! Where ClearPractice keeps its data (plan 2.25, requested 2026-10-09). The
//! default is Tauri's app-local data folder on C:. The user can move the data
//! to another folder (for example on D:): the app copies the profile there,
//! verifies every file by SHA-256, marks the folder as a ClearPractice data
//! folder, writes a small pointer next to the default location, and restarts on
//! the new folder. The old copy stays until the user removes it. WebView data
//! and the pointer itself always stay in the default location.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

type Result<T> = std::result::Result<T, String>;

const POINTER: &str = "data-location.json";
const MARKER: &str = "clearpractice-data.json";
/// Profile folders that move. `cache/` is rebuilt as needed and stays behind.
pub const MOVED_DIRS: [&str; 10] = ["database", "recordings", "recovery", "clips", "imports", "models", "sources", "accounting", "tools", "restore-rollback"];

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pointer {
    version: u32,
    path: PathBuf,
    /// The folder the data was copied from, until the user removes that copy.
    previous: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    pub root: PathBuf,
    /// Why the chosen folder is not in use (for example a disconnected drive).
    pub problem: Option<String>,
    pub previous: Option<PathBuf>,
}

fn read_pointer(default: &Path) -> Option<std::result::Result<Pointer, ()>> {
    let bytes = fs::read(default.join(POINTER)).ok()?;
    Some(serde_json::from_slice::<Pointer>(&bytes).map_err(|_| ()).and_then(|p| if p.version == 1 && p.path.is_absolute() { Ok(p) } else { Err(()) }))
}

fn write_pointer(default: &Path, pointer: &Pointer) -> Result<()> {
    let part = default.join(format!("{POINTER}.part"));
    let mut file = File::create(&part).map_err(|_| "Cannot record the new data folder.")?;
    file.write_all(&serde_json::to_vec_pretty(pointer).map_err(|e| e.to_string())?)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot record the new data folder.")?;
    drop(file);
    fs::rename(&part, default.join(POINTER)).map_err(|_| "Cannot record the new data folder.".into())
}

/// The folder to use at start. A pointer to a folder that is missing or not a
/// ClearPractice data folder falls back to the default, with the reason, so
/// the user is told instead of silently starting on other data.
pub fn resolve(default: &Path) -> Resolved {
    match read_pointer(default) {
        None => Resolved { root: default.to_path_buf(), problem: None, previous: None },
        Some(Err(())) => Resolved { root: default.to_path_buf(), problem: Some("The record of your chosen data folder is damaged, so the default folder is in use.".into()), previous: None },
        Some(Ok(p)) if p.path.join(MARKER).is_file() => Resolved { root: p.path, problem: None, previous: p.previous },
        Some(Ok(p)) => Resolved {
            root: default.to_path_buf(),
            problem: Some(format!("Your data folder {} is not available (is the drive connected?). The default folder is in use until it is back; restart ClearPractice then.", p.path.display())),
            previous: None,
        },
    }
}

/// Where data chosen as `chosen` would go: the folder itself when empty,
/// otherwise a `ClearPractice` folder inside it, which must not exist yet or be empty.
pub fn plan_target(chosen: &Path, current: &Path) -> Result<PathBuf> {
    if !chosen.is_absolute() || !chosen.is_dir() {
        return Err("Choose an existing folder.".into());
    }
    let empty = |p: &Path| fs::read_dir(p).map(|mut d| d.next().is_none()).unwrap_or(false);
    let target = if empty(chosen) { chosen.to_path_buf() } else { chosen.join("ClearPractice") };
    if target.exists() && !empty(&target) {
        return Err(format!("{} already contains files. Choose an empty folder.", target.display()));
    }
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (from, to) = (canon(current), canon(target.parent().unwrap_or(&target)).join(target.file_name().unwrap_or_default()));
    if to.starts_with(&from) || from.starts_with(&to) {
        return Err("Choose a folder outside the current data folder.".into());
    }
    Ok(target)
}

/// Every regular file under the moved folders, relative to `root`. Links and
/// junctions are refused: a copy must never follow them elsewhere.
fn files(root: &Path) -> Result<Vec<(PathBuf, u64)>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, u64)>) -> Result<()> {
        for entry in fs::read_dir(dir).map_err(|_| format!("Cannot read {}.", dir.display()))? {
            let entry = entry.map_err(|_| "Cannot read the data folder.")?;
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|_| "Cannot read the data folder.")?;
            if meta.file_type().is_symlink() || crate::audio::prepare::contained(root, &path).is_err() {
                return Err(format!("{} is a link; ClearPractice does not move linked folders.", path.display()));
            }
            if meta.is_dir() {
                walk(root, &path, out)?;
            } else if meta.is_file() && path.extension().is_none_or(|e| e != "lock") {
                // Lock files belong to the running app and are recreated at start.
                out.push((path.strip_prefix(root).map_err(|_| "Unexpected path.")?.to_path_buf(), meta.len()));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    for dir in MOVED_DIRS {
        let path = root.join(dir);
        if path.is_dir() {
            walk(root, &path, &mut out)?;
        }
    }
    Ok(out)
}

fn hash(path: &Path) -> Result<String> {
    let mut input = BufReader::with_capacity(1 << 20, File::open(path).map_err(|_| format!("Cannot read {}.", path.display()))?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = input.read(&mut buffer).map_err(|_| format!("Cannot read {}.", path.display()))?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

/// Copies the profile from `from` to `to` and verifies each file by reading
/// the copy back. `progress` gets (bytes done, bytes total) over copying and
/// checking together. On any failure or Stop, the partial copy is removed.
pub fn copy_profile(from: &Path, to: &Path, cancel: &AtomicBool, progress: impl Fn(u64, u64)) -> Result<u64> {
    let list = files(from)?;
    let total: u64 = list.iter().map(|(_, n)| n).sum::<u64>() * 2;
    let created = !to.exists();
    let result = (|| {
        fs::create_dir_all(to).map_err(|_| format!("Cannot create {}.", to.display()))?;
        let mut done = 0u64;
        for (relative, len) in &list {
            if cancel.load(Ordering::Relaxed) {
                return Err("Stopped. Your data was not moved.".to_string());
            }
            let (source, target) = (from.join(relative), to.join(relative));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|_| format!("Cannot create {}.", parent.display()))?;
            }
            let mut input = BufReader::with_capacity(1 << 20, File::open(&source).map_err(|_| format!("Cannot read {}.", source.display()))?);
            let mut output = BufWriter::with_capacity(1 << 20, File::create(&target).map_err(|_| format!("Cannot write {} (is there enough space?).", target.display()))?);
            let mut digest = Sha256::new();
            let mut buffer = vec![0u8; 1 << 20];
            loop {
                let n = input.read(&mut buffer).map_err(|_| format!("Cannot read {}.", source.display()))?;
                if n == 0 {
                    break;
                }
                digest.update(&buffer[..n]);
                output.write_all(&buffer[..n]).map_err(|_| format!("Cannot write {} (is there enough space?).", target.display()))?;
                done += n as u64;
                progress(done, total);
            }
            output.flush().and_then(|_| output.get_ref().sync_all()).map_err(|_| format!("Cannot write {} (is there enough space?).", target.display()))?;
            drop(output);
            if hash(&target)? != format!("{:x}", digest.finalize()) {
                return Err(format!("The copy of {} did not match. Your data was not moved.", relative.display()));
            }
            done += len;
            progress(done, total);
        }
        for dir in ["database", "recordings", "recovery", "imports", "models", "cache"] {
            fs::create_dir_all(to.join(dir)).map_err(|_| format!("Cannot create {}.", to.display()))?;
        }
        let marker = serde_json::json!({ "app": "ClearPractice", "version": 1 });
        fs::write(to.join(MARKER), serde_json::to_vec(&marker).map_err(|e| e.to_string())?).map_err(|_| "Cannot mark the new data folder.")?;
        Ok(list.len() as u64)
    })();
    if result.is_err() {
        if created {
            let _ = fs::remove_dir_all(to);
        } else {
            // The chosen folder was empty: remove only what was copied into it.
            for dir in MOVED_DIRS.iter().chain(["cache"].iter()) {
                let _ = fs::remove_dir_all(to.join(dir));
            }
            let _ = fs::remove_file(to.join(MARKER));
        }
    }
    result
}

/// Points the app at `target` from the next start. Moving back to the default
/// removes the pointer.
pub fn commit(default: &Path, target: &Path, previous: &Path) -> Result<()> {
    if target == default {
        // The previous custom folder keeps its copy until the user removes it.
        return fs::remove_file(default.join(POINTER)).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|_| "Cannot record the data folder.".into());
    }
    write_pointer(default, &Pointer { version: 1, path: target.to_path_buf(), previous: Some(previous.to_path_buf()) })
}

/// Size of the copy left behind after a move, if any.
pub fn previous_copy_bytes(previous: &Path) -> u64 {
    files(previous).map(|l| l.iter().map(|(_, n)| n).sum()).unwrap_or(0)
}

/// Removes the copy left in the previous folder (only the moved data folders;
/// the default location keeps its WebView data and the pointer).
pub fn remove_previous(default: &Path, current: &Path) -> Result<()> {
    let Some(Ok(mut pointer)) = read_pointer(default) else { return Err("There is no old copy to remove.".into()) };
    let Some(previous) = pointer.previous.clone() else { return Err("There is no old copy to remove.".into()) };
    if previous == current || pointer.path != current {
        return Err("The old copy is the folder in use; nothing was removed.".into());
    }
    for dir in MOVED_DIRS {
        let path = previous.join(dir);
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(format!("{} is a link; remove it yourself.", path.display()));
        }
    }
    for dir in MOVED_DIRS {
        let path = previous.join(dir);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|_| format!("Could not remove {}. Close any program using it and try again.", path.display()))?;
        }
    }
    let _ = fs::remove_file(previous.join(MARKER));
    pointer.previous = None;
    write_pointer(default, &pointer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    #[test]
    fn a_profile_moves_verified_and_the_pointer_and_old_copy_follow() {
        let base = TestRoot::new();
        let default = base.0.join("default");
        let chosen = base.0.join("d-drive");
        fs::create_dir_all(default.join("database")).unwrap();
        fs::create_dir_all(default.join("recordings/take-1")).unwrap();
        fs::create_dir_all(default.join("EBWebView")).unwrap();
        fs::write(default.join("database/app.sqlite"), b"db").unwrap();
        fs::write(default.join("recordings/take-1/audio.wav"), vec![7u8; 300_000]).unwrap();
        fs::write(default.join("EBWebView/x"), b"webview").unwrap();
        fs::create_dir_all(default.join("accounting")).unwrap();
        fs::write(default.join("accounting/api-usage-v1.json"), b"{}").unwrap();
        fs::write(default.join("accounting/api-usage-v1.lock"), b"").unwrap();
        fs::create_dir_all(&chosen).unwrap();
        assert_eq!(resolve(&default).root, default);

        // A non-empty chosen folder gets a ClearPractice subfolder.
        fs::write(chosen.join("other.txt"), b"x").unwrap();
        let target = plan_target(&chosen, &default).unwrap();
        assert_eq!(target, chosen.join("ClearPractice"));
        assert!(plan_target(&default.join("database"), &default).is_err(), "never inside the data folder");

        let seen = std::sync::Mutex::new(Vec::new());
        let copied = copy_profile(&default, &target, &AtomicBool::new(false), |d, t| seen.lock().unwrap().push((d, t))).unwrap();
        assert_eq!(copied, 3, "lock files and WebView data stay");
        assert_eq!(fs::read(target.join("recordings/take-1/audio.wav")).unwrap().len(), 300_000);
        assert!(!target.join("EBWebView").exists() && !target.join("accounting/api-usage-v1.lock").exists());
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.last().map(|(d, t)| d == t), Some(true));

        commit(&default, &target, &default).unwrap();
        let resolved = resolve(&default);
        assert_eq!((resolved.root.clone(), resolved.previous.clone()), (target.clone(), Some(default.clone())));
        assert!(previous_copy_bytes(&default) >= 300_000);
        assert!(remove_previous(&default, &default).is_err(), "never removes the folder in use");
        remove_previous(&default, &target).unwrap();
        assert!(!default.join("recordings").exists() && default.join("EBWebView/x").exists());
        assert_eq!(resolve(&default).previous, None);

        // A disconnected drive falls back to the default with a reason.
        fs::rename(&target, base.0.join("unplugged")).unwrap();
        let fallback = resolve(&default);
        assert_eq!(fallback.root, default);
        assert!(fallback.problem.unwrap().contains("not available"));
    }

    #[test]
    fn a_stopped_or_failed_copy_leaves_nothing_behind() {
        let base = TestRoot::new();
        let default = base.0.join("default");
        fs::create_dir_all(default.join("recordings/t")).unwrap();
        fs::write(default.join("recordings/t/audio.wav"), b"abc").unwrap();
        let target = base.0.join("new");
        assert!(copy_profile(&default, &target, &AtomicBool::new(true), |_, _| {}).is_err());
        assert!(!target.exists());
        fs::write(default.join(POINTER), b"{broken").unwrap();
        assert!(resolve(&default).problem.unwrap().contains("damaged"));
    }
}
