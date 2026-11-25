import { describe, expect, it } from 'vitest';
import { githubIssuesSink, issueBody, type GitHubAuth } from '../src/server/index.js';
import { sinkContract, SAMPLE_NOTE, SAMPLE_SENDER } from '../src/testing/index.js';

// A fake GitHub: records each request and answers with `status` (201 by default).
function fakeGitHub(status = 201, reply: unknown = { html_url: 'https://github.com/example/site/issues/7' }) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetcher };
}

const AUTH: GitHubAuth = { ok: true, token: async () => 'test-token' };
const EMAIL = 'reviewer@example.com';

describe('githubIssuesSink', () => {
  sinkContract(() => githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: fakeGitHub().fetcher }));

  it('opens an issue in the site repository, titled with the subject tag and labelled', async () => {
    const gh = fakeGitHub();
    await githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: gh.fetcher }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(gh.requests).toHaveLength(1);
    const [req] = gh.requests;
    expect(req.url).toBe('https://api.github.com/repos/example/site/issues');
    expect(req.init.method).toBe('POST');
    expect((req.init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
    const body = JSON.parse(String(req.init.body));
    expect(body.title).toBe('[rr] /stay #k7mq');
    expect(body.labels).toEqual(['feedback']);
  });

  it('uses the label it is given', async () => {
    const gh = fakeGitHub();
    await githubIssuesSink({ repo: 'example/site', auth: AUTH, label: 'review', fetcher: gh.fetcher }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(JSON.parse(String(gh.requests[0].init.body)).labels).toEqual(['review']);
  });

  it('answers with the issue URL as the reference', async () => {
    const result = await githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: fakeGitHub().fetcher }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(result).toEqual({ ok: true, ref: 'https://github.com/example/site/issues/7' });
  });

  it('never puts the sender’s address in the issue', async () => {
    const gh = fakeGitHub();
    await githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: gh.fetcher }).send(SAMPLE_NOTE, { email: EMAIL });
    const sent = String(gh.requests[0].init.body);
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain('reviewer@');
  });

  it('keeps the note, the page details and the quoted selection in the body', () => {
    const body = issueBody(SAMPLE_NOTE);
    expect(body).toContain('The heading is too small.');
    expect(body).toContain('> Stay with us');
    expect(body).toContain('url: https://example.com/stay');
    expect(body).toContain('viewport: 390x844 @3x');
    expect(body).toContain('build: abc1234');
  });

  it('answers ok false with a plain sentence when GitHub refuses, and never throws', async () => {
    const result = await githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: fakeGitHub(403, { message: 'Forbidden' }).fetcher }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/access needs checking/);
  });

  it('answers ok false when the network fails', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await githubIssuesSink({ repo: 'example/site', auth: AUTH, fetcher: failing }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(result.ok).toBe(false);
  });

  it('answers ok false without calling GitHub when the site has no GitHub access', async () => {
    const gh = fakeGitHub();
    const result = await githubIssuesSink({ repo: 'example/site', auth: { ok: false, message: 'no GitHub settings' }, fetcher: gh.fetcher }).send(SAMPLE_NOTE, SAMPLE_SENDER);
    expect(result.ok).toBe(false);
    expect(gh.requests).toHaveLength(0);
  });
});
