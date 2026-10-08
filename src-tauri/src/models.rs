//! Whisper model pack registry (plan 3.3): known packs with ID, exact size,
//! SHA-256, licence and language scope; verified import into the app's
//! `models/` folder with an atomic install. Weights are never downloaded here.
use crate::audio::prepare::contained;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug)]
pub struct PackInfo {
    pub id: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    pub license: &'static str,
    pub language: &'static str,
    pub source: &'static str,
}

/// Pinned in bench/whisper-assets.json (0.12) and verified against upstream.
pub const CATALOGUE: [PackInfo; 2] = [
    PackInfo {
        id: "base",
        file: "ggml-base.bin",
        bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        license: "MIT (whisper.cpp ggml conversion of OpenAI Whisper)",
        language: "Multilingual; used for English practice",
        source: "https://huggingface.co/ggerganov/whisper.cpp",
    },
    PackInfo {
        id: "large-v3-turbo-q5_0",
        file: "ggml-large-v3-turbo-q5_0.bin",
        bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        license: "MIT (whisper.cpp ggml conversion of OpenAI Whisper)",
        language: "Multilingual; used for English practice",
        source: "https://huggingface.co/ggerganov/whisper.cpp",
    },
];

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    pub id: String,
    pub bytes: u64,
    pub sha256: String,
    pub license: String,
    pub language: String,
    pub source: String,
    /// Present in the app's models folder with the exact catalogue size.
    pub installed: bool,
}

fn status_of(root: &Path, pack: &PackInfo) -> PackStatus {
    let path = root.join("models").join(pack.file);
    let installed = fs::symlink_metadata(&path).is_ok_and(|m| m.is_file() && m.len() == pack.bytes);
    PackStatus {
        id: pack.id.into(),
        bytes: pack.bytes,
        sha256: pack.sha256.into(),
        license: pack.license.into(),
        language: pack.language.into(),
        source: pack.source.into(),
        installed,
    }
}

pub fn list(root: &Path) -> Vec<PackStatus> {
    CATALOGUE.iter().map(|p| status_of(root, p)).collect()
}

/// Path of an installed pack with this checksum, if any. Size is checked here;
/// the worker re-hashes the model before every run.
pub fn installed_path(root: &Path, sha256: &str) -> Option<PathBuf> {
    let pack = CATALOGUE.iter().find(|p| p.sha256 == sha256)?;
    status_of(root, pack).installed.then(|| root.join("models").join(pack.file))
}

fn hash(path: &Path) -> Result<String> {
    let mut input = BufReader::with_capacity(1 << 20, File::open(path).map_err(|_| "The model file cannot be read.")?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = input.read(&mut buffer).map_err(|_| "The model file cannot be read.")?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub fn import(root: &Path, source: &Path) -> Result<PackStatus> {
    import_with(root, source, &CATALOGUE)
}

/// Verifies `source` against the catalogue, copies it as `.part` while hashing
/// the copy, syncs, and renames it into place. Nothing is installed on failure.
pub fn import_with(root: &Path, source: &Path, catalogue: &[PackInfo]) -> Result<PackStatus> {
    let size = fs::metadata(source).map_err(|_| "The model file cannot be read.")?.len();
    let pack = catalogue
        .iter()
        .find(|p| p.bytes == size)
        .ok_or("This file is not a known Whisper model pack (size does not match).")?;
    if hash(source)? != pack.sha256 {
        return Err("This file does not match the known model checksum. It was not installed.".into());
    }
    let dir = root.join("models");
    fs::create_dir_all(&dir).map_err(|_| "Cannot create the models folder.")?;
    contained(root, &dir)?;
    let target = dir.join(pack.file);
    if status_of_with(root, pack).installed && hash(&target)? == pack.sha256 {
        return Ok(status_of_with(root, pack));
    }
    let part = dir.join(format!("{}.part", pack.file));
    let _ = fs::remove_file(&part);
    let result = (|| {
        let mut input = BufReader::with_capacity(1 << 20, File::open(source).map_err(|_| "The model file cannot be read.")?);
        let mut output = BufWriter::with_capacity(1 << 20, File::create_new(&part).map_err(|_| "Cannot write to the models folder.")?);
        let mut digest = Sha256::new();
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = input.read(&mut buffer).map_err(|_| "The model file cannot be read.")?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(|_| "Not enough space to install the model.")?;
        }
        let file = output.into_inner().map_err(|_| "Not enough space to install the model.")?;
        file.sync_all().map_err(|_| "Cannot finish writing the model.")?;
        drop(file);
        if format!("{:x}", digest.finalize()) != pack.sha256 {
            return Err("The copied model failed verification. It was not installed.".to_string());
        }
        fs::rename(&part, &target).map_err(|_| "Cannot finish installing the model.".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result?;
    Ok(status_of_with(root, pack))
}

fn status_of_with(root: &Path, pack: &PackInfo) -> PackStatus {
    status_of(root, pack)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn fake_catalogue(bytes: &[u8]) -> [PackInfo; 1] {
        let sha: &'static str = Box::leak(format!("{:x}", Sha256::digest(bytes)).into_boxed_str());
        [PackInfo { id: "tiny-test", file: "ggml-tiny-test.bin", bytes: bytes.len() as u64, sha256: sha, license: "test", language: "en", source: "https://example.test" }]
    }

    #[test]
    fn import_verifies_size_and_checksum_and_installs_atomically() {
        let root = TestRoot::new();
        let outside = TestRoot::new();
        let model = vec![7u8; 4096];
        let catalogue = fake_catalogue(&model);
        let good = outside.0.join("model.bin");
        fs::write(&good, &model).unwrap();

        let status = import_with(&root.0, &good, &catalogue).unwrap();
        assert!(status.installed);
        assert_eq!(fs::read(root.0.join("models/ggml-tiny-test.bin")).unwrap(), model);
        assert!(!root.0.join("models/ggml-tiny-test.bin.part").exists());
        assert!(import_with(&root.0, &good, &catalogue).unwrap().installed, "re-import is idempotent");

        let mut tampered = model.clone();
        tampered[10] = 8;
        let bad = outside.0.join("bad.bin");
        fs::write(&bad, &tampered).unwrap();
        assert!(import_with(&root.0, &bad, &catalogue).unwrap_err().contains("checksum"));
        let wrong_size = outside.0.join("small.bin");
        fs::write(&wrong_size, b"tiny").unwrap();
        assert!(import_with(&root.0, &wrong_size, &catalogue).unwrap_err().contains("not a known"));
        assert_eq!(fs::read(root.0.join("models/ggml-tiny-test.bin")).unwrap(), model, "a failed import never replaces a good pack");
    }

    /// Real file: `cargo test --lib models -- --ignored`. Imports the existing
    /// base pack from the folder recorded in bench/runtime.local/config-selected.json.
    #[test]
    #[ignore]
    fn hardware_imports_the_real_base_pack() {
        let bench = Path::new(env!("CARGO_MANIFEST_DIR")).join("../bench/runtime.local/config-selected.json");
        let config: serde_json::Value = serde_json::from_slice(&fs::read(bench).unwrap()).unwrap();
        let folder = Path::new(config["model"].as_str().unwrap()).parent().unwrap().to_path_buf();
        let root = TestRoot::new();
        let status = import(&root.0, &folder.join("ggml-base.bin")).unwrap();
        assert!(status.installed && status.id == "base");
        assert_eq!(installed_path(&root.0, CATALOGUE[0].sha256), Some(root.0.join("models").join("ggml-base.bin")));
    }

    #[test]
    fn the_catalogue_lists_both_selected_packs_with_licences() {
        let root = TestRoot::new();
        let packs = list(&root.0);
        assert_eq!(packs.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["base", "large-v3-turbo-q5_0"]);
        assert!(packs.iter().all(|p| !p.installed && p.license.contains("MIT") && p.sha256.len() == 64));
        assert!(installed_path(&root.0, CATALOGUE[1].sha256).is_none());
    }
}
