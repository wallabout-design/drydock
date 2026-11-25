// Unit tests for the transports (no browser): the mailto transport returns the mailto: builder's output.
import { afterEach, describe, expect, it, test } from 'vitest';
import { feedbackMailto, mailtoTransport, MAX_NOTE_LENGTH, submitTransport, type FeedbackContext } from '../src/feedback/index.js';

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

describe('submitTransport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answer = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return fn(url, init);
    }) as typeof fetch;
    return calls;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('is a submit transport on /feedback/api/notes by default', () => {
    const t = submitTransport();
    expect(t.kind).toBe('submit');
    expect(t.endpoint).toBe('/feedback/api/notes');
    expect(submitTransport({ endpoint: '/x' }).endpoint).toBe('/x');
  });

  it('posts the trimmed note and the context as JSON, and returns the reference', async () => {
    const calls = answer(() => json({ ok: true, ref: 'note-1' }));
    const result = await submitTransport().send(context, '  the bridge is loose  ');
    expect(result).toEqual({ ok: true, ref: 'note-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/feedback/api/notes');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ note: 'the bridge is loose', context });
  });

  it('reports signed-out for a 403, an opaque redirect (Access sign-in) or a 401', async () => {
    for (const reply of [() => new Response(null, { status: 403 }), () => new Response(null, { status: 401 }), () => ({ type: 'opaqueredirect', ok: false, status: 0 }) as unknown as Response]) {
      answer(reply);
      expect(await submitTransport().send(context, 'a note')).toEqual({ ok: false, reason: 'signed-out' });
    }
  });

  it('shows the server’s message when it refuses the note, and no message is needed for a failure', async () => {
    answer(() => json({ error: 'too-long', message: 'A note can be at most 5000 characters.' }, 422));
    expect(await submitTransport().send(context, 'a note')).toEqual({ ok: false, reason: 'refused', message: 'A note can be at most 5000 characters.' });
    answer(() => json({ error: 'boom' }, 502));
    expect(await submitTransport().send(context, 'a note')).toEqual({ ok: false, reason: 'failed', message: 'The note could not be sent. Try again, or send it by email.' });
  });

  it('reports a network failure without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const result = await submitTransport().send(context, 'a note');
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('refuses an empty or over-long note without sending it', async () => {
    const calls = answer(() => json({ ok: true, ref: 'x' }));
    expect(await submitTransport().send(context, '   ')).toMatchObject({ ok: false, reason: 'refused' });
    expect(await submitTransport().send(context, 'x'.repeat(MAX_NOTE_LENGTH + 1))).toMatchObject({ ok: false, reason: 'refused' });
    expect(await submitTransport().send(context, 'x'.repeat(MAX_NOTE_LENGTH))).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('puts the typed note in the mailto body, so a fallback mail carries it', () => {
    const href = mailtoTransport({ siteId: 'rr' }).href({ ...context, note: 'the bridge is loose\nsecond line' });
    const body = new URL(href).searchParams.get('body') ?? '';
    expect(body).toContain('the bridge is loose\r\nsecond line');
    expect(body).toContain('--- page details, please leave ---');
  });
});
