pub mod api;
mod app_paths;
pub mod audio;
mod audio_devices;
pub mod credentials;
pub mod storage;

use audio::capture::{CaptureService, RecordingStatus, StartRequest};
use std::sync::Arc;
use storage::recording::{RecoverableRecording, SavedRecording};
use tauri::{Emitter, Manager, State};

struct ApiAccounting(Result<api::budget::BudgetOwner, String>, std::path::PathBuf);
struct SessionStorage(Result<storage::database::DatabaseOwner, String>);

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionFilter {
    query: Option<String>,
    exercise_type: Option<String>,
    #[serde(default)]
    favorites_only: bool,
}

#[tauri::command]
async fn list_sessions(
    storage: State<'_, Arc<SessionStorage>>,
    filter: Option<SessionFilter>,
) -> Result<Vec<serde_json::Value>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let filter = filter.unwrap_or_default();
        storage.0.as_ref().map_err(Clone::clone)?.list_sessions(
            filter.query.as_deref(),
            filter.exercise_type.as_deref(),
            filter.favorites_only,
        )
    })
    .await
    .map_err(|_| "Session storage worker failed.".to_string())?
}

#[tauri::command]
async fn get_session(
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage
            .0
            .as_ref()
            .map_err(Clone::clone)?
            .get_session(&session_id)
    })
    .await
    .map_err(|_| "Session storage worker failed.".to_string())?
}

#[tauri::command]
async fn update_session(
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
    title: String,
    notes: String,
    tags: Vec<String>,
    favorite: bool,
) -> Result<(), String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.0.as_ref().map_err(Clone::clone)?.update_session(
            &session_id,
            &title,
            &notes,
            &tags,
            favorite,
        )
    })
    .await
    .map_err(|_| "Session storage worker failed.".to_string())?
}

#[tauri::command]
async fn get_saved_recording(
    storage: State<'_, Arc<SessionStorage>>,
    asset_id: String,
) -> Result<SavedRecording, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.0.as_ref().map_err(Clone::clone)?.checked_recording(&asset_id)
    })
    .await
    .map_err(|_| "Recording storage worker failed.".to_string())?
}

#[tauri::command]
fn preview_coaching_request(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    selected_text: String,
) -> Result<api::coaching::Preview, String> {
    owner.preview(selected_text)
}

#[tauri::command]
fn cancel_coaching_preview(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    request_id: String,
) -> Result<(), String> {
    owner.cancel(&request_id)
}

#[tauri::command]
async fn request_coaching(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    capture: State<'_, Arc<CaptureService>>,
    request_id: String,
    payload_sha256: String,
) -> Result<api::coaching::FeedbackResult, String> {
    if capture.is_active() {
        return Err("Stop and save recording before starting the feedback test.".into());
    }
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    owner
        .send(
            accounting.0.as_ref().map_err(Clone::clone)?,
            &accounting.1,
            &request_id,
            &payload_sha256,
        )
        .await
}

#[tauri::command]
async fn get_api_usage_summary(
    accounting: State<'_, Arc<ApiAccounting>>,
) -> Result<api::budget::BudgetSummary, String> {
    let accounting = accounting.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        accounting.0.as_ref().map_err(Clone::clone)?.summary()
    })
    .await
    .map_err(|_| "API accounting worker failed.".to_string())?
}

#[tauri::command]
async fn get_api_key_status() -> Result<credentials::CredentialStatus, String> {
    tauri::async_runtime::spawn_blocking(credentials::status)
        .await
        .map_err(|_| "Credential worker failed.".to_string())?
}

#[tauri::command]
async fn store_api_key(key: String) -> Result<credentials::CredentialStatus, String> {
    tauri::async_runtime::spawn_blocking(move || credentials::store(key))
        .await
        .map_err(|_| "Credential worker failed.".to_string())?
}

#[tauri::command]
async fn remove_api_key() -> Result<credentials::CredentialStatus, String> {
    tauri::async_runtime::spawn_blocking(credentials::remove)
        .await
        .map_err(|_| "Credential worker failed.".to_string())?
}

#[tauri::command]
async fn start_recording(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    context: Option<storage::database::PracticeContext>,
    request: StartRequest,
) -> Result<RecordingStatus, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.0.as_ref().map_err(Clone::clone)?.reserve(
            &request.attempt_id,
            &request.idempotency_key,
            &request.title,
            context.as_ref(),
        )?;
        let status = service.start(request)?;
        if let Some(saved) = status.asset.as_ref().filter(|_| status.phase == "saved") {
            storage
                .0
                .as_ref()
                .map_err(Clone::clone)?
                .commit_recording(saved)?;
        }
        Ok(status)
    })
    .await
    .map_err(|_| "Recording worker failed.".to_string())?
}

#[tauri::command]
async fn stop_recording(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
) -> Result<SavedRecording, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let saved = service.stop(&attempt_id)?;
        storage
            .0
            .as_ref()
            .map_err(Clone::clone)?
            .commit_recording(&saved)?;
        let _ = app.emit("recording_saved", RecordingStatus::saved(saved.clone()));
        Ok(saved)
    })
    .await
    .map_err(|_| "Recording worker failed.".to_string())?
}

#[tauri::command]
async fn get_recording_status(
    service: State<'_, Arc<CaptureService>>,
) -> Result<Option<RecordingStatus>, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.status())
        .await
        .map_err(|_| "Recording worker failed.".to_string())?
}

#[tauri::command]
async fn list_recordings(
    service: State<'_, Arc<CaptureService>>,
) -> Result<Vec<SavedRecording>, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage::recording::list_saved(&service.root))
        .await
        .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn list_recoverable_recordings(
    service: State<'_, Arc<CaptureService>>,
) -> Result<Vec<RecoverableRecording>, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let active = service
            .status()?
            .filter(|s| matches!(s.phase.as_str(), "preparing" | "recording" | "finalizing"));
        let list = storage::recording::list_recoverable(&service.root)?;
        Ok(list
            .into_iter()
            .filter(|r| active.as_ref().is_none_or(|a| a.attempt_id != r.attempt_id))
            .collect())
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn recover_recording(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
) -> Result<SavedRecording, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let saved = service.recover(&attempt_id)?;
        storage
            .0
            .as_ref()
            .map_err(Clone::clone)?
            .commit_recording(&saved)?;
        let _ = app.emit("recording_saved", RecordingStatus::saved(saved.clone()));
        Ok(saved)
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn get_recording_playback_path(
    storage: State<'_, Arc<SessionStorage>>,
    asset_id: String,
) -> Result<String, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.0.as_ref().map_err(Clone::clone)?.playback_path(&asset_id)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn get_recording_waveform(
    storage: State<'_, Arc<SessionStorage>>,
    asset_id: String,
) -> Result<audio::peaks::WaveformPeaks, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.0.as_ref().map_err(Clone::clone)?.waveform(&asset_id)
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
fn close_after_recording(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
) -> Result<(), String> {
    if service.is_active() {
        return Err("Stop and save the active recording before closing.".into());
    }
    app.get_webview_window("main")
        .ok_or("The main window is unavailable.")?
        .close()
        .map_err(|_| "Cannot close the window.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            app_paths::prepare_app_data(&root)?;
            app.manage(Arc::new(SessionStorage(
                storage::database::DatabaseOwner::open(&root),
            )));
            // Damaged/unavailable accounting disables API work, while capture
            // and offline practice still start normally.
            app.manage(Arc::new(ApiAccounting(
                api::budget::BudgetOwner::open(&root),
                root.clone(),
            )));
            app.manage(Arc::new(api::coaching::PreviewOwner::default()));
            let handle = app.handle().clone();
            app.manage(Arc::new(CaptureService::new(
                root,
                Arc::new(move |event, status| {
                    // Capture's file receipt precedes SQLite's reference commit.
                    // Commands announce Saved only after both are durable.
                    if status.phase == "saved" {
                        return;
                    }
                    let _ = handle.emit(event, status);
                }),
            )));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Arc<CaptureService>>().is_active() {
                    api.prevent_close();
                    let _ = window.emit("recording_close_requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            audio_devices::list_input_devices,
            list_sessions,
            get_session,
            update_session,
            get_saved_recording,
            get_api_key_status,
            get_api_usage_summary,
            preview_coaching_request,
            cancel_coaching_preview,
            request_coaching,
            store_api_key,
            remove_api_key,
            start_recording,
            stop_recording,
            get_recording_status,
            list_recordings,
            list_recoverable_recordings,
            recover_recording,
            get_recording_playback_path,
            get_recording_waveform,
            close_after_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
