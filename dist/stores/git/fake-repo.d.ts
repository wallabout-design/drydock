import type { CheckRun, Pull, Repo } from './repo.js';
interface Commit {
    parent: string | null;
    files: Record<string, string>;
    message: string;
    date: string;
}
export interface FakeRepoOptions {
    base?: string;
    /** Dates each commit; a fixed clock by default. */
    now?: () => Date;
    /**
     * Merges each pull request as soon as it is opened or updated, unless it has
     * this label: what the merge workflow does for `auto`, in no time.
     */
    autoMerge?: {
        skipLabel: string;
    };
    /** The check runs on a commit. Default: `test` passed. */
    checks?: (commit: string) => CheckRun[];
}
export interface FakeRepo extends Repo {
    commits: Map<string, Commit>;
    branches: Map<string, string>;
    pulls_: (Pull & {
        base: string;
        title: string;
        body: string;
    })[];
    /** Every call made, e.g. "commit content-edit/ada-example-org-cfe00dde/2026-11-10". */
    calls: string[];
    /** A commit straight onto a branch, as when someone else's change merges. */
    push(branch: string, files: Record<string, string | null>, message?: string): string;
    /** The files at a branch's tip. */
    filesAt(branch: string): Record<string, string>;
    /** Replaces what `checks` answers. */
    setChecks(checks: (commit: string) => CheckRun[]): void;
}
export declare function fakeRepo(files: Record<string, string>, options?: FakeRepoOptions): FakeRepo;
export {};
