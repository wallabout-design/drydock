// The dock's feedback section. Without `submit`, it is today's "send feedback" mailto link, opened
// from the panel. With `submit` (a site's submitTransport), it is a text box that posts the note to the
// site's Worker, and falls back to the mailto link (with the typed note in it) when the reviewer is
// signed out. It shows after `?feedback` and hides after `?feedback=off`, exactly as the bare link does.
import { captureContext } from '../feedback/capture.js';
import { initFeedbackLink } from '../feedback/link.js';
import { MAX_SELECTION, type FeedbackContext, type FeedbackOptions } from '../feedback/mailto.js';
import { feedbackEnabled } from '../feedback/optin.js';
import { mailtoTransport, MAX_NOTE_LENGTH, type SubmitTransport } from '../feedback/transports.js';
import type { DockSection } from './dock.js';

export interface FeedbackSectionOptions extends FeedbackOptions {
  /** When set, the section takes a typed note and sends it here. */
  submit?: SubmitTransport;
}

/** The counter shows from this many characters, so a reviewer sees the limit coming. */
const COUNTER_FROM = 4500;

export function feedbackSection(options: FeedbackSectionOptions): DockSection {
  return {
    id: 'feedback',
    label: 'feedback',
    visible: () => feedbackEnabled(),
    render(el) {
      return options.submit ? renderSubmit(el, options, options.submit) : renderLink(el, options);
    },
  };
}

function renderLink(el: HTMLElement, options: FeedbackOptions): () => void {
  const link = el.ownerDocument.createElement('a');
  link.className = 'dock-link';
  link.textContent = 'send feedback';
  link.href = `mailto:${options.address ?? 'feedback@wallabout.design'}`;
  el.append(link);
  return initFeedbackLink(link, options);
}

function renderSubmit(el: HTMLElement, options: FeedbackOptions, submit: SubmitTransport): () => void {
  const doc = el.ownerDocument;
  const mail = mailtoTransport(options);
  const capture = captureContext();

  // The quoted selection: the last text highlighted on the page, kept while the reviewer types.
  let quote = '';
  const onSelectionChange = () => {
    const text = getSelection()?.toString().trim() ?? '';
    if (text) setQuote(text.slice(0, MAX_SELECTION));
  };
  const setQuote = (text: string) => {
    quote = text;
    quoteBox.hidden = text === '';
    quoteText.textContent = text;
  };

  const quoteBox = doc.createElement('div');
  quoteBox.className = 'dock-quote';
  quoteBox.hidden = true;
  const quoteLabel = doc.createElement('span');
  quoteLabel.textContent = 'About this text: ';
  const quoteText = doc.createElement('q');
  const dropQuote = doc.createElement('button');
  dropQuote.type = 'button';
  dropQuote.className = 'dock-button';
  dropQuote.textContent = 'Drop quote';
  dropQuote.addEventListener('click', () => setQuote(''));
  quoteBox.append(quoteLabel, quoteText, dropQuote);

  const note = doc.createElement('textarea');
  note.className = 'dock-note';
  note.rows = 4;
  note.setAttribute('aria-label', 'Your note');
  note.placeholder = 'What should change?';

  const counter = doc.createElement('p');
  counter.className = 'dock-count';
  const updateCounter = () => {
    const length = [...note.value].length;
    counter.textContent = length >= COUNTER_FROM ? `${length} / ${MAX_NOTE_LENGTH}` : '';
  };
  note.addEventListener('input', updateCounter);

  const send = doc.createElement('button');
  send.type = 'button';
  send.className = 'dock-button';
  send.textContent = 'Send';

  const status = doc.createElement('p');
  status.className = 'dock-status';
  status.setAttribute('role', 'status');

  // Shown only when the reviewer is signed out: sign in (in a new tab, so the note stays here),
  // or send the same note by email.
  const fallback = doc.createElement('div');
  fallback.className = 'dock-fallback';
  fallback.hidden = true;
  const signIn = doc.createElement('a');
  signIn.className = 'dock-link';
  signIn.textContent = 'Sign in to send';
  signIn.href = submit.endpoint;
  signIn.target = '_blank';
  signIn.rel = 'noopener';
  const byEmail = doc.createElement('a');
  byEmail.className = 'dock-link';
  byEmail.textContent = 'Send by email instead';
  fallback.append(signIn, doc.createTextNode(' · '), byEmail);

  const onSend = async () => {
    const text = note.value.trim();
    if (text === '') return setStatus('Write a note first.');
    if ([...text].length > MAX_NOTE_LENGTH) return setStatus(`A note can be at most ${MAX_NOTE_LENGTH} characters. Shorten it, then send.`);

    send.disabled = true;
    setStatus('Sending…');
    const context: FeedbackContext = { ...capture.context(), ...(quote ? { selection: quote } : {}) };
    const result = await submit.send(context, text);
    send.disabled = false;

    if (result.ok) {
      note.value = '';
      updateCounter();
      fallback.hidden = true;
      return setStatus(`Sent. Reference: ${result.ref}`);
    }
    if (result.reason === 'signed-out') {
      // The note stays in the box; the mail carries a copy, so nothing is lost.
      byEmail.href = mail.href({ ...context, note: text });
      fallback.hidden = false;
      return setStatus('You need to sign in to send notes from here. Your note is still in the box.');
    }
    setStatus(result.message);
  };
  const setStatus = (text: string) => {
    status.textContent = text;
  };
  send.addEventListener('click', onSend);
  doc.addEventListener('selectionchange', onSelectionChange);

  el.append(quoteBox, note, counter, send, status, fallback);
  return () => {
    capture.stop();
    doc.removeEventListener('selectionchange', onSelectionChange);
    send.removeEventListener('click', onSend);
    note.removeEventListener('input', updateCounter);
  };
}
