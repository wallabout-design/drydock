import type { Content } from '../core/declare.js';
import { type Report, type Snapshot } from '../core/read.js';
/** The part of a D1 database this reads through; Cloudflare's `D1Database` fits. */
export interface ReadDb {
    prepare(sql: string): ReadStatement;
}
export interface ReadStatement {
    bind(...values: unknown[]): ReadStatement;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
}
export interface LoadOptions {
    /** The lists this request shows. Others are not queried. */
    lists?: readonly string[];
    /** Where failures go: the site's logger. Never pass answers or secrets. */
    report?: Report;
}
export declare function loadSnapshotFromD1(content: Content, db: ReadDb, options?: LoadOptions): Promise<Snapshot>;
