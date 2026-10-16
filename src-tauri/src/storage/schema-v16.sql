-- Exercise types (roadmap 7.3, D-30 chosen 2026-10-16): new formats such as
-- drills get exercise types of their own. The v1 CHECK on type is removed by
-- rebuilding the table once (create new, copy, drop old, rename new); types are
-- validated in Rust from now on. This script runs with foreign keys off
-- (migrate_rebuild) and foreign_key_check must be empty before it commits.
CREATE TABLE exercise_definitions_v16 (
 id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0),
 type TEXT CHECK(type IS NULL OR length(type) BETWEEN 1 AND 40),
 instructions TEXT,
 content_id TEXT,
 PRIMARY KEY(id,version)
) STRICT;
INSERT INTO exercise_definitions_v16(id,version,type,instructions,content_id)
 SELECT id,version,type,instructions,content_id FROM exercise_definitions;
DROP TABLE exercise_definitions;
ALTER TABLE exercise_definitions_v16 RENAME TO exercise_definitions;
-- A run's settings (seed, parameters, group), kept as JSON so a past session
-- always reads as it was played (7.3).
ALTER TABLE sessions ADD COLUMN activity_snapshot TEXT;
-- Practice events (7.4, D-31): what you did that earns effort points, written
-- in the same transaction as the action. Append-only: Trash and permanent
-- deletion keep these rows (their IDs then stop resolving). Kinds are
-- validated in Rust (engagement::EventKind), not by CHECK, so later milestones
-- add kinds without rebuilding the table. IDs and numbers only: never
-- transcript text, audio or paths.
CREATE TABLE practice_events (
 id INTEGER PRIMARY KEY,
 kind TEXT NOT NULL,
 ref_id TEXT NOT NULL,
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 session_id TEXT,
 attempt_id TEXT,
 xp INTEGER NOT NULL CHECK(xp BETWEEN 0 AND 1000),
 rules_version INTEGER NOT NULL CHECK(rules_version > 0),
 data TEXT NOT NULL DEFAULT '{}',
 backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 UNIQUE(kind, ref_id)
) STRICT;
CREATE INDEX practice_events_date ON practice_events(local_date, created_at_ms);
PRAGMA user_version=16;
