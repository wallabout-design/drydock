import type { SenderStore } from '../../server/sender-store.js';
import type { D1Like } from './store.js';
/** Rows older than this are not returned and are deleted by `purge` (standards drydock.md). */
export declare const SENDER_RETENTION_DAYS = 90;
export interface D1SenderOptions {
    /** The store's clock. */
    now?: () => Date;
}
/** `purge` is for the site's cron; the rest is `SenderStore`. */
export interface D1SenderStore extends SenderStore {
    /** Deletes rows older than 90 days and returns how many. */
    purge(): Promise<number>;
}
export declare function d1SenderStore(db: D1Like, options?: D1SenderOptions): D1SenderStore;
