use std::{fs, io, path::Path};

/// Data that belongs to this installation stays below Tauri's app-local data root.
const DATA_SUBDIRS: [&str; 6] = [
    "database",
    "recordings",
    "imports",
    "models",
    "cache",
    "recovery",
];

pub fn prepare_app_data(root: &Path) -> io::Result<()> {
    for path in std::iter::once(root.to_path_buf())
        .chain(DATA_SUBDIRS.into_iter().map(|name| root.join(name)))
    {
        fs::create_dir_all(&path).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "cannot create app data directory {}: {error}",
                    path.display()
                ),
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn prepares_all_data_directories_and_can_run_again() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock predates Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "clearpractice-paths-{}-{nonce}",
            std::process::id()
        ));

        prepare_app_data(&root).expect("create app data directories");
        prepare_app_data(&root).expect("reopening app preserves directories");
        for name in DATA_SUBDIRS {
            assert!(root.join(name).is_dir(), "missing {name}");
        }

        fs::remove_dir_all(root).expect("remove test directories");
    }
}
