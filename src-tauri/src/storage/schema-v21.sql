-- Confidence pack (roadmap M12). Your own ratings and notes (Your note): user
-- content, not ledgers, so the two note columns are the documented exceptions
-- to "IDs and numbers only" (A-30). Not tied to sessions: soft-deleted, kept
-- in backups, not in session exports.
-- The exposure ladder (12.2): your steps in order, and each attempt with its
-- discomfort before and after (0 to 10). A step that is planned has only a
-- before rating; "Not this time" is fine and is stored as such.
CREATE TABLE exposure_steps (
 id TEXT PRIMARY KEY,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 30),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
 template_id TEXT,
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE exposure_attempts (
 id TEXT PRIMARY KEY,
 step_id TEXT NOT NULL REFERENCES exposure_steps(id),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 before_rating INTEGER CHECK(before_rating BETWEEN 0 AND 10),
 after_rating INTEGER CHECK(after_rating BETWEEN 0 AND 10),
 outcome TEXT NOT NULL CHECK(outcome IN ('planned','yes','partly','not_this_time')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE INDEX exposure_attempts_step ON exposure_attempts(step_id, local_date);
-- Sentences you liked in your own takes (12.5): a revision and its segment
-- index. Deleted with the revision when a take is purged.
CREATE TABLE segment_marks (
 revision_id TEXT NOT NULL REFERENCES transcript_revisions(id),
 segment INTEGER NOT NULL CHECK(segment >= 0),
 kind TEXT NOT NULL CHECK(kind IN ('liked')),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(revision_id, segment, kind)
) STRICT;
-- Pre-talk routine runs (12.3): which steps you did. The worry text is never
-- stored unless you chose to keep it, and a run you remove is deleted softly.
CREATE TABLE routine_runs (
 id TEXT PRIMARY KEY,
 local_date TEXT NOT NULL,
 steps TEXT NOT NULL DEFAULT '[]',
 kept_note TEXT CHECK(length(kept_note) <= 4000),
 event_id TEXT,
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
-- After-action reviews (12.4) share the reflection table: the four answers go in `extra`.
ALTER TABLE transfer_reviews ADD COLUMN kind TEXT NOT NULL DEFAULT 'reflection' CHECK(kind IN ('reflection','aar'));
ALTER TABLE transfer_reviews ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version=21;
