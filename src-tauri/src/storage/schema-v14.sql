-- Phrase cards (plan 4.15): expressions the user keeps and recalls on a simple,
-- visible schedule (1, 3, 7, 14, 30 days; Again → tomorrow, Hard → same
-- interval, Good → next step). Reviews are append-only; a card's due date and
-- interval are the result of its latest review. A deleted card keeps its history.
CREATE TABLE phrase_cards (
 id TEXT PRIMARY KEY,
 original TEXT NOT NULL CHECK(length(trim(original)) BETWEEN 1 AND 500),
 expression TEXT NOT NULL CHECK(length(trim(expression)) BETWEEN 1 AND 200),
 explanation TEXT NOT NULL DEFAULT '' CHECK(length(explanation) <= 500),
 examples TEXT NOT NULL DEFAULT '[]',
 source_session_id TEXT,
 due_date TEXT NOT NULL CHECK(due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 interval_days INTEGER NOT NULL CHECK(interval_days BETWEEN 0 AND 365),
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE phrase_reviews (
 id INTEGER PRIMARY KEY,
 card_id TEXT NOT NULL REFERENCES phrase_cards(id),
 rating TEXT NOT NULL CHECK(rating IN ('again','hard','good')),
 interval_before INTEGER NOT NULL,
 interval_after INTEGER NOT NULL,
 due_date TEXT NOT NULL,
 reviewed_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX phrase_cards_due ON phrase_cards(due_date) WHERE deleted_at_ms IS NULL;
CREATE INDEX phrase_reviews_card ON phrase_reviews(card_id, reviewed_at_ms);
-- Starter phrases (curriculum version 1), new and due today, so reviews and the
-- expression exercise work from the first day. They can be edited or deleted.
INSERT INTO phrase_cards(id, original, expression, explanation, examples, due_date, interval_days, created_at_ms) VALUES
 ('phrase-starter-1', 'I was reading for maybe forty minutes', 'I lost track of time', 'A natural way to say time passed without you noticing.', '["I lost track of time while cooking."]', date('now','localtime'), 0, CAST(strftime('%s','now') AS INTEGER) * 1000),
 ('phrase-starter-2', 'I say the words wrong when nervous', 'I stumble over my words', 'To speak with small hesitations or mistakes, often when nervous.', '[]', date('now','localtime'), 0, CAST(strftime('%s','now') AS INTEGER) * 1000),
 ('phrase-starter-3', 'It is more better to plan', 'It''s better to plan ahead', '“More better” doubles the comparison; “better” is enough.', '["It''s better to plan ahead before a trip."]', date('now','localtime'), 0, CAST(strftime('%s','now') AS INTEGER) * 1000),
 ('phrase-starter-4', 'I want to say my opinion', 'I''d like to share my view', 'Softer and more natural in a meeting. Both are understandable.', '[]', date('now','localtime'), 0, CAST(strftime('%s','now') AS INTEGER) * 1000),
 ('phrase-starter-5', 'At the end I understood', 'In the end, I realised', '“In the end” means finally; “at the end” refers to the end of something specific.', '["In the end, I realised the map was upside down."]', date('now','localtime'), 0, CAST(strftime('%s','now') AS INTEGER) * 1000);
PRAGMA user_version=14;
