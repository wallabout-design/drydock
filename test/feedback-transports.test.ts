// Unit tests for the transports (no browser): the mailto transport returns the mailto: builder's output.
import { test, expect } from 'vitest';
import { feedbackMailto, mailtoTransport, type FeedbackContext } from '../src/feedback/index.js';

const context: FeedbackContext = {
  url: 'https://example.com/stay?x=1',
  path: '/stay',
  viewport: '390x844',
  dpr: 3,
  ua: 'TestBrowser/1.0',
  build: 'abc1234',
  selection: 'a line of text',
  id: 'k7mq',
};

test('mailtoTransport is a link transport', () => {
  expect(mailtoTransport({ siteId: 'rr' }).kind).toBe('link');
});

test('its href is exactly what feedbackMailto builds for the same options', () => {
  const options = { siteId: 'rr', address: 'notes@example.com' };
  expect(mailtoTransport(options).href(context)).toBe(feedbackMailto(context, options));
});

test('the default address and subject tag come from the options it was given', () => {
  const href = mailtoTransport({ siteId: 'rr' }).href(context);
  const mail = new URL(href);
  expect(mail.pathname).toBe('feedback@wallabout.design');
  expect(mail.searchParams.get('subject')).toBe('[rr] /stay #k7mq');
});
