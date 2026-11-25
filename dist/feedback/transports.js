// How a feedback note leaves the page. A transport turns the captured context into
// something the link can use: today a mailto: href, and a POST of the note to the
// site's own Worker (`submitTransport`).
import { feedbackMailto } from './mailto.js';
/** The longest note a reviewer can send. Matches the server's MAX_NOTE_CHARACTERS (server/feedback.ts). */
export const MAX_NOTE_LENGTH = 5000;
/** Where the note is posted when a site doesn't say. Matches the route `createFeedback` owns. */
export const FEEDBACK_NOTES_PATH = '/feedback/api/notes';
/** Sends notes by mailto:, the way the feedback link always has. */
export function mailtoTransport(options) {
    return {
        kind: 'link',
        href: (context) => feedbackMailto(context, options),
    };
}
/**
 * Sends notes by POST to the site's Worker. The same origin, so the CSP needs no new host.
 * A signed-out reviewer gets `signed-out` back (Access answers with a redirect, or a 403),
 * and the caller falls back to `mailtoTransport`, so the note is never lost.
 */
export function submitTransport({ endpoint = FEEDBACK_NOTES_PATH } = {}) {
    return {
        kind: 'submit',
        endpoint,
        async send(context, note) {
            const text = note.trim();
            if (text === '')
                return { ok: false, reason: 'refused', message: 'Write a note first.' };
            if ([...text].length > MAX_NOTE_LENGTH) {
                return { ok: false, reason: 'refused', message: `A note can be at most ${MAX_NOTE_LENGTH} characters.` };
            }
            let response;
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ note: text, context }),
                    credentials: 'same-origin',
                    // A sign-in redirect from Access must not be followed: it comes back as opaqueredirect.
                    redirect: 'manual',
                    cache: 'no-store',
                });
            }
            catch {
                return { ok: false, reason: 'failed', message: 'The note could not be sent. Check the connection and try again.' };
            }
            if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403)
                return { ok: false, reason: 'signed-out' };
            const body = await response.json().catch(() => null);
            const record = typeof body === 'object' && body !== null ? body : {};
            if (response.ok && record.ok === true && typeof record.ref === 'string')
                return { ok: true, ref: record.ref };
            const message = typeof record.message === 'string' ? record.message : 'The note could not be sent. Try again, or send it by email.';
            const refused = response.status >= 400 && response.status < 500 && response.status !== 429;
            return { ok: false, reason: refused ? 'refused' : 'failed', message };
        },
    };
}
