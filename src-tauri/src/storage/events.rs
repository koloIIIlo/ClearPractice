//! Real world (roadmap M14): missions you pick each week (14.1), events you
//! prepare for with a spaced plan (14.2), talks and their rehearsals (14.3) and
//! the monthly time capsule (14.5). Events, talks and missions are your own
//! content and are deleted softly; a rehearsal goes with its take. Plan items
//! tick themselves when their work appears, unless you set them by hand.
use super::{db_error, iso, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const EVENT_KINDS: [&str; 6] = ["talk", "interview", "meeting", "toast", "pitch", "other"];
pub const ITEM_KINDS: [&str; 7] = ["outline", "run_through", "qa_drill", "mock", "dress_rehearsal", "routine", "debrief"];
pub const MAX_PLAN_ITEMS: usize = 20;
pub const MAX_SECTIONS: usize = 20;
pub const MAX_KEYWORDS: usize = 3;
/// The exercise of every rehearsal session (14.3) and of the time capsule (14.5).
pub const REHEARSAL_EXERCISE: &str = "ex-rehearsal";
pub const CAPSULE_EXERCISE: &str = "ex-capsule";
/// The capsule stays on offer this many days from the day it is first offered in a month.
pub const CAPSULE_DAYS: i64 = 7;
/// A section shorter than this has no pace.
const MIN_PACE_MS: u64 = 5_000;

fn date(value: &str) -> Result<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Choose a day.".to_string())
}

fn key_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 96 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn one_line(text: &str, max: usize) -> Option<String> {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (t.chars().count() <= max && !t.chars().any(char::is_control)).then_some(t)
}

fn opt_iso(ms: Option<i64>) -> Option<String> {
    ms.map(iso)
}

/// A fresh ID free in `table`, lowercase so it can also travel in take marks.
fn fresh_id(conn: &Connection, table: &str, prefix: &str, taken: &HashSet<String>) -> Result<String> {
    let now = recording::now_ms();
    for n in 0..10_000u32 {
        let candidate = if n == 0 { format!("{prefix}-{now}") } else { format!("{prefix}-{now}-{n}") };
        if taken.contains(&candidate) {
            continue;
        }
        let exists: bool = conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [&candidate], |r| r.get(0)).map_err(db_error)?;
        if !exists {
            return Ok(candidate);
        }
    }
    Err("Could not create an ID.".into())
}

// ── Missions (14.1) ─────────────────────────────────────────────────────────

/// This week's mission, or the week skipped (no mission).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPick {
    pub week: String,
    pub mission_id: Option<String>,
    pub picked_at: String,
    pub review_id: Option<String>,
    pub done_at: Option<String>,
}

fn pick_row(r: &rusqlite::Row) -> rusqlite::Result<MissionPick> {
    Ok(MissionPick { week: r.get(0)?, mission_id: r.get(1)?, picked_at: iso(r.get(2)?), review_id: r.get(3)?, done_at: opt_iso(r.get(4)?) })
}

// ── Events (14.2) ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub kind: String,
    pub local_date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub minutes: Option<u32>,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub goal: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub local_date: String,
    pub start_time: Option<String>,
    pub minutes: Option<u32>,
    pub audience: String,
    pub goal: String,
    pub talk_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanItemInput {
    pub local_date: String,
    pub kind: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: String,
    pub position: u32,
    pub local_date: String,
    pub kind: String,
    pub title: String,
    pub done_at: Option<String>,
    /// The work that finished it: a rehearsal's take, a conversation, a boss session, a routine run or a review.
    pub ref_id: Option<String>,
    /// You set it by hand; it no longer ticks itself.
    pub by_hand: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventView {
    pub event: Event,
    pub items: Vec<PlanItem>,
    pub debrief_done: bool,
}

const EVENT_COLUMNS: &str = "id,title,kind,local_date,start_time,minutes,audience,goal,talk_id,created_at_ms";

fn event_row(r: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        title: r.get(1)?,
        kind: r.get(2)?,
        local_date: r.get(3)?,
        start_time: r.get(4)?,
        minutes: r.get(5)?,
        audience: r.get(6)?,
        goal: r.get(7)?,
        talk_id: r.get(8)?,
        created_at: iso(r.get(9)?),
    })
}

const ITEM_COLUMNS: &str = "id,position,local_date,kind,title,done_at_ms,ref_id,by_hand";

fn item_row(r: &rusqlite::Row) -> rusqlite::Result<PlanItem> {
    Ok(PlanItem {
        id: r.get(0)?,
        position: r.get(1)?,
        local_date: r.get(2)?,
        kind: r.get(3)?,
        title: r.get(4)?,
        done_at: opt_iso(r.get(5)?),
        ref_id: r.get(6)?,
        by_hand: r.get::<_, i64>(7)? == 1,
    })
}

fn load_event(conn: &Connection, id: &str) -> Result<Event> {
    recording::validate_id(id)?;
    conn.query_row(&format!("SELECT {EVENT_COLUMNS} FROM events WHERE id=?1 AND deleted_at_ms IS NULL"), [id], event_row)
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "This event no longer exists.".into())
}

fn load_items(conn: &Connection, event_id: &str) -> Result<Vec<PlanItem>> {
    let mut stmt = conn.prepare(&format!("SELECT {ITEM_COLUMNS} FROM event_plan_items WHERE event_id=?1 ORDER BY position")).map_err(db_error)?;
    let rows = stmt.query_map([event_id], item_row).map_err(db_error)?;
    rows.collect::<rusqlite::Result<_>>().map_err(db_error)
}

fn ids(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(sql).map_err(db_error)?;
    let rows = stmt.query_map(params, |r| r.get::<_, String>(0)).map_err(db_error)?;
    rows.collect::<rusqlite::Result<_>>().map_err(db_error)
}

/// Ticks the plan items whose work has appeared (14.2), each piece of work
/// used once, in plan order. Items you set by hand are left as you set them.
fn refresh_items(conn: &Connection, event: &Event) -> Result<()> {
    let items = load_items(conn, &event.id)?;
    let mut used: HashSet<String> = items.iter().filter_map(|i| i.ref_id.clone()).collect();
    let now = recording::now_ms() as i64;
    for item in items.iter().filter(|i| i.done_at.is_none() && !i.by_hand) {
        let candidates: Vec<String> = match item.kind.as_str() {
            "outline" => match &event.talk_id {
                Some(talk) => ids(conn, "SELECT t.id FROM talks t WHERE t.id=?1 AND t.deleted_at_ms IS NULL AND EXISTS(SELECT 1 FROM talk_sections s WHERE s.talk_id=t.id AND s.deleted_at_ms IS NULL)", [talk])?,
                None => Vec::new(),
            },
            "run_through" | "dress_rehearsal" => match &event.talk_id {
                Some(talk) => ids(
                    conn,
                    "SELECT r.attempt_id FROM rehearsals r JOIN attempts a ON a.id=r.attempt_id JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
                     WHERE r.talk_id=?1 AND s.local_date>=?2 AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL ORDER BY s.local_date,r.created_at_ms,r.id",
                    params![talk, item.local_date],
                )?,
                None => Vec::new(),
            },
            "qa_drill" => ids(
                conn,
                "SELECT id FROM (SELECT c.id AS id,s.local_date AS day,c.started_at_ms AS at FROM conversations c JOIN sessions s ON s.id=c.session_id \
                   WHERE c.scenario_id='qa-panel' AND s.local_date>=?1 AND s.deleted_at_ms IS NULL \
                 UNION ALL SELECT s.id,s.local_date,s.started_at_ms FROM sessions s JOIN session_steps st ON st.session_id=s.id \
                   JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version \
                   WHERE e.type='boss' AND s.local_date>=?1 AND s.deleted_at_ms IS NULL \
                   AND EXISTS(SELECT 1 FROM attempts a WHERE a.step_id=st.id AND a.capture_state='saved' AND a.deleted_at_ms IS NULL)) ORDER BY day,at,id",
                [&item.local_date],
            )?,
            "mock" => ids(
                conn,
                "SELECT c.id FROM conversations c JOIN sessions s ON s.id=c.session_id WHERE c.scenario_id<>'qa-panel' AND s.local_date>=?1 AND s.deleted_at_ms IS NULL ORDER BY s.local_date,c.started_at_ms,c.id",
                [&item.local_date],
            )?,
            "routine" => ids(conn, "SELECT id FROM routine_runs WHERE event_id=?1 AND deleted_at_ms IS NULL ORDER BY created_at_ms,id", [&event.id])?,
            "debrief" => ids(conn, "SELECT id FROM transfer_reviews WHERE event_id=?1 AND kind='aar' AND deleted_at_ms IS NULL ORDER BY created_at_ms,id", [&event.id])?,
            _ => Vec::new(),
        };
        if let Some(found) = candidates.into_iter().find(|c| !used.contains(c)) {
            conn.execute("UPDATE event_plan_items SET done_at_ms=?2,ref_id=?3 WHERE id=?1", params![item.id, now, found]).map_err(db_error)?;
            used.insert(found);
        }
    }
    Ok(())
}

fn event_view(conn: &Connection, id: &str) -> Result<EventView> {
    let event = load_event(conn, id)?;
    refresh_items(conn, &event)?;
    let items = load_items(conn, id)?;
    let debrief_done: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM transfer_reviews WHERE event_id=?1 AND kind='aar' AND deleted_at_ms IS NULL)", [id], |r| r.get(0))
        .map_err(db_error)?;
    Ok(EventView { event, items, debrief_done })
}

impl EventInput {
    fn clean(&self) -> Result<EventInput> {
        let title = one_line(&self.title, 120).filter(|t| t.chars().count() >= 2).ok_or("Give the event a title of 2 to 120 characters.")?;
        if !EVENT_KINDS.contains(&self.kind.as_str()) {
            return Err("Choose the kind of event from the list.".into());
        }
        date(&self.local_date)?;
        if self.start_time.as_deref().is_some_and(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").is_err() || t.len() != 5) {
            return Err("Choose a time like 14:30.".into());
        }
        if self.minutes.is_some_and(|m| !(1..=480).contains(&m)) {
            return Err("Choose a length of 1 to 480 minutes.".into());
        }
        let audience = one_line(&self.audience, 200).ok_or("Keep the audience under 200 characters.")?;
        let goal = one_line(&self.goal, 500).ok_or("Keep the goal under 500 characters.")?;
        if let Some(id) = &self.id {
            recording::validate_id(id)?;
        }
        Ok(EventInput { id: self.id.clone(), title, kind: self.kind.clone(), local_date: self.local_date.clone(), start_time: self.start_time.clone(), minutes: self.minutes, audience, goal })
    }
}

// ── Talks and rehearsals (14.3) ─────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TalkSectionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub notes: String,
    pub target_seconds: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TalkInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub template: Option<String>,
    pub sections: Vec<TalkSectionInput>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkSection {
    pub id: String,
    pub position: u32,
    pub title: String,
    pub keywords: Vec<String>,
    pub notes: String,
    pub target_seconds: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Talk {
    pub id: String,
    pub title: String,
    pub template: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkView {
    pub talk: Talk,
    pub sections: Vec<TalkSection>,
    pub target_seconds: u32,
    pub rehearsals: u32,
}

/// A section as it was when a rehearsal was recorded.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSnapshot {
    pub id: String,
    pub title: String,
    pub target_seconds: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RehearsalSection {
    pub section_id: String,
    pub title: String,
    pub target_seconds: u32,
    /// You moved to this card while recording (or it is the first).
    pub reached: bool,
    pub actual_ms: u64,
    /// From the transcript's segments that start in the section (Estimated); null without a timed transcript.
    pub words: Option<u32>,
    pub pace_wpm: Option<f64>,
    pub hesitations: Option<u32>,
}

/// A rehearsal's time per section (14.3): approximate, from segment start
/// times, never manufactured word times, and never a verdict.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RehearsalReport {
    pub attempt_id: String,
    pub talk_id: String,
    pub session_id: String,
    pub local_date: String,
    pub created_at: String,
    pub sections: Vec<RehearsalSection>,
    pub total_target_seconds: u32,
    pub total_actual_ms: u64,
    /// Set when no section marks were saved, so everything counts as section 1.
    pub note: Option<String>,
    pub transcribed: bool,
}

const TALK_COLUMNS: &str = "id,title,template,created_at_ms,updated_at_ms";

fn talk_row(r: &rusqlite::Row) -> rusqlite::Result<Talk> {
    Ok(Talk { id: r.get(0)?, title: r.get(1)?, template: r.get(2)?, created_at: iso(r.get(3)?), updated_at: iso(r.get(4)?) })
}

fn talk_view(conn: &Connection, id: &str) -> Result<TalkView> {
    recording::validate_id(id)?;
    let talk = conn
        .query_row(&format!("SELECT {TALK_COLUMNS} FROM talks WHERE id=?1 AND deleted_at_ms IS NULL"), [id], talk_row)
        .optional()
        .map_err(db_error)?
        .ok_or("This talk no longer exists.")?;
    let mut stmt = conn
        .prepare("SELECT id,position,title,keywords,notes,target_seconds FROM talk_sections WHERE talk_id=?1 AND deleted_at_ms IS NULL ORDER BY position")
        .map_err(db_error)?;
    let sections = stmt
        .query_map([id], |r| {
            Ok(TalkSection {
                id: r.get(0)?,
                position: r.get(1)?,
                title: r.get(2)?,
                keywords: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                notes: r.get(4)?,
                target_seconds: r.get(5)?,
            })
        })
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let rehearsals: u32 = conn
        .query_row(
            "SELECT count(*) FROM rehearsals r JOIN attempts a ON a.id=r.attempt_id WHERE r.talk_id=?1 AND a.deleted_at_ms IS NULL",
            [id],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    Ok(TalkView { target_seconds: sections.iter().map(|s| s.target_seconds).sum(), talk, sections, rehearsals })
}

impl TalkInput {
    fn clean(&self) -> Result<(String, Option<String>, Vec<(Option<String>, String, Vec<String>, String, u32)>)> {
        let title = one_line(&self.title, 120).filter(|t| t.chars().count() >= 2).ok_or("Give the talk a title of 2 to 120 characters.")?;
        if self.template.as_deref().is_some_and(|t| !key_id(t)) {
            return Err("Choose a template from the list.".into());
        }
        if self.sections.is_empty() || self.sections.len() > MAX_SECTIONS {
            return Err("A talk has 1 to 20 sections.".into());
        }
        let mut seen = HashSet::new();
        let mut sections = Vec::new();
        for s in &self.sections {
            let section_title = one_line(&s.title, 80).filter(|t| !t.is_empty()).ok_or("Give each section a title of up to 80 characters.")?;
            let keywords: Vec<String> = s.keywords.iter().filter_map(|k| one_line(k, 30)).filter(|k| !k.is_empty()).collect();
            if s.keywords.len() > MAX_KEYWORDS || keywords.len() != s.keywords.len() {
                return Err("Use up to 3 keywords per section, each up to 30 characters.".into());
            }
            if s.notes.chars().count() > 2000 || s.notes.contains('\0') {
                return Err("Keep each section's notes under 2,000 characters.".into());
            }
            if !(5..=3600).contains(&s.target_seconds) {
                return Err("Give each section a target between 5 seconds and an hour.".into());
            }
            if let Some(id) = &s.id {
                if !key_id(id) || !seen.insert(id.clone()) {
                    return Err("A section is listed twice.".into());
                }
            }
            sections.push((s.id.clone(), section_title, keywords, s.notes.trim().to_string(), s.target_seconds));
        }
        Ok((title, self.template.clone(), sections))
    }
}

/// The newest machine transcript's timed segments of a take, with each
/// segment's word count and hesitation candidates (dismissed ones left out).
fn segment_measures(conn: &Connection, attempt_id: &str) -> Result<Option<Vec<(u64, u32, u32)>>> {
    let Some(revision): Option<String> = conn
        .query_row("SELECT id FROM transcript_revisions WHERE attempt_id=?1 AND source<>'user' ORDER BY created_at_ms DESC,id DESC LIMIT 1", [attempt_id], |r| r.get(0))
        .optional()
        .map_err(db_error)?
    else {
        return Ok(None);
    };
    let segments: Vec<(String, Option<i64>, Option<i64>)> = conn
        .prepare("SELECT text,start_ms,end_ms FROM transcript_segments WHERE revision_id=?1 ORDER BY position")
        .map_err(db_error)?
        .query_map([&revision], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(db_error)?
        .collect::<rusqlite::Result<_>>()
        .map_err(db_error)?;
    if segments.is_empty() || segments.iter().any(|(_, s, _)| s.is_none()) {
        return Ok(None);
    }
    let inputs: Vec<crate::analysis::SegmentInput> = segments
        .iter()
        .map(|(text, s, e)| crate::analysis::SegmentInput { text, start_ms: s.and_then(|v| u64::try_from(v).ok()), end_ms: e.and_then(|v| u64::try_from(v).ok()) })
        .collect();
    let measures = crate::analysis::measure(&inputs);
    let dismissed: HashSet<i64> = conn
        .prepare("SELECT candidate FROM annotations WHERE revision_id=?1 AND definition_version=?2 AND kind='filler' AND decision='dismissed'")
        .map_err(db_error)?
        .query_map(params![revision, crate::analysis::FILLER_DEFINITION_VERSION], |r| r.get(0))
        .map_err(db_error)?
        .collect::<rusqlite::Result<_>>()
        .map_err(db_error)?;
    let mut hesitations: HashMap<usize, u32> = HashMap::new();
    for (i, f) in measures.fillers.iter().enumerate() {
        if !dismissed.contains(&(i as i64)) {
            *hesitations.entry(f.segment).or_default() += 1;
        }
    }
    Ok(Some(
        segments
            .iter()
            .enumerate()
            .map(|(i, (text, s, _))| (s.and_then(|v| u64::try_from(v).ok()).unwrap_or(0), crate::analysis::tokens(text).len() as u32, hesitations.get(&i).copied().unwrap_or(0)))
            .collect(),
    ))
}

fn report(conn: &Connection, attempt_id: &str) -> Result<RehearsalReport> {
    recording::validate_id(attempt_id)?;
    let (talk_id, snapshot, created, session_id, local_date, duration): (String, String, i64, String, String, Option<i64>) = conn
        .query_row(
            "SELECT r.talk_id,r.sections,r.created_at_ms,s.id,s.local_date,aa.duration_ms FROM rehearsals r JOIN attempts a ON a.id=r.attempt_id \
             JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id LEFT JOIN audio_assets aa ON aa.id=a.asset_id \
             WHERE r.attempt_id=?1 AND a.deleted_at_ms IS NULL",
            [attempt_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or("This rehearsal is unavailable.")?;
    let sections: Vec<SectionSnapshot> = serde_json::from_str(&snapshot).map_err(|_| "This rehearsal's sections could not be read.")?;
    let end = duration.and_then(|d| u64::try_from(d).ok()).unwrap_or(0);
    let marks: Vec<(i64, String)> = conn
        .prepare("SELECT at_ms,data FROM take_events WHERE attempt_id=?1 AND kind='section_mark' ORDER BY at_ms,id")
        .map_err(db_error)?
        .query_map([attempt_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(db_error)?
        .collect::<rusqlite::Result<_>>()
        .map_err(db_error)?;
    // Section 1 starts at 0; each later section at its first mark.
    let mut starts: Vec<Option<u64>> = vec![None; sections.len()];
    if let Some(first) = starts.first_mut() {
        *first = Some(0);
    }
    let mut marked = false;
    for (at, data) in marks {
        let id = serde_json::from_str::<Value>(&data).ok().and_then(|v| v["sectionId"].as_str().map(String::from));
        if let Some(index) = id.and_then(|id| sections.iter().position(|s| s.id == id)) {
            if index > 0 && starts[index].is_none() {
                starts[index] = Some(u64::try_from(at).unwrap_or(0).min(end));
                marked = true;
            }
        }
    }
    // Each reached section runs to the next reached one in time, or to the end.
    let mut order: Vec<(u64, usize)> = starts.iter().enumerate().filter_map(|(i, s)| s.map(|s| (s, i))).collect();
    order.sort();
    let mut spans: Vec<Option<(u64, u64)>> = vec![None; sections.len()];
    for (k, (start, i)) in order.iter().enumerate() {
        let stop = order.get(k + 1).map_or(end, |(next, _)| *next).max(*start);
        spans[*i] = Some((*start, stop));
    }
    let measures = segment_measures(conn, attempt_id)?;
    let transcribed = measures.is_some();
    let rows: Vec<RehearsalSection> = sections
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let span = spans[i];
            let actual = span.map_or(0, |(a, b)| b - a);
            let (words, hesitations) = match (&measures, span) {
                (Some(segments), Some((a, b))) => {
                    let last = order.last().map(|(_, j)| *j) == Some(i);
                    let inside: Vec<&(u64, u32, u32)> = segments.iter().filter(|(start, _, _)| *start >= a && (*start < b || (last && *start >= b))).collect();
                    (Some(inside.iter().map(|s| s.1).sum::<u32>()), Some(inside.iter().map(|s| s.2).sum::<u32>()))
                }
                (Some(_), None) => (Some(0), Some(0)),
                (None, _) => (None, None),
            };
            let pace = words.filter(|_| actual >= MIN_PACE_MS).map(|w| (f64::from(w) * 60_000.0 / actual as f64).round());
            RehearsalSection { section_id: s.id.clone(), title: s.title.clone(), target_seconds: s.target_seconds, reached: span.is_some(), actual_ms: actual, words, pace_wpm: pace, hesitations }
        })
        .collect();
    Ok(RehearsalReport {
        attempt_id: attempt_id.into(),
        talk_id,
        session_id,
        local_date,
        created_at: iso(created),
        total_target_seconds: sections.iter().map(|s| s.target_seconds).sum(),
        total_actual_ms: rows.iter().map(|r| r.actual_ms).sum(),
        note: (!marked && sections.len() > 1).then(|| "No section marks were saved, so the whole take counts as section 1.".to_string()),
        sections: rows,
        transcribed,
    })
}

// ── The time capsule (14.5) ─────────────────────────────────────────────────

/// This month's capsule: when it was first offered, and whether it is done or dismissed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleOffer {
    pub month: String,
    pub offered_on: String,
    pub done: bool,
    pub dismissed: bool,
    /// Offered on Today now: not done, not dismissed, within 7 days of the first offer.
    pub show: bool,
}

impl DatabaseOwner {
    /// Picks this week's mission (14.1), or skips the week with `None`. A done week can't change.
    pub fn pick_mission(&self, week: &str, mission_id: Option<&str>) -> Result<MissionPick> {
        date(week)?;
        if mission_id.is_some_and(|m| !key_id(m)) {
            return Err("Choose a mission from the list.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let done: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM mission_picks WHERE week=?1 AND done_at_ms IS NOT NULL)", [week], |r| r.get(0)).map_err(db_error)?;
        if done {
            return Err("This week's mission is already done.".into());
        }
        conn.execute(
            "INSERT INTO mission_picks(week,mission_id,picked_at_ms) VALUES (?1,?2,?3) ON CONFLICT(week) DO UPDATE SET mission_id=excluded.mission_id,picked_at_ms=excluded.picked_at_ms",
            params![week, mission_id, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        conn.query_row("SELECT week,mission_id,picked_at_ms,review_id,done_at_ms FROM mission_picks WHERE week=?1", [week], pick_row).map_err(db_error)
    }

    pub fn mission_pick(&self, week: &str) -> Result<Option<MissionPick>> {
        date(week)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row("SELECT week,mission_id,picked_at_ms,review_id,done_at_ms FROM mission_picks WHERE week=?1", [week], pick_row).optional().map_err(db_error)
    }

    /// Takes back this week's pick or skip, so the offers show again. A done week stays.
    pub fn clear_mission(&self, week: &str) -> Result<()> {
        date(week)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("DELETE FROM mission_picks WHERE week=?1 AND done_at_ms IS NULL", [week]).map_err(db_error)?;
        Ok(())
    }

    /// Creates or changes an event (14.2).
    pub fn save_event(&self, input: &EventInput) -> Result<Event> {
        let input = input.clean()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let id = match &input.id {
            Some(id) => {
                let count = conn
                    .execute(
                        "UPDATE events SET title=?2,kind=?3,local_date=?4,start_time=?5,minutes=?6,audience=?7,goal=?8 WHERE id=?1 AND deleted_at_ms IS NULL",
                        params![id, input.title, input.kind, input.local_date, input.start_time, input.minutes, input.audience, input.goal],
                    )
                    .map_err(db_error)?;
                if count != 1 {
                    return Err("This event no longer exists.".into());
                }
                id.clone()
            }
            None => {
                let id = fresh_id(&conn, "events", "event", &HashSet::new())?;
                conn.execute(
                    "INSERT INTO events(id,title,kind,local_date,start_time,minutes,audience,goal,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![id, input.title, input.kind, input.local_date, input.start_time, input.minutes, input.audience, input.goal, recording::now_ms() as i64],
                )
                .map_err(db_error)?;
                id
            }
        };
        load_event(&conn, &id)
    }

    /// Replaces the event's plan items that are not done; done ones stay, and
    /// all are numbered again by day.
    pub fn save_event_plan(&self, event_id: &str, items: &[PlanItemInput]) -> Result<EventView> {
        if items.len() > MAX_PLAN_ITEMS {
            return Err("A plan has at most 20 items.".into());
        }
        let mut cleaned = Vec::new();
        for item in items {
            date(&item.local_date)?;
            if !ITEM_KINDS.contains(&item.kind.as_str()) {
                return Err("Choose each item's kind from the list.".into());
            }
            let title = one_line(&item.title, 120).filter(|t| !t.is_empty()).ok_or("Give each item a short title.")?;
            cleaned.push((item.local_date.clone(), item.kind.clone(), title));
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        load_event(&tx, event_id)?;
        tx.execute("DELETE FROM event_plan_items WHERE event_id=?1 AND done_at_ms IS NULL", [event_id]).map_err(db_error)?;
        let done: Vec<PlanItem> = load_items(&tx, event_id)?;
        if done.len() + cleaned.len() > MAX_PLAN_ITEMS {
            return Err("A plan has at most 20 items.".into());
        }
        // By day; a done item comes first on its day, so it keeps its place.
        let mut order: Vec<(String, Option<String>, Option<(String, String)>)> = done.into_iter().map(|i| (i.local_date, Some(i.id), None)).collect();
        order.extend(cleaned.into_iter().map(|(day, kind, title)| (day, None, Some((kind, title)))));
        order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.is_none().cmp(&b.1.is_none())));
        // Positions are unique per event: park the done ones before numbering again.
        tx.execute("UPDATE event_plan_items SET position=position+100000 WHERE event_id=?1", [event_id]).map_err(db_error)?;
        let mut taken = HashSet::new();
        for (position, (day, existing, new)) in order.into_iter().enumerate() {
            let position = position as u32 + 1;
            match (existing, new) {
                (Some(id), _) => {
                    tx.execute("UPDATE event_plan_items SET position=?2 WHERE id=?1", params![id, position]).map_err(db_error)?;
                }
                (None, Some((kind, title))) => {
                    let id = fresh_id(&tx, "event_plan_items", "item", &taken)?;
                    tx.execute(
                        "INSERT INTO event_plan_items(id,event_id,position,local_date,kind,title) VALUES (?1,?2,?3,?4,?5,?6)",
                        params![id, event_id, position, day, kind, title],
                    )
                    .map_err(db_error)?;
                    taken.insert(id);
                }
                (None, None) => {}
            }
        }
        let view = event_view(&tx, event_id)?;
        tx.commit().map_err(db_error)?;
        Ok(view)
    }

    /// Ticks or unticks a plan item by hand; it no longer ticks itself.
    pub fn set_plan_item_done(&self, item_id: &str, done: bool) -> Result<EventView> {
        recording::validate_id(item_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let event_id: String = conn
            .query_row("SELECT i.event_id FROM event_plan_items i JOIN events e ON e.id=i.event_id WHERE i.id=?1 AND e.deleted_at_ms IS NULL", [item_id], |r| r.get(0))
            .optional()
            .map_err(db_error)?
            .ok_or("This plan item no longer exists.")?;
        let at = done.then(|| recording::now_ms() as i64);
        conn.execute("UPDATE event_plan_items SET done_at_ms=?2,ref_id=NULL,by_hand=1 WHERE id=?1", params![item_id, at]).map_err(db_error)?;
        event_view(&conn, &event_id)
    }

    /// Links the event's talk (the Outline item, 14.3).
    pub fn link_event_talk(&self, event_id: &str, talk_id: &str) -> Result<EventView> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        load_event(&conn, event_id)?;
        talk_view(&conn, talk_id)?;
        conn.execute("UPDATE events SET talk_id=?2 WHERE id=?1", params![event_id, talk_id]).map_err(db_error)?;
        event_view(&conn, event_id)
    }

    pub fn get_event(&self, id: &str) -> Result<EventView> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        event_view(&conn, id)
    }

    /// Your events, soonest first; each one's items are brought up to date.
    pub fn list_events(&self) -> Result<Vec<EventView>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let list = ids(&conn, "SELECT id FROM events WHERE deleted_at_ms IS NULL ORDER BY local_date,start_time,created_at_ms,id", [])?;
        list.iter().map(|id| event_view(&conn, id)).collect()
    }

    /// Deletes an event softly; its rehearsal takes and talk stay.
    pub fn delete_event(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn.execute("UPDATE events SET deleted_at_ms=?2 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, recording::now_ms() as i64]).map_err(db_error)?;
        if count != 1 {
            return Err("This event no longer exists.".into());
        }
        Ok(())
    }

    /// Creates or changes a talk (14.3): its sections replace the old ones in
    /// order; a section left out is deleted softly (old reports keep its snapshot).
    pub fn save_talk(&self, input: &TalkInput) -> Result<TalkView> {
        let (title, template, sections) = input.clean()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let now = recording::now_ms() as i64;
        let id = match &input.id {
            Some(id) => {
                recording::validate_id(id)?;
                let count = tx
                    .execute("UPDATE talks SET title=?2,template=?3,updated_at_ms=?4 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, title, template, now])
                    .map_err(db_error)?;
                if count != 1 {
                    return Err("This talk no longer exists.".into());
                }
                id.clone()
            }
            None => {
                let id = fresh_id(&tx, "talks", "talk", &HashSet::new())?;
                tx.execute("INSERT INTO talks(id,title,template,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?4)", params![id, title, template, now]).map_err(db_error)?;
                id
            }
        };
        let existing: HashSet<String> = ids(&tx, "SELECT id FROM talk_sections WHERE talk_id=?1 AND deleted_at_ms IS NULL", [&id])?.into_iter().collect();
        // Positions are unique per talk: park the live ones before renumbering.
        tx.execute("UPDATE talk_sections SET position=position+100000 WHERE talk_id=?1", [&id]).map_err(db_error)?;
        let mut kept = HashSet::new();
        let mut taken: HashSet<String> = HashSet::new();
        for (position, (section_id, section_title, keywords, notes, target)) in sections.into_iter().enumerate() {
            let position = position as u32 + 1;
            let keywords = serde_json::to_string(&keywords).map_err(|e| e.to_string())?;
            match section_id.filter(|s| existing.contains(s)) {
                Some(sid) => {
                    tx.execute(
                        "UPDATE talk_sections SET position=?2,title=?3,keywords=?4,notes=?5,target_seconds=?6 WHERE id=?1",
                        params![sid, position, section_title, keywords, notes, target],
                    )
                    .map_err(db_error)?;
                    kept.insert(sid);
                }
                None => {
                    let sid = fresh_id(&tx, "talk_sections", "section", &taken)?;
                    tx.execute(
                        "INSERT INTO talk_sections(id,talk_id,position,title,keywords,notes,target_seconds) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![sid, id, position, section_title, keywords, notes, target],
                    )
                    .map_err(db_error)?;
                    taken.insert(sid);
                }
            }
        }
        for gone in existing.difference(&kept) {
            tx.execute("UPDATE talk_sections SET deleted_at_ms=?2 WHERE id=?1", params![gone, now]).map_err(db_error)?;
        }
        let view = talk_view(&tx, &id)?;
        tx.commit().map_err(db_error)?;
        Ok(view)
    }

    pub fn get_talk(&self, id: &str) -> Result<TalkView> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        talk_view(&conn, id)
    }

    /// Your talks, the one changed last first.
    pub fn list_talks(&self) -> Result<Vec<TalkView>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let list = ids(&conn, "SELECT id FROM talks WHERE deleted_at_ms IS NULL ORDER BY updated_at_ms DESC,id", [])?;
        list.iter().map(|id| talk_view(&conn, id)).collect()
    }

    pub fn delete_talk(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn.execute("UPDATE talks SET deleted_at_ms=?2 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, recording::now_ms() as i64]).map_err(db_error)?;
        if count != 1 {
            return Err("This talk no longer exists.".into());
        }
        Ok(())
    }

    /// Links a saved rehearsal take to its talk with a snapshot of the sections
    /// (14.3). Recording the same take again keeps the first snapshot.
    pub fn record_rehearsal(&self, talk_id: &str, attempt_id: &str) -> Result<RehearsalReport> {
        recording::validate_id(attempt_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let view = talk_view(&conn, talk_id)?;
        let kind: Option<String> = conn
            .query_row(
                "SELECT e.type FROM attempts a JOIN session_steps st ON st.id=a.step_id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version \
                 WHERE a.id=?1 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL",
                [attempt_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?
            .flatten();
        if kind.as_deref() != Some("rehearsal") {
            return Err("Only a saved rehearsal take can be added to a talk.".into());
        }
        let snapshot: Vec<SectionSnapshot> = view.sections.iter().map(|s| SectionSnapshot { id: s.id.clone(), title: s.title.clone(), target_seconds: s.target_seconds }).collect();
        let id = fresh_id(&conn, "rehearsals", "rehearsal", &HashSet::new())?;
        conn.execute(
            "INSERT OR IGNORE INTO rehearsals(id,talk_id,attempt_id,sections,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
            params![id, talk_id, attempt_id, serde_json::to_string(&snapshot).map_err(|e| e.to_string())?, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        report(&conn, attempt_id)
    }

    pub fn rehearsal_report(&self, attempt_id: &str) -> Result<RehearsalReport> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        report(&conn, attempt_id)
    }

    /// A talk's rehearsals, oldest first, for comparing over time.
    pub fn list_rehearsals(&self, talk_id: &str) -> Result<Vec<RehearsalReport>> {
        recording::validate_id(talk_id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let list = ids(
            &conn,
            "SELECT r.attempt_id FROM rehearsals r JOIN attempts a ON a.id=r.attempt_id JOIN session_steps st ON st.id=a.step_id JOIN sessions s ON s.id=st.session_id \
             WHERE r.talk_id=?1 AND a.deleted_at_ms IS NULL AND s.deleted_at_ms IS NULL ORDER BY r.created_at_ms,r.id",
            [talk_id],
        )?;
        list.iter().map(|a| report(&conn, a)).collect()
    }

    /// This month's time capsule (14.5): the first call in a month starts its
    /// seven days on offer.
    pub fn capsule_offer(&self, today: &str) -> Result<CapsuleOffer> {
        let day = date(today)?;
        let month = today[..7].to_string();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute("INSERT OR IGNORE INTO capsule_months(month,offered_on) VALUES (?1,?2)", params![month, today]).map_err(db_error)?;
        let (offered_on, dismissed): (String, Option<i64>) = conn
            .query_row("SELECT offered_on,dismissed_at_ms FROM capsule_months WHERE month=?1", [&month], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(db_error)?;
        let done: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions s JOIN session_steps st ON st.session_id=s.id JOIN exercise_definitions e ON e.id=st.exercise_id AND e.version=st.exercise_version \
                 JOIN attempts a ON a.step_id=st.id WHERE e.type='capsule' AND s.deleted_at_ms IS NULL AND a.capture_state='saved' AND a.deleted_at_ms IS NULL AND substr(s.local_date,1,7)=?1)",
                [&month],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        let within = date(&offered_on).map(|first| (day - first).num_days() < CAPSULE_DAYS).unwrap_or(false);
        Ok(CapsuleOffer { show: !done && dismissed.is_none() && within, month, offered_on, done, dismissed: dismissed.is_some() })
    }

    /// Not this month: the capsule isn't offered again until next month.
    pub fn dismiss_capsule(&self, month: &str) -> Result<()> {
        if month.len() != 7 || date(&format!("{month}-01")).is_err() {
            return Err("Invalid month.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO capsule_months(month,offered_on,dismissed_at_ms) VALUES (?1,?2,?3) ON CONFLICT(month) DO UPDATE SET dismissed_at_ms=excluded.dismissed_at_ms",
            params![month, format!("{month}-01"), recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::storage::database::drills::TakeEventInput;
    use crate::storage::database::{Conditions, Outline, PracticeContext};
    use crate::storage::recording::tests::TestRoot;

    pub(crate) fn rehearsal_context(session: &str, talk: &str) -> PracticeContext {
        PracticeContext {
            session_id: session.into(),
            exercise_id: REHEARSAL_EXERCISE.into(),
            exercise_version: 1,
            exercise_type: "rehearsal".into(),
            prompt: "Team demo".into(),
            outline: Outline { point: String::new(), reason: String::new(), example: String::new() },
            conditions: Conditions { familiarity: "familiar".into(), preparation_seconds: 0, target_seconds: 300, audience: None, follow_up: false },
            curriculum_version: None,
            content_id: None,
            activity: Some(serde_json::from_value(serde_json::json!({"version": 1, "seed": talk, "groupId": talk})).unwrap()),
            step: None,
        }
    }

    fn talk_input(id: Option<String>, sections: &[(&str, u32)]) -> TalkInput {
        TalkInput {
            id,
            title: "Team demo".into(),
            template: Some("classic".into()),
            sections: sections.iter().map(|(t, s)| TalkSectionInput { id: None, title: (*t).into(), keywords: vec!["search".into()], notes: String::new(), target_seconds: *s }).collect(),
        }
    }

    /// A transcribed rehearsal take of `seconds` with these timed segments.
    fn rehearse(db: &DatabaseOwner, root: &TestRoot, talk: &str, id: &str, seconds: u32, segments: &[(&str, u64, u64)]) {
        db.reserve(id, &format!("op-{id}"), "Rehearsal", Some(&rehearsal_context(&format!("session-{id}"), talk))).unwrap();
        db.commit_recording(&crate::storage::database::engagement::tests::audio(&root.0, id, seconds)).unwrap();
        if !segments.is_empty() {
            let transcript = crate::audio::whisper::Transcript {
                version: 1, run_id: format!("{id}--1"), asset_id: id.into(), provider: "whisper.cpp".into(), model_id: "base".into(), model_sha256: "a".repeat(64),
                runtime_version: "1.9.1".into(), backend: crate::audio::whisper::Backend::Cpu, threads: 4, prompt: None, source_sha256: "b".repeat(64),
                prepared_sha256: "c".repeat(64), language: "en".into(), raw_text: segments.iter().map(|s| s.0).collect::<Vec<_>>().join(" "),
                segments: segments.iter().map(|(text, s, e)| crate::audio::whisper::Segment { text: (*text).into(), start_ms: Some(*s), end_ms: Some(*e), timing_source: "Estimated".into(), timing_unavailable_reason: None }).collect(),
                elapsed_ms: 10, peak_ram_bytes: None, peak_ram_unavailable_reason: Some("test".into()), created_at_ms: 1,
            };
            db.start_job(&format!("job-{id}"), id, 1).unwrap();
            db.save_local_transcript(&format!("job-{id}"), id, &transcript, 2).unwrap();
        }
    }

    fn mark(db: &DatabaseOwner, attempt: &str, at_ms: u64, section: &str) {
        let mut data = serde_json::Map::new();
        data.insert("sectionId".into(), section.into());
        db.add_take_events(attempt, &[TakeEventInput { at_ms, kind: "section_mark".into(), data }]).unwrap();
    }

    #[test]
    fn rehearsal_report_splits_by_marks_and_assigns_segments_by_start_time() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30), ("What we built", 90), ("Close", 40)])).unwrap();
        assert_eq!(talk.target_seconds, 160);
        let ids: Vec<String> = talk.sections.iter().map(|s| s.id.clone()).collect();
        rehearse(&db, &root, &talk.talk.id, "r1", 20, &[
            ("Hi everyone, um, today the demo.", 0, 3_000),
            ("We built search and filters.", 4_000, 9_000),
            ("They are fast, uh, really.", 9_000, 11_900),
            ("Thanks for listening.", 12_100, 15_000),
        ]);
        mark(&db, "r1", 3_500, &ids[1]);
        mark(&db, "r1", 12_000, &ids[2]);
        let report = db.record_rehearsal(&talk.talk.id, "r1").unwrap();
        let actual: Vec<u64> = report.sections.iter().map(|s| s.actual_ms).collect();
        assert_eq!(actual, [3_500, 8_500, 8_000]);
        assert_eq!(report.total_actual_ms, 20_000);
        assert_eq!(report.sections.iter().map(|s| s.words).collect::<Vec<_>>(), [Some(6), Some(10), Some(3)], "a segment counts where it starts");
        assert_eq!(report.sections.iter().map(|s| s.hesitations).collect::<Vec<_>>(), [Some(1), Some(1), Some(0)]);
        assert_eq!(report.sections[0].pace_wpm, None, "under five seconds has no pace");
        assert_eq!(report.sections[1].pace_wpm, Some(71.0));
        assert!(report.note.is_none() && report.transcribed);
        assert!(db.record_rehearsal(&talk.talk.id, "missing").is_err());
        assert_eq!(db.list_rehearsals(&talk.talk.id).unwrap().len(), 1);
        assert_eq!(db.get_talk(&talk.talk.id).unwrap().rehearsals, 1);
    }

    #[test]
    fn report_reads_the_snapshot_after_the_talk_changes() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30), ("Close", 40)])).unwrap();
        rehearse(&db, &root, &talk.talk.id, "r1", 12, &[]);
        mark(&db, "r1", 5_000, &talk.sections[1].id);
        db.record_rehearsal(&talk.talk.id, "r1").unwrap();
        // Rename, retarget and add a section: the old report reads as recorded.
        let mut changed = talk_input(Some(talk.talk.id.clone()), &[("Hello", 20), ("Middle", 60), ("Bye", 10)]);
        changed.sections[0].id = Some(talk.sections[0].id.clone());
        let after = db.save_talk(&changed).unwrap();
        assert_eq!(after.sections.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["Hello", "Middle", "Bye"]);
        assert_eq!(after.sections[0].id, talk.sections[0].id, "a kept section keeps its ID");
        let report = db.rehearsal_report("r1").unwrap();
        assert_eq!(report.sections.iter().map(|s| (s.title.as_str(), s.target_seconds)).collect::<Vec<_>>(), [("Opening", 30), ("Close", 40)]);
        assert_eq!(report.sections.iter().map(|s| s.actual_ms).collect::<Vec<_>>(), [5_000, 7_000]);
        assert_eq!(report.sections[0].words, None, "no transcript yet");
        assert!(!report.transcribed);
    }

    #[test]
    fn missing_marks_put_everything_in_section_one_with_a_note() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30), ("Close", 40)])).unwrap();
        rehearse(&db, &root, &talk.talk.id, "r1", 15, &[("One sentence here.", 0, 2_000), ("Another one later.", 9_000, 11_000)]);
        let report = db.record_rehearsal(&talk.talk.id, "r1").unwrap();
        assert_eq!(report.sections.iter().map(|s| (s.reached, s.actual_ms)).collect::<Vec<_>>(), [(true, 15_000), (false, 0)]);
        assert_eq!(report.sections[0].words, Some(6));
        assert_eq!(report.note.as_deref(), Some("No section marks were saved, so the whole take counts as section 1."));
        // A take outside a rehearsal session can't be added.
        db.reserve("plain", "op-plain", "Take", Some(&crate::storage::database::engagement::tests::context("s", "familiar", ["", "", ""]))).unwrap();
        db.commit_recording(&crate::storage::database::engagement::tests::audio(&root.0, "plain", 12)).unwrap();
        assert!(db.record_rehearsal(&talk.talk.id, "plain").is_err());
    }

    fn event_input(title: &str, kind: &str, day: &str) -> EventInput {
        EventInput { id: None, title: title.into(), kind: kind.into(), local_date: day.into(), start_time: Some("14:30".into()), minutes: Some(20), audience: "My team".into(), goal: "Search is ready".into() }
    }

    fn item(day: &str, kind: &str, title: &str) -> PlanItemInput {
        PlanItemInput { local_date: day.into(), kind: kind.into(), title: title.into() }
    }

    /// Each item's kind and the work that finished it.
    fn status(view: &EventView) -> Vec<(String, Option<String>)> {
        view.items.iter().map(|i| (i.kind.clone(), i.ref_id.clone())).collect()
    }

    #[test]
    fn plan_items_auto_complete_from_rehearsals_conversations_routines_and_reviews() {
        use crate::storage::database::conversations::tests::new_conversation;
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let event = db.save_event(&event_input("Team demo", "talk", "2099-01-20")).unwrap();
        // Work is done today: items dated in the past take it, a future item waits for its day.
        let view = db
            .save_event_plan(&event.id, &[
                item("2020-01-04", "run_through", "Run-through 2"),
                item("2020-01-01", "outline", "Outline your talk"),
                item("2020-01-02", "run_through", "Run-through 1"),
                item("2020-01-03", "qa_drill", "Q&A drill"),
                item("2020-01-05", "mock", "Mock"),
                item("2099-01-18", "dress_rehearsal", "Dress rehearsal"),
                item("2099-01-20", "routine", "Pre-talk routine"),
                item("2099-01-20", "debrief", "Debrief"),
            ])
            .unwrap();
        assert_eq!(view.items.iter().map(|i| (i.position, i.title.as_str())).take(3).collect::<Vec<_>>(), [(1, "Outline your talk"), (2, "Run-through 1"), (3, "Q&A drill")], "numbered by day");
        assert!(view.items.iter().all(|i| i.done_at.is_none()) && !view.debrief_done);
        // A talk with sections finishes the outline; each rehearsal finishes one run-through, in order.
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30), ("Close", 40)])).unwrap();
        db.link_event_talk(&event.id, &talk.talk.id).unwrap();
        rehearse(&db, &root, &talk.talk.id, "r1", 12, &[]);
        db.record_rehearsal(&talk.talk.id, "r1").unwrap();
        let s = status(&db.get_event(&event.id).unwrap());
        assert_eq!(s[0], ("outline".into(), Some(talk.talk.id.clone())));
        assert_eq!((s[1].1.as_deref(), s[3].1.as_deref()), (Some("r1"), None), "one rehearsal, one item");
        rehearse(&db, &root, &talk.talk.id, "r2", 12, &[]);
        db.record_rehearsal(&talk.talk.id, "r2").unwrap();
        // A conversation is a mock; a panel's questions are the Q&A drill.
        let mock = db.create_conversation(&new_conversation("scripted"), None).unwrap();
        let mut panel = new_conversation("scripted");
        panel.scenario_id = crate::conversation::QA_PANEL.into();
        let panel = db.create_conversation(&panel, None).unwrap();
        db.save_routine_run(&crate::storage::database::confidence::RoutineInput { steps: vec!["breathe".into()], kept_note: None, event_id: Some(event.id.clone()) }).unwrap();
        let s = status(&db.get_event(&event.id).unwrap());
        assert_eq!(s[2], ("qa_drill".into(), Some(panel.conversation.id.clone())));
        assert_eq!(s[3], ("run_through".into(), Some("r2".into())));
        assert_eq!(s[4], ("mock".into(), Some(mock.conversation.id.clone())));
        assert_eq!(s[5], ("dress_rehearsal".into(), None), "a rehearsal before the item's day doesn't count");
        assert!(s[6].1.as_deref().is_some_and(|r| r.starts_with("routine-")), "{s:?}");
        assert_eq!(s[7], ("debrief".into(), None));
        // The debrief finishes with an after-action review for this event.
        let review = db
            .add_transfer_review(&crate::storage::database::transfer::TransferInput {
                local_date: "2026-10-18".into(), situation: "The team demo".into(), preparation: String::new(), listener_text: String::new(), clarification: String::new(),
                success: String::new(), self_report: String::new(), next_focus: String::new(), flow: None, tags: Vec::new(), kind: Some("aar".into()),
                extra: Some(crate::storage::database::transfer::AfterAction { happened: "It went fine".into(), event_id: Some(event.id.clone()), ..Default::default() }),
                mission_id: None,
            })
            .unwrap();
        let view = db.get_event(&event.id).unwrap();
        assert_eq!(status(&view)[7].1.as_deref(), Some(review.id.as_str()));
        assert!(view.debrief_done);
        // By hand: an item you untick stays unticked; replanning keeps what is done.
        let dress = view.items[5].id.clone();
        let view = db.set_plan_item_done(&dress, true).unwrap();
        assert!(view.items[5].done_at.is_some() && view.items[5].by_hand && view.items[5].ref_id.is_none());
        let outline = view.items[0].id.clone();
        let view = db.set_plan_item_done(&outline, false).unwrap();
        assert!(view.items[0].done_at.is_none() && view.items[0].by_hand, "an item you untick doesn't tick itself again");
        let replanned = db.save_event_plan(&event.id, &[item("2020-01-01", "outline", "Outline again"), item("2099-01-19", "run_through", "One more run-through")]).unwrap();
        let titles: Vec<&str> = replanned.items.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, ["Outline again", "Run-through 1", "Q&A drill", "Run-through 2", "Mock", "Dress rehearsal", "One more run-through", "Pre-talk routine", "Debrief"]);
        assert_eq!(replanned.items.iter().map(|i| i.position).collect::<Vec<_>>(), (1..=9).collect::<Vec<_>>());
        assert_eq!(replanned.items[0].ref_id.as_deref(), Some(talk.talk.id.as_str()), "a new outline item takes the talk again");
        assert!(replanned.items[6].done_at.is_none(), "no rehearsal on or after its day");
        assert!(db.save_event_plan(&event.id, &[item("someday", "outline", "x")]).is_err());
        assert!(db.save_event_plan(&event.id, &[item("2020-01-01", "nap", "x")]).is_err());
        assert!(db.save_event_plan(&event.id, &vec![item("2020-01-01", "mock", "x"); 13]).is_err(), "at most 20 items with the done ones");
    }

    #[test]
    fn deleting_an_event_keeps_its_rehearsal_takes() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let event = db.save_event(&event_input("Team demo", "talk", "2099-01-20")).unwrap();
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30)])).unwrap();
        db.link_event_talk(&event.id, &talk.talk.id).unwrap();
        db.save_event_plan(&event.id, &[item("2020-01-02", "run_through", "Run-through 1")]).unwrap();
        rehearse(&db, &root, &talk.talk.id, "r1", 12, &[]);
        db.record_rehearsal(&talk.talk.id, "r1").unwrap();
        assert_eq!(db.list_events().unwrap().len(), 1);
        db.delete_event(&event.id).unwrap();
        assert!(db.list_events().unwrap().is_empty() && db.get_event(&event.id).is_err());
        assert!(db.delete_event(&event.id).is_err());
        assert!(db.get_session("session-r1").is_ok(), "the rehearsal's session stays");
        assert_eq!(db.list_rehearsals(&talk.talk.id).unwrap().len(), 1, "and its report");
        assert_eq!(db.get_talk(&talk.talk.id).unwrap().rehearsals, 1);
        // Changing an event checks it like a new one.
        assert!(db.save_event(&event_input("x", "talk", "2099-01-20")).is_err());
        assert!(db.save_event(&event_input("Interview", "party", "2099-01-20")).is_err());
        assert!(db.save_event(&EventInput { start_time: Some("25:00".into()), ..event_input("Interview", "interview", "2099-01-20") }).is_err());
        assert!(db.save_event(&EventInput { minutes: Some(0), ..event_input("Interview", "interview", "2099-01-20") }).is_err());
        let other = db.save_event(&event_input("Interview", "interview", "2099-02-01")).unwrap();
        let changed = db.save_event(&EventInput { id: Some(other.id.clone()), ..event_input("Interview at Acme", "interview", "2099-02-02") }).unwrap();
        assert_eq!((changed.id.as_str(), changed.title.as_str(), changed.local_date.as_str()), (other.id.as_str(), "Interview at Acme", "2099-02-02"));
        assert!(db.save_event(&EventInput { id: Some(event.id.clone()), ..event_input("Team demo", "talk", "2099-01-20") }).is_err(), "a deleted event can't be changed");
    }

    #[test]
    fn talks_validate_sections_and_delete_softly() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.save_talk(&talk_input(None, &[])).is_err());
        assert!(db.save_talk(&talk_input(None, &[("Opening", 4)])).is_err());
        let mut many = talk_input(None, &[("Opening", 30)]);
        many.sections[0].keywords = vec!["a".into(), "b".into(), "c".into(), "d".into()];
        assert!(db.save_talk(&many).is_err());
        let talk = db.save_talk(&talk_input(None, &[("Opening", 30)])).unwrap();
        assert_eq!(db.list_talks().unwrap().len(), 1);
        db.delete_talk(&talk.talk.id).unwrap();
        assert!(db.list_talks().unwrap().is_empty() && db.get_talk(&talk.talk.id).is_err());
    }

    #[test]
    fn missions_are_picked_once_a_week_and_can_be_skipped() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert_eq!(db.mission_pick("2026-10-12").unwrap(), None);
        assert!(db.pick_mission("12 Oct", Some("ask-in-meeting")).is_err());
        assert!(db.pick_mission("2026-10-12", Some("Ask In Meeting")).is_err());
        db.pick_mission("2026-10-12", Some("ask-in-meeting")).unwrap();
        let changed = db.pick_mission("2026-10-12", Some("dinner-story")).unwrap();
        assert_eq!(changed.mission_id.as_deref(), Some("dinner-story"), "you can change your mind until it's done");
        let skipped = db.pick_mission("2026-10-19", None).unwrap();
        assert_eq!(skipped.mission_id, None);
        db.clear_mission("2026-10-19").unwrap();
        assert_eq!(db.mission_pick("2026-10-19").unwrap(), None);
    }

    #[test]
    fn the_capsule_is_offered_for_seven_days_once_a_month() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let first = db.capsule_offer("2026-10-20").unwrap();
        assert_eq!((first.month.as_str(), first.offered_on.as_str(), first.show), ("2026-10", "2026-10-20", true), "offered from the first app day of the month");
        assert!(db.capsule_offer("2026-10-26").unwrap().show);
        assert!(!db.capsule_offer("2026-10-27").unwrap().show, "seven days");
        assert!(db.capsule_offer("2026-11-01").unwrap().show, "a new month");
        db.dismiss_capsule("2026-11").unwrap();
        let dismissed = db.capsule_offer("2026-11-02").unwrap();
        assert!(!dismissed.show && dismissed.dismissed);
        assert!(db.dismiss_capsule("2026-13").is_err());
    }
}
