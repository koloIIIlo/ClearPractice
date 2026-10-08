-- Local transcription in the app (plan 3.1, 3.4). A revision is immutable; edits
-- (3.9) will add child revisions. Segment times are Estimated unless verified.
CREATE TABLE transcript_revisions (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id),
 parent_id TEXT REFERENCES transcript_revisions(id),
 source TEXT NOT NULL CHECK(source IN ('local','api','user')),
 run_id TEXT, provider TEXT, model_id TEXT, model_sha256 TEXT, backend TEXT, prompt TEXT,
 source_sha256 TEXT, language TEXT, text TEXT NOT NULL,
 worker_elapsed_ms INTEGER CHECK(worker_elapsed_ms >= 0), created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE transcript_segments (
 revision_id TEXT NOT NULL REFERENCES transcript_revisions(id), position INTEGER NOT NULL CHECK(position >= 0),
 text TEXT NOT NULL, start_ms INTEGER CHECK(start_ms >= 0), end_ms INTEGER CHECK(end_ms >= 0),
 timing_source TEXT NOT NULL CHECK(timing_source IN ('Measured','Estimated')), timing_unavailable_reason TEXT,
 PRIMARY KEY(revision_id, position)
) STRICT;
CREATE INDEX transcripts_attempt ON transcript_revisions(attempt_id, created_at_ms);
ALTER TABLE jobs ADD COLUMN attempt_id TEXT REFERENCES attempts(id);
ALTER TABLE jobs ADD COLUMN created_at_ms INTEGER;
ALTER TABLE jobs ADD COLUMN finished_at_ms INTEGER;
ALTER TABLE jobs ADD COLUMN error_message TEXT;
CREATE INDEX jobs_attempt ON jobs(attempt_id);
PRAGMA user_version=3;
