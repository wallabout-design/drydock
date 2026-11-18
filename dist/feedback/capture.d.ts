import { type FeedbackContext } from './mailto.js';
export interface FeedbackCapture {
    /** The page as it is now, with a fresh subject code. */
    context(): FeedbackContext;
    /** Removes the selection listener. */
    stop(): void;
}
/**
 * Starts tracking the highlighted text. Call `context()` when a note is sent, so the
 * viewport and code are the reviewer's at that moment.
 */
export declare function captureContext(): FeedbackCapture;
