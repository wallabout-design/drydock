// `Repo` (repo.ts) on GitHub's REST API. The token is only ever sent to
// api.github.com and never logged. It comes from `auth.ts`: a GitHub App's
// installation token or a fine-grained token with Contents, Pull requests,
// Issues (labels) and Checks (read) rights on the site's repository.
import type { CheckRun, CommitFacts, Pull, Repo } from './repo.js';

export class GitHubError extends Error {
  status: number;
  constructor(status: number, what: string) {
    super(`GitHub ${status} on ${what}`);
    this.status = status;
  }
}

interface PullJson {
  number: number;
  html_url: string;
  state: string;
  merged_at?: string | null;
  created_at?: string;
  labels?: { name: string }[];
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}

// GitHub refuses requests that don't name a client.
const CLIENT = 'wallabout-editor';

/**
 * @param repository "owner/name"
 * @param token a token, or a function that gives a current one (an App's tokens expire)
 */
export function githubRepo(repository: string, token: string | (() => Promise<string>), fetcher: typeof fetch = fetch): Repo {
  const api = `https://api.github.com/repos/${repository}`;
  const tokenNow = typeof token === 'string' ? async () => token : token;

  /** One call. Returns null for a status listed in `nullOn`; throws on any other failure. */
  async function call<T>(method: string, path: string, body?: unknown, nullOn: number[] = [], raw = false): Promise<T | null> {
    const headers = new Headers({
      authorization: `Bearer ${await tokenNow()}`,
      accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    });
    headers.set('user-agent', CLIENT);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetcher(`${api}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (nullOn.includes(response.status)) return null;
    if (!response.ok) throw new GitHubError(response.status, `${method} ${path}`);
    return (raw ? await response.text() : await response.json()) as T;
  }

  const pull = (json: PullJson): Pull => ({
    number: json.number,
    url: json.html_url,
    branch: json.head.ref,
    head: json.head.sha,
    labels: (json.labels ?? []).map(({ name }) => name),
    state: json.merged_at ? 'merged' : json.state === 'open' ? 'open' : 'closed',
    createdAt: json.created_at ?? '',
  });
  const ours = (json: PullJson): boolean => json.head.repo?.full_name.toLowerCase() === repository.toLowerCase();
  const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  const repo: Repo = {
    async tip(branch) {
      const ref = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encode(branch)}`, undefined, [404]);
      return ref?.object.sha ?? null;
    },
    async commitFacts(commit): Promise<CommitFacts | null> {
      const json = await call<{
        parents: { sha: string }[];
        files?: { filename: string; previous_filename?: string }[];
        commit?: { message?: string; committer?: { date?: string } };
      }>('GET', `/commits/${commit}`, undefined, [404, 422]);
      if (!json) return null;
      const files = (json.files ?? []).flatMap(({ filename, previous_filename }) => (previous_filename ? [previous_filename, filename] : [filename]));
      return { parents: json.parents.map(({ sha }) => sha), files, date: json.commit?.committer?.date ?? null, message: json.commit?.message ?? '' };
    },
    async contains(branch, commit) {
      // "ahead": the branch has moved on from the commit; "identical": it is the tip.
      const json = await call<{ status: string }>('GET', `/compare/${commit}...${encode(branch)}?per_page=1`, undefined, [404]);
      return json?.status === 'ahead' || json?.status === 'identical';
    },
    async files(commit, prefix) {
      const base = await call<{ tree: { sha: string } }>('GET', `/git/commits/${commit}`, undefined, [404]);
      if (!base) return [];
      const tree = (await call<{ truncated?: boolean; tree: { path: string; type: string }[] }>('GET', `/git/trees/${base.tree.sha}?recursive=1`))!;
      if (tree.truncated) throw new Error('the repository is too large to list its content files');
      return tree.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix)).map((entry) => entry.path);
    },
    read(path, commit) {
      return call<string>('GET', `/contents/${encode(path)}?ref=${commit}`, undefined, [404], true);
    },
    async commit({ branch, expected, parent, files, message }) {
      const base = (await call<{ tree: { sha: string } }>('GET', `/git/commits/${parent}`))!;
      const tree = (await call<{ sha: string }>('POST', '/git/trees', {
        base_tree: base.tree.sha,
        tree: Object.entries(files).map(([path, text]) =>
          text === null ? { path, mode: '100644', type: 'blob', sha: null } : { path, mode: '100644', type: 'blob', content: text },
        ),
      }))!;
      const commit = (await call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [parent] }))!;
      if (expected === null) {
        // A new branch: 422 means it exists, so someone else got there first.
        const created = await call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha }, [422]);
        return created ? commit.sha : null;
      }
      // GitHub has no conditional ref update, so check the tip just before
      // moving it. The window left between the two calls is closed by the save,
      // which reads the tip again after the move.
      if ((await repo.tip(branch)) !== expected) return null;
      await call('PATCH', `/git/refs/heads/${encode(branch)}`, { sha: commit.sha, force: true });
      return commit.sha;
    },
    async pulls(base, state) {
      const list = (await call<PullJson[]>('GET', `/pulls?state=${state}&base=${encodeURIComponent(base)}&sort=created&direction=desc&per_page=100`))!;
      return list.filter(ours).map(pull);
    },
    async pull(number) {
      const json = await call<PullJson>('GET', `/pulls/${number}`, undefined, [404]);
      return json && ours(json) ? pull(json) : null;
    },
    async createPull({ branch, base, title, body, labels }) {
      const json = await call<PullJson>('POST', '/pulls', { head: branch, base, title, body }, [422]);
      if (!json) {
        // 422 is also "no commits between"; only an open pull request from the branch means someone else opened it.
        if ((await repo.pulls(base, 'open')).some((open) => open.branch === branch)) return null;
        throw new GitHubError(422, 'POST /pulls');
      }
      if (labels.length > 0) await call('POST', `/issues/${json.number}/labels`, { labels });
      return pull({ ...json, labels: labels.map((name) => ({ name })) });
    },
    async updatePull(number, { title, body }) {
      const json = (await call<PullJson>('GET', `/pulls/${number}`))!;
      if (json.state !== 'open') return false;
      await call('PATCH', `/pulls/${number}`, { title, body });
      return true;
    },
    async closePull(number) {
      await call('PATCH', `/pulls/${number}`, { state: 'closed' });
    },
    async addLabel(number, name) {
      await call('POST', `/issues/${number}/labels`, { labels: [name] });
    },
    async removeLabel(number, name) {
      await call('DELETE', `/issues/${number}/labels/${encodeURIComponent(name)}`, undefined, [404]);
    },
    async checks(commit) {
      const json = await call<{ check_runs: CheckRun[] }>('GET', `/commits/${commit}/check-runs?per_page=100`, undefined, [404]);
      return (json?.check_runs ?? []).map(({ name, status, conclusion }) => ({ name, status, conclusion }));
    },
    async merge(number, sha) {
      const response = await fetcher(`${api}/pulls/${number}/merge`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${await tokenNow()}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': CLIENT,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sha, merge_method: 'squash' }),
      });
      if (response.ok) return { ok: true };
      // 405: not mergeable (conflict, a required check, no rights); 409: the branch moved since `sha`.
      if (response.status === 405 || response.status === 409) return { ok: false, message: response.status === 409 ? 'The change moved on while it was being approved.' : 'GitHub would not merge it.' };
      throw new GitHubError(response.status, `PUT /pulls/${number}/merge`);
    },
  };
  return repo;
}
