// GitHub credentials for the git store: a GitHub App (app id, private key,
// installation id) or a fine-grained token, whichever settings are present.
// The App is preferred when all three of its settings are there. Everything
// comes in as arguments; nothing here reads the environment.
import { importPKCS8, SignJWT } from 'jose';
const APP_SETTINGS = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID'];
export function resolveGitAuth(env, fetcher = fetch, now = () => new Date()) {
    const present = APP_SETTINGS.filter((name) => (env[name] ?? '').trim() !== '');
    if (present.length === APP_SETTINGS.length) {
        return { ok: true, kind: 'app', token: installationToken(env, fetcher, now) };
    }
    const token = (env.GITHUB_TOKEN ?? '').trim();
    if (token !== '')
        return { ok: true, kind: 'token', token: async () => token };
    if (present.length > 0) {
        const missing = APP_SETTINGS.filter((name) => !present.includes(name));
        return { ok: false, message: `GitHub App settings are incomplete: ${missing.join(', ')} missing` };
    }
    return { ok: false, message: 'no GitHub settings: set the App settings (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID) or GITHUB_TOKEN' };
}
/** A function that gives an installation token, asking GitHub only when the last one is about to expire. */
function installationToken(env, fetcher, now) {
    let cached = null;
    return async () => {
        if (cached && cached.expires - now().getTime() > 60_000)
            return cached.token;
        const key = await importPKCS8(env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256').catch(() => {
            throw new Error('GITHUB_APP_PRIVATE_KEY is not a PKCS#8 key');
        });
        const seconds = Math.floor(now().getTime() / 1000);
        // Issued a minute early, as GitHub advises, in case the clocks differ.
        const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(env.GITHUB_APP_ID).setIssuedAt(seconds - 60).setExpirationTime(seconds + 540).sign(key);
        const response = await fetcher(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID)}/access_tokens`, {
            method: 'POST',
            headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'wallabout-editor' },
        });
        if (!response.ok)
            throw new Error(`GitHub ${response.status} on the installation token`);
        const json = (await response.json());
        cached = { token: json.token, expires: Date.parse(json.expires_at) };
        return json.token;
    };
}
