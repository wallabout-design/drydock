// The fixture site the browser tests run against: one public page with texts
// marked data-copy, the editor (built into dist/) over the in-memory store, and
// a few /__test routes to look at the store and to play "someone else".
// Usage: node e2e/server.mjs <port> <auto|review>
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';
import { defineContent, fakeStore } from '../dist/index.js';
import { ACCESS_HEADER, createEditor } from '../dist/server/index.js';

const port = Number(process.argv[2]);
const mode = process.argv[3] === 'review' ? 'review' : 'auto';

const TEAM = 'fixture.cloudflareaccess.com';
const AUD = 'fixture-aud';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, EDITOR_EMAILS: 'ed@example.com', ADMIN_EMAILS: 'boss@example.com' };

const content = defineContent({
  texts: [
    { key: 'home.title', default: 'Welcome to the house', max: 30, label: 'Home title' },
    { key: 'home.intro', default: 'A quiet place by the lake.', max: 120, label: 'Home intro' },
    { key: 'home.cta', default: 'Book a stay', max: 20, label: 'Booking button' },
  ],
  rules: [
    {
      name: 'no-street',
      test: (text) => !/main street/i.test(text),
      message: 'Please leave the street name out: the address is only for people with the guest code.',
    },
  ],
});

const START = () => ({
  texts: { 'home.title': 'Welcome to the house', 'home.intro': 'A quiet place by the lake.', 'home.cta': 'Book a stay' },
  lists: {},
});

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title></head>
<body>
<nav><a href="/other">Other page</a></nav>
<main>
<h1 data-copy="home.title">Welcome to the house</h1>
<p data-copy="home.intro">A quiet place by the lake.</p>
<p><a href="/book" data-copy="home.cta">Book a stay</a></p>
</main>
</body></html>`;

const pair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig' };
const keys = async () => importJWK(jwk, 'RS256');
const token = (email) =>
  new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(pair.privateKey);

let store;
let editor;
function reset() {
  store = fakeStore({ initial: START() });
  editor = createEditor({
    content,
    store,
    mode,
    keys,
    site: {
      fetchPage: async (path) =>
        path === '/'
          ? new Response(PAGE, { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" } })
          : new Response('not here', { status: 404 }),
    },
  });
}
reset();

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const body = await readBody(req);

  if (url.pathname === '/__test/state') return send(200, await store.read());
  if (url.pathname === '/__test/reset') {
    reset();
    return send(200, {});
  }
  if (url.pathname === '/__test/other') {
    // Someone else edits a text behind the editor's back (always live, so the page is stale).
    const { key, text } = JSON.parse(body.toString());
    const seen = (await store.read()).texts[key];
    const outcome = await store.submit({ ops: [{ op: 'setText', key, text, seen }], by: 'someone@example.com' }, 'auto');
    return send(outcome.ok ? 200 : 409, outcome);
  }
  if (url.pathname === '/__test/approve') {
    const waiting = await store.list({ state: 'waiting' });
    for (const change of waiting.changes) await store.approve(change.id, 'boss@example.com');
    return send(200, { approved: waiting.changes.length });
  }
  if (url.pathname === '/other' || url.pathname === '/book') return send(200, '<!doctype html><title>elsewhere</title><p>elsewhere</p>', 'text/html');
  if (url.pathname === '/') return send(200, PAGE, 'text/html');

  // Signed in as whoever the test-user cookie names.
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const who = /(?:^|; )test-user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (who) headers.set(ACCESS_HEADER, await token(decodeURIComponent(who)));
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
  const response = await editor.handle(new Request(url, init), env);
  if (!response) return send(404, 'not found', 'text/plain');
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1');
