import type { JWTVerifyGetKey } from 'jose';
import { type AccessEnv } from './access.js';
import type { SenderStore } from './sender-store.js';
export declare const MAX_NOTE_BODY_BYTES: number;
export declare const MAX_NOTE_CHARACTERS = 5000;
export declare const MAX_NOTES_PER_HOUR = 20;
export declare const MAX_REF_LENGTH = 500;
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
export type SinkResult = {
    ok: true;
    ref: string;
} | {
    ok: false;
    message: string;
};
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
export declare const isFeedbackPath: (pathname: string) => boolean;
/** At most `limit` notes an hour for each sender, counted in this Worker's memory. */
export declare function memoryLimiter(limit?: number): NoteLimiter;
export declare function createFeedback(options: FeedbackOptions): Feedback;
