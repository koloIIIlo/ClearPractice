pub mod api;
mod app_paths;
pub mod audio;
pub mod backup;
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
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Vec<SavedRecording>, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let hidden = hidden_assets(&storage)?;
        Ok(storage::recording::list_saved(&service.root)?
            .into_iter()
            .filter(|r| !hidden.contains(&r.asset_id))
            .collect())
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

/// Takes in Trash or awaiting permanent removal never appear in the library.
/// Without session storage nothing can be in Trash, so nothing is hidden.
fn hidden_assets(storage: &SessionStorage) -> Result<std::collections::HashSet<String>, String> {
    match &storage.0 {
        Ok(owner) => owner.hidden_asset_ids(),
        Err(_) => Ok(Default::default()),
    }
}

#[tauri::command]
async fn list_recoverable_recordings(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Vec<RecoverableRecording>, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let hidden = hidden_assets(&storage)?;
        let active = service
            .status()?
            .filter(|s| matches!(s.phase.as_str(), "preparing" | "recording" | "finalizing"));
        let list = storage::recording::list_recoverable(&service.root)?;
        Ok(list
            .into_iter()
            .filter(|r| active.as_ref().is_none_or(|a| a.attempt_id != r.attempt_id))
            .filter(|r| !hidden.contains(&r.attempt_id))
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
        if hidden_assets(&storage)?.contains(&attempt_id) {
            return Err("This take belongs to a session in Trash. Restore the session first.".into());
        }
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

fn with_storage<T: Send + 'static>(
    storage: &State<'_, Arc<SessionStorage>>,
    work: impl FnOnce(&storage::database::DatabaseOwner) -> Result<T, String> + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(storage.0.as_ref().map_err(Clone::clone)?))
}

#[tauri::command]
async fn list_trash(storage: State<'_, Arc<SessionStorage>>) -> Result<serde_json::Value, String> {
    with_storage(&storage, |owner| owner.list_trash())
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn move_session_to_trash(
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
) -> Result<(), String> {
    with_storage(&storage, move |owner| {
        owner.move_to_trash(&session_id, storage::recording::now_ms())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn restore_session(
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.restore_from_trash(&session_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PurgeOutcome {
    files_pending: bool,
}

#[tauri::command]
async fn delete_sessions_permanently(
    storage: State<'_, Arc<SessionStorage>>,
    session_ids: Vec<String>,
) -> Result<PurgeOutcome, String> {
    with_storage(&storage, move |owner| {
        owner
            .delete_permanently(&session_ids)
            .map(|files_pending| PurgeOutcome { files_pending })
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn empty_trash(storage: State<'_, Arc<SessionStorage>>) -> Result<PurgeOutcome, String> {
    with_storage(&storage, |owner| {
        owner
            .empty_trash()
            .map(|files_pending| PurgeOutcome { files_pending })
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_trash_retention(
    storage: State<'_, Arc<SessionStorage>>,
    days: u32,
) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.set_trash_retention_days(days))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupStatus {
    /// Shown to the user only; the UI never sends paths back.
    destination: Option<String>,
    destination_available: bool,
    backups: Vec<serde_json::Value>,
}

fn backup_status(owner: &storage::database::DatabaseOwner) -> Result<BackupStatus, String> {
    let destination = owner.setting(backup::DESTINATION_KEY)?;
    Ok(BackupStatus {
        destination_available: destination
            .as_deref()
            .is_some_and(|d| std::path::Path::new(d).is_dir()),
        destination,
        backups: owner.backups()?,
    })
}

#[tauri::command]
async fn get_backup_status(storage: State<'_, Arc<SessionStorage>>) -> Result<BackupStatus, String> {
    with_storage(&storage, backup_status)
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Opens the native folder picker. Cancelling keeps the current folder.
#[tauri::command]
async fn choose_backup_destination(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<BackupStatus, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a folder for ClearPractice backups")
            .blocking_pick_folder();
        if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
            let path = path.to_string_lossy().into_owned();
            owner.set_setting(backup::DESTINATION_KEY, &path)?;
        }
        backup_status(owner)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn create_backup(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<backup::BackupSummary, String> {
    if service.is_active() {
        return Err("Finish the current recording before creating a backup.".into());
    }
    with_storage(&storage, |owner| {
        let destination = owner
            .setting(backup::DESTINATION_KEY)?
            .ok_or("Choose a backup folder first.")?;
        backup::create(owner, std::path::Path::new(&destination), storage::recording::now_ms())
    })
    .await
    .map_err(|_| "Backup failed.".to_string())?
}

/// Picks a backup file natively and validates it into a staging folder. The
/// current profile is not changed; `None` means the picker was cancelled.
#[tauri::command]
async fn preview_restore(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Option<backup::RestorePreview>, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a ClearPractice backup")
            .add_filter("ClearPractice backup", &["zip"])
            .blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        let staging_id = format!("restore-{}", storage::recording::now_ms());
        backup::inspect(owner.root(), &path, &staging_id).map(Some)
    })
    .await
    .map_err(|_| "Restore check failed.".to_string())?
}

#[tauri::command]
async fn discard_restore_preview(
    storage: State<'_, Arc<SessionStorage>>,
    staging_id: String,
) -> Result<(), String> {
    with_storage(&storage, move |owner| backup::discard_staging(owner.root(), &staging_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            app_paths::prepare_app_data(&root)?;
            backup::clean_staging(&root);
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
            list_trash,
            move_session_to_trash,
            restore_session,
            delete_sessions_permanently,
            empty_trash,
            set_trash_retention,
            get_backup_status,
            choose_backup_destination,
            create_backup,
            preview_restore,
            discard_restore_preview,
            close_after_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
