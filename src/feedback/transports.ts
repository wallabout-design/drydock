// How a feedback note leaves the page. A transport turns the captured context into
// something the link can use: today a mailto: href, later a POST to the site's Worker.
import { feedbackMailto, type FeedbackContext, type FeedbackOptions } from './mailto.js';

/** Shows the note as a link the reviewer follows (opens their mail app). */
export interface LinkTransport {
  kind: 'link';
  href(context: FeedbackContext): string;
}

export type Transport = LinkTransport;

/** Sends notes by mailto:, the way the feedback link always has. */
export function mailtoTransport(options: FeedbackOptions): LinkTransport {
  return {
    kind: 'link',
    href: (context) => feedbackMailto(context, options),
  };
}
