-- Drills (roadmap M10). Marks made during a take (a word shown, a card advanced,
-- a slip you flagged), with the time into the take. IDs, keys and numbers only
-- (A-30); purged with their take.
CREATE TABLE take_events (
 id INTEGER PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 at_ms INTEGER NOT NULL CHECK(at_ms >= 0),
 kind TEXT NOT NULL,
 data TEXT NOT NULL DEFAULT '{}',
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX take_events_attempt ON take_events(attempt_id, at_ms);
-- A drill take's result (numbers and keys), computed on first request from the
-- stored transcript, audio measures and marks; recomputed when the transcript
-- revision changes. Purged with its take.
CREATE TABLE activity_results (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 revision_id TEXT,
 result TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, definition_version)
) STRICT;
PRAGMA user_version=19;
