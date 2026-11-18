import { describe, expect, it } from 'vitest';
import { defineContent, type Change, type ContentState, type Operation, type Outcome } from '../src/index.js';
import {
  fakeRepo,
  gitStore,
  githubRepo,
  isContentPath,
  loadContentFiles,
  renderContentFiles,
  resolveGitAuth,
  type FakeRepo,
} from '../src/server/index.js';
import { assignPositions } from '../src/stores/git/files.js';
import { editorStem } from '../src/stores/git/save.js';
import { INITIAL, storeContract } from '../src/testing/index.js';

const content = defineContent({
  texts: [
    { key: 'home.title', default: 'Hello', max: 30, label: 'Title' },
    { key: 'home.intro', default: 'Welcome', max: 30, label: 'Intro' },
  ],
  lists: [
    {
      name: 'rooms',
      label: 'rooms',
      singular: 'room',
      titleField: 'title',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'beds', label: 'Beds', type: 'number', min: 1, max: 12 },
      ],
      sort: 'hand',
      maxItems: 8,
    },
  ],
});

const REVIEW = 'content:waiting-review';
const OUTSIDE = { 'src/app.ts': 'export {};\n', 'package.json': '{}\n', 'README.md': 'hi\n', 'content-notes.txt': 'not content\n' };

function repoWith(initial: ContentState, extra: Record<string, string> = {}, autoMerge = true): FakeRepo {
  const start: ContentState = { texts: { ...initial.texts }, lists: { ...initial.lists } };
  return fakeRepo({ ...extra, ...renderContentFiles(content, start).files }, autoMerge ? { autoMerge: { skipLabel: REVIEW } } : {});
}
const storeOn = (repo: FakeRepo) => gitStore({ repo, content, config: { site: 'test.example' }, now: () => new Date('2026-11-15T10:00:00Z') });

// The git store passes the same contract as the in-memory one. The fake repo
// merges at once, as the merge workflow does for `auto` once tests pass.
storeContract((initial) => storeOn(repoWith(initial)));

const setText = (key: string, seen: string, text: string): Operation => ({ op: 'setText', key, seen, text });
const ok = (outcome: Outcome): Change => {
  if (!outcome.ok) throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome.change;
};
const mainFiles = (repo: FakeRepo) => repo.filesAt('main');

describe('git store files', () => {
  it('writes fixed formatting: only edited texts, sorted; fields in declared order; position first', () => {
    const state: ContentState = {
      texts: { 'home.title': 'Hi', 'home.intro': 'Welcome' },
      lists: { rooms: [{ id: 'a', values: { beds: 2, title: 'Blue' } }] },
    };
    const { files } = renderContentFiles(content, state);
    expect(files).toEqual({
      'content/texts.json': '{\n  "home.title": "Hi"\n}\n',
      'content/rooms/a.json': '{\n  "position": 1000,\n  "title": "Blue",\n  "beds": 2\n}\n',
    });
    expect(loadContentFiles(content, files).state).toEqual(state);
  });

  it('a move changes one file, and an add between two items changes only the new one', async () => {
    const initial: ContentState = {
      texts: {},
      lists: { rooms: ['a', 'b', 'c', 'd'].map((id) => ({ id, values: { title: id.toUpperCase() } })) },
    } as unknown as ContentState;
    const repo = repoWith({ ...initial, texts: { 'home.title': 'Hello', 'home.intro': 'Welcome' } });
    const store = storeOn(repo);
    const before = { ...mainFiles(repo) };
    ok(await store.submit({ ops: [{ op: 'moveItem', list: 'rooms', id: 'd', after: 'a', seen: 'c' }], by: 'ana@x.test' }, 'auto'));
    const changed = Object.keys(mainFiles(repo)).filter((p) => mainFiles(repo)[p] !== before[p]);
    expect(changed).toEqual(['content/rooms/d.json']);
    expect((await store.read()).lists.rooms?.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c']);
    ok(await store.submit({ ops: [{ op: 'addItem', list: 'rooms', id: 'e', values: { title: 'E' }, after: 'b' }], by: 'ana@x.test' }, 'auto'));
    expect((await store.read()).lists.rooms?.map((i) => i.id)).toEqual(['a', 'd', 'b', 'e', 'c']);
  });

  it('assignPositions keeps what fits and numbers the list again when there is no room', () => {
    expect([...assignPositions(['a', 'b'], new Map())]).toEqual([['a', 1000], ['b', 2000]]);
    expect([...assignPositions(['a', 'x', 'b'], new Map([['a', 1000], ['b', 2000]]))]).toEqual([['a', 1000], ['x', 1500], ['b', 2000]]);
    expect([...assignPositions(['a', 'x', 'b'], new Map([['a', 1], ['b', 2]]))]).toEqual([['a', 1000], ['x', 2000], ['b', 3000]]);
    expect(assignPositions(['c', 'a', 'b'], new Map([['a', 1000], ['b', 2000], ['c', 3000]])).get('a')).toBe(1000);
  });

  it('only paths inside content/ count', () => {
    for (const bad of ['src/a.json', 'content/../src/a.json', 'content/', 'contentx/a.json', '/content/a.json', 'content//a.json']) expect(isContentPath(bad)).toBe(false);
    expect(isContentPath('content/rooms/a.json')).toBe(true);
  });
});

describe('git store: a change touches only content/', () => {
  it('commits only content files, whatever the change, and leaves every other file alone', async () => {
    const repo = repoWith(INITIAL, OUTSIDE);
    const store = storeOn(repo);
    const changes: Operation[][] = [
      [setText('home.title', 'Hello', 'Hi')],
      [{ op: 'addItem', list: 'rooms', id: 'c', values: { title: 'Red' }, after: 'b' }],
      [{ op: 'moveItem', list: 'rooms', id: 'c', after: null, seen: 'b' }],
      [{ op: 'editItem', list: 'rooms', id: 'c', values: { title: 'Crimson' }, seen: { title: 'Red' } }],
      [{ op: 'removeItem', list: 'rooms', id: 'a', seen: { title: 'Blue room' } }],
    ];
    for (const ops of changes) ok(await store.submit({ ops, by: 'ana@x.test' }, 'auto'));
    ok(await store.undo('4', 'jj@x.test'));
    for (const sha of repo.commits.keys()) {
      if (sha === 'c1') continue;
      const facts = await repo.commitFacts(sha);
      for (const file of facts?.files ?? []) expect(isContentPath(file), `${sha} wrote ${file}`).toBe(true);
    }
    for (const [path, text] of Object.entries(OUTSIDE)) expect(mainFiles(repo)[path]).toBe(text);
  });

  it('refuses ids and lists that would write elsewhere, and writes nothing', async () => {
    const repo = repoWith(INITIAL, OUTSIDE);
    const store = storeOn(repo);
    const before = repo.commits.size;
    for (const id of ['../src/app', 'a/b', 'A', '', '.hidden', 'x'.repeat(65)]) {
      const outcome = await store.submit({ ops: [{ op: 'addItem', list: 'rooms', id, values: { title: 'X' }, after: null }], by: 'ana@x.test' }, 'auto');
      expect(outcome.ok, id).toBe(false);
    }
    const unknownList = await store.submit({ ops: [{ op: 'addItem', list: '../src', id: 'x', values: { title: 'X' }, after: null }], by: 'ana@x.test' }, 'auto');
    expect(unknownList.ok).toBe(false);
    expect(repo.commits.size).toBe(before);
  });

  it('refuses text that fails the declaration, and a list past its maximum', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    expect((await store.submit({ ops: [setText('home.title', 'Hello', 'x'.repeat(31))], by: 'ana@x.test' }, 'auto')).ok).toBe(false);
    expect((await store.submit({ ops: [setText('home.title', 'Hello', '<b>Hi</b>')], by: 'ana@x.test' }, 'auto')).ok).toBe(false);
    const many: Operation[] = Array.from({ length: 7 }, (_, i) => ({ op: 'addItem', list: 'rooms', id: `n${i}`, values: { title: 'x' }, after: null }));
    const outcome = await store.submit({ ops: many, by: 'ana@x.test' }, 'auto');
    expect(!outcome.ok && outcome.refusal).toMatchObject({ reason: 'invalid' });
  });
});

describe('git store: a list sorted by a field', () => {
  it('reads in sort order and writes no position', async () => {
    const sorted = defineContent({
      lists: [{ name: 'cats', label: 'cats', singular: 'cat', titleField: 'title', fields: [{ name: 'title', label: 'Title', type: 'text', required: true }], sort: { by: 'title' } }],
    });
    const repo = fakeRepo({ 'content/cats/z.json': '{\n  "title": "Zed"\n}\n' }, { autoMerge: { skipLabel: REVIEW } });
    const store = gitStore({ repo, content: sorted, config: { site: 't' } });
    ok(await store.submit({ ops: [{ op: 'addItem', list: 'cats', id: 'a', values: { title: 'Ann' }, after: null }], by: 'ana@x.test' }, 'auto'));
    expect((await store.read()).lists.cats?.map((i) => i.id)).toEqual(['a', 'z']);
    expect(mainFiles(repo)['content/cats/a.json']).toBe('{\n  "title": "Ann"\n}\n');
  });
});

describe('git store: branches and pull requests', () => {
  const ana = 'ana@x.test';

  it('keeps one pull request per editor, rebuilt as main plus one commit, keeping waiting operations', async () => {
    const repo = repoWith(INITIAL, OUTSIDE);
    const store = storeOn(repo);
    const first = ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'review'));
    const second = ok(await store.submit({ ops: [setText('home.intro', 'Welcome', 'Hey')], by: ana }, 'review'));
    expect(second.id).toBe(first.id);
    expect(repo.pulls_).toHaveLength(1);
    const pull = repo.pulls_[0]!;
    expect(pull.labels).toEqual([REVIEW]);
    expect(pull.branch.startsWith(await editorStem('content-edit/', ana))).toBe(true);
    expect(pull.branch).toMatch(/^content-edit\/ana-x-test-[0-9a-f]{8}\/2026-11-15$/);
    const facts = await repo.commitFacts(pull.head);
    expect(facts?.parents).toEqual([repo.branches.get('main')]);
    expect(facts?.files).toEqual(['content/texts.json']);
    expect(second.ops.map((o) => (o as { key: string }).key).sort()).toEqual(['home.intro', 'home.title']);
    expect(JSON.parse(repo.filesAt(pull.branch)['content/texts.json'] as string)).toEqual({ 'home.intro': 'Hey', 'home.title': 'Hi' });
    // main has not moved
    expect((await store.read()).texts['home.title']).toBe('Hello');
  });

  it('puts a second edit of the same text into the first, and drops it when put back', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    const first = ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'review'));
    const again = ok(await store.submit({ ops: [setText('home.title', 'Hi', 'Hey')], by: ana }, 'review'));
    expect(again.ops).toEqual([setText('home.title', 'Hello', 'Hey')]);
    const back = ok(await store.submit({ ops: [setText('home.title', 'Hey', 'Hello')], by: ana }, 'review'));
    expect(back.state).toBe('rejected');
    expect(repo.pulls_.find((p) => String(p.number) === first.id)?.state).toBe('closed');
  });

  it('gives each editor their own branch, and never moves a branch someone else worked on', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'review'));
    ok(await store.submit({ ops: [setText('home.intro', 'Welcome', 'Hey')], by: 'ben@x.test' }, 'review'));
    expect(repo.pulls_.map((p) => p.branch)).toHaveLength(2);
    expect(new Set(repo.pulls_.map((p) => p.branch)).size).toBe(2);

    // A person adds a commit to ana's branch: later saves leave it alone and use a new branch.
    const own = repo.pulls_[0]!;
    repo.push(own.branch, { 'src/fix.ts': 'x' }, 'hand fix');
    repo.pulls_[0]!.head = repo.branches.get(own.branch)!;
    const next = ok(await store.submit({ ops: [setText('home.intro', 'Welcome', 'Yo')], by: ana }, 'review'));
    expect(next.id).not.toBe(String(own.number));
    expect(repo.filesAt(own.branch)['src/fix.ts']).toBe('x');
  });

  it('refuses two changes to one item that cannot be one operation', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    ok(await store.submit({ ops: [{ op: 'editItem', list: 'rooms', id: 'a', values: { title: 'Sky' }, seen: { title: 'Blue room' } }], by: ana }, 'review'));
    const outcome = await store.submit({ ops: [{ op: 'moveItem', list: 'rooms', id: 'a', after: 'b', seen: null }], by: ana }, 'review');
    expect(!outcome.ok && outcome.refusal.reason).toBe('invalid');
  });

  it('review: approve merges only when the test check passed; reject closes', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    const change = ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'review'));
    repo.setChecks(() => []);
    let outcome = await store.approve(change.id, 'jj@x.test');
    expect(!outcome.ok && outcome.refusal).toMatchObject({ reason: 'invalid', message: expect.stringContaining('still running') });
    repo.setChecks(() => [{ name: 'test', status: 'completed', conclusion: 'failure' }]);
    outcome = await store.approve(change.id, 'jj@x.test');
    expect(!outcome.ok && outcome.refusal).toMatchObject({ reason: 'invalid', message: expect.stringContaining('did not pass') });
    expect((await store.read()).texts['home.title']).toBe('Hello');
    repo.setChecks(() => [{ name: 'test', status: 'completed', conclusion: 'success' }]);
    ok(await store.approve(change.id, 'jj@x.test'));
    expect((await store.read()).texts['home.title']).toBe('Hi');
    expect(repo.calls).toContain('merge 1');

    const other = ok(await store.submit({ ops: [setText('home.intro', 'Welcome', 'Hey')], by: ana }, 'review'));
    expect(ok(await store.reject(other.id, 'jj@x.test')).state).toBe('rejected');
    expect(repo.pulls_.find((p) => String(p.number) === other.id)?.state).toBe('closed');
  });

  it('auto: the pull request has no review label, and waits for the merge workflow when nothing merges it', async () => {
    const repo = repoWith(INITIAL, {}, false);
    const store = storeOn(repo);
    const change = ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'auto'));
    expect(change.state).toBe('waiting');
    expect(repo.pulls_[0]!.labels).toEqual([]);
    repo.pulls_[0]!.state = 'merged';
    expect((await store.list({ state: 'live' })).changes.map((c) => c.id)).toEqual([change.id]);
  });

  it('only acts on its own pull requests', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    repo.push('feature/x', { 'src/a.ts': 'x' });
    await repo.createPull({ branch: 'feature/x', base: 'main', title: 't', body: 'b', labels: [] });
    expect(!(await store.approve('1', 'jj')).ok).toBe(true);
    expect(await store.approve('1', 'jj')).toEqual({ ok: false, refusal: { reason: 'not-found' } });
    expect(await store.reject('x', 'jj')).toEqual({ ok: false, refusal: { reason: 'not-found' } });
    expect((await store.list()).changes).toEqual([]);
  });

  it('undo twice is refused, and an undone change is listed as undone', async () => {
    const repo = repoWith(INITIAL);
    const store = storeOn(repo);
    const change = ok(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: ana }, 'auto'));
    ok(await store.undo(change.id, 'jj@x.test'));
    const again = await store.undo(change.id, 'jj@x.test');
    expect(!again.ok && again.refusal).toEqual({ reason: 'wrong-state', state: 'undone' });
    expect((await store.list({ state: 'undone' })).changes.map((c) => c.id)).toEqual([change.id]);
  });
});

describe('github auth', () => {
  it('uses a token, or says what is missing', async () => {
    const token = resolveGitAuth({ GITHUB_TOKEN: ' t0 ' });
    expect(token.ok && token.kind).toBe('token');
    expect(token.ok && (await token.token())).toBe('t0');
    expect(resolveGitAuth({})).toMatchObject({ ok: false });
    const partial = resolveGitAuth({ GITHUB_APP_ID: '1' });
    expect(!partial.ok && partial.message).toContain('GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID');
  });

  it('prefers the App when all three settings are there, and caches its token', async () => {
    const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
    const calls: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ token: 'inst-token', expires_at: '2026-11-15T11:00:00Z' }), { status: 201 });
    }) as unknown as typeof fetch;
    const auth = resolveGitAuth({ GITHUB_APP_ID: '12', GITHUB_APP_PRIVATE_KEY: pem, GITHUB_APP_INSTALLATION_ID: '34', GITHUB_TOKEN: 'ignored' }, fetcher, () => new Date('2026-11-15T10:00:00Z'));
    expect(auth.ok && auth.kind).toBe('app');
    expect(auth.ok && (await auth.token())).toBe('inst-token');
    expect(auth.ok && (await auth.token())).toBe('inst-token');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.github.com/app/installations/34/access_tokens');
    expect(calls[0]?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe('githubRepo', () => {
  it('writes files and deletions in one tree, to a new branch, and merges at the tested commit', async () => {
    const seen: { method: string; path: string; body: unknown }[] = [];
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const fetcher = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace('/repos/o/r', '');
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      seen.push({ method: init.method ?? 'GET', path, body });
      if (path.startsWith('/git/commits/p1')) return respond(200, { tree: { sha: 't0' } });
      if (path === '/git/trees') return respond(201, { sha: 't1' });
      if (path === '/git/commits') return respond(201, { sha: 'n1' });
      if (path === '/git/refs') return respond(201, {});
      if (path === '/pulls/7/merge') return respond(409, {});
      return respond(404, {});
    }) as unknown as typeof fetch;
    const repo = githubRepo('o/r', async () => 'tok', fetcher);
    const sha = await repo.commit({ branch: 'content-edit/x/2026-11-15', expected: null, parent: 'p1', files: { 'content/a.json': '{}\n', 'content/b.json': null }, message: 'm' });
    expect(sha).toBe('n1');
    expect(seen.find((s) => s.path === '/git/trees')?.body).toEqual({
      base_tree: 't0',
      tree: [
        { path: 'content/a.json', mode: '100644', type: 'blob', content: '{}\n' },
        { path: 'content/b.json', mode: '100644', type: 'blob', sha: null },
      ],
    });
    expect(await repo.merge(7, 'tested')).toMatchObject({ ok: false });
    expect(seen.find((s) => s.path === '/pulls/7/merge')?.body).toEqual({ sha: 'tested', merge_method: 'squash' });
  });
});
