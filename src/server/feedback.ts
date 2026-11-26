// createFeedback: the server half of sending feedback from the dock (standards
// drydock.md, "feedback delivery as plugins"). A site's Worker hands every request to
// `handle(request, env)`; it answers the paths it owns and returns null for the rest.
//
//   POST /feedback/api/notes   { note, context } hands one note to the site's sink
//   GET  /feedback/api/sender?ref=<ref>   the address of the note's sender, for the routine
//
// The sender lookup exists only with a `senderStore`. It answers only an Access service
// token whose client id is in `routineClientIds`, never a person's browser sign-in.
//
// Who may send: a signed-in Cloudflare Access user (emailed PIN) whose email is in the
// site's `feedback_senders`. The token is checked here, as access.ts does for editors.
// With a needed setting missing (team domain, audience tag, or no senders) everyone is
// refused, and a refusal says nothing: a 403 with an empty body.
import type { JWTVerifyGetKey } from 'jose';
import { cleanLine, cleanLines, lengthOf } from '../core/clean.js';
import { accessEmail, accessServiceToken, emails, type AccessEnv } from './access.js';
import type { SenderStore } from './sender-store.js';

export const MAX_NOTE_BODY_BYTES = 16 * 1024;
export const MAX_NOTE_CHARACTERS = 5000;
export const MAX_NOTES_PER_HOUR = 20;
export const MAX_REF_LENGTH = 500;
const HOUR_MS = 60 * 60 * 1000;

/** What the sink is told about the page. Every field is plain text and cut to a fixed length. */
export interface NoteContext {
  url: string;
  path: string;
  viewport: string;
  dpr: number;
  ua: string;
  build: string;
  /** Text the sender had highlighted, if any. */
  selection: string;
  /** The short code that keeps each note apart, such as `k7mq`; empty when the page sent none. */
  id: string;
}

export interface Note {
  /** The site's short ID, such as `rr`. */
  siteId: string;
  /** `[<site id>] <path> #<code>`: the tag the feedback routine matches notes to sites with. A sink keeps it (as the email subject, or the issue title). */
  subject: string;
  /** What the sender wrote, as plain text with line breaks. */
  note: string;
  context: NoteContext;
}

/** Who sent it. A sink may reply to this address, but must not publish it. */
export interface Sender {
  email: string;
}

export type SinkResult = { ok: true; ref: string } | { ok: false; message: string };

/** Where a submitted note goes. A plain object a site passes in; it passes `sinkContract` from `@wallabout-design/drydock/testing`. */
export interface Sink {
  send(note: Note, sender: Sender): Promise<SinkResult>;
}

/** Counts notes per sender. The built-in one lives in one Worker's memory; a site that needs a shared count passes its own. */
export interface NoteLimiter {
  /** Records a note by `sender` at `now` and returns true, or returns false (recording nothing) when they are over the limit. */
  take(sender: string, now: Date): boolean | Promise<boolean>;
}

export interface FeedbackOptions {
  /** Short site ID for the subject tag, such as `wallabout` or `rr`. */
  siteId: string;
  sink: Sink;
  /** Who may send: the site's `feedback_senders`, as a list or as emails separated by commas. */
  senders: readonly string[] | string;
  /** The site's own origin, when the Worker can't tell it from the request address. */
  origin?: string;
  limiter?: NoteLimiter;
  /** Keeps each delivered note's sender, for the lookup below. Without one, nothing is kept and the lookup answers 404 to everyone. */
  senderStore?: SenderStore;
  /** The Access service tokens' client ids that may look a sender up (the routine's), as a list or separated by commas. With none, the lookup refuses everyone. */
  routineClientIds?: readonly string[] | string;
  /** For tests: the keys an Access token is checked against, and the time it is checked at. */
  keys?: JWTVerifyGetKey;
  now?: () => Date;
}

export interface Feedback {
  /** The response for a path feedback owns, or null for any other path. */
  handle(request: Request, env: AccessEnv): Promise<Response | null>;
}

/** True for `/feedback/api` and everything under it, and nothing else. */
export const isFeedbackPath = (pathname: string): boolean => pathname === '/feedback/api' || pathname.startsWith('/feedback/api/');

/** At most `limit` notes an hour for each sender, counted in this Worker's memory. */
export function memoryLimiter(limit: number = MAX_NOTES_PER_HOUR): NoteLimiter {
  const sent = new Map<string, number[]>();
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
const json = (status: number, body: Record<string, unknown>): Response => Response.json(body, { status, headers: NO_STORE });
const forbidden = (): Response => new Response(null, { status: 403, headers: NO_STORE });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const cut = (text: string, max: number): string => [...text].slice(0, max).join('');
const line = (v: unknown, max: number): string => (typeof v === 'string' ? cut(cleanLine(v), max) : '');
/** The code is lowercase letters and digits, so it can't carry anything into a subject line. */
const code = (v: unknown): string => (typeof v === 'string' && /^[a-z0-9]{1,8}$/.test(v) ? v : '');

function readContext(raw: unknown): NoteContext {
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

export function createFeedback(options: FeedbackOptions): Feedback {
  const { siteId, sink } = options;
  const senders = typeof options.senders === 'string' ? emails(options.senders) : options.senders.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const { senderStore } = options;
  const routineIds = new Set(
    (typeof options.routineClientIds === 'string' ? options.routineClientIds.split(',') : (options.routineClientIds ?? [])).map((id) => id.trim()).filter(Boolean),
  );
  const limiter = options.limiter ?? memoryLimiter();
  const now = options.now ?? (() => new Date());

  async function readBody(request: Request): Promise<string | Response> {
    const tooLarge = json(413, { error: 'too-large', message: 'That note is too large to send.' });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_NOTE_BODY_BYTES) return tooLarge;
    const text = await request.text();
    return new TextEncoder().encode(text).length > MAX_NOTE_BODY_BYTES ? tooLarge : text;
  }

  async function postNote(request: Request, env: AccessEnv): Promise<Response> {
    // Who first: a request that is not from a listed sender learns nothing else.
    if (senders.length === 0) return forbidden();
    const email = await accessEmail(request, env, { keys: options.keys, now: options.now?.() });
    if (!email || !senders.includes(email)) return forbidden();

    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...NO_STORE, allow: 'POST' } });
    const origin = options.origin ?? new URL(request.url).origin;
    if (request.headers.get('origin') !== origin) {
      return json(403, { error: 'cross-site', message: 'A note can only be sent from the site’s own pages.' });
    }
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return json(415, { error: 'not-json', message: 'Send the note as JSON.' });
    }
    const text = await readBody(request);
    if (text instanceof Response) return text;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!isRecord(body) || typeof body.note !== 'string') {
      return json(400, { error: 'malformed', message: 'That note was not in a form this site understands. Reload the page and try again.' });
    }
    const note = cleanLines(body.note);
    if (note === '') return json(422, { error: 'empty', message: 'Write a note first.' });
    if (lengthOf(note) > MAX_NOTE_CHARACTERS) {
      return json(422, { error: 'too-long', message: `A note can be at most ${MAX_NOTE_CHARACTERS} characters.` });
    }
    if (!(await limiter.take(email, now()))) {
      return json(429, { error: 'too-many', message: `You can send at most ${MAX_NOTES_PER_HOUR} notes an hour. Try again later.` });
    }

    const context = readContext(body.context);
    const subject = `[${siteId}] ${context.path}${context.id ? ` #${context.id}` : ''}`;
    let result: SinkResult;
    try {
      result = await sink.send({ siteId, subject, note, context }, { email });
    } catch {
      result = { ok: false, message: 'The note could not be delivered.' };
    }
    if (!result.ok) return json(502, { error: 'not-delivered', message: result.message });
    if (senderStore) {
      // The note is already delivered: a store failure must not make the reviewer send it twice.
      // Nothing is logged, because the error could carry the address.
      try {
        await senderStore.put({ ref: result.ref, email, site: siteId });
      } catch {
        /* the routine will find no sender for this note */
      }
    }
    return json(200, { ok: true, ref: result.ref });
  }

  async function getSender(request: Request, env: AccessEnv): Promise<Response> {
    // Who first, as for a note. A browser identity has an email and is refused here whatever its role.
    if (!senderStore || routineIds.size === 0) return forbidden();
    const client = await accessServiceToken(request, env, { keys: options.keys, now: options.now?.() });
    if (!client || !routineIds.has(client)) return forbidden();
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...NO_STORE, allow: 'GET' } });
    const ref = new URL(request.url).searchParams.get('ref') ?? '';
    if (ref === '' || ref.length > MAX_REF_LENGTH) return new Response(null, { status: 404, headers: NO_STORE });
    let found: { email: string } | null;
    try {
      found = await senderStore.find(ref);
    } catch {
      return json(500, { error: 'lookup-failed' });
    }
    return found ? json(200, { email: found.email }) : new Response(null, { status: 404, headers: NO_STORE });
  }

  return {
    async handle(request, env) {
      const { pathname } = new URL(request.url);
      if (!isFeedbackPath(pathname)) return null;
      if (pathname === '/feedback/api/notes') return postNote(request, env);
      if (pathname === '/feedback/api/sender') return getSender(request, env);
      return new Response(null, { status: 404, headers: NO_STORE });
    },
  };
}
