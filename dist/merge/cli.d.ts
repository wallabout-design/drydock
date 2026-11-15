import type { Content } from '../core/declare.js';
import { type CheckConfig } from './decide.js';
export declare const LABEL = "status:needs-human-review";
export type Gh = (args: string[]) => string;
export interface Run {
    /** "owner/name". */
    repository: string;
    headSha: string;
    headBranch: string;
    /** `auto` or `review`: the site's mode. */
    mode: string;
    /** The check run that must have passed on the tested commit. */
    testCheck: string;
}
/**
 * Leaves a pull request for a person: labels it and says why on it.
 */
export declare function flag(repository: string, number: number, reasons: string[], gh?: Gh): string;
/** @returns what was done, for the log */
export declare function check(run: Run, content: Content, config: CheckConfig, gh?: Gh): Promise<string>;
/** Loads the site's declaration: the module's `content` export (or its default), as `defineContent` returned it. */
export declare function loadDeclaration(path: string): Promise<Content>;
