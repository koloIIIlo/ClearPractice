-- M16.3: imported practice content. Removal hides a pack; session snapshots
-- are independent. Whole-database backups include these rows; session exports
-- include only the content already captured in the session, not entire packs.
CREATE TABLE content_packs (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 version INTEGER NOT NULL CHECK(version = 1),
 json TEXT NOT NULL CHECK(length(CAST(json AS BLOB)) <= 1000000),
 imported_at_ms INTEGER NOT NULL,
 removed_at_ms INTEGER
) STRICT;
-- M16.9: active facts and ordered Journey history avoid growing-table scans.
CREATE INDEX sessions_facts_active ON sessions(deleted_at_ms,started_at_ms,id) WHERE deleted_at_ms IS NULL;
CREATE INDEX attempts_facts_active ON attempts(capture_state,deleted_at_ms,created_at_ms,id) WHERE capture_state='saved' AND deleted_at_ms IS NULL;
CREATE INDEX annotations_facts_fillers ON annotations(definition_version,kind,revision_id,decision);
CREATE INDEX analysis_runs_facts ON analysis_runs(kind,definition_version,revision_id);
CREATE INDEX transfer_reviews_facts ON transfer_reviews(local_date,created_at_ms) WHERE deleted_at_ms IS NULL;
CREATE INDEX transfer_reviews_event ON transfer_reviews(event_id,kind) WHERE deleted_at_ms IS NULL;
CREATE INDEX exposure_attempts_facts ON exposure_attempts(local_date,created_at_ms,id) WHERE deleted_at_ms IS NULL;
CREATE INDEX events_facts ON events(local_date,created_at_ms,id) WHERE deleted_at_ms IS NULL;
CREATE INDEX conversation_turns_role ON conversation_turns(conversation_id,role);
CREATE INDEX skill_levels_timeline ON skill_levels(achieved_at_ms,area,level,definition_version,evidence);
CREATE INDEX achievements_timeline ON achievements(unlocked_at_ms,id,definition_version,evidence);
CREATE INDEX personal_records_timeline ON personal_records(achieved_at_ms,id,record,value,unit,previous,attempt_id,session_id,definition_version);
PRAGMA user_version=25;
