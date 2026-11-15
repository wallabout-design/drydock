import { describe, expect, it } from 'vitest';
import { fakeStore } from '../src/index.js';
import { INITIAL, storeContract } from './store-contract.js';

// The in-memory fake passes the same contract every real store must pass.
storeContract((initial) => fakeStore({ initial }));

describe('fakeStore', () => {
  it('starts empty when given no content', async () => {
    expect(await fakeStore().read()).toEqual({ texts: {}, lists: {} });
  });

  it('stamps each change with the clock it was given', async () => {
    const store = fakeStore({ initial: structuredClone(INITIAL), now: () => '2026-11-15T10:00:00.000Z' });
    const outcome = await store.submit({ ops: [{ op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' }], by: 'ana' }, 'auto');
    expect(outcome.ok && outcome.change.at).toBe('2026-11-15T10:00:00.000Z');
  });
});
