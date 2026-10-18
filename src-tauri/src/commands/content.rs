//! Local file import and database maintenance, M16.3 and M16.9.
use crate::storage::database::content_packs::{basics, StoredContentPack, MAX_PACK_BYTES};
use crate::{with_storage, SessionStorage};
use std::{io::Read, sync::Arc};
use tauri::State;

/// First call opens the native dialog and returns bounded UTF-8 text. The IPC
/// client strictly validates every item with Zod, then calls with that text to
/// store it. Rust checks the envelope again on both calls. Cancel returns None.
#[tauri::command]
pub async fn import_content_pack(
    app: tauri::AppHandle,
    storage: State<'_, Arc<SessionStorage>>,
    json: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    with_storage(&storage, move |db| {
        if let Some(raw) = json {
            db.import_content_pack(&raw)?;
            return Ok(Some(raw));
        }
        let picked = app
            .dialog()
            .file()
            .set_title("Import a content pack")
            .add_filter("Content pack (.cppack.json)", &["cppack.json"])
            .blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .and_then(|f| f.take(MAX_PACK_BYTES as u64 + 1).read_to_end(&mut bytes))
            .map_err(|_| "That file could not be read.")?;
        let raw = String::from_utf8(bytes).map_err(|_| "Content packs must be UTF-8 text.")?;
        basics(&raw)?;
        Ok(Some(raw))
    })
    .await
    .map_err(|_| "Content import failed.".to_string())?
}
#[tauri::command]
pub async fn list_content_packs(
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<Vec<StoredContentPack>, String> {
    with_storage(&storage, |db| db.list_content_packs())
        .await
        .map_err(|_| "Content storage failed.".to_string())?
}
#[tauri::command]
pub async fn remove_content_pack(
    storage: State<'_, Arc<SessionStorage>>,
    id: String,
) -> Result<(), String> {
    with_storage(&storage, move |db| db.remove_content_pack(&id))
        .await
        .map_err(|_| "Content storage failed.".to_string())?
}
#[tauri::command]
pub async fn get_database_health(
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<crate::storage::database::maintenance::DatabaseHealth, String> {
    with_storage(&storage, |db| db.database_health())
        .await
        .map_err(|_| "Database health is unavailable.".to_string())?
}
#[tauri::command]
pub async fn dismiss_database_compaction(
    storage: State<'_, Arc<SessionStorage>>,
) -> Result<(), String> {
    with_storage(&storage, |db| db.dismiss_database_compaction())
        .await
        .map_err(|_| "Database health is unavailable.".to_string())?
}
#[tauri::command]
pub async fn compact_database(
    storage: State<'_, Arc<SessionStorage>>,
    capture: State<'_, Arc<crate::audio::capture::CaptureService>>,
) -> Result<(), String> {
    let capture = capture.inner().clone();
    with_storage(&storage, move |db| {
        capture.while_idle(|| db.compact_database())
    })
    .await
    .map_err(|_| "Database compaction failed.".to_string())?
}
