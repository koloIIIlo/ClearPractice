-- Your decisions on review candidates (plan 3.4, 3.7). A decision belongs to one
-- immutable revision and one measure definition version, so it can never move to
-- a different word when the transcript or the lexicon changes.
CREATE TABLE annotations (
 revision_id TEXT NOT NULL REFERENCES transcript_revisions(id),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 kind TEXT NOT NULL CHECK(kind IN ('filler')),
 candidate INTEGER NOT NULL CHECK(candidate >= 0),
 word TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('confirmed','dismissed')),
 decided_at_ms INTEGER NOT NULL,
 PRIMARY KEY(revision_id, definition_version, kind, candidate)
) STRICT;
PRAGMA user_version=4;
