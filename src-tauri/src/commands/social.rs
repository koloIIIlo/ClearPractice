//! Club mode (roadmap 15.2): meetings, their agenda and each speaker's
//! result, and the summary saved where you choose. Nobody is recorded and
//! nothing here sends anything (A-32).
use crate::storage::database::social::{summary_file_name, summary_markdown, ClubMeetingInput, ClubMeetingSummary, ClubMeetingView, ClubSpeechResult};
use crate::{with_storage, SessionStorage};
use std::sync::Arc;
use tauri::State;

fn failed<T>(result: Result<Result<T, String>, ()>) -> Result<T, String> {
    result.map_err(|_| "Session storage failed.".to_string())?
}

/// Creates or changes a meeting and its agenda.
#[tauri::command]
pub async fn save_club_meeting(storage: State<'_, Arc<SessionStorage>>, input: ClubMeetingInput) -> Result<ClubMeetingView, String> {
    failed(with_storage(&storage, move |db| db.save_club_meeting(&input)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_club_meetings(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<ClubMeetingSummary>, String> {
    failed(with_storage(&storage, move |db| db.list_club_meetings()).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn get_club_meeting(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<ClubMeetingView, String> {
    failed(with_storage(&storage, move |db| db.get_club_meeting(&id)).await.map_err(|_| ()))
}

/// Deletes a meeting softly.
#[tauri::command]
pub async fn delete_club_meeting(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.delete_club_meeting(&id)).await.map_err(|_| ()))
}

/// A speaker's time, taps and notes, stored as each speaker finishes.
#[tauri::command]
pub async fn save_club_speech(storage: State<'_, Arc<SessionStorage>>, meeting_id: String, speech_id: String, result: ClubSpeechResult) -> Result<ClubMeetingView, String> {
    failed(with_storage(&storage, move |db| db.save_club_speech(&meeting_id, &speech_id, &result)).await.map_err(|_| ()))
}

/// The meeting as Markdown, for Copy as text.
#[tauri::command]
pub async fn club_summary(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<String, String> {
    failed(with_storage(&storage, move |db| db.club_summary(&id)).await.map_err(|_| ()))
}

/// Saves the meeting's summary as a Markdown file you choose; returns its name, or None when you cancel.
#[tauri::command]
pub async fn export_club_summary(app: tauri::AppHandle, storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    failed(
        with_storage(&storage, move |db| {
            let view = db.get_club_meeting(&id)?;
            let picked = app.dialog().file().set_title("Save the meeting summary").set_file_name(summary_file_name(&view)).add_filter("Markdown", &["md"]).blocking_save_file();
            let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
                return Ok(None);
            };
            std::fs::write(&path, summary_markdown(&view)).map_err(|_| "The summary could not be saved in that folder.".to_string())?;
            Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
        })
        .await
        .map_err(|_| ()),
    )
}
