-- Learning engine (roadmap M11). IDs and numbers only (A-30).
-- Your guesses before seeing a take's measures (11.5), Your note. Purged with the take.
CREATE TABLE self_predictions (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 kind TEXT NOT NULL CHECK(kind IN ('hesitations','pace')),
 predicted TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, kind)
) STRICT;
-- Guided programmes (11.6): one row per run, one per finished step. Kept when
-- takes are purged: a step's ref_id then stops resolving.
CREATE TABLE programmes (
 id TEXT PRIMARY KEY,
 programme TEXT NOT NULL,
 week INTEGER NOT NULL DEFAULT 1 CHECK(week BETWEEN 1 AND 12),
 started_at_ms INTEGER NOT NULL,
 week_started_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER,
 stopped_at_ms INTEGER
) STRICT;
CREATE TABLE programme_steps (
 programme_id TEXT NOT NULL REFERENCES programmes(id),
 step_id TEXT NOT NULL,
 ref_id TEXT,
 done_at_ms INTEGER NOT NULL,
 PRIMARY KEY(programme_id, step_id)
) STRICT;
-- Catch it (11.6): when you pressed during playback, and how many matched. Purged with the take.
CREATE TABLE catch_runs (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 presses TEXT NOT NULL DEFAULT '[]',
 caught INTEGER NOT NULL CHECK(caught >= 0),
 total INTEGER NOT NULL CHECK(total >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=20;
