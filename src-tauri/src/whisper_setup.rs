//! One-click local Whisper setup (user request 2026-10-10, settles plan 6.2's
//! runtime question for this build): after an explicit click, downloads the
//! pinned official whisper.cpp 1.9.1 release (CPU, or CUDA plus NVIDIA's
//! cuBLAS libraries) and a pinned model from Hugging Face, verifies every
//! archive and model against the size and SHA-256 recorded in
//! `bench/whisper-assets.json`, installs them under the app data folder and
//! stores the worker setup. Nothing is installed from a file that fails
//! verification; a stopped or failed download leaves no partial files.
use crate::audio::prepare::contained;
use crate::audio::whisper::{Backend, RuntimeFile, WorkerConfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

type Result<T> = std::result::Result<T, String>;

pub const RUNTIME_VERSION: &str = "1.9.1";
/// Keeps hesitation words in the transcript, as the benchmarked setup does (D-21).
pub const FILLER_PROMPT: &str = "Umm, so, uh, I think, like, you know.";

struct Asset {
    url: &'static str,
    bytes: u64,
    sha256: &'static str,
}

const CPU_RUNTIME: Asset = Asset {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip",
    bytes: 7_982_101,
    sha256: "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539",
};
const CPU_EXE_SHA256: &str = "58245314fb73b30fbd0cf0542c5c172e23f02b6eb7cad7b51e792439cf5e1755";
const CUDA_RUNTIME: Asset = Asset {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-cublas-11.8.0-bin-x64.zip",
    bytes: 278_557_654,
    sha256: "aecdce0e4d4bb758a7c72a31f3f9f19a7b6d861405fd2da743cd86398633c963",
};
const CUDA_EXE_SHA256: &str = "4bf174113843613cbec146e73e6820a767e54b0e1c736f2c6d7ab16aac4c245d";
/// NVIDIA's redistributable cuBLAS for CUDA 11.8, which the CUDA build needs beside it.
const CUBLAS: Asset = Asset {
    url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-11.11.3.6-archive.zip",
    bytes: 420_850_025,
    sha256: "67b0934a6359e4ee26fff823c356021589d392c4fd49ca12624f570edc08e2b9",
};
const CUBLAS_LIBRARIES: [&str; 2] = ["cublas64_11.dll", "cublasLt64_11.dll"];

fn model_url(file: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}")
}

/// Hosts the pinned downloads come from (and the CDNs they redirect to).
fn allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let under = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    under("github.com") || under("githubusercontent.com") || under("huggingface.co") || under("hf.co") || host == "developer.download.nvidia.com"
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub backend: Backend,
    /// A model ID from `crate::models::CATALOGUE`.
    pub model: ModelChoice,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub enum ModelChoice {
    #[serde(rename = "large-v3-turbo-q5_0")]
    LargeTurbo,
    #[serde(rename = "base")]
    Base,
}

impl ModelChoice {
    fn id(self) -> &'static str {
        match self {
            ModelChoice::LargeTurbo => "large-v3-turbo-q5_0",
            ModelChoice::Base => "base",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// An NVIDIA driver is installed, so the faster CUDA build can run.
    pub nvidia_gpu: bool,
    /// Bytes still to download for each backend and model (already installed parts are skipped).
    pub sizes: Vec<OptionSize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionSize {
    pub backend: Backend,
    pub model: ModelChoice,
    pub download_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// "runtime", "gpu-libraries", "model" or "installing".
    pub stage: &'static str,
    pub received: u64,
    pub total: u64,
}

fn runtime_dir(root: &Path, backend: Backend) -> PathBuf {
    root.join("tools").join(format!("whisper-{RUNTIME_VERSION}-{}", match backend { Backend::Cpu => "cpu", Backend::Cuda => "cuda" }))
}

fn exe_sha256(backend: Backend) -> &'static str {
    match backend {
        Backend::Cpu => CPU_EXE_SHA256,
        Backend::Cuda => CUDA_EXE_SHA256,
    }
}

fn pack(model: ModelChoice) -> &'static crate::models::PackInfo {
    crate::models::CATALOGUE.iter().find(|p| p.id == model.id()).expect("catalogued model")
}

fn hash_file(path: &Path) -> Result<String> {
    let mut input = BufReader::with_capacity(1 << 20, File::open(path).map_err(|_| "A downloaded file cannot be read.")?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = input.read(&mut buffer).map_err(|_| "A downloaded file cannot be read.")?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn runtime_ready(root: &Path, backend: Backend) -> bool {
    let exe = runtime_dir(root, backend).join("whisper-cli.exe");
    let libs = backend == Backend::Cpu || CUBLAS_LIBRARIES.iter().all(|l| runtime_dir(root, backend).join(l).is_file());
    libs && exe.is_file() && hash_file(&exe).is_ok_and(|h| h == exe_sha256(backend))
}

/// Whether an NVIDIA driver is present (its CUDA driver library ships with it).
pub fn nvidia_gpu() -> bool {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    system.join("System32").join("nvcuda.dll").is_file()
}

pub fn options(root: &Path) -> Options {
    let mut sizes = Vec::new();
    for backend in [Backend::Cpu, Backend::Cuda] {
        for model in [ModelChoice::LargeTurbo, ModelChoice::Base] {
            let runtime = if runtime_ready(root, backend) { 0 } else if backend == Backend::Cuda { CUDA_RUNTIME.bytes + CUBLAS.bytes } else { CPU_RUNTIME.bytes };
            let model_bytes = if crate::models::installed_path(root, pack(model).sha256).is_some() { 0 } else { pack(model).bytes };
            sizes.push(OptionSize { backend, model, download_bytes: runtime + model_bytes });
        }
    }
    Options { nvidia_gpu: nvidia_gpu(), sizes }
}

fn client() -> Result<reqwest::Client> {
    crate::net_guard::client_built();
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 8 {
                attempt.error("too many redirects")
            } else if attempt.url().host_str().is_some_and(allowed_host) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .user_agent("ClearPractice/0.1.0")
        .build()
        .map_err(|_| "Cannot prepare the download.".into())
}

/// Streams `url` into `target.part` while hashing, checks the exact size and
/// SHA-256, then renames it into place. Nothing is left behind on failure.
async fn fetch(client: &reqwest::Client, url: &str, bytes: u64, sha256: &str, target: &Path, cancel: &AtomicBool, progress: &(dyn Fn(u64, u64) + Sync)) -> Result<()> {
    let part = target.with_extension("part");
    let _ = fs::remove_file(&part);
    let result = async {
        let mut response = client
            .get(url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|_| "The download could not start. Check your internet connection and try again.".to_string())?;
        if response.content_length().is_some_and(|n| n != bytes) {
            return Err("The download is not the expected file, so nothing was installed.".to_string());
        }
        let mut file = File::create(&part).map_err(|_| "Cannot write the download to the app data folder.")?;
        let mut digest = Sha256::new();
        let mut received = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|_| "The download was interrupted. Nothing was installed; try again.")? {
            if cancel.load(Ordering::Relaxed) {
                return Err("Stopped. Nothing was installed.".into());
            }
            received += chunk.len() as u64;
            if received > bytes {
                return Err("The download is larger than expected, so nothing was installed.".into());
            }
            digest.update(&chunk);
            file.write_all(&chunk).map_err(|_| "Not enough space in the app data folder.")?;
            progress(received, bytes);
        }
        file.sync_all().map_err(|_| "Cannot finish writing the download.")?;
        drop(file);
        if received != bytes || format!("{:x}", digest.finalize()) != sha256 {
            return Err("The downloaded file did not match its published checksum, so it was deleted. Try again later.".into());
        }
        let _ = fs::remove_file(target);
        fs::rename(&part, target).map_err(|_| "Cannot install the download.".to_string())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

/// Copies the files named by `pick` out of a verified archive into `dir`, flattened.
fn extract(archive: &Path, dir: &Path, pick: impl Fn(&Path) -> bool) -> Result<usize> {
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(archive).map_err(|_| "Cannot open the downloaded archive.")?))
        .map_err(|_| "The downloaded archive is damaged.")?;
    let mut count = 0;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| "The downloaded archive is damaged.")?;
        let Some(path) = entry.enclosed_name() else { continue };
        if !entry.is_file() || !pick(&path) {
            continue;
        }
        let name = path.file_name().ok_or("The downloaded archive is damaged.")?;
        let mut output = File::create(dir.join(name)).map_err(|_| "Cannot write the Whisper files.")?;
        std::io::copy(&mut entry, &mut output).map_err(|_| "Not enough space for the Whisper files.")?;
        output.sync_all().map_err(|_| "Cannot finish writing the Whisper files.")?;
        count += 1;
    }
    Ok(count)
}

/// The verified manifest of every runtime file in the folder (the archive itself was verified).
fn manifest(dir: &Path) -> Result<Vec<RuntimeFile>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|_| "Cannot read the Whisper folder.")? {
        let entry = entry.map_err(|_| "Cannot read the Whisper folder.")?;
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !(lower.ends_with(".dll") || lower == "whisper-cli.exe") {
            continue;
        }
        let path = entry.path();
        files.push(RuntimeFile { bytes: fs::metadata(&path).map_err(|_| "Cannot read the Whisper folder.")?.len(), sha256: hash_file(&path)?, name });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Downloads what is missing for `choice`, verifies and installs it, and
/// returns the worker setup to store. Reports (stage, received, total).
pub async fn install(root: &Path, choice: Choice, cancel: &AtomicBool, progress: impl Fn(Progress) + Send + Sync) -> Result<WorkerConfig> {
    let client = client()?;
    let cache = root.join("cache").join("whisper-download");
    fs::create_dir_all(&cache).map_err(|_| "Cannot create the download folder.")?;
    contained(root, &cache)?;
    let result = async {
        let dir = runtime_dir(root, choice.backend);
        if !runtime_ready(root, choice.backend) {
            let (asset, stage) = match choice.backend {
                Backend::Cpu => (&CPU_RUNTIME, "runtime"),
                Backend::Cuda => (&CUDA_RUNTIME, "runtime"),
            };
            let archive = cache.join("runtime.zip");
            fetch(&client, asset.url, asset.bytes, asset.sha256, &archive, cancel, &|received, total| progress(Progress { stage, received, total })).await?;
            let staging = dir.with_file_name(format!("{}.part", dir.file_name().and_then(|n| n.to_str()).unwrap_or("whisper")));
            let _ = fs::remove_dir_all(&staging);
            fs::create_dir_all(&staging).map_err(|_| "Cannot create the Whisper folder.")?;
            contained(root, &staging)?;
            progress(Progress { stage: "installing", received: 0, total: 0 });
            extract(&archive, &staging, |p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                p.starts_with("Release") && (name.ends_with(".dll") || name == "whisper-cli.exe")
            })?;
            let _ = fs::remove_file(&archive);
            if hash_file(&staging.join("whisper-cli.exe")).ok().as_deref() != Some(exe_sha256(choice.backend)) {
                let _ = fs::remove_dir_all(&staging);
                return Err("The Whisper program did not match its published checksum. Nothing was installed.".into());
            }
            if choice.backend == Backend::Cuda {
                let libraries = cache.join("cublas.zip");
                fetch(&client, CUBLAS.url, CUBLAS.bytes, CUBLAS.sha256, &libraries, cancel, &|received, total| progress(Progress { stage: "gpu-libraries", received, total })).await?;
                progress(Progress { stage: "installing", received: 0, total: 0 });
                let found = extract(&libraries, &staging, |p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| CUBLAS_LIBRARIES.contains(&n)))?;
                let _ = fs::remove_file(&libraries);
                if found != CUBLAS_LIBRARIES.len() {
                    let _ = fs::remove_dir_all(&staging);
                    return Err("NVIDIA's library archive did not contain the expected files. Nothing was installed.".into());
                }
            }
            let _ = fs::remove_dir_all(&dir);
            fs::rename(&staging, &dir).map_err(|_| "Cannot install the Whisper files.")?;
        }

        let pack = pack(choice.model);
        let model = match crate::models::installed_path(root, pack.sha256) {
            Some(path) => path,
            None => {
                let models = root.join("models");
                fs::create_dir_all(&models).map_err(|_| "Cannot create the models folder.")?;
                contained(root, &models)?;
                let target = models.join(pack.file);
                fetch(&client, &model_url(pack.file), pack.bytes, pack.sha256, &target, cancel, &|received, total| progress(Progress { stage: "model", received, total })).await?;
                target
            }
        };
        progress(Progress { stage: "installing", received: 0, total: 0 });
        let config = WorkerConfig {
            version: 1,
            runtime_version: RUNTIME_VERSION.into(),
            executable: dir.join("whisper-cli.exe"),
            runtime_files: manifest(&dir)?,
            model,
            model_id: pack.id.into(),
            model_sha256: pack.sha256.into(),
            backend: choice.backend,
            threads: 4,
            prompt: Some(FILLER_PROMPT.into()),
        };
        config.verify()?;
        Ok(config)
    }
    .await;
    let _ = fs::remove_dir_all(&cache);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_pinned_hosts_are_followed() {
        for ok in ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "huggingface.co", "cdn-lfs.huggingface.co", "cas-bridge.xethub.hf.co", "developer.download.nvidia.com"] {
            assert!(allowed_host(ok), "{ok}");
        }
        for bad in ["evilgithub.com", "github.com.evil.io", "huggingface.co.evil.io", "nvidia.com", "download.nvidia.com.evil.io", "example.com"] {
            assert!(!allowed_host(bad), "{bad}");
        }
    }

    #[test]
    fn choices_name_catalogued_models_and_backends() {
        let choice: Choice = serde_json::from_str(r#"{"backend":"cuda","model":"large-v3-turbo-q5_0"}"#).unwrap();
        assert_eq!(choice, Choice { backend: Backend::Cuda, model: ModelChoice::LargeTurbo });
        assert_eq!(pack(ModelChoice::Base).file, "ggml-base.bin");
        assert!(serde_json::from_str::<Choice>(r#"{"backend":"cuda","model":"tiny"}"#).is_err());
        assert_eq!(model_url("ggml-base.bin"), "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin");
    }

    #[test]
    fn options_count_only_what_is_missing() {
        let root = crate::storage::recording::tests::TestRoot::new();
        let options = options(&root.0);
        let cpu = options.sizes.iter().find(|s| s.backend == Backend::Cpu && s.model == ModelChoice::LargeTurbo).unwrap();
        assert_eq!(cpu.download_bytes, CPU_RUNTIME.bytes + 574_041_195);
        let cuda = options.sizes.iter().find(|s| s.backend == Backend::Cuda && s.model == ModelChoice::Base).unwrap();
        assert_eq!(cuda.download_bytes, CUDA_RUNTIME.bytes + CUBLAS.bytes + 147_951_465);
    }

    /// Network, 8 MB: the pinned CPU release downloads, verifies and has the expected
    /// layout; the model and NVIDIA archives answer with their pinned sizes (no body
    /// is downloaded). `cargo test --lib whisper_setup_urls -- --ignored`.
    #[test]
    #[ignore]
    fn whisper_setup_urls_resolve_to_the_pinned_files() {
        let root = crate::storage::recording::tests::TestRoot::new();
        let cancel = AtomicBool::new(false);
        tauri::async_runtime::block_on(async {
            let client = client().unwrap();
            let archive = root.0.join("runtime.zip");
            fetch(&client, CPU_RUNTIME.url, CPU_RUNTIME.bytes, CPU_RUNTIME.sha256, &archive, &cancel, &|_, _| {}).await.unwrap();
            let dir = root.0.join("cpu");
            fs::create_dir_all(&dir).unwrap();
            let found = extract(&archive, &dir, |p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                p.starts_with("Release") && (name.ends_with(".dll") || name == "whisper-cli.exe")
            })
            .unwrap();
            assert!(found >= 2, "whisper-cli.exe and its libraries");
            assert_eq!(hash_file(&dir.join("whisper-cli.exe")).unwrap(), CPU_EXE_SHA256);
            for (url, bytes) in [(model_url("ggml-base.bin"), 147_951_465u64), (model_url("ggml-large-v3-turbo-q5_0.bin"), 574_041_195), (CUDA_RUNTIME.url.into(), CUDA_RUNTIME.bytes), (CUBLAS.url.into(), CUBLAS.bytes)] {
                let head = client.head(&url).send().await.and_then(|r| r.error_for_status()).unwrap();
                // A HEAD response has no body, so read the advertised size from its header.
                let advertised = head.headers().get(reqwest::header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
                assert_eq!(advertised, Some(bytes), "{url}");
            }
        });
    }

    /// Network and about 600 MB: `cargo test --lib whisper_setup -- --ignored`.
    #[test]
    #[ignore]
    fn downloads_and_verifies_the_cpu_runtime_and_base_model() {
        let root = crate::storage::recording::tests::TestRoot::new();
        let cancel = AtomicBool::new(false);
        let config = tauri::async_runtime::block_on(install(&root.0, Choice { backend: Backend::Cpu, model: ModelChoice::Base }, &cancel, |_| {})).unwrap();
        assert!(config.executable.ends_with("whisper-cli.exe"));
        assert!(runtime_ready(&root.0, Backend::Cpu));
    }
}
