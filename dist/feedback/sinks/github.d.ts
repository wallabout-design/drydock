/** What `resolveGitAuth` returns, written out here so this file imports nothing. */
export type GitHubAuth = {
    ok: true;
    token: () => Promise<string>;
} | {
    ok: false;
    message: string;
};
/** The fields of a note this sink uses (a `Note` from the server satisfies it). */
export interface IssueNote {
    subject: string;
    note: string;
    context: {
        url: string;
        viewport: string;
        dpr: number;
        build: string;
        selection: string;
    };
}
export interface GitHubIssuesOptions {
    /** `owner/name` of the site's repository. */
    repo: string;
    /** The site's GitHub credentials, from `resolveGitAuth`. */
    auth: GitHubAuth;
    /** Label put on each issue. */
    label?: string;
    /** For tests: the fetch that talks to GitHub. Defaults to the global one. */
    fetcher?: typeof fetch;
}
export type IssueSinkResult = {
    ok: true;
    ref: string;
} | {
    ok: false;
    message: string;
};
/** Who sent the note. Used by no field of the issue, so the address never reaches GitHub. */
export interface IssueSender {
    email: string;
}
/** The page details and note as the issue body. Plain text, with no sender address. */
export declare function issueBody(note: IssueNote): string;
/** A sentence a reviewer understands, for a GitHub status. */
export declare function explainFailure(status: number): string;
export declare function githubIssuesSink(options: GitHubIssuesOptions): {
    send(note: IssueNote, sender: IssueSender): Promise<IssueSinkResult>;
};
