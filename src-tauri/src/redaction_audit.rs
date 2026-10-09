//! Log redaction guard (plan 5.12). The app writes no logs: audio, transcript
//! text, request payloads, provider responses, authorization headers and keys
//! must never reach stdout/stderr or a log file. Printing is allowed only in
//! test code (after `#[cfg(test)]`) and in the separate benchmark binary.
#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n != "bin") {
                    rust_files(&path, out);
                }
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn app_code_never_prints_or_logs_outside_tests() {
        let mut files = Vec::new();
        rust_files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
        assert!(files.len() > 20, "found the sources");
        let banned = ["println!", "eprintln!", "print!(", "eprint!(", "dbg!", "log::", "tracing::"];
        let mut offenders = Vec::new();
        for file in files.iter().filter(|f| !f.ends_with("redaction_audit.rs")) {
            let text = fs::read_to_string(file).unwrap();
            let lines: Vec<&str> = text.lines().collect();
            // Everything after a file's test module is test code.
            let tests_start = lines.iter().position(|l| l.trim_start().starts_with("mod tests") || *l == "#[cfg(test)]").unwrap_or(lines.len());
            for (i, line) in lines.iter().enumerate().take(tests_start) {
                let code = line.split("//").next().unwrap_or("");
                let guarded = i > 0 && lines[i - 1].trim() == "#[cfg(test)]";
                // Whole names only: `tauri_plugin_dialog::` is not `log::`.
                let used = |b: &str| code.match_indices(b).any(|(at, _)| !code[..at].chars().next_back().is_some_and(|c| c.is_alphanumeric() || c == '_'));
                if !guarded && banned.iter().any(|b| used(b)) {
                    offenders.push(format!("{}:{}", file.display(), i + 1));
                }
            }
        }
        assert!(offenders.is_empty(), "printing or logging in app code: {offenders:?}");
    }
}
