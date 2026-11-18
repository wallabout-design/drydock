// Who is asking: staff sign-in for /admin and the editor's API (standards
// login.md, "staff"; content-editing.md, "sign-in"). Cloudflare Access sits in
// front of those paths and adds a signed token to each request. This checks
// that token as well, against the team domain and the Access app's audience
// tag, and then checks the email against the site's own lists. With a needed
// setting missing it refuses everyone, so a misconfigured Access app can't
// open the editor.
//
// Previews are not behind Access. There, and only there, PREVIEW_TEST_LOGIN
// names a fixed test editor. It works only on a preview or local host, and
// never when the Access settings are present, so it can't apply in production.
import { createRemoteJWKSet, jwtVerify } from 'jose';
export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
const keysByTeam = new Map();
export const emails = (list) => (list ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
// Where a preview login may apply: a Workers preview (`<branch>-<site>.<account>.workers.dev`)
// or a machine's own address. Every other host is production.
function isPreviewHost(request) {
    let host;
    try {
        host = new URL(request.url).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.workers.dev');
}
/** The signed-in person and their role, or null. */
export async function identify(request, env, options = {}) {
    const team = env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = env.ACCESS_AUD?.trim();
    if (!team && !audience) {
        const test = env.PREVIEW_TEST_LOGIN?.trim().toLowerCase();
        return test && isPreviewHost(request) ? { email: test, role: 'editor', test: true } : null;
    }
    const admins = emails(env.ADMIN_EMAILS);
    const editors = emails(env.EDITOR_EMAILS);
    if (admins.length === 0)
        return null;
    const email = await accessEmail(request, env, options);
    if (!email)
        return null;
    if (admins.includes(email))
        return { email, role: 'admin', test: false };
    if (editors.includes(email))
        return { email, role: 'editor', test: false };
    return null;
}
/**
 * The email in a valid Access token, lowercased, or null. Checks the signature, the team
 * domain and the audience tag, and does not look at any list: the caller decides who may.
 * With a setting missing there is no valid token.
 */
export async function accessEmail(request, env, options = {}) {
    const team = env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = env.ACCESS_AUD?.trim();
    const token = request.headers.get(ACCESS_HEADER);
    if (!team || !audience || !token)
        return null;
    const issuer = `https://${team}`;
    let getKey = options.keys ?? keysByTeam.get(issuer);
    if (!getKey) {
        getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
        keysByTeam.set(issuer, getKey);
    }
    try {
        const { payload } = await jwtVerify(token, getKey, { issuer, audience, algorithms: ['RS256'], currentDate: options.now });
        return typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
    }
    catch {
        return null;
    }
}
/** Whether this person may do this. An admin may do everything an editor may. */
export function can(identity, action) {
    if (!identity)
        return false;
    if (action === 'edit')
        return identity.role === 'editor' || identity.role === 'admin';
    return identity.role === 'admin';
}
