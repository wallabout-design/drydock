// Whether this browser has opted into feedback: `?feedback` turns it on and remembers it,
// `?feedback=off` turns it off again. Shared by the link and the dock.
const KEY = 'feedback';
/** Values of `?feedback=` that turn the link off. */
const OFF_VALUES = ['off', '0', 'false', 'no'];
/** Reads the opt-in from the address and storage, and updates storage to match. */
export function feedbackEnabled() {
    const flag = new URLSearchParams(location.search).get('feedback');
    const off = flag !== null && OFF_VALUES.includes(flag.toLowerCase());
    try {
        if (off)
            localStorage.removeItem(KEY);
        else if (flag !== null)
            localStorage.setItem(KEY, '1');
    }
    catch {
        // Storage blocked (private mode in some browsers): show it for this page only.
    }
    if (flag !== null)
        return !off;
    try {
        return localStorage.getItem(KEY) === '1';
    }
    catch {
        return false;
    }
}
