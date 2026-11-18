// A fake sink, and the contract every sink must pass (standards drydock.md,
// "feedback delivery as plugins"). A new sink's tests are
// `sinkContract(() => mySink(...))`.
import { describe, expect, it } from 'vitest';
import type { Note, Sender, Sink, SinkResult } from '../server/feedback.js';

export const SAMPLE_NOTE: Note = {
  siteId: 'rr',
  subject: '[rr] /stay #k7mq',
  note: 'The heading is too small.',
  context: {
    url: 'https://example.com/stay',
    path: '/stay',
    viewport: '390x844',
    dpr: 3,
    ua: 'TestBrowser/1.0',
    build: 'abc1234',
    selection: 'Stay with us',
    id: 'k7mq',
  },
};

export const SAMPLE_SENDER: Sender = { email: 'reviewer@example.com' };

export interface FakeSink extends Sink {
  /** Every note handed over, with its sender, in order. */
  readonly sent: { note: Note; sender: Sender }[];
}

/** Keeps notes in memory. Pass `fail` to make every send return `{ ok: false, message }`. */
export function fakeSink(options: { fail?: string } = {}): FakeSink {
  const sent: FakeSink['sent'] = [];
  return {
    sent,
    async send(note, sender): Promise<SinkResult> {
      if (options.fail !== undefined) return { ok: false, message: options.fail };
      sent.push({ note, sender });
      return { ok: true, ref: `fake-${sent.length}` };
    },
  };
}

/**
 * What every sink keeps. `makeSink` makes a fresh sink for each test.
 * It cannot check where a note ends up; a sink's own tests do that.
 */
export function sinkContract(makeSink: () => Sink | Promise<Sink>): void {
  describe('sink contract', () => {
    it('accepts a note and answers with a reference', async () => {
      const result = await (await makeSink()).send(SAMPLE_NOTE, SAMPLE_SENDER);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.ref).toEqual(expect.any(String));
    });

    it('accepts a note with no highlighted text and no code', async () => {
      const bare = { ...SAMPLE_NOTE, subject: '[rr] /stay', context: { ...SAMPLE_NOTE.context, selection: '', id: '' } };
      expect((await (await makeSink()).send(bare, SAMPLE_SENDER)).ok).toBe(true);
    });
  });
}
