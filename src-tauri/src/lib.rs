pub mod activity;
pub mod activity_results;
pub mod analysis;
pub mod api;
mod commands;
pub mod engagement;
pub mod exercise_types;
mod app_paths;
pub mod data_location;
pub mod audio;
pub mod backup;
mod audio_devices;
pub mod credentials;
pub mod mic_test;
pub mod models;
pub mod clips;
pub mod clipsplit;
pub mod linkaudio;
pub mod preferences;
pub mod prosody;
pub mod sources;
pub mod storage;
pub mod take_coaching;
pub mod storage_usage;
pub mod diagnostics;
pub mod timings;
mod net_guard;
mod redaction_audit;
// Release acceptance checks (A-1–A-25); one line so the log guard keeps scanning this file.
#[cfg(test)] mod acceptance;
pub mod transcribe;
pub mod whisper_setup;

use audio::capture::{CaptureService, RecordingStatus, StartRequest};
use std::sync::Arc;
use storage::recording::{RecoverableRecording, SavedRecording};
use tauri::{Emitter, Manager, State};

/// The Whisper worker plus the single running transcription job.
struct Transcription {
    worker: audio::whisper::WhisperWorker,
    active: transcribe::ActiveJob,
}

pub(crate) struct ApiAccounting(Result<api::budget::BudgetOwner, String>, std::path::PathBuf);
/// API transcriptions in flight, by request ID, each with a way to stop waiting (3.18).
#[derive(Default)]
struct InflightApi(std::sync::Mutex<std::collections::HashMap<String, Box<dyn Fn() + Send + Sync>>>);
/// The session database owner. Restore swaps it under the write lock; every other
/// command holds the read lock for the whole of its storage or file work.
pub(crate) struct SessionStorage(std::sync::RwLock<Result<storage::database::DatabaseOwner, String>>);

impl SessionStorage {
    fn with<T>(
        &self,
        work: impl FnOnce(&storage::database::DatabaseOwner) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = self
            .0
            .read()
            .map_err(|_| "Session storage is unavailable.".to_string())?;
        work(guard.as_ref().map_err(Clone::clone)?)
    }
}

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
        storage.with(|owner| {
            owner.list_sessions(
                filter.query.as_deref(),
                filter.exercise_type.as_deref(),
                filter.favorites_only,
            )
        })
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
        storage.with(|owner| owner.get_session(&session_id))
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
        storage.with(|owner| owner.update_session(&session_id, &title, &notes, &tags, favorite))
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
        storage.with(|owner| owner.checked_recording(&asset_id))
    })
    .await
    .map_err(|_| "Recording storage worker failed.".to_string())?
}

#[tauri::command]
fn preview_coaching_request(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    selected_text: String,
    model: Option<api::coaching::CoachingModel>,
) -> Result<api::coaching::Preview, String> {
    owner.preview(selected_text, model.unwrap_or_default())
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
async fn get_transcription_api_keys() -> Result<Vec<credentials::ProviderKeyStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ["deepgram", "assemblyai"].iter().map(|p| credentials::provider_status(p)).collect()
    })
    .await
    .map_err(|_| "Credential worker failed.".to_string())?
}

#[tauri::command]
async fn store_transcription_api_key(provider: String, key: String) -> Result<credentials::ProviderKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || credentials::store_provider(&provider, key))
        .await
        .map_err(|_| "Credential worker failed.".to_string())?
}

#[tauri::command]
async fn remove_transcription_api_key(provider: String) -> Result<credentials::ProviderKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || credentials::remove_provider(&provider))
        .await
        .map_err(|_| "Credential worker failed.".to_string())?
}

/// Prepares one saved take and shows exactly what would be sent (M0 0.22).
/// Nothing is sent and no budget is reserved.
#[tauri::command]
async fn preview_api_transcription(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::audio::AudioPreviewOwner>>,
    attempt_id: String,
    provider: api::audio::AudioProvider,
) -> Result<api::audio::AudioPreview, String> {
    if service.is_active() {
        return Err("Finish the recording first.".into());
    }
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let saved = db.checked_recording(&attempt_id)?;
        let mut preview = owner.preview(db.root(), &saved, provider)?;
        let key = serde_json::to_value(preview.provider).map_err(|e| e.to_string())?;
        preview.previous_run_at = db.previous_api_run(&attempt_id, &preview.audio_sha256, key.as_str().unwrap_or(""), &preview.model, &preview.settings, api::audio::ADAPTER_VERSION)?;
        Ok(preview)
    })
    .await
    .map_err(|_| "Preview failed.".to_string())?
}

/// Path of an open preview's prepared audio, for listening before Send (3.15).
#[tauri::command]
fn get_api_preview_audio_path(owner: State<'_, Arc<api::audio::AudioPreviewOwner>>, request_id: String) -> Result<String, String> {
    owner.preview_audio(&request_id).map(|p| p.to_string_lossy().into_owned())
}

/// Stops waiting for an API transcription that is in flight (3.18).
#[tauri::command]
fn cancel_api_transcription(inflight: State<'_, Arc<InflightApi>>, request_id: String) {
    if let Some(stop) = inflight.0.lock().ok().and_then(|mut map| map.remove(&request_id)) {
        stop();
    }
}

#[tauri::command]
fn cancel_api_transcription_preview(owner: State<'_, Arc<api::audio::AudioPreviewOwner>>, request_id: String) {
    owner.cancel(&request_id);
}

/// Sends one previewed take after the user's explicit approval. The approval is
/// single-use and bound to the exact audio, settings, recipient and price.
#[tauri::command]
async fn request_api_transcription(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::audio::AudioPreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    request_id: String,
    payload_sha256: String,
) -> Result<api::audio::AudioResult, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    accounting.0.as_ref().map_err(Clone::clone)?;
    let inflight = inflight.inner().clone();
    let task = {
        let (accounting, request_id, payload_sha256) = (accounting.clone(), request_id.clone(), payload_sha256.clone());
        tauri::async_runtime::spawn(async move {
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            owner.send(budget, &request_id, &payload_sha256).await
        })
    };
    let abort = task.inner().abort_handle();
    if let Ok(mut map) = inflight.0.lock() {
        map.insert(request_id.clone(), Box::new(move || abort.abort()));
    }
    let outcome = task.await;
    if let Ok(mut map) = inflight.0.lock() {
        map.remove(&request_id);
    }
    let run = match outcome {
        Ok(result) => result?,
        Err(_) => {
            // Stopped by the user. Before dispatch nothing was sent; after it the
            // provider may still finish and bill, so the charge stays Uncertain.
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            return Err(api::audio::stopped(budget, &request_id));
        }
    };
    // Store it with the take as its own revision (3.16). If that fails, the paid
    // result is kept in the app's cache and the user is told; nothing is resent.
    let run = Arc::new(run);
    let stored = run.clone();
    let saved = with_storage(&storage, move |db| db.save_api_transcript(&stored.result, &stored.raw, storage::recording::now_ms()))
        .await
        .map_err(|_| "Session storage failed.".to_string())
        .and_then(|r| r);
    if let Err(error) = saved {
        let kept = api::audio::keep_unsaved(&accounting.1, &run).map(|d| d.display().to_string()).unwrap_or_else(|e| e);
        return Err(format!("The transcript arrived but could not be saved with the take ({error}). It was kept at {kept}; nothing will be sent again."));
    }
    Ok(run.summary.clone())
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
    transcription: State<'_, Arc<Transcription>>,
    mic: State<'_, Arc<mic_test::MicTest>>,
    monitor: State<'_, Arc<audio::monitor::LevelMonitor>>,
    context: Option<storage::database::PracticeContext>,
    request: StartRequest,
) -> Result<RecordingStatus, String> {
    if mic.capture.is_active() {
        return Err("Wait for the microphone test to finish (5 seconds).".into());
    }
    // Recording takes priority: a running transcription is cancelled and can be retried.
    transcription.active.cancel();
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The Ready-state level meter lets go of the microphone before the take opens it.
        monitor.stop();
        storage.with(|owner| {
            owner.reserve(
                &request.attempt_id,
                &request.idempotency_key,
                &request.title,
                context.as_ref(),
            )?;
            let status = service.start(request)?;
            if let Some(saved) = status.asset.as_ref().filter(|_| status.phase == "saved") {
                owner.commit_recording(saved)?;
            }
            Ok(status)
        })
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
        let saved = storage.with(|owner| {
            let saved = service.stop(&attempt_id)?;
            owner.commit_recording(&saved)?;
            Ok(saved)
        })?;
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
        storage.with(|owner| {
            let hidden = owner.hidden_asset_ids()?;
            Ok(storage::recording::list_saved(&service.root)?
                .into_iter()
                .filter(|r| !hidden.contains(&r.asset_id))
                .collect())
        })
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn list_recoverable_recordings(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Vec<RecoverableRecording>, String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Takes in Trash or awaiting permanent removal are never offered for recovery.
        storage.with(|owner| {
            let hidden = owner.hidden_asset_ids()?;
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
        let saved = storage.with(|owner| {
            if owner.hidden_asset_ids()?.contains(&attempt_id) {
                return Err(
                    "This take belongs to a session in Trash. Restore the session first.".into(),
                );
            }
            let saved = service.recover(&attempt_id)?;
            owner.commit_recording(&saved)?;
            Ok(saved)
        })?;
        let _ = app.emit("recording_saved", RecordingStatus::saved(saved.clone()));
        Ok(saved)
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

#[tauri::command]
async fn discard_recoverable_recording(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
) -> Result<(), String> {
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.with(|_| {
            let active = service.status()?.filter(|s| matches!(s.phase.as_str(), "preparing" | "recording" | "finalizing"));
            if active.is_some_and(|a| a.attempt_id == attempt_id) {
                return Err("This take is still recording.".into());
            }
            storage::recording::discard_recoverable(&service.root, &attempt_id)
        })
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
        storage.with(|owner| {
            owner
                .playback_path(&asset_id)
                .map(|path| path.to_string_lossy().into_owned())
        })
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
        storage.with(|owner| owner.waveform(&asset_id))
    })
    .await
    .map_err(|_| "Recording storage failed.".to_string())?
}

pub(crate) fn with_storage<T: Send + 'static>(
    storage: &State<'_, Arc<SessionStorage>>,
    work: impl FnOnce(&storage::database::DatabaseOwner) -> Result<T, String> + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.with(work))
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

/// Your prompts and favourite marks (4.13); bundled prompts come from the content pack.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptState {
    user_prompts: Vec<storage::database::prompts::UserPrompt>,
    favorites: Vec<storage::database::prompts::Favorite>,
}

#[tauri::command]
async fn get_prompt_state(storage: State<'_, Arc<SessionStorage>>) -> Result<PromptState, String> {
    with_storage(&storage, |db| Ok(PromptState { user_prompts: db.list_user_prompts()?, favorites: db.prompt_favorites()? }))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn add_user_prompt(storage: State<'_, Arc<SessionStorage>>, prompt: storage::database::prompts::PromptInput) -> Result<storage::database::prompts::UserPrompt, String> {
    with_storage(&storage, move |db| db.add_user_prompt(&prompt)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn update_user_prompt(storage: State<'_, Arc<SessionStorage>>, prompt_id: String, prompt: storage::database::prompts::PromptInput) -> Result<storage::database::prompts::UserPrompt, String> {
    with_storage(&storage, move |db| db.update_user_prompt(&prompt_id, &prompt)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_user_prompt(storage: State<'_, Arc<SessionStorage>>, prompt_id: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.delete_user_prompt(&prompt_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_prompt_favorite(storage: State<'_, Arc<SessionStorage>>, prompt_id: String, favorite: bool) -> Result<(), String> {
    with_storage(&storage, move |db| db.set_prompt_favorite(&prompt_id, favorite)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn list_transfer_reviews(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage::database::transfer::TransferReview>, String> {
    with_storage(&storage, |db| db.list_transfer_reviews()).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn add_transfer_review(storage: State<'_, Arc<SessionStorage>>, review: storage::database::transfer::TransferInput) -> Result<storage::database::transfer::TransferReview, String> {
    with_storage(&storage, move |db| db.add_transfer_review(&review)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_transfer_review(storage: State<'_, Arc<SessionStorage>>, review_id: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.delete_transfer_review(&review_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn list_progression_events(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage::database::progression::ProgressionEvent>, String> {
    with_storage(&storage, |db| db.list_progression_events()).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn record_progression(storage: State<'_, Arc<SessionStorage>>, kind: String, reason: String) -> Result<storage::database::progression::ProgressionEvent, String> {
    with_storage(&storage, move |db| db.record_progression(&kind, &reason)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_preferred_take(storage: State<'_, Arc<SessionStorage>>, session_id: String, preferred: Option<String>) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.set_preferred_take(&session_id, preferred.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_session_focus(storage: State<'_, Arc<SessionStorage>>, session_id: String, focus: Option<String>) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.set_session_focus(&session_id, focus.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_session_reflection(
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
    ease: Option<u8>,
    takeaway: Option<String>,
) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.set_session_reflection(&session_id, ease, takeaway.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Reference clips (4.4a): pick a local audio file, preview the decoded copy,
/// keep a 3–30 s section with a title and source, list, play and delete.
#[tauri::command]
async fn choose_clip_file(app: tauri::AppHandle, storage: State<'_, Arc<SessionStorage>>) -> Result<Option<clips::Staged>, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose an audio file to take a clip from")
            .add_filter("Audio", &["wav", "mp3", "m4a", "aac", "mp4", "flac", "ogg", "oga"])
            .blocking_pick_file();
        match picked.and_then(|p| p.into_path().ok()) {
            Some(path) => clips::stage(owner.root(), &path).map(Some),
            None => Ok(None),
        }
    })
    .await
    .map_err(|_| "The clip could not be prepared.".to_string())?
}

#[tauri::command]
async fn get_clip_staging_path(storage: State<'_, Arc<SessionStorage>>, staging_id: String) -> Result<String, String> {
    with_storage(&storage, move |owner| {
        let path = clips::staging_dir(owner.root(), &staging_id)?.join("full.wav");
        crate::audio::prepare::contained(owner.root(), &path)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn discard_clip_staging(storage: State<'_, Arc<SessionStorage>>, staging_id: String) -> Result<(), String> {
    with_storage(&storage, move |owner| {
        clips::discard_staging(owner.root(), &staging_id);
        Ok(())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_clip(
    storage: State<'_, Arc<SessionStorage>>,
    staging_id: String,
    start_ms: u64,
    end_ms: u64,
    title: String,
    source: String,
    transcript: Option<String>,
    folder_id: Option<String>,
) -> Result<clips::Clip, String> {
    with_storage(&storage, move |owner| {
        let details = clips::ClipDetails { title: &title, source: &source, transcript: transcript.as_deref(), description: None, feature: None };
        let from = clips::read_meta(owner.root(), &staging_id).ok().and_then(|m| m.source_id);
        let mut clip = clips::commit(owner.root(), &staging_id, start_ms, end_ms, &details, "user", false)?;
        clip.folder_id = folder_id;
        if from.is_some() {
            (clip.source_id, clip.source_start_ms, clip.source_end_ms) = (from, Some(start_ms), Some(end_ms));
        }
        if let Err(error) = owner.insert_clip(&clip) {
            let _ = clips::remove_files(owner.root(), &clip.id);
            return Err(error);
        }
        measure_clips_later(owner.root().to_path_buf(), std::slice::from_ref(&clip));
        Ok(clip)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

/// Stop flags for the long-running clip work (split transcription, link download).
#[derive(Default)]
struct ClipWork {
    split: std::sync::Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>,
    fetch: std::sync::Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>,
}

/// Transcribes a staged long recording locally and proposes clips (4.4c).
#[tauri::command]
async fn split_clip_source(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    transcription: State<'_, Arc<Transcription>>,
    work: State<'_, Arc<ClipWork>>,
    staging_id: String,
) -> Result<Vec<clipsplit::Candidate>, String> {
    if transcription.active.is_active() {
        return Err("A take is being transcribed. Try again when it finishes.".into());
    }
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut slot) = work.split.lock() {
        *slot = Some(cancel.clone());
    }
    // Only reading the setup needs storage; transcribing runs without holding it,
    // so the rest of the app stays responsive for the minutes this can take.
    let (config, root) = with_storage(&storage, |owner| Ok((transcribe::load_config(owner)?, owner.root().to_path_buf())))
        .await
        .map_err(|_| "Session storage failed.".to_string())??;
    let (work_root, work_id) = (root.clone(), staging_id.clone());
    let result = tauri::async_runtime::spawn_blocking(move || {
        let segments = clipsplit::transcribe_local(&config, &work_root, &work_id, &cancel, |percent| {
            let _ = app.emit("clip_split_progress", percent);
        })?;
        clipsplit::save_segments(&work_root, &work_id, &segments)?;
        Ok::<_, String>(segments)
    })
    .await
    .map_err(|_| "Splitting failed.".to_string())?
    .and_then(|segments| {
        // Kept in the import history (4.4i); failing to keep it never loses the split.
        let _ = storage.with(|db| sources::remember(db, &root, &staging_id, &segments, "local"));
        let candidates = clipsplit::propose(&segments);
        if candidates.is_empty() {
            return Err("No clips of 8–20 seconds with whole sentences were found. You can still keep a section by hand.".into());
        }
        Ok(candidates)
    });
    if let Ok(mut slot) = work.split.lock() {
        *slot = None;
    }
    result
}

#[tauri::command]
fn cancel_clip_work(work: State<'_, Arc<ClipWork>>) {
    for slot in [&work.split, &work.fetch] {
        if let Some(flag) = slot.lock().ok().and_then(|s| s.clone()) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// AI phrase suggestions from chosen sessions (user request 2026-10-10): previews
/// a text-only request with each session's title and its takes' newest transcripts
/// (your corrections where you made them). Nothing is sent here.
#[tauri::command]
async fn preview_phrase_suggestions(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    session_ids: Vec<String>,
    model: Option<api::coaching::CoachingModel>,
) -> Result<api::coaching::Preview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        // Never a silent switch of provider (shared rule 1): these go to your OpenAI account only.
        match preferences::load(db)?.coaching_mode.as_str() {
            "api" => {}
            "off" => return Err("AI suggestions are turned off in Settings → Coaching.".into()),
            _ => return Err("Phrase suggestions use your OpenAI account, and Coaching is set to your local model, so nothing was sent. Choose in Settings → Coaching.".into()),
        }
        if session_ids.is_empty() || session_ids.len() > 12 {
            return Err("Choose between 1 and 12 transcribed sessions.".into());
        }
        let mut sessions = Vec::new();
        for id in &session_ids {
            let detail = db.get_session(id)?;
            let texts: Vec<String> = detail["attempts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| a["id"].as_str())
                .filter_map(|attempt| db.take_coaching_input(attempt).ok().map(|input| input.text))
                .collect();
            if !texts.is_empty() {
                sessions.push((detail["title"].as_str().unwrap_or("Session").to_string(), texts.join("\n")));
            }
        }
        if sessions.is_empty() {
            return Err("None of these sessions has a transcript yet. Transcribe them first.".into());
        }
        owner.preview_phrase_suggestions(&sessions, model.unwrap_or_default())
    })
    .await
    .map_err(|_| "Preparing the request failed.".to_string())?
}

/// Sends an approved phrase-suggestion preview under the shared budget.
#[tauri::command]
async fn request_phrase_suggestions(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    request_id: String,
    payload_sha256: String,
) -> Result<Vec<api::coaching::PhraseSuggestion>, String> {
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    let budget = accounting.0.as_ref().map_err(Clone::clone)?;
    owner.send_phrase_suggestions(budget, &accounting.1, &request_id, &payload_sha256).await
}

/// An optional AI comparison of a drill's rounds (roadmap 10.5, 10.9): previews
/// a text-only request with the latest take of each round, under its listener
/// or length (your corrections where you made them). Nothing is sent here.
#[tauri::command]
async fn preview_drill_comparison(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    session_id: String,
    kind: api::coaching::DrillComparisonKind,
    model: Option<api::coaching::CoachingModel>,
) -> Result<api::coaching::Preview, String> {
    use api::coaching::DrillComparisonKind;
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        // Never a silent switch of provider (shared rule 1): this goes to your OpenAI account only.
        match preferences::load(db)?.coaching_mode.as_str() {
            "api" => {}
            "off" => return Err("AI suggestions are turned off in Settings → Coaching.".into()),
            _ => return Err("This comparison uses your OpenAI account, and Coaching is set to your local model, so nothing was sent. Choose in Settings → Coaching.".into()),
        }
        let rounds: &[(&str, &str)] = match kind {
            DrillComparisonKind::ThreeWays => &[("child", "A 10-year-old"), ("colleague", "A colleague from another team"), ("expert", "An expert")],
            DrillComparisonKind::Pitch => &[("r60", "60 seconds"), ("r30", "30 seconds"), ("r15", "15 seconds")],
        };
        let detail = db.get_session(&session_id)?;
        let attempts = detail["attempts"].as_array().cloned().unwrap_or_default();
        let mut parts = Vec::new();
        for (key, label) in rounds {
            let latest = attempts.iter().rev().find(|a| a["step"]["key"].as_str() == Some(key)).and_then(|a| a["id"].as_str());
            let text = latest
                .and_then(|id| db.take_coaching_input(id).ok())
                .map(|input| input.text)
                .ok_or("Transcribe every round first; the comparison needs all of them.")?;
            parts.push((label.to_string(), text));
        }
        owner.preview_drill_comparison(kind, &parts, model.unwrap_or_default())
    })
    .await
    .map_err(|_| "Preparing the request failed.".to_string())?
}

/// Sends an approved drill comparison under the shared budget.
#[tauri::command]
async fn request_drill_comparison(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    request_id: String,
    payload_sha256: String,
) -> Result<api::coaching::DrillComparison, String> {
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    let budget = accounting.0.as_ref().map_err(Clone::clone)?;
    owner.send_drill_comparison(budget, &accounting.1, &request_id, &payload_sha256).await
}

/// Optional AI titles and descriptions for proposed clips (4.4c): previews a
/// text-only request (transcripts only). Nothing is sent here.
#[tauri::command]
fn preview_clip_names(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    texts: Vec<String>,
    model: Option<api::coaching::CoachingModel>,
) -> Result<api::coaching::Preview, String> {
    owner.preview_clip_names(&texts, model.unwrap_or_default())
}

#[tauri::command]
async fn request_clip_names(
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    request_id: String,
    payload_sha256: String,
) -> Result<Vec<api::coaching::ClipName>, String> {
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    let budget = accounting.0.as_ref().map_err(Clone::clone)?;
    owner.send_clip_names(budget, &accounting.1, &request_id, &payload_sha256).await
}

/// Measures every sentence of a staged recording's transcript (4.4e, 4.4g) in
/// the background, with progress events and Stop. Kept with the transcript, so
/// the AI preview afterwards is instant. Returns the number of sentences.
#[tauri::command]
async fn measure_clip_source(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    work: State<'_, Arc<ClipWork>>,
    staging_id: String,
) -> Result<usize, String> {
    let root = storage.with(|owner| Ok(owner.root().to_path_buf()))?;
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut slot) = work.split.lock() {
        *slot = Some(cancel.clone());
    }
    let flag = cancel.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let sentences = clipsplit::measure_staged(&root, &staging_id, &flag, |stage| {
            let (name, percent) = match stage {
                clipsplit::MeasureStage::PreparingAudio => ("preparing", None),
                clipsplit::MeasureStage::Measuring(p) => ("measuring", Some(p)),
            };
            let _ = app.emit("clip_measure_progress", serde_json::json!({ "stage": name, "percent": percent }));
        })?;
        sources::keep_measures(&root, &staging_id);
        Ok::<_, String>(sentences.len())
    })
    .await
    .map_err(|_| "Measuring failed.".to_string())?;
    if let Ok(mut slot) = work.split.lock() {
        if slot.as_ref().is_some_and(|f| Arc::ptr_eq(f, &cancel)) {
            *slot = None;
        }
    }
    result
}

/// AI chooses the best passages (4.4e): measures each sentence locally (kept
/// from `measure_clip_source` when it ran) and previews the annotated
/// transcript (text only). Nothing is sent here.
#[tauri::command]
async fn preview_clip_picks(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    staging_id: String,
    model: Option<api::coaching::CoachingModel>,
    tone_hint: bool,
    wanted: usize,
) -> Result<api::coaching::Preview, String> {
    let owner = owner.inner().clone();
    let root = storage.with(|db| Ok(db.root().to_path_buf()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (sentences, annotated) = clipsplit::annotate_staged(&root, &staging_id)?;
        owner.preview_clip_picks(&annotated, sentences.len(), wanted, model.unwrap_or_default(), tone_hint)
    })
    .await
    .map_err(|_| "Preview failed.".to_string())?
}

#[tauri::command]
async fn request_clip_picks(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    staging_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<Vec<clipsplit::PickedClip>, String> {
    let segments = {
        let staging_id = staging_id.clone();
        with_storage(&storage, move |db| clipsplit::load_segments(db.root(), &staging_id)).await.map_err(|_| "Session storage failed.".to_string())??
    };
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    let budget = accounting.0.as_ref().map_err(Clone::clone)?;
    let (model, tone_hint, picks) = owner.send_clip_picks(budget, &accounting.1, &request_id, &payload_sha256, segments.len()).await?;
    let chosen = clipsplit::picks_to_clips(&segments, &picks);
    if chosen.is_empty() {
        return Err("The AI's passages did not fit the clip rules (5–30 s, whole sentences, no overlaps). The automatic proposals are unchanged.".into());
    }
    // Kept with the source so later choices can be compared (4.4i).
    let kept = chosen.clone();
    let _ = with_storage(&storage, move |db| {
        if let Some(source) = clips::read_meta(db.root(), &staging_id)?.source_id {
            db.insert_pick_run(&source, &model, tone_hint, &kept)?;
        }
        Ok(())
    })
    .await;
    Ok(chosen)
}

/// Cloud transcription for a split (4.4c): the same preview → explicit Send
/// flow as takes, for the staged recording's 16 kHz copy. Nothing sends here.
#[tauri::command]
async fn preview_split_transcription(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::audio::AudioPreviewOwner>>,
    staging_id: String,
    provider: api::audio::AudioProvider,
) -> Result<api::audio::AudioPreview, String> {
    let owner = owner.inner().clone();
    // Preparing the audio takes a while for long recordings; it runs without
    // holding storage, and the 16 kHz copy is reused once made.
    let root = storage.with(|db| Ok(db.root().to_path_buf()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (path, duration_ms) = clipsplit::resample_staged(&root, &staging_id, &std::sync::atomic::AtomicBool::new(false))?;
        let bytes = std::fs::metadata(&path).map_err(|_| "The prepared audio is unavailable.")?.len();
        let sha = storage::recording::hash_file(&path)?;
        let source = storage::recording::hash_file(&clips::staging_dir(&root, &staging_id)?.join("full.wav"))?;
        owner.preview_prepared(path, &staging_id, duration_ms, bytes, sha, source, provider)
    })
    .await
    .map_err(|_| "Preview failed.".to_string())?
}

/// Sends an approved split preview and proposes clips from the word timings.
/// The paid result is not stored as a transcript (the recording is not a take);
/// its raw answer is kept under cache/api-transcription.
#[tauri::command]
async fn request_split_transcription(
    storage: State<'_, Arc<SessionStorage>>,
    service: State<'_, Arc<CaptureService>>,
    owner: State<'_, Arc<api::audio::AudioPreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    request_id: String,
    payload_sha256: String,
) -> Result<Vec<clipsplit::Candidate>, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let accounting = accounting.inner().clone();
    accounting.0.as_ref().map_err(Clone::clone)?;
    let inflight = inflight.inner().clone();
    let started = std::time::Instant::now();
    let task = {
        let (accounting, request_id, payload_sha256) = (accounting.clone(), request_id.clone(), payload_sha256.clone());
        tauri::async_runtime::spawn(async move {
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            owner.send(budget, &request_id, &payload_sha256).await
        })
    };
    let abort = task.inner().abort_handle();
    if let Ok(mut map) = inflight.0.lock() {
        map.insert(request_id.clone(), Box::new(move || abort.abort()));
    }
    let outcome = task.await;
    if let Ok(mut map) = inflight.0.lock() {
        map.remove(&request_id);
    }
    let run = match outcome {
        Ok(result) => result?,
        Err(_) => return Err(api::audio::stopped(accounting.0.as_ref().map_err(Clone::clone)?, &request_id)),
    };
    // The recording is not a take, so the paid result is kept beside the app's
    // other provider results (raw answer, validated result, time from Send to
    // result) for review and the provider benchmark (0.23). Never logged.
    if let Ok(dir) = api::audio::keep_unsaved(&accounting.1, &run) {
        let timing = serde_json::json!({"elapsedMs": started.elapsed().as_millis() as u64,
            "measured": "From Send to the validated result: upload, processing and polling, on this computer's clock"});
        let _ = std::fs::write(dir.join("timing.json"), timing.to_string());
    }
    let words = run.result.words.value.ok_or("The provider returned no word timings, so no clips can be cut. Try transcribing on this computer.")?;
    let segments = clipsplit::segments_from_words(&words);
    let staging_id = run.result.asset_id.clone();
    let root = accounting.1.clone();
    let _ = clipsplit::save_segments(&root, &staging_id, &segments);
    let provider = match run.result.provider {
        audio::transcription::TranscriptionProvider::Assemblyai => "assemblyai",
        _ => "deepgram",
    };
    let _ = storage.with(|db| sources::remember(db, &root, &staging_id, &segments, provider));
    let candidates = clipsplit::propose(&segments);
    if candidates.is_empty() {
        return Err("No clips of 8–20 seconds with whole sentences were found.".into());
    }
    Ok(candidates)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SectionToSave {
    start_ms: u64,
    end_ms: u64,
    title: String,
    source: String,
    transcript: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    feature: Option<String>,
}

/// Saves several sections of one staged file as clips, then drops the staging copy.
#[tauri::command]
async fn save_clip_sections(storage: State<'_, Arc<SessionStorage>>, staging_id: String, sections: Vec<SectionToSave>, folder_id: Option<String>) -> Result<Vec<clips::Clip>, String> {
    if sections.is_empty() || sections.len() > clipsplit::MAX_CANDIDATES {
        return Err("Choose between 1 and 40 clips to keep.".into());
    }
    with_storage(&storage, move |owner| {
        let from = clips::read_meta(owner.root(), &staging_id).ok().and_then(|m| m.source_id);
        let audio = clips::load_staged(owner.root(), &staging_id)?;
        let mut saved = Vec::new();
        for section in &sections {
            let details = clips::ClipDetails {
                title: &section.title,
                source: &section.source,
                transcript: section.transcript.as_deref(),
                description: section.description.as_deref(),
                feature: section.feature.as_deref(),
            };
            let mut clip = clips::commit_from(owner.root(), &audio, section.start_ms, section.end_ms, &details, "user")?;
            clip.folder_id = folder_id.clone();
            if from.is_some() {
                (clip.source_id, clip.source_start_ms, clip.source_end_ms) = (from.clone(), Some(section.start_ms), Some(section.end_ms));
            }
            if let Err(error) = owner.insert_clip(&clip) {
                let _ = clips::remove_files(owner.root(), &clip.id);
                return Err(error);
            }
            saved.push(clip);
        }
        clips::discard_staging(owner.root(), &staging_id);
        measure_clips_later(owner.root().to_path_buf(), &saved);
        Ok(saved)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkToolStatus {
    available: bool,
    path: Option<String>,
}

fn link_tool(owner: &storage::database::DatabaseOwner) -> Result<LinkToolStatus, String> {
    let path = linkaudio::find_ytdlp(owner.setting(linkaudio::SETTING_KEY)?.as_deref());
    Ok(LinkToolStatus { available: path.is_some(), path: path.map(|p| p.to_string_lossy().into_owned()) })
}

#[tauri::command]
async fn get_link_tool_status(storage: State<'_, Arc<SessionStorage>>) -> Result<LinkToolStatus, String> {
    with_storage(&storage, link_tool).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Lets the user point the app at their yt-dlp executable.
#[tauri::command]
async fn choose_link_tool(app: tauri::AppHandle, storage: State<'_, Arc<SessionStorage>>) -> Result<LinkToolStatus, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app.dialog().file().set_title("Choose yt-dlp").add_filter("yt-dlp", &["exe"]).blocking_pick_file();
        if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
            let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if !name.starts_with("yt-dlp") {
                return Err("Choose the yt-dlp program (yt-dlp.exe).".into());
            }
            owner.set_setting(linkaudio::SETTING_KEY, &path.to_string_lossy())?;
        }
        link_tool(owner)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

/// Downloads the official yt-dlp.exe into the app's tools folder after an explicit
/// click, with progress, and verifies it against the release checksum (4.4f).
#[tauri::command]
async fn download_link_tool(app: tauri::AppHandle, storage: State<'_, Arc<SessionStorage>>, work: State<'_, Arc<ClipWork>>) -> Result<LinkToolStatus, String> {
    let root = {
        let storage = storage.inner().clone();
        storage.with(|owner| Ok(owner.root().to_path_buf()))?
    };
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = Some(cancel.clone());
    }
    let events = app.clone();
    let result = linkaudio::download_tool(&root, &cancel, move |received, total| {
        let _ = events.emit("link_tool_download", serde_json::json!({ "received": received, "total": total }));
    })
    .await;
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = None;
    }
    let path = result?;
    with_storage(&storage, move |owner| {
        owner.set_setting(linkaudio::SETTING_KEY, &path.to_string_lossy())?;
        link_tool(owner)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

/// Downloads the audio of a YouTube link with the user's yt-dlp and stages it (4.4d).
#[tauri::command]
async fn fetch_link_audio(storage: State<'_, Arc<SessionStorage>>, work: State<'_, Arc<ClipWork>>, url: String) -> Result<linkaudio::LinkAudio, String> {
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = Some(cancel.clone());
    }
    // Only finding the tool needs storage; the download runs without holding it.
    let found = storage.with(|owner| Ok((linkaudio::find_ytdlp(owner.setting(linkaudio::SETTING_KEY)?.as_deref()), owner.root().to_path_buf())));
    let result = match found {
        Ok((Some(tool), root)) => tauri::async_runtime::spawn_blocking(move || linkaudio::fetch(&root, &tool, &url, &cancel))
            .await
            .map_err(|_| "The download failed.".to_string())?,
        Ok((None, _)) => Err("yt-dlp was not found. Install it (winget install yt-dlp.yt-dlp) or choose yt-dlp.exe.".to_string()),
        Err(error) => Err(error),
    };
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = None;
    }
    result
}

// ── Phrases (4.15) ───────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PhraseInput {
    original: String,
    expression: String,
    #[serde(default)]
    explanation: String,
    #[serde(default)]
    examples: Vec<String>,
}

#[tauri::command]
async fn list_phrases(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage::database::phrases::PhraseCard>, String> {
    with_storage(&storage, |db| db.list_phrases()).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn review_phrase(storage: State<'_, Arc<SessionStorage>>, phrase_id: String, rating: String) -> Result<storage::database::phrases::PhraseCard, String> {
    with_storage(&storage, move |db| db.review_phrase(&phrase_id, &rating, storage::database::phrases::today()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn add_phrase(storage: State<'_, Arc<SessionStorage>>, phrase: PhraseInput, source_session_id: Option<String>) -> Result<storage::database::phrases::PhraseCard, String> {
    with_storage(&storage, move |db| {
        let text = storage::database::phrases::PhraseText { original: &phrase.original, expression: &phrase.expression, explanation: &phrase.explanation, examples: &phrase.examples };
        db.add_phrase(&text, source_session_id.as_deref(), storage::database::phrases::today())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn update_phrase(storage: State<'_, Arc<SessionStorage>>, phrase_id: String, phrase: PhraseInput) -> Result<storage::database::phrases::PhraseCard, String> {
    with_storage(&storage, move |db| {
        let text = storage::database::phrases::PhraseText { original: &phrase.original, expression: &phrase.expression, explanation: &phrase.explanation, examples: &phrase.examples };
        db.update_phrase(&phrase_id, &text)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_phrase(storage: State<'_, Arc<SessionStorage>>, phrase_id: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.delete_phrase(&phrase_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

// ── Clip library folders (4.4h) and import history (4.4i) ───────────────────

#[tauri::command]
async fn list_clip_folders(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage::database::library::Folder>, String> {
    with_storage(&storage, |db| db.list_clip_folders()).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn create_clip_folder(storage: State<'_, Arc<SessionStorage>>, name: String) -> Result<storage::database::library::Folder, String> {
    with_storage(&storage, move |db| db.create_clip_folder(&name)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn rename_clip_folder(storage: State<'_, Arc<SessionStorage>>, folder_id: String, name: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.rename_clip_folder(&folder_id, &name)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_clip_folder(storage: State<'_, Arc<SessionStorage>>, folder_id: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.delete_clip_folder(&folder_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn move_clips(storage: State<'_, Arc<SessionStorage>>, clip_ids: Vec<String>, folder_id: Option<String>) -> Result<(), String> {
    with_storage(&storage, move |db| db.move_clips(&clip_ids, folder_id.as_deref())).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn update_clip(storage: State<'_, Arc<SessionStorage>>, clip_id: String, title: String, description: Option<String>, feature: Option<String>) -> Result<(), String> {
    with_storage(&storage, move |db| db.update_clip(&clip_id, &title, description.as_deref(), feature.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn list_clip_sources(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage::database::library::Source>, String> {
    with_storage(&storage, |db| db.list_sources()).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Reopens a recording from the import history with its transcript (4.4i).
#[tauri::command]
async fn open_clip_source(storage: State<'_, Arc<SessionStorage>>, source_id: String) -> Result<sources::Opened, String> {
    with_storage(&storage, move |db| sources::open(db, db.root(), &source_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn update_clip_source(storage: State<'_, Arc<SessionStorage>>, source_id: String, title: String, credit: String) -> Result<(), String> {
    with_storage(&storage, move |db| db.update_source_details(&source_id, &title, &credit)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_clip_source(storage: State<'_, Arc<SessionStorage>>, source_id: String) -> Result<(), String> {
    with_storage(&storage, move |db| sources::delete(db, db.root(), &source_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Measures the pitch lines of newly saved clips in the background (P.6).
fn measure_clips_later(root: std::path::PathBuf, saved: &[clips::Clip]) {
    let todo: Vec<(String, String)> = saved.iter().map(|c| (c.id.clone(), c.sha256.clone())).collect();
    std::thread::spawn(move || {
        for (id, sha) in todo {
            let _ = clips::clip_contour(&root, &id, &sha);
        }
    });
}

/// A reference clip's pitch and loudness contour (P.6), for the imitation overlay (P.5).
#[tauri::command]
async fn get_clip_prosody(storage: State<'_, Arc<SessionStorage>>, clip_id: String) -> Result<prosody::Contour, String> {
    let (root, clip) = with_storage(&storage, move |db| {
        let clip = db.list_clips()?.into_iter().find(|c| c.id == clip_id).ok_or("This clip is no longer available.")?;
        Ok((db.root().to_path_buf(), clip))
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())??;
    tauri::async_runtime::spawn_blocking(move || clips::clip_contour(&root, &clip.id, &clip.sha256))
        .await
        .map_err(|_| "Intonation analysis failed.".to_string())?
}

#[tauri::command]
async fn list_clips(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<clips::Clip>, String> {
    with_storage(&storage, |owner| owner.list_clips()).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn get_clip_playback_path(storage: State<'_, Arc<SessionStorage>>, clip_id: String) -> Result<String, String> {
    with_storage(&storage, move |owner| owner.clip_playback_path(&clip_id).map(|p| p.to_string_lossy().into_owned()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_clip(storage: State<'_, Arc<SessionStorage>>, clip_id: String) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.delete_clip(&clip_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Single takes in Trash (2.23).
#[tauri::command]
async fn move_take_to_trash(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.move_take_to_trash(&attempt_id, storage::recording::now_ms()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn restore_take(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<(), String> {
    with_storage(&storage, move |owner| owner.restore_take(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn delete_takes_permanently(storage: State<'_, Arc<SessionStorage>>, attempt_ids: Vec<String>) -> Result<PurgeOutcome, String> {
    with_storage(&storage, move |owner| owner.delete_takes_permanently(&attempt_ids).map(|files_pending| PurgeOutcome { files_pending }))
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
    auto_enabled: bool,
    keep: u32,
    /// Milliseconds since the epoch; 0 means "as soon as possible".
    next_due_at_ms: Option<u64>,
}

fn backup_status(owner: &storage::database::DatabaseOwner) -> Result<BackupStatus, String> {
    let destination = owner.setting(backup::DESTINATION_KEY)?;
    Ok(BackupStatus {
        destination_available: destination
            .as_deref()
            .is_some_and(|d| std::path::Path::new(d).is_dir()),
        destination,
        backups: owner.backups()?,
        auto_enabled: backup::auto_enabled(owner)?,
        keep: backup::keep_count(owner)?,
        next_due_at_ms: backup::next_due_ms(owner)?,
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

#[tauri::command]
async fn set_auto_backup(
    storage: State<'_, Arc<SessionStorage>>,
    enabled: bool,
    keep: u32,
) -> Result<BackupStatus, String> {
    with_storage(&storage, move |owner| {
        if !backup::KEEP_CHOICES.contains(&keep) {
            return Err("Choose to keep 2, 4, 8 or 12 backups.".into());
        }
        owner.set_setting(backup::AUTO_KEY, if enabled { "on" } else { "off" })?;
        owner.set_setting(backup::KEEP_KEY, &keep.to_string())?;
        backup_status(owner)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

/// Checks for a due weekly backup shortly after launch (the catch-up) and then
/// every half hour while the app is open. Never runs during a recording.
fn spawn_auto_backup(app: tauri::AppHandle, storage: Arc<SessionStorage>, capture: Arc<CaptureService>) {
    let _ = std::thread::Builder::new()
        .name("clearpractice-auto-backup".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(90));
            loop {
                if !capture.is_active() {
                    match storage.with(|owner| backup::run_if_due(owner, storage::recording::now_ms())) {
                        Ok(Some(summary)) => {
                            let _ = app.emit("backup_completed", &summary);
                        }
                        Ok(None) => {}
                        // Failures are recorded in backup_records and shown in Settings.
                        Err(_) => {
                            let _ = app.emit("backup_failed", ());
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(30 * 60));
            }
        });
}

/// Exports one session as a readable ZIP to a location chosen in the native
/// Save dialog. `None` means the dialog was cancelled.
#[tauri::command]
async fn export_session(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    session_id: String,
) -> Result<Option<backup::export::ExportSummary>, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let session = owner.get_session(&session_id)?;
        let name = backup::export::suggested_name(
            session["title"].as_str().unwrap_or(""),
            session["localDate"].as_str().unwrap_or(""),
        );
        let picked = app
            .dialog()
            .file()
            .set_title("Export session")
            .set_file_name(name)
            .add_filter("ZIP archive", &["zip"])
            .blocking_save_file();
        let Some(target) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        backup::export::export_session(owner, &session_id, &target, storage::recording::now_ms()).map(Some)
    })
    .await
    .map_err(|_| "Export failed.".to_string())?
}

#[tauri::command]
async fn get_transcription_setup(
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<transcribe::SetupStatus, String> {
    with_storage(&storage, transcribe::status)
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn get_preferences(storage: State<'_, Arc<SessionStorage>>) -> Result<preferences::Preferences, String> {
    with_storage(&storage, preferences::load).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_preferences(storage: State<'_, Arc<SessionStorage>>, preferences: preferences::Preferences) -> Result<preferences::Preferences, String> {
    with_storage(&storage, move |db| preferences::save(db, preferences)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn get_transcription_preference(storage: State<'_, Arc<SessionStorage>>) -> Result<transcribe::Preference, String> {
    with_storage(&storage, transcribe::preference).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Stores the default transcription mode. Choosing cloud mode sends nothing.
#[tauri::command]
async fn set_transcription_preference(
    storage: State<'_, Arc<SessionStorage>>,
    preference: transcribe::Preference,
) -> Result<transcribe::Preference, String> {
    with_storage(&storage, move |db| transcribe::set_preference(db, preference))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Picks a worker setup file natively, verifies the runtime and model, then stores it.
#[tauri::command]
async fn choose_transcription_setup(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<transcribe::SetupStatus, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a verified Whisper setup file")
            .add_filter("Whisper setup", &["json"])
            .blocking_pick_file();
        match picked.and_then(|p| p.into_path().ok()) {
            Some(path) => transcribe::import_config(owner, &path),
            None => transcribe::status(owner),
        }
    })
    .await
    .map_err(|_| "Transcription setup failed.".to_string())?
}

/// A take's coaching preview plus what the screen needs to explain it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TakeCoachingPreview {
    preview: api::coaching::Preview,
    /// When this exact request was already answered for the take (5.7).
    answered_at: Option<String>,
    timed_parts: usize,
    corrected: bool,
    /// The transcript revision the text was built from; a newer one makes this preview stale (A-17).
    revision_id: String,
}

/// Prepares AI feedback on a saved take (M5, P.9). Builds the text from the
/// take's transcript, task, focus and local measures; nothing is sent.
#[tauri::command]
async fn preview_take_coaching(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    attempt_id: String,
    model: Option<api::coaching::CoachingModel>,
    delivery_impressions: bool,
    hide: Vec<String>,
) -> Result<TakeCoachingPreview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let prefs = preferences::load(db)?;
        let local = (prefs.coaching_mode == "local")
            .then(|| api::local_llm::validate_endpoint(&prefs.local_endpoint).map(|base| api::local_llm::LocalTarget { base, model: prefs.local_model.clone() }))
            .transpose()?;
        let input = db.take_coaching_input(&attempt_id)?;
        let parts = if input.timed_parts.is_empty() {
            Vec::new()
        } else {
            // Pitch and loudness need the take's contour; without it pace and pauses still count.
            match db.prosody(&attempt_id) {
                Ok(c) => clipsplit::measure_sentences(&input.timed_parts, &c.f0_hz, &c.rms_db, c.hop_ms),
                Err(_) => clipsplit::measure_sentences(&input.timed_parts, &[], &[], 10),
            }
        };
        let text = take_coaching::build(&input, &parts, &hide)?;
        let timed_parts = text.parts;
        let preview = owner.preview_take(text, model.unwrap_or_default(), delivery_impressions, local)?;
        let answered_at = db.coaching_answered_at(&attempt_id, &preview.payload_sha256)?;
        Ok(TakeCoachingPreview { preview, answered_at, timed_parts, corrected: input.corrected, revision_id: input.revision_id })
    })
    .await
    .map_err(|_| "Preparing the feedback request failed.".to_string())?
}

/// Sends an approved take preview and stores the validated answer with the
/// take. Stop waiting works like transcription (3.18): before dispatch nothing
/// is billed; after it the charge stays Uncertain.
#[tauri::command]
async fn request_take_coaching(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    attempt_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<storage::database::coaching_runs::CoachingRun, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    // A correction or new transcript since the preview makes its approval stale (A-17).
    let current = { let attempt_id = attempt_id.clone(); with_storage(&storage, move |db| db.take_coaching_input(&attempt_id).map(|input| input.revision_id)) }
        .await
        .map_err(|_| "Session storage failed.".to_string())??;
    owner.ensure_take_revision(&request_id, &current)?;
    let accounting = accounting.inner().clone();
    let local = owner.is_local(&request_id);
    if !local {
        accounting.0.as_ref().map_err(Clone::clone)?;
    }
    let inflight = inflight.inner().clone();
    let task = {
        let (accounting, attempt_id, request_id, payload_sha256) = (accounting.clone(), attempt_id.clone(), request_id.clone(), payload_sha256.clone());
        tauri::async_runtime::spawn(async move {
            if local {
                return owner.send_take_local(&attempt_id, &request_id, &payload_sha256).await;
            }
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            owner.send_take(budget, &accounting.1, &attempt_id, &request_id, &payload_sha256).await
        })
    };
    let abort = task.inner().abort_handle();
    if let Ok(mut map) = inflight.0.lock() {
        map.insert(request_id.clone(), Box::new(move || abort.abort()));
    }
    let outcome = task.await;
    if let Ok(mut map) = inflight.0.lock() {
        map.remove(&request_id);
    }
    let answer = match outcome {
        Ok(result) => result?,
        Err(_) if local => return Err("Stopped waiting for the local model. Nothing left this computer.".into()),
        Err(_) => return Err(api::audio::stopped(accounting.0.as_ref().map_err(Clone::clone)?, &request_id)),
    };
    // The raw answer is already in cache/coaching/<id>; if the database cannot
    // take it, say where it is. Nothing is sent again.
    let id = request_id.clone();
    with_storage(&storage, move |db| {
        db.insert_coaching_run(&storage::database::coaching_runs::NewRun {
            id: &id,
            attempt_id: &answer.request.attempt_id,
            revision_id: &answer.request.revision_id,
            provider: &answer.provider,
            model: &answer.model,
            payload_sha256: &answer.payload_sha256,
            sent_text: &answer.sent_text,
            transcript_text: &answer.request.transcript,
            delivery_impressions: answer.request.delivery,
            provider_request_id: answer.provider_request_id.as_deref(),
            raw_response: &answer.raw.to_string(),
            feedback: &answer.feedback,
            input_tokens: answer.input_tokens,
            output_tokens: answer.output_tokens,
            estimated_cost_micro_usd: answer.estimated_cost_micro_usd,
        })
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
    .map_err(|e| format!("The feedback arrived but could not be saved with the take ({e}). It is kept in the app's cache/coaching/{request_id} folder; nothing will be sent again."))
}

/// Prepares an AI follow-up question after a take (5.11, a simulation); nothing is sent.
#[tauri::command]
async fn preview_follow_up(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    attempt_id: String,
    model: Option<api::coaching::CoachingModel>,
) -> Result<api::coaching::Preview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let prefs = preferences::load(db)?;
        let local = (prefs.coaching_mode == "local")
            .then(|| api::local_llm::validate_endpoint(&prefs.local_endpoint).map(|base| api::local_llm::LocalTarget { base, model: prefs.local_model.clone() }))
            .transpose()?;
        let input = db.take_coaching_input(&attempt_id)?;
        owner.preview_follow_up(take_coaching::follow_up_text(&input)?, model.unwrap_or_default(), local)
    })
    .await
    .map_err(|_| "Preparing the request failed.".to_string())?
}

/// Sends an approved follow-up preview (Stop waiting as for feedback).
#[tauri::command]
async fn request_follow_up(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<api::coaching::PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    attempt_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<api::coaching::FollowUp, String> {
    let owner = owner.inner().clone();
    let current = { let attempt_id = attempt_id.clone(); with_storage(&storage, move |db| db.take_coaching_input(&attempt_id).map(|input| input.revision_id)) }
        .await
        .map_err(|_| "Session storage failed.".to_string())??;
    owner.ensure_take_revision(&request_id, &current)?;
    let accounting = accounting.inner().clone();
    let local = owner.is_local(&request_id);
    if !local {
        accounting.0.as_ref().map_err(Clone::clone)?;
    }
    let inflight = inflight.inner().clone();
    let task = {
        let (accounting, request_id, payload_sha256) = (accounting.clone(), request_id.clone(), payload_sha256.clone());
        tauri::async_runtime::spawn(async move {
            if local {
                return owner.send_follow_up_local(&attempt_id, &request_id, &payload_sha256).await;
            }
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            owner.send_follow_up(budget, &accounting.1, &attempt_id, &request_id, &payload_sha256).await
        })
    };
    let abort = task.inner().abort_handle();
    if let Ok(mut map) = inflight.0.lock() {
        map.insert(request_id.clone(), Box::new(move || abort.abort()));
    }
    let outcome = task.await;
    if let Ok(mut map) = inflight.0.lock() {
        map.remove(&request_id);
    }
    match outcome {
        Ok(result) => result,
        Err(_) if local => Err("Stopped waiting for the local model. Nothing left this computer.".into()),
        Err(_) => Err(api::audio::stopped(accounting.0.as_ref().map_err(Clone::clone)?, &request_id)),
    }
}

/// Storage by category (6.6).
#[tauri::command]
async fn get_storage_usage(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<storage_usage::Category>, String> {
    let root = storage.with(|db| Ok(db.root().to_path_buf()))?;
    tauri::async_runtime::spawn_blocking(move || Ok(storage_usage::usage(&root)))
        .await
        .map_err(|_| "Measuring storage failed.".to_string())?
}

/// Removes only the rebuildable cache (6.6); refused while recording or transcribing.
#[tauri::command]
async fn clear_cache(
    storage: State<'_, Arc<SessionStorage>>,
    capture: State<'_, Arc<CaptureService>>,
    transcription: State<'_, Arc<Transcription>>,
) -> Result<u64, String> {
    if capture.is_active() || transcription.active.is_active() {
        return Err("Finish the recording or transcription first. Nothing was removed.".into());
    }
    let root = storage.with(|db| Ok(db.root().to_path_buf()))?;
    tauri::async_runtime::spawn_blocking(move || storage_usage::clear_cache(&root))
        .await
        .map_err(|_| "Clearing the cache failed.".to_string())?
}

/// Builds the diagnostic report for you to read before saving (6.7).
#[tauri::command]
async fn build_diagnostics(storage: State<'_, Arc<SessionStorage>>, accounting: State<'_, Arc<ApiAccounting>>, timings: State<'_, Arc<timings::Timings>>) -> Result<String, String> {
    let budget = accounting.0.as_ref().ok().and_then(|b| b.summary().ok());
    let measured = timings.snapshot();
    with_storage(&storage, move |db| {
        let setup = transcribe::status(db).ok();
        let key = |p: &str| credentials::provider_status(p).map(|s| s.present).ok();
        let extra = serde_json::json!({
            "localTranscription": setup.map(|s| serde_json::json!({"configured": s.configured, "model": s.model_id, "backend": s.backend})),
            "keysPresent": {"openai": credentials::status().map(|s| s.present).ok(), "deepgram": key("deepgram"), "assemblyai": key("assemblyai")},
            "apiBudgetThisMonth": budget.map(|b| serde_json::json!({"countedMicroUsd": b.counted_micro_usd, "uncertainMicroUsd": b.uncertain_micro_usd, "stopMicroUsd": b.stop_micro_usd})),
            "timingsThisRun": measured,
        });
        diagnostics::report(db, extra)
    })
    .await
    .map_err(|_| "Building the report failed.".to_string())?
}

/// Saves the report you reviewed to a file you choose. Nothing is sent.
#[tauri::command]
async fn save_diagnostics(app: tauri::AppHandle, text: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if text.len() > 1_048_576 || !text.starts_with('{') {
        return Err("This is not a diagnostic report.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let name = format!("clearpractice-diagnostics-{}.json", chrono::Local::now().format("%Y-%m-%d"));
        let picked = app.dialog().file().set_title("Save diagnostic report").set_file_name(&name).add_filter("JSON", &["json"]).blocking_save_file();
        let Some(target) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
        std::fs::write(&target, text).map_err(|_| "Could not save the report there. Choose another folder.".to_string())?;
        Ok(target.file_name().map(|n| n.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "Saving failed.".to_string())?
}

/// Test connection for a local model server (5.10): the models it offers.
#[tauri::command]
async fn test_local_llm(endpoint: String) -> Result<Vec<String>, String> {
    api::local_llm::models(&endpoint).await
}

/// A take's saved AI feedback, newest first.
#[tauri::command]
async fn list_take_coaching(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<storage::database::coaching_runs::CoachingRun>, String> {
    with_storage(&storage, move |db| db.list_coaching_runs(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn get_take_prosody(
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
) -> Result<prosody::Contour, String> {
    with_storage(&storage, move |owner| owner.prosody(&attempt_id))
        .await
        .map_err(|_| "Intonation analysis failed.".to_string())?
}

#[tauri::command]
async fn list_model_packs(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<models::PackStatus>, String> {
    with_storage(&storage, |owner| Ok(models::list(owner.root())))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Imports a known model pack chosen in the native picker: size and SHA-256
/// must match the catalogue, then it is copied and installed atomically.
#[tauri::command]
async fn import_model_pack(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Vec<models::PackStatus>, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |owner| {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a Whisper model file (ggml-*.bin)")
            .add_filter("Whisper model", &["bin"])
            .blocking_pick_file();
        if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
            models::import(owner.root(), &path)?;
        }
        Ok(models::list(owner.root()))
    })
    .await
    .map_err(|_| "Model import failed.".to_string())?
}

#[tauri::command]
async fn get_attempt_transcript(
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
) -> Result<serde_json::Value, String> {
    with_storage(&storage, move |owner| owner.attempt_transcript_with_voice(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn set_filler_decision(
    storage: State<'_, Arc<SessionStorage>>,
    revision_id: String,
    candidate: u32,
    word: String,
    decision: Option<String>,
) -> Result<(), String> {
    with_storage(&storage, move |owner| {
        owner.set_filler_decision(&revision_id, candidate, &word, decision.as_deref(), storage::recording::now_ms())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
async fn search_content(
    storage: State<'_, Arc<SessionStorage>>,
    timings: State<'_, Arc<timings::Timings>>,
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    let started = std::time::Instant::now();
    let hits = with_storage(&storage, move |owner| owner.search(&query))
        .await
        .map_err(|_| "Search failed.".to_string())?;
    let _ = timings.record("search", started.elapsed().as_millis() as u64);
    hits
}

/// Milliseconds since the app process started (6.5 start-up measurement).
#[tauri::command]
fn app_uptime_ms() -> u64 {
    timings::uptime_ms()
}

/// Stores a measurement taken by the interface (start-up, record response).
#[tauri::command]
fn record_timing(timings: State<'_, Arc<timings::Timings>>, kind: String, ms: u64) -> Result<(), String> {
    if kind == "search" {
        return Err("Search is measured natively.".into());
    }
    timings.record(&kind, ms)
}

#[tauri::command]
fn get_timings(timings: State<'_, Arc<timings::Timings>>) -> std::collections::BTreeMap<String, timings::Measure> {
    timings.snapshot()
}

#[tauri::command]
async fn save_transcript_correction(
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
    parent_revision_id: String,
    text: String,
) -> Result<String, String> {
    with_storage(&storage, move |owner| {
        owner.save_transcript_correction(&attempt_id, &parent_revision_id, &text, storage::recording::now_ms())
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionEvent {
    job_id: String,
    attempt_id: String,
    phase: String,
    percent: Option<u8>,
}

/// Starts a local transcription of one saved take in the background and returns
/// its job ID. Progress arrives as `transcription_progress` events; the job's
/// final state is stored before `transcription_finished` is sent.
#[tauri::command]
async fn transcribe_attempt(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    transcription: State<'_, Arc<Transcription>>,
    attempt_id: String,
) -> Result<String, String> {
    if service.is_active() {
        return Err("Finish the recording first. Recording always takes priority.".into());
    }
    storage::recording::validate_id(&attempt_id)?;
    let storage = storage.inner().clone();
    let transcription = transcription.inner().clone();
    let config = storage.with(transcribe::load_config)?;
    let started = storage::recording::now_ms();
    let run_id = transcribe::run_id(&attempt_id, started);
    let job_id = format!("job-{run_id}");
    let cancel = transcription.active.begin(&job_id, &attempt_id)?;
    if let Err(error) = storage.with(|owner| owner.start_job(&job_id, &attempt_id, started)) {
        transcription.active.end(&job_id);
        return Err(error);
    }
    let returned = job_id.clone();
    std::thread::Builder::new()
        .name("clearpractice-transcription".into())
        .spawn(move || {
            let event = |phase: &str, percent: Option<u8>| TranscriptionEvent {
                job_id: job_id.clone(),
                attempt_id: attempt_id.clone(),
                phase: phase.into(),
                percent,
            };
            let result = transcription.worker.transcribe(&config, &attempt_id, &run_id, &cancel, |p| {
                let _ = app.emit("transcription_progress", event(&p.phase, p.percent));
            });
            let now = storage::recording::now_ms();
            let saved = match result {
                Ok(transcript) => storage.with(|owner| owner.save_local_transcript(&job_id, &attempt_id, &transcript, now)),
                Err(error) => {
                    let state = if cancel.load(std::sync::atomic::Ordering::Acquire) { "canceled" } else { "failed" };
                    storage.with(|owner| owner.finish_job(&job_id, state, Some(&error), now))
                }
            };
            if let Err(error) = saved {
                let _ = storage.with(|owner| owner.finish_job(&job_id, "failed", Some(&error), now));
            }
            transcription.active.end(&job_id);
            let _ = app.emit("transcription_finished", event("finished", None));
        })
        .map_err(|_| {
            "Cannot start the transcription worker.".to_string()
        })?;
    Ok(returned)
}

#[tauri::command]
fn cancel_transcription(transcription: State<'_, Arc<Transcription>>) -> Option<String> {
    transcription.active.cancel()
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MicTestFinished {
    attempt_id: String,
    duration_ms: Option<u64>,
    error: Option<String>,
}

/// The running one-click Whisper download, so it can be stopped.
#[derive(Default)]
struct WhisperDownload(std::sync::Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>);

/// What a one-click Whisper setup would download (already installed parts are skipped).
#[tauri::command]
async fn whisper_download_options(storage: State<'_, Arc<SessionStorage>>) -> Result<whisper_setup::Options, String> {
    with_storage(&storage, |owner| Ok(whisper_setup::options(owner.root())))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Downloads, verifies and installs local Whisper after an explicit click, with
/// progress as `whisper_download_progress`, then stores the worker setup.
#[tauri::command]
async fn download_whisper(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    download: State<'_, Arc<WhisperDownload>>,
    choice: whisper_setup::Choice,
) -> Result<transcribe::SetupStatus, String> {
    let root = {
        let storage = storage.inner().clone();
        storage.with(|owner| Ok(owner.root().to_path_buf()))?
    };
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut slot = download.0.lock().map_err(|_| "The download state is unavailable.")?;
        if slot.is_some() {
            return Err("Whisper is already downloading.".into());
        }
        *slot = Some(cancel.clone());
    }
    let events = app.clone();
    let result = whisper_setup::install(&root, choice, &cancel, move |progress| {
        let _ = events.emit("whisper_download_progress", progress);
    })
    .await;
    if let Ok(mut slot) = download.0.lock() {
        *slot = None;
    }
    let config = result?;
    with_storage(&storage, move |owner| {
        let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
        owner.set_setting(transcribe::CONFIG_KEY, &json)?;
        transcribe::status(owner)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
fn cancel_whisper_download(download: State<'_, Arc<WhisperDownload>>) {
    if let Some(cancel) = download.0.lock().ok().and_then(|slot| slot.clone()) {
        cancel.store(true, std::sync::atomic::Ordering::Release);
    }
}

/// Live input level for the Studio's Ready state (nothing is recorded or kept).
/// Levels arrive as `input_level` about ten times a second until `stop_level_monitor`.
/// While a take or microphone test runs, their own levels are shown instead.
#[tauri::command]
async fn start_level_monitor(
    app: tauri::AppHandle,
    monitor: State<'_, Arc<audio::monitor::LevelMonitor>>,
    service: State<'_, Arc<CaptureService>>,
    mic: State<'_, Arc<mic_test::MicTest>>,
    device_id: Option<String>,
) -> Result<(), String> {
    if service.is_active() || mic.capture.is_active() {
        return Ok(());
    }
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        monitor.start(device_id, Arc::new(move |level| {
            let _ = app.emit("input_level", level);
        }))
    })
    .await
    .map_err(|_| "Level monitor failed.".to_string())?
}

#[tauri::command]
async fn stop_level_monitor(monitor: State<'_, Arc<audio::monitor::LevelMonitor>>) -> Result<(), String> {
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || monitor.stop())
        .await
        .map_err(|_| "Level monitor failed.".to_string())
}

/// Records five seconds from the chosen microphone for playback (plan 2.12).
/// Levels arrive as `mic_test_level`; `mic_test_finished` follows the stop.
#[tauri::command]
async fn start_mic_test(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
    mic: State<'_, Arc<mic_test::MicTest>>,
    monitor: State<'_, Arc<audio::monitor::LevelMonitor>>,
    device_id: Option<String>,
) -> Result<RecordingStatus, String> {
    if service.is_active() {
        return Err("Stop the current recording before testing the microphone.".into());
    }
    let mic = mic.inner().clone();
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        monitor.stop();
        mic.clear()?;
        let id = format!("mic-test-{}", storage::recording::now_ms());
        let status = mic.capture.start(StartRequest {
            attempt_id: id.clone(),
            idempotency_key: id.clone(),
            device_id,
            title: "Microphone test".into(),
            live_pace: false,
        })?;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(mic_test::TEST_MS));
            let result = mic.capture.stop(&id);
            let _ = app.emit(
                "mic_test_finished",
                MicTestFinished {
                    attempt_id: id,
                    duration_ms: result.as_ref().ok().map(|s| s.duration_ms),
                    error: result.err(),
                },
            );
        });
        Ok(status)
    })
    .await
    .map_err(|_| "Microphone test failed.".to_string())?
}

#[tauri::command]
async fn get_mic_test_playback_path(
    mic: State<'_, Arc<mic_test::MicTest>>,
    attempt_id: String,
) -> Result<String, String> {
    let mic = mic.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage::recording::playback_path(&mic.root, &attempt_id)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Microphone test failed.".to_string())?
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

/// Replaces the current profile with a checked backup (plan 2.20). The previous
/// data is kept as rollback material; any failure puts it back.
#[tauri::command]
async fn restore_backup(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    transcription: State<'_, Arc<Transcription>>,
    staging_id: String,
) -> Result<backup::RestoreOutcome, String> {
    if service.is_active() {
        return Err("Stop the recording before restoring a backup.".into());
    }
    if transcription.active.is_active() {
        return Err("Wait for the transcription to finish, or cancel it, before restoring a backup.".into());
    }
    let root = service.root.clone();
    let service = service.inner().clone();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = storage
            .0
            .write()
            .map_err(|_| "Session storage is unavailable.".to_string())?;
        if service.is_active() {
            return Err("Stop the recording before restoring a backup.".into());
        }
        // Close the current database before its folder moves.
        drop(std::mem::replace(&mut *guard, Err("A restore is in progress.".into())));
        let swapped = backup::replace_profile(&root, &staging_id, storage::recording::now_ms());
        let outcome = match swapped {
            Ok(outcome) => outcome,
            Err(error) => {
                *guard = storage::database::DatabaseOwner::open(&root);
                return Err(error);
            }
        };
        match storage::database::DatabaseOwner::open(&root) {
            Ok(owner) => {
                *guard = Ok(owner);
                backup::finish_restore(&root)?;
                Ok(outcome)
            }
            Err(error) => {
                let rolled_back = backup::roll_back(&root);
                *guard = storage::database::DatabaseOwner::open(&root);
                Err(match rolled_back {
                    Ok(()) => format!("The restored data could not be opened ({error}). Your previous data was put back."),
                    Err(rollback) => format!("The restored data could not be opened ({error}), and putting your previous data back failed ({rollback}). Restart ClearPractice; it retries at start."),
                })
            }
        }
    })
    .await
    .map_err(|_| "Restore failed.".to_string())?
}

/// The asset scope in tauri.conf.json covers the default data folder only. A
/// data folder chosen by the user (2.25) gets the same audio folders, so its
/// recordings and clips can be played. Only these folders, never the whole root.
fn allow_audio_playback(app: &tauri::AppHandle, root: &std::path::Path) {
    let scope = app.asset_protocol_scope();
    let mut roots = vec![root.to_path_buf()];
    if let Ok(canonical) = std::fs::canonicalize(root) {
        // Windows canonical paths carry a \\?\ prefix that requested paths do not.
        let plain = canonical.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        roots.push(std::path::PathBuf::from(plain));
    }
    for base in roots {
        for dir in data_location::PLAYABLE_DIRS {
            let _ = scope.allow_directory(base.join(dir), true);
        }
    }
}

/// Where the data lives (2.25).
struct DataLocation {
    default: std::path::PathBuf,
    resolved: data_location::Resolved,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataLocationStatus {
    current: String,
    default: String,
    custom: bool,
    problem: Option<String>,
    /// The folder the data was copied from, while its copy still exists.
    previous: Option<String>,
    previous_bytes: u64,
}

#[tauri::command]
async fn get_data_location(location: State<'_, Arc<DataLocation>>) -> Result<DataLocationStatus, String> {
    let location = location.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let r = &location.resolved;
        let previous_bytes = r.previous.as_deref().map(data_location::previous_copy_bytes).unwrap_or(0);
        DataLocationStatus {
            current: r.root.to_string_lossy().into_owned(),
            default: location.default.to_string_lossy().into_owned(),
            custom: r.root != location.default,
            problem: r.problem.clone(),
            previous: r.previous.as_ref().filter(|_| previous_bytes > 0).map(|p| p.to_string_lossy().into_owned()),
            previous_bytes,
        }
    })
    .await
    .map_err(|_| "Cannot read the data folder.".to_string())
}

/// Copies the data to a folder the user picks (or back to the default), checks
/// every file, and points the app there from the next start (2.25). The
/// database is closed during the copy; the caller restarts the app afterwards.
/// `None` means the picker was cancelled.
#[tauri::command]
async fn move_data_folder(
    app: tauri::AppHandle,
    location: State<'_, Arc<DataLocation>>,
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    transcription: State<'_, Arc<Transcription>>,
    work: State<'_, Arc<ClipWork>>,
    to_default: bool,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if service.is_active() {
        return Err("Stop the recording before moving your data.".into());
    }
    if transcription.active.is_active() {
        return Err("Wait for the transcription to finish, or cancel it, before moving your data.".into());
    }
    let (location, storage, service) = (location.inner().clone(), storage.inner().clone(), service.inner().clone());
    let current = location.resolved.root.clone();
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = Some(cancel.clone());
    }
    let events = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let target = if to_default {
            if current == location.default {
                return Err("Your data is already in the default folder.".to_string());
            }
            if data_location::MOVED_DIRS.iter().any(|d| location.default.join(d).exists()) {
                return Err("The default folder still holds an older copy of your data. Remove it first (Explorer: the folders listed in Settings), then try again.".into());
            }
            location.default.clone()
        } else {
            let picked = app.dialog().file().set_title("Choose where ClearPractice keeps your data").blocking_pick_folder();
            let Some(chosen) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
            data_location::plan_target(&chosen, &current)?
        };
        let mut guard = storage.0.write().map_err(|_| "Session storage is unavailable.".to_string())?;
        if service.is_active() {
            return Err("Stop the recording before moving your data.".into());
        }
        // Close the database so its files are complete on disk while copied.
        drop(std::mem::replace(&mut *guard, Err("Your data is moving to another folder. ClearPractice restarts when it is done.".into())));
        let copied = data_location::copy_profile(&current, &target, &cancel, |done, total| {
            let _ = events.emit("data_move_progress", serde_json::json!({ "done": done, "total": total }));
        })
        .and_then(|_| data_location::commit(&location.default, &target, &current));
        if let Err(error) = copied {
            *guard = storage::database::DatabaseOwner::open(&current);
            return Err(error);
        }
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "Moving the data failed.".to_string())?;
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = None;
    }
    result
}

/// Removes the copy left in the previous folder after a move (2.25).
#[tauri::command]
async fn remove_old_data_copy(location: State<'_, Arc<DataLocation>>) -> Result<(), String> {
    let location = location.inner().clone();
    tauri::async_runtime::spawn_blocking(move || data_location::remove_previous(&location.default, &location.resolved.root))
        .await
        .map_err(|_| "Removing the old copy failed.".to_string())?
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle, service: State<'_, Arc<CaptureService>>) -> Result<(), String> {
    if service.is_active() {
        return Err("Stop the recording first.".into());
    }
    app.restart()
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
    timings::mark_process_start();
    tauri::Builder::default()
        .manage(Arc::new(timings::Timings::default()))
        .manage(Arc::new(audio::monitor::LevelMonitor::default()))
        .manage(Arc::new(WhisperDownload::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The data may live in a folder the user chose (2.25); WebView data
            // and the pointer to it stay in the default location.
            let default = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&default)?;
            let location = data_location::resolve(&default);
            let root = location.root.clone();
            if root != default {
                allow_audio_playback(app.handle(), &root);
            }
            app.manage(Arc::new(DataLocation { default, resolved: location }));
            app_paths::prepare_app_data(&root)?;
            let rollback = backup::roll_back(&root);
            if rollback.is_ok() {
                backup::clean_staging(&root);
            }
            app.manage(Arc::new(SessionStorage(std::sync::RwLock::new(
                rollback.and_then(|_| storage::database::DatabaseOwner::open(&root)),
            ))));
            // Bundled reference clips (4.4) are installed once, in the background.
            if let Ok(resources) = app.path().resource_dir() {
                let storage = app.state::<Arc<SessionStorage>>().inner().clone();
                std::thread::spawn(move || {
                    let pack = resources.join("resources").join("clips");
                    if pack.join("manifest.json").is_file() {
                        let _ = storage.with(|owner| {
                            clips::install_bundled(owner.root(), &pack, |id| owner.has_clip(id), |clip| owner.insert_clip(clip)).map(|_| ())
                        });
                    }
                    // Pitch lines for every clip (P.6); kept ones are skipped quickly.
                    if let Ok((root, all)) = storage.with(|owner| Ok((owner.root().to_path_buf(), owner.list_clips()?))) {
                        for clip in all {
                            let _ = clips::clip_contour(&root, &clip.id, &clip.sha256);
                        }
                    }
                });
            }
            // Damaged/unavailable accounting disables API work, while capture
            // and offline practice still start normally.
            app.manage(Arc::new(ApiAccounting(
                api::budget::BudgetOwner::open(&root),
                root.clone(),
            )));
            app.manage(Arc::new(api::coaching::PreviewOwner::default()));
            // Prices you entered in Settings apply from the first preview (5.9).
            if let Some(storage) = app.try_state::<Arc<SessionStorage>>() {
                let _ = storage.with(|db| preferences::load(db).map(|_| ()));
            }
            app.manage(Arc::new(api::audio::AudioPreviewOwner::default()));
            app.manage(Arc::new(InflightApi::default()));
            app.manage(Arc::new(ClipWork::default()));
            let mic_events = app.handle().clone();
            app.manage(Arc::new(mic_test::MicTest::new(
                &root,
                Arc::new(move |event, status| {
                    // recording_status/level/saved → mic_test_status/level/saved
                    let name = format!("mic_test_{}", event.trim_start_matches("recording_"));
                    let _ = mic_events.emit(&name, status);
                }),
            )?));
            app.manage(Arc::new(Transcription {
                worker: audio::whisper::WhisperWorker::new(root.clone()),
                active: transcribe::ActiveJob::default(),
            }));
            let handle = app.handle().clone();
            app.manage(Arc::new(CaptureService::new(
                root,
                Arc::new(move |event, status| {
                    // Capture's file receipt precedes SQLite's reference commit.
                    // Commands announce Saved only after both are durable.
                    if status.phase == "saved" {
                        return;
                    }
                    // Live pace (8.8) has its own small payload.
                    if event == "live_pace" {
                        if let Some(pace) = &status.live_pace {
                            let _ = handle.emit(event, serde_json::json!({
                                "attemptId": status.attempt_id,
                                "syllablesPerSecond": pace.syllables_per_second,
                                "voicedMs": pace.voiced_ms,
                                "windowMs": pace.window_ms,
                            }));
                        }
                        return;
                    }
                    let _ = handle.emit(event, status);
                }),
            )));
            spawn_auto_backup(
                app.handle().clone(),
                app.state::<Arc<SessionStorage>>().inner().clone(),
                app.state::<Arc<CaptureService>>().inner().clone(),
            );
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
            commands::learning::set_prediction,
            commands::learning::list_predictions,
            commands::learning::get_programme_state,
            commands::learning::start_programme,
            commands::learning::complete_programme_step,
            commands::learning::set_programme_week,
            commands::learning::stop_programme,
            commands::learning::save_catch_run,
            commands::learning::list_catch_runs,
            commands::learning::skip_reanswer,
            commands::confidence::list_exposure_steps,
            commands::confidence::save_exposure_steps,
            commands::confidence::list_exposure_attempts,
            commands::confidence::add_exposure_attempt,
            commands::confidence::update_exposure_attempt,
            commands::confidence::delete_exposure_attempt,
            commands::confidence::save_routine_run,
            commands::confidence::list_routine_runs,
            commands::confidence::delete_routine_run,
            commands::confidence::set_segment_mark,
            commands::confidence::list_segment_marks,
            commands::confidence::best_moments,
            commands::drills::add_take_events,
            commands::drills::list_take_events,
            commands::drills::get_activity_result,
            commands::engagement::list_practice_events,
            commands::engagement::record_sequence_completed,
            commands::engagement::get_practice_facts,
            commands::engagement::get_engagement_state,
            commands::engagement::record_unlocks,
            commands::engagement::set_weekly_quests,
            commands::engagement::swap_weekly_quest,
            commands::insights::list_phrase_uses,
            commands::insights::set_self_check,
            commands::insights::list_self_checks,
            commands::insights::get_audio_measures,
            commands::insights::save_comparison,
            commands::insights::list_comparisons,
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
            start_level_monitor,
            stop_level_monitor,
            preview_phrase_suggestions,
            request_phrase_suggestions,
            preview_drill_comparison,
            request_drill_comparison,
            whisper_download_options,
            download_whisper,
            cancel_whisper_download,
            stop_recording,
            get_recording_status,
            list_recordings,
            list_recoverable_recordings,
            recover_recording,
            discard_recoverable_recording,
            get_recording_playback_path,
            get_recording_waveform,
            list_trash,
            move_session_to_trash,
            restore_session,
            delete_sessions_permanently,
            empty_trash,
            move_take_to_trash,
            set_session_focus,
            set_preferred_take,
            list_progression_events,
            record_progression,
            list_transfer_reviews,
            add_transfer_review,
            delete_transfer_review,
            get_prompt_state,
            add_user_prompt,
            update_user_prompt,
            delete_user_prompt,
            set_prompt_favorite,
            choose_clip_file,
            get_clip_staging_path,
            discard_clip_staging,
            save_clip,
            split_clip_source,
            preview_clip_names,
            measure_clip_source,
            preview_clip_picks,
            request_clip_picks,
            request_clip_names,
            preview_split_transcription,
            request_split_transcription,
            cancel_clip_work,
            save_clip_sections,
            get_link_tool_status,
            choose_link_tool,
            fetch_link_audio,
            download_link_tool,
            list_clips,
            get_clip_prosody,
            list_phrases,
            review_phrase,
            add_phrase,
            update_phrase,
            delete_phrase,
            list_clip_folders,
            create_clip_folder,
            rename_clip_folder,
            delete_clip_folder,
            move_clips,
            update_clip,
            list_clip_sources,
            open_clip_source,
            update_clip_source,
            delete_clip_source,
            get_clip_playback_path,
            delete_clip,
            set_session_reflection,
            restore_take,
            delete_takes_permanently,
            set_trash_retention,
            get_backup_status,
            choose_backup_destination,
            create_backup,
            preview_restore,
            discard_restore_preview,
            get_data_location,
            move_data_folder,
            remove_old_data_copy,
            restart_app,
            restore_backup,
            set_auto_backup,
            export_session,
            get_transcription_setup,
            choose_transcription_setup,
            get_attempt_transcript,
            list_model_packs,
            get_take_prosody,
            preview_take_coaching,
            request_take_coaching,
            list_take_coaching,
            get_storage_usage,
            app_uptime_ms,
            record_timing,
            get_timings,
            test_local_llm,
            build_diagnostics,
            save_diagnostics,
            clear_cache,
            preview_follow_up,
            request_follow_up,
            import_model_pack,
            save_transcript_correction,
            search_content,
            set_filler_decision,
            get_transcription_api_keys,
            store_transcription_api_key,
            remove_transcription_api_key,
            preview_api_transcription,
            cancel_api_transcription_preview,
            cancel_api_transcription,
            get_api_preview_audio_path,
            get_preferences,
            set_preferences,
            get_transcription_preference,
            set_transcription_preference,
            request_api_transcription,
            start_mic_test,
            get_mic_test_playback_path,
            transcribe_attempt,
            cancel_transcription,
            close_after_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
