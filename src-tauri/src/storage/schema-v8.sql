-- Single takes in Trash (plan 2.23). A trashed take is hidden from its session,
-- search, the recording library and new jobs; it keeps its number and can be
-- restored until retention expires, then it is purged like a session's takes.
ALTER TABLE attempts ADD COLUMN deleted_at_ms INTEGER;
CREATE INDEX attempts_deleted ON attempts(deleted_at_ms);
PRAGMA user_version=8;
