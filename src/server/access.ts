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
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface AccessEnv {
  /** e.g. "wallabout-design.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  ACCESS_AUD?: string;
  /** Who may edit: emails, separated by commas. May be empty when only admins edit. */
  EDITOR_EMAILS?: string;
  /** Who may also approve changes and see history: emails, separated by commas. Needed. */
  ADMIN_EMAILS?: string;
  /** Previews only: the email of a fixed test editor. Never set it in production. */
  PREVIEW_TEST_LOGIN?: string;
}

export type Role = 'editor' | 'admin';
export type Action = 'edit' | 'approve' | 'history';

export interface Identity {
  email: string;
  role: Role;
  /** True for the preview test editor, who must never write to real content. */
  test: boolean;
}

export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

/** For tests: the keys the token is checked against, and the time it is checked at. */
export interface IdentifyOptions {
  keys?: JWTVerifyGetKey;
  now?: Date;
}

const keysByTeam = new Map<string, JWTVerifyGetKey>();

export const emails = (list: string | undefined): string[] =>
  (list ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

// Where a preview login may apply: a Workers preview (`<branch>-<site>.<account>.workers.dev`)
// or a machine's own address. Every other host is production.
function isPreviewHost(request: Request): boolean {
  let host: string;
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.workers.dev');
}

/** The signed-in person and their role, or null. */
export async function identify(request: Request, env: AccessEnv, options: IdentifyOptions = {}): Promise<Identity | null> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!team && !audience) {
    const test = env.PREVIEW_TEST_LOGIN?.trim().toLowerCase();
    return test && isPreviewHost(request) ? { email: test, role: 'editor', test: true } : null;
  }
  const admins = emails(env.ADMIN_EMAILS);
  const editors = emails(env.EDITOR_EMAILS);
  if (admins.length === 0) return null;
  const email = await accessEmail(request, env, options);
  if (!email) return null;
  if (admins.includes(email)) return { email, role: 'admin', test: false };
  if (editors.includes(email)) return { email, role: 'editor', test: false };
  return null;
}

/** The claims of a valid Access token, or null. Checks the signature, the team domain and the audience tag. */
async function verifiedClaims(request: Request, env: AccessEnv, options: IdentifyOptions): Promise<JWTPayload | null> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  const token = request.headers.get(ACCESS_HEADER);
  if (!team || !audience || !token) return null;

  const issuer = `https://${team}`;
  let getKey = options.keys ?? keysByTeam.get(issuer);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keysByTeam.set(issuer, getKey);
  }
  try {
    const { payload } = await jwtVerify(token, getKey, { issuer, audience, algorithms: ['RS256'], currentDate: options.now });
    return payload;
  } catch {
    return null;
  }
}

/**
 * The email in a valid Access token, lowercased, or null. Checks the signature, the team
 * domain and the audience tag, and does not look at any list: the caller decides who may.
 * With a setting missing there is no valid token.
 */
export async function accessEmail(request: Request, env: AccessEnv, options: IdentifyOptions = {}): Promise<string | null> {
  const payload = await verifiedClaims(request, env, options);
  return payload && typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
}

/**
 * The client id of the Access service token behind a valid Access token, or null. A service
 * token's JWT has no `email` and carries `common_name`, the token's client id. A token with an
 * `email` claim is a person's browser sign-in and is never a service token, whatever else it holds.
 * Same checks as `accessEmail`; the caller decides which client ids may.
 */
export async function accessServiceToken(request: Request, env: AccessEnv, options: IdentifyOptions = {}): Promise<string | null> {
  const payload = await verifiedClaims(request, env, options);
  if (!payload || 'email' in payload) return null;
  return typeof payload.common_name === 'string' && payload.common_name.trim() ? payload.common_name.trim() : null;
}

/** Whether this person may do this. An admin may do everything an editor may. */
export function can(identity: Identity | null, action: Action): boolean {
  if (!identity) return false;
  if (action === 'edit') return identity.role === 'editor' || identity.role === 'admin';
  return identity.role === 'admin';
}
