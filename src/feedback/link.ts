// Shows and fills a "send feedback" link. Hidden until a visit with ?feedback turns
// it on for this browser (?feedback=off turns it off), so ordinary visitors never see it.
import { captureContext } from './capture.js';
import { type FeedbackOptions } from './mailto.js';
import { mailtoTransport } from './transports.js';

const KEY = 'feedback';

/** Values of `?feedback=` that turn the link off. */
const OFF_VALUES = ['off', '0', 'false', 'no'];

function feedbackEnabled(): boolean {
  const flag = new URLSearchParams(location.search).get('feedback');
  const off = flag !== null && OFF_VALUES.includes(flag.toLowerCase());
  try {
    if (off) localStorage.removeItem(KEY);
    else if (flag !== null) localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked (private mode in some browsers): show it for this page only.
  }
  if (flag !== null) return !off;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Turns `link` into the feedback link if this browser has opted in, and returns a
 * function that removes its listeners (for React effects and StrictMode).
 */
export function initFeedbackLink(link: HTMLAnchorElement, options: FeedbackOptions): () => void {
  if (!feedbackEnabled()) return () => {};

  const transport = mailtoTransport(options);
  const capture = captureContext();

  // Refresh on click, so the viewport is the one the reviewer is looking at, and each
  // email gets its own subject code.
  const update = () => {
    link.href = transport.href(capture.context());
  };

  link.addEventListener('click', update);
  update();
  // Open the mail app from this tab. A mailto: in a new tab (target="_blank") counts
  // as a pop-up in some browsers and gets blocked, so drop it from older markup too.
  link.removeAttribute('target');
  link.hidden = false;
  return () => {
    capture.stop();
    link.removeEventListener('click', update);
  };
}
