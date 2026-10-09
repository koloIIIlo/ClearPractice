-- AI feedback on a take (M5, P.9): each approved request and its validated
-- result, kept with the session data so backups carry it and Trash purges it
-- with the take. The exact text that was sent is stored, so the result can
-- always be read against what the AI saw; it never holds keys or audio.
CREATE TABLE coaching_runs (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 revision_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 sent_text TEXT NOT NULL,
 transcript_text TEXT NOT NULL,
 delivery_impressions INTEGER NOT NULL CHECK(delivery_impressions IN (0,1)),
 provider_request_id TEXT,
 raw_response TEXT NOT NULL,
 result TEXT NOT NULL,
 input_tokens INTEGER CHECK(input_tokens >= 0),
 output_tokens INTEGER CHECK(output_tokens >= 0),
 estimated_cost_micro_usd INTEGER CHECK(estimated_cost_micro_usd >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX coaching_runs_attempt ON coaching_runs(attempt_id, created_at_ms);
CREATE INDEX coaching_runs_payload ON coaching_runs(payload_sha256);
-- Attempt comparison (4.14): which take felt clearer to you, your own
-- judgement (a take's ID, or 'same'), kept apart from any measure.
ALTER TABLE sessions ADD COLUMN preferred_take TEXT;
-- Exercises (4.13): your own prompts and your favourite marks. Bundled
-- prompts stay in the content pack; a mark without a row keeps its default.
CREATE TABLE user_prompts (
 id TEXT PRIMARY KEY,
 text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 5 AND 500),
 tags TEXT NOT NULL DEFAULT '[]',
 familiarity TEXT NOT NULL CHECK(familiarity IN ('familiar','unfamiliar')),
 preparation_seconds INTEGER NOT NULL CHECK(preparation_seconds BETWEEN 0 AND 600),
 target_seconds INTEGER NOT NULL CHECK(target_seconds BETWEEN 10 AND 600),
 audience TEXT,
 follow_up INTEGER NOT NULL CHECK(follow_up IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE prompt_favorites (
 prompt_id TEXT PRIMARY KEY,
 favorite INTEGER NOT NULL CHECK(favorite IN (0,1)),
 updated_at_ms INTEGER NOT NULL
) STRICT;
-- Real-conversation reflections (4.17, §7 Transfer): no recording of anyone
-- else. The listener's own words (listener_text) are kept apart from your
-- reading of the conversation (self_report).
CREATE TABLE transfer_reviews (
 id TEXT PRIMARY KEY,
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 situation TEXT NOT NULL CHECK(length(trim(situation)) BETWEEN 3 AND 2000),
 preparation TEXT NOT NULL DEFAULT '',
 listener_text TEXT NOT NULL DEFAULT '',
 clarification TEXT NOT NULL DEFAULT '',
 success TEXT NOT NULL DEFAULT '',
 self_report TEXT NOT NULL DEFAULT '',
 next_focus TEXT NOT NULL DEFAULT '',
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
-- Progression (4.18, §7): each stage change, or your choice to stay or go
-- easier, with the reason shown at the time. The app never advances by itself.
CREATE TABLE progression_events (
 id INTEGER PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('advance','easier','stay')),
 stage_from INTEGER NOT NULL CHECK(stage_from BETWEEN 1 AND 5),
 stage_to INTEGER NOT NULL CHECK(stage_to BETWEEN 1 AND 5),
 reason TEXT NOT NULL DEFAULT '',
 created_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=15;
