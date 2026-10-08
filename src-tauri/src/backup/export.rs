//! Readable session export (§13, plan 2.22): one ZIP with the session as
//! Markdown, measurements as CSV, the original WAV of every available take,
//! and a JSON manifest with checksums. Any program can read it.
use super::{add_file, hex, io_error, Entry, Result};
use crate::storage::database::DatabaseOwner;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub file_name: String,
    pub recordings: usize,
    pub unavailable_recordings: usize,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportManifest<'a> {
    format: &'a str,
    format_version: u32,
    app_version: &'a str,
    exported_at_ms: u64,
    session_id: &'a str,
    entries: Vec<Entry>,
    unavailable_recordings: Vec<String>,
}

/// File-name-safe version of a session title for the suggested export name.
pub fn suggested_name(title: &str, local_date: &str) -> String {
    let mut safe: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    safe.truncate(safe.char_indices().nth(60).map_or(safe.len(), |(i, _)| i));
    if safe.is_empty() {
        safe = "Session".into();
    }
    format!("{safe} {local_date}.zip")
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn csv(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.into()
    }
}

fn markdown(session: &Value) -> String {
    let mut md = format!("# {}\n\n", text(&session["title"]));
    md += &format!("- Date: {}\n", text(&session["localDate"]));
    if let Some(kind) = session["exerciseType"].as_str() {
        md += &format!("- Exercise: {kind}\n");
    }
    let tags: Vec<&str> = session["tags"].as_array().map_or(vec![], |t| t.iter().filter_map(Value::as_str).collect());
    if !tags.is_empty() {
        md += &format!("- Tags: {}\n", tags.join(", "));
    }
    if !text(&session["prompt"]).is_empty() {
        md += &format!("\n## Prompt\n\n{}\n", text(&session["prompt"]));
    }
    let outline = &session["outline"];
    if ["point", "reason", "example"].iter().any(|k| !text(&outline[k]).is_empty()) {
        md += &format!(
            "\n## Outline\n\n- Point: {}\n- Reason: {}\n- Example: {}\n",
            text(&outline["point"]),
            text(&outline["reason"]),
            text(&outline["example"])
        );
    }
    let c = &session["conditions"];
    md += "\n## Task conditions\n\n";
    if c.is_null() {
        md += &format!("Unavailable: {}\n", text(&session["conditionsUnavailableReason"]));
    } else {
        md += &format!(
            "- Familiarity: {}\n- Preparation: {} s\n- Target length: {} s\n",
            text(&c["familiarity"]),
            c["preparationSeconds"],
            c["targetSeconds"]
        );
        if let Some(audience) = c["audience"].as_str() {
            md += &format!("- Audience: {audience}\n");
        }
    }
    md += "\n## Takes\n\n| Take | Duration (Measured) | Audio |\n| --- | --- | --- |\n";
    for a in session["attempts"].as_array().into_iter().flatten() {
        let seconds = a["durationMs"].as_i64().unwrap_or(0) as f64 / 1000.0;
        let audio = match a["audioUnavailableReason"].as_str() {
            Some(reason) => format!("Unavailable: {reason}"),
            None => format!("take-{}.wav", a["ordinal"]),
        };
        md += &format!("| {} | {seconds:.1} s | {audio} |\n", a["ordinal"]);
    }
    let notes = text(&session["notes"]);
    md += &format!("\n## Your note\n\n{}\n", if notes.is_empty() { "(none)" } else { notes });
    md += "\n## Transcript\n\nNot available yet: transcription is not connected to saved sessions in this version.\n";
    md
}

fn measures(session: &Value) -> String {
    let mut out = String::from("take,created_at,duration_ms,duration_source,audio_available,unavailable_reason\n");
    for a in session["attempts"].as_array().into_iter().flatten() {
        let reason = text(&a["audioUnavailableReason"]);
        out += &format!(
            "{},{},{},Measured,{},{}\n",
            a["ordinal"],
            csv(text(&a["createdAt"])),
            a["durationMs"].as_i64().unwrap_or(0),
            reason.is_empty(),
            csv(reason)
        );
    }
    out
}

fn add_bytes<W: Write + std::io::Seek>(zip: &mut ZipWriter<W>, name: &str, bytes: &[u8]) -> Result<Entry> {
    zip.start_file(name, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
        .map_err(|e| e.to_string())?;
    zip.write_all(bytes).map_err(io_error)?;
    Ok(Entry { path: name.into(), bytes: bytes.len() as u64, sha256: hex(Sha256::new_with_prefix(bytes)) })
}

/// Writes the export next to `target` as `.partial`, then renames it into place.
/// Audio is read only after its committed checksum is verified.
pub fn export_session(owner: &DatabaseOwner, session_id: &str, target: &Path, now_ms: u64) -> Result<ExportSummary> {
    let session = owner.get_session(session_id)?;
    let parent = target.parent().filter(|p| p.is_dir()).ok_or("The export folder is unavailable.")?;
    let file_name = target.file_name().ok_or("Choose a file name for the export.")?.to_string_lossy().into_owned();
    let partial = parent.join(format!("{file_name}.partial"));
    let result = (|| {
        let file = File::create(&partial).map_err(io_error)?;
        let mut zip = ZipWriter::new(BufWriter::with_capacity(1 << 16, file));
        let mut entries = vec![
            add_bytes(&mut zip, "session.md", markdown(&session).as_bytes())?,
            add_bytes(&mut zip, "measures.csv", measures(&session).as_bytes())?,
        ];
        let mut unavailable = Vec::new();
        for a in session["attempts"].as_array().into_iter().flatten() {
            let id = text(&a["id"]);
            let name = format!("take-{}.wav", a["ordinal"]);
            if a["audioUnavailableReason"].is_string() {
                unavailable.push(name);
                continue;
            }
            let saved = owner.checked_recording(id)?;
            let audio = owner.playback_path(id)?;
            let entry = add_file(&mut zip, &name, &audio, CompressionMethod::Stored)?;
            if entry.sha256 != saved.sha256 {
                return Err(format!("Take {} changed while exporting. Nothing was exported.", a["ordinal"]));
            }
            entries.push(entry);
        }
        let recordings = entries.len() - 2;
        let manifest = ExportManifest {
            format: "clearpractice-session-export",
            format_version: 1,
            app_version: env!("CARGO_PKG_VERSION"),
            exported_at_ms: now_ms,
            session_id,
            entries,
            unavailable_recordings: unavailable.clone(),
        };
        let manifest = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
        add_bytes(&mut zip, "manifest.json", &manifest)?;
        let file = zip
            .finish()
            .map_err(|e| e.to_string())?
            .into_inner()
            .map_err(|e| io_error(e.into_error()))?;
        file.sync_all().map_err(io_error)?;
        drop(file);
        if target.exists() {
            fs::remove_file(target).map_err(io_error)?;
        }
        fs::rename(&partial, target).map_err(io_error)?;
        Ok(ExportSummary {
            file_name,
            recordings,
            unavailable_recordings: unavailable.len(),
            bytes: fs::metadata(target).map_err(io_error)?.len(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}
