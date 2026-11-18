// Gathers what a feedback note says about the page: the URL, the viewport, the build and
// the text the reviewer highlighted. Knows nothing about how the note is sent (see transports.ts).
import { feedbackId } from './mailto.js';
/** Text deselected this recently still counts as highlighted. */
const SELECTION_GRACE_MS = 3000;
/**
 * Starts tracking the highlighted text. Call `context()` when a note is sent, so the
 * viewport and code are the reviewer's at that moment.
 */
export function captureContext() {
    // Remember the last highlighted text. Tapping the link can clear the selection
    // first (phones especially), so text deselected in the last few seconds counts.
    let selected = '';
    let clearedAt = 0;
    const onSelectionChange = () => {
        const text = getSelection()?.toString().trim() ?? '';
        if (text) {
            selected = text;
            clearedAt = 0;
        }
        else if (selected && !clearedAt) {
            clearedAt = Date.now();
        }
    };
    const currentSelection = () => (clearedAt && Date.now() - clearedAt > SELECTION_GRACE_MS ? '' : selected);
    document.addEventListener('selectionchange', onSelectionChange);
    return {
        context: () => ({
            url: location.href,
            path: location.pathname,
            viewport: `${innerWidth}x${innerHeight}`,
            dpr: devicePixelRatio,
            ua: navigator.userAgent,
            build: document.querySelector('meta[name="build"]')?.content ?? '',
            selection: currentSelection(),
            id: feedbackId(),
        }),
        stop: () => document.removeEventListener('selectionchange', onSelectionChange),
    };
}
