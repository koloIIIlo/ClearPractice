mod app_paths;
mod audio_devices;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            app_paths::prepare_app_data(&root)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            audio_devices::list_input_devices
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
