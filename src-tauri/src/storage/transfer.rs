//! Real-conversation reflections (plan 4.17, §7 Transfer). No recording of
//! anyone else: the user writes what happened. The listener's own words are
//! stored apart from the user's reading of the conversation, and nothing is
//! averaged into a score. After-action reviews (roadmap 12.4) are a kind of
//! reflection with four answers of their own. A reflection can log this week's
//! mission (14.1), and an after-action review can debrief an event (14.2).
use super::{db_error, iso, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferInput {
    /// YYYY-MM-DD on the local calendar: the day of the conversation.
    pub local_date: String,
    pub situation: String,
    pub preparation: String,
    /// What the listener actually said (their words, entered by you).
    pub listener_text: String,
    pub clarification: String,
    pub success: String,
    /// Your own reading of how it went.
    pub self_report: String,
    pub next_focus: String,
    /// How your speaking flowed (9.16, Your note): "smooth", "mixed" or "hard".
    #[serde(default)]
    pub flow: Option<String>,
    /// What kind of conversation it was (9.16), from `TRANSFER_TAGS`.
    #[serde(default)]
    pub tags: Vec<String>,
    /// "reflection" (the default) or "aar", an after-action review (12.4).
    #[serde(default)]
    pub kind: Option<String>,
    /// An after-action review's four answers; only with `kind: "aar"`.
    #[serde(default)]
    pub extra: Option<AfterAction>,
    /// The mission this reflection logs (14.1): it must be picked and not yet done.
    #[serde(default)]
    pub mission_id: Option<String>,
}

/// The US Army's four debrief questions, in plain words (12.4).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct AfterAction {
    pub planned: String,
    pub happened: String,
    pub why: String,
    pub next_time: String,
    /// The event this review debriefs (14.2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
}

/// Kinds of conversation you can note (9.16).
pub const TRANSFER_TAGS: [&str; 7] = ["story", "meeting", "presentation", "interview", "small_talk", "phone", "other"];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReview {
    pub id: String,
    pub local_date: String,
    pub situation: String,
    pub preparation: String,
    pub listener_text: String,
    pub clarification: String,
    pub success: String,
    pub self_report: String,
    pub next_focus: String,
    pub flow: Option<String>,
    pub tags: Vec<String>,
    /// "reflection" or "aar" (12.4).
    pub kind: String,
    /// An after-action review's four answers, else null.
    pub extra: Option<AfterAction>,
    /// The mission it logs (14.1), else null.
    pub mission_id: Option<String>,
    pub created_at: String,
}

impl TransferInput {
    fn validate(&self) -> Result<()> {
        if chrono::NaiveDate::parse_from_str(&self.local_date, "%Y-%m-%d").is_err() {
            return Err("Choose the day of the conversation.".into());
        }
        if self.situation.trim().chars().count() < 3 {
            return Err("Describe the situation in a few words.".into());
        }
        let fields = [&self.situation, &self.preparation, &self.listener_text, &self.clarification, &self.success, &self.self_report, &self.next_focus];
        if fields.iter().any(|f| f.chars().count() > 2000 || f.contains('\0')) {
            return Err("Keep each answer under 2,000 characters.".into());
        }
        if self.flow.as_deref().is_some_and(|f| !matches!(f, "smooth" | "mixed" | "hard")) {
            return Err("Choose how your speaking flowed from the list.".into());
        }
        if self.tags.len() > TRANSFER_TAGS.len() || self.tags.iter().any(|tag| !TRANSFER_TAGS.contains(&tag.as_str())) {
            return Err("Choose the kind of conversation from the list.".into());
        }
        match (self.kind(), &self.extra) {
            ("reflection", None) => {}
            ("aar", Some(a)) => {
                let answers = [&a.planned, &a.happened, &a.why, &a.next_time];
                if answers.iter().any(|f| f.chars().count() > 2000 || f.contains('\0')) {
                    return Err("Keep each answer under 2,000 characters.".into());
                }
                if answers.iter().all(|f| f.trim().is_empty()) {
                    return Err("Answer at least one of the four questions.".into());
                }
            }
            ("aar", None) => return Err("An after-action review needs its answers.".into()),
            ("reflection", Some(_)) => return Err("Only an after-action review has these answers.".into()),
            _ => return Err("Unknown kind of reflection.".into()),
        }
        let key = |id: &str| !id.is_empty() && id.len() <= 96 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
        if self.mission_id.as_deref().is_some_and(|m| !key(m)) {
            return Err("Choose a mission from the list.".into());
        }
        if let Some(event) = self.extra.as_ref().and_then(|a| a.event_id.as_deref()) {
            recording::validate_id(event)?;
        }
        Ok(())
    }

    fn kind(&self) -> &str {
        self.kind.as_deref().unwrap_or("reflection")
    }
}

const COLUMNS: &str = "id,local_date,situation,preparation,listener_text,clarification,success,self_report,next_focus,created_at_ms,flow,tags,kind,extra,mission_id";

fn row(r: &rusqlite::Row) -> rusqlite::Result<TransferReview> {
    Ok(TransferReview {
        id: r.get(0)?,
        local_date: r.get(1)?,
        situation: r.get(2)?,
        preparation: r.get(3)?,
        listener_text: r.get(4)?,
        clarification: r.get(5)?,
        success: r.get(6)?,
        self_report: r.get(7)?,
        next_focus: r.get(8)?,
        created_at: iso(r.get(9)?),
        flow: r.get(10)?,
        tags: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default(),
        extra: if r.get::<_, String>(12)? == "aar" { serde_json::from_str(&r.get::<_, String>(13)?).ok() } else { None },
        kind: r.get(12)?,
        mission_id: r.get(14)?,
    })
}

fn dedup(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        if !out.contains(tag) {
            out.push(tag.clone());
        }
    }
    out
}

impl DatabaseOwner {
    /// Reflections, newest conversation first.
    pub fn list_transfer_reviews(&self) -> Result<Vec<TransferReview>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM transfer_reviews WHERE deleted_at_ms IS NULL ORDER BY local_date DESC, created_at_ms DESC"))
            .map_err(db_error)?;
        let rows = stmt.query_map([], row).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    pub fn add_transfer_review(&self, input: &TransferInput) -> Result<TransferReview> {
        input.validate()?;
        let now = recording::now_ms();
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("transfer-{now}") } else { format!("transfer-{now}-{n}") };
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM transfer_reviews WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                break candidate;
            }
            n += 1;
        };
        let tx = conn.transaction().map_err(db_error)?;
        let event_id = input.extra.as_ref().and_then(|a| a.event_id.clone());
        let extra = match &input.extra {
            Some(a) => serde_json::to_string(&AfterAction {
                planned: a.planned.trim().into(),
                happened: a.happened.trim().into(),
                why: a.why.trim().into(),
                next_time: a.next_time.trim().into(),
                event_id: event_id.clone(),
            }),
            None => Ok("{}".into()),
        }
        .map_err(|e| e.to_string())?;
        // A mission is logged once, on the newest week it is picked and open (14.1).
        let mission_week: Option<String> = match &input.mission_id {
            Some(mission) => Some(
                tx.query_row("SELECT week FROM mission_picks WHERE mission_id=?1 AND done_at_ms IS NULL ORDER BY week DESC LIMIT 1", [mission], |r| r.get(0))
                    .optional()
                    .map_err(db_error)?
                    .ok_or("This mission isn't open. Pick it in This week first.")?,
            ),
            None => None,
        };
        if let Some(event) = &event_id {
            let live: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND deleted_at_ms IS NULL)", [event], |r| r.get(0)).map_err(db_error)?;
            if !live {
                return Err("This event no longer exists.".into());
            }
        }
        tx.execute(
            "INSERT INTO transfer_reviews(id,local_date,situation,preparation,listener_text,clarification,success,self_report,next_focus,created_at_ms,flow,tags,kind,extra,mission_id,event_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![id, input.local_date, input.situation.trim(), input.preparation.trim(), input.listener_text.trim(), input.clarification.trim(),
                input.success.trim(), input.self_report.trim(), input.next_focus.trim(), now as i64, input.flow, serde_json::to_string(&dedup(&input.tags)).map_err(|e| e.to_string())?,
                input.kind(), extra, input.mission_id, event_id],
        )
        .map_err(db_error)?;
        // Effort points (roadmap 7.4) on the day of the conversation; an
        // after-action review earns its own event on top (12.4).
        let event = |kind| crate::engagement::NewEvent { kind, ref_id: &id, local_date: &input.local_date, session_id: None, attempt_id: None, created_at_ms: now as i64, backfilled: false };
        super::engagement::award(&tx, &event(crate::engagement::EventKind::TransferReview))?;
        if input.kind() == "aar" {
            super::engagement::award(&tx, &event(crate::engagement::EventKind::AfterAction))?;
        }
        // A mission once per week (14.1), and an event's first debrief (14.2).
        if let Some(week) = &mission_week {
            tx.execute("UPDATE mission_picks SET done_at_ms=?2,review_id=?3 WHERE week=?1", params![week, now as i64, id]).map_err(db_error)?;
            super::engagement::award(&tx, &crate::engagement::NewEvent { ref_id: week, ..event(crate::engagement::EventKind::Mission) })?;
        }
        if let Some(event_ref) = &event_id {
            super::engagement::award(&tx, &crate::engagement::NewEvent { ref_id: event_ref, ..event(crate::engagement::EventKind::EventDebrief) })?;
        }
        let review = tx.query_row(&format!("SELECT {COLUMNS} FROM transfer_reviews WHERE id=?1"), [&id], row).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(review)
    }

    pub fn delete_transfer_review(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute("UPDATE transfer_reviews SET deleted_at_ms=?1 WHERE id=?2 AND deleted_at_ms IS NULL", params![recording::now_ms() as i64, id])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This reflection no longer exists.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn input(date: &str) -> TransferInput {
        TransferInput {
            local_date: date.into(),
            situation: " Explained a decision to a colleague ".into(),
            preparation: "Five minutes of notes".into(),
            listener_text: "You want to delay the release for the tests.".into(),
            clarification: "Why two weeks".into(),
            success: "Led with the decision".into(),
            self_report: "I think the reason came too late.".into(),
            next_focus: "Give the reason in the first sentence".into(),
            flow: None,
            tags: Vec::new(),
            kind: None,
            extra: None,
            mission_id: None,
        }
    }

    #[test]
    fn reflections_keep_the_listener_words_apart_and_can_be_removed() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let saved = db.add_transfer_review(&input("2026-10-08")).unwrap();
        assert_eq!(saved.situation, "Explained a decision to a colleague");
        assert_eq!(saved.listener_text, "You want to delay the release for the tests.");
        assert_eq!(saved.self_report, "I think the reason came too late.");
        assert!(db.add_transfer_review(&input("8 Oct")).is_err());
        assert!(db.add_transfer_review(&TransferInput { situation: " ".into(), ..input("2026-10-08") }).is_err());
        assert!(db.add_transfer_review(&TransferInput { listener_text: "x".repeat(2001), ..input("2026-10-08") }).is_err());
        assert_eq!(db.list_transfer_reviews().unwrap(), vec![saved.clone()]);
        db.delete_transfer_review(&saved.id).unwrap();
        assert!(db.list_transfer_reviews().unwrap().is_empty());
        assert!(db.delete_transfer_review(&saved.id).is_err());
    }

    #[test]
    fn transfer_reviews_store_flow_and_known_tags_only() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let saved = db.add_transfer_review(&TransferInput { flow: Some("smooth".into()), tags: vec!["story".into(), "meeting".into(), "story".into()], ..input("2026-10-16") }).unwrap();
        assert_eq!((saved.flow.as_deref(), saved.tags.clone()), (Some("smooth"), vec!["story".to_string(), "meeting".to_string()]));
        assert_eq!(db.list_transfer_reviews().unwrap()[0].tags, ["story", "meeting"]);
        assert!(db.add_transfer_review(&TransferInput { flow: Some("great".into()), ..input("2026-10-16") }).is_err());
        assert!(db.add_transfer_review(&TransferInput { tags: vec!["date".into()], ..input("2026-10-16") }).is_err());
        let plain = db.add_transfer_review(&input("2026-10-16")).unwrap();
        assert_eq!((plain.flow, plain.tags), (None, Vec::<String>::new()));
        let facts = db.practice_facts("2026-10-16").unwrap();
        let story = facts.transfer_reviews.iter().find(|r| r.id == saved.id).unwrap();
        assert_eq!((story.flow.as_deref(), story.tags.clone()), (Some("smooth"), vec!["story".to_string(), "meeting".to_string()]));
    }

    #[test]
    fn aar_reviews_store_extra_fields_and_award_both_events() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let answers = AfterAction { planned: " Open with the decision ".into(), happened: "I opened with the history".into(), why: String::new(), next_time: "Decision first".into(), event_id: None };
        let aar = TransferInput { kind: Some("aar".into()), extra: Some(answers), next_focus: String::new(), listener_text: "You want to wait.".into(), ..input("2026-10-16") };
        let saved = db.add_transfer_review(&aar).unwrap();
        assert_eq!(saved.kind, "aar");
        assert_eq!(saved.extra.as_ref().map(|a| (a.planned.as_str(), a.next_time.as_str())), Some(("Open with the decision", "Decision first")));
        assert_eq!(saved.listener_text, "You want to wait.", "the listener's words stay apart");
        let plain = db.add_transfer_review(&input("2026-10-16")).unwrap();
        assert_eq!((plain.kind.as_str(), plain.extra.is_none()), ("reflection", true));
        let kinds: Vec<String> = db.connection.lock().unwrap().prepare("SELECT kind FROM practice_events WHERE ref_id=?1 ORDER BY kind").unwrap()
            .query_map([&saved.id], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(kinds, ["after_action", "transfer_review"]);
        assert!(db.add_transfer_review(&TransferInput { kind: Some("aar".into()), extra: None, ..input("2026-10-16") }).is_err());
        assert!(db.add_transfer_review(&TransferInput { kind: Some("aar".into()), extra: Some(AfterAction::default()), ..input("2026-10-16") }).is_err(), "at least one answer");
        assert!(db.add_transfer_review(&TransferInput { kind: Some("aar".into()), extra: Some(AfterAction { why: "x".repeat(2001), ..AfterAction::default() }), ..input("2026-10-16") }).is_err());
        assert!(db.add_transfer_review(&TransferInput { kind: Some("debrief".into()), ..input("2026-10-16") }).is_err());
        assert!(db.add_transfer_review(&TransferInput { extra: Some(AfterAction { happened: "x".into(), ..AfterAction::default() }), ..input("2026-10-16") }).is_err());
        // An after-action review's next time counts as a next focus for the engines.
        let facts = db.practice_facts("2026-10-16").unwrap();
        let fact = facts.transfer_reviews.iter().find(|r| r.id == saved.id).unwrap();
        assert_eq!((fact.kind.as_str(), fact.has_next_focus), ("aar", true));
    }

    fn xp(db: &DatabaseOwner, kind: &str) -> Vec<(String, String)> {
        db.connection.lock().unwrap().prepare("SELECT ref_id,local_date FROM practice_events WHERE kind=?1 ORDER BY id").unwrap()
            .query_map([kind], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    }

    #[test]
    fn a_reflection_with_a_mission_marks_the_pick_done_and_awards_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let logged = |mission: &str| TransferInput { mission_id: Some(mission.into()), situation: "Asked one question in the team meeting".into(), ..input("2026-10-14") };
        assert!(db.add_transfer_review(&logged("ask-in-meeting")).is_err(), "only a picked mission");
        db.pick_mission("2026-10-12", Some("ask-in-meeting")).unwrap();
        assert!(db.add_transfer_review(&logged("Ask In Meeting")).is_err());
        let saved = db.add_transfer_review(&logged("ask-in-meeting")).unwrap();
        assert_eq!(saved.mission_id.as_deref(), Some("ask-in-meeting"));
        let pick = db.mission_pick("2026-10-12").unwrap().unwrap();
        assert_eq!((pick.review_id.as_deref(), pick.done_at.is_some()), (Some(saved.id.as_str()), true));
        assert_eq!(xp(&db, "mission"), [("2026-10-12".to_string(), "2026-10-14".to_string())]);
        assert!(db.add_transfer_review(&logged("ask-in-meeting")).is_err(), "a done mission is logged once");
        assert!(db.pick_mission("2026-10-12", Some("dinner-story")).is_err() && db.clear_mission("2026-10-12").is_ok());
        assert!(db.mission_pick("2026-10-12").unwrap().is_some(), "a done week stays");
        assert_eq!(xp(&db, "mission").len(), 1);
        assert_eq!(xp(&db, "transfer_review").len(), 1, "the reflection itself earns as usual");
        let facts = db.practice_facts("2026-10-14").unwrap();
        assert_eq!(facts.transfer_reviews[0].mission_id.as_deref(), Some("ask-in-meeting"));
        assert_eq!(facts.mission_picks.iter().map(|p| (p.week.as_str(), p.done)).collect::<Vec<_>>(), [("2026-10-12", true)]);
    }

    #[test]
    fn an_after_action_review_debriefs_an_event_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let event = db
            .save_event(&crate::storage::database::events::EventInput {
                id: None,
                title: "Interview at Acme".into(),
                kind: "interview".into(),
                local_date: "2026-10-23".into(),
                start_time: Some("10:00".into()),
                minutes: Some(45),
                audience: "Two engineers".into(),
                goal: "I can lead a small team".into(),
            })
            .unwrap();
        let debrief = |event_id: &str| TransferInput {
            kind: Some("aar".into()),
            extra: Some(AfterAction { planned: "Lead with the result".into(), event_id: Some(event_id.into()), ..AfterAction::default() }),
            ..input("2026-10-23")
        };
        assert!(db.add_transfer_review(&debrief("missing-event")).is_err());
        let saved = db.add_transfer_review(&debrief(&event.id)).unwrap();
        assert_eq!(saved.extra.as_ref().and_then(|a| a.event_id.as_deref()), Some(event.id.as_str()));
        db.add_transfer_review(&debrief(&event.id)).unwrap();
        assert_eq!(xp(&db, "event_debrief"), [(event.id.clone(), "2026-10-23".to_string())], "an event's first debrief earns");
        assert!(db.get_event(&event.id).unwrap().debrief_done);
        let facts = db.practice_facts("2026-10-23").unwrap();
        assert_eq!(facts.transfer_reviews[0].event_id.as_deref(), Some(event.id.as_str()));
        assert_eq!(facts.events.iter().map(|e| (e.id.as_str(), e.debrief_done)).collect::<Vec<_>>(), [(event.id.as_str(), true)]);
        let plain = TransferInput { extra: Some(AfterAction { event_id: Some("x".into()), ..AfterAction::default() }), ..input("2026-10-23") };
        assert!(db.add_transfer_review(&plain).is_err(), "only an after-action review");
    }
}
