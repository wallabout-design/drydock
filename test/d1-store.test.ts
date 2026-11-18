import { describe, expect, it } from 'vitest';
import { defineContent } from '../src/index.js';
import { d1Store, HISTORY_KEPT } from '../src/server/index.js';
import { testDb } from './d1-sqlite.js';
import { INITIAL, storeContract } from '../src/testing/index.js';

// The D1 store passes the same contract as the fake, on SQLite with the real migration.
storeContract((initial) => d1Store(testDb(initial)));

const rows = (db: ReturnType<typeof testDb>, sql: string): Record<string, unknown>[] => db.sqlite.prepare(sql).all() as Record<string, unknown>[];

describe('d1Store', () => {
  it('declares that it puts a change live at once, keeping the history it keeps', () => {
    expect(d1Store(testDb()).capabilities).toEqual({ goesLive: 'at-once', history: HISTORY_KEPT });
  });

  it('stamps changes with the clock and names who decided', async () => {
    const store = d1Store(testDb(structuredClone(INITIAL)), { now: () => '2026-11-15T10:00:00.000Z' });
    const outcome = await store.submit({ ops: [{ op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' }], by: 'ana' }, 'review');
    expect(outcome.ok && outcome.change.at).toBe('2026-11-15T10:00:00.000Z');
    const approved = await store.approve(outcome.ok ? outcome.change.id : '', 'jj');
    expect(approved.ok && approved.change.decidedAt).toBe('2026-11-15T10:00:00.000Z');
  });

  it('uses declared defaults for texts with no row, and empty declared lists', async () => {
    const content = defineContent({
      texts: [{ key: 'home.title', default: 'Welcome', max: 40, label: 'title' }],
      lists: [{ name: 'rooms', label: 'rooms', singular: 'room', titleField: 'title', fields: [{ type: 'text', name: 'title', label: 'title', required: true }], sort: 'hand' }],
    });
    const db = testDb();
    const store = d1Store(db, { content });
    expect(await store.read()).toEqual({ texts: { 'home.title': 'Welcome' }, lists: { rooms: [] } });
    const first = await store.submit({ ops: [{ op: 'setText', key: 'home.title', seen: 'Welcome', text: 'Hi' }, { op: 'addItem', list: 'rooms', id: 'a', values: { title: 'Blue' }, after: null }], by: 'ana' }, 'auto');
    expect(first.ok).toBe(true);
    expect((await store.read()).texts['home.title']).toBe('Hi');
    expect(rows(db, 'SELECT key, text FROM content_texts')).toEqual([{ key: 'home.title', text: 'Hi' }]);
  });

  it('a refused change writes nothing: no content, no history, no change row', async () => {
    const db = testDb(structuredClone(INITIAL));
    const store = d1Store(db);
    const stale = await store.submit(
      { ops: [{ op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' }, { op: 'setText', key: 'home.intro', seen: 'Nope', text: 'x' }], by: 'ana' },
      'auto',
    );
    expect(stale.ok).toBe(false);
    expect(rows(db, 'SELECT * FROM content_changes')).toEqual([]);
    expect(rows(db, 'SELECT * FROM content_history')).toEqual([]);
  });

  it('a change that loses a race between its read and its write writes nothing', async () => {
    const db = testDb(structuredClone(INITIAL));
    const store = d1Store(db);
    // The first batch of each call is its read; after it, another save slips in.
    let slipped = false;
    const racing = {
      ...db,
      prepare: db.prepare,
      async batch(statements: Parameters<typeof db.batch>[0]) {
        const results = await db.batch(statements);
        if (!slipped) {
          slipped = true;
          db.sqlite.prepare("UPDATE content_texts SET text = 'Other' WHERE key = 'home.title'").run();
        }
        return results;
      },
    };
    const outcome = await d1Store(racing).submit(
      { ops: [{ op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' }, { op: 'addItem', list: 'rooms', id: 'z', values: { title: 'Z' }, after: 'b' }], by: 'ana' },
      'auto',
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { reason: 'stale', index: 0 } });
    expect(rows(db, 'SELECT id FROM content_items ORDER BY id')).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(rows(db, 'SELECT * FROM content_history')).toEqual([]);
    expect(await store.read()).toMatchObject({ texts: { 'home.title': 'Other' } });
  });

  it('keeps list order dense, with items placed where asked', async () => {
    const db = testDb(structuredClone(INITIAL));
    const store = d1Store(db);
    const add = (id: string, after: string | null) => ({ op: 'addItem' as const, list: 'rooms', id, values: { title: id }, after });
    await store.submit({ ops: [add('x', null), add('y', 'b'), add('z', 'a')], by: 'ana' }, 'auto');
    const order = rows(db, 'SELECT id, position FROM content_items ORDER BY position, id');
    expect(order.map((r) => r.id)).toEqual(['x', 'a', 'z', 'b', 'y']);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('writes history for every applied change, undo included, and keeps 50 per text', async () => {
    const db = testDb(structuredClone(INITIAL));
    const store = d1Store(db);
    let seen = 'Hello';
    for (let n = 1; n <= HISTORY_KEPT + 5; n++) {
      const text = `v${n}`;
      const outcome = await store.submit({ ops: [{ op: 'setText', key: 'home.title', seen, text }], by: 'ana' }, 'auto');
      expect(outcome.ok).toBe(true);
      seen = text;
    }
    const kept = rows(db, "SELECT before, after FROM content_history WHERE target = 'home.title' ORDER BY id");
    expect(kept).toHaveLength(HISTORY_KEPT);
    expect(kept[kept.length - 1]).toEqual({ before: '"v54"', after: '"v55"' });
    const page = await store.list({ limit: 1 });
    await store.undo(page.changes[0]?.id ?? '', 'jj');
    expect(rows(db, "SELECT after FROM content_history WHERE target = 'home.title' ORDER BY id DESC LIMIT 1")).toEqual([{ after: '"v54"' }]);
  });
});
