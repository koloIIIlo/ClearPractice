//! Real world (roadmap M14): missions, events and their plans, talks and
//! rehearsal reports, the monthly time capsule, and listener packs. A pack is
//! written to a file you choose and answers are read from a file you choose;
//! nothing here sends anything (A-32).
use crate::listener_pack;
use crate::storage::database::events::{CapsuleOffer, Event, EventInput, EventView, MissionPick, PlanItemInput, RehearsalReport, TalkInput, TalkView};
use crate::storage::database::listener::{ListenerFeedback, ListenerImport, ListenerPack, NewPack};
use crate::{with_storage, SessionStorage};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::State;

fn failed<T>(result: Result<Result<T, String>, ()>) -> Result<T, String> {
    result.map_err(|_| "Session storage failed.".to_string())?
}

/// Picks this week's mission (14.1), or skips the week with no mission.
#[tauri::command]
pub async fn pick_mission(storage: State<'_, Arc<SessionStorage>>, week: String, mission_id: Option<String>) -> Result<MissionPick, String> {
    failed(with_storage(&storage, move |db| db.pick_mission(&week, mission_id.as_deref())).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn get_mission_pick(storage: State<'_, Arc<SessionStorage>>, week: String) -> Result<Option<MissionPick>, String> {
    failed(with_storage(&storage, move |db| db.mission_pick(&week)).await.map_err(|_| ()))
}

/// Takes back this week's pick or skip; a done week stays.
#[tauri::command]
pub async fn clear_mission(storage: State<'_, Arc<SessionStorage>>, week: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.clear_mission(&week)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn save_event(storage: State<'_, Arc<SessionStorage>>, input: EventInput) -> Result<Event, String> {
    failed(with_storage(&storage, move |db| db.save_event(&input)).await.map_err(|_| ()))
}

/// Replaces the plan items that are not done (14.2); done ones stay.
#[tauri::command]
pub async fn save_event_plan(storage: State<'_, Arc<SessionStorage>>, event_id: String, items: Vec<PlanItemInput>) -> Result<EventView, String> {
    failed(with_storage(&storage, move |db| db.save_event_plan(&event_id, &items)).await.map_err(|_| ()))
}

/// Ticks or unticks a plan item by hand; it no longer ticks itself.
#[tauri::command]
pub async fn set_plan_item_done(storage: State<'_, Arc<SessionStorage>>, item_id: String, done: bool) -> Result<EventView, String> {
    failed(with_storage(&storage, move |db| db.set_plan_item_done(&item_id, done)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn link_event_talk(storage: State<'_, Arc<SessionStorage>>, event_id: String, talk_id: String) -> Result<EventView, String> {
    failed(with_storage(&storage, move |db| db.link_event_talk(&event_id, &talk_id)).await.map_err(|_| ()))
}

/// An event with its plan, brought up to date with the work you did.
#[tauri::command]
pub async fn get_event(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<EventView, String> {
    failed(with_storage(&storage, move |db| db.get_event(&id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_events(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<EventView>, String> {
    failed(with_storage(&storage, move |db| db.list_events()).await.map_err(|_| ()))
}

/// Deletes an event softly; its talk and rehearsal takes stay.
#[tauri::command]
pub async fn delete_event(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.delete_event(&id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn save_talk(storage: State<'_, Arc<SessionStorage>>, input: TalkInput) -> Result<TalkView, String> {
    failed(with_storage(&storage, move |db| db.save_talk(&input)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn get_talk(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<TalkView, String> {
    failed(with_storage(&storage, move |db| db.get_talk(&id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_talks(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<TalkView>, String> {
    failed(with_storage(&storage, move |db| db.list_talks()).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn delete_talk(storage: State<'_, Arc<SessionStorage>>, id: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.delete_talk(&id)).await.map_err(|_| ()))
}

/// Links a saved rehearsal take to its talk with a snapshot of the sections (14.3).
#[tauri::command]
pub async fn record_rehearsal(storage: State<'_, Arc<SessionStorage>>, talk_id: String, attempt_id: String) -> Result<RehearsalReport, String> {
    failed(with_storage(&storage, move |db| db.record_rehearsal(&talk_id, &attempt_id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn rehearsal_report(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<RehearsalReport, String> {
    failed(with_storage(&storage, move |db| db.rehearsal_report(&attempt_id)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_rehearsals(storage: State<'_, Arc<SessionStorage>>, talk_id: String) -> Result<Vec<RehearsalReport>, String> {
    failed(with_storage(&storage, move |db| db.list_rehearsals(&talk_id)).await.map_err(|_| ()))
}

/// This month's time capsule (14.5); the first call in a month starts its week on offer.
#[tauri::command]
pub async fn capsule_offer(storage: State<'_, Arc<SessionStorage>>, today: String) -> Result<CapsuleOffer, String> {
    failed(with_storage(&storage, move |db| db.capsule_offer(&today)).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn dismiss_capsule(storage: State<'_, Arc<SessionStorage>>, month: String) -> Result<(), String> {
    failed(with_storage(&storage, move |db| db.dismiss_capsule(&month)).await.map_err(|_| ()))
}

/// Saves a listener pack for one take (14.4) where you choose: the page, the
/// take as 16 kHz mono audio, the questions and, only if you ask, the
/// transcript. Returns None when you cancel the dialog.
#[tauri::command]
pub async fn export_listener_pack(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    attempt_id: String,
    questions: Vec<String>,
    from: String,
    include_transcript: bool,
) -> Result<Option<ListenerPack>, String> {
    use tauri_plugin_dialog::DialogExt;
    let questions = listener_pack::clean_questions(&questions)?;
    let from = listener_pack::clean_name(&from)?;
    failed(
        with_storage(&storage, move |db| {
            let source = db.listener_pack_source(&attempt_id)?;
            let transcript = match include_transcript {
                true => Some(source.transcript.clone().ok_or("This take has no transcript to include yet.")?),
                false => None,
            };
            let picked = app
                .dialog()
                .file()
                .set_title("Save the pack for a listener")
                .set_file_name(listener_pack::suggested_file_name(&source.title))
                .add_filter("ZIP archive", &["zip"])
                .blocking_save_file();
            let Some(target) = picked.and_then(|p| p.into_path().ok()) else {
                return Ok(None);
            };
            let audio = crate::audio::prepare::prepare(db.root(), &source.asset_id, &AtomicBool::new(false))?;
            let wav = crate::audio::prepare::prepared_path(db.root(), &audio)?;
            let id = db.new_listener_pack_id()?;
            let now = crate::storage::recording::now_ms() as i64;
            let created_at = chrono::DateTime::from_timestamp_millis(now).unwrap_or_default().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let manifest = listener_pack::PackManifest { format: listener_pack::PACK_FORMAT, version: 1, pack_id: id.clone(), questions: questions.clone(), from: from.clone(), created_at };
            let minutes = u32::try_from(((source.duration_ms + 30_000) / 60_000).max(1)).unwrap_or(1);
            let html = listener_pack::listen_html(&id, &questions, &from, minutes, transcript.as_deref());
            listener_pack::write_pack(&target, &manifest, &html, &wav, transcript.as_deref())?;
            db.save_listener_pack(&NewPack { id: &id, attempt_id: &attempt_id, questions: &questions, from: &from, include_transcript, created_at_ms: now }).map(Some)
        })
        .await
        .map_err(|_| ()),
    )
}

/// Imports a listener's answer file you choose (at most 64 KB), checked
/// strictly; the same file a second time changes nothing. None when you cancel.
#[tauri::command]
pub async fn import_listener_answers(app: tauri::AppHandle, storage: State<'_, Arc<SessionStorage>>) -> Result<Option<ListenerImport>, String> {
    use tauri_plugin_dialog::DialogExt;
    failed(
        with_storage(&storage, move |db| {
            // Browsers name a second download "answers.cpanswer (1).json", so the filter is .json.
            let picked = app.dialog().file().set_title("Import a listener's answers").add_filter("Listener's answers (.cpanswer.json)", &["json"]).blocking_pick_file();
            let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
                return Ok(None);
            };
            let mut bytes = Vec::new();
            std::fs::File::open(&path)
                .and_then(|f| f.take(listener_pack::MAX_ANSWER_FILE_BYTES as u64 + 1).read_to_end(&mut bytes))
                .map_err(|_| "That file could not be read.")?;
            let answers = listener_pack::parse_answers(&bytes)?;
            let sha = format!("{:x}", Sha256::digest(&bytes));
            db.import_listener_answers(&answers, &sha).map(Some)
        })
        .await
        .map_err(|_| ()),
    )
}

#[tauri::command]
pub async fn list_listener_packs(storage: State<'_, Arc<SessionStorage>>, session_id: Option<String>) -> Result<Vec<ListenerPack>, String> {
    failed(with_storage(&storage, move |db| db.list_listener_packs(session_id.as_deref())).await.map_err(|_| ()))
}

#[tauri::command]
pub async fn list_listener_feedback(storage: State<'_, Arc<SessionStorage>>, session_id: Option<String>) -> Result<Vec<ListenerFeedback>, String> {
    failed(with_storage(&storage, move |db| db.list_listener_feedback(session_id.as_deref())).await.map_err(|_| ()))
}

/// Whether the listener got your main point: your judgement (Your note).
#[tauri::command]
pub async fn set_listener_judgement(storage: State<'_, Arc<SessionStorage>>, feedback_id: String, understood: Option<bool>) -> Result<ListenerFeedback, String> {
    failed(with_storage(&storage, move |db| db.set_listener_judgement(&feedback_id, understood)).await.map_err(|_| ()))
}
