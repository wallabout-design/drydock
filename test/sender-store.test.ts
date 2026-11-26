import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { d1SenderStore, SENDER_RETENTION_DAYS } from '../src/stores/d1/index.js';
import { senderStoreContract } from '../src/testing/index.js';
import { testDb } from './d1-sqlite.js';

const MIGRATION = new URL('../migrations/0002_feedback_senders.sql', import.meta.url);
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-11-25T12:00:00Z');

function db() {
  const d = testDb();
  d.sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  return d;
}

describe('d1SenderStore', () => {
  senderStoreContract(() => d1SenderStore(db()));

  it('stores only the ref, address, site and time', () => {
    const d = db();
    const columns = d.sqlite.prepare('PRAGMA table_info(feedback_senders)').all().map((c) => c.name);
    expect(columns).toEqual(['ref', 'email', 'site', 'created_at']);
  });

  it('keeps rows for 90 days: found on day 90, gone after', async () => {
    let now = T0;
    const store = d1SenderStore(db(), { now: () => now });
    await store.put({ ref: 'a', email: 'rev@example.com', site: 'rr' });
    now = new Date(T0.getTime() + SENDER_RETENTION_DAYS * DAY);
    expect(await store.find('a')).toEqual({ email: 'rev@example.com' });
    now = new Date(T0.getTime() + SENDER_RETENTION_DAYS * DAY + 1000);
    expect(await store.find('a')).toBeNull();
  });

  it('purge deletes rows past retention, keeps newer ones, and says how many', async () => {
    const d = db();
    let now = T0;
    const store = d1SenderStore(d, { now: () => now });
    await store.put({ ref: 'old1', email: 'a@example.com', site: 'rr' });
    await store.put({ ref: 'old2', email: 'b@example.com', site: 'rr' });
    now = new Date(T0.getTime() + 60 * DAY);
    await store.put({ ref: 'new', email: 'c@example.com', site: 'rr' });
    now = new Date(T0.getTime() + 100 * DAY);
    expect(await store.purge()).toBe(2);
    expect(d.sqlite.prepare('SELECT ref FROM feedback_senders').all().map((r) => r.ref)).toEqual(['new']);
    expect(await store.purge()).toBe(0);
  });

  it('is safe against SQL in a ref', async () => {
    const d = db();
    const store = d1SenderStore(d);
    await store.put({ ref: "x'); DROP TABLE feedback_senders;--", email: 'a@example.com', site: 'rr' });
    expect(await store.find("x'); DROP TABLE feedback_senders;--")).toEqual({ email: 'a@example.com' });
  });
});
