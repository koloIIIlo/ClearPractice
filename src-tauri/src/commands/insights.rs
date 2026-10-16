//! Insights (roadmap M8): saved phrases spotted in takes, self-checks, speech
//! rate from the audio and A/B choices. Everything stays on this computer.
use crate::storage::database::insights::{AudioMeasures, Comparison, PhraseUse, SelfCheck};
use crate::storage::recording;
use crate::{with_storage, SessionStorage};
use std::sync::Arc;
use tauri::State;

/// Where saved phrases turned up (one phrase, or all when `card_id` is absent).
#[tauri::command]
pub async fn list_phrase_uses(storage: State<'_, Arc<SessionStorage>>, card_id: Option<String>) -> Result<Vec<PhraseUse>, String> {
    with_storage(&storage, move |db| db.list_phrase_uses(card_id.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Saves your yes/no note about a take; `null` clears it.
#[tauri::command]
pub async fn set_self_check(storage: State<'_, Arc<SessionStorage>>, attempt_id: String, check_id: String, value: Option<bool>) -> Result<(), String> {
    with_storage(&storage, move |db| db.set_self_check(&attempt_id, &check_id, value, recording::now_ms()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_self_checks(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<SelfCheck>, String> {
    with_storage(&storage, move |db| db.list_self_checks(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Speech rate from the take's audio, computed once (off the interface thread).
#[tauri::command]
pub async fn get_audio_measures(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<AudioMeasures, String> {
    with_storage(&storage, move |db| db.audio_measures(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Your A/B choice between takes of two sessions.
#[tauri::command]
pub async fn save_comparison(storage: State<'_, Arc<SessionStorage>>, a_attempt: String, b_attempt: String, preferred: String, blind: bool) -> Result<Comparison, String> {
    with_storage(&storage, move |db| db.save_comparison(&a_attempt, &b_attempt, &preferred, blind, recording::now_ms()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_comparisons(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<Comparison>, String> {
    with_storage(&storage, move |db| db.list_comparisons(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}
