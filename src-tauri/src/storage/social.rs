//! Club mode (roadmap 15.2): a speaking club meeting's agenda, then each
//! speaker's time, filler taps and your notes. Nobody is recorded: only times,
//! counts and what you typed. Meetings are your own content, deleted softly;
//! nothing here leaves this computer (A-32).
use super::{db_error, iso, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const SPEECH_KINDS: [&str; 4] = ["prepared", "table_topic", "evaluation", "other"];
/// What the Ah-counter counts, in the order of keys 1 to 6.
pub const COUNTERS: [&str; 6] = ["um", "uh", "so", "like", "you_know", "other"];
pub const MAX_SPEECHES: usize = 30;
const MAX_COUNT: u32 = 999;
/// No speech is longer than this.
const MAX_SECONDS: u32 = 6 * 60 * 60;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClubSpeechInput {
    #[serde(default)]
    pub id: Option<String>,
    pub speaker: String,
    pub kind: String,
    #[serde(default)]
    pub target_min_seconds: Option<u32>,
    #[serde(default)]
    pub target_max_seconds: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClubMeetingInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub local_date: String,
    #[serde(default)]
    pub word_of_the_day: String,
    pub speeches: Vec<ClubSpeechInput>,
}

/// A speaker's result: the time, the Ah-counter's taps and your notes.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClubSpeechResult {
    pub seconds: u32,
    #[serde(default)]
    pub counts: BTreeMap<String, u32>,
    #[serde(default)]
    pub word_used: Option<bool>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubSpeech {
    pub id: String,
    pub position: u32,
    pub speaker: String,
    pub kind: String,
    pub target_min_seconds: Option<u32>,
    pub target_max_seconds: Option<u32>,
    /// Null until the speaker is timed.
    pub seconds: Option<u32>,
    pub counts: BTreeMap<String, u32>,
    pub word_used: Option<bool>,
    pub notes: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMeeting {
    pub id: String,
    pub title: String,
    pub local_date: String,
    pub word_of_the_day: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMeetingView {
    pub meeting: ClubMeeting,
    pub speeches: Vec<ClubSpeech>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMeetingSummary {
    pub id: String,
    pub title: String,
    pub local_date: String,
    pub speeches: u32,
    pub timed: u32,
}

fn one_line(text: &str, max: usize) -> Option<String> {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (t.chars().count() <= max && !t.chars().any(char::is_control)).then_some(t)
}

fn key_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

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

fn meeting_view(conn: &Connection, id: &str) -> Result<ClubMeetingView> {
    recording::validate_id(id)?;
    let meeting = conn
        .query_row("SELECT id,title,local_date,word_of_the_day,created_at_ms FROM club_meetings WHERE id=?1 AND deleted_at_ms IS NULL", [id], |r| {
            Ok(ClubMeeting { id: r.get(0)?, title: r.get(1)?, local_date: r.get(2)?, word_of_the_day: r.get(3)?, created_at: iso(r.get(4)?) })
        })
        .optional()
        .map_err(db_error)?
        .ok_or("This meeting no longer exists.")?;
    let speeches = conn
        .prepare("SELECT id,position,speaker,kind,target_min_seconds,target_max_seconds,seconds,counts,word_used,notes FROM club_speeches WHERE meeting_id=?1 ORDER BY position")
        .map_err(db_error)?
        .query_map([id], |r| {
            Ok(ClubSpeech {
                id: r.get(0)?,
                position: r.get(1)?,
                speaker: r.get(2)?,
                kind: r.get(3)?,
                target_min_seconds: r.get(4)?,
                target_max_seconds: r.get(5)?,
                seconds: r.get(6)?,
                counts: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
                word_used: r.get::<_, Option<i64>>(8)?.map(|v| v == 1),
                notes: r.get(9)?,
            })
        })
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    Ok(ClubMeetingView { meeting, speeches })
}

/// The light a time reached in its window (Toastmasters): green at the
/// minimum, amber at the window's midpoint, red at the maximum.
pub fn light_reached(seconds: u32, min: Option<u32>, max: Option<u32>) -> &'static str {
    match (min, max) {
        (Some(min), Some(max)) if max >= min => {
            if seconds >= max {
                "red"
            } else if seconds * 2 >= min + max {
                "amber"
            } else if seconds >= min {
                "green"
            } else {
                "none"
            }
        }
        _ => "none",
    }
}

fn clock(seconds: u32) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

/// Text that can't break a Markdown table cell.
fn cell(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").replace('|', "\\|")
}

/// The meeting as Markdown (15.2): a table of speakers with their time, the
/// light reached and the Ah-counter's taps, then your notes. Names are as you typed them.
pub fn summary_markdown(view: &ClubMeetingView) -> String {
    let kind = |k: &str| match k {
        "prepared" => "Prepared speech",
        "table_topic" => "Table topic",
        "evaluation" => "Evaluation",
        _ => "Other",
    };
    let mut out = format!("# {}\n\n{}", cell(&view.meeting.title), view.meeting.local_date);
    if !view.meeting.word_of_the_day.is_empty() {
        out.push_str(&format!(" · Word of the day: {}", cell(&view.meeting.word_of_the_day)));
    }
    out.push_str("\n\n| # | Speaker | Kind | Window | Time | Light | um | uh | so | like | you know | other | Word of the day |\n");
    out.push_str("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
    for s in &view.speeches {
        let window = match (s.target_min_seconds, s.target_max_seconds) {
            (Some(min), Some(max)) => format!("{}–{}", clock(min), clock(max)),
            _ => "–".into(),
        };
        let (time, light) = match s.seconds {
            Some(seconds) => (clock(seconds), match light_reached(seconds, s.target_min_seconds, s.target_max_seconds) {
                "green" => "Green",
                "amber" => "Amber",
                "red" => "Red",
                _ => "None",
            }),
            None => ("not timed".into(), "–"),
        };
        let counts: Vec<String> = COUNTERS.iter().map(|c| s.counts.get(*c).copied().unwrap_or(0).to_string()).collect();
        let word = match s.word_used {
            Some(true) => "used",
            Some(false) => "not used",
            None => "–",
        };
        out.push_str(&format!("| {} | {} | {} | {} | {} | {} | {} | {} |\n", s.position, cell(&s.speaker), kind(&s.kind), window, time, light, counts.join(" | "), word));
    }
    let notes: Vec<String> = view.speeches.iter().filter(|s| !s.notes.trim().is_empty()).map(|s| format!("- {}: {}", cell(&s.speaker), s.notes.split_whitespace().collect::<Vec<_>>().join(" "))).collect();
    if !notes.is_empty() {
        out.push_str(&format!("\nNotes\n\n{}\n", notes.join("\n")));
    }
    out.push_str("\nTimed with ClearPractice. Nobody was recorded.\n");
    out
}

/// A file name for the summary, from the meeting's title and day.
pub fn summary_file_name(view: &ClubMeetingView) -> String {
    let title: String = view.meeting.title.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { ' ' } else { c }).collect();
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let title: String = title.chars().take(80).collect::<String>().trim_end_matches(['.', ' ']).to_string();
    format!("{} {}.md", if title.is_empty() { "Club meeting" } else { &title }, view.meeting.local_date)
}

impl ClubMeetingInput {
    #[allow(clippy::type_complexity)]
    fn clean(&self) -> Result<(String, String, Vec<(Option<String>, String, String, Option<u32>, Option<u32>)>)> {
        let title = one_line(&self.title, 120).filter(|t| t.chars().count() >= 2).ok_or("Give the meeting a title of 2 to 120 characters.")?;
        chrono::NaiveDate::parse_from_str(&self.local_date, "%Y-%m-%d").map_err(|_| "Choose a day.")?;
        let word = one_line(&self.word_of_the_day, 60).ok_or("Keep the word of the day under 60 characters.")?;
        if self.speeches.len() > MAX_SPEECHES {
            return Err("A meeting has at most 30 speakers.".into());
        }
        let mut seen = HashSet::new();
        let mut speeches = Vec::new();
        for s in &self.speeches {
            let speaker = one_line(&s.speaker, 60).filter(|n| !n.is_empty()).ok_or("Give each speaker a name of up to 60 characters.")?;
            if !SPEECH_KINDS.contains(&s.kind.as_str()) {
                return Err("Choose each speech's kind from the list.".into());
            }
            match (s.target_min_seconds, s.target_max_seconds) {
                (Some(min), Some(max)) if min < max && max <= 3600 => {}
                (None, None) => {}
                _ => return Err("A time window needs a minimum below its maximum, up to an hour.".into()),
            }
            if let Some(id) = &s.id {
                if !key_id(id) || !seen.insert(id.clone()) {
                    return Err("A speaker is listed twice.".into());
                }
            }
            speeches.push((s.id.clone(), speaker, s.kind.clone(), s.target_min_seconds, s.target_max_seconds));
        }
        Ok((title, word, speeches))
    }
}

impl DatabaseOwner {
    /// Creates or changes a meeting and its agenda (15.2). Speakers keep their
    /// results by ID; one left out of the agenda is removed with its result.
    pub fn save_club_meeting(&self, input: &ClubMeetingInput) -> Result<ClubMeetingView> {
        let (title, word, speeches) = input.clean()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let id = match &input.id {
            Some(id) => {
                recording::validate_id(id)?;
                let count = tx
                    .execute(
                        "UPDATE club_meetings SET title=?2,local_date=?3,word_of_the_day=?4 WHERE id=?1 AND deleted_at_ms IS NULL",
                        params![id, title, input.local_date, word],
                    )
                    .map_err(db_error)?;
                if count != 1 {
                    return Err("This meeting no longer exists.".into());
                }
                id.clone()
            }
            None => {
                let id = fresh_id(&tx, "club_meetings", "club", &HashSet::new())?;
                tx.execute(
                    "INSERT INTO club_meetings(id,title,local_date,word_of_the_day,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
                    params![id, title, input.local_date, word, recording::now_ms() as i64],
                )
                .map_err(db_error)?;
                id
            }
        };
        let existing: HashSet<String> = tx
            .prepare("SELECT id FROM club_speeches WHERE meeting_id=?1")
            .map_err(db_error)?
            .query_map([&id], |r| r.get(0))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        // Positions are unique per meeting: park them before numbering again.
        tx.execute("UPDATE club_speeches SET position=position+100000 WHERE meeting_id=?1", [&id]).map_err(db_error)?;
        let mut kept = HashSet::new();
        let mut taken = HashSet::new();
        for (position, (speech_id, speaker, kind, min, max)) in speeches.into_iter().enumerate() {
            let position = position as u32 + 1;
            match speech_id.filter(|s| existing.contains(s)) {
                Some(sid) => {
                    tx.execute(
                        "UPDATE club_speeches SET position=?2,speaker=?3,kind=?4,target_min_seconds=?5,target_max_seconds=?6 WHERE id=?1",
                        params![sid, position, speaker, kind, min, max],
                    )
                    .map_err(db_error)?;
                    kept.insert(sid);
                }
                None => {
                    let sid = fresh_id(&tx, "club_speeches", "speech", &taken)?;
                    tx.execute(
                        "INSERT INTO club_speeches(id,meeting_id,position,speaker,kind,target_min_seconds,target_max_seconds) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![sid, id, position, speaker, kind, min, max],
                    )
                    .map_err(db_error)?;
                    taken.insert(sid);
                }
            }
        }
        for gone in existing.difference(&kept) {
            tx.execute("DELETE FROM club_speeches WHERE id=?1", [gone]).map_err(db_error)?;
        }
        let view = meeting_view(&tx, &id)?;
        tx.commit().map_err(db_error)?;
        Ok(view)
    }

    /// Stores a speaker's time, taps and notes once they finish (15.2).
    pub fn save_club_speech(&self, meeting_id: &str, speech_id: &str, result: &ClubSpeechResult) -> Result<ClubMeetingView> {
        recording::validate_id(speech_id)?;
        if result.seconds > MAX_SECONDS {
            return Err("A speech is at most six hours.".into());
        }
        if result.counts.iter().any(|(k, v)| !COUNTERS.contains(&k.as_str()) || *v > MAX_COUNT) {
            return Err("The Ah-counter counts um, uh, so, like, you know and other, up to 999 each.".into());
        }
        if result.notes.chars().count() > 2000 || result.notes.contains('\0') {
            return Err("Keep the notes under 2,000 characters.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        meeting_view(&conn, meeting_id)?;
        let counts: BTreeMap<&String, &u32> = result.counts.iter().filter(|(_, v)| **v > 0).collect();
        let count = conn
            .execute(
                "UPDATE club_speeches SET seconds=?3,counts=?4,word_used=?5,notes=?6 WHERE id=?1 AND meeting_id=?2",
                params![speech_id, meeting_id, result.seconds, serde_json::to_string(&counts).map_err(|e| e.to_string())?, result.word_used, result.notes.trim()],
            )
            .map_err(db_error)?;
        if count != 1 {
            return Err("This speaker is no longer on the agenda.".into());
        }
        meeting_view(&conn, meeting_id)
    }

    pub fn get_club_meeting(&self, id: &str) -> Result<ClubMeetingView> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        meeting_view(&conn, id)
    }

    /// Your meetings, newest first.
    pub fn list_club_meetings(&self) -> Result<Vec<ClubMeetingSummary>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(
                "SELECT m.id,m.title,m.local_date,(SELECT count(*) FROM club_speeches s WHERE s.meeting_id=m.id),\
                 (SELECT count(*) FROM club_speeches s WHERE s.meeting_id=m.id AND s.seconds IS NOT NULL) \
                 FROM club_meetings m WHERE m.deleted_at_ms IS NULL ORDER BY m.local_date DESC,m.created_at_ms DESC,m.id",
            )
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok(ClubMeetingSummary { id: r.get(0)?, title: r.get(1)?, local_date: r.get(2)?, speeches: r.get(3)?, timed: r.get(4)? }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Deletes a meeting softly, with its agenda and results.
    pub fn delete_club_meeting(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute("UPDATE club_meetings SET deleted_at_ms=?2 WHERE id=?1 AND deleted_at_ms IS NULL", params![id, recording::now_ms() as i64])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This meeting no longer exists.".into());
        }
        Ok(())
    }

    /// The meeting as Markdown, for Copy as text and Save as file….
    pub fn club_summary(&self, id: &str) -> Result<String> {
        Ok(summary_markdown(&self.get_club_meeting(id)?))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn speech(name: &str, kind: &str, window: Option<(u32, u32)>) -> ClubSpeechInput {
        ClubSpeechInput { id: None, speaker: name.into(), kind: kind.into(), target_min_seconds: window.map(|w| w.0), target_max_seconds: window.map(|w| w.1) }
    }

    pub(crate) fn meeting(db: &DatabaseOwner) -> ClubMeetingView {
        db.save_club_meeting(&ClubMeetingInput {
            id: None,
            title: "Thursday club".into(),
            local_date: "2026-10-22".into(),
            word_of_the_day: "candid".into(),
            speeches: vec![speech("Maria", "prepared", Some((300, 420))), speech("Tom", "table_topic", Some((60, 120))), speech("Ana", "evaluation", Some((120, 180)))],
        })
        .unwrap()
    }

    #[test]
    fn club_meetings_store_counts_only_and_soft_delete() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let view = meeting(&db);
        assert_eq!(view.speeches.iter().map(|s| (s.position, s.speaker.as_str(), s.seconds)).collect::<Vec<_>>(), [(1, "Maria", None), (2, "Tom", None), (3, "Ana", None)]);
        let tom = view.speeches[1].id.clone();
        let counts: BTreeMap<String, u32> = [("um".to_string(), 2), ("like".to_string(), 3), ("so".to_string(), 0)].into_iter().collect();
        let after = db.save_club_speech(&view.meeting.id, &tom, &ClubSpeechResult { seconds: 95, counts, word_used: Some(true), notes: " Clear opening ".into() }).unwrap();
        let timed = &after.speeches[1];
        assert_eq!((timed.seconds, timed.word_used, timed.notes.as_str()), (Some(95), Some(true), "Clear opening"));
        assert_eq!(timed.counts.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(), [("like", 3), ("um", 2)], "zero counts aren't kept");
        // Only counts, times and what you typed: refused otherwise.
        let bad: BTreeMap<String, u32> = [("sigh".to_string(), 1)].into_iter().collect();
        assert!(db.save_club_speech(&view.meeting.id, &tom, &ClubSpeechResult { seconds: 10, counts: bad, word_used: None, notes: String::new() }).is_err());
        let many: BTreeMap<String, u32> = [("uh".to_string(), 1000)].into_iter().collect();
        assert!(db.save_club_speech(&view.meeting.id, &tom, &ClubSpeechResult { seconds: 10, counts: many, word_used: None, notes: String::new() }).is_err());
        assert!(db.save_club_speech(&view.meeting.id, "missing", &ClubSpeechResult { seconds: 10, counts: BTreeMap::new(), word_used: None, notes: String::new() }).is_err());
        // Editing the agenda keeps a timed speaker's result and renumbers.
        let mut edit = ClubMeetingInput {
            id: Some(view.meeting.id.clone()),
            title: "Thursday club".into(),
            local_date: "2026-10-22".into(),
            word_of_the_day: "candid".into(),
            speeches: vec![speech("Tom", "table_topic", Some((60, 120))), speech("Lee", "other", None)],
        };
        edit.speeches[0].id = Some(tom.clone());
        let edited = db.save_club_meeting(&edit).unwrap();
        assert_eq!(edited.speeches.iter().map(|s| (s.position, s.speaker.as_str(), s.seconds)).collect::<Vec<_>>(), [(1, "Tom", Some(95)), (2, "Lee", None)]);
        assert_eq!(db.list_club_meetings().unwrap()[0], ClubMeetingSummary { id: view.meeting.id.clone(), title: "Thursday club".into(), local_date: "2026-10-22".into(), speeches: 2, timed: 1 });
        // Deleted softly: gone from the list and refused, with its rows still in place.
        db.delete_club_meeting(&view.meeting.id).unwrap();
        assert!(db.list_club_meetings().unwrap().is_empty() && db.get_club_meeting(&view.meeting.id).is_err());
        assert!(db.delete_club_meeting(&view.meeting.id).is_err());
        let rows: i64 = db.connection.lock().unwrap().query_row("SELECT count(*) FROM club_speeches", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2);
        // Validation.
        let input = |speeches: Vec<ClubSpeechInput>| ClubMeetingInput { id: None, title: "Club".into(), local_date: "2026-10-22".into(), word_of_the_day: String::new(), speeches };
        assert!(db.save_club_meeting(&input(vec![speech("Maria", "keynote", None)])).is_err());
        assert!(db.save_club_meeting(&input(vec![speech("Maria", "prepared", Some((420, 300)))])).is_err());
        assert!(db.save_club_meeting(&input(vec![speech(" ", "prepared", None)])).is_err());
        assert!(db.save_club_meeting(&ClubMeetingInput { title: "C".into(), ..input(vec![]) }).is_err());
        assert!(db.save_club_meeting(&input(vec![])).is_ok(), "an agenda can start empty");
    }

    #[test]
    fn the_summary_lists_times_lights_and_counts_as_markdown() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let view = meeting(&db);
        let counts: BTreeMap<String, u32> = [("um".to_string(), 2), ("you_know".to_string(), 1)].into_iter().collect();
        db.save_club_speech(&view.meeting.id, &view.speeches[0].id, &ClubSpeechResult { seconds: 365, counts, word_used: Some(false), notes: "Strong | story".into() }).unwrap();
        db.save_club_speech(&view.meeting.id, &view.speeches[1].id, &ClubSpeechResult { seconds: 125, counts: BTreeMap::new(), word_used: None, notes: String::new() }).unwrap();
        let text = db.club_summary(&view.meeting.id).unwrap();
        assert!(text.starts_with("# Thursday club\n\n2026-10-22 · Word of the day: candid\n"), "{text}");
        assert!(text.contains("| 1 | Maria | Prepared speech | 5:00–7:00 | 6:05 | Amber | 2 | 0 | 0 | 0 | 1 | 0 | not used |"), "{text}");
        assert!(text.contains("| 2 | Tom | Table topic | 1:00–2:00 | 2:05 | Red | 0 | 0 | 0 | 0 | 0 | 0 | – |"), "{text}");
        assert!(text.contains("| 3 | Ana | Evaluation | 2:00–3:00 | not timed | – |"), "{text}");
        assert!(text.contains("- Maria: Strong | story"), "notes are kept as typed");
        assert_eq!(light_reached(299, Some(300), Some(420)), "none");
        assert_eq!(light_reached(300, Some(300), Some(420)), "green");
        assert_eq!(light_reached(360, Some(300), Some(420)), "amber");
        assert_eq!(light_reached(420, Some(300), Some(420)), "red");
        assert_eq!(light_reached(500, None, None), "none");
        assert_eq!(summary_file_name(&view), "Thursday club 2026-10-22.md");
    }
}
