import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { defineContent, fakeStore, type ImageField, type ItemValues, type Store } from '../src/index.js';
import { ACCESS_HEADER, createEditor, HEAD_BUDGET, type AccessEnv, type Editor, type ImagesBinding, type MediaBucket } from '../src/server/index.js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env: AccessEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, EDITOR_EMAILS: 'ed@example.com', ADMIN_EMAILS: 'boss@example.com' };
const NOW = new Date('2026-11-15T12:00:00Z');
const ORIGIN = 'https://client.example';
const at = (s: number) => Math.floor(NOW.getTime() / 1000) + s;

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig' };
  keys = async () => (await import('jose')).importJWK(jwk, 'RS256') as Promise<CryptoKey>;
});
const token = (email: string) =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256' }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt(at(-60)).setExpirationTime(at(3600)).sign(privateKey);

/** A site declaring one `rooms` list whose `photo` field is as given: the same site before and after a change to the field. */
const declare = (photo: Partial<ImageField> = {}) =>
  defineContent({
    texts: [],
    lists: [
      {
        name: 'rooms',
        label: 'rooms',
        singular: 'room',
        titleField: 'title',
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true },
          { name: 'photo', label: 'Photo', type: 'image', ...photo },
        ],
        sort: 'hand',
        maxItems: 500,
      },
    ],
  });

function fakeBucket() {
  const objects = new Map<string, { value: Uint8Array; customMetadata?: Record<string, string> }>();
  const bucket: MediaBucket = {
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.value.length, customMetadata: o.customMetadata } : null;
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { size: o.value.length, customMetadata: o.customMetadata, body: new Blob([o.value as BlobPart]).stream() as ReadableStream<Uint8Array> } : null;
    },
    async put(key, value, options) {
      objects.set(key, { value: new Uint8Array(value as ArrayBuffer), customMetadata: options?.customMetadata });
    },
  };
  return { bucket, objects };
}

/** The images service, which can be told the month's allowance is used up. */
function fakeImages() {
  const state = { exhausted: false, made: 0 };
  const images: ImagesBinding = {
    async info() {
      return { format: 'image/jpeg', width: 4000, height: 3000 };
    },
    input() {
      const t = {
        transform: () => t,
        async output() {
          if (state.exhausted) throw Object.assign(new Error('ERROR 9422: limit'), { code: 9422 });
          state.made += 1;
          return { response: () => new Response('webp', { headers: { 'content-type': 'image/webp' } }) };
        },
      };
      return t;
    },
  };
  return { images, state };
}

const KEY = (n: number) => `2026/11/${String(n).padStart(24, 'a')}`;
const original = (b: ReturnType<typeof fakeBucket>, key: string, field = 'photo') =>
  b.objects.set(`originals/${key}`, { value: new Uint8Array([1]), customMetadata: { list: 'rooms', field, width: '4000', height: '3000' } });
const room = (id: string, n: number, crop?: { x: number; y: number; w: number; h: number }): { id: string; values: ItemValues } => ({
  id,
  values: { title: id, photo: { key: KEY(n), alt: 'a room', width: 4000, height: 3000, ...(crop ? { crop } : {}) } },
});

function site(content: ReturnType<typeof declare>, b: ReturnType<typeof fakeBucket>, i: ReturnType<typeof fakeImages>, store: Store, withUploads = true): Editor {
  return createEditor({
    content,
    store,
    mode: 'auto',
    site: { fetchPage: async () => new Response('no', { status: 404 }) },
    keys,
    now: () => NOW,
    ...(withUploads ? { uploads: { bucket: b.bucket, images: i.images } } : {}),
  });
}

type Who = 'nobody' | 'editor' | 'admin';
async function call(editor: Editor, who: Who, path: string, json?: unknown) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (who !== 'nobody') headers[ACCESS_HEADER] = await token(who === 'admin' ? 'boss@example.com' : 'ed@example.com');
  let body: string | undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers['content-type'] = 'application/json';
  }
  return (await editor.handle(new Request(ORIGIN + path, { method: json === undefined ? 'GET' : 'POST', headers, body }), env))!;
}
const missing = async (editor: Editor, offset = 0) => {
  const res = await call(editor, 'admin', `/admin/api/uploads/missing?list=rooms&offset=${offset}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    items: number; offset: number; next: number | null; needed: number;
    missing: { item: string; key: string; list: string; field: string; crop: unknown; width: number }[];
    problems: { item: string; kind: string; field: string; message: string }[];
  };
};
/** Does what the page's button does: one request for each missing size. Stops at 429. */
async function makeAll(editor: Editor, tasks: Awaited<ReturnType<typeof missing>>['missing']) {
  let made = 0;
  for (const t of tasks) {
    const res = await call(editor, 'admin', '/admin/api/uploads/renditions', { key: t.key, list: t.list, field: t.field, crop: t.crop, width: t.width });
    if (res.status === 429) return { made, stoppedAt429: true };
    expect(res.status).toBe(200);
    made += 1;
  }
  return { made, stoppedAt429: false };
}

const setup = (items: { id: string; values: ItemValues }[], photo: Partial<ImageField> = {}) => {
  const b = fakeBucket();
  const i = fakeImages();
  const store = fakeStore({ initial: { texts: {}, lists: { rooms: items } }, now: () => NOW.toISOString() });
  for (const item of items) original(b, (item.values.photo as { key: string }).key);
  return { b, i, store, editor: site(declare(photo), b, i, store) };
};

describe('which sizes are missing', () => {
  it('finds nothing missing when every size was made', async () => {
    const s = setup([room('blue', 1), room('attic', 2)], { widths: [400, 800] });
    const first = await missing(s.editor);
    expect(first).toMatchObject({ items: 2, next: null, needed: 4 });
    expect((await makeAll(s.editor, first.missing)).made).toBe(4);
    expect(await missing(s.editor)).toMatchObject({ needed: 4, missing: [], problems: [] });
  });

  it('finds the new width of every item after a field gains one, and no more', async () => {
    const s = setup([room('blue', 1), room('attic', 2), { id: 'plain', values: { title: 'plain', photo: { src: '/x.jpg', alt: 'x' } } }], { widths: [400, 800] });
    await makeAll(s.editor, (await missing(s.editor)).missing);
    // The site is deployed with a third width, over the same store and bucket.
    const after = site(declare({ widths: [400, 800, 1200] }), s.b, s.i, s.store);
    const found = await missing(after);
    expect(found).toMatchObject({ needed: 6, problems: [] });
    expect(found.missing.map((t) => [t.item, t.width])).toEqual([['blue', 1200], ['attic', 1200]]);
    expect(found.missing[0]).toMatchObject({ key: KEY(1), list: 'rooms', field: 'photo', crop: null });
    expect((await makeAll(after, found.missing)).made).toBe(2);
    expect((await missing(after)).missing).toEqual([]);
  });

  it('asks for the lightbox size a field gains', async () => {
    const s = setup([room('blue', 1)], { widths: [400, 800] });
    await makeAll(s.editor, (await missing(s.editor)).missing);
    const after = site(declare({ widths: [400, 800], full: 2000 }), s.b, s.i, s.store);
    expect((await missing(after)).missing.map((t) => t.width)).toEqual([2000]);
  });

  it('lists an item whose crop no longer fits a changed aspect, and does not guess', async () => {
    const s = setup([room('square', 1, { x: 0, y: 0, w: 3000, h: 3000 }), room('wide', 2, { x: 0, y: 0, w: 1600, h: 1000 })], { aspect: '1:1', widths: [400] });
    const after = site(declare({ aspect: '16:10', widths: [400] }), s.b, s.i, s.store);
    const found = await missing(after);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toMatchObject({ item: 'square', kind: 'crop', field: 'photo' });
    expect(found.missing.map((t) => t.item)).toEqual(['wide']);
    expect(found.needed).toBe(1);
  });

  it('lists an item whose original is gone', async () => {
    const s = setup([room('blue', 1)]);
    s.b.objects.clear();
    expect((await missing(s.editor)).problems).toMatchObject([{ item: 'blue', kind: 'original' }]);
  });

  it('works through a long list in bounded runs that cover every item once', async () => {
    const items = Array.from({ length: 30 }, (_, n) => room(`r${n}`, n + 1));
    const s = setup(items, { widths: [400, 800, 1200, 1600], full: 2400 });
    let heads = 0;
    const head = s.b.bucket.head.bind(s.b.bucket);
    s.b.bucket.head = (key) => ((heads += 1), head(key));
    const seen: string[] = [];
    let offset: number | null = 0;
    let runs = 0;
    while (offset !== null) {
      heads = 0;
      const run: Awaited<ReturnType<typeof missing>> = await missing(s.editor, offset);
      expect(heads).toBeLessThanOrEqual(HEAD_BUDGET);
      expect(run.offset).toBe(offset);
      seen.push(...run.missing.map((t) => `${t.item}/${t.width}`));
      offset = run.next;
      runs += 1;
    }
    expect(runs).toBeGreaterThan(1);
    expect(runs).toBeLessThanOrEqual(30);
    expect(seen).toHaveLength(150);
    expect(new Set(seen).size).toBe(150);
  });
});

describe('a stop at 429 and a resume', () => {
  it('stops at the allowance, keeps what was made, and a later check finds the rest', async () => {
    const s = setup([room('blue', 1), room('attic', 2)], { widths: [400, 800] });
    const found = await missing(s.editor);
    expect(found.missing).toHaveLength(4);
    // The allowance runs out after the second size.
    const first = await makeAll(s.editor, found.missing.slice(0, 2));
    expect(first).toEqual({ made: 2, stoppedAt429: false });
    s.i.state.exhausted = true;
    const stopped = await makeAll(s.editor, found.missing.slice(2));
    expect(stopped).toEqual({ made: 0, stoppedAt429: true });
    const next = await missing(s.editor);
    expect(next.missing).toHaveLength(2);
    expect(next.missing.map((t) => t.item)).toEqual(['attic', 'attic']);
    // Next month: the same page finds them again and makes them.
    s.i.state.exhausted = false;
    expect((await makeAll(s.editor, next.missing)).made).toBe(2);
    expect((await missing(s.editor)).missing).toEqual([]);
  });
});

describe('who may use it', () => {
  it('gives admins the page and the check, and everyone else an empty 403', async () => {
    const s = setup([room('blue', 1)]);
    for (const path of ['/admin/images', '/admin/images-page.js', '/admin/api/uploads/missing?list=rooms&offset=0']) {
      for (const who of ['nobody', 'editor'] as const) {
        const res = await call(s.editor, who, path);
        expect([path, who, res.status]).toEqual([path, who, 403]);
        expect(await res.text()).toBe('');
      }
      expect((await call(s.editor, 'admin', path)).status).toBe(200);
    }
    const page = await (await call(s.editor, 'admin', '/admin/images')).text();
    expect(page).toContain('src="/admin/images-page.js"');
    expect(page).toContain('"name":"rooms"');
  });

  it('is not there when the site has no uploads, and refuses a bad question', async () => {
    const s = setup([room('blue', 1)]);
    const none = site(declare(), s.b, s.i, s.store, false);
    expect((await call(none, 'admin', '/admin/images')).status).toBe(404);
    expect((await call(s.editor, 'admin', '/admin/api/uploads/missing?list=nope&offset=0')).status).toBe(404);
    expect((await call(s.editor, 'admin', '/admin/api/uploads/missing?list=rooms&offset=-1')).status).toBe(400);
    expect((await call(s.editor, 'admin', '/admin/api/uploads/missing?list=rooms&offset=x')).status).toBe(400);
  });
});
