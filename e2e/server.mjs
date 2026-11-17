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

const declare = (photo = {}) => defineContent({
  texts: [
    { key: 'home.title', default: 'Welcome to the house', max: 30, label: 'Home title' },
    { key: 'home.intro', default: 'A quiet place by the lake.', max: 120, label: 'Home intro' },
    { key: 'home.cta', default: 'Book a stay', max: 20, label: 'Booking button' },
  ],
  lists: [
    {
      name: 'rooms',
      label: 'rooms',
      singular: 'room',
      titleField: 'title',
      sort: 'hand',
      maxItems: 5,
      fields: [
        { name: 'title', label: 'Name', type: 'text', required: true, maxLength: 40 },
        { name: 'blurb', label: 'About the room', type: 'longtext', maxLength: 200 },
        { name: 'link', label: 'More information', type: 'link' },
        { name: 'beds', label: 'Beds', type: 'number', min: 1, max: 10 },
        { name: 'opens', label: 'First available', type: 'date' },
        { name: 'pets', label: 'Pets welcome', type: 'checkbox' },
        {
          name: 'view',
          label: 'View',
          type: 'choice',
          options: [
            { value: 'lake', label: 'The lake' },
            { value: 'garden', label: 'The garden' },
          ],
        },
        { name: 'photo', label: 'Photo', type: 'image', ...photo },
      ],
    },
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
  lists: {
    rooms: [
      { id: 'blue', values: { title: 'Blue room', beds: 2, pets: false, view: 'lake' } },
      { id: 'attic', values: { title: 'Attic', pets: true } },
      { id: 'porch', values: { title: 'Porch', pets: false } },
    ],
  },
});

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title></head>
<body>
<nav><a href="/other">Other page</a></nav>
<main>
<h1 data-copy="home.title">Welcome to the house</h1>
<p data-copy="home.intro">A quiet place by the lake.</p>
<p><a href="/other" data-copy="home.cta">Book a stay</a></p>
<ul data-list="rooms">
<li data-item="blue">Blue room</li>
<li data-item="attic">Attic</li>
<li data-item="porch">Porch</li>
</ul>
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

// A stand-in for the site's R2 bucket and `IMAGES` binding (the package takes both as arguments).
const objects = new Map();
const bucket = {
  async head(key) {
    const o = objects.get(key);
    return o ? { size: 1, customMetadata: o.customMetadata } : null;
  },
  async get(key) {
    const o = objects.get(key);
    return o ? { size: 1, customMetadata: o.customMetadata, body: new Blob(['x']).stream() } : null;
  },
  async put(key, _value, options) {
    objects.set(key, { customMetadata: options?.customMetadata });
  },
};
const allowance = { exhausted: false, left: null };
const images = {
  async info() {
    return { format: 'image/jpeg', width: 4000, height: 3000 };
  },
  input() {
    const t = {
      transform: () => t,
      async output() {
        if (allowance.exhausted || allowance.left === 0) throw Object.assign(new Error('ERROR 9422: limit'), { code: 9422 });
        if (allowance.left !== null) allowance.left -= 1;
        return { response: () => new Response('webp', { headers: { 'content-type': 'image/webp' } }) };
      },
    };
    return t;
  },
};

let store;
let editor;
function reset(photo = {}, initial = START()) {
  store = fakeStore({ initial });
  allowance.exhausted = false;
  allowance.left = null;
  editor = createEditor({
    content: declare(photo),
    store,
    mode,
    keys,
    uploads: { bucket, images },
    site: {
      fetchPage: async (path) =>
        path === '/' || path === '/other'
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
  if (url.pathname === '/__test/uploads') {
    // Starts over with rooms that hold uploaded photos (their originals are in the bucket) and a photo field as declared.
    const { rooms, photo } = JSON.parse(body.toString());
    objects.clear();
    const list = rooms.map(({ id, n, crop }) => {
      const key = `2026/11/${String(n).padStart(24, 'a')}`;
      objects.set(`originals/${key}`, { customMetadata: { list: 'rooms', field: 'photo', width: '4000', height: '3000' } });
      return { id, values: { title: id, photo: { key, alt: 'a room', width: 4000, height: 3000, ...(crop ? { crop } : {}) } } };
    });
    reset(photo, { texts: START().texts, lists: { rooms: list } });
    return send(200, {});
  }
  if (url.pathname === '/__test/declare') {
    // The site is deployed again with the photo field changed; the store and the bucket stay.
    const keep = await store.read();
    reset(JSON.parse(body.toString()), keep);
    return send(200, {});
  }
  if (url.pathname === '/__test/allowance') {
    // { exhausted: true } now, or { left: n } after n more sizes, or { exhausted: false } to lift it.
    const { exhausted = false, left = null } = JSON.parse(body.toString());
    allowance.exhausted = exhausted;
    allowance.left = left;
    return send(200, {});
  }
  if (url.pathname === '/__test/renditions') return send(200, [...objects.keys()].filter((k) => k.startsWith('renditions/')).sort());
  if (url.pathname === '/__test/other') {
    // Someone else edits a text behind the editor's back (always live, so the page is stale).
    const { key, text } = JSON.parse(body.toString());
    const seen = (await store.read()).texts[key];
    const outcome = await store.submit({ ops: [{ op: 'setText', key, text, seen }], by: 'someone@example.com' }, 'auto');
    return send(outcome.ok ? 200 : 409, outcome);
  }
  if (url.pathname === '/__test/submit') {
    // Someone else sends a change of their own, live at once.
    const { ops } = JSON.parse(body.toString());
    const outcome = await store.submit({ ops, by: 'someone@example.com' }, 'auto');
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

// The run that started this server stops it when it ends. If the run is killed
// instead (its parent process goes away), this server is re-parented: exit then.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.exit(0);
}, 1000).unref();
