// A D1 look-alike on Node's SQLite, loaded with the package's real migration.
// `batch` is one transaction, as D1's is.
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ContentState } from '../src/index.js';
import type { D1Like, D1Statement } from '../src/stores/d1/index.js';

const MIGRATION = new URL('../migrations/0001_content.sql', import.meta.url);

export interface TestDb extends D1Like {
  sqlite: DatabaseSync;
}

export function testDb(initial?: ContentState): TestDb {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  const at = '2026-01-01T00:00:00.000Z';
  for (const [key, text] of Object.entries(initial?.texts ?? {})) {
    sqlite.prepare('INSERT INTO content_texts (key, text, updated_at) VALUES (?, ?, ?)').run(key, text, at);
  }
  for (const [list, items] of Object.entries(initial?.lists ?? {})) {
    items.forEach((item, position) => {
      sqlite
        .prepare('INSERT INTO content_items (list, id, data, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(list, item.id, JSON.stringify(item.values), position, at, at);
    });
  }

  class Statement implements D1Statement {
    constructor(
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}
    bind(...values: unknown[]): Statement {
      return new Statement(this.sql, values as SQLInputValue[]);
    }
    async all<T>(): Promise<{ results: T[] }> {
      return { results: sqlite.prepare(this.sql).all(...this.values) as T[] };
    }
    exec(): { results: unknown[]; meta: { changes: number } } {
      const statement = sqlite.prepare(this.sql);
      if (statement.columns().length > 0) return { results: statement.all(...this.values), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(statement.run(...this.values).changes) } };
    }
  }

  return {
    sqlite,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = (statements as Statement[]).map((s) => s.exec());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

