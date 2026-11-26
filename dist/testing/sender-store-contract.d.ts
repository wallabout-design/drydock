import type { SenderStore } from '../server/sender-store.js';
export declare function senderStoreContract(makeStore: () => SenderStore | Promise<SenderStore>): void;
/** An in-memory store, for tests of code that takes a SenderStore. */
export declare function fakeSenderStore(): SenderStore & {
    readonly entries: Map<string, {
        email: string;
        site: string;
    }>;
};
