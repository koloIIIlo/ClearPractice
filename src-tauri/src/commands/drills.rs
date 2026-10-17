//! Drills (roadmap M10): marks made during a take and each drill take's result.
use crate::storage::database::drills::{TakeEvent, TakeEventInput};
use crate::{with_storage, SessionStorage};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

/// Stores a saved take's marks (a word shown, a slip you flagged, a card advanced).
#[tauri::command]
pub async fn add_take_events(storage: State<'_, Arc<SessionStorage>>, attempt_id: String, events: Vec<TakeEventInput>) -> Result<u32, String> {
    with_storage(&storage, move |db| db.add_take_events(&attempt_id, &events))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_take_events(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<TakeEvent>, String> {
    with_storage(&storage, move |db| db.list_take_events(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// A drill take's result, computed once and kept until its transcript changes.
#[tauri::command]
pub async fn get_activity_result(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Value, String> {
    with_storage(&storage, move |db| db.activity_result(&attempt_id))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}
