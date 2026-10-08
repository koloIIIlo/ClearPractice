-- Reference clips (plan 4.4, 4.4a): bundled clips and clips the user imports
-- for Listen and imitate. Audio lives in clips/<id>/audio.wav; user clips are
-- included in backups. Source/credit text is kept with every clip.
CREATE TABLE reference_clips (
 id TEXT PRIMARY KEY, origin TEXT NOT NULL CHECK(origin IN ('user','bundled')),
 title TEXT NOT NULL, source TEXT NOT NULL, transcript TEXT,
 duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), created_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=11;
