-- Insights (roadmap M8). IDs and numbers only (A-30): no transcript text.
-- Saved phrases found in a take's transcript revision (8.2). A phrase's uses
-- stay when the phrase is deleted; the facts leave them out.
CREATE TABLE phrase_uses (
 phrase_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 revision_id TEXT NOT NULL,
 segment INTEGER NOT NULL CHECK(segment >= 0),
 start_token INTEGER NOT NULL CHECK(start_token >= 0),
 end_token INTEGER NOT NULL CHECK(end_token >= start_token),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(phrase_id, revision_id)
) STRICT;
CREATE INDEX phrase_uses_attempt ON phrase_uses(attempt_id);
-- Your quick yes/no notes about a take (8.3; drills add checks later). Check
-- IDs are validated in Rust.
CREATE TABLE self_checks (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 check_id TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, check_id)
) STRICT;
-- Speech rate from the audio itself (8.8), computed on first request and kept.
CREATE TABLE audio_measures (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 method TEXT NOT NULL,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 syllables INTEGER CHECK(syllables >= 0),
 span_ms INTEGER CHECK(span_ms >= 0),
 phonation_ms INTEGER CHECK(phonation_ms >= 0),
 rate_sps REAL,
 articulation_sps REAL,
 unavailable_reason TEXT,
 created_at_ms INTEGER NOT NULL,
 CHECK((rate_sps IS NULL) <> (unavailable_reason IS NULL)),
 PRIMARY KEY(attempt_id, method, definition_version)
) STRICT;
-- A/B choices between takes of different sessions (8.5); a choice between
-- takes of one session stays in sessions.preferred_take.
CREATE TABLE comparisons (
 id TEXT PRIMARY KEY,
 a_attempt TEXT NOT NULL,
 b_attempt TEXT NOT NULL,
 preferred TEXT NOT NULL CHECK(preferred IN ('a','b','same')),
 blind INTEGER NOT NULL CHECK(blind IN (0,1)),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX comparisons_a ON comparisons(a_attempt);
CREATE INDEX comparisons_b ON comparisons(b_attempt);
PRAGMA user_version=17;
