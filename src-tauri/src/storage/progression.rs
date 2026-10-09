//! Progression events (plan 4.18, §7): every change of stage, and every time
//! you chose to stay or go easier, with the reason shown at the time. The
//! current stage is the latest event's; the app never advances on its own.
use super::{db_error, iso, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::params;
use serde::Serialize;

pub const STAGES: u32 = 5;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionEvent {
    pub kind: String,
    pub stage_from: u32,
    pub stage_to: u32,
    pub reason: String,
    pub created_at: String,
}

impl DatabaseOwner {
    pub fn list_progression_events(&self) -> Result<Vec<ProgressionEvent>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare("SELECT kind,stage_from,stage_to,reason,created_at_ms FROM progression_events ORDER BY created_at_ms, id")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok(ProgressionEvent { kind: r.get(0)?, stage_from: r.get(1)?, stage_to: r.get(2)?, reason: r.get(3)?, created_at: iso(r.get(4)?) }))
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Records your choice. `advance` and `easier` move one stage; `stay` keeps it.
    pub fn record_progression(&self, kind: &str, reason: &str) -> Result<ProgressionEvent> {
        let reason = reason.trim();
        if reason.chars().count() > 500 || reason.contains('\0') {
            return Err("Keep the reason under 500 characters.".into());
        }
        let from = self.list_progression_events()?.last().map_or(1, |e| e.stage_to);
        let to = match kind {
            "advance" if from < STAGES => from + 1,
            "easier" if from > 1 => from - 1,
            "stay" => from,
            "advance" => return Err("You are already at the last stage.".into()),
            "easier" => return Err("You are already at the first stage.".into()),
            _ => return Err("Choose advance, easier or stay.".into()),
        };
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO progression_events(kind,stage_from,stage_to,reason,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
            params![kind, from, to, reason, recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        drop(conn);
        self.list_progression_events()?.pop().ok_or_else(|| "The choice could not be read back.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    #[test]
    fn stages_move_one_step_only_by_your_choice_and_keep_their_reasons() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.list_progression_events().unwrap().is_empty());
        assert!(db.record_progression("easier", "").is_err(), "stage 1 is the first");
        let up = db.record_progression("advance", "3 unfamiliar sessions on 2 days").unwrap();
        assert_eq!((up.stage_from, up.stage_to, up.reason.as_str()), (1, 2, "3 unfamiliar sessions on 2 days"));
        assert_eq!(db.record_progression("stay", "Not yet").unwrap().stage_to, 2);
        assert_eq!(db.record_progression("easier", "Felt hard").unwrap().stage_to, 1);
        assert!(db.record_progression("jump", "").is_err());
        assert_eq!(db.list_progression_events().unwrap().len(), 3);
        for _ in 0..4 {
            db.record_progression("advance", "").unwrap();
        }
        assert!(db.record_progression("advance", "").is_err(), "five stages");
    }
}
