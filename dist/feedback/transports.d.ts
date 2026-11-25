import { type FeedbackContext, type FeedbackOptions } from './mailto.js';
/** Shows the note as a link the reviewer follows (opens their mail app). */
export interface LinkTransport {
    kind: 'link';
    href(context: FeedbackContext): string;
}
/** The longest note a reviewer can send. Matches the server's MAX_NOTE_CHARACTERS (server/feedback.ts). */
export declare const MAX_NOTE_LENGTH = 5000;
/** Where the note is posted when a site doesn't say. Matches the route `createFeedback` owns. */
export declare const FEEDBACK_NOTES_PATH = "/feedback/api/notes";
export interface SubmitOptions {
    /** Where the note is posted. Defaults to `/feedback/api/notes`, the site's own Worker. */
    endpoint?: string;
}
/** What a submit came back with. `signed-out` means the reviewer should sign in or use the mailto. */
export type SubmitResult = {
    ok: true;
    ref: string;
} | {
    ok: false;
    reason: 'signed-out';
} | {
    ok: false;
    reason: 'refused' | 'failed';
    message: string;
};
/** Sends the note to the site's Worker, which hands it to the site's sink. */
export interface SubmitTransport {
    kind: 'submit';
    /** Where the note is posted, and the address a reviewer signs in at (the same route is behind Access). */
    endpoint: string;
    send(context: FeedbackContext, note: string): Promise<SubmitResult>;
}
export type Transport = LinkTransport | SubmitTransport;
/** Sends notes by mailto:, the way the feedback link always has. */
export declare function mailtoTransport(options: FeedbackOptions): LinkTransport;
/**
 * Sends notes by POST to the site's Worker. The same origin, so the CSP needs no new host.
 * A signed-out reviewer gets `signed-out` back (Access answers with a redirect, or a 403),
 * and the caller falls back to `mailtoTransport`, so the note is never lost.
 */
export declare function submitTransport({ endpoint }?: SubmitOptions): SubmitTransport;
