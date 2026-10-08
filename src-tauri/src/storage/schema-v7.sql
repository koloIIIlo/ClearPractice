-- Stored analysis runs and metric values (plan 3.4). Each transcript revision
-- (machine or correction) gets one run per analysis kind and definition version,
-- so metrics stay tied to the text and definitions they came from; a changed
-- definition adds a new run instead of rewriting old values. A value is either
-- present or NULL with a reason, never a stand-in 0.
CREATE TABLE analysis_runs (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id),
 revision_id TEXT NOT NULL REFERENCES transcript_revisions(id),
 kind TEXT NOT NULL CHECK(kind IN ('transcript-measures')),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 settings TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
 UNIQUE(revision_id, kind, definition_version)
) STRICT;
CREATE TABLE metric_values (
 run_id TEXT NOT NULL REFERENCES analysis_runs(id), metric TEXT NOT NULL,
 value REAL, unit TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('Measured','Estimated')),
 unavailable_reason TEXT,
 CHECK((value IS NULL) <> (unavailable_reason IS NULL)),
 PRIMARY KEY(run_id, metric)
) STRICT;
CREATE INDEX analysis_runs_attempt ON analysis_runs(attempt_id);
PRAGMA user_version=7;
