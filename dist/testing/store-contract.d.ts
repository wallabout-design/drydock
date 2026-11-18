import type { ContentState, Store } from '../index.js';
export declare const INITIAL: ContentState;
export declare function storeContract(makeStore: (initial: ContentState) => Store | Promise<Store>): void;
