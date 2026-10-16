//! Effort and practice facts (roadmap 7.4, 7.6).
use crate::storage::database::engagement::{PracticeEvent, PracticeFacts};
use crate::{with_storage, SessionStorage};
use std::sync::Arc;
use tauri::State;

/// Practice events from a local date on (all when `from` is absent).
#[tauri::command]
pub async fn list_practice_events(storage: State<'_, Arc<SessionStorage>>, from: Option<String>) -> Result<Vec<PracticeEvent>, String> {
    with_storage(&storage, move |db| db.list_practice_events(from.as_deref()))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Practice complete: one event per finished sequence with at least one take.
#[tauri::command]
pub async fn record_sequence_completed(storage: State<'_, Arc<SessionStorage>>, session_ids: Vec<String>, local_date: String) -> Result<Option<PracticeEvent>, String> {
    with_storage(&storage, move |db| db.record_sequence_completed(&session_ids, &local_date))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// One snapshot of your practice for the rule engines in the interface.
#[tauri::command]
pub async fn get_practice_facts(storage: State<'_, Arc<SessionStorage>>) -> Result<PracticeFacts, String> {
    let today = crate::storage::database::engagement::today();
    with_storage(&storage, move |db| db.practice_facts(&today))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}
