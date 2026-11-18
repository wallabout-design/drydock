// A D1 look-alike on Node's SQLite, for the fixture server (e2e/server.mjs), loaded with the
// package's real migration. The same as test/d1-sqlite.ts, in plain JavaScript so the server
// can run it without a build step. `batch` is one transaction, as D1's is.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATION = new URL('../migrations/0001_content.sql', import.meta.url);

export function fixtureD1(initial = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  const at = '2026-01-01T00:00:00.000Z';
  for (const [key, text] of Object.entries(initial.texts ?? {})) {
    sqlite.prepare('INSERT INTO content_texts (key, text, updated_at) VALUES (?, ?, ?)').run(key, text, at);
  }
  for (const [list, items] of Object.entries(initial.lists ?? {})) {
    items.forEach((item, position) => {
      sqlite
        .prepare('INSERT INTO content_items (list, id, data, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(list, item.id, JSON.stringify(item.values), position, at, at);
    });
  }

  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    exec() {
      const prepared = sqlite.prepare(sql);
      if (prepared.columns().length > 0) return { results: prepared.all(...values), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(prepared.run(...values).changes) } };
    },
  });

  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.exec());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
