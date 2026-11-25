export { FEEDBACK_ADDRESS, MAX_SELECTION, feedbackId, feedbackMailto, roundDpr } from './mailto.js';
export type { FeedbackContext, FeedbackOptions } from './mailto.js';
export { captureContext } from './capture.js';
export type { FeedbackCapture } from './capture.js';
export { mailtoTransport, submitTransport, MAX_NOTE_LENGTH, FEEDBACK_NOTES_PATH } from './transports.js';
export type { LinkTransport, SubmitTransport, SubmitOptions, SubmitResult, Transport } from './transports.js';
export { initFeedbackLink } from './link.js';
export { feedbackEnabled } from './optin.js';
