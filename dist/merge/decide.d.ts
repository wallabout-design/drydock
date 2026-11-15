import type { Content } from '../core/declare.js';
export interface PullFacts {
    /** The branch the pull request merges from, e.g. "content-edit/ada-example-org-1a2b3c4d/2026-11-10". */
    headBranch: string;
    /** "owner/name" of the repository that branch is in. */
    headRepository: string;
    /** "owner/name" of the repository the pull request is in. */
    repository: string;
    /** The branch it merges into. */
    baseBranch: string;
    /** Every file the pull request changes, as GitHub lists them. */
    files: {
        filename: string;
        status: string;
    }[];
    /** The text of each changed file at the tip of the branch; null when it is not there. */
    headFiles: Readonly<Record<string, string | null>>;
    /** How many item files each list has at the tip of the branch. */
    itemCounts: Readonly<Record<string, number>>;
    /** How the `test` check ended: "success", "failure", "missing"… */
    conclusion: string;
}
export interface CheckConfig {
    /** The branch the site deploys from; a pull request into any other is left for a person. */
    base: string;
    /** What an editor's branch names start with, e.g. "content-edit/". */
    branchPrefix: string;
}
export type Verdict = {
    action: 'ignore';
} | {
    action: 'merge';
    changed: string[];
} | {
    action: 'needs-review';
    reasons: string[];
};
export declare function decide(facts: PullFacts, content: Content, config: CheckConfig): Verdict;
