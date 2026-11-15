import type { Content } from '../../core/declare.js';
import type { Store } from '../../core/store.js';
/** Earlier versions kept per text or item (content-editing.md, "limits"). */
export declare const HISTORY_KEPT = 50;
/** The part of a D1 statement the store uses; Cloudflare's `D1PreparedStatement` fits. */
export interface D1Statement {
    bind(...values: unknown[]): D1Statement;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
}
/** The part of a D1 database the store uses; Cloudflare's `D1Database` fits. */
export interface D1Like {
    prepare(sql: string): D1Statement;
    /** Runs the statements in order as one transaction: if one throws, none is kept. */
    batch(statements: D1Statement[]): Promise<{
        results?: unknown[];
        meta?: {
            changes?: number;
        };
    }[]>;
}
export interface D1Options {
    /** The site's declaration. Gives every declared text its default, and every declared list a place even when empty. */
    content?: Content;
    /** The store's clock, an ISO time. */
    now?: () => string;
    /** Makes an id for a change. */
    newId?: () => string;
}
export declare function d1Store(db: D1Like, options?: D1Options): Store;
