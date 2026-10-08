-- Completion reflection (plan 4.11): how easy the practice felt (1-5, the
-- user's own rating, never a score) and one takeaway for next time.
ALTER TABLE sessions ADD COLUMN ease INTEGER CHECK(ease BETWEEN 1 AND 5);
ALTER TABLE sessions ADD COLUMN takeaway TEXT;
PRAGMA user_version=10;
