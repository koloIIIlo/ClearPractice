//! Game core storage (roadmap M9, D-29, D-31): levels you reached, achievements,
//! personal records and this week's quests. The rules that decide them live in
//! the interface (`src/lib/engagement`); this module records each unlock once,
//! validates it, and awards its XP in the same transaction. Nothing here is
//! removed by Trash or permanent deletion (A-28), and evidence holds IDs and
//! numbers only (A-30).
use super::engagement::award;
use super::{db_error, iso, DatabaseOwner, Result};
use crate::engagement::{EventKind, NewEvent};
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AREAS: [&str; 8] = ["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"];
/// Personal records with their unit and direction (appendix B.4). `true` means lower is better.
pub const RECORDS: [(&str, &str, bool); 12] = [
    ("longest_take", "s", false),
    ("longest_run", "words", false),
    ("mean_run_unfamiliar", "words", false),
    ("different_per_50", "words in 50", false),
    ("fewest_confirmed_per_100_unfamiliar", "per 100 words", true),
    ("phrases_in_one_take", "phrases", false),
    ("jam_clean_seconds", "s", false),
    ("word_bomb_woven", "words", false),
    ("pace_range", "syll/s", false),
    ("emphasis_hits", "sentences", false),
    ("gauntlet_rounds", "rounds", false),
    ("conversation_turns", "turns", false),
];
const MAX_EVIDENCE_BYTES: usize = 4096;
/// Weeks of quests returned with the state: this one and the three before (slot 3 avoids repeats).
const QUEST_HISTORY_DAYS: i64 = 28;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelRow {
    pub area: String,
    pub level: u8,
    pub definition_version: u32,
    pub evidence: Value,
    pub achieved_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementRow {
    pub id: String,
    pub definition_version: u32,
    pub evidence: Value,
    pub unlocked_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRow {
    pub id: i64,
    pub record: String,
    pub value: f64,
    pub unit: String,
    pub previous: Option<f64>,
    pub attempt_id: Option<String>,
    pub session_id: Option<String>,
    pub definition_version: u32,
    pub achieved_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestRow {
    pub week: String,
    pub slot: u8,
    pub quest: String,
    pub params: Value,
    pub swapped: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngagementState {
    pub levels: Vec<LevelRow>,
    pub achievements: Vec<AchievementRow>,
    /// Every best ever recorded, oldest first, so a record's history can be shown.
    pub records: Vec<RecordRow>,
    /// Quests of this week and the three before.
    pub quests: Vec<QuestRow>,
    /// Weeks whose goal was met (the `weekly_goal` events), oldest first.
    pub goal_weeks: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewLevel {
    pub area: String,
    pub level: u8,
    pub definition_version: u32,
    #[serde(default)]
    pub evidence: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewAchievement {
    pub id: String,
    pub definition_version: u32,
    #[serde(default)]
    pub evidence: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewRecord {
    pub record: String,
    pub value: f64,
    pub unit: String,
    pub attempt_id: Option<String>,
    pub session_id: Option<String>,
    pub definition_version: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestRef {
    pub week: String,
    pub slot: u8,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnlockInput {
    #[serde(default)]
    pub levels: Vec<NewLevel>,
    #[serde(default)]
    pub achievements: Vec<NewAchievement>,
    #[serde(default)]
    pub records: Vec<NewRecord>,
    #[serde(default)]
    pub quests_done: Vec<QuestRef>,
    pub weekly_goal: Option<String>,
    /// The local date the unlocks are earned on (their events' day).
    pub local_date: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestInput {
    pub slot: u8,
    pub quest: String,
    #[serde(default)]
    pub params: Value,
}

/// What was actually new, for celebrations.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockOutcome {
    pub levels: Vec<LevelRow>,
    pub achievements: Vec<AchievementRow>,
    /// Stored bests: a starting point has `previous: null` and earns nothing.
    pub records: Vec<RecordRow>,
    pub quests_done: Vec<QuestRow>,
    pub weekly_goal: Option<String>,
    pub xp: u32,
}

fn valid_date(date: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok().filter(|d| d.format("%Y-%m-%d").to_string() == date)
}

/// A week is named by its first day: a Monday, or a Sunday for Sunday weeks.
pub fn valid_week(week: &str) -> Result<chrono::NaiveDate> {
    use chrono::Datelike;
    valid_date(week)
        .filter(|d| matches!(d.weekday(), chrono::Weekday::Mon | chrono::Weekday::Sun))
        .ok_or_else(|| "A week starts on a Monday or a Sunday.".to_string())
}

fn valid_slug(id: &str) -> bool {
    (2..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Evidence is IDs and numbers only, in arrays or objects, at most 4 KB (A-30).
pub fn validate_evidence(evidence: &Value) -> Result<String> {
    fn ok(v: &Value, depth: u8) -> bool {
        depth < 6
            && match v {
                Value::Null | Value::Bool(_) => true,
                Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
                Value::String(s) => recording::validate_id(s).is_ok() || valid_date(s).is_some(),
                Value::Array(items) => items.iter().all(|i| ok(i, depth + 1)),
                Value::Object(map) => map.iter().all(|(k, i)| k.len() <= 40 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') && ok(i, depth + 1)),
            }
    }
    let evidence = if evidence.is_null() { Value::Object(Default::default()) } else { evidence.clone() };
    let text = evidence.to_string();
    if text.len() > MAX_EVIDENCE_BYTES || !ok(&evidence, 0) {
        return Err("Evidence holds IDs and numbers only.".into());
    }
    Ok(text)
}

fn record_def(record: &str) -> Option<(&'static str, &'static str, bool)> {
    RECORDS.iter().copied().find(|(id, _, _)| *id == record)
}

fn level_row(r: &rusqlite::Row) -> rusqlite::Result<LevelRow> {
    Ok(LevelRow { area: r.get(0)?, level: r.get(1)?, definition_version: r.get(2)?, evidence: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(Value::Null), achieved_at: iso(r.get(4)?) })
}
fn achievement_row(r: &rusqlite::Row) -> rusqlite::Result<AchievementRow> {
    Ok(AchievementRow { id: r.get(0)?, definition_version: r.get(1)?, evidence: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or(Value::Null), unlocked_at: iso(r.get(3)?) })
}
fn record_row(r: &rusqlite::Row) -> rusqlite::Result<RecordRow> {
    Ok(RecordRow {
        id: r.get(0)?, record: r.get(1)?, value: r.get(2)?, unit: r.get(3)?, previous: r.get(4)?, attempt_id: r.get(5)?, session_id: r.get(6)?,
        definition_version: r.get(7)?, achieved_at: iso(r.get(8)?),
    })
}
fn quest_row(r: &rusqlite::Row) -> rusqlite::Result<QuestRow> {
    Ok(QuestRow {
        week: r.get(0)?, slot: r.get(1)?, quest: r.get(2)?, params: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(Value::Null),
        swapped: r.get(4)?, created_at: iso(r.get(5)?), completed_at: r.get::<_, Option<i64>>(6)?.map(iso),
    })
}
const LEVEL_COLUMNS: &str = "area,level,definition_version,evidence,achieved_at_ms";
const ACHIEVEMENT_COLUMNS: &str = "id,definition_version,evidence,unlocked_at_ms";
const RECORD_COLUMNS: &str = "id,record,value,unit,previous,attempt_id,session_id,definition_version,achieved_at_ms";
const QUEST_COLUMNS: &str = "week,slot,quest,params,swapped,created_at_ms,completed_at_ms";

// Use the production statements in the seeded planner review.
pub(crate) fn journey_levels() -> String { format!("SELECT {LEVEL_COLUMNS} FROM skill_levels ORDER BY achieved_at_ms,area,level") }
pub(crate) fn journey_achievements() -> String { format!("SELECT {ACHIEVEMENT_COLUMNS} FROM achievements ORDER BY unlocked_at_ms,id") }
pub(crate) fn journey_records() -> String { format!("SELECT {RECORD_COLUMNS} FROM personal_records ORDER BY achieved_at_ms,id") }
pub(crate) fn journey_quests() -> String { format!("SELECT {QUEST_COLUMNS} FROM weekly_quests WHERE week>=?1 AND week<=?2 ORDER BY week,slot") }


fn quests_of(conn: &Connection, week: &str) -> Result<Vec<QuestRow>> {
    let mut stmt = conn.prepare(&format!("SELECT {QUEST_COLUMNS} FROM weekly_quests WHERE week=?1 ORDER BY slot")).map_err(db_error)?;
    let rows = stmt.query_map([week], quest_row).map_err(db_error)?;
    rows.collect::<rusqlite::Result<_>>().map_err(db_error)
}

impl DatabaseOwner {
    /// Everything earned so far, and the quests of this week and the three before.
    pub fn engagement_state(&self, week: &str) -> Result<EngagementState> {
        let start = valid_week(week)?;
        let since = (start - chrono::Duration::days(QUEST_HISTORY_DAYS)).format("%Y-%m-%d").to_string();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare(&journey_levels()).map_err(db_error)?;
        let levels = stmt.query_map([], level_row).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        let mut stmt = conn.prepare(&journey_achievements()).map_err(db_error)?;
        let achievements = stmt.query_map([], achievement_row).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        let mut stmt = conn.prepare(&journey_records()).map_err(db_error)?;
        let records = stmt.query_map([], record_row).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        let mut stmt = conn
            .prepare(&journey_quests())
            .map_err(db_error)?;
        let quests = stmt.query_map(params![since, week], quest_row).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        let mut stmt = conn.prepare("SELECT ref_id FROM practice_events WHERE kind='weekly_goal' ORDER BY ref_id").map_err(db_error)?;
        let goal_weeks = stmt.query_map([], |r| r.get(0)).map_err(db_error)?.collect::<rusqlite::Result<_>>().map_err(db_error)?;
        Ok(EngagementState { levels, achievements, records, quests, goal_weeks })
    }

    /// Records each unlock once and awards its XP in the same transaction:
    /// level_reached ("area:level"), achievement (its ID), personal_record
    /// ("record:row"), quest ("week:slot") and weekly_goal (the week). Returns
    /// what was actually new. A level needs the one below it.
    pub fn record_unlocks(&self, input: &UnlockInput) -> Result<UnlockOutcome> {
        if valid_date(&input.local_date).is_none() {
            return Err("Invalid date.".into());
        }
        // Validate everything before writing anything.
        for level in &input.levels {
            if !AREAS.contains(&level.area.as_str()) {
                return Err("Unknown skill area.".into());
            }
            if !(1..=5).contains(&level.level) || level.definition_version == 0 {
                return Err("Levels go from 1 to 5.".into());
            }
            validate_evidence(&level.evidence)?;
        }
        for achievement in &input.achievements {
            if !(3..=40).contains(&achievement.id.len()) || !valid_slug(&achievement.id) || achievement.definition_version == 0 {
                return Err("Unknown achievement.".into());
            }
            validate_evidence(&achievement.evidence)?;
        }
        for record in &input.records {
            match record_def(&record.record) {
                Some((_, unit, _)) if unit == record.unit => {}
                _ => return Err("Unknown personal record.".into()),
            }
            if !record.value.is_finite() || record.value < 0.0 || record.definition_version == 0 {
                return Err("A record is a number of zero or more.".into());
            }
            for id in record.attempt_id.iter().chain(&record.session_id) {
                recording::validate_id(id)?;
            }
        }
        for quest in &input.quests_done {
            valid_week(&quest.week)?;
            if !(1..=3).contains(&quest.slot) {
                return Err("A week has three quests.".into());
            }
        }
        if let Some(week) = &input.weekly_goal {
            valid_week(week)?;
        }
        let now = recording::now_ms() as i64;
        let date = input.local_date.as_str();
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        let mut outcome = UnlockOutcome::default();
        let earn = |tx: &Connection, kind: EventKind, ref_id: &str, outcome: &mut UnlockOutcome| -> Result<()> {
            if award(tx, &NewEvent { kind, ref_id, local_date: date, session_id: None, attempt_id: None, created_at_ms: now, backfilled: false })? {
                outcome.xp += kind.xp();
            }
            Ok(())
        };

        for level in &input.levels {
            let below_present = level.level == 1
                || tx.query_row("SELECT EXISTS(SELECT 1 FROM skill_levels WHERE area=?1 AND level=?2)", params![level.area, level.level - 1], |r| r.get::<_, bool>(0)).map_err(db_error)?;
            if !below_present {
                return Err(format!("Level {} of {} comes after level {}.", level.level, level.area, level.level - 1));
            }
            let added = tx
                .execute(
                    "INSERT OR IGNORE INTO skill_levels(area,level,definition_version,evidence,achieved_at_ms) VALUES (?1,?2,?3,?4,?5)",
                    params![level.area, level.level, level.definition_version, validate_evidence(&level.evidence)?, now],
                )
                .map_err(db_error)?;
            if added == 1 {
                earn(&tx, EventKind::LevelReached, &format!("{}:{}", level.area, level.level), &mut outcome)?;
                outcome.levels.push(tx.query_row(&format!("SELECT {LEVEL_COLUMNS} FROM skill_levels WHERE area=?1 AND level=?2"), params![level.area, level.level], level_row).map_err(db_error)?);
            }
        }
        for achievement in &input.achievements {
            let added = tx
                .execute(
                    "INSERT OR IGNORE INTO achievements(id,definition_version,evidence,unlocked_at_ms) VALUES (?1,?2,?3,?4)",
                    params![achievement.id, achievement.definition_version, validate_evidence(&achievement.evidence)?, now],
                )
                .map_err(db_error)?;
            if added == 1 {
                earn(&tx, EventKind::Achievement, &achievement.id, &mut outcome)?;
                outcome.achievements.push(tx.query_row(&format!("SELECT {ACHIEVEMENT_COLUMNS} FROM achievements WHERE id=?1"), [&achievement.id], achievement_row).map_err(db_error)?);
            }
        }
        for record in &input.records {
            let (_, _, lower_is_better) = record_def(&record.record).expect("validated above");
            let best: Option<f64> = tx
                .query_row(
                    &format!("SELECT {}(value) FROM personal_records WHERE record=?1", if lower_is_better { "MIN" } else { "MAX" }),
                    [&record.record],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            // Ties and worse values are not new; the first value is the starting point.
            if best.is_some_and(|b| if lower_is_better { record.value >= b } else { record.value <= b }) {
                continue;
            }
            tx.execute(
                "INSERT INTO personal_records(record,value,unit,previous,attempt_id,session_id,definition_version,achieved_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![record.record, record.value, record.unit, best, record.attempt_id, record.session_id, record.definition_version, now],
            )
            .map_err(db_error)?;
            let id = tx.last_insert_rowid();
            if best.is_some() {
                earn(&tx, EventKind::PersonalRecord, &format!("{}:{id}", record.record), &mut outcome)?;
            }
            outcome.records.push(tx.query_row(&format!("SELECT {RECORD_COLUMNS} FROM personal_records WHERE id=?1"), [id], record_row).map_err(db_error)?);
        }
        for quest in &input.quests_done {
            let done = tx
                .execute("UPDATE weekly_quests SET completed_at_ms=?3 WHERE week=?1 AND slot=?2 AND completed_at_ms IS NULL", params![quest.week, quest.slot, now])
                .map_err(db_error)?;
            if done == 1 {
                earn(&tx, EventKind::Quest, &format!("{}:{}", quest.week, quest.slot), &mut outcome)?;
                outcome.quests_done.push(tx.query_row(&format!("SELECT {QUEST_COLUMNS} FROM weekly_quests WHERE week=?1 AND slot=?2"), params![quest.week, quest.slot], quest_row).map_err(db_error)?);
            }
        }
        if let Some(week) = &input.weekly_goal {
            let before = outcome.xp;
            earn(&tx, EventKind::WeeklyGoal, week, &mut outcome)?;
            if outcome.xp > before {
                outcome.weekly_goal = Some(week.clone());
            }
        }
        tx.commit().map_err(db_error)?;
        Ok(outcome)
    }

    /// Stores this week's quests the first time they are shown; slots already
    /// stored stay as they are, so later changes never reshuffle a week.
    pub fn set_weekly_quests(&self, week: &str, quests: &[QuestInput]) -> Result<Vec<QuestRow>> {
        valid_week(week)?;
        if quests.len() > 3 {
            return Err("A week has three quests.".into());
        }
        for quest in quests {
            if !(1..=3).contains(&quest.slot) || !valid_slug(&quest.quest) {
                return Err("Unknown quest.".into());
            }
            validate_evidence(&quest.params)?;
        }
        let now = recording::now_ms() as i64;
        let mut conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.transaction().map_err(db_error)?;
        for quest in quests {
            tx.execute(
                "INSERT OR IGNORE INTO weekly_quests(week,slot,quest,params,created_at_ms) VALUES (?1,?2,?3,?4,?5)",
                params![week, quest.slot, quest.quest, validate_evidence(&quest.params)?, now],
            )
            .map_err(db_error)?;
        }
        let rows = quests_of(&tx, week)?;
        tx.commit().map_err(db_error)?;
        Ok(rows)
    }

    /// One swap a week, never for a completed quest.
    pub fn swap_weekly_quest(&self, week: &str, slot: u8, quest: &QuestInput) -> Result<QuestRow> {
        valid_week(week)?;
        if !(1..=3).contains(&slot) || !valid_slug(&quest.quest) {
            return Err("Unknown quest.".into());
        }
        let params_json = validate_evidence(&quest.params)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let swapped: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM weekly_quests WHERE week=?1 AND swapped=1)", [week], |r| r.get(0)).map_err(db_error)?;
        if swapped {
            return Err("You've already swapped a quest this week.".into());
        }
        let current: Option<(Option<i64>, String)> = conn
            .query_row("SELECT completed_at_ms,quest FROM weekly_quests WHERE week=?1 AND slot=?2", params![week, slot], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(db_error)?;
        match current {
            None => return Err("This quest is no longer available.".into()),
            Some((Some(_), _)) => return Err("A finished quest stays.".into()),
            Some((None, same)) if same == quest.quest => return Err("Choose a different quest.".into()),
            Some(_) => {}
        }
        conn.execute("UPDATE weekly_quests SET quest=?3,params=?4,swapped=1 WHERE week=?1 AND slot=?2", params![week, slot, quest.quest, params_json]).map_err(db_error)?;
        conn.query_row(&format!("SELECT {QUEST_COLUMNS} FROM weekly_quests WHERE week=?1 AND slot=?2"), params![week, slot], quest_row).map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;
    use serde_json::json;

    const MONDAY: &str = "2026-10-12";

    fn input() -> UnlockInput {
        UnlockInput { levels: vec![], achievements: vec![], records: vec![], quests_done: vec![], weekly_goal: None, local_date: "2026-10-16".into() }
    }
    fn level(area: &str, level: u8) -> NewLevel {
        NewLevel { area: area.into(), level, definition_version: 1, evidence: json!({ "takes": ["take-1", "take-2"] }) }
    }
    fn record(id: &str, value: f64, unit: &str) -> NewRecord {
        NewRecord { record: id.into(), value, unit: unit.into(), attempt_id: Some("take-1".into()), session_id: Some("s-1".into()), definition_version: 1 }
    }
    fn xp(db: &DatabaseOwner, kind: &str) -> i64 {
        db.connection.lock().unwrap().query_row("SELECT COALESCE(SUM(xp),0) FROM practice_events WHERE kind=?1", [kind], |r| r.get(0)).unwrap()
    }

    #[test]
    fn record_unlocks_inserts_once_and_awards_xp_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let unlocks = UnlockInput {
            levels: vec![level("fluency", 1)],
            achievements: vec![NewAchievement { id: "first-take".into(), definition_version: 1, evidence: json!({}) }],
            weekly_goal: Some(MONDAY.into()),
            ..input()
        };
        let first = db.record_unlocks(&unlocks).unwrap();
        assert_eq!((first.levels.len(), first.achievements.len(), first.weekly_goal.as_deref(), first.xp), (1, 1, Some(MONDAY), 50 + 20 + 50));
        assert_eq!(first.levels[0].evidence, json!({ "takes": ["take-1", "take-2"] }));
        let again = db.record_unlocks(&unlocks).unwrap();
        assert_eq!(again, UnlockOutcome::default(), "nothing is new the second time");
        assert_eq!((xp(&db, "level_reached"), xp(&db, "achievement"), xp(&db, "weekly_goal")), (50, 20, 50));
        let state = db.engagement_state(MONDAY).unwrap();
        assert_eq!((state.levels.len(), state.achievements.len(), state.goal_weeks.clone()), (1, 1, vec![MONDAY.to_string()]));
        assert!(db.record_unlocks(&UnlockInput { levels: vec![level("charisma", 1)], ..input() }).is_err());
        assert!(db.record_unlocks(&UnlockInput { achievements: vec![NewAchievement { id: "No Spaces".into(), definition_version: 1, evidence: json!({}) }], ..input() }).is_err());
        assert!(db.record_unlocks(&UnlockInput { weekly_goal: Some("2026-10-14".into()), ..input() }).is_err(), "a week starts on Monday or Sunday");
    }

    #[test]
    fn levels_must_be_recorded_in_order() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.record_unlocks(&UnlockInput { levels: vec![level("structure", 2)], ..input() }).is_err());
        assert!(db.engagement_state(MONDAY).unwrap().levels.is_empty(), "a refused input writes nothing");
        // Two levels in one input are fine when in order.
        let outcome = db.record_unlocks(&UnlockInput { levels: vec![level("structure", 1), level("structure", 2)], ..input() }).unwrap();
        assert_eq!(outcome.levels.iter().map(|l| l.level).collect::<Vec<_>>(), [1, 2]);
        assert!(db.record_unlocks(&UnlockInput { levels: vec![level("structure", 4)], ..input() }).is_err());
        assert!(db.record_unlocks(&UnlockInput { levels: vec![level("structure", 6)], ..input() }).is_err());
    }

    #[test]
    fn records_only_store_improvements_and_keep_history() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let save = |r: NewRecord| db.record_unlocks(&UnlockInput { records: vec![r], ..input() }).unwrap();
        let start = save(record("longest_run", 11.0, "words"));
        assert_eq!((start.records[0].previous, start.xp), (None, 0), "the first value is a silent starting point");
        assert!(save(record("longest_run", 11.0, "words")).records.is_empty(), "a tie is not new");
        assert!(save(record("longest_run", 9.0, "words")).records.is_empty());
        let better = save(record("longest_run", 14.0, "words"));
        assert_eq!((better.records[0].previous, better.xp), (Some(11.0), 25));
        // Lower is better for the filler record.
        save(record("fewest_confirmed_per_100_unfamiliar", 3.0, "per 100 words"));
        assert!(save(record("fewest_confirmed_per_100_unfamiliar", 4.0, "per 100 words")).records.is_empty());
        assert_eq!(save(record("fewest_confirmed_per_100_unfamiliar", 2.5, "per 100 words")).records[0].previous, Some(3.0));
        let history: Vec<f64> = db.engagement_state(MONDAY).unwrap().records.iter().filter(|r| r.record == "longest_run").map(|r| r.value).collect();
        assert_eq!(history, [11.0, 14.0]);
        assert!(db.record_unlocks(&UnlockInput { records: vec![record("longest_run", 20.0, "seconds")], ..input() }).is_err(), "unit must match");
        assert!(db.record_unlocks(&UnlockInput { records: vec![record("loudest", 20.0, "dB")], ..input() }).is_err());
        assert!(db.record_unlocks(&UnlockInput { records: vec![record("longest_run", f64::NAN, "words")], ..input() }).is_err());
    }

    #[test]
    fn quests_are_frozen_per_week_and_swappable_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let quest = |slot: u8, id: &str| QuestInput { slot, quest: id.into(), params: json!({}) };
        let set = db.set_weekly_quests(MONDAY, &[quest(1, "unfamiliar-2"), quest(2, "real-1"), quest(3, "phrases-10")]).unwrap();
        assert_eq!(set.iter().map(|q| q.quest.as_str()).collect::<Vec<_>>(), ["unfamiliar-2", "real-1", "phrases-10"]);
        // Shown again with other quests: the stored week stays.
        let again = db.set_weekly_quests(MONDAY, &[quest(1, "imitate-1"), quest(2, "real-1"), quest(3, "story-1")]).unwrap();
        assert_eq!(again, set);
        let done = db.record_unlocks(&UnlockInput { quests_done: vec![QuestRef { week: MONDAY.into(), slot: 3 }], ..input() }).unwrap();
        assert_eq!((done.quests_done.len(), done.xp), (1, 30));
        assert!(db.swap_weekly_quest(MONDAY, 3, &quest(3, "story-1")).is_err(), "a finished quest stays");
        let swapped = db.swap_weekly_quest(MONDAY, 1, &quest(1, "imitate-1")).unwrap();
        assert_eq!((swapped.quest.as_str(), swapped.swapped), ("imitate-1", true));
        assert!(db.swap_weekly_quest(MONDAY, 2, &quest(2, "story-1")).is_err(), "one swap a week");
        assert!(db.set_weekly_quests("2026-10-13", &[quest(1, "real-1")]).is_err(), "a Tuesday is no week start");
        assert_eq!(db.engagement_state(MONDAY).unwrap().quests.len(), 3);
        assert!(db.engagement_state("2026-11-16").unwrap().quests.is_empty(), "older weeks fall out of the state");
    }

    #[test]
    fn evidence_with_text_is_refused() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        for evidence in [json!({ "note": "I was nervous at the start" }), json!(["take-1", "So the first thing I do"]), json!({ "has space key": 1 }), json!("x".repeat(5000))] {
            let unlock = UnlockInput { achievements: vec![NewAchievement { id: "first-take".into(), definition_version: 1, evidence: evidence.clone() }], ..input() };
            assert!(db.record_unlocks(&unlock).is_err(), "{evidence}");
        }
        assert!(validate_evidence(&json!({ "takes": ["take-1"], "dates": ["2026-10-12"], "count": 3 })).is_ok());
        assert!(db.engagement_state(MONDAY).unwrap().achievements.is_empty());
    }
}
