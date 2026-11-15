import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createReader, defineContent, itemAttrs, listAttrs, snapshotFromFiles, type Reader, type TextKey } from '../src/index.js';
import { loadSnapshotFromD1, type ReadDb } from '../src/server/index.js';
import { ContentProvider, List, Text } from '../src/react/index.js';

const content = defineContent({
  texts: [
    { key: 'home.title', default: 'hello', max: 30, label: 'Title' },
    { key: 'travel.train', default: 'by train', max: 30, label: 'Train' },
  ],
  lists: [
    {
      name: 'rooms',
      label: 'rooms',
      singular: 'room',
      titleField: 'title',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'beds', label: 'Beds', type: 'number', min: 1, max: 12 },
      ],
      sort: 'hand',
    },
    {
      name: 'cats',
      label: 'cats',
      singular: 'cat',
      titleField: 'title',
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
      sort: { by: 'title', order: 'desc' },
    },
  ],
});

// What a site does once, so keys are checked everywhere.
declare module '../src/core/read.js' {
  interface Register {
    content: typeof content;
  }
}

const lines = () => {
  const out: string[] = [];
  return { out, report: (m: string) => void out.push(m) };
};

describe('type tests', () => {
  it('rejects unknown keys and lists', () => {
    const r = createReader(content);
    r.text('home.title');
    r.list('rooms');
    // @ts-expect-error not a declared text key
    expect(() => r.text('home.nope')).toThrow();
    // @ts-expect-error not a declared list
    expect(() => r.list('nope')).toThrow();
    const key: TextKey = 'travel.train';
    expect(key).toBe('travel.train');
    // @ts-expect-error React's Text takes only declared keys
    createElement(Text, { k: 'home.nope' });
  });
});

describe('git loader (snapshotFromFiles)', () => {
  const files = {
    '/content/texts.json': JSON.stringify({ 'home.title': 'Welcome', 'gone.key': 'x' }),
    '/content/rooms/002-b.json': JSON.stringify({ title: 'Blue', beds: 2 }),
    '/content/rooms/001-a.json': JSON.stringify({ title: 'Attic', beds: 1 }),
    '/content/cats/a.json': JSON.stringify({ title: 'Ann' }),
    '/content/cats/z.json': JSON.stringify({ title: 'Zed' }),
    '/content/rooms/003-bad.json': JSON.stringify({ title: '', beds: 99 }),
  };
  it('reads edits, falls back to defaults, orders lists, reports bad files', () => {
    const { out, report } = lines();
    const r = createReader(content, snapshotFromFiles(content, files, report));
    expect(r.text('home.title')).toBe('Welcome');
    expect(r.text('travel.train')).toBe('by train');
    expect(r.list('rooms').map((i) => i.id)).toEqual(['001-a', '002-b']);
    expect(r.list('rooms')[0]!.values).toEqual({ title: 'Attic', beds: 1 });
    expect(r.list('cats').map((i) => i.values.title)).toEqual(['Zed', 'Ann']);
    expect(out.length).toBe(2);
  });
  it('accepts paths without a leading folder and reports non-JSON', () => {
    const { out, report } = lines();
    const s = snapshotFromFiles(content, { 'texts.json': '{nope', 'rooms/a.json': '{"title":"A"}' }, report);
    expect(s.lists.rooms?.length).toBe(1);
    expect(out).toEqual(['content: a content file is not JSON']);
  });
});

describe('D1 loader', () => {
  const db = (rows: { texts?: unknown[]; items?: Record<string, unknown[]>; fail?: boolean }): ReadDb & { sql: string[] } => {
    const sql: string[] = [];
    return {
      sql,
      prepare(q: string) {
        sql.push(q);
        let arg: unknown;
        const st = {
          bind(...v: unknown[]) {
            arg = v[0];
            return st;
          },
          async all() {
            if (rows.fail) throw new Error('SELECT secret FROM x failed');
            return { results: (q.includes('FROM texts') ? rows.texts : rows.items?.[arg as string]) ?? [] } as { results: never[] };
          },
        };
        return st;
      },
    };
  };

  it('loads one query for texts and one per list', async () => {
    const d = db({
      texts: [{ key: 'home.title', value: 'Hi' }],
      items: { rooms: [{ id: 7, fields: '{"title":"Attic"}' }, { id: 8, fields: { title: 'Blue' } }] },
    });
    const r = createReader(content, await loadSnapshotFromD1(content, d, { lists: ['rooms'] }));
    expect(d.sql.length).toBe(2);
    expect(r.text('home.title')).toBe('Hi');
    expect(r.list('rooms').map((i) => i.id)).toEqual(['7', '8']);
  });

  it('falls back to defaults and logs when the query fails, without the error message', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const snap = await loadSnapshotFromD1(content, db({ fail: true }), { lists: ['rooms'], report: (m, f) => void calls.push([m, f]) });
    const r = createReader(content, snap);
    expect(r.text('home.title')).toBe('hello');
    expect(r.list('rooms')).toEqual([]);
    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls)).not.toContain('secret');
  });
});

describe('React helpers', () => {
  const r = createReader(
    content,
    snapshotFromFiles(content, { 'texts.json': '{"home.title":"Hi"}', 'rooms/a.json': '{"title":"Attic"}', 'rooms/b.json': '{"title":"Blue"}' }),
  );
  it('marks texts with data-copy, lists with data-list and items with data-item', () => {
    const html = renderToStaticMarkup(
      createElement(
        ContentProvider,
        { reader: r as Reader },
        createElement(Text, { k: 'home.title', as: 'h1' }),
        createElement(List, { name: 'rooms', children: (item) => String(item.values.title) }),
      ),
    );
    expect(html).toBe('<h1 data-copy="home.title">Hi</h1><ul data-list="rooms"><li data-item="a">Attic</li><li data-item="b">Blue</li></ul>');
  });
  it('needs a provider', () => {
    expect(() => renderToStaticMarkup(createElement(Text, { k: 'home.title' }))).toThrow(/ContentProvider/);
  });
  it('gives the attributes for Astro pages', () => {
    expect(listAttrs('rooms')).toEqual({ 'data-list': 'rooms' });
    expect(itemAttrs({ id: 'a' })).toEqual({ 'data-item': 'a' });
  });
});
