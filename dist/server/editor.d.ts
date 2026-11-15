import type { JWTVerifyGetKey } from 'jose';
import type { Operation } from '../core/change.js';
import type { Content } from '../core/declare.js';
import type { Mode, Store } from '../core/store.js';
import { type AccessEnv } from './access.js';
export declare const MAX_BODY_BYTES: number;
export interface EditorSite {
    /** Gets the public page at `path` (such as `/about`) exactly as a signed-out visitor gets it. */
    fetchPage(path: string, request: Request): Promise<Response>;
    /** The site's own origin, when the Worker can't tell it from the request address. */
    origin?: string;
}
export interface EditorOptions {
    content: Content;
    store: Store;
    mode: Mode;
    site: EditorSite;
    /** For tests: the keys an Access token is checked against, and the time it is checked at. */
    keys?: JWTVerifyGetKey;
    now?: () => Date;
}
export interface Editor {
    /** The response for a path the editor owns, or null for any other path. */
    handle(request: Request, env: AccessEnv): Promise<Response | null>;
}
/** True for `/admin` and everything under it, and nothing else (not `/administrator`). */
export declare const isAdminPath: (pathname: string) => boolean;
/** The operations in a request body, or null when it is not `{ ops: Operation[] }` of the right shapes. */
export declare function parseOps(text: string): Operation[] | null;
export declare function createEditor(options: EditorOptions): Editor;
