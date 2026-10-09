//! Endpoint-bound Windows credentials. IPC exposes only presence, write, and
//! delete; plaintext reads stay native and secrets have no Debug/Serialize impl.
use serde::Serialize;

const TARGET: &str = "ClearPractice/v1/https-api.openai.com";
const MAX_KEY: usize = 2560;
type Result<T> = std::result::Result<T, String>;

pub struct Secret(Vec<u8>);
impl Secret {
    pub(crate) fn new(value: String) -> Result<Self> {
        let secret = Self(value.into_bytes());
        if secret.0.is_empty()
            || secret.0.len() > MAX_KEY
            || !secret.0.iter().all(|b| (33..=126).contains(b))
        {
            return Err(
                "Enter an API key without spaces, within the Windows credential size limit.".into(),
            );
        }
        Ok(secret)
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}
impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}
fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe {
            std::ptr::write_volatile(byte, 0);
        }
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub provider: String,
    pub present: bool,
}

pub fn status() -> Result<CredentialStatus> {
    Ok(CredentialStatus {
        provider: "OpenAI".into(),
        present: vault::read(TARGET)?.is_some(),
    })
}
pub fn store(key: String) -> Result<CredentialStatus> {
    let secret = Secret::new(key)?;
    vault::write(TARGET, &secret)?;
    status()
}
pub fn remove() -> Result<CredentialStatus> {
    vault::delete(TARGET)?;
    status()
}
/// For the native provider adapter. Never register this as a Tauri command.
pub fn read() -> Result<Option<Secret>> {
    vault::read(TARGET)
}

/// Transcription providers each get their own slot, bound to their endpoint,
/// so a key is never sent to a different service (D-21, shared rule 5).
pub fn transcription_target(provider: &str) -> Result<&'static str> {
    match provider {
        "deepgram" => Ok("ClearPractice/v1/https-api.deepgram.com"),
        "assemblyai" => Ok("ClearPractice/v1/https-api.assemblyai.com"),
        _ => Err("Unknown transcription provider.".into()),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus {
    pub provider: String,
    pub present: bool,
}

pub fn provider_status(provider: &str) -> Result<ProviderKeyStatus> {
    Ok(ProviderKeyStatus { provider: provider.into(), present: vault::read(transcription_target(provider)?)?.is_some() })
}
pub fn store_provider(provider: &str, key: String) -> Result<ProviderKeyStatus> {
    let target = transcription_target(provider)?;
    let secret = Secret::new(key)?;
    vault::write(target, &secret)?;
    provider_status(provider)
}
pub fn remove_provider(provider: &str) -> Result<ProviderKeyStatus> {
    vault::delete(transcription_target(provider)?)?;
    provider_status(provider)
}
/// Native adapters only. Never register this as a Tauri command.
pub fn read_provider(provider: &str) -> Result<Option<Secret>> {
    vault::read(transcription_target(provider)?)
}

#[cfg(windows)]
mod vault {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    fn target(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    const FAILURE: &str =
        "Windows Credential Manager is unavailable. Check your Windows sign-in and try again.";

    struct Allocation(*mut CREDENTIALW);
    impl Drop for Allocation {
        fn drop(&mut self) {
            unsafe {
                let credential = &*self.0;
                // CredRead owns this mutable allocation until CredFree. Clear
                // just the bounded blob before releasing it back to Windows.
                if !credential.CredentialBlob.is_null()
                    && credential.CredentialBlobSize as usize <= MAX_KEY
                {
                    wipe(std::slice::from_raw_parts_mut(
                        credential.CredentialBlob,
                        credential.CredentialBlobSize as usize,
                    ));
                }
                CredFree(self.0.cast());
            }
        }
    }

    pub fn read(name: &str) -> Result<Option<Secret>> {
        let name = target(name);
        let mut pointer = std::ptr::null_mut();
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(FAILURE.into())
            };
        }
        if pointer.is_null() {
            return Err(FAILURE.into());
        }
        let allocation = Allocation(pointer);
        let credential = unsafe { &*allocation.0 };
        let size = credential.CredentialBlobSize as usize;
        if size == 0 || size > MAX_KEY || credential.CredentialBlob.is_null() {
            return Err("The stored API key is invalid. Replace or remove it in Settings.".into());
        }
        let secret =
            Secret(unsafe { std::slice::from_raw_parts(credential.CredentialBlob, size) }.to_vec());
        if !secret.0.iter().all(|b| (33..=126).contains(b)) {
            return Err("The stored API key is invalid. Replace or remove it in Settings.".into());
        }
        Ok(Some(secret))
    }

    pub fn write(name: &str, secret: &Secret) -> Result<()> {
        let mut name = target(name);
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: secret.0.len() as u32,
            // CredWrite's pointer type is mutable, but its documented input
            // is read-only for the duration of this synchronous call.
            CredentialBlob: secret.0.as_ptr().cast_mut(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(FAILURE.into())
        } else {
            Ok(())
        }
    }

    pub fn delete(name: &str) -> Result<()> {
        let name = target(name);
        if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            Ok(())
        } else {
            Err(FAILURE.into())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        #[ignore = "writes a disposable fake credential to Windows; run explicitly"]
        fn windows_round_trip_replace_and_remove() {
            let name = format!(
                "ClearPractice/tests/{}-{}",
                std::process::id(),
                crate::storage::recording::now_ms()
            );
            struct Cleanup(String);
            impl Drop for Cleanup {
                fn drop(&mut self) {
                    let _ = delete(&self.0);
                }
            }
            let _cleanup = Cleanup(name.clone());
            assert!(read(&name).unwrap().is_none());
            write(
                &name,
                &Secret::new("fake-development-key-1".into()).unwrap(),
            )
            .unwrap();
            assert!(read(&name)
                .unwrap()
                .is_some_and(|s| s.as_bytes() == b"fake-development-key-1"));
            write(
                &name,
                &Secret::new("fake-development-key-2".into()).unwrap(),
            )
            .unwrap();
            assert!(read(&name)
                .unwrap()
                .is_some_and(|s| s.as_bytes() == b"fake-development-key-2"));
            delete(&name).unwrap();
            delete(&name).unwrap();
            assert!(read(&name).unwrap().is_none());
            println!("Disposable credential create/read/replace/delete verified; no key returned to IPC.");
        }
    }
}

#[cfg(not(windows))]
mod vault {
    use super::*;
    pub fn read(_: &str) -> Result<Option<Secret>> {
        Err("API credentials require Windows Credential Manager.".into())
    }
    pub fn write(_: &str, _: &Secret) -> Result<()> {
        Err("API credentials require Windows Credential Manager.".into())
    }
    pub fn delete(_: &str) -> Result<()> {
        Err("API credentials require Windows Credential Manager.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_keys_and_redacts_status() {
        for invalid in [
            String::new(),
            "secret with space".into(),
            "secret\nline".into(),
            "secret\0".into(),
            "x".repeat(MAX_KEY + 1),
        ] {
            let error = Secret::new(invalid.clone()).err().unwrap();
            assert!(!error.contains("secret"));
        }
        let encoded = serde_json::to_string(&CredentialStatus {
            provider: "OpenAI".into(),
            present: true,
        })
        .unwrap();
        assert_eq!(encoded, r#"{"provider":"OpenAI","present":true}"#);
    }

    /// 5.5: a key is bound to the exact endpoint its slot names. Every API
    /// address the adapters call must be the host of that provider's slot, so a
    /// changed or new endpoint can never be sent an existing key; the local
    /// model adapter never reads a key at all.
    #[test]
    fn every_called_endpoint_matches_the_key_slot_it_uses() {
        let host = |slot: &str| slot.strip_prefix("ClearPractice/v1/https-").unwrap().to_string();
        let openai = host(TARGET);
        let deepgram = host(transcription_target("deepgram").unwrap());
        let assemblyai = host(transcription_target("assemblyai").unwrap());
        assert_eq!((openai.as_str(), deepgram.as_str(), assemblyai.as_str()), ("api.openai.com", "api.deepgram.com", "api.assemblyai.com"));
        let called = |source: &str| -> Vec<String> {
            source.match_indices("https://api.").map(|(at, _)| {
                let rest = &source[at + "https://".len()..];
                rest[..rest.find(['/', '"', '?']).unwrap_or(rest.len())].to_string()
            }).collect()
        };
        let transport = include_str!("api/transport.rs");
        let production = |text: &'static str| text.split("#[cfg(test)]").next().unwrap();
        // The transport sends text only to OpenAI and audio only to the two hosts on its allow-list.
        for h in called(production(transport)) {
            assert!([&openai, &deepgram, &assemblyai].contains(&&h), "transport names {h}, which has no key slot");
        }
        for h in called(production(include_str!("api/audio.rs"))) {
            assert!(h == deepgram || h == assemblyai, "audio adapter calls {h}, which has no key slot");
        }
        for h in called(production(include_str!("api/coaching.rs"))) {
            assert_eq!(h, openai, "coaching previews name only OpenAI");
        }
        assert!(!include_str!("api/local_llm.rs").contains("credentials::"), "the local model never reads a key");
        assert!(transcription_target("openai").is_err(), "no slot is shared between purposes");
    }
}
