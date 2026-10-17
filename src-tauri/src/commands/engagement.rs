//! Effort and practice facts (roadmap 7.4, 7.6) and the game core (M9).
use crate::storage::database::engagement::{PracticeEvent, PracticeFacts};
use crate::storage::database::game::{EngagementState, QuestInput, QuestRow, UnlockInput, UnlockOutcome};
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

/// Levels, achievements, records, recent quests and goal weeks (9.3).
#[tauri::command]
pub async fn get_engagement_state(storage: State<'_, Arc<SessionStorage>>, week: String) -> Result<EngagementState, String> {
    with_storage(&storage, move |db| db.engagement_state(&week))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Records what the rules found new, once, with its XP.
#[tauri::command]
pub async fn record_unlocks(storage: State<'_, Arc<SessionStorage>>, input: UnlockInput) -> Result<UnlockOutcome, String> {
    with_storage(&storage, move |db| db.record_unlocks(&input))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Stores this week's quests the first time they are shown.
#[tauri::command]
pub async fn set_weekly_quests(storage: State<'_, Arc<SessionStorage>>, week: String, quests: Vec<QuestInput>) -> Result<Vec<QuestRow>, String> {
    with_storage(&storage, move |db| db.set_weekly_quests(&week, &quests))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Swaps one quest, once a week.
#[tauri::command]
pub async fn swap_weekly_quest(storage: State<'_, Arc<SessionStorage>>, week: String, slot: u8, quest: QuestInput) -> Result<QuestRow, String> {
    with_storage(&storage, move |db| db.swap_weekly_quest(&week, slot, &quest))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}
