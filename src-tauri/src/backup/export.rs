//! Readable session export (§13, plan 2.22): one ZIP with the session as
//! Markdown, measurements as CSV, the original WAV of every available take,
//! structured session data as JSON, and a manifest with checksums. Any program
//! can read it.
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

/// What one take adds to the export: its transcript view (with measures) and
/// its latest AI feedback, both as the app shows them.
#[derive(Serialize)]
struct TakeDetail {
    ordinal: i64,
    transcript: Value,
    feedback: Option<Value>,
}

fn take_section(d: &TakeDetail) -> String {
    let mut md = format!("\n### Take {}\n\n", d.ordinal);
    let revision = &d.transcript["revision"];
    if revision.is_null() {
        md += "Not transcribed.\n";
        return md;
    }
    let by = if text(&revision["source"]) == "api" { format!("cloud, {} {}", text(&revision["provider"]), text(&revision["modelId"])) } else { format!("this computer, {}", text(&revision["modelId"])) };
    md += &format!("**As transcribed** ({by}; Estimated):\n\n> {}\n", text(&revision["text"]));
    if let Some(correction) = d.transcript["correction"]["text"].as_str() {
        md += &format!("\n**Your correction** (Your note):\n\n> {correction}\n");
    }
    let m = &revision["measures"];
    let pace = m["paceWpm"].as_f64().map_or_else(|| format!("pace unavailable ({})", text(&m["paceUnavailableReason"])), |p| format!("{p:.0} words per minute"));
    let pauses = m["voice"]["pauses"].as_array().or_else(|| m["pauses"].as_array()).map_or("pauses unavailable".to_string(), |p| format!("{} pauses over 0.7 s", p.len()));
    let fillers = m["fillers"].as_array().cloned().unwrap_or_default();
    let confirmed = fillers.iter().filter(|f| f["decision"] == "confirmed").count();
    let dismissed = fillers.iter().filter(|f| f["decision"] == "dismissed").count();
    md += &format!("\nMeasures (Estimated): {} words · {pace} · {pauses} · {} filler candidates ({confirmed} confirmed, {dismissed} dismissed by you)\n", m["wordCount"], fillers.len());
    if let Some(f) = &d.feedback {
        let fb = &f["feedback"];
        md += &format!("\n**AI feedback** (AI suggestion; {} on {}):\n\n{}\n\n- One improvement: {}\n- Next attempt: {}\n", text(&f["model"]), text(&f["createdAt"]).get(..10).unwrap_or(""), text(&fb["summary"]), text(&fb["oneImprovement"]), text(&fb["nextAttempt"]));
        for c in fb["corrections"].as_array().into_iter().flatten() {
            md += &format!("- {}: “{}” → “{}”. {}\n", if text(&c["kind"]) == "style" { "Optional style" } else { "Clear error" }, text(&c["quote"]), text(&c["suggestion"]), text(&c["reason"]));
        }
        for p in fb["phrases"].as_array().into_iter().flatten() {
            md += &format!("- Phrase you could use: “{}”{}\n", text(&p["expression"]), if text(&p["instead"]).is_empty() { String::new() } else { format!(" instead of “{}”", text(&p["instead"])) });
        }
        for n in fb["deliveryNotes"].as_array().into_iter().flatten() {
            md += &format!("- How part {} may come across: {}\n", n["part"], text(&n["note"]));
        }
    }
    md
}

fn markdown(session: &Value, details: &[TakeDetail]) -> String {
    let mut md = format!("# {}\n\n", text(&session["title"]));
    md += &format!("- Date: {}\n", text(&session["localDate"]));
    if let Some(focus) = session["focus"].as_str() {
        md += &format!("- Your focus: {focus}\n");
    }
    if let Some(ease) = session["ease"].as_i64() {
        md += &format!("- How easy it felt (your rating, not a score): {ease} of 5\n");
    }
    if let Some(takeaway) = session["takeaway"].as_str() {
        md += &format!("- Keep for next time: {takeaway}\n");
    }
    match session["preferredTake"].as_str() {
        Some("same") => md += "- Which take felt clearer: about the same\n",
        Some(id) => {
            let ordinal = session["attempts"].as_array().into_iter().flatten().find(|a| a["id"] == id).map(|a| a["ordinal"].to_string());
            if let Some(n) = ordinal {
                md += &format!("- Which take felt clearer: take {n}\n");
            }
        }
        None => {}
    }
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
    md += "\n## Takes in detail\n";
    for d in details {
        md += &take_section(d);
    }
    md
}

/// One row per take. Empty means unavailable (never 0); the reason column says why.
fn measures(session: &Value, details: &[TakeDetail]) -> String {
    let mut out = String::from("take,created_at,duration_ms,duration_source,audio_available,unavailable_reason,words,pace_wpm,pace_unavailable_reason,pauses_over_700ms,filler_candidates,transcript_source\n");
    for (a, d) in session["attempts"].as_array().into_iter().flatten().zip(details) {
        let reason = text(&a["audioUnavailableReason"]);
        let r = &d.transcript["revision"];
        let m = &r["measures"];
        let opt = |v: Option<String>| v.unwrap_or_default();
        out += &format!(
            "{},{},{},Measured,{},{},{},{},{},{},{},{}\n",
            a["ordinal"],
            csv(text(&a["createdAt"])),
            a["durationMs"].as_i64().unwrap_or(0),
            reason.is_empty(),
            csv(reason),
            opt(m["wordCount"].as_u64().map(|v| v.to_string())),
            opt(m["paceWpm"].as_f64().map(|v| format!("{v:.0}"))),
            csv(if r.is_null() { "not transcribed" } else { text(&m["paceUnavailableReason"]) }),
            opt(m["voice"]["pauses"].as_array().or_else(|| m["pauses"].as_array()).map(|p| p.len().to_string()).filter(|_| !r.is_null())),
            opt(m["fillers"].as_array().map(|f| f.len().to_string())),
            csv(text(&r["source"]))
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
        let details: Vec<TakeDetail> = session["attempts"].as_array().into_iter().flatten().map(|a| {
            let id = text(&a["id"]);
            TakeDetail {
                ordinal: a["ordinal"].as_i64().unwrap_or(0),
                transcript: owner.attempt_transcript_with_voice(id).unwrap_or(Value::Null),
                feedback: owner.list_coaching_runs(id).ok().and_then(|runs| runs.into_iter().next()).and_then(|run| serde_json::to_value(run).ok()),
            }
        }).collect();
        let mut entries = vec![
            add_bytes(&mut zip, "session.md", markdown(&session, &details).as_bytes())?,
            add_bytes(&mut zip, "measures.csv", measures(&session, &details).as_bytes())?,
        ];
        let structured = serde_json::json!({
            "format": "clearpractice-session-data",
            "formatVersion": 1,
            "session": session,
            "takes": details,
            "tables": owner.session_export_tables(session_id)?,
            "provenance": {
                "audio_measures": "Estimated", "phrase_uses": "Estimated",
                "activity_results": "Estimated", "rehearsals": "Estimated",
                "self_checks": "Your note", "self_predictions": "Your note",
                "segment_marks": "Your note", "comparisons": "Your note",
                "listener_feedback": "Your note", "upgrade_runs": "AI suggestion",
                "conversation_feedback": "AI suggestion"
            }
        });
        entries.push(add_bytes(&mut zip, "session.json", &serde_json::to_vec_pretty(&structured).map_err(|e| e.to_string())?)?);
        let mut unavailable = Vec::new();
        let mut recordings = 0;
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
            recordings += 1;
        }
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
