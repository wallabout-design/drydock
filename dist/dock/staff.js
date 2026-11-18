// staffStatus: the dock's staff hint (standards/drydock.md, "the dock"). A public page asks
// /admin/api/me who is signed in only when this browser carries the hint, which the edit view
// sets (src/editor/editor.js). A visitor's browser has no hint, so its page makes no request.
// Imports nothing, so a page that only asks bundles only this file.
/** The localStorage key the edit view sets to "1". */
export const STAFF_HINT_KEY = 'drydock-staff';
const isStatus = (v) => {
    if (typeof v !== 'object' || v === null)
        return false;
    const s = v;
    return (typeof s.email === 'string' &&
        (s.role === 'editor' || s.role === 'admin') &&
        typeof s.waiting === 'number' &&
        Number.isInteger(s.waiting) &&
        s.waiting >= 0);
};
/** Who is signed in to this site, or null: no hint, signed out, or anything that goes wrong. Never throws. */
export async function staffStatus(options = {}) {
    let hinted;
    try {
        hinted = (options.storage ?? globalThis.localStorage).getItem(STAFF_HINT_KEY) === '1';
    }
    catch {
        return null;
    }
    if (!hinted)
        return null;
    try {
        const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        // A signed-out request gets a 403; a sign-in redirect from Access must not be followed.
        const response = await doFetch('/admin/api/me', { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' });
        if (response.type === 'opaqueredirect' || !response.ok)
            return null;
        const body = await response.json();
        return isStatus(body) ? body : null;
    }
    catch {
        return null;
    }
}
