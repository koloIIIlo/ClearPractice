//! The confidence pack (roadmap M12): the exposure ladder, the pre-talk
//! routine, sentences you liked and the week's best moments.
use crate::storage::database::confidence::{AttemptInput, ExposureAttempt, ExposureStep, Moment, RoutineInput, RoutineRun, SegmentMark, StepInput};
use crate::{with_storage, SessionStorage};
use std::sync::Arc;
use tauri::State;

fn failed<T>(result: Result<Result<T, String>, ()>) -> Result<T, String> {
    result.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_exposure_steps(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<ExposureStep>, String> {
    failed(with_storage(&storage, move |db| db.list_exposure_steps()).await.map_err(|_| ()))
}

/// Saves the whole ladder in order; steps left out are deleted softly.
#[tauri::command]
pub async fn save_exposure_steps(storage: State<'_, Arc<SessionStorage>>, steps: Vec<StepInput>) -> Result<Vec<ExposureStep>, String> {
    failed(with_storage(&storage, move |db| db.save_exposure_steps(&steps)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_exposure_attempts(storage: State<'_, Arc<SessionStorage>>, step_id: Option<String>) -> Result<Vec<ExposureAttempt>, String> {
    failed(with_storage(&storage, move |db| db.list_exposure_attempts(step_id.as_deref())).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn add_exposure_attempt(storage: State<'_, Arc<SessionStorage>>, input: AttemptInput) -> Result<ExposureAttempt, String> {
    failed(with_storage(&storage, move |db| db.add_exposure_attempt(&input)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn update_exposure_attempt(storage: State<'_, Arc<SessionStorage>>, id: String, input: AttemptInput) -> Result<ExposureAttempt, String> {
    failed(with_storage(&storage, move |db| db.update_exposure_attempt(&id, &input)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn delete_exposure_attempt(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.delete_exposure_attempt(&id)).await.map_err(|_| ()))
}

/// A finished pre-talk routine; the worry note is stored only when you kept it.
#[tauri::command]
pub async fn save_routine_run(storage: State<'_, Arc<SessionStorage>>, input: RoutineInput) -> Result<RoutineRun, String> {
    failed(with_storage(&storage, move |db| db.save_routine_run(&input)).await.map_err(|_| ()))
}

/// Removes a routine run with the note you kept; deleted softly.
#[tauri::command]
pub async fn delete_routine_run(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.delete_routine_run(&id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_routine_runs(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<RoutineRun>, String> {
    failed(with_storage(&storage, move |db| db.list_routine_runs()).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn set_segment_mark(storage: State<'_, Arc<SessionStorage>>, revision_id: String, segment: u32, liked: bool) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.set_segment_mark(&revision_id, segment, liked)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_segment_marks(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<SegmentMark>, String> {
    failed(with_storage(&storage, move |db| db.list_segment_marks(&attempt_id)).await.map_err(|_| ()))
}

/// The week's best moments (local dates from `week_start`), from stored segment times only.
#[tauri::command]
pub async fn best_moments(storage: State<'_, Arc<SessionStorage>>, week_start: String) -> Result<Vec<Moment>, String> {
    failed(with_storage(&storage, move |db| db.best_moments(&week_start)).await.map_err(|_| ()))
}
