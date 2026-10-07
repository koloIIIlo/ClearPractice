-- Trash (plan 2.17). A tombstone is written in the same transaction that removes
-- a session's rows, so receipts left on disk are never re-imported and file
-- removal resumes on the next start.
CREATE TABLE purged_assets (
 id TEXT PRIMARY KEY, purged_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE app_settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
) STRICT;
INSERT INTO app_settings(key,value) VALUES ('trash_retention_days','30');
CREATE INDEX sessions_deleted ON sessions(deleted_at_ms);
PRAGMA user_version=2;
