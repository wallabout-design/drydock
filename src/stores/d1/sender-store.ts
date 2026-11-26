// The D1 sender store: keeps who sent each feedback note, in the table of
// migrations/0002_feedback_senders.sql, so the feedback routine can look the
// address up by the sink's reference (an issue URL). Plain TypeScript; it takes
// the database as an argument. It never logs and never throws an address into a message.
import type { SenderStore } from '../../server/sender-store.js';
import type { D1Like } from './store.js';

/** Rows older than this are not returned and are deleted by `purge` (standards drydock.md). */
export const SENDER_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface D1SenderOptions {
  /** The store's clock. */
  now?: () => Date;
}

/** `purge` is for the site's cron; the rest is `SenderStore`. */
export interface D1SenderStore extends SenderStore {
  /** Deletes rows older than 90 days and returns how many. */
  purge(): Promise<number>;
}

export function d1SenderStore(db: D1Like, options: D1SenderOptions = {}): D1SenderStore {
  const now = options.now ?? (() => new Date());
  const cutoff = (): string => new Date(now().getTime() - SENDER_RETENTION_DAYS * DAY_MS).toISOString();
  return {
    async put({ ref, email, site }) {
      await db
        .prepare('INSERT OR REPLACE INTO feedback_senders (ref, email, site, created_at) VALUES (?, ?, ?, ?)')
        .bind(ref, email, site, now().toISOString())
        .all();
    },
    async find(ref) {
      const { results } = await db
        .prepare('SELECT email FROM feedback_senders WHERE ref = ? AND created_at >= ?')
        .bind(ref, cutoff())
        .all<{ email: string }>();
      return results[0] ? { email: results[0].email } : null;
    },
    async purge() {
      const [result] = await db.batch([db.prepare('DELETE FROM feedback_senders WHERE created_at < ?').bind(cutoff())]);
      return result?.meta?.changes ?? 0;
    },
  };
}
