// How a feedback note leaves the page. A transport turns the captured context into
// something the link can use: today a mailto: href, later a POST to the site's Worker.
import { feedbackMailto } from './mailto.js';
/** Sends notes by mailto:, the way the feedback link always has. */
export function mailtoTransport(options) {
    return {
        kind: 'link',
        href: (context) => feedbackMailto(context, options),
    };
}
