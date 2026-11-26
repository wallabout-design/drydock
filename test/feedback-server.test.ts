import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFeedback, ACCESS_HEADER, MAX_NOTE_CHARACTERS, MAX_NOTES_PER_HOUR, type AccessEnv } from '../src/server/index.js';
import { fakeSenderStore, fakeSink, sinkContract } from '../src/testing/index.js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const ORIGIN = 'https://clientsite.example';
const env: AccessEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const NOW = new Date('2026-11-18T12:00:00Z');
const at = (seconds: number) => Math.floor(NOW.getTime() / 1000) + seconds;

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig' };
  keys = async () => (await import('jose')).importJWK(jwk, 'RS256') as Promise<CryptoKey>;
});

const token = (email = 'rev@example.com') =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256' }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt(at(-60)).setExpirationTime(at(3 * 3600)).sign(privateKey);

const context = { url: 'https://clientsite.example/stay?x=1', path: '/stay', viewport: '390x844', dpr: 3, ua: 'T/1', build: 'abc', selection: 'hi', id: 'k7mq' };

async function post(body: unknown, over: { jwt?: string | null; origin?: string | null; type?: string | null; raw?: string; method?: string; path?: string } = {}) {
  const headers: Record<string, string> = {};
  const jwt = over.jwt === undefined ? await token() : over.jwt;
  if (jwt) headers[ACCESS_HEADER] = jwt;
  if (over.origin !== null) headers.origin = over.origin ?? ORIGIN;
  if (over.type !== null) headers['content-type'] = over.type ?? 'application/json';
  return new Request(`${ORIGIN}${over.path ?? '/feedback/api/notes'}`, {
    method: over.method ?? 'POST',
    headers,
    body: over.method === 'GET' ? undefined : (over.raw ?? JSON.stringify(body)),
  });
}

function setup(over: { senders?: string | string[]; env?: AccessEnv; now?: () => Date; sink?: ReturnType<typeof fakeSink> } = {}) {
  const sink = over.sink ?? fakeSink();
  const feedback = createFeedback({ siteId: 'rr', sink, senders: over.senders ?? 'Rev@example.com, other@example.com', keys, now: over.now ?? (() => NOW) });
  return { sink, run: (req: Request) => feedback.handle(req, over.env ?? env) };
}

describe('a note from a listed sender', () => {
  it('reaches the sink with the subject tag and the sender', async () => {
    const { sink, run } = setup();
    const res = await run(await post({ note: 'Too small.\n\n\nReally.', context }));
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, ref: 'fake-1' });
    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0].sender).toEqual({ email: 'rev@example.com' });
    expect(sink.sent[0].note.subject).toBe('[rr] /stay #k7mq');
    expect(sink.sent[0].note.note).toBe('Too small.\n\nReally.');
    expect(sink.sent[0].note.context.selection).toBe('hi');
  });
  it('keeps the tag without a code, and drops a code that is not letters and digits', async () => {
    const { sink, run } = setup();
    await run(await post({ note: 'a', context: { ...context, id: 'x y\n[evil]' } }));
    await run(await post({ note: 'b', context: { path: '/about' } }));
    expect(sink.sent.map((s) => s.note.subject)).toEqual(['[rr] /stay', '[rr] /about']);
  });
  it('cleans the note and the page details as content fields are', async () => {
    const { sink, run } = setup();
    await run(await post({ note: 'a​b\u0007c', context: { ...context, path: '/s​tay\n', ua: 'a\n\nb' } }));
    const sent = sink.sent[0].note;
    expect(sent.note).toBe('ab c');
    expect(sent.context.path).toBe('/stay');
    expect(sent.context.ua).toBe('a b');
  });
  it('accepts a note of exactly the limit', async () => {
    const { run } = setup();
    expect((await run(await post({ note: 'a'.repeat(MAX_NOTE_CHARACTERS), context })))?.status).toBe(200);
  });
  it('answers 502 with the sink’s message when it cannot deliver', async () => {
    const { run } = setup({ sink: fakeSink({ fail: 'No luck.' }) });
    const res = await run(await post({ note: 'a', context }));
    expect(res?.status).toBe(502);
    expect(await res?.json()).toMatchObject({ error: 'not-delivered', message: 'No luck.' });
  });
  it('answers 502 when the sink throws, without its error text', async () => {
    const throwing = { sent: [], send: async () => { throw new Error('token ghp_secret'); } };
    const { run } = setup({ sink: throwing });
    const res = await run(await post({ note: 'a', context }));
    expect(res?.status).toBe(502);
    expect(JSON.stringify(await res?.json())).not.toContain('ghp_secret');
  });
  it('leaves other paths alone', async () => {
    const { run } = setup();
    expect(await run(new Request(`${ORIGIN}/about`))).toBeNull();
    expect((await run(new Request(`${ORIGIN}/feedback/api/other`)))?.status).toBe(404);
  });
});

describe('refusals', () => {
  const refused = async (res: Promise<Response | null> | Response | null, status: number, sink: ReturnType<typeof fakeSink>) => {
    expect((await res)?.status).toBe(status);
    expect(sink.sent).toHaveLength(0);
  };

  it('refuses a signed-out request with an empty 403', async () => {
    const { sink, run } = setup();
    const res = await run(await post({ note: 'a', context }, { jwt: null }));
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('');
    expect(sink.sent).toHaveLength(0);
  });
  it('refuses a junk token', async () => {
    const { sink, run } = setup();
    await refused(run(await post({ note: 'a', context }, { jwt: 'junk' })), 403, sink);
  });
  it('refuses someone signed in who is not a sender', async () => {
    const { sink, run } = setup();
    const res = await run(await post({ note: 'a', context }, { jwt: await token('stranger@example.com') }));
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('');
    expect(sink.sent).toHaveLength(0);
  });
  it('refuses everyone when a setting is missing', async () => {
    for (const settings of [{ ACCESS_AUD: AUD }, { ACCESS_TEAM_DOMAIN: TEAM }, {}] as AccessEnv[]) {
      const { sink, run } = setup({ env: settings });
      await refused(run(await post({ note: 'a', context })), 403, sink);
    }
    for (const senders of ['', [], ' , ']) {
      const { sink, run } = setup({ senders });
      await refused(run(await post({ note: 'a', context })), 403, sink);
    }
  });
  it('refuses a request from another origin, or with none', async () => {
    const { sink, run } = setup();
    await refused(run(await post({ note: 'a', context }, { origin: 'https://evil.example' })), 403, sink);
    await refused(run(await post({ note: 'a', context }, { origin: null })), 403, sink);
  });
  it('refuses a body that is not JSON', async () => {
    const { sink, run } = setup();
    await refused(run(await post({ note: 'a' }, { type: 'text/plain' })), 415, sink);
    await refused(run(await post({}, { raw: 'not json' })), 400, sink);
    await refused(run(await post({ note: 42 })), 400, sink);
  });
  it('refuses a body over 16 KB, by its size and by its length header', async () => {
    const { sink, run } = setup();
    await refused(run(await post({ note: 'a', context: { ...context, ua: 'u' }, extra: 'x'.repeat(17 * 1024) })), 413, sink);
    const req = await post({ note: 'a', context });
    const big = new Request(req, { headers: new Headers([...req.headers, ['content-length', String(17 * 1024)]]) });
    await refused(run(big), 413, sink);
  });
  it('refuses an empty note and a note over 5,000 characters', async () => {
    const { sink, run } = setup();
    await refused(run(await post({ note: ' \n ', context })), 422, sink);
    await refused(run(await post({ note: 'a'.repeat(MAX_NOTE_CHARACTERS + 1), context })), 422, sink);
  });
  it('refuses a method other than POST', async () => {
    const { sink, run } = setup();
    await refused(run(await post({}, { method: 'GET' })), 405, sink);
  });
  it('refuses the 21st note in an hour for one sender, not for another, and counts again after the hour', async () => {
    let clock = NOW;
    const { sink, run } = setup({ now: () => clock });
    for (let i = 0; i < MAX_NOTES_PER_HOUR; i++) expect((await run(await post({ note: `n${i}`, context })))?.status).toBe(200);
    const over = await run(await post({ note: 'one more', context }));
    expect(over?.status).toBe(429);
    expect(sink.sent).toHaveLength(MAX_NOTES_PER_HOUR);
    expect((await run(await post({ note: 'mine', context }, { jwt: await token('other@example.com') })))?.status).toBe(200);
    clock = new Date(NOW.getTime() + 61 * 60 * 1000);
    expect((await run(await post({ note: 'later', context })))?.status).toBe(200);
  });
});

describe('the fake sink', () => {
  sinkContract(() => fakeSink());
});

describe('the sender lookup for the feedback routine', () => {
  const ROUTINE = 'routine-client-id.access';
  const serviceToken = (claims: Record<string, unknown> = { common_name: ROUTINE }, over: { key?: CryptoKey; aud?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(over.aud ?? AUD)
      .setIssuedAt(at(-60))
      .setExpirationTime(at(3600))
      .sign(over.key ?? privateKey);
  const lookup = (jwt: string | null, ref = 'fake-1', method = 'GET') =>
    new Request(`${ORIGIN}/feedback/api/sender?ref=${encodeURIComponent(ref)}`, { method, headers: jwt ? { [ACCESS_HEADER]: jwt } : {} });

  function withStore(over: { routineClientIds?: string | string[] | undefined; store?: ReturnType<typeof fakeSenderStore> | null } = {}) {
    const sink = fakeSink();
    const senderStore = over.store === null ? undefined : (over.store ?? fakeSenderStore());
    const feedback = createFeedback({
      siteId: 'rr',
      sink,
      senders: 'rev@example.com',
      senderStore,
      routineClientIds: 'routineClientIds' in over ? over.routineClientIds : ROUTINE,
      keys,
      now: () => NOW,
    });
    return { senderStore, run: (req: Request) => feedback.handle(req, env) };
  }
  const submit = async (run: (r: Request) => Promise<Response | null>) => (await run(await post({ note: 'Too small.', context })))?.status;

  it('stores the sender when a note is delivered, and returns it to a listed service token', async () => {
    const { senderStore, run } = withStore();
    expect(await submit(run)).toBe(200);
    expect(senderStore?.entries.get('fake-1')).toEqual({ email: 'rev@example.com', site: 'rr' });
    const res = await run(lookup(await serviceToken()));
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ email: 'rev@example.com' });
    expect(res?.headers.get('cache-control')).toBe('no-store');
  });
  it('answers 404 for a ref it does not know, an empty ref, and a ref that is too long', async () => {
    const { run } = withStore();
    await submit(run);
    expect((await run(lookup(await serviceToken(), 'other')))?.status).toBe(404);
    expect((await run(lookup(await serviceToken(), '')))?.status).toBe(404);
    expect((await run(lookup(await serviceToken(), 'x'.repeat(501))))?.status).toBe(404);
  });
  it('refuses a browser session, even an allowed sender with the routine id in an email-less look-alike', async () => {
    const { run } = withStore();
    await submit(run);
    const res = await run(lookup(await token('rev@example.com')));
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('');
  });
  it('refuses a token that has an email claim, even with a listed common_name', async () => {
    const { run } = withStore();
    await submit(run);
    expect((await run(lookup(await serviceToken({ email: 'rev@example.com', common_name: ROUTINE }))))?.status).toBe(403);
  });
  it('refuses an unknown service token, no token, a token without common_name, and a forged or wrong-audience token', async () => {
    const { run } = withStore();
    await submit(run);
    expect((await run(lookup(await serviceToken({ common_name: 'someone-else' }))))?.status).toBe(403);
    expect((await run(lookup(null)))?.status).toBe(403);
    expect((await run(lookup(await serviceToken({}))))?.status).toBe(403);
    expect((await run(lookup(await serviceToken({ common_name: ROUTINE }, { key: (await generateKeyPair('RS256')).privateKey }))))?.status).toBe(403);
    expect((await run(lookup(await serviceToken({ common_name: ROUTINE }, { aud: 'other-aud' }))))?.status).toBe(403);
  });
  it('refuses everyone when no client ids are configured, or no store is', async () => {
    for (const over of [{ routineClientIds: undefined }, { routineClientIds: ' , ' }, { store: null }]) {
      const { run } = withStore(over);
      expect((await run(lookup(await serviceToken())))?.status).toBe(403);
    }
  });
  it('refuses a write method, and a settings-less Worker', async () => {
    const { run } = withStore();
    expect((await run(lookup(await serviceToken(), 'fake-1', 'POST')))?.status).toBe(405);
    const bare = createFeedback({ siteId: 'rr', sink: fakeSink(), senders: 'rev@example.com', senderStore: fakeSenderStore(), routineClientIds: ROUTINE, keys });
    expect((await bare.handle(lookup(await serviceToken()), {}))?.status).toBe(403);
  });
  it('accepts several client ids, separated by commas or in a list', async () => {
    for (const ids of ['a-id, routine-client-id.access', ['a-id', ROUTINE]]) {
      const { run } = withStore({ routineClientIds: ids });
      await submit(run);
      expect((await run(lookup(await serviceToken())))?.status).toBe(200);
    }
  });
  it('still answers a delivered note when the store fails, and keeps the address out of the response', async () => {
    const failing = { put: async () => { throw new Error('boom rev@example.com'); }, find: async () => null };
    const feedback = createFeedback({ siteId: 'rr', sink: fakeSink(), senders: 'rev@example.com', senderStore: failing, keys, now: () => NOW });
    const res = await feedback.handle(await post({ note: 'a', context }), env);
    expect(res?.status).toBe(200);
    expect(await res?.text()).not.toContain('rev@example.com');
  });
  it('stores nothing when the sink fails', async () => {
    const senderStore = fakeSenderStore();
    const feedback = createFeedback({ siteId: 'rr', sink: fakeSink({ fail: 'no' }), senders: 'rev@example.com', senderStore, keys, now: () => NOW });
    expect((await feedback.handle(await post({ note: 'a', context }), env))?.status).toBe(502);
    expect(senderStore.entries.size).toBe(0);
  });
});
