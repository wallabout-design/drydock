import { cleanLine, cleanLines, lengthOf } from '../core/clean.js';
import { accessEmail, accessServiceToken, emails } from './access.js';
export const MAX_NOTE_BODY_BYTES = 16 * 1024;
export const MAX_NOTE_CHARACTERS = 5000;
export const MAX_NOTES_PER_HOUR = 20;
export const MAX_REF_LENGTH = 500;
const HOUR_MS = 60 * 60 * 1000;
/** True for `/feedback/api` and everything under it, and nothing else. */
export const isFeedbackPath = (pathname) => pathname === '/feedback/api' || pathname.startsWith('/feedback/api/');
/** At most `limit` notes an hour for each sender, counted in this Worker's memory. */
export function memoryLimiter(limit = MAX_NOTES_PER_HOUR) {
    const sent = new Map();
    return {
        take(sender, now) {
            const t = now.getTime();
            const recent = (sent.get(sender) ?? []).filter((at) => t - at < HOUR_MS);
            if (recent.length >= limit) {
                sent.set(sender, recent);
                return false;
            }
            recent.push(t);
            sent.set(sender, recent);
            return true;
        },
    };
}
const NO_STORE = { 'cache-control': 'no-store' };
const json = (status, body) => Response.json(body, { status, headers: NO_STORE });
const forbidden = () => new Response(null, { status: 403, headers: NO_STORE });
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const cut = (text, max) => [...text].slice(0, max).join('');
const line = (v, max) => (typeof v === 'string' ? cut(cleanLine(v), max) : '');
/** The code is lowercase letters and digits, so it can't carry anything into a subject line. */
const code = (v) => (typeof v === 'string' && /^[a-z0-9]{1,8}$/.test(v) ? v : '');
function readContext(raw) {
    const c = isRecord(raw) ? raw : {};
    const path = line(c.path, 300);
    return {
        url: line(c.url, 2000),
        path: path.startsWith('/') ? path : `/${path}`,
        viewport: line(c.viewport, 30),
        dpr: typeof c.dpr === 'number' && Number.isFinite(c.dpr) ? Math.round(Math.min(Math.max(c.dpr, 0), 20) * 100) / 100 : 1,
        ua: line(c.ua, 300),
        build: line(c.build, 100),
        selection: typeof c.selection === 'string' ? cut(cleanLines(c.selection), 500) : '',
        id: code(c.id),
    };
}
export function createFeedback(options) {
    const { siteId, sink } = options;
    const senders = typeof options.senders === 'string' ? emails(options.senders) : options.senders.map((e) => e.trim().toLowerCase()).filter(Boolean);
    const { senderStore } = options;
    const routineIds = new Set((typeof options.routineClientIds === 'string' ? options.routineClientIds.split(',') : (options.routineClientIds ?? [])).map((id) => id.trim()).filter(Boolean));
    const limiter = options.limiter ?? memoryLimiter();
    const now = options.now ?? (() => new Date());
    async function readBody(request) {
        const tooLarge = json(413, { error: 'too-large', message: 'That note is too large to send.' });
        if (Number(request.headers.get('content-length') ?? 0) > MAX_NOTE_BODY_BYTES)
            return tooLarge;
        const text = await request.text();
        return new TextEncoder().encode(text).length > MAX_NOTE_BODY_BYTES ? tooLarge : text;
    }
    async function postNote(request, env) {
        // Who first: a request that is not from a listed sender learns nothing else.
        if (senders.length === 0)
            return forbidden();
        const email = await accessEmail(request, env, { keys: options.keys, now: options.now?.() });
        if (!email || !senders.includes(email))
            return forbidden();
        if (request.method !== 'POST')
            return new Response(null, { status: 405, headers: { ...NO_STORE, allow: 'POST' } });
        const origin = options.origin ?? new URL(request.url).origin;
        if (request.headers.get('origin') !== origin) {
            return json(403, { error: 'cross-site', message: 'A note can only be sent from the site’s own pages.' });
        }
        if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
            return json(415, { error: 'not-json', message: 'Send the note as JSON.' });
        }
        const text = await readBody(request);
        if (text instanceof Response)
            return text;
        let body;
        try {
            body = JSON.parse(text);
        }
        catch {
            body = null;
        }
        if (!isRecord(body) || typeof body.note !== 'string') {
            return json(400, { error: 'malformed', message: 'That note was not in a form this site understands. Reload the page and try again.' });
        }
        const note = cleanLines(body.note);
        if (note === '')
            return json(422, { error: 'empty', message: 'Write a note first.' });
        if (lengthOf(note) > MAX_NOTE_CHARACTERS) {
            return json(422, { error: 'too-long', message: `A note can be at most ${MAX_NOTE_CHARACTERS} characters.` });
        }
        if (!(await limiter.take(email, now()))) {
            return json(429, { error: 'too-many', message: `You can send at most ${MAX_NOTES_PER_HOUR} notes an hour. Try again later.` });
        }
        const context = readContext(body.context);
        const subject = `[${siteId}] ${context.path}${context.id ? ` #${context.id}` : ''}`;
        let result;
        try {
            result = await sink.send({ siteId, subject, note, context }, { email });
        }
        catch {
            result = { ok: false, message: 'The note could not be delivered.' };
        }
        if (!result.ok)
            return json(502, { error: 'not-delivered', message: result.message });
        if (senderStore) {
            // The note is already delivered: a store failure must not make the reviewer send it twice.
            // Nothing is logged, because the error could carry the address.
            try {
                await senderStore.put({ ref: result.ref, email, site: siteId });
            }
            catch {
                /* the routine will find no sender for this note */
            }
        }
        return json(200, { ok: true, ref: result.ref });
    }
    async function getSender(request, env) {
        // Who first, as for a note. A browser identity has an email and is refused here whatever its role.
        if (!senderStore || routineIds.size === 0)
            return forbidden();
        const client = await accessServiceToken(request, env, { keys: options.keys, now: options.now?.() });
        if (!client || !routineIds.has(client))
            return forbidden();
        if (request.method !== 'GET')
            return new Response(null, { status: 405, headers: { ...NO_STORE, allow: 'GET' } });
        const ref = new URL(request.url).searchParams.get('ref') ?? '';
        if (ref === '' || ref.length > MAX_REF_LENGTH)
            return new Response(null, { status: 404, headers: NO_STORE });
        let found;
        try {
            found = await senderStore.find(ref);
        }
        catch {
            return json(500, { error: 'lookup-failed' });
        }
        return found ? json(200, { email: found.email }) : new Response(null, { status: 404, headers: NO_STORE });
    }
    return {
        async handle(request, env) {
            const { pathname } = new URL(request.url);
            if (!isFeedbackPath(pathname))
                return null;
            if (pathname === '/feedback/api/notes')
                return postNote(request, env);
            if (pathname === '/feedback/api/sender')
                return getSender(request, env);
            return new Response(null, { status: 404, headers: NO_STORE });
        },
    };
}
