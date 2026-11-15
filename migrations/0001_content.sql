-- @wallabout-design/editor: the D1 store's tables. Sites copy this file into
-- their own migrations folder (with the next number) and apply it like any
-- other. It is the same on every site: a new list or field needs no migration.

-- Edited texts. A text with no row shows its declared default.
CREATE TABLE content_texts (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- List items. `data` is the item's fields as JSON; `position` is the hand order.
CREATE TABLE content_items (
  list TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  position REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (list, id)
);
CREATE INDEX content_items_order ON content_items (list, position, id);

-- Every change: waiting, live, rejected or undone. `operations` is the JSON list
-- of operations; `reverse` the operations that undo it, kept once it is live;
-- `undoes` the id of the change an undo reverses.
CREATE TABLE content_changes (
  id TEXT PRIMARY KEY,
  operations TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'live', 'rejected', 'undone')),
  by TEXT NOT NULL,
  at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  reverse TEXT,
  undoes TEXT
);
CREATE INDEX content_changes_state ON content_changes (state);

-- Every change applied, one row per text or item it touched: what was there
-- before and what is there now (JSON, or null for none). The store keeps the
-- latest 50 rows per text or item.
CREATE TABLE content_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'item')),
  list TEXT NOT NULL,
  target TEXT NOT NULL,
  before TEXT,
  after TEXT,
  by TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX content_history_target ON content_history (kind, list, target, id);
