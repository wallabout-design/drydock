import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFeedback, ACCESS_HEADER, MAX_NOTE_CHARACTERS, MAX_NOTES_PER_HOUR, type AccessEnv } from '../src/server/index.js';
import { fakeSink, sinkContract } from '../src/testing/index.js';

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
