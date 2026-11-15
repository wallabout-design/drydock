import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { defineContent, fakeStore, type Store } from '../src/index.js';
import { ACCESS_HEADER, createEditor, type AccessEnv, type Editor, type EditorSite } from '../src/server/index.js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env: AccessEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, EDITOR_EMAILS: 'ed@example.com', ADMIN_EMAILS: 'boss@example.com' };
const NOW = new Date('2026-11-15T12:00:00Z');
const ORIGIN = 'https://client.example';
const at = (s: number) => Math.floor(NOW.getTime() / 1000) + s;

const content = defineContent({
  texts: [{ key: 'home.title', default: 'Hello', max: 20, label: 'Home title' }],
  lists: [{ name: 'rooms', label: 'rooms', singular: 'room', titleField: 'title', fields: [{ name: 'title', label: 'Title', type: 'text', required: true }], sort: 'hand', maxItems: 3 }],
});
const START = {
  texts: { 'home.title': 'Hello' },
  lists: { rooms: [{ id: 'a', values: { title: 'Blue' } }] },
};
const PAGE = '<html><head><title>x</title></head><body><h1 data-copy="home.title">Hello</h1></body></html>';

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

function make(mode: 'auto' | 'review', fetchPage?: EditorSite['fetchPage']): { editor: Editor; store: Store } {
  const store = fakeStore({ initial: structuredClone(START), now: () => NOW.toISOString() });
  const site: EditorSite = {
    fetchPage: fetchPage ?? (async (path) =>
      path === '/' ? new Response(PAGE, { headers: { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" } }) : new Response('no', { status: 404 })),
  };
  return { editor: createEditor({ content, store, mode, site, keys, now: () => NOW }), store };
}

type Who = 'nobody' | 'editor' | 'admin';
async function call(editor: Editor, who: Who, method: string, path: string, over: { body?: unknown; origin?: string | null; type?: string | null; accept?: string; raw?: string } = {}) {
  const headers: Record<string, string> = {};
  if (who !== 'nobody') headers[ACCESS_HEADER] = await token(who === 'admin' ? 'boss@example.com' : 'ed@example.com');
  if (method === 'POST') {
    if (over.origin !== null) headers.origin = over.origin ?? ORIGIN;
    if (over.type !== null) headers['content-type'] = over.type ?? 'application/json';
  }
  if (over.accept) headers.accept = over.accept;
  const init: RequestInit = { method, headers };
  if (method === 'POST') init.body = over.raw ?? JSON.stringify(over.body ?? {});
  return editor.handle(new Request(ORIGIN + path, init), env);
}

const setTitle = (text: string, seen = 'Hello') => ({ ops: [{ op: 'setText', key: 'home.title', seen, text }] });

describe('paths the editor does not own', () => {
  it('returns null', async () => {
    const { editor } = make('auto');
    for (const path of ['/', '/about', '/administrator', '/api/admin/copy', '/adminx/edit']) {
      expect(await call(editor, 'nobody', 'GET', path)).toBeNull();
    }
  });
});

describe('signed out: nothing given, nothing changed', () => {
  const routes: [string, string][] = [
    ['GET', '/admin'], ['GET', '/admin/'], ['GET', '/admin/edit?page=/'], ['GET', '/admin/changes'],
    ['GET', '/admin/editor.js'], ['GET', '/admin/editor.css'], ['GET', '/admin/nothing-here'],
    ['POST', '/admin/api/changes'], ['POST', '/admin/api/check'], ['POST', '/admin/api/changes/c1/approve'],
    ['POST', '/admin/api/changes/c1/reject'], ['POST', '/admin/api/changes/c1/undo'],
  ];
  for (const mode of ['auto', 'review'] as const) {
    it(`gives an empty 403 on every route (${mode})`, async () => {
      const { editor, store } = make(mode);
      for (const [method, path] of routes) {
        const res = (await call(editor, 'nobody', method, path, { body: setTitle('Hacked') }))!;
        expect([method, path, res.status]).toEqual([method, path, 403]);
        expect(await res.text()).toBe('');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
      expect(await store.read()).toEqual(START);
      expect((await store.list()).changes).toEqual([]);
    });
  }
  it('refuses a token for someone not listed', async () => {
    const { editor } = make('auto');
    const headers = { [ACCESS_HEADER]: await token('stranger@example.com') };
    const res = await editor.handle(new Request(`${ORIGIN}/admin/changes`, { headers }), env);
    expect(res?.status).toBe(403);
  });
});

describe('as an editor in auto mode', () => {
  it('redirects /admin to the edit view', async () => {
    const res = (await call(make('auto').editor, 'editor', 'GET', '/admin'))!;
    expect([res.status, res.headers.get('location')]).toEqual([302, '/admin/edit']);
  });

  it('shows the public page with the editor and settings added, keeping its headers', async () => {
    const { editor } = make('auto');
    const res = (await call(editor, 'editor', 'GET', '/admin/edit?page=/'))!;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe("script-src 'self'");
    const html = await res.text();
    expect(html).toContain('<link rel="stylesheet" href="/admin/editor.css"></head>');
    expect(html).toContain('src="/admin/editor.js"');
    const settings = JSON.parse(/id="editor-settings">(.*?)<\/script>/.exec(html)![1]!);
    expect(settings).toMatchObject({ editor: 'ed@example.com', role: 'editor', mode: 'auto', page: '/' });
    expect(settings.texts).toEqual([{ key: 'home.title', max: 20, label: 'Home title', current: 'Hello' }]);
  });

  it('refuses pages that are not the site’s own public pages', async () => {
    const { editor } = make('auto');
    for (const page of ['/missing', '//evil.example/', 'https://evil.example/', '/admin/changes', '/admin']) {
      const res = (await call(editor, 'editor', 'GET', `/admin/edit?page=${encodeURIComponent(page)}`))!;
      expect([page, res.status]).toEqual([page, 404]);
    }
  });

  it('serves the editor files', async () => {
    const { editor } = make('auto');
    expect((await call(editor, 'editor', 'GET', '/admin/editor.js'))!.headers.get('content-type')).toContain('javascript');
    expect((await call(editor, 'editor', 'GET', '/admin/editor.css'))!.headers.get('content-type')).toContain('text/css');
  });

  it('submits a text change, which goes live', async () => {
    const { editor, store } = make('auto');
    const res = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi there') }))!;
    expect(res.status).toBe(200);
    const { change } = await res.json();
    expect(change).toMatchObject({ by: 'ed@example.com', state: 'live' });
    expect((await store.read()).texts['home.title']).toBe('Hi there');
  });

  it('checks a text without saving it', async () => {
    const { editor, store } = make('auto');
    const ask = async (body: unknown, over = {}) => (await call(editor, 'editor', 'POST', '/admin/api/check', { body, ...over }))!;
    const fine = await ask({ key: 'home.title', text: 'Hi there' });
    expect(fine.status).toBe(200);
    expect(await fine.json()).toEqual({ ok: true, problems: [] });
    const long = await (await ask({ key: 'home.title', text: 'x'.repeat(21) })).json();
    expect(long).toMatchObject({ ok: false, problems: [{ field: 'home.title', kind: 'too-long' }] });
    expect((await ask({ key: 'home.title' })).status).toBe(400);
    expect((await ask({ key: 'home.title', text: 'Hi' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(editor, 'editor', 'GET', '/admin/api/check'))!.status).toBe(405);
    expect(await store.read()).toEqual(START);
  });

  it('cleans the text and adds an item', async () => {
    const { editor, store } = make('auto');
    const ops = [{ op: 'addItem', list: 'rooms', id: 'b', values: { title: '  Green  ' }, after: 'a' }];
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes', { body: { ops } }))!.status).toBe(200);
    expect((await store.read()).lists.rooms!.map((i) => i.values.title)).toEqual(['Blue', 'Green']);
  });

  it('refuses text that fails the declaration, and changes nothing', async () => {
    const { editor, store } = make('auto');
    for (const text of ['x'.repeat(21), '<b>bold</b>', '']) {
      const res = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle(text) }))!;
      expect([text, res.status]).toEqual([text, 422]);
      expect((await res.json()).problems[0]).toMatchObject({ index: 0 });
    }
    expect(await store.read()).toEqual(START);
  });

  it('refuses more items than the list allows', async () => {
    const { editor, store } = make('auto');
    const ops = ['b', 'c', 'd'].map((id) => ({ op: 'addItem', list: 'rooms', id, values: { title: id }, after: 'a' }));
    const res = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: { ops } }))!;
    expect(res.status).toBe(422);
    expect((await store.read()).lists.rooms).toHaveLength(1);
  });

  it('answers 409 with the newer content when the editor’s view is stale', async () => {
    const { editor } = make('auto');
    const res = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Mine', 'Old words') }))!;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'stale', index: 0 });
    expect(body.current.texts['home.title']).toBe('Hello');
  });

  it('refuses a write from another origin, or with no origin', async () => {
    const { editor, store } = make('auto');
    for (const origin of ['https://evil.example', null]) {
      const res = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hacked'), origin }))!;
      expect(res.status).toBe(403);
    }
    expect(await store.read()).toEqual(START);
  });

  it('refuses a body that is not JSON, malformed, or over 64 KB', async () => {
    const { editor, store } = make('auto');
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi'), type: 'text/plain' }))!.status).toBe(415);
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes', { raw: 'nope' }))!.status).toBe(400);
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes', { body: { ops: [{ op: 'setText', key: 1 }] } }))!.status).toBe(400);
    const big = JSON.stringify({ ops: [], pad: 'x'.repeat(65 * 1024) });
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes', { raw: big }))!.status).toBe(413);
    expect(await store.read()).toEqual(START);
  });

  it('refuses the wrong method', async () => {
    const { editor } = make('auto');
    expect((await call(editor, 'editor', 'GET', '/admin/api/changes'))!.status).toBe(405);
    expect((await call(editor, 'editor', 'POST', '/admin/changes'))!.status).toBe(405);
  });

  it('may undo a live change', async () => {
    const { editor, store } = make('auto');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    const res = (await call(editor, 'editor', 'POST', '/admin/api/changes/c1/undo'))!;
    expect(res.status).toBe(200);
    expect((await store.read()).texts['home.title']).toBe('Hello');
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes/c1/undo'))!.status).toBe(409);
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes/zzz/undo'))!.status).toBe(404);
  });

  it('may not approve or reject', async () => {
    const { editor, store } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    for (const verb of ['approve', 'reject']) {
      const res = (await call(editor, 'editor', 'POST', `/admin/api/changes/c1/${verb}`))!;
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('');
    }
    expect((await store.list({ state: 'waiting' })).changes).toHaveLength(1);
    expect((await store.read()).texts['home.title']).toBe('Hello');
  });

  it('may not undo in review mode, where undo would skip the review', async () => {
    const { editor, store } = make('review');
    await call(editor, 'admin', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve');
    expect((await call(editor, 'editor', 'POST', '/admin/api/changes/c1/undo'))!.status).toBe(403);
    expect((await store.read()).texts['home.title']).toBe('Hi');
  });

  it('sees the Changes page without approve buttons, with text escaped', async () => {
    const { editor } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('A & B') });
    const res = (await call(editor, 'editor', 'GET', '/admin/changes'))!;
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('/approve');
  });
});

describe('as an admin', () => {
  it('approves a waiting change', async () => {
    const { editor, store } = make('review');
    const submitted = (await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') }))!;
    expect((await submitted.json()).change.state).toBe('waiting');
    expect((await store.read()).texts['home.title']).toBe('Hello');
    const res = (await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve'))!;
    expect(res.status).toBe(200);
    expect((await res.json()).change).toMatchObject({ state: 'live', decidedBy: 'boss@example.com' });
    expect((await store.read()).texts['home.title']).toBe('Hi');
  });

  it('rejects a waiting change and leaves the content alone', async () => {
    const { editor, store } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    expect((await call(editor, 'admin', 'POST', '/admin/api/changes/c1/reject'))!.status).toBe(200);
    expect((await store.read()).texts['home.title']).toBe('Hello');
    expect((await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve'))!.status).toBe(409);
  });

  it('undoes a live change in review mode', async () => {
    const { editor, store } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve');
    expect((await call(editor, 'admin', 'POST', '/admin/api/changes/c1/undo'))!.status).toBe(200);
    expect((await store.read()).texts['home.title']).toBe('Hello');
  });

  it('refuses a decision from another origin', async () => {
    const { editor, store } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Hi') });
    expect((await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve', { origin: 'https://evil.example' }))!.status).toBe(403);
    expect((await store.list({ state: 'waiting' })).changes).toHaveLength(1);
  });

  it('lists waiting, recent and undone changes with buttons, and a form post goes back to the page', async () => {
    const { editor } = make('review');
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('One') });
    await call(editor, 'editor', 'POST', '/admin/api/changes', { body: setTitle('Two') });
    await call(editor, 'admin', 'POST', '/admin/api/changes/c1/approve');
    await call(editor, 'admin', 'POST', '/admin/api/changes/c1/undo');
    const html = await (await call(editor, 'admin', 'GET', '/admin/changes'))!.text();
    expect(html).toContain('action="/admin/api/changes/c2/approve"');
    expect(html).toContain('action="/admin/api/changes/c2/reject"');
    expect(html).toContain('<h2>undone</h2>');
    const res = (await call(editor, 'admin', 'POST', '/admin/api/changes/c2/reject', { accept: 'text/html', type: 'application/x-www-form-urlencoded' }))!;
    expect([res.status, res.headers.get('location')]).toEqual([303, '/admin/changes']);
  });

  it('gets 404 for a route that does not exist', async () => {
    const res = (await call(make('auto').editor, 'admin', 'GET', '/admin/nothing-here'))!;
    expect(res.status).toBe(404);
  });
});
