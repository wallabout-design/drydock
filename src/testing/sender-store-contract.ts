// The contract every SenderStore must pass. `makeStore` makes a fresh, empty store for each test.
import { describe, expect, it } from 'vitest';
import type { SenderStore } from '../server/sender-store.js';

export function senderStoreContract(makeStore: () => SenderStore | Promise<SenderStore>): void {
  describe('sender store contract', () => {
    it('finds the sender of a note by its ref', async () => {
      const store = await makeStore();
      await store.put({ ref: 'https://github.com/o/r/issues/1', email: 'rev@example.com', site: 'rr' });
      expect(await store.find('https://github.com/o/r/issues/1')).toEqual({ email: 'rev@example.com' });
    });
    it('finds nothing for a ref it was not given', async () => {
      const store = await makeStore();
      await store.put({ ref: 'a', email: 'rev@example.com', site: 'rr' });
      expect(await store.find('b')).toBeNull();
    });
    it('keeps the latest sender when a ref is put twice', async () => {
      const store = await makeStore();
      await store.put({ ref: 'a', email: 'one@example.com', site: 'rr' });
      await store.put({ ref: 'a', email: 'two@example.com', site: 'rr' });
      expect(await store.find('a')).toEqual({ email: 'two@example.com' });
    });
    it('returns only the email, nothing else about the note', async () => {
      const store = await makeStore();
      await store.put({ ref: 'a', email: 'rev@example.com', site: 'rr' });
      expect(Object.keys((await store.find('a')) ?? {})).toEqual(['email']);
    });
  });
}

/** An in-memory store, for tests of code that takes a SenderStore. */
export function fakeSenderStore(): SenderStore & { readonly entries: Map<string, { email: string; site: string }> } {
  const entries = new Map<string, { email: string; site: string }>();
  return {
    entries,
    async put({ ref, email, site }) {
      entries.set(ref, { email, site });
    },
    async find(ref) {
      const e = entries.get(ref);
      return e ? { email: e.email } : null;
    },
  };
}
