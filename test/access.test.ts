import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_HEADER, can, identify, type AccessEnv, type Identity } from '../src/server/index.js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env: AccessEnv = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  EDITOR_EMAILS: 'Ed@example.com, pat@example.com',
  ADMIN_EMAILS: 'boss@example.com',
};
const NOW = new Date('2026-11-15T12:00:00Z');
const at = (seconds: number) => Math.floor(NOW.getTime() / 1000) + seconds;

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig' };
  keys = async () => (await import('jose')).importJWK(jwk, 'RS256') as Promise<CryptoKey>;
});

async function token(over: { email?: unknown; aud?: string; iss?: string; exp?: number; key?: CryptoKey } = {}) {
  return new SignJWT({ email: 'email' in over ? over.email : 'ed@example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(over.iss ?? `https://${TEAM}`)
    .setAudience(over.aud ?? AUD)
    .setIssuedAt(at(-60))
    .setExpirationTime(over.exp ?? at(3600))
    .sign(over.key ?? privateKey);
}
const req = (jwt?: string, url = 'https://clientsite.example/admin') =>
  new Request(url, { headers: jwt ? { [ACCESS_HEADER]: jwt } : {} });
const who = async (jwt?: string, settings: AccessEnv = env, url?: string) => identify(req(jwt, url), settings, { keys, now: NOW });

describe('identify with an Access token', () => {
  it('accepts a good token: an editor', async () => {
    expect(await who(await token())).toEqual({ email: 'ed@example.com', role: 'editor', test: false });
  });
  it('gives an admin the admin role, and an admin listed as an editor too is still an admin', async () => {
    expect(await who(await token({ email: 'BOSS@example.com' }))).toEqual({ email: 'boss@example.com', role: 'admin', test: false });
    const both = { ...env, EDITOR_EMAILS: 'boss@example.com' };
    expect((await who(await token({ email: 'boss@example.com' }), both))?.role).toBe('admin');
  });
  it('matches emails without regard to case or spaces in the settings', async () => {
    expect((await who(await token({ email: 'PAT@Example.com' })))?.role).toBe('editor');
  });
  it('accepts an admin when no editors are listed', async () => {
    const { EDITOR_EMAILS: _unused, ...adminsOnly } = env;
    expect((await who(await token({ email: 'boss@example.com' }), adminsOnly))?.role).toBe('admin');
  });

  it('refuses the wrong audience', async () => expect(await who(await token({ aud: 'other-app' }))).toBeNull());
  it('accepts a token for any tag in a comma-separated list, and still refuses others', async () => {
    const several = { ...env, ACCESS_AUD: `first-app, ${AUD} ,third-app` };
    expect((await who(await token({}), several))?.role).toBe('editor');
    expect(await who(await token({ aud: 'other-app' }), several)).toBeNull();
    expect(await who(await token({}), { ...env, ACCESS_AUD: ' , ' })).toBeNull();
  });
  it('refuses the wrong issuer', async () => expect(await who(await token({ iss: 'https://evil.cloudflareaccess.com' }))).toBeNull());
  it('refuses an expired token', async () => expect(await who(await token({ exp: at(-10) }))).toBeNull());
  it('accepts the same token just before it expires', async () => expect(await who(await token({ exp: at(1) }))).not.toBeNull());
  it('refuses a token signed with another key', async () => expect(await who(await token({ key: otherKey }))).toBeNull());
  it('refuses an email that is not listed', async () => expect(await who(await token({ email: 'stranger@example.com' }))).toBeNull());
  it('refuses a token with no email, or a non-text email', async () => {
    expect(await who(await token({ email: undefined }))).toBeNull();
    expect(await who(await token({ email: 42 }))).toBeNull();
  });
  it('refuses a request with no token, or junk in the header', async () => {
    expect(await who(undefined)).toBeNull();
    expect(await who('not-a-token')).toBeNull();
  });
  it('refuses an unsigned token', async () => {
    const body = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const unsigned = `${body({ alg: 'none' })}.${body({ email: 'ed@example.com', iss: `https://${TEAM}`, aud: AUD, exp: at(3600) })}.`;
    expect(await who(unsigned)).toBeNull();
  });
});

describe('missing settings refuse everyone', () => {
  const missing: [string, keyof AccessEnv][] = [
    ['the team domain', 'ACCESS_TEAM_DOMAIN'],
    ['the audience tag', 'ACCESS_AUD'],
    ['the admin list', 'ADMIN_EMAILS'],
  ];
  for (const [name, key] of missing) {
    for (const blank of [undefined, '', '  ', ' , ']) {
      if (key !== 'ADMIN_EMAILS' && blank === ' , ') continue;
      it(`${name} ${blank === undefined ? 'unset' : `"${blank}"`}`, async () => {
        const settings = { ...env, [key]: blank };
        for (const email of ['ed@example.com', 'boss@example.com']) {
          expect(await who(await token({ email }), settings)).toBeNull();
        }
      });
    }
  }
  it('no settings at all', async () => expect(await who(await token(), {})).toBeNull());
});

describe('the preview login', () => {
  const preview = { PREVIEW_TEST_LOGIN: 'Tester@example.com' };
  const test: Identity = { email: 'tester@example.com', role: 'editor', test: true };

  it('signs in the fixed test editor on a Workers preview and on localhost, with no token', async () => {
    for (const url of ['https://feat-4-site.acct.workers.dev/admin', 'http://localhost:4321/admin', 'http://127.0.0.1:8787/admin']) {
      expect(await who(undefined, preview, url), url).toEqual(test);
    }
  });
  it('is refused on a production host whatever is configured', async () => {
    for (const url of [
      'https://clientsite.example/admin',
      'https://www.clientsite.example/admin',
      'https://workers.dev.clientsite.example/admin',
      'https://clientsite.example/admin?x=localhost',
      'https://localhost.clientsite.example/admin',
      'https://notworkers.dev/admin',
    ]) {
      expect(await who(undefined, preview, url), url).toBeNull();
      expect(await who(await token(), { ...preview }, url), url).toBeNull();
    }
  });
  it('is ignored when the Access settings are present, even on a preview host', async () => {
    const url = 'https://feat-4-site.acct.workers.dev/admin';
    expect(await who(undefined, { ...env, ...preview }, url)).toBeNull();
    expect(await who(undefined, { ACCESS_AUD: AUD, ...preview }, url)).toBeNull();
    expect(await who(undefined, { ACCESS_TEAM_DOMAIN: TEAM, ...preview }, url)).toBeNull();
  });
  it('does nothing when it is not set or is blank', async () => {
    for (const value of [undefined, '', '   ']) {
      expect(await who(undefined, { PREVIEW_TEST_LOGIN: value }, 'http://localhost:4321/admin')).toBeNull();
    }
  });
  it('never makes an admin', async () => {
    const settings = { PREVIEW_TEST_LOGIN: 'boss@example.com', ADMIN_EMAILS: 'boss@example.com' };
    expect((await who(undefined, settings, 'http://localhost:4321/admin'))?.role).toBe('editor');
  });
});

describe('can', () => {
  const editor: Identity = { email: 'e@example.com', role: 'editor', test: false };
  const admin: Identity = { email: 'a@example.com', role: 'admin', test: false };
  it('lets an editor edit only', () => {
    expect([can(editor, 'edit'), can(editor, 'approve'), can(editor, 'history')]).toEqual([true, false, false]);
  });
  it('lets an admin do everything', () => {
    expect([can(admin, 'edit'), can(admin, 'approve'), can(admin, 'history')]).toEqual([true, true, true]);
  });
  it('lets nobody who is not signed in do anything', () => {
    expect([can(null, 'edit'), can(null, 'approve'), can(null, 'history')]).toEqual([false, false, false]);
  });
});
