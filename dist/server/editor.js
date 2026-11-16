import { can, identify } from './access.js';
import { orderItems } from '../core/read.js';
import { EDITOR_CSS, EDITOR_JS, ITEM_FORM_JS, LIST_PAGE_JS } from './editor-assets.js';
export const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { 'cache-control': 'no-store' };
const json = (status, body) => Response.json(body, { status, headers: NO_STORE });
/** Nothing at all in the body: what a signed-out request, or a role without the right, gets. */
const forbidden = () => new Response(null, { status: 403, headers: NO_STORE });
const notFound = () => new Response(null, { status: 404, headers: NO_STORE });
const wrongMethod = (allow) => new Response(null, { status: 405, headers: { ...NO_STORE, allow } });
/** True for `/admin` and everything under it, and nothing else (not `/administrator`). */
export const isAdminPath = (pathname) => pathname === '/admin' || pathname.startsWith('/admin/');
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isNullableString = (v) => v === null || typeof v === 'string';
/** The operations in a request body, or null when it is not `{ ops: Operation[] }` of the right shapes. */
export function parseOps(text) {
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        return null;
    }
    const ops = isRecord(body) ? body.ops : undefined;
    if (!Array.isArray(ops) || ops.length === 0)
        return null;
    const out = [];
    for (const o of ops) {
        if (!isRecord(o))
            return null;
        if (o.op === 'setText' && isString(o.key) && isString(o.text) && isString(o.seen)) {
            out.push({ op: 'setText', key: o.key, text: o.text, seen: o.seen });
        }
        else if (o.op === 'addItem' && isString(o.list) && isString(o.id) && isRecord(o.values) && isNullableString(o.after)) {
            out.push({ op: 'addItem', list: o.list, id: o.id, values: o.values, after: o.after });
        }
        else if (o.op === 'editItem' && isString(o.list) && isString(o.id) && isRecord(o.values) && isRecord(o.seen)) {
            out.push({ op: 'editItem', list: o.list, id: o.id, values: o.values, seen: o.seen });
        }
        else if (o.op === 'removeItem' && isString(o.list) && isString(o.id) && isRecord(o.seen)) {
            out.push({ op: 'removeItem', list: o.list, id: o.id, seen: o.seen });
        }
        else if (o.op === 'moveItem' && isString(o.list) && isString(o.id) && isNullableString(o.after) && isNullableString(o.seen)) {
            out.push({ op: 'moveItem', list: o.list, id: o.id, after: o.after, seen: o.seen });
        }
        else {
            return null;
        }
    }
    return out;
}
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const SHORT = 120;
const short = (s) => (s.length > SHORT ? `${s.slice(0, SHORT)}…` : s);
function describeOp(content, o) {
    if (o.op === 'setText')
        return `${o.key}: "${short(o.seen)}" to "${short(o.text)}"`;
    const list = content.lists.get(o.list);
    const title = (values) => {
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
export function createEditor(options) {
    const { content, store, mode, site } = options;
    const ownOrigin = (request) => site.origin ?? new URL(request.url).origin;
    /** Who may undo: anyone who may edit when changes go live on their own, only admins when an admin reviews them. */
    const undoAction = mode === 'auto' ? 'edit' : 'approve';
    async function readBody(request) {
        if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
            return json(413, { error: 'too-large', message: 'That is too much at once.' });
        }
        const text = await request.text();
        if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
            return json(413, { error: 'too-large', message: 'That is too much at once.' });
        }
        return { text };
    }
    const fromRefusal = (refusal) => {
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
    function answer(request, outcome) {
        if (!outcome.ok)
            return fromRefusal(outcome.refusal);
        if ((request.headers.get('accept') ?? '').includes('text/html')) {
            return new Response(null, { status: 303, headers: { ...NO_STORE, location: '/admin/changes' } });
        }
        return json(200, { change: outcome.change });
    }
    /** Checks every operation against the declaration. Returns the operations with texts and items cleaned, or the problems. */
    async function checkOps(ops) {
        const problems = [];
        const checked = [];
        const growth = new Map();
        for (const [index, o] of ops.entries()) {
            const fail = (found) => problems.push(...found.map((p) => ({ ...p, index })));
            if (o.op === 'setText') {
                const check = content.validateText(o.key, o.text);
                if (check.ok)
                    checked.push({ ...o, text: check.text });
                else
                    fail(check.problems);
            }
            else if (o.op === 'addItem' || o.op === 'editItem') {
                const check = content.validateItem(o.list, o.values);
                if (check.ok)
                    checked.push({ ...o, values: check.values });
                else
                    fail(check.problems);
                if (o.op === 'addItem')
                    growth.set(o.list, (growth.get(o.list) ?? 0) + 1);
            }
            else {
                if (!content.lists.has(o.list))
                    fail([{ field: '_item', kind: 'unknown', message: `There is no list called ${o.list}.` }]);
                else
                    checked.push(o);
                if (o.op === 'removeItem')
                    growth.set(o.list, (growth.get(o.list) ?? 0) - 1);
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
    async function check(request) {
        if (request.method !== 'POST')
            return wrongMethod('POST');
        const gate = writeGate(request, true);
        if (gate)
            return gate;
        const body = await readBody(request);
        if (body instanceof Response)
            return body;
        let parsed;
        try {
            parsed = JSON.parse(body.text);
        }
        catch {
            parsed = null;
        }
        if (!isRecord(parsed) || !isString(parsed.key) || !isString(parsed.text)) {
            return json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
        }
        const result = content.validateText(parsed.key, parsed.text);
        return json(200, { ok: result.ok, problems: result.problems });
    }
    async function submit(request, identity) {
        if (request.method !== 'POST')
            return wrongMethod('POST');
        const gate = writeGate(request, true);
        if (gate)
            return gate;
        const body = await readBody(request);
        if (body instanceof Response)
            return body;
        const ops = parseOps(body.text);
        if (!ops)
            return json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
        const checked = await checkOps(ops);
        if ('problems' in checked)
            return json(422, { error: 'invalid', problems: checked.problems });
        return answer(request, await store.submit({ ops: checked.ops, by: identity.email }, mode));
    }
    /** Writes need the site's own Origin; those that carry a body need JSON, too. */
    function writeGate(request, hasBody) {
        if (request.headers.get('origin') !== ownOrigin(request)) {
            return json(403, { error: 'cross-site', message: 'This can only be sent from the site’s own editor.' });
        }
        if (hasBody && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
            return json(415, { error: 'not-json', message: 'Send the changes as JSON.' });
        }
        return null;
    }
    async function decide(request, identity, id, verb) {
        const action = verb === 'undo' ? undoAction : 'approve';
        if (!can(identity, action))
            return forbidden();
        if (request.method !== 'POST')
            return wrongMethod('POST');
        const gate = writeGate(request, false);
        if (gate)
            return gate;
        const body = await readBody(request);
        if (body instanceof Response)
            return body;
        const run = verb === 'approve' ? store.approve : verb === 'reject' ? store.reject : store.undo;
        return answer(request, await run.call(store, id, identity.email));
    }
    async function editPage(request, identity) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return wrongMethod('GET, HEAD');
        const page = new URL(request.url).searchParams.get('page') ?? '/';
        const gone = () => new Response('That page can’t be edited here.', {
            status: 404,
            headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
        });
        // A path on this site only: starts with one "/", and is not the admin itself.
        if (!/^\/(?!\/)[^\\\s]*$/.test(page) || isAdminPath(page.split(/[?#]/)[0]))
            return gone();
        const asset = await site.fetchPage(page, request);
        const html = asset.ok && (asset.headers.get('content-type') ?? '').includes('text/html') ? await asset.text() : null;
        if (html === null || !html.includes('</head>') || !html.includes('</body>'))
            return gone();
        const state = await store.read();
        const settings = {
            editor: identity.email,
            role: identity.role,
            mode,
            page,
            api: '/admin/api/changes',
            check: '/admin/api/check',
            changesPage: '/admin/changes',
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
            .replace('</body>', `<script type="application/json" id="editor-settings">${data}</script><script type="module" src="/admin/editor.js"></script></body>`);
        // The page's own headers (its content security policy among them) stay.
        const headers = new Headers(asset.headers);
        for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified'])
            headers.delete(name);
        headers.set('cache-control', 'no-store');
        headers.set('x-robots-tag', 'noindex, nofollow');
        return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
    }
    /** The page for one list: its items in order, drawn by list-page.js from the settings block. */
    async function listPage(request, identity, name) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return wrongMethod('GET, HEAD');
        const list = content.lists.get(name);
        if (!list)
            return notFound();
        const state = await store.read();
        const settings = {
            editor: identity.email,
            role: identity.role,
            mode,
            api: '/admin/api/changes',
            check: '/admin/api/check',
            changesPage: '/admin/changes',
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
        const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            `<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(list.label)}</title>` +
            '<link rel="stylesheet" href="/admin/editor.css"></head><body data-editor-page="list"><main class="wd-page">' +
            `<p class="wd-page__nav"><a href="/admin/edit">back to editing</a> · <a href="/admin/changes">changes</a></p>` +
            `<h1>Edit ${escapeHtml(list.label)}</h1>` +
            `<p>${mode === 'review' ? 'What you save here waits for an admin to approve it, then it appears on the site.' : 'What you save here is on the site straight away.'}</p>` +
            '<div id="wd-list" class="wd-list"><noscript><p>This page needs JavaScript to edit the list.</p></noscript></div></main>' +
            `<script type="application/json" id="editor-settings">${data}</script><script type="module" src="/admin/list-page.js"></script></body></html>`;
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
    async function changesPage(request, identity) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return wrongMethod('GET, HEAD');
        const [waiting, live, undone] = await Promise.all([
            store.list({ state: 'waiting' }),
            store.list({ state: 'live' }),
            store.list({ state: 'undone' }),
        ]);
        const mayApprove = can(identity, 'approve');
        const mayUndo = can(identity, undoAction);
        const button = (change, verb) => `<form method="post" action="/admin/api/changes/${encodeURIComponent(change.id)}/${verb}"><button>${verb}</button></form>`;
        const row = (change, buttons) => `<li><p><strong>${escapeHtml(change.by)}</strong> <time datetime="${escapeHtml(change.at)}">${escapeHtml(change.at)}</time>` +
            `${change.undoes ? ` (undoes ${escapeHtml(change.undoes)})` : ''}</p><ul>` +
            change.ops.map((o) => `<li>${escapeHtml(describeOp(content, o))}</li>`).join('') +
            `</ul>${buttons}</li>`;
        const section = (title, changes, buttons) => `<h2>${title}</h2>` + (changes.length === 0 ? '<p>None.</p>' : `<ul>${changes.map((c) => row(c, buttons(c))).join('')}</ul>`);
        const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="robots" content="noindex, nofollow"><title>changes</title></head><body><main><h1>changes</h1>' +
            `<p><a href="/admin/edit">back to editing</a> · ${mode === 'review' ? 'changes wait for an admin to approve them' : 'changes go live on their own'}</p>` +
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
    function editorFile(request, type, text) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return wrongMethod('GET, HEAD');
        return new Response(request.method === 'HEAD' ? null : text, { status: 200, headers: { ...NO_STORE, 'content-type': type } });
    }
    return {
        async handle(request, env) {
            const { pathname } = new URL(request.url);
            if (!isAdminPath(pathname))
                return null;
            const identity = await identify(request, env, { keys: options.keys, now: options.now?.() });
            if (!identity)
                return forbidden();
            if (pathname === '/admin' || pathname === '/admin/') {
                return new Response(null, { status: 302, headers: { ...NO_STORE, location: '/admin/edit' } });
            }
            if (pathname === '/admin/edit')
                return editPage(request, identity);
            if (pathname === '/admin/changes')
                return changesPage(request, identity);
            const listMatch = /^\/admin\/lists\/([^/]+)$/.exec(pathname);
            if (listMatch)
                return listPage(request, identity, listMatch[1]);
            if (pathname === '/admin/item-form.js')
                return editorFile(request, 'text/javascript; charset=utf-8', ITEM_FORM_JS);
            if (pathname === '/admin/list-page.js')
                return editorFile(request, 'text/javascript; charset=utf-8', LIST_PAGE_JS);
            if (pathname === '/admin/editor.js')
                return editorFile(request, 'text/javascript; charset=utf-8', EDITOR_JS);
            if (pathname === '/admin/editor.css')
                return editorFile(request, 'text/css; charset=utf-8', EDITOR_CSS);
            if (pathname === '/admin/api/check')
                return can(identity, 'edit') ? check(request) : forbidden();
            if (pathname === '/admin/api/changes')
                return can(identity, 'edit') ? submit(request, identity) : forbidden();
            const decision = /^\/admin\/api\/changes\/([^/]+)\/(approve|reject|undo)$/.exec(pathname);
            if (decision) {
                let id;
                try {
                    id = decodeURIComponent(decision[1]);
                }
                catch {
                    return notFound();
                }
                return decide(request, identity, id, decision[2]);
            }
            return notFound();
        },
    };
}
