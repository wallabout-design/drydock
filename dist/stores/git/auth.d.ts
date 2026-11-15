/** The settings a site's Worker passes in (names as in its secrets). */
export interface GitAuthEnv {
    GITHUB_APP_ID?: string;
    /** PKCS#8 PEM. GitHub gives a PKCS#1 key: `openssl pkcs8 -topk8 -nocrypt -in key.pem`. */
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_APP_INSTALLATION_ID?: string;
    /** A fine-grained token, used when the App settings are not all present. */
    GITHUB_TOKEN?: string;
}
export type GitAuth = {
    ok: true;
    kind: 'app' | 'token';
    token: () => Promise<string>;
} | {
    ok: false;
    message: string;
};
export declare function resolveGitAuth(env: GitAuthEnv, fetcher?: typeof fetch, now?: () => Date): GitAuth;
