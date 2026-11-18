// The dock's feedback section: today's "send feedback" mailto link, opened from the panel.
// It shows after `?feedback` and hides after `?feedback=off`, exactly as the bare link does.
import { feedbackEnabled } from '../feedback/optin.js';
import { initFeedbackLink } from '../feedback/link.js';
export function feedbackSection(options) {
    return {
        id: 'feedback',
        label: 'feedback',
        visible: () => feedbackEnabled(),
        render(el) {
            const link = el.ownerDocument.createElement('a');
            link.className = 'dock-link';
            link.textContent = 'send feedback';
            link.href = `mailto:${options.address ?? 'feedback@wallabout.design'}`;
            el.append(link);
            return initFeedbackLink(link, options);
        },
    };
}
