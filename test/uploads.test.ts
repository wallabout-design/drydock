import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { defineContent, fakeStore, type Store } from '../src/index.js';
import {
  ACCESS_HEADER,
  createEditor,
  serveMedia,
  type AccessEnv,
  type Editor,
  type ImagesBinding,
  type MediaBucket,
} from '../src/server/index.js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env: AccessEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, EDITOR_EMAILS: 'ed@example.com', ADMIN_EMAILS: 'boss@example.com' };
const NOW = new Date('2026-11-15T12:00:00Z');
const ORIGIN = 'https://client.example';
const at = (s: number) => Math.floor(NOW.getTime() / 1000) + s;

const content = defineContent({
  texts: [{ key: 'home.title', default: 'Hello', max: 20, label: 'Home title' }],
  lists: [
    {
      name: 'rooms',
      label: 'rooms',
      singular: 'room',
      titleField: 'title',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'photo', label: 'Photo', type: 'image', aspect: '1:1', widths: [400, 800], full: 1600 },
        { name: 'other', label: 'Other', type: 'image' },
      ],
      sort: 'hand',
      maxItems: 5,
    },
  ],
});

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

interface Stored {
  value: Uint8Array;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}
function fakeBucket() {
  const objects = new Map<string, Stored>();
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
      objects.set(key, { value: new Uint8Array(value as ArrayBuffer), ...options });
    },
  };
  return { bucket, objects };
}

interface Call {
  trim?: { left: number; top: number; width: number; height: number };
  width?: number;
}
function fakeImages(over: { size?: { width: number; height: number }; fail?: unknown; failAvif?: unknown; type?: string; avifAnswer?: string } = {}) {
  const calls: Call[] = [];
  const formats: string[] = [];
  const images: ImagesBinding = {
    async info() {
      return { format: 'image/jpeg', ...(over.size ?? { width: 4000, height: 6000 }) };
    },
    input() {
      const call: Call = {};
      const t = {
        transform(o: Call) {
          Object.assign(call, o);
          return t;
        },
        async output(options: { format: string }) {
          calls.push(call);
          formats.push(options.format);
          const avif = options.format === 'image/avif';
          if (over.fail) throw over.fail;
          if (avif && over.failAvif) throw over.failAvif;
          // The service answers WebP for an AVIF request above its pixel limit, without an error.
          const type = avif && over.avifAnswer ? over.avifAnswer : (over.type ?? options.format);
          return { response: () => new Response(`${type}-bytes`, { headers: { 'content-type': type } }) };
        },
      };
      return t;
    },
  };
  return { images, calls, formats };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));

function make(over: Parameters<typeof fakeImages>[0] = {}, withUploads = true) {
  const store: Store = fakeStore({ initial: { texts: { 'home.title': 'Hello' }, lists: { rooms: [] } }, now: () => NOW.toISOString() });
  const b = fakeBucket();
  const i = fakeImages(over);
  const editor: Editor = createEditor({
    content,
    store,
    mode: 'auto',
    site: { fetchPage: async () => new Response('no', { status: 404 }) },
    keys,
    now: () => NOW,
    ...(withUploads ? { uploads: { bucket: b.bucket, images: i.images } } : {}),
  });
  return { editor, store, ...b, ...i };
}

type Who = 'nobody' | 'editor';
async function post(editor: Editor, who: Who, path: string, init: { body?: BodyInit; origin?: string | null; headers?: Record<string, string>; json?: unknown } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (who !== 'nobody') headers[ACCESS_HEADER] = await token('ed@example.com');
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers['content-type'] = 'application/json';
  }
  return editor.handle(new Request(ORIGIN + path, { method: 'POST', headers, body }), env);
}

const UP = '/admin/api/uploads?list=rooms&field=photo';
const REND = '/admin/api/uploads/renditions';
const upload = async (m: ReturnType<typeof make>, field = 'photo', bytes: Uint8Array = JPEG) => {
  const res = (await post(m.editor, 'editor', `/admin/api/uploads?list=rooms&field=${field}`, { body: bytes as BodyInit, headers: { 'content-type': 'image/jpeg' } }))!;
  expect(res.status).toBe(200);
  return (await res.json()) as { key: string; width: number; height: number };
};
const CROP = { x: 0, y: 500, w: 3000, h: 3000 };

describe('uploading an original', () => {
  it('keeps JPEG, PNG and WebP by their first bytes, with a random key and the size from the binding', async () => {
    const m = make();
    const keysSeen = new Set<string>();
    for (const bytes of [JPEG, PNG, WEBP]) {
      const { key, width, height } = await upload(m, 'photo', bytes);
      expect(key).toMatch(/^2026\/11\/[A-Za-z0-9_-]{24}$/);
      expect([width, height]).toEqual([4000, 6000]);
      keysSeen.add(key);
      const stored = m.objects.get(`originals/${key}`)!;
      expect(stored.customMetadata).toMatchObject({ list: 'rooms', field: 'photo', width: '4000', height: '6000' });
      expect(stored.value).toEqual(bytes);
    }
    expect(keysSeen.size).toBe(3);
  });

  it('refuses a renamed non-image, whatever its name or header says', async () => {
    const m = make();
    const res = (await post(m.editor, 'editor', UP, { body: new TextEncoder().encode('<svg onload=alert(1)>') as BodyInit, headers: { 'content-type': 'image/png' } }))!;
    expect(res.status).toBe(415);
    expect(m.objects.size).toBe(0);
  });

  it('refuses a body over 15 MB from content-length, before reading it', async () => {
    const m = make();
    let read = false;
    const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
    const res = (await m.editor.handle(
      new Request(ORIGIN + UP, { method: 'POST', body, duplex: 'half', headers: { [ACCESS_HEADER]: await token('ed@example.com'), origin: ORIGIN, 'content-length': String(15 * 1024 * 1024 + 1) } } as RequestInit),
      env,
    ))!;
    expect(res.status).toBe(413);
    expect(read).toBe(false);
    expect(m.objects.size).toBe(0);
  });

  it('stops reading at 15 MB when the header is missing or lies', async () => {
    const m = make();
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(JPEG);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 20) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const res = (await m.editor.handle(
      new Request(ORIGIN + UP, { method: 'POST', body, duplex: 'half', headers: { [ACCESS_HEADER]: await token('ed@example.com'), origin: ORIGIN, 'content-length': '10' } } as RequestInit),
      env,
    ))!;
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(20);
    expect(m.objects.size).toBe(0);
  });

  it('is an empty 403 signed out, and a 403 from another site, with nothing written', async () => {
    const m = make();
    const out = (await post(m.editor, 'nobody', UP, { body: JPEG as BodyInit }))!;
    expect(out.status).toBe(403);
    expect(await out.text()).toBe('');
    const cross = (await post(m.editor, 'editor', UP, { body: JPEG as BodyInit, origin: 'https://evil.example' }))!;
    expect(cross.status).toBe(403);
    const none = (await post(m.editor, 'editor', UP, { body: JPEG as BodyInit, origin: null }))!;
    expect(none.status).toBe(403);
    const rend = (await post(m.editor, 'nobody', REND, { json: {} }))!;
    expect(rend.status).toBe(403);
    expect(m.objects.size).toBe(0);
  });

  it('refuses a field that is not an image field, and an image the binding cannot read', async () => {
    const m = make();
    for (const q of ['list=rooms&field=title', 'list=rooms&field=nope', 'list=nope&field=photo', '']) {
      expect((await post(m.editor, 'editor', `/admin/api/uploads?${q}`, { body: JPEG as BodyInit }))!.status).toBe(404);
    }
    const huge = make({ size: { width: 50000, height: 10 } });
    expect((await post(huge.editor, 'editor', UP, { body: JPEG as BodyInit }))!.status).toBe(422);
    expect(huge.objects.size).toBe(0);
  });

  it('has no upload routes when uploads are not configured', async () => {
    const m = make({}, false);
    expect((await post(m.editor, 'editor', UP, { body: JPEG as BodyInit }))!.status).toBe(404);
  });
});

describe('making a size', () => {
  it('cuts the crop in whole pixels, makes a WebP and an AVIF, and stores both', async () => {
    const m = make();
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 } }))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: `renditions/${key}/c0-500-3000-3000/800.webp`, made: true, avif: true });
    const cut = { trim: { left: 0, top: 500, width: 3000, height: 3000 }, width: 800 };
    expect(m.calls).toEqual([cut, cut]);
    expect(m.formats).toEqual(['image/webp', 'image/avif']);
    expect(m.objects.get(`renditions/${key}/c0-500-3000-3000/800.webp`)!.httpMetadata?.contentType).toBe('image/webp');
    expect(m.objects.get(`renditions/${key}/c0-500-3000-3000/800.avif`)!.httpMetadata?.contentType).toBe('image/avif');
  });

  it('makes no AVIF for a size too big for it, and says so', async () => {
    const m = make();
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 1600 } }))!;
    expect(await res.json()).toEqual({ key: `renditions/${key}/c0-500-3000-3000/1600.webp`, made: true, avif: false });
    expect(m.formats).toEqual(['image/webp']);
    expect([...m.objects.keys()].some((k) => k.endsWith('.avif'))).toBe(false);
  });

  it('stores no AVIF when the images service answers WebP for an AVIF request, and keeps the WebP', async () => {
    const m = make({ avifAnswer: 'image/webp' });
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 } }))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: `renditions/${key}/c0-500-3000-3000/800.webp`, made: true, avif: false });
    expect([...m.objects.keys()].some((k) => k.endsWith('.avif'))).toBe(false);
  });

  it('keeps the WebP when the AVIF fails, and makes only the missing AVIF of a size already made', async () => {
    const m = make({ failAvif: new Error('boom') });
    const { key } = await upload(m);
    const body = { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 };
    expect((await post(m.editor, 'editor', REND, { json: body }))!.status).toBe(200);
    expect(m.objects.has(`renditions/${key}/c0-500-3000-3000/800.webp`)).toBe(true);
    expect(m.objects.has(`renditions/${key}/c0-500-3000-3000/800.avif`)).toBe(false);

    const retry = make();
    const again = await upload(retry);
    await post(retry.editor, 'editor', REND, { json: { ...body, key: again.key } });
    retry.objects.delete(`renditions/${again.key}/c0-500-3000-3000/800.avif`);
    retry.formats.length = 0;
    const res = (await post(retry.editor, 'editor', REND, { json: { ...body, key: again.key } }))!;
    expect(await res.json()).toEqual({ key: `renditions/${again.key}/c0-500-3000-3000/800.webp`, made: false, avif: true });
    expect(retry.formats).toEqual(['image/avif']);
  });

  it('accepts the field’s full width, and answers 200 without making it again', async () => {
    const m = make();
    const { key } = await upload(m);
    const body = { key, list: 'rooms', field: 'photo', crop: CROP, width: 1600 };
    expect((await post(m.editor, 'editor', REND, { json: body }))!.status).toBe(200);
    expect((await post(m.editor, 'editor', REND, { json: body }))!.status).toBe(200);
    expect(m.calls).toHaveLength(1);
  });

  it('refuses a crop of the wrong shape, one outside the image, and a missing one when the field has an aspect', async () => {
    const m = make();
    const { key } = await upload(m);
    for (const crop of [{ x: 0, y: 0, w: 3000, h: 2000 }, { x: 2000, y: 0, w: 3000, h: 3000 }, { x: 0, y: 4000, w: 3000, h: 3000 }, { x: 0.5, y: 0, w: 3000, h: 3000 }, 'x', undefined]) {
      const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop, width: 800 } }))!;
      expect(res.status).toBe(422);
    }
    expect(m.calls).toHaveLength(0);
  });

  it('refuses a width the field does not declare', async () => {
    const m = make();
    const { key } = await upload(m);
    for (const width of [500, 1200, 2400, 1599, 0, -800, 800.5, '800']) {
      const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width } }))!;
      expect(res.status).toBe(width === '800' ? 400 : 422);
    }
    expect(m.calls).toHaveLength(0);
  });

  it('refuses an upload made for another field, a key that is not one, and a key that is not stored', async () => {
    const m = make();
    const { key } = await upload(m, 'other');
    const attempts = [
      { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 },
      { key: '../originals/x', list: 'rooms', field: 'photo', crop: CROP, width: 800 },
      { key: '2026/11/aaaaaaaaaaaaaaaaaaaaaaaa', list: 'rooms', field: 'photo', crop: CROP, width: 800 },
    ];
    for (const a of attempts) expect((await post(m.editor, 'editor', REND, { json: a }))!.status).toBe(404);
    expect(m.calls).toHaveLength(0);
  });

  it('answers 429 with a plain sentence when the free allowance is used up', async () => {
    const m = make({ fail: Object.assign(new Error('ERROR 9422: limit'), { code: 9422 }) });
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 } }))!;
    expect(res.status).toBe(429);
    expect(((await res.json()) as { message: string }).message).toContain('free image allowance is used up');
    expect([...m.objects.keys()].some((k) => k.startsWith('renditions/'))).toBe(false);
  });

  it('stores nothing when the answer is not a WebP', async () => {
    const m = make({ type: 'image/png' });
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 } }))!;
    expect(res.status).toBe(502);
    expect([...m.objects.keys()].some((k) => k.startsWith('renditions/'))).toBe(false);
  });

  it('is refused from another site', async () => {
    const m = make();
    const { key } = await upload(m);
    const res = (await post(m.editor, 'editor', REND, { origin: 'https://evil.example', json: { key, list: 'rooms', field: 'photo', crop: CROP, width: 800 } }))!;
    expect(res.status).toBe(403);
  });
});

describe('saving an item with an upload', () => {
  const save = (m: ReturnType<typeof make>, photo: unknown) =>
    post(m.editor, 'editor', '/admin/api/changes', { json: { ops: [{ op: 'addItem', list: 'rooms', id: 'a', after: null, values: { title: 'Blue', photo } }] } });

  it('takes width and height from the stored original, not from the request', async () => {
    const m = make();
    const { key } = await upload(m);
    // The browser claims a size under which this crop would fit; the stored original is what counts.
    const res = (await save(m, { key, alt: 'A room', width: 3000, height: 3500, crop: CROP }))!;
    expect(res.status).toBe(200);
    const state = await m.store.read();
    expect(state.lists.rooms?.[0]?.values.photo).toEqual({ key, alt: 'A room', width: 4000, height: 6000, crop: CROP });
  });

  it('refuses a crop that fits the claimed size but not the real one', async () => {
    const m = make({ size: { width: 3200, height: 3200 } });
    const { key } = await upload(m);
    const res = (await save(m, { key, alt: 'A room', width: 4000, height: 6000, crop: CROP }))!;
    expect(res.status).toBe(422);
  });

  it('refuses a key that is not in the bucket, and one uploaded for another field', async () => {
    const m = make();
    const { key } = await upload(m, 'other');
    const crop = { x: 0, y: 0, w: 1000, h: 1000 };
    expect((await save(m, { key, alt: 'A room', width: 4000, height: 6000, crop }))!.status).toBe(422);
    expect((await save(m, { key: '2026/11/aaaaaaaaaaaaaaaaaaaaaaaa', alt: 'A room', width: 4000, height: 6000, crop }))!.status).toBe(422);
    expect((await m.store.read()).lists.rooms).toEqual([]);
  });

  it('refuses an upload value, with a clear problem, when uploads are not configured', async () => {
    const m = make({}, false);
    const res = (await save(m, { key: '2026/11/aaaaaaaaaaaaaaaaaaaaaaaa', alt: 'A room', width: 4000, height: 6000, crop: CROP }))!;
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('can’t keep uploaded images');
    expect((await m.store.read()).lists.rooms).toEqual([]);
  });

  it('still saves an image address when uploads are not configured', async () => {
    const m = make({}, false);
    expect((await save(m, { src: 'https://example.com/a.jpg', alt: 'A room' }))!.status).toBe(200);
  });
});

describe('serveMedia', () => {
  const KEY = '2026/11/abcdefghijklmnopqrstuvwx';
  const get = (b: MediaBucket, path: string, method = 'GET') => serveMedia(new Request(ORIGIN + path, { method }), b);

  it('serves a made AVIF size as AVIF, and refuses an AVIF path for a WebP that is not there', async () => {
    const { bucket, objects } = fakeBucket();
    objects.set(`renditions/${KEY}/whole/800.avif`, { value: new TextEncoder().encode('avif-bytes') });
    const res = await get(bucket, `/media/${KEY}/whole/800.avif`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/avif');
    expect((await get(bucket, `/media/${KEY}/whole/801.avif`)).status).toBe(404);
    expect((await get(bucket, `/media/${KEY}/whole/800.webp`)).status).toBe(404);
  });

  it('serves a made size with its headers', async () => {
    const { bucket, objects } = fakeBucket();
    objects.set(`renditions/${KEY}/whole/800.webp`, { value: new TextEncoder().encode('webp-bytes') });
    const res = await get(bucket, `/media/${KEY}/whole/800.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('webp-bytes');
    expect((await get(bucket, `/media/${KEY}/whole/800.webp`, 'HEAD')).status).toBe(200);
    expect((await get(bucket, `/media/${KEY}/whole/800.webp`, 'POST')).status).toBe(405);
  });

  it('is a 404 for originals, other shapes of path and sizes not made', async () => {
    const { bucket, objects } = fakeBucket();
    objects.set(`originals/${KEY}`, { value: JPEG });
    objects.set(`renditions/${KEY}/whole/800.webp`, { value: JPEG });
    const paths = [
      `/media/originals/${KEY}`,
      `/media/${KEY}`,
      `/media/${KEY}/whole/800.jpg`,
      `/media/${KEY}/whole/801.webp`,
      `/media/../originals/${KEY}`,
      `/media/%2e%2e/originals/${KEY}`,
      `/media/${KEY}/whole/800.webp/`,
      `/media/${KEY}/whole/..%2f..%2foriginals%2f${KEY}.webp`,
      `/other/${KEY}/whole/800.webp`,
      `/media/`,
    ];
    for (const p of paths) expect((await get(bucket, p)).status).toBe(404);
  });
});
