// The D1 store's read side: once per request, one query for every edited text
// and one for each requested list. No cache. If a query fails the page still
// renders: texts fall back to their declared defaults, lists to empty, and the
// failure is reported.
import type { Content } from '../core/declare.js';
import { buildSnapshot, type ListItemInput, type Report, type Snapshot } from '../core/read.js';

/** The part of a D1 database this reads through; Cloudflare's `D1Database` fits. */
export interface ReadDb {
  prepare(sql: string): ReadStatement;
}
export interface ReadStatement {
  bind(...values: unknown[]): ReadStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

// The package's migration (with the D1 store) creates these. `fields` is the
// item's JSON; `position` is the hand order.
const TEXTS_SQL = 'SELECT key, value FROM texts';
const ITEMS_SQL = 'SELECT id, fields FROM items WHERE list = ? ORDER BY position, id';

export interface LoadOptions {
  /** The lists this request shows. Others are not queried. */
  lists?: readonly string[];
  /** Where failures go: the site's logger. Never pass answers or secrets. */
  report?: Report;
}

export async function loadSnapshotFromD1(content: Content, db: ReadDb, options: LoadOptions = {}): Promise<Snapshot> {
  const report = options.report ?? (() => {});
  const texts: [string, unknown][] = [];
  const lists: [string, ListItemInput][] = [];

  try {
    const { results } = await db.prepare(TEXTS_SQL).all<{ key: string; value: unknown }>();
    for (const row of results) texts.push([row.key, row.value]);
  } catch (error) {
    report('content: reading texts from D1 failed; showing the defaults', { error: errorName(error) });
  }

  for (const name of options.lists ?? []) {
    if (!content.lists.has(name)) {
      report('content: a requested list is not declared', { list: name });
      continue;
    }
    try {
      const { results } = await db.prepare(ITEMS_SQL).bind(name).all<{ id: string | number; fields: unknown }>();
      for (const row of results) lists.push([name, { id: String(row.id), fields: parseFields(row.fields) }]);
    } catch (error) {
      report('content: reading a list from D1 failed; showing it empty', { list: name, error: errorName(error) });
    }
  }
  return buildSnapshot(content, { texts, lists }, report);
}

function parseFields(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The error's name only: a message can carry SQL or values.
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');
