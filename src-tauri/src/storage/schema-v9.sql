-- Curriculum versioning (plan 4.5). A session records which bundled content
-- version and item (prompt, passage or phrase) it used, so history stays
-- interpretable after the curriculum changes. NULL for older sessions.
ALTER TABLE sessions ADD COLUMN curriculum_version INTEGER CHECK(curriculum_version > 0);
ALTER TABLE sessions ADD COLUMN content_id TEXT;
PRAGMA user_version=9;
