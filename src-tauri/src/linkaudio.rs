//! Audio from a YouTube link (requested by the user 2026-10-08, plan 4.4d).
//! Uses the user's own yt-dlp (found on PATH or chosen in the app); ClearPractice
//! does not ship a downloader. Only YouTube hosts are accepted, only the audio
//! track is fetched, playlists and live streams are refused, and videos longer
//! than 15 minutes are skipped. The user is responsible for having the right to
//! keep the audio and for following YouTube's terms; the UI says so.
use crate::clips;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;

pub const SETTING_KEY: &str = "ytdlp_path";
const HOSTS: [&str; 5] = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkAudio {
    pub staged: clips::Staged,
    pub title: String,
    pub uploader: String,
    pub url: String,
    /// Suggested credit for the clips made from it.
    pub source: String,
}

/// Accepts only https links to YouTube; returns the link unchanged.
pub fn validate_url(url: &str) -> Result<String> {
    let url = url.trim();
    let bad = || "Paste a YouTube link (https://www.youtube.com/watch?v=… or https://youtu.be/…).".to_string();
    if url.len() > 300 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad());
    }
    let rest = url.strip_prefix("https://").ok_or_else(bad)?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if !HOSTS.contains(&host.as_str()) || rest.len() <= host.len() + 1 {
        return Err(bad());
    }
    Ok(url.to_string())
}

/// yt-dlp from the chosen path, or `yt-dlp.exe` on PATH.
pub fn find_ytdlp(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = configured.map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(path);
    }
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file()))
}

/// The yt-dlp arguments: audio only, no playlists or live streams, at most 15 minutes,
/// a format the app can decode, and one printed line with title/uploader/url/file.
pub fn arguments(url: &str, output_dir: &Path) -> Vec<String> {
    vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--no-progress".into(),
        "--no-warnings".into(),
        "--match-filter".into(),
        "duration <= 900 & !is_live".into(),
        "-f".into(),
        "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[ext=mp3]".into(),
        "-o".into(),
        output_dir.join("source.%(ext)s").to_string_lossy().into_owned(),
        "--no-simulate".into(),
        "--print".into(),
        "after_move:%(title)s\t%(uploader)s\t%(webpage_url)s\t%(filepath)s".into(),
        "--".into(),
        url.into(),
    ]
}

/// Parses the printed line: title, uploader, url, downloaded file.
pub fn parse_output(stdout: &str) -> Result<(String, String, String, PathBuf)> {
    let line = stdout.lines().rev().find(|l| l.split('\t').count() == 4).ok_or(
        "No audio was downloaded. The video may be longer than 15 minutes, live, private, or not available as audio.",
    )?;
    let mut parts = line.split('\t').map(|s| s.trim().to_string());
    let (title, uploader, url, file) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default(), parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    Ok((title, uploader, url, PathBuf::from(file)))
}

/// Downloads the audio, stages it like an imported file, and removes the download.
pub fn fetch(root: &Path, ytdlp: &Path, url: &str, cancel: &AtomicBool) -> Result<LinkAudio> {
    let url = validate_url(url)?;
    let dir = root.join("cache").join("link-download").join(format!("dl-{}", crate::storage::recording::now_ms()));
    fs::create_dir_all(&dir).map_err(|_| "Cannot prepare the download.")?;
    crate::audio::prepare::contained(root, &dir)?;
    let result = (|| {
        let mut command = Command::new(ytdlp);
        command.args(arguments(&url, &dir)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // no console window
        }
        let mut child = command.spawn().map_err(|_| "yt-dlp could not be started. Check its location in the import dialog.")?;
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) || started.elapsed() > Duration::from_secs(10 * 60) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if cancel.load(Ordering::Relaxed) { "Stopped. Nothing was saved." } else { "The download took longer than 10 minutes and was stopped." }.to_string());
            }
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(200)),
                Err(_) => return Err("Cannot monitor yt-dlp.".into()),
            }
        }
        let output = child.wait_with_output().map_err(|_| "Cannot read yt-dlp's result.")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            let detail: String = String::from_utf8_lossy(&output.stderr).lines().rev().find(|l| l.contains("ERROR")).unwrap_or("").chars().take(200).collect();
            return Err(format!("yt-dlp could not get the audio. {detail}").trim().to_string());
        }
        let (title, uploader, page, file) = parse_output(&stdout)?;
        // The file must be the one yt-dlp wrote into our folder.
        let file = crate::audio::prepare::contained(root, &file).map_err(|_| "The download is not where it was expected.")?;
        if !file.starts_with(crate::audio::prepare::contained(root, &dir)?) {
            return Err("The download is not where it was expected.".into());
        }
        let staged = clips::stage(root, &file)?;
        let source = format!("{}, \u{201c}{}\u{201d}, YouTube \u{2014} {}", if uploader.is_empty() { "Unknown channel" } else { &uploader }, title, page);
        Ok(LinkAudio { staged, title, uploader, url: page, source })
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

// ── Getting yt-dlp from the app (4.4f) ──────────────────────────────────────

pub const PROJECT_PAGE: &str = "https://github.com/yt-dlp/yt-dlp";
const SUMS_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
const EXE_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const MAX_TOOL_BYTES: u64 = 64 * 1024 * 1024;

/// Release downloads redirect to GitHub's file storage; nothing else is followed.
pub fn allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "github.com" || host.ends_with(".github.com") || host == "githubusercontent.com" || host.ends_with(".githubusercontent.com")
}

/// The expected SHA-256 of `yt-dlp.exe` from the release's published list.
pub fn expected_sha256(sums: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let (hash, name) = (parts.next()?, parts.next()?);
        (name.trim_start_matches('*') == "yt-dlp.exe" && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

/// Downloads the official yt-dlp.exe into `tools/`, verifies it against the
/// release's SHA-256 list, and returns its path. A failed or mismatched file is
/// deleted. Reports (received, total) bytes.
pub async fn download_tool(root: &Path, cancel: &AtomicBool, progress: impl Fn(u64, Option<u64>)) -> Result<PathBuf> {
    use sha2::{Digest, Sha256};
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(10 * 60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 {
                attempt.error("too many redirects")
            } else if attempt.url().host_str().is_some_and(allowed_host) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .user_agent("ClearPractice/0.1.0")
        .build()
        .map_err(|_| "Cannot prepare the download.")?;
    let sums = client.get(SUMS_URL).send().await.and_then(|r| r.error_for_status()).map_err(|_| "Could not reach the yt-dlp release page. Check your connection.")?;
    if sums.content_length().is_some_and(|n| n > 256 * 1024) {
        return Err("The yt-dlp checksum list looks wrong. Nothing was installed.".into());
    }
    let sums = sums.text().await.map_err(|_| "Could not read the yt-dlp checksum list.")?;
    let expected = expected_sha256(&sums).ok_or("The yt-dlp release lists no checksum for yt-dlp.exe. Nothing was installed.")?;

    let dir = root.join("tools");
    fs::create_dir_all(&dir).map_err(|_| "Cannot create the tools folder.")?;
    crate::audio::prepare::contained(root, &dir)?;
    let part = dir.join("yt-dlp.exe.part");
    let target = dir.join("yt-dlp.exe");
    let result = async {
        let mut response = client.get(EXE_URL).send().await.and_then(|r| r.error_for_status()).map_err(|_| "The yt-dlp download could not start.")?;
        let total = response.content_length();
        if total.is_some_and(|n| n > MAX_TOOL_BYTES) {
            return Err("The yt-dlp download is larger than expected. Nothing was installed.".to_string());
        }
        let mut file = fs::File::create(&part).map_err(|_| "Cannot write the download.")?;
        let mut digest = Sha256::new();
        let mut received = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|_| "The download was interrupted. Nothing was installed.")? {
            if cancel.load(Ordering::Relaxed) {
                return Err("Stopped. Nothing was installed.".into());
            }
            received += chunk.len() as u64;
            if received > MAX_TOOL_BYTES {
                return Err("The yt-dlp download is larger than expected. Nothing was installed.".into());
            }
            digest.update(&chunk);
            std::io::Write::write_all(&mut file, &chunk).map_err(|_| "Cannot write the download.")?;
            progress(received, total);
        }
        file.sync_all().map_err(|_| "Cannot write the download.")?;
        drop(file);
        if format!("{:x}", digest.finalize()) != expected {
            return Err("The downloaded yt-dlp did not match its published checksum, so it was deleted. Try again later.".into());
        }
        let _ = fs::remove_file(&target);
        fs::rename(&part, &target).map_err(|_| "Cannot install the download.".to_string())?;
        Ok(target.clone())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_https_youtube_links() {
        for ok in ["https://www.youtube.com/watch?v=abc123", "https://youtu.be/abc123", "https://m.youtube.com/watch?v=x", " https://youtube.com/shorts/abc "] {
            assert!(validate_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://www.youtube.com/watch?v=abc", "https://www.youtube.com", "https://evil.com/watch?v=abc", "https://youtube.com.evil.com/x",
            "https://www.youtube.com/watch?v=a b", "file:///C:/x.mp3", "--exec=calc", "https://www.youtube.com/watch?v=abc\n--exec",
        ] {
            assert!(validate_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn asks_for_audio_only_without_playlists_or_long_videos_and_ends_options_before_the_link() {
        let args = arguments("https://youtu.be/abc", Path::new("C:/data/cache/link-download/dl-1"));
        assert!(args.contains(&"--no-playlist".to_string()) && args.contains(&"--ignore-config".to_string()));
        assert!(args.iter().any(|a| a == "duration <= 900 & !is_live"));
        let dash = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(&args[dash + 1..], ["https://youtu.be/abc"], "the link is never parsed as an option");
    }

    #[test]
    fn the_tool_download_trusts_only_github_hosts_and_the_published_checksum() {
        for ok in ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] {
            assert!(allowed_host(ok), "{ok}");
        }
        for bad in ["evil.com", "github.com.evil.com", "githubusercontent.com.example", "notgithub.com"] {
            assert!(!allowed_host(bad), "{bad}");
        }
        let hash = "a".repeat(64);
        let sums = format!("{}  yt-dlp\n{hash}  yt-dlp.exe\n{}  yt-dlp_macos\n", "b".repeat(64), "c".repeat(64));
        assert_eq!(expected_sha256(&sums), Some(hash));
        assert_eq!(expected_sha256("short  yt-dlp.exe\n"), None);
        assert_eq!(expected_sha256("nothing here"), None);
    }

    #[test]
    fn reads_the_printed_title_uploader_link_and_file() {
        let (title, uploader, url, file) = parse_output("some log\nA Talk\tA Speaker\thttps://www.youtube.com/watch?v=abc\tC:\\x\\source.m4a\n").unwrap();
        assert_eq!((title.as_str(), uploader.as_str(), url.as_str()), ("A Talk", "A Speaker", "https://www.youtube.com/watch?v=abc"));
        assert!(file.ends_with("source.m4a"));
        assert!(parse_output("").unwrap_err().contains("No audio was downloaded"));
    }
}
