CREATE TABLE profiles (
 id TEXT PRIMARY KEY, goal TEXT, interface_language TEXT NOT NULL DEFAULT 'en',
 practice_language TEXT NOT NULL DEFAULT 'en', timezone TEXT
) STRICT;
INSERT INTO profiles(id) VALUES ('local');
CREATE TABLE exercise_definitions (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
 type TEXT CHECK(type IN ('repeat','thought_groups','imitate','expression')),
 instructions TEXT, content_id TEXT, PRIMARY KEY(id,version)
) STRICT;
INSERT INTO exercise_definitions(id,version) VALUES ('legacy-recording',1);
CREATE TABLE prompts (
 id TEXT PRIMARY KEY, text TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en',
 tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1))
) STRICT;
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
 title TEXT NOT NULL, local_date TEXT NOT NULL, timezone_offset_seconds INTEGER NOT NULL,
 started_at_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('in_progress','completed','interrupted')),
 focus TEXT, notes TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
 tags TEXT NOT NULL DEFAULT '[]', prompt_snapshot TEXT, outline_snapshot TEXT, deleted_at_ms INTEGER
) STRICT;
CREATE TABLE session_steps (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
 exercise_id TEXT NOT NULL, exercise_version INTEGER NOT NULL, position INTEGER NOT NULL CHECK(position > 0),
 status TEXT NOT NULL, FOREIGN KEY(exercise_id,exercise_version) REFERENCES exercise_definitions(id,version),
 UNIQUE(session_id,position)
) STRICT;
CREATE TABLE audio_assets (
 id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes >= 44),
 sample_rate INTEGER NOT NULL CHECK(sample_rate BETWEEN 8000 AND 192000), channels INTEGER NOT NULL CHECK(channels=1),
 duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0), unavailable_reason TEXT
) STRICT;
CREATE TABLE attempts (
 id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES session_steps(id), repetition_group_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal > 0), capture_state TEXT NOT NULL CHECK(capture_state IN ('preparing','recording','finalizing','saved','interrupted')),
 asset_id TEXT UNIQUE REFERENCES audio_assets(id), created_at_ms INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE, request_snapshot TEXT NOT NULL,
 UNIQUE(step_id,ordinal), CHECK(capture_state <> 'saved' OR asset_id IS NOT NULL)
) STRICT;
CREATE TABLE task_conditions (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), familiarity TEXT CHECK(familiarity IN ('familiar','unfamiliar')),
 preparation_seconds INTEGER CHECK(preparation_seconds >= 0), target_seconds INTEGER CHECK(target_seconds > 0),
 audience TEXT, challenge TEXT, follow_up INTEGER CHECK(follow_up IN (0,1)), unavailable_reason TEXT
) STRICT;
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, input_revision TEXT, state TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), error_code TEXT
) STRICT;
CREATE TABLE backup_records (
 id TEXT PRIMARY KEY, created_at_ms INTEGER NOT NULL, destination TEXT NOT NULL,
 manifest_hash TEXT, validation_status TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_date ON sessions(local_date,started_at_ms);
CREATE INDEX steps_session ON session_steps(session_id);
CREATE INDEX attempts_step ON attempts(step_id);
CREATE INDEX jobs_state ON jobs(state);
PRAGMA user_version=1;
