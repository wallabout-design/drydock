import { type FeedbackOptions } from '../feedback/mailto.js';
import { type SubmitTransport } from '../feedback/transports.js';
import type { DockSection } from './dock.js';
export interface FeedbackSectionOptions extends FeedbackOptions {
    /** When set, the section takes a typed note and sends it here. */
    submit?: SubmitTransport;
}
export declare function feedbackSection(options: FeedbackSectionOptions): DockSection;
