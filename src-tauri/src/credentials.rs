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
}
