//! Phrase cards and their review history (plan 4.15). The schedule is the
//! transparent ladder from the blueprint (§6 Phrases), mirrored in
//! `src/lib/phrase-schedule.ts`: 1 → 3 → 7 → 14 → 30 days; Again → 1 day,
//! Hard → keep the interval (at least 1), Good → the next step up.
use super::{db_error, DatabaseOwner, Result};
use crate::storage::recording;
use chrono::{Duration, NaiveDate};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

pub const LADDER: [u32; 5] = [1, 3, 7, 14, 30];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseCard {
    pub id: String,
    pub original: String,
    pub expression: String,
    pub explanation: String,
    pub examples: Vec<String>,
    /// YYYY-MM-DD on the local calendar.
    pub due_date: String,
    /// 0 for a new card that has not been reviewed yet.
    pub interval_days: u32,
    pub source_session_id: Option<String>,
}

pub fn next_interval(current: u32, rating: &str) -> Result<u32> {
    Ok(match rating {
        "again" => 1,
        "hard" => current.max(1),
        "good" => LADDER.iter().copied().find(|d| *d > current).unwrap_or(LADDER[LADDER.len() - 1]),
        _ => return Err("Rate the recall as Again, Hard or Good.".into()),
    })
}

pub fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

pub struct PhraseText<'a> {
    pub original: &'a str,
    pub expression: &'a str,
    pub explanation: &'a str,
    pub examples: &'a [String],
}

impl PhraseText<'_> {
    fn validate(&self) -> Result<String> {
        let bad = |s: &str, min: usize, max: usize| s.trim().chars().count() < min || s.chars().count() > max || s.contains('\0');
        if bad(self.original, 1, 500) || bad(self.expression, 1, 200) || bad(self.explanation, 0, 500) {
            return Err("Write what you said (up to 500 characters) and the better expression (up to 200); keep the note under 500.".into());
        }
        let examples: Vec<String> = self.examples.iter().map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect();
        if examples.len() > 5 || examples.iter().any(|e| e.chars().count() > 300 || e.contains('\0')) {
            return Err("Add up to 5 examples of up to 300 characters each.".into());
        }
        serde_json::to_string(&examples).map_err(|e| e.to_string())
    }
}

type Row = (String, String, String, String, String, String, i64, Option<String>);

fn card(row: Row) -> PhraseCard {
    let (id, original, expression, explanation, examples, due_date, interval, source) = row;
    PhraseCard {
        id,
        original,
        expression,
        explanation,
        // A damaged list of examples hides the examples, never the card.
        examples: serde_json::from_str(&examples).unwrap_or_default(),
        due_date,
        interval_days: interval.clamp(0, 365) as u32,
        source_session_id: source,
    }
}

const COLUMNS: &str = "id,original,expression,explanation,examples,due_date,interval_days,source_session_id";

impl DatabaseOwner {
    pub fn list_phrases(&self) -> Result<Vec<PhraseCard>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM phrase_cards WHERE deleted_at_ms IS NULL ORDER BY due_date, created_at_ms, id"))
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))
            .map_err(db_error)?;
        Ok(rows.collect::<rusqlite::Result<Vec<Row>>>().map_err(db_error)?.into_iter().map(card).collect())
    }

    fn phrase(&self, conn: &rusqlite::Connection, id: &str) -> Result<PhraseCard> {
        conn.query_row(&format!("SELECT {COLUMNS} FROM phrase_cards WHERE id=?1 AND deleted_at_ms IS NULL"), [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))
        })
        .optional()
        .map_err(db_error)?
        .map(card)
        .ok_or_else(|| "This phrase no longer exists.".to_string())
    }

    /// Records a recall and schedules the next one from `today`.
    pub fn review_phrase(&self, id: &str, rating: &str, today: NaiveDate) -> Result<PhraseCard> {
        recording::validate_id(id)?;
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let current = self.phrase(&conn, id)?;
        let next = next_interval(current.interval_days, rating)?;
        let due = (today + Duration::days(i64::from(next))).format("%Y-%m-%d").to_string();
        let tx = conn.transaction().map_err(db_error)?;
        tx.execute(
            "INSERT INTO phrase_reviews(card_id,rating,interval_before,interval_after,due_date,reviewed_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, rating, current.interval_days, next, due, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        tx.execute("UPDATE phrase_cards SET interval_days=?1, due_date=?2 WHERE id=?3", params![next, due, id]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(PhraseCard { interval_days: next, due_date: due, ..current })
    }

    /// Adds a new card, due today.
    pub fn add_phrase(&self, text: &PhraseText, source_session_id: Option<&str>, today: NaiveDate) -> Result<PhraseCard> {
        let examples = text.validate()?;
        if let Some(session) = source_session_id {
            recording::validate_id(session)?;
        }
        let now = recording::now_ms();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("phrase-{now}") } else { format!("phrase-{now}-{n}") };
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM phrase_cards WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                break candidate;
            }
            n += 1;
        };
        conn.execute(
            "INSERT INTO phrase_cards(id,original,expression,explanation,examples,source_session_id,due_date,interval_days,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8)",
            params![id, text.original.trim(), text.expression.trim(), text.explanation.trim(), examples, source_session_id, today.format("%Y-%m-%d").to_string(), now as i64],
        )
        .map_err(db_error)?;
        self.phrase(&conn, &id)
    }

    /// Changes a card's text; its schedule and history stay.
    pub fn update_phrase(&self, id: &str, text: &PhraseText) -> Result<PhraseCard> {
        recording::validate_id(id)?;
        let examples = text.validate()?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let changed = conn
            .execute(
                "UPDATE phrase_cards SET original=?1, expression=?2, explanation=?3, examples=?4 WHERE id=?5 AND deleted_at_ms IS NULL",
                params![text.original.trim(), text.expression.trim(), text.explanation.trim(), examples, id],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err("This phrase no longer exists.".into());
        }
        self.phrase(&conn, id)
    }

    /// Removes a card from practice; its review history is kept.
    pub fn delete_phrase(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        match conn
            .execute("UPDATE phrase_cards SET deleted_at_ms=?1 WHERE id=?2 AND deleted_at_ms IS NULL", params![recording::now_ms() as i64, id])
            .map_err(db_error)?
        {
            1 => Ok(()),
            _ => Err("This phrase no longer exists.".into()),
        }
    }

    pub fn phrase_review_count(&self, id: &str) -> Result<u32> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.query_row("SELECT count(*) FROM phrase_reviews WHERE card_id=?1", [id], |r| r.get::<_, i64>(0)).map(|n| n.max(0) as u32).map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_ladder_matches_the_documented_rule() {
        assert_eq!(next_interval(0, "good").unwrap(), 1);
        assert_eq!(next_interval(1, "good").unwrap(), 3);
        assert_eq!(next_interval(14, "good").unwrap(), 30);
        assert_eq!(next_interval(30, "good").unwrap(), 30);
        assert_eq!(next_interval(7, "hard").unwrap(), 7);
        assert_eq!(next_interval(0, "hard").unwrap(), 1);
        assert_eq!(next_interval(14, "again").unwrap(), 1);
        assert!(next_interval(3, "easy").is_err());
    }

    #[test]
    fn starter_phrases_are_due_and_reviews_schedule_add_edit_and_delete_keep_history() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let starters = db.list_phrases().unwrap();
        assert_eq!(starters.len(), 5);
        assert!(starters.iter().all(|p| p.interval_days == 0 && p.due_date == today().format("%Y-%m-%d").to_string()));
        assert_eq!(starters[2].expression, "It's better to plan ahead");

        let examples = vec!["  I tend to start with the conclusion. ".to_string(), "".to_string()];
        let text = PhraseText { original: "I start with the end", expression: "I tend to lead with the conclusion", explanation: "Clearer in meetings.", examples: &examples };
        let added = db.add_phrase(&text, Some("session-1"), day("2026-10-09")).unwrap();
        assert_eq!((added.due_date.as_str(), added.interval_days, added.examples.len()), ("2026-10-09", 0, 1));
        let good = db.review_phrase(&added.id, "good", day("2026-10-09")).unwrap();
        assert_eq!((good.interval_days, good.due_date.as_str()), (1, "2026-10-10"));
        let good = db.review_phrase(&added.id, "good", day("2026-10-10")).unwrap();
        assert_eq!((good.interval_days, good.due_date.as_str()), (3, "2026-10-13"));
        let again = db.review_phrase(&added.id, "again", day("2026-10-13")).unwrap();
        assert_eq!((again.interval_days, again.due_date.as_str()), (1, "2026-10-14"));
        assert!(db.review_phrase(&added.id, "perfect", day("2026-10-14")).is_err());

        let edited = db
            .update_phrase(&added.id, &PhraseText { original: "I start with the end", expression: "I lead with the conclusion", explanation: "", examples: &[] })
            .unwrap();
        assert_eq!((edited.expression.as_str(), edited.interval_days), ("I lead with the conclusion", 1), "editing keeps the schedule");
        assert!(db.update_phrase(&added.id, &PhraseText { original: " ", expression: "x", explanation: "", examples: &[] }).is_err());

        db.delete_phrase(&added.id).unwrap();
        assert!(db.list_phrases().unwrap().iter().all(|p| p.id != added.id));
        assert_eq!(db.phrase_review_count(&added.id).unwrap(), 3, "history is kept");
        assert!(db.review_phrase(&added.id, "good", day("2026-10-15")).is_err());
        assert!(db.delete_phrase(&added.id).is_err());
    }
}
