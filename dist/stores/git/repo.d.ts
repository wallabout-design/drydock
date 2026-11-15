export interface Pull {
    number: number;
    url: string;
    /** The branch the pull request merges from. */
    branch: string;
    /** The commit at the tip of that branch. */
    head: string;
    /** Its labels' names. */
    labels: string[];
    state: 'open' | 'merged' | 'closed';
    /** ISO 8601. */
    createdAt: string;
}
export interface CommitFacts {
    parents: string[];
    /** The files it changes from its first parent (a renamed file is listed under both names). */
    files: string[];
    /** When it was made (ISO 8601), or null when unknown. */
    date: string | null;
    message: string;
}
export interface CheckRun {
    name: string;
    status: string;
    /** Null until the check has finished. */
    conclusion: string | null;
}
export type MergeResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export interface Repo {
    /** The commit at the tip of a branch, or null when there is no such branch. */
    tip(branch: string): Promise<string | null>;
    /** A commit's facts, or null when there is no such commit. */
    commitFacts(commit: string): Promise<CommitFacts | null>;
    /** True when `commit` is in `branch`'s history (or is its tip). */
    contains(branch: string, commit: string): Promise<boolean>;
    /** The paths of every file at a commit that starts with `prefix`. */
    files(commit: string, prefix: string): Promise<string[]>;
    /** A file's text at a commit, or null when it isn't there. */
    read(path: string, commit: string): Promise<string | null>;
    /**
     * Makes a commit on top of `parent` that writes the given files (a string) and
     * deletes the ones given as null, and points `branch` at it, but only if the
     * branch is still at `expected` (null: the branch must not exist yet). Returns
     * the new commit, or null when the branch had moved: someone else saved first,
     * and nothing was changed.
     */
    commit(input: {
        branch: string;
        expected: string | null;
        parent: string;
        files: Record<string, string | null>;
        message: string;
    }): Promise<string | null>;
    /** Pull requests from this repository's own branches into `base`, newest first, at most 100. */
    pulls(base: string, state: 'open' | 'all'): Promise<Pull[]>;
    /** One pull request, or null when there is none. */
    pull(number: number): Promise<Pull | null>;
    /** Opens a pull request with these labels, or returns null when one from `branch` is already open. */
    createPull(input: {
        branch: string;
        base: string;
        title: string;
        body: string;
        labels: string[];
    }): Promise<Pull | null>;
    /** Rewrites a pull request's title and body. False when it is no longer open. */
    updatePull(number: number, input: {
        title: string;
        body: string;
    }): Promise<boolean>;
    /** Closes a pull request without merging it. */
    closePull(number: number): Promise<void>;
    addLabel(number: number, name: string): Promise<void>;
    removeLabel(number: number, name: string): Promise<void>;
    /** The check runs on a commit. */
    checks(commit: string): Promise<CheckRun[]>;
    /** Squash-merges a pull request, but only if its branch is still at `sha`. */
    merge(number: number, sha: string): Promise<MergeResult>;
}
