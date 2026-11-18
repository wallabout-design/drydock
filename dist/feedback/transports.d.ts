import { type FeedbackContext, type FeedbackOptions } from './mailto.js';
/** Shows the note as a link the reviewer follows (opens their mail app). */
export interface LinkTransport {
    kind: 'link';
    href(context: FeedbackContext): string;
}
export type Transport = LinkTransport;
/** Sends notes by mailto:, the way the feedback link always has. */
export declare function mailtoTransport(options: FeedbackOptions): LinkTransport;
