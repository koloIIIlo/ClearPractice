-- API transcription runs (plan 3.16): the approved request's provider, model and
-- settings, the provider's raw response and the validated result, kept with the
-- session data rather than in cache so backups carry them. A run never replaces
-- local or corrected text: its transcript is its own revision (source 'api').
CREATE TABLE api_runs (
 id TEXT PRIMARY KEY REFERENCES transcript_revisions(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
 provider TEXT NOT NULL, model_id TEXT NOT NULL, provider_request_id TEXT,
 audio_sha256 TEXT NOT NULL CHECK(length(audio_sha256)=64), source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 settings TEXT NOT NULL, raw_response TEXT NOT NULL, result TEXT NOT NULL,
 word_timings INTEGER NOT NULL CHECK(word_timings IN (0,1)),
 audio_duration_ms INTEGER CHECK(audio_duration_ms >= 0), estimated_cost_micro_usd INTEGER CHECK(estimated_cost_micro_usd >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX api_runs_attempt ON api_runs(attempt_id);
PRAGMA user_version=6;
