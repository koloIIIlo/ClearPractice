//! Local small-text commands. Targets come from native preferences, never the UI.
use crate::{api::{coaching::{Binding, ClipName, CoachingModel, PhraseSuggestion, Preview, PreviewOwner}, local_llm::{self, LocalTarget}}, clips, clipsplit, preferences, with_storage, SessionStorage};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::State;

type Result<T> = std::result::Result<T, String>;

fn target(storage: &SessionStorage) -> Result<LocalTarget> {
    storage.with(|db| {
        let prefs = preferences::load(db)?;
        if prefs.coaching_mode != "local" {
            return Err("Coaching is no longer set to the local model. Preview the request again.".into());
        }
        Ok(LocalTarget { base: local_llm::validate_endpoint(&prefs.local_endpoint)?, model: prefs.local_model })
    })
}

fn picks_binding(staging_id: &str, segments: &[(String, u64, u64)]) -> Result<Binding> {
    let bytes = serde_json::to_vec(segments).map_err(|_| "Cannot verify the source transcript.")?;
    Ok(Binding { owner: staging_id.into(), revisions: vec![format!("{:x}", Sha256::digest(bytes))] })
}

#[tauri::command]
pub async fn preview_phrase_suggestions_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, session_ids: Vec<String>, model: Option<CoachingModel>) -> Result<Preview> {
    let local = target(&storage)?;
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        if session_ids.is_empty() || session_ids.len() > 12 { return Err("Choose between 1 and 12 transcribed sessions.".into()); }
        let mut sessions = Vec::new();
        for id in &session_ids {
            let detail = db.get_session(id)?;
            let texts: Vec<String> = detail["attempts"].as_array().into_iter().flatten()
                .filter_map(|a| a["id"].as_str())
                .filter_map(|id| db.take_coaching_input(id).ok().map(|input| input.text)).collect();
            if !texts.is_empty() { sessions.push((detail["title"].as_str().unwrap_or("Session").to_string(), texts.join("\n"))); }
        }
        if sessions.is_empty() { return Err("None of these sessions has a transcript yet. Transcribe them first.".into()); }
        owner.preview_phrase_suggestions_with_target(&sessions, model.unwrap_or_default(), Some(local))
    }).await.map_err(|_| "Preparing the request failed.".to_string())?
}

#[tauri::command]
pub async fn send_phrase_suggestions_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, request_id: String, payload_sha256: String) -> Result<Vec<PhraseSuggestion>> {
    owner.ensure_local_target(&request_id, &target(&storage)?)?;
    owner.send_phrase_suggestions_local(&request_id, &payload_sha256).await
}

#[tauri::command]
pub fn preview_clip_names_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, texts: Vec<String>, model: Option<CoachingModel>) -> Result<Preview> {
    owner.preview_clip_names_with_target(&texts, model.unwrap_or_default(), Some(target(&storage)?))
}

#[tauri::command]
pub async fn send_clip_names_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, request_id: String, payload_sha256: String) -> Result<Vec<ClipName>> {
    owner.ensure_local_target(&request_id, &target(&storage)?)?;
    owner.send_clip_names_local(&request_id, &payload_sha256).await
}

#[tauri::command]
pub async fn preview_clip_picks_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, staging_id: String, model: Option<CoachingModel>, tone_hint: bool, wanted: usize) -> Result<Preview> {
    let local = target(&storage)?;
    let owner = owner.inner().clone();
    let root = storage.with(|db| Ok(db.root().to_path_buf()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (sentences, annotated) = clipsplit::annotate_staged(&root, &staging_id)?;
        let segments = clipsplit::load_segments(&root, &staging_id)?;
        let preview = owner.preview_clip_picks_with_target(&annotated, sentences.len(), wanted, model.unwrap_or_default(), tone_hint, Some(local))?;
        owner.bind_small_text(&preview.request_id, picks_binding(&staging_id, &segments)?)?;
        Ok(preview)
    }).await.map_err(|_| "Preview failed.".to_string())?
}

#[tauri::command]
pub async fn send_clip_picks_local(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, staging_id: String, request_id: String, payload_sha256: String) -> Result<Vec<clipsplit::PickedClip>> {
    owner.ensure_local_target(&request_id, &target(&storage)?)?;
    let source = staging_id.clone();
    let segments = with_storage(&storage, move |db| clipsplit::load_segments(db.root(), &source)).await.map_err(|_| "Session storage failed.".to_string())??;
    owner.ensure_small_text_binding(&request_id, &picks_binding(&staging_id, &segments)?)?;
    let (model, tone_hint, picks) = owner.send_clip_picks_local(&request_id, &payload_sha256, segments.len()).await?;
    let chosen = clipsplit::picks_to_clips(&segments, &picks);
    if chosen.is_empty() { return Err("The AI's passages did not fit the clip rules (5–30 s, whole sentences, no overlaps). The automatic proposals are unchanged.".into()); }
    let kept = chosen.clone();
    with_storage(&storage, move |db| {
        if let Some(source) = clips::read_meta(db.root(), &staging_id)?.source_id { db.insert_pick_run(&source, &model, tone_hint, &kept)?; }
        Ok(())
    }).await.map_err(|_| "Saving AI choices failed.".to_string())??;
    Ok(chosen)
}
