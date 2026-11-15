import { type ContentState } from './change.js';
import type { Store } from './store.js';
export interface FakeStoreOptions {
    /** The content the store starts with. */
    initial?: ContentState;
    /** The store's clock: an ISO time for each change. */
    now?: () => string;
}
export declare function fakeStore(options?: FakeStoreOptions): Store;
