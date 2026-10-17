-- Game core (roadmap M9, D-29, D-31). Ledgers: kept when sessions or takes are
-- purged (their IDs then stop resolving), so nothing earned is ever taken away.
-- IDs and numbers only (A-30): evidence holds IDs, never text.
-- Levels you reached, in order, with the evidence that met the criteria (9.2).
CREATE TABLE skill_levels (
 area TEXT NOT NULL,
 level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 evidence TEXT NOT NULL DEFAULT '{}',
 achieved_at_ms INTEGER NOT NULL,
 PRIMARY KEY(area, level)
) STRICT;
CREATE TABLE achievements (
 id TEXT PRIMARY KEY,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 evidence TEXT NOT NULL DEFAULT '{}',
 unlocked_at_ms INTEGER NOT NULL
) STRICT;
-- Every new best, so the history of a record can be shown (9.7). The first
-- value is the starting point (previous NULL) and earns nothing.
CREATE TABLE personal_records (
 id INTEGER PRIMARY KEY,
 record TEXT NOT NULL,
 value REAL NOT NULL,
 unit TEXT NOT NULL,
 previous REAL,
 attempt_id TEXT,
 session_id TEXT,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 achieved_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX personal_records_record ON personal_records(record, achieved_at_ms);
-- This week's three quests, frozen when first shown (9.9). week = the local
-- date of the week's first day.
CREATE TABLE weekly_quests (
 week TEXT NOT NULL CHECK(week GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
 quest TEXT NOT NULL,
 params TEXT NOT NULL DEFAULT '{}',
 swapped INTEGER NOT NULL DEFAULT 0 CHECK(swapped IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER,
 PRIMARY KEY(week, slot)
) STRICT;
-- Reflection fields used by level criteria (9.16): your own reading, Your note.
ALTER TABLE transfer_reviews ADD COLUMN flow TEXT CHECK(flow IN ('smooth','mixed','hard'));
ALTER TABLE transfer_reviews ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version=18;
