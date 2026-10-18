//! M16.9: explicit compaction, monthly offers and planner maintenance.
use super::{db_error, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::OptionalExtension;
use serde::Serialize;
const DISMISSED_KEY: &str = "database_compaction_dismissed_ms";
// A conservative calendar month: never offer twice in any 31-day window.
const MONTH_MS: i64 = 31 * 86_400_000;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHealth {
    pub page_count: i64,
    pub free_pages: i64,
    pub page_size: i64,
    pub offer_compact: bool,
    pub dismissed_at_ms: Option<i64>,
}
impl Drop for DatabaseOwner {
    fn drop(&mut self) {
        // Best effort on every connection close, including restore and relocation.
        if let Ok(conn) = self.connection.get_mut() {
            let _ = conn.execute_batch("PRAGMA optimize;");
        }
    }
}
impl DatabaseOwner {
    pub fn optimize_database(&self) -> Result<()> {
        self.connection
            .lock()
            .map_err(|_| "Session storage is busy.")?
            .execute_batch("PRAGMA optimize;")
            .map_err(db_error)
    }
    pub fn database_health(&self) -> Result<DatabaseHealth> {
        self.database_health_at(recording::now_ms() as i64)
    }
    fn database_health_at(&self, now: i64) -> Result<DatabaseHealth> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage is busy.")?;
        let page_count = conn
            .pragma_query_value(None, "page_count", |r| r.get::<_, i64>(0))
            .map_err(db_error)?;
        let free_pages = conn
            .pragma_query_value(None, "freelist_count", |r| r.get::<_, i64>(0))
            .map_err(db_error)?;
        let page_size = conn
            .pragma_query_value(None, "page_size", |r| r.get::<_, i64>(0))
            .map_err(db_error)?;
        let dismissed_at_ms: Option<i64> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [DISMISSED_KEY],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(db_error)?
            .and_then(|s| s.parse().ok());
        Ok(DatabaseHealth {
            page_count,
            free_pages,
            page_size,
            dismissed_at_ms,
            offer_compact: page_count > 0
                && free_pages * 5 > page_count
                && dismissed_at_ms.is_none_or(|ms| now.saturating_sub(ms) >= MONTH_MS),
        })
    }
    pub fn dismiss_database_compaction(&self) -> Result<()> {
        self.connection.lock().map_err(|_| "Session storage is busy.")?.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", rusqlite::params![DISMISSED_KEY, recording::now_ms().to_string()]).map_err(db_error)?;
        Ok(())
    }
    /// Command holds CaptureService's start mutex for this entire operation.
    pub fn compact_database(&self) -> Result<()> {
        self.connection
            .lock()
            .map_err(|_| "Session storage is busy.")?
            .execute_batch("VACUUM; PRAGMA optimize;")
            .map_err(db_error)
    }
    pub fn database_usage(&self, usage: &mut Vec<crate::storage_usage::Category>) -> Result<()> {
        use crate::storage_usage::Category;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "Session storage is busy.")?;
        let groups: &[(&str, &str, &[&str])] = &[
            (
                "db-insights",
                "Insights and Journey",
                &[
                    "practice_events",
                    "phrase_uses",
                    "self_checks",
                    "audio_measures",
                    "comparisons",
                    "skill_levels",
                    "achievements",
                    "personal_records",
                    "weekly_quests",
                ],
            ),
            ("db-drills", "Drills", &["take_events", "activity_results"]),
            (
                "db-learning",
                "Learning",
                &[
                    "self_predictions",
                    "programmes",
                    "programme_steps",
                    "catch_runs",
                ],
            ),
            (
                "db-confidence",
                "Confidence",
                &[
                    "exposure_steps",
                    "exposure_attempts",
                    "segment_marks",
                    "routine_runs",
                ],
            ),
            (
                "db-conversations",
                "Conversations",
                &[
                    "conversations",
                    "conversation_turns",
                    "upgrade_runs",
                    "conversation_feedback",
                ],
            ),
            (
                "db-events",
                "Events and missions",
                &[
                    "mission_picks",
                    "events",
                    "event_plan_items",
                    "talks",
                    "talk_sections",
                    "rehearsals",
                    "capsule_months",
                ],
            ),
            (
                "db-listeners",
                "Listener packs",
                &["listener_packs", "listener_feedback"],
            ),
            (
                "db-clubs",
                "Club meetings",
                &["club_meetings", "club_speeches"],
            ),
            ("db-content", "Content packs", &["content_packs"]),
        ];
        let mut allocated = 0;
        for (key, label, tables) in groups {
            let quoted = tables
                .iter()
                .map(|t| format!("'{t}'"))
                .collect::<Vec<_>>()
                .join(",");
            let bytes: i64 = conn.query_row(&format!("SELECT coalesce(sum(d.pgsize),0) FROM dbstat d JOIN sqlite_schema s ON s.name=d.name WHERE s.tbl_name IN ({quoted})"), [], |r| r.get(0)).map_err(db_error)?;
            let bytes = u64::try_from(bytes).map_err(|_| "Database page size is invalid.")?;
            allocated += bytes;
            usage.push(Category {
                key,
                label,
                note: "Measured database pages, including indexes. Included in backups.",
                bytes,
                files: 0,
                clearable: false,
            });
        }
        if let Some(database) = usage.iter_mut().find(|c| c.key == "database") {
            // Remaining database, journal and safety snapshots; avoid double counting.
            database.bytes = database.bytes.saturating_sub(allocated);
            database.note = "Other database pages, free space, journals and safety snapshots.";
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;
    #[test]
    fn compaction_is_explicit_and_dismissal_lasts_a_month() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        {
            let conn = db.connection.lock().unwrap();
            conn.execute_batch("CREATE TABLE large_temp(data BLOB); INSERT INTO large_temp VALUES(zeroblob(2000000)); DROP TABLE large_temp;").unwrap();
        }
        let before = db.database_health().unwrap();
        assert!(before.offer_compact);
        db.dismiss_database_compaction().unwrap();
        let dismissed = db.database_health().unwrap();
        assert!(!dismissed.offer_compact);
        let at = dismissed.dismissed_at_ms.unwrap();
        assert!(
            !db.database_health_at(at + MONTH_MS - 1)
                .unwrap()
                .offer_compact
        );
        assert!(db.database_health_at(at + MONTH_MS).unwrap().offer_compact);
        assert_eq!(before.free_pages, db.database_health().unwrap().free_pages);
        db.compact_database().unwrap();
        assert!(db.database_health().unwrap().page_count < before.page_count);
        assert_eq!(db.database_health().unwrap().free_pages, 0);
        let mut usage = crate::storage_usage::usage(&root.0);
        let total: u64 = usage.iter().map(|c| c.bytes).sum();
        db.database_usage(&mut usage).unwrap();
        assert_eq!(total, usage.iter().map(|c| c.bytes).sum::<u64>());
        for key in [
            "db-drills",
            "db-learning",
            "db-confidence",
            "db-conversations",
            "db-events",
            "db-listeners",
            "db-clubs",
            "db-content",
        ] {
            assert!(usage.iter().any(|c| c.key == key && c.bytes > 0));
        }
    }
    #[test]
    fn opens_a_v24_database_and_adds_v25_tables() {
        let root = TestRoot::new();
        {
            let db = DatabaseOwner::open(&root.0).unwrap();
            let conn = db.connection.lock().unwrap();
            conn.execute("INSERT INTO club_meetings(id,title,local_date,created_at_ms) VALUES('old','Old meeting','2026-10-18',1)", []).unwrap();
            // Remove exactly the v25 objects to build the previous-version fixture.
            conn.execute_batch("DROP TABLE content_packs; DROP INDEX sessions_facts_active; DROP INDEX attempts_facts_active; DROP INDEX annotations_facts_fillers; DROP INDEX analysis_runs_facts; DROP INDEX transfer_reviews_facts; DROP INDEX transfer_reviews_event; DROP INDEX exposure_attempts_facts; DROP INDEX events_facts; DROP INDEX conversation_turns_role; DROP INDEX skill_levels_timeline; DROP INDEX achievements_timeline; DROP INDEX personal_records_timeline; PRAGMA user_version=24;").unwrap();
        }
        let db = DatabaseOwner::open(&root.0).unwrap();
        assert!(db.list_content_packs().unwrap().is_empty());
        assert_eq!(db.list_club_meetings().unwrap().len(), 1);
        let conn = db.connection.lock().unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            25
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
        assert!(std::fs::read_dir(root.0.join("database/snapshots"))
            .unwrap()
            .flatten()
            .any(|p| p.file_name().to_string_lossy().starts_with("before-v25-")));
    }
}

#[cfg(test)]
mod planner_tests {
    use super::super::{engagement, game};
    use super::*;
    use crate::storage::recording::tests::TestRoot;
    #[test]
    fn practice_facts_and_journey_use_indexes_on_growing_tables() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        engagement::tests::seed_history(&db, 60, 4);
        let conn = db.connection.lock().unwrap();
        conn.execute_batch("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
            INSERT INTO personal_records(record,value,unit,definition_version,achieved_at_ms) SELECT 'seed',x,'s',1,x FROM n;
            WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200)
            INSERT INTO achievements(id,definition_version,unlocked_at_ms) SELECT 'seed-'||x,1,x FROM n;
            WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<40)
            INSERT INTO skill_levels(area,level,definition_version,achieved_at_ms) SELECT 'area-'||(x/5),x%5+1,1,x FROM n;
            WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<104)
            INSERT INTO weekly_quests(week,slot,quest,created_at_ms) SELECT date('2024-10-21','+'||(x*7)||' days'),1,'seed',x FROM n;").unwrap();
        let queries = [
            (
                engagement::FACT_SESSIONS_SQL.to_string(),
                vec!["s", "a", "st"],
            ),
            (
                engagement::fact_takes_sql(),
                vec!["a", "st", "s", "r", "ar"],
            ),
            (engagement::FACT_METRICS_SQL.to_string(), vec!["ar", "mv"]),
            (game::journey_levels(), vec!["skill_levels"]),
            (game::journey_achievements(), vec!["achievements"]),
            (game::journey_records(), vec!["personal_records"]),
            (game::journey_quests(), vec!["weekly_quests"]),
            (
                "SELECT ref_id FROM practice_events WHERE kind='weekly_goal' ORDER BY ref_id"
                    .into(),
                vec!["practice_events"],
            ),
        ];
        for (sql, tables) in queries {
            let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            // Bind every production parameter to a valid representative value.
            for i in 1..=stmt.parameter_count() {
                stmt.raw_bind_parameter(i, "2026-10-18").unwrap();
            }
            let mut rows = stmt.raw_query();
            let mut details = Vec::new();
            while let Some(row) = rows.next().unwrap() {
                details.push(row.get::<_, String>(3).unwrap());
            }
            for table in tables {
                assert!(
                    !details.iter().any(|d| (d == &format!("SCAN {table}")
                        || d.starts_with(&format!("SCAN {table} ")))
                        && !d.contains("USING COVERING INDEX")),
                    "{table}: {details:?}\n{sql}"
                );
            }
        }
    }
}
