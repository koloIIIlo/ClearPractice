pub mod analysis;
pub mod api;
mod app_paths;
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
pub mod storage;
pub mod transcribe;

use audio::capture::{CaptureService, RecordingStatus, StartRequest};
use std::sync::Arc;
use storage::recording::{RecoverableRecording, SavedRecording};
use tauri::{Emitter, Manager, State};

/// The Whisper worker plus the single running transcription job.
struct Transcription {
    worker: audio::whisper::WhisperWorker,
    active: transcribe::ActiveJob,
}

struct ApiAccounting(Result<api::budget::BudgetOwner, String>, std::path::PathBuf);
/// API transcriptions in flight, by request ID, each with a way to stop waiting (3.18).
#[derive(Default)]
struct InflightApi(std::sync::Mutex<std::collections::HashMap<String, Box<dyn Fn() + Send + Sync>>>);
/// The session database owner. Restore swaps it under the write lock; every other
/// command holds the read lock for the whole of its storage or file work.
struct SessionStorage(std::sync::RwLock<Result<storage::database::DatabaseOwner, String>>);

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
    tauri::async_runtime::spawn_blocking(move || {
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

fn with_storage<T: Send + 'static>(
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
) -> Result<clips::Clip, String> {
    with_storage(&storage, move |owner| {
        let details = clips::ClipDetails { title: &title, source: &source, transcript: transcript.as_deref(), description: None, feature: None };
        let clip = clips::commit(owner.root(), &staging_id, start_ms, end_ms, &details, "user", false)?;
        if let Err(error) = owner.insert_clip(&clip) {
            let _ = clips::remove_files(owner.root(), &clip.id);
            return Err(error);
        }
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
    let result = tauri::async_runtime::spawn_blocking(move || {
        let segments = clipsplit::transcribe_local(&config, &root, &staging_id, &cancel, |percent| {
            let _ = app.emit("clip_split_progress", percent);
        })?;
        clipsplit::save_segments(&root, &staging_id, &segments)?;
        let candidates = clipsplit::propose(&segments);
        if candidates.is_empty() {
            return Err("No clips of 8–20 seconds with whole sentences were found. You can still keep a section by hand.".into());
        }
        Ok(candidates)
    })
    .await
    .map_err(|_| "Splitting failed.".to_string())?;
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
        clipsplit::measure_staged(&root, &staging_id, &flag, |stage| {
            let (name, percent) = match stage {
                clipsplit::MeasureStage::PreparingAudio => ("preparing", None),
                clipsplit::MeasureStage::Measuring(p) => ("measuring", Some(p)),
            };
            let _ = app.emit("clip_measure_progress", serde_json::json!({ "stage": name, "percent": percent }));
        })
        .map(|sentences| sentences.len())
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
    let picks = owner.send_clip_picks(budget, &accounting.1, &request_id, &payload_sha256, segments.len()).await?;
    let clips = clipsplit::picks_to_clips(&segments, &picks);
    if clips.is_empty() {
        return Err("The AI's passages did not fit the clip rules (5–30 s, whole sentences, no overlaps). The automatic proposals are unchanged.".into());
    }
    Ok(clips)
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
    with_storage(&storage, move |db| {
        let (path, duration_ms) = clipsplit::resample_staged(db.root(), &staging_id, &std::sync::atomic::AtomicBool::new(false))?;
        let bytes = std::fs::metadata(&path).map_err(|_| "The prepared audio is unavailable.")?.len();
        let sha = storage::recording::hash_file(&path)?;
        let source = storage::recording::hash_file(&clips::staging_dir(db.root(), &staging_id)?.join("full.wav"))?;
        owner.preview_prepared(path, &staging_id, duration_ms, bytes, sha, source, provider)
    })
    .await
    .map_err(|_| "Preview failed.".to_string())?
}

/// Sends an approved split preview and proposes clips from the word timings.
/// The paid result is not stored as a transcript: the recording is not a take.
#[tauri::command]
async fn request_split_transcription(
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
    let words = run.result.words.value.ok_or("The provider returned no word timings, so no clips can be cut. Try transcribing on this computer.")?;
    let segments = clipsplit::segments_from_words(&words);
    let staging_id = run.result.asset_id.clone();
    let root = accounting.1.clone();
    let _ = clipsplit::save_segments(&root, &staging_id, &segments);
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
async fn save_clip_sections(storage: State<'_, Arc<SessionStorage>>, staging_id: String, sections: Vec<SectionToSave>) -> Result<Vec<clips::Clip>, String> {
    if sections.is_empty() || sections.len() > clipsplit::MAX_CANDIDATES {
        return Err("Choose between 1 and 40 clips to keep.".into());
    }
    with_storage(&storage, move |owner| {
        let mut saved = Vec::new();
        for section in &sections {
            let details = clips::ClipDetails {
                title: &section.title,
                source: &section.source,
                transcript: section.transcript.as_deref(),
                description: section.description.as_deref(),
                feature: section.feature.as_deref(),
            };
            let clip = clips::commit(owner.root(), &staging_id, section.start_ms, section.end_ms, &details, "user", true)?;
            if let Err(error) = owner.insert_clip(&clip) {
                let _ = clips::remove_files(owner.root(), &clip.id);
                return Err(error);
            }
            saved.push(clip);
        }
        clips::discard_staging(owner.root(), &staging_id);
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
    let result = with_storage(&storage, move |owner| {
        let tool = linkaudio::find_ytdlp(owner.setting(linkaudio::SETTING_KEY)?.as_deref())
            .ok_or("yt-dlp was not found. Install it (winget install yt-dlp.yt-dlp) or choose yt-dlp.exe.")?;
        linkaudio::fetch(owner.root(), &tool, &url, &cancel)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?;
    if let Ok(mut slot) = work.fetch.lock() {
        *slot = None;
    }
    result
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
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    with_storage(&storage, move |owner| owner.search(&query))
        .await
        .map_err(|_| "Search failed.".to_string())?
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

/// Records five seconds from the chosen microphone for playback (plan 2.12).
/// Levels arrive as `mic_test_level`; `mic_test_finished` follows the stop.
#[tauri::command]
async fn start_mic_test(
    app: tauri::AppHandle,
    service: State<'_, Arc<CaptureService>>,
    mic: State<'_, Arc<mic_test::MicTest>>,
    device_id: Option<String>,
) -> Result<RecordingStatus, String> {
    if service.is_active() {
        return Err("Stop the current recording before testing the microphone.".into());
    }
    let mic = mic.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        mic.clear()?;
        let id = format!("mic-test-{}", storage::recording::now_ms());
        let status = mic.capture.start(StartRequest {
            attempt_id: id.clone(),
            idempotency_key: id.clone(),
            device_id,
            title: "Microphone test".into(),
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
                });
            }
            // Damaged/unavailable accounting disables API work, while capture
            // and offline practice still start normally.
            app.manage(Arc::new(ApiAccounting(
                api::budget::BudgetOwner::open(&root),
                root.clone(),
            )));
            app.manage(Arc::new(api::coaching::PreviewOwner::default()));
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
            restore_backup,
            set_auto_backup,
            export_session,
            get_transcription_setup,
            choose_transcription_setup,
            get_attempt_transcript,
            list_model_packs,
            get_take_prosody,
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
