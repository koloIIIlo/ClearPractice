use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputConfig {
    channels: u16,
    min_sample_rate: u32,
    max_sample_rate: u32,
    sample_format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    id: String,
    name: String,
    is_default: bool,
    available: bool,
    supported_configs: Vec<InputConfig>,
}

/// Only reads device metadata; it does not open a microphone stream. Runs off
/// the window thread, so Refresh never freezes the interface.
#[tauri::command]
pub async fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    tauri::async_runtime::spawn_blocking(enumerate_input_devices)
        .await
        .map_err(|_| "Cannot list input devices.".to_string())?
}

pub fn enumerate_input_devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|device| device.id().ok());
    let input_devices = host
        .input_devices()
        .map_err(|error| format!("Cannot list input devices: {error}"))?;

    let mut devices = Vec::new();
    for device in input_devices {
        // A device may be unplugged between enumeration and reading its ID.
        let Ok(id) = device.id() else { continue };
        let supported_configs = device
            .supported_input_configs()
            .map(|configs| {
                configs
                    .map(|config| InputConfig {
                        channels: config.channels(),
                        min_sample_rate: config.min_sample_rate(),
                        max_sample_rate: config.max_sample_rate(),
                        sample_format: format!("{:?}", config.sample_format()),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        devices.push(InputDevice {
            id: id.to_string(),
            name: device.to_string(),
            is_default: default_id.as_ref() == Some(&id),
            available: !supported_configs.is_empty(),
            supported_configs,
        });
    }
    devices.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(devices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a live audio host and microphone access"]
    fn discover_local_input_devices() {
        let devices = enumerate_input_devices().expect("enumerate input devices");
        for device in &devices {
            println!(
                "{}: {} ({} formats)",
                device.id,
                device.name,
                device.supported_configs.len()
            );
        }
    }
}
