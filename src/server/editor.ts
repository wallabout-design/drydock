// createEditor: the whole of /admin for one site (content-editing.md, "sign-in",
// "a change", "the edit view"). A site's Worker hands every request to
// `handle(request, env)`; it answers the paths it owns and returns null for the
// rest. Every request under /admin passes `identify` first, and a signed-out one
// gets a 403 with nothing in it.
//
//   GET  /admin/edit?page=/about              that public page, with the editor added
//   GET  /admin/editor.js, /admin/editor.css  the editor's own script and styles
//   GET  /admin/lists/<name>                  the items of a list, with add, edit, remove and move
//   GET  /admin/item-form.js, /admin/list-page.js  the list page's scripts (the form is its own module, which the edit view opens too)
//   GET  /admin/images                        admins: rebuild the image sizes a changed field now needs (only when `uploads` is given)
//   GET  /admin/api/me                        { email, role, waiting }: who is signed in (waiting is 0 for editors); the dock's staff hint
//   GET  /admin/api/uploads/missing?list=&offset=  admins: the sizes a list's items need and lack
//   GET  /admin/changes                       waiting, recent and undone changes, as plain HTML
//   POST /admin/api/changes                   { ops: Operation[] } submits a change
//   POST /admin/api/uploads?list=&field=      an image, as the body; kept as it is (only when `uploads` is given)
//   POST /admin/api/uploads/renditions        { key, list, field, crop?, width } makes one size of an upload
//   POST /admin/api/uploads/sizes             { key, list, field, crop? } the widths saving will ask for, and the largest one's address
//   GET  /admin/api/uploads/original?key=&list=&field=  a stored original, so staff can change its crop
//   POST /admin/api/check                     { key, text } says whether a text would be accepted
//   POST /admin/api/changes/<id>/approve      admins only
//   POST /admin/api/changes/<id>/reject       admins only
//   POST /admin/api/changes/<id>/undo         editors in `auto`; admins only in `review`
//
// Adapted from the site trial's worker/copy-edit/handler.ts.
import type { JWTVerifyGetKey } from 'jose';
import type { Operation } from '../core/change.js';
import type { Content } from '../core/declare.js';
import type { Change, ChangePage, Mode, Outcome, Refusal, Store } from '../core/store.js';
import type { ItemValues, Problem } from '../core/types.js';
import { can, identify, type AccessEnv, type Action, type Identity } from './access.js';
import { orderItems } from '../core/read.js';
import { createUploadRoutes, MAX_UPLOAD_BYTES, uploadsNotSetUp, type UploadsOptions } from './uploads.js';
import { EDITOR_CSS, EDITOR_JS, IMAGES_PAGE_JS, ITEM_FORM_JS, LIST_PAGE_JS } from './editor-assets.js';

/** The most pages `me()` reads when counting waiting changes. */
const ME_MAX_PAGES = 50;

export const MAX_BODY_BYTES = 64 * 1024;

export interface EditorSite {
  /** Gets the public page at `path` (such as `/about`) exactly as a signed-out visitor gets it. */
  fetchPage(path: string, request: Request): Promise<Response>;
  /** The site's own origin, when the Worker can't tell it from the request address. */
  origin?: string;
}

export interface EditorOptions {
  content: Content;
  store: Store;
  mode: Mode;
  site: EditorSite;
  /** For tests: the keys an Access token is checked against, and the time it is checked at. */
  keys?: JWTVerifyGetKey;
  now?: () => Date;
  /** The bucket and images binding for uploaded images. Without it, an uploaded image is refused on save. */
  uploads?: UploadsOptions;
}

export interface Editor {
  /** The response for a path the editor owns, or null for any other path. */
  handle(request: Request, env: AccessEnv): Promise<Response | null>;
}

const NO_STORE = { 'cache-control': 'no-store' };

/** When an accepted change is live, in the words the pages use. The store says which (StoreCapabilities.goesLive). */
const WHEN_LIVE = {
  'at-once': { changes: 'changes go live on their own', listPage: 'What you save here is on the site straight away.' },
  'after-checks': { changes: 'changes go live in a few minutes, after checks', listPage: 'What you save here is live in a few minutes, after checks.' },
} as const;

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status, headers: NO_STORE });

/** Nothing at all in the body: what a signed-out request, or a role without the right, gets. */
const forbidden = (): Response => new Response(null, { status: 403, headers: NO_STORE });
const notFound = (): Response => new Response(null, { status: 404, headers: NO_STORE });
const wrongMethod = (allow: string): Response =>
  new Response(null, { status: 405, headers: { ...NO_STORE, allow } });

/** True for `/admin` and everything under it, and nothing else (not `/administrator`). */
export const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** The operations in a request body, or null when it is not `{ ops: Operation[] }` of the right shapes. */
export function parseOps(text: string): Operation[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const ops = isRecord(body) ? body.ops : undefined;
  if (!Array.isArray(ops) || ops.length === 0) return null;
  const out: Operation[] = [];
  for (const o of ops as unknown[]) {
    if (!isRecord(o)) return null;
    if (o.op === 'setText' && isString(o.key) && isString(o.text) && isString(o.seen)) {
      out.push({ op: 'setText', key: o.key, text: o.text, seen: o.seen });
    } else if (o.op === 'addItem' && isString(o.list) && isString(o.id) && isRecord(o.values) && isNullableString(o.after)) {
      out.push({ op: 'addItem', list: o.list, id: o.id, values: o.values as ItemValues, after: o.after });
    } else if (o.op === 'editItem' && isString(o.list) && isString(o.id) && isRecord(o.values) && isRecord(o.seen)) {
      out.push({ op: 'editItem', list: o.list, id: o.id, values: o.values as ItemValues, seen: o.seen as ItemValues });
    } else if (o.op === 'removeItem' && isString(o.list) && isString(o.id) && isRecord(o.seen)) {
      out.push({ op: 'removeItem', list: o.list, id: o.id, seen: o.seen as ItemValues });
    } else if (o.op === 'moveItem' && isString(o.list) && isString(o.id) && isNullableString(o.after) && isNullableString(o.seen)) {
      out.push({ op: 'moveItem', list: o.list, id: o.id, after: o.after, seen: o.seen });
    } else {
      return null;
    }
  }
  return out;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SHORT = 120;
const short = (s: string): string => (s.length > SHORT ? `${s.slice(0, SHORT)}…` : s);

function describeOp(content: Content, o: Operation): string {
  if (o.op === 'setText') return `${o.key}: "${short(o.seen)}" to "${short(o.text)}"`;
  const list = content.lists.get(o.list);
  const title = (values: ItemValues): string => {
    const t = list ? values[list.titleField] : undefined;
    return typeof t === 'string' ? short(t) : o.id;
  };
  const label = list?.singular ?? 'item';
  switch (o.op) {
    case 'addItem':
      return `${o.list}: add ${label} "${title(o.values)}"`;
    case 'editItem':
      return `${o.list}: edit ${label} "${title(o.seen)}"`;
    case 'removeItem':
      return `${o.list}: remove ${label} "${title(o.seen)}"`;
    case 'moveItem':
      return `${o.list}: move ${label} ${o.id}`;
  }
}

export function createEditor(options: EditorOptions): Editor {
  const { content, store, mode, site } = options;
  const when = WHEN_LIVE[store.capabilities.goesLive];

  const uploads = options.uploads ? createUploadRoutes(content, options.uploads, json) : null;
  /** What the item form needs to offer a file picker: absent when the site has no `uploads`. */
  const uploadsSettings = uploads ? { api: '/admin/api/uploads', maxBytes: MAX_UPLOAD_BYTES } : undefined;

  const ownOrigin = (request: Request): string => site.origin ?? new URL(request.url).origin;

  /** Who may undo: anyone who may edit when changes go live on their own, only admins when an admin reviews them. */
  const undoAction: Action = mode === 'auto' ? 'edit' : 'approve';

  async function readBody(request: Request): Promise<{ text: string } | Response> {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return json(413, { error: 'too-large', message: 'That is too much at once.' });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return json(413, { error: 'too-large', message: 'That is too much at once.' });
    }
    return { text };
  }

  const fromRefusal = (refusal: Refusal): Response => {
    switch (refusal.reason) {
      case 'stale':
        return json(409, { error: 'stale', index: refusal.index, current: refusal.current });
      case 'invalid':
        return json(422, { error: 'invalid', message: refusal.message });
      case 'not-found':
        return json(404, { error: 'not-found' });
      case 'wrong-state':
        return json(409, { error: 'wrong-state', state: refusal.state });
    }
  };

  /** A browser form on the Changes page gets sent back there; the editor script gets JSON. */
  function answer(request: Request, outcome: Outcome): Response {
    if (!outcome.ok) return fromRefusal(outcome.refusal);
    if ((request.headers.get('accept') ?? '').includes('text/html')) {
      return new Response(null, { status: 303, headers: { ...NO_STORE, location: '/admin/changes' } });
    }
    return json(200, { change: outcome.change });
  }

  /** Checks every operation against the declaration. Returns the operations with texts and items cleaned, or the problems. */
  async function checkOps(ops: Operation[]): Promise<{ ops: Operation[] } | { problems: (Problem & { index: number })[] }> {
    const problems: (Problem & { index: number })[] = [];
    const checked: Operation[] = [];
    const growth = new Map<string, number>();
    for (const [index, o] of ops.entries()) {
      const fail = (found: Problem[]) => problems.push(...found.map((p) => ({ ...p, index })));
      if (o.op === 'setText') {
        const check = content.validateText(o.key, o.text);
        if (check.ok) checked.push({ ...o, text: check.text });
        else fail(check.problems);
      } else if (o.op === 'addItem' || o.op === 'editItem') {
        const check = content.validateItem(o.list, o.values);
        if (!check.ok) fail(check.problems);
        else {
          // An uploaded image takes its size from the stored original, and must be one made for this very field.
          const settled = uploads ? await uploads.settle(o.list, check.values) : { problems: uploadsNotSetUp(content, o.list, check.values) };
          if ('problems' in settled) {
            if (settled.problems.length > 0) fail(settled.problems);
            else checked.push({ ...o, values: check.values });
          } else checked.push({ ...o, values: settled.values });
        }
        if (o.op === 'addItem') growth.set(o.list, (growth.get(o.list) ?? 0) + 1);
      } else {
        if (!content.lists.has(o.list)) fail([{ field: '_item', kind: 'unknown', message: `There is no list called ${o.list}.` }]);
        else checked.push(o);
        if (o.op === 'removeItem') growth.set(o.list, (growth.get(o.list) ?? 0) - 1);
      }
    }
    if (problems.length === 0 && growth.size > 0) {
      const state = await store.read();
      for (const [list, change] of growth) {
        const max = content.lists.get(list)?.maxItems ?? 0;
        if ((state.lists[list]?.length ?? 0) + change > max) {
          problems.push({ index: 0, field: '_item', kind: 'too-big', message: `${list} can hold at most ${max} items.` });
        }
      }
    }
    return problems.length > 0 ? { problems } : { ops: checked };
  }

  /** Runs a text through the declaration's checks (site rules too) without saving it, so the editor can warn while someone types. */
  async function check(request: Request): Promise<Response> {
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = writeGate(request, true);
    if (gate) return gate;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      parsed = null;
    }
    if (!isRecord(parsed) || !isString(parsed.key) || !isString(parsed.text)) {
      return json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
    }
    const result = content.validateText(parsed.key, parsed.text);
    return json(200, { ok: result.ok, problems: result.problems });
  }

  async function submit(request: Request, identity: Identity): Promise<Response> {
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = writeGate(request, true);
    if (gate) return gate;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const ops = parseOps(body.text);
    if (!ops) return json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
    const checked = await checkOps(ops);
    if ('problems' in checked) return json(422, { error: 'invalid', problems: checked.problems });
    return answer(request, await store.submit({ ops: checked.ops, by: identity.email }, mode));
  }

  /** Stores an uploaded original: the image is the body, so only the Origin is checked, and the size limit is the image's own. */
  async function upload(request: Request): Promise<Response> {
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = originGate(request);
    if (gate) return gate;
    return uploads!.upload(request, new URL(request.url).searchParams, (options.now ?? (() => new Date()))());
  }

  async function rendition(request: Request): Promise<Response> {
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = writeGate(request, true);
    if (gate) return gate;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      parsed = null;
    }
    return uploads!.rendition(parsed);
  }

  /** The sizes saving an upload will ask for (the form can't work them out itself: they depend on the crop). */
  async function uploadSizes(request: Request): Promise<Response> {
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = writeGate(request, true);
    if (gate) return gate;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      parsed = null;
    }
    return uploads!.sizes(parsed);
  }

  async function uploadOriginal(request: Request): Promise<Response> {
    if (request.method !== 'GET') return wrongMethod('GET');
    return uploads!.original(new URL(request.url).searchParams);
  }

  function originGate(request: Request): Response | null {
    if (request.headers.get('origin') !== ownOrigin(request)) {
      return json(403, { error: 'cross-site', message: 'This can only be sent from the site’s own editor.' });
    }
    return null;
  }

  /** Writes need the site's own Origin; those that carry a body need JSON, too. */
  function writeGate(request: Request, hasBody: boolean): Response | null {
    const crossSite = originGate(request);
    if (crossSite) return crossSite;
    if (hasBody && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return json(415, { error: 'not-json', message: 'Send the changes as JSON.' });
    }
    return null;
  }

  async function decide(request: Request, identity: Identity, id: string, verb: string): Promise<Response> {
    const action: Action = verb === 'undo' ? undoAction : 'approve';
    if (!can(identity, action)) return forbidden();
    if (request.method !== 'POST') return wrongMethod('POST');
    const gate = writeGate(request, false);
    if (gate) return gate;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const run = verb === 'approve' ? store.approve : verb === 'reject' ? store.reject : store.undo;
    return answer(request, await run.call(store, id, identity.email));
  }

  async function editPage(request: Request, identity: Identity): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return wrongMethod('GET, HEAD');
    const query = new URL(request.url).searchParams;
    const page = query.get('page') ?? '/';
    const gone = (): Response =>
      new Response('That page can’t be edited here.', {
        status: 404,
        headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
      });
    // A query without a page ("?page/area", a missing "=") is a typo, not a request for the home page.
    if (!query.has('page') && [...query.keys()].length > 0) return gone();
    // A path on this site only: starts with one "/", and is not the admin itself.
    if (!/^\/(?!\/)[^\\\s]*$/.test(page) || isAdminPath(page.split(/[?#]/)[0] as string)) return gone();

    const asset = await site.fetchPage(page, request);
    const html = asset.ok && (asset.headers.get('content-type') ?? '').includes('text/html') ? await asset.text() : null;
    if (html === null || !html.includes('</head>') || !html.includes('</body>')) return gone();

    const state = await store.read();
    const settings = {
      editor: identity.email,
      role: identity.role,
      mode,
      capabilities: store.capabilities,
      page,
      api: '/admin/api/changes',
      check: '/admin/api/check',
      changesPage: '/admin/changes',
      uploads: uploadsSettings,
      texts: [...content.texts.values()].map(({ key, max, label }) => ({ key, max, label, current: state.texts[key] ?? null })),
      // The whole declaration and the items in order: the page opens the item form from them.
      lists: [...content.lists.values()].map((l) => ({
        name: l.name,
        label: l.label,
        singular: l.singular,
        titleField: l.titleField,
        fields: l.fields,
        sort: l.sort,
        maxItems: l.maxItems,
        items: orderItems(content, l.name, state.lists[l.name] ?? []),
      })),
    };
    // JSON in a data block: not run as script, and "<" is escaped so nothing in it can close the tag.
    const data = JSON.stringify(settings).replace(/</g, '\\u003c');
    const body = html
      .replace('</head>', '<link rel="stylesheet" href="/admin/editor.css"></head>')
      .replace(
        '</body>',
        `<script type="application/json" id="editor-settings">${data}</script><script type="module" src="/admin/editor.js"></script></body>`,
      );
    // The page's own headers (its content security policy among them) stay.
    const headers = new Headers(asset.headers);
    for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(name);
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex, nofollow');
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  }

  /** The page for one list: its items in order, drawn by list-page.js from the settings block. */
  async function listPage(request: Request, identity: Identity, name: string): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return wrongMethod('GET, HEAD');
    const list = content.lists.get(name);
    if (!list) return notFound();
    const state = await store.read();
    const settings = {
      editor: identity.email,
      role: identity.role,
      mode,
      capabilities: store.capabilities,
      api: '/admin/api/changes',
      check: '/admin/api/check',
      changesPage: '/admin/changes',
      uploads: uploadsSettings,
      list: {
        name: list.name,
        label: list.label,
        singular: list.singular,
        titleField: list.titleField,
        fields: list.fields,
        sort: list.sort,
        maxItems: list.maxItems,
      },
      items: orderItems(content, name, state.lists[name] ?? []),
    };
    const data = JSON.stringify(settings).replace(/</g, '\\u003c');
    const page =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(list.label)}</title>` +
      '<link rel="stylesheet" href="/admin/editor.css"></head><body data-editor-page="list"><main class="wd-page">' +
      `<p class="wd-page__nav"><a href="/admin/edit">back to editing</a> · <a href="/admin/changes">changes</a></p>` +
      `<h1>Edit ${escapeHtml(list.label)}</h1>` +
      `<p>${mode === 'review' ? 'What you save here waits for an admin to approve it, then it appears on the site.' : when.listPage}</p>` +
      '<div id="wd-list" class="wd-list"><noscript><p>This page needs JavaScript to edit the list.</p></noscript></div></main>' +
      `<script type="application/json" id="editor-settings">${data}</script><script type="module" src="/admin/list-page.js"></script></body></html>`;
    return new Response(request.method === 'HEAD' ? null : page, {
      status: 200,
      headers: {
        ...NO_STORE,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'",
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  /** Which sizes are missing for some of a list's items: one bounded run, which the page asks for again from `next`. */
  async function missing(request: Request): Promise<Response> {
    if (request.method !== 'GET') return wrongMethod('GET');
    const query = new URL(request.url).searchParams;
    const name = query.get('list') ?? '';
    const list = content.lists.get(name);
    if (!list || !list.fields.some((f) => f.type === 'image')) return json(404, { error: 'unknown-list', message: 'That list has no image field. Reload the page.' });
    const text = query.get('offset') ?? '0';
    const offset = Number(text);
    if (!/^\d{1,6}$/.test(text) || !Number.isSafeInteger(offset)) return json(400, { error: 'malformed', message: 'The page sent something this site did not understand. Reload the page and try again.' });
    const state = await store.read();
    return json(200, { ...(await uploads!.missing(name, orderItems(content, name, state.lists[name] ?? []), offset)) });
  }

  /** The rebuild images page: for each list with an image field, drawn by images-page.js. */
  function imagesPage(request: Request): Response {
    if (request.method !== 'GET' && request.method !== 'HEAD') return wrongMethod('GET, HEAD');
    const lists = [...content.lists.values()]
      .filter((l) => l.fields.some((f) => f.type === 'image'))
      .map((l) => ({ name: l.name, label: l.label, singular: l.singular }));
    const data = JSON.stringify({ lists, missing: '/admin/api/uploads/missing', renditions: '/admin/api/uploads/renditions' }).replace(/</g, '\\u003c');
    const page =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="robots" content="noindex, nofollow"><title>rebuild images</title>' +
      '<link rel="stylesheet" href="/admin/editor.css"></head><body data-editor-page="images"><main class="wd-page">' +
      '<p class="wd-page__nav"><a href="/admin/edit">back to editing</a> · <a href="/admin/changes">changes</a></p>' +
      '<h1>Rebuild images</h1>' +
      '<p>When a field’s widths, lightbox size or shape change, the pages ask for image sizes that were never made. This page finds them and makes them. Each size uses some of this month’s free allowance.</p>' +
      '<div id="wd-images" class="wd-images"><noscript><p>This page needs JavaScript to rebuild images.</p></noscript></div></main>' +
      `<script type="application/json" id="editor-settings">${data}</script><script type="module" src="/admin/images-page.js"></script></body></html>`;
    return new Response(request.method === 'HEAD' ? null : page, {
      status: 200,
      headers: {
        ...NO_STORE,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  async function changesPage(request: Request, identity: Identity): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return wrongMethod('GET, HEAD');
    const [waiting, live, undone] = await Promise.all([
      store.list({ state: 'waiting' }),
      store.list({ state: 'live' }),
      store.list({ state: 'undone' }),
    ]);
    const mayApprove = can(identity, 'approve');
    const mayUndo = can(identity, undoAction);
    const button = (change: Change, verb: string): string =>
      `<form method="post" action="/admin/api/changes/${encodeURIComponent(change.id)}/${verb}"><button>${verb}</button></form>`;
    const row = (change: Change, buttons: string): string =>
      `<li><p><strong>${escapeHtml(change.by)}</strong> <time datetime="${escapeHtml(change.at)}">${escapeHtml(change.at)}</time>` +
      `${change.undoes ? ` (undoes ${escapeHtml(change.undoes)})` : ''}</p><ul>` +
      change.ops.map((o) => `<li>${escapeHtml(describeOp(content, o))}</li>`).join('') +
      `</ul>${buttons}</li>`;
    const section = (title: string, changes: Change[], buttons: (c: Change) => string): string =>
      `<h2>${title}</h2>` + (changes.length === 0 ? '<p>None.</p>' : `<ul>${changes.map((c) => row(c, buttons(c))).join('')}</ul>`);
    const page =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="robots" content="noindex, nofollow"><title>changes</title></head><body><main><h1>changes</h1>' +
      `<p><a href="/admin/edit">back to editing</a> · ${mode === 'review' ? 'changes wait for an admin to approve them' : when.changes}</p>` +
      section('waiting', waiting.changes, (c) => (mayApprove ? button(c, 'approve') + button(c, 'reject') : '')) +
      section('recent', live.changes, (c) => (mayUndo ? button(c, 'undo') : '')) +
      section('undone', undone.changes, () => '') +
      '</main></body></html>';
    return new Response(request.method === 'HEAD' ? null : page, {
      status: 200,
      headers: {
        ...NO_STORE,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  /** Who is signed in, for the dock's staff hint. Only admins approve, so only they are told how many changes wait. */
  async function me(request: Request, identity: Identity): Promise<Response> {
    if (request.method !== 'GET') return wrongMethod('GET');
    let waiting = 0;
    if (can(identity, 'approve')) {
      // The count is only a hint, so a store that repeats a cursor or never ends stops the loop early.
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let pages = 0; pages < ME_MAX_PAGES; pages++) {
        const page: ChangePage = await store.list(cursor === undefined ? { state: 'waiting' } : { state: 'waiting', cursor });
        waiting += page.changes.length;
        cursor = page.next ?? undefined;
        if (cursor === undefined || seen.has(cursor)) break;
        seen.add(cursor);
      }
    }
    return json(200, { email: identity.email, role: identity.role, waiting });
  }

  function editorFile(request: Request, type: string, text: string): Response {
    if (request.method !== 'GET' && request.method !== 'HEAD') return wrongMethod('GET, HEAD');
    return new Response(request.method === 'HEAD' ? null : text, { status: 200, headers: { ...NO_STORE, 'content-type': type } });
  }

  return {
    async handle(request, env) {
      const { pathname } = new URL(request.url);
      if (!isAdminPath(pathname)) return null;
      const identity = await identify(request, env, { keys: options.keys, now: options.now?.() });
      if (!identity) return forbidden();

      if (pathname === '/admin' || pathname === '/admin/') {
        return new Response(null, { status: 302, headers: { ...NO_STORE, location: '/admin/edit' } });
      }
      if (pathname === '/admin/edit') return editPage(request, identity);
      if (pathname === '/admin/changes') return changesPage(request, identity);
      const listMatch = /^\/admin\/lists\/([^/]+)$/.exec(pathname);
      if (listMatch) return listPage(request, identity, listMatch[1] as string);
      if (uploads && pathname === '/admin/images') return can(identity, 'approve') ? imagesPage(request) : forbidden();
      if (uploads && pathname === '/admin/images-page.js') return can(identity, 'approve') ? editorFile(request, 'text/javascript; charset=utf-8', IMAGES_PAGE_JS) : forbidden();
      if (uploads && pathname === '/admin/api/uploads/missing') return can(identity, 'approve') ? missing(request) : forbidden();
      if (pathname === '/admin/item-form.js') return editorFile(request, 'text/javascript; charset=utf-8', ITEM_FORM_JS);
      if (pathname === '/admin/list-page.js') return editorFile(request, 'text/javascript; charset=utf-8', LIST_PAGE_JS);
      if (pathname === '/admin/editor.js') return editorFile(request, 'text/javascript; charset=utf-8', EDITOR_JS);
      if (pathname === '/admin/editor.css') return editorFile(request, 'text/css; charset=utf-8', EDITOR_CSS);
      if (pathname === '/admin/api/me') return me(request, identity);
      if (pathname === '/admin/api/check') return can(identity, 'edit') ? check(request) : forbidden();
      if (uploads && pathname === '/admin/api/uploads') return can(identity, 'edit') ? upload(request) : forbidden();
      if (uploads && pathname === '/admin/api/uploads/renditions') return can(identity, 'edit') ? rendition(request) : forbidden();
      if (uploads && pathname === '/admin/api/uploads/sizes') return can(identity, 'edit') ? uploadSizes(request) : forbidden();
      if (uploads && pathname === '/admin/api/uploads/original') return can(identity, 'edit') ? uploadOriginal(request) : forbidden();
      if (pathname === '/admin/api/changes') return can(identity, 'edit') ? submit(request, identity) : forbidden();
      const decision = /^\/admin\/api\/changes\/([^/]+)\/(approve|reject|undo)$/.exec(pathname);
      if (decision) {
        let id: string;
        try {
          id = decodeURIComponent(decision[1] as string);
        } catch {
          return notFound();
        }
        return decide(request, identity, id, decision[2] as string);
      }
      return notFound();
    },
  };
}
