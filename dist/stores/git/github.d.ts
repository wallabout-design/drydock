import type { Repo } from './repo.js';
export declare class GitHubError extends Error {
    status: number;
    constructor(status: number, what: string);
}
/**
 * @param repository "owner/name"
 * @param token a token, or a function that gives a current one (an App's tokens expire)
 */
export declare function githubRepo(repository: string, token: string | (() => Promise<string>), fetcher?: typeof fetch): Repo;
