-- Club mode (M15.2). Counts and times only; no recording of anyone. Names are
-- what you typed. User content, deleted softly, in backups, not in session exports.
CREATE TABLE club_meetings (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 word_of_the_day TEXT NOT NULL DEFAULT '' CHECK(length(word_of_the_day) <= 60),
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
-- The agenda, then each speaker's time, filler counts and your notes once timed.
CREATE TABLE club_speeches (
 id TEXT PRIMARY KEY,
 meeting_id TEXT NOT NULL REFERENCES club_meetings(id),
 position INTEGER NOT NULL CHECK(position > 0),
 speaker TEXT NOT NULL CHECK(length(trim(speaker)) BETWEEN 1 AND 60),
 kind TEXT NOT NULL CHECK(kind IN ('prepared','table_topic','evaluation','other')),
 target_min_seconds INTEGER CHECK(target_min_seconds BETWEEN 0 AND 3600),
 target_max_seconds INTEGER CHECK(target_max_seconds BETWEEN 1 AND 3600),
 seconds INTEGER CHECK(seconds >= 0),
 counts TEXT NOT NULL DEFAULT '{}',
 word_used INTEGER CHECK(word_used IN (0,1)),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 UNIQUE(meeting_id, position)
) STRICT;
PRAGMA user_version=24;
