// The store interface: where a site's content and its changes are kept. The
// in-memory fake (fake-store.ts), the git store and the D1 store all implement
// it and must pass storeContract (src/testing/store-contract.ts). Plain TypeScript.
import type { ContentState, Operation } from './change.js';

/** `auto` puts a change live at once; `review` leaves it waiting for an admin. */
export type Mode = 'auto' | 'review';
export type ChangeState = 'waiting' | 'live' | 'rejected' | 'undone';

export interface NewChange {
  ops: Operation[];
  /** Who made the change. */
  by: string;
}

export interface Change extends NewChange {
  id: string;
  /** When the store took the change (the store's clock). */
  at: string;
  state: ChangeState;
  /** For an undo: the change it undid. */
  undoes?: string;
  /** Who approved, rejected or undid the change, and when. */
  decidedBy?: string;
  decidedAt?: string;
  /** The operations that put the content back, kept once the change is live. */
  reverse?: Operation[];
}

/** Why a store did not do what was asked. Nothing changed. */
export type Refusal =
  /** Something the editor last saw has moved on. `current` is the content now. */
  | { reason: 'stale'; index: number; current: ContentState }
  | { reason: 'invalid'; message: string }
  | { reason: 'not-found' }
  | { reason: 'wrong-state'; state: ChangeState };

export type Outcome = { ok: true; change: Change } | { ok: false; refusal: Refusal };

export interface ListQuery {
  state?: ChangeState;
  /** The `next` of the page before. */
  cursor?: string;
  /** Changes per page. Default 20. */
  limit?: number;
}

export interface ChangePage {
  /** Newest first. */
  changes: Change[];
  /** Pass as `cursor` for the next page, or null when this is the last. */
  next: string | null;
}

/** What a store does with a change once it is accepted: the edit view says so, without checking which store it is. */
export interface StoreCapabilities {
  /** `at-once`: an accepted change is live when it is saved. `after-checks`: it goes live a few minutes later, once the site's checks pass. */
  goesLive: 'at-once' | 'after-checks';
  /** How many changes are kept to undo or look back at: a number, or `all`. */
  history: number | 'all';
}

export interface Store {
  /** What this store does with a change; see StoreCapabilities. */
  readonly capabilities: StoreCapabilities;
  /** All texts and lists, as they are live now. */
  read(): Promise<ContentState>;
  /** Refuses the whole change if any "last saw" is stale; otherwise waits (`review`) or goes live (`auto`). */
  submit(change: NewChange, mode: Mode): Promise<Outcome>;
  /** A waiting change goes live, if it is still not stale. */
  approve(id: string, by: string): Promise<Outcome>;
  /** A waiting change is rejected; the content is not touched. */
  reject(id: string, by: string): Promise<Outcome>;
  /** A live change is undone: the content goes back, and the undo is a new live change, returned here. */
  undo(id: string, by: string): Promise<Outcome>;
  list(query?: ListQuery): Promise<ChangePage>;
}
