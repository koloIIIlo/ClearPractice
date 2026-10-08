-- Stored intonation tracks (plan P.3). The frames live in a regenerable compact
-- artifact under cache/prosody; this row records how they were made and the
-- artifact checksum, so a missing or altered file is detected and rebuilt.
-- Summary values are Estimated; NULL with a reason, never 0.
CREATE TABLE prosody_tracks (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), run_id TEXT NOT NULL,
 algorithm TEXT NOT NULL, settings TEXT NOT NULL, hop_ms INTEGER NOT NULL CHECK(hop_ms > 0),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 artifact_path TEXT NOT NULL, artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256)=64),
 frame_count INTEGER NOT NULL CHECK(frame_count >= 0),
 median_f0_hz REAL, range_semitones REAL, loudness_range_db REAL, unavailable_reason TEXT,
 created_at_ms INTEGER NOT NULL,
 UNIQUE(attempt_id, algorithm, definition_version)
) STRICT;
PRAGMA user_version=5;
