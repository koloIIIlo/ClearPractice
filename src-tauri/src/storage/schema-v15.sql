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
PRAGMA user_version=15;
