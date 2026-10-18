-- Real world (M14). Missions you pick each week (14.1): a week's mission, or
-- the week skipped (no mission), done once its reflection is saved.
CREATE TABLE mission_picks (
 week TEXT PRIMARY KEY CHECK(week GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 mission_id TEXT,
 picked_at_ms INTEGER NOT NULL,
 review_id TEXT,
 done_at_ms INTEGER
) STRICT;
-- A reflection can log a mission (14.1) or debrief an event (14.2).
ALTER TABLE transfer_reviews ADD COLUMN mission_id TEXT;
ALTER TABLE transfer_reviews ADD COLUMN event_id TEXT;
-- Events you prepare for (14.2): your own content, deleted softly.
CREATE TABLE events (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 kind TEXT NOT NULL CHECK(kind IN ('talk','interview','meeting','toast','pitch','other')),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
 minutes INTEGER CHECK(minutes BETWEEN 1 AND 480),
 audience TEXT NOT NULL DEFAULT '' CHECK(length(audience) <= 200),
 goal TEXT NOT NULL DEFAULT '' CHECK(length(goal) <= 500),
 talk_id TEXT,
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE event_plan_items (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id),
 position INTEGER NOT NULL CHECK(position > 0),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 kind TEXT NOT NULL CHECK(kind IN ('outline','run_through','qa_drill','mock','dress_rehearsal','routine','debrief')),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 done_at_ms INTEGER,
 ref_id TEXT,
 by_hand INTEGER NOT NULL DEFAULT 0 CHECK(by_hand IN (0,1)),
 UNIQUE(event_id, position)
) STRICT;
-- Talks (14.3): outline sections with target times; a rehearsal links a take to
-- a talk with a snapshot of its sections, so old reports read as they were.
CREATE TABLE talks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 template TEXT,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE talk_sections (
 id TEXT PRIMARY KEY,
 talk_id TEXT NOT NULL REFERENCES talks(id),
 position INTEGER NOT NULL CHECK(position > 0),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),
 keywords TEXT NOT NULL DEFAULT '[]',
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 target_seconds INTEGER NOT NULL CHECK(target_seconds BETWEEN 5 AND 3600),
 deleted_at_ms INTEGER
) STRICT;
CREATE INDEX talk_sections_talk ON talk_sections(talk_id, position);
CREATE TABLE rehearsals (
 id TEXT PRIMARY KEY,
 talk_id TEXT NOT NULL REFERENCES talks(id),
 attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
 sections TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX rehearsals_talk ON rehearsals(talk_id, created_at_ms);
-- Listener packs you saved (14.4) and the answers you imported. Purged with the take.
CREATE TABLE listener_packs (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES sessions(id),
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 questions TEXT NOT NULL,
 from_name TEXT NOT NULL DEFAULT '' CHECK(length(from_name) <= 60),
 include_transcript INTEGER NOT NULL DEFAULT 0 CHECK(include_transcript IN (0,1)),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX listener_packs_attempt ON listener_packs(attempt_id);
CREATE TABLE listener_feedback (
 id TEXT PRIMARY KEY,
 pack_id TEXT NOT NULL REFERENCES listener_packs(id),
 listener_name TEXT NOT NULL DEFAULT '' CHECK(length(listener_name) <= 60),
 answers TEXT NOT NULL,
 answered_at TEXT,
 file_sha256 TEXT NOT NULL UNIQUE CHECK(length(file_sha256)=64),
 main_point_understood INTEGER CHECK(main_point_understood IN (0,1)),
 imported_at_ms INTEGER NOT NULL
) STRICT;
-- The monthly time capsule (14.5): the day it was first offered in a month,
-- and whether you dismissed it.
CREATE TABLE capsule_months (
 month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 offered_on TEXT NOT NULL CHECK(offered_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 dismissed_at_ms INTEGER
) STRICT;
PRAGMA user_version=23;
