-- Clip library folders (plan 4.4h) and import history (plan 4.4i, D-28).
-- A source is a recording the user imported and transcribed: its original
-- file lives in sources/<id>/ (not in backups), its transcript and AI choices
-- here. Clips remember the folder they are filed in and the source range they
-- were cut from. The added columns carry no FOREIGN KEY clause (SQLite cannot
-- drop such columns later); deleting a folder or source clears them in code.
CREATE TABLE clip_folders (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE clip_sources (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 origin TEXT NOT NULL CHECK(origin IN ('file','link')),
 link TEXT,
 credit TEXT NOT NULL DEFAULT '',
 file_name TEXT NOT NULL,
 audio_file TEXT NOT NULL,
 audio_sha256 TEXT NOT NULL CHECK(length(audio_sha256)=64),
 duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
 segments TEXT NOT NULL,
 transcribed_with TEXT NOT NULL CHECK(transcribed_with IN ('local','deepgram','assemblyai')),
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE clip_source_picks (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL REFERENCES clip_sources(id) ON DELETE CASCADE,
 model TEXT NOT NULL,
 tone_hint INTEGER NOT NULL CHECK(tone_hint IN (0,1)),
 picks TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX clip_source_picks_source ON clip_source_picks(source_id, created_at_ms);
ALTER TABLE reference_clips ADD COLUMN folder_id TEXT;
ALTER TABLE reference_clips ADD COLUMN source_id TEXT;
ALTER TABLE reference_clips ADD COLUMN source_start_ms INTEGER;
ALTER TABLE reference_clips ADD COLUMN source_end_ms INTEGER;
CREATE INDEX reference_clips_folder ON reference_clips(folder_id);
CREATE INDEX reference_clips_source ON reference_clips(source_id);
PRAGMA user_version=13;
