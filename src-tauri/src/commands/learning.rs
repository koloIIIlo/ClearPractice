//! The learning engine (roadmap M11): guesses before the measures, guided
//! programmes, Catch it runs and skipped re-answers.
use crate::storage::database::learning::{CatchRun, Prediction, ProgrammeRun};
use crate::{with_storage, SessionStorage};
use std::sync::Arc;
use tauri::State;

fn failed<T>(result: Result<Result<T, String>, ()>) -> Result<T, String> {
    result.map_err(|_| "Session storage failed.".to_string())?
}

/// Your guess for one kind (hesitations or pace); the first guess stands.
#[tauri::command]
pub async fn set_prediction(storage: State<'_, Arc<SessionStorage>>, attempt_id: String, kind: String, predicted: String) -> Result<bool, String> {
    failed(with_storage(&storage, move |db| db.set_prediction(&attempt_id, &kind, &predicted)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_predictions(storage: State<'_, Arc<SessionStorage>>, from: Option<String>) -> Result<Vec<Prediction>, String> {
    failed(with_storage(&storage, move |db| db.list_predictions(from.as_deref())).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn get_programme_state(storage: State<'_, Arc<SessionStorage>>) -> Result<Option<ProgrammeRun>, String> {
    failed(with_storage(&storage, move |db| db.programme_state()).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn start_programme(storage: State<'_, Arc<SessionStorage>>, programme: String) -> Result<ProgrammeRun, String> {
    failed(with_storage(&storage, move |db| db.start_programme(&programme)).await.map_err(|_| ()))
}

/// A step done, detected or ticked by you; recorded once.
#[tauri::command]
pub async fn complete_programme_step(storage: State<'_, Arc<SessionStorage>>, programme_id: String, step_id: String, ref_id: Option<String>) -> Result<bool, String> {
    failed(with_storage(&storage, move |db| db.complete_programme_step(&programme_id, &step_id, ref_id.as_deref())).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn set_programme_week(storage: State<'_, Arc<SessionStorage>>, programme_id: String, week: u32, finished: bool) -> Result<ProgrammeRun, String> {
    failed(with_storage(&storage, move |db| db.set_programme_week(&programme_id, week, finished)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn stop_programme(storage: State<'_, Arc<SessionStorage>>, programme_id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.stop_programme(&programme_id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn save_catch_run(storage: State<'_, Arc<SessionStorage>>, attempt_id: String, presses: Vec<u64>, caught: u32, total: u32) -> Result<CatchRun, String> {
    failed(with_storage(&storage, move |db| db.save_catch_run(&attempt_id, &presses, caught, total)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_catch_runs(storage: State<'_, Arc<SessionStorage>>, attempt_id: Option<String>) -> Result<Vec<CatchRun>, String> {
    failed(with_storage(&storage, move |db| db.list_catch_runs(attempt_id.as_deref())).await.map_err(|_| ()))
}

/// "Not this one" on a re-answer: it won't come back.
#[tauri::command]
pub async fn skip_reanswer(storage: State<'_, Arc<SessionStorage>>, prompt_id: String, step: u32) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.skip_reanswer(&prompt_id, step)).await.map_err(|_| ()))
}
