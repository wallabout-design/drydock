-- @wallabout-design/drydock: who sent each feedback note, so the feedback routine
-- can email the sender a preview link (standards drydock.md, feedback delivery).
-- Sites that use `d1SenderStore` copy this file into their own migrations folder
-- (with the next number) and apply it like any other.
--
-- The address is personal data. It is kept for 90 days: the site's cron calls
-- `store.purge()`. It is never written to a log, an issue or a response other
-- than the routine's lookup.
CREATE TABLE feedback_senders (
  ref TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  site TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_senders_created ON feedback_senders (created_at);
