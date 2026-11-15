// Whether a content-edit pull request may merge itself (src/merge/decide.ts,
// src/merge/cli.ts), with a fake GitHub CLI. No network. The workflow that
// runs the script (.github/workflows/content-merge.yml) is checked for the
// properties the design depends on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineContent } from '../src/index.js';
import { renderContentFiles } from '../src/server/index.js';
import { decide, type PullFacts } from '../src/merge/decide.js';
import { check, flag, LABEL, loadDeclaration, type Run } from '../src/merge/cli.js';

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
      maxItems: 3,
    },
    {
      name: 'news',
      label: 'news',
      singular: 'story',
      titleField: 'title',
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
      sort: { by: 'title' },
    },
  ],
  rules: [{ name: 'no-street', test: (text) => !/elm street/i.test(text), message: 'Please leave the street out.' }],
});

const config = { base: 'main', branchPrefix: 'content-edit/' };
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const texts = json({ 'home.title': 'Hi there' });
const room = json({ position: 1000, title: 'Blue room', beds: 2 });

const good: PullFacts = {
  headBranch: 'content-edit/ada-example-org-cfe00dde/2026-11-10',
  headRepository: 'acme/site',
  repository: 'acme/site',
  baseBranch: 'main',
  files: [
    { filename: 'content/texts.json', status: 'modified' },
    { filename: 'content/rooms/blue.json', status: 'added' },
  ],
  headFiles: { 'content/texts.json': texts, 'content/rooms/blue.json': room },
  itemCounts: { rooms: 1 },
  conclusion: 'success',
};

const one = (filename: string, status: string, text: string | null, over: Partial<PullFacts> = {}): PullFacts => ({
  ...good,
  files: [{ filename, status }],
  headFiles: { [filename]: text },
  ...over,
});

describe('the decision', () => {
  it('only content files changed, valid, tests passed: merge', () => {
    expect(decide(good, content, config)).toEqual({ action: 'merge', changed: ['content/texts.json', 'content/rooms/blue.json'] });
  });

  it('files the editor itself renders are accepted', () => {
    const { files } = renderContentFiles(content, { texts: { 'home.title': 'Hi', 'home.intro': 'Welcome' }, lists: { rooms: [{ id: 'a', values: { title: 'A', beds: 3 } }], news: [] } });
    for (const [path, text] of Object.entries(files)) expect(decide(one(path, 'added', text), content, config).action).toBe('merge');
  });

  it('a removed item or texts file is allowed', () => {
    expect(decide(one('content/rooms/blue.json', 'removed', null, { itemCounts: { rooms: 0 } }), content, config).action).toBe('merge');
    expect(decide(one('content/texts.json', 'removed', null), content, config).action).toBe('merge');
  });

  it('other branches are none of its business', () => {
    expect(decide({ ...good, headBranch: 'feat/content-edit/x' }, content, config)).toEqual({ action: 'ignore' });
    expect(decide({ ...good, headBranch: 'content-editor' }, content, config)).toEqual({ action: 'ignore' });
  });

  const text = (value: unknown) => one('content/texts.json', 'modified', json(value));
  const item = (value: unknown, list = 'rooms') => one(`content/${list}/x.json`, 'added', json(value));
  const cases: [string, PullFacts, RegExp][] = [
    ['another file changed too', { ...good, files: [...good.files, { filename: 'worker/index.ts', status: 'modified' }] }, /outside `content\/`: `worker\/index.ts`/],
    ['a workflow changed', { ...good, files: [...good.files, { filename: '.github/workflows/ci.yml', status: 'modified' }] }, /outside `content\/`/],
    ['the declaration changed', { ...good, files: [...good.files, { filename: 'src/content.ts', status: 'modified' }] }, /outside `content\/`/],
    ['a path that climbs out of content', one('content/../package.json', 'modified', '{}'), /outside `content\/`/],
    ['no files', { ...good, files: [] }, /changes no files/],
    ['a file renamed', one('content/rooms/blue.json', 'renamed', room), /was renamed, not edited/],
    ['an undeclared file', one('content/notes.json', 'added', '{}'), /not a texts file or an item/],
    ['an undeclared list', one('content/pets/a.json', 'added', '{"title":"x"}'), /not a texts file or an item/],
    ['a file that is not json', one('content/rooms/a.txt', 'added', 'hi'), /not a texts file or an item/],
    ['a fork', { ...good, headRepository: 'mallory/site' }, /another repository/],
    ['another base branch', { ...good, baseBranch: 'release' }, /merges into `release`/],
    ['a key not declared', text({ 'home.new': 'x' }), /key `home.new`, which the site does not declare/],
    ['markup in a text', text({ 'home.title': '<img src=x onerror=alert(1)>' }), /fails the rules/],
    ['a text past its limit', text({ 'home.title': 'x'.repeat(31) }), /too long/],
    ['a text breaking a site rule', text({ 'home.title': 'Visit Elm Street' }), /leave the street out/],
    ['a text that is not text', text({ 'home.title': 5 }), /must be text/],
    ['a text that needs cleaning', text({ 'home.title': 'Hi​ there' }), /not in its cleaned form/],
    ['a texts file that is not an object', one('content/texts.json', 'modified', '[1]'), /not a JSON object/],
    ['a texts file that is not json', one('content/texts.json', 'modified', '{'), /not a JSON object/],
    ['a texts file that could not be read', one('content/texts.json', 'modified', null), /could not be read/],
    ['an item with an undeclared field', item({ position: 1, title: 'A', secret: 'x' }), /fails the rules/],
    ['an item without its title', item({ position: 1, beds: 2 }), /fails the rules.*needed/],
    ['an item with a number out of range', item({ position: 1, title: 'A', beds: 99 }), /fails the rules/],
    ['an item breaking a site rule', item({ position: 1, title: 'Elm Street' }), /leave the street out/],
    ['an item with a bad position', item({ position: 0, title: 'A' }), /position that is not a whole number/],
    ['a position on a list sorted by a field', item({ position: 1, title: 'A' }, 'news'), /not sorted by hand/],
    ['an item that needs cleaning', item({ position: 1, title: 'A​' }), /not in its cleaned form/],
    ['an item that is not an object', one('content/rooms/x.json', 'added', '"x"'), /not a JSON object/],
    ['a list past its maximum', { ...good, itemCounts: { rooms: 4 } }, /would have 4 items; the most is 3/],
    ['failed tests', { ...good, conclusion: 'failure' }, /the tests did not pass \(failure\)/],
    ['cancelled tests', { ...good, conclusion: 'cancelled' }, /did not pass \(cancelled\)/],
    ['tests that never ran', { ...good, conclusion: 'the check did not run' }, /did not pass/],
  ];
  for (const [what, facts, reason] of cases) {
    it(`${what}: left for a person`, () => {
      const verdict = decide(facts, content, config);
      expect(verdict.action).toBe('needs-review');
      expect((verdict as { reasons: string[] }).reasons.join('\n')).toMatch(reason);
    });
  }

  it('failed tests are the only reason given when nothing else is wrong, and are not hidden by others', () => {
    expect((decide({ ...good, conclusion: 'failure' }, content, config) as { reasons: string[] }).reasons).toHaveLength(1);
    expect((decide({ ...good, baseBranch: 'x', conclusion: 'failure' }, content, config) as { reasons: string[] }).reasons).toHaveLength(1);
  });

  it('many stray files are counted, not all listed', () => {
    const files = [...good.files, ...Array.from({ length: 8 }, (_, i) => ({ filename: `src/f${i}.ts`, status: 'modified' }))];
    const verdict = decide({ ...good, files }, content, config) as { reasons: string[] };
    expect(verdict.reasons[0]).toContain('and 3 more');
  });
});

describe('the script', () => {
  const run: Run = { repository: 'acme/site', headSha: 'head1', headBranch: good.headBranch, mode: 'auto', testCheck: 'test' };
  const pull = { number: 7, head: { ref: run.headBranch, sha: 'head1', repo: { full_name: 'acme/site' } }, base: { ref: 'main' } };
  const checks = (...conclusions: (string | null)[]) => ({
    check_runs: conclusions.map((conclusion) => ({ name: 'test', status: conclusion === null ? 'in_progress' : 'completed', conclusion })),
  });

  // A fake `gh`: answers `gh api <path> …` from a table and records every call.
  function github(over: Record<string, unknown> = {}) {
    const answers: Record<string, unknown> = {
      'repos/acme/site/pulls?state=open&head=acme:content-edit%2Fada-example-org-cfe00dde%2F2026-11-10&per_page=100': [pull],
      'repos/acme/site/pulls/7/files?per_page=100': [[
        { filename: 'content/texts.json', status: 'modified' },
        { filename: 'content/rooms/blue.json', status: 'added' },
      ]],
      'repos/acme/site/contents/content/texts.json?ref=head1': texts,
      'repos/acme/site/contents/content/rooms/blue.json?ref=head1': room,
      'repos/acme/site/git/trees/head1?recursive=1': { tree: [{ path: 'content/rooms/blue.json', type: 'blob' }, { path: 'content/texts.json', type: 'blob' }, { path: 'src/a.ts', type: 'blob' }] },
      'repos/acme/site/commits/head1/check-runs?per_page=100': checks('success'),
      'repos/acme/site/pulls/7/merge': { merged: true },
      'repos/acme/site/issues/7/labels': [],
      'repos/acme/site/issues/7/comments': {},
      ...over,
    };
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      const answer = answers[args[1] as string];
      if (answer === undefined || answer instanceof Error) throw answer ?? new Error(`HTTP 404: ${args[1]}`);
      return typeof answer === 'string' ? answer : JSON.stringify(answer);
    };
    const writes = () => calls.filter((args) => args.includes('-X'));
    return { gh, calls, writes };
  }

  it('a clean content edit is squash-merged at the commit that was tested', async () => {
    const { gh, writes } = github();
    expect(await check(run, content, config, gh)).toBe('merged #7: content/texts.json, content/rooms/blue.json');
    expect(writes()).toEqual([['api', 'repos/acme/site/pulls/7/merge', '-X', 'PUT', '-f', 'merge_method=squash', '-f', 'sha=head1']]);
  });

  it('review mode does nothing, and asks GitHub nothing', async () => {
    const { gh, calls } = github();
    expect(await check({ ...run, mode: 'review' }, content, config, gh)).toBe('ignored: mode is review, not auto');
    expect(calls).toEqual([]);
  });

  it('a branch that also changes code is labelled and explained, never merged', async () => {
    const { gh, writes } = github({
      'repos/acme/site/pulls/7/files?per_page=100': [[{ filename: 'content/texts.json', status: 'modified' }, { filename: 'worker/index.ts', status: 'modified' }]],
    });
    expect(await check(run, content, config, gh)).toMatch(/^needs-review #7: it changes files outside `content\/`/);
    expect(writes().map((args) => args[1])).toEqual(['repos/acme/site/issues/7/labels', 'repos/acme/site/issues/7/comments']);
    expect(writes()[0]).toEqual(['api', 'repos/acme/site/issues/7/labels', '-X', 'POST', '-f', 'labels[]=status:needs-human-review']);
    const comment = (writes()[1] as string[]).at(-1) as string;
    expect(comment).toContain('was not merged automatically');
    expect(comment).toContain('- it changes files outside `content/`: `worker/index.ts`');
  });

  it('a value that fails the rules again is not merged', async () => {
    const { gh, writes } = github({ 'repos/acme/site/contents/content/texts.json?ref=head1': json({ 'home.title': 'Elm Street' }) });
    expect(await check(run, content, config, gh)).toMatch(/leave the street out/);
    expect(writes().some((args) => (args[1] as string).endsWith('/merge'))).toBe(false);
  });

  it('a list over its maximum, counted from the tip, is not merged', async () => {
    const tree = ['a', 'b', 'c', 'd'].map((id) => ({ path: `content/rooms/${id}.json`, type: 'blob' }));
    const { gh } = github({ 'repos/acme/site/git/trees/head1?recursive=1': { tree } });
    expect(await check(run, content, config, gh)).toMatch(/would have 4 items/);
  });

  it('failed tests: labelled, not merged', async () => {
    const { gh, writes } = github({ 'repos/acme/site/commits/head1/check-runs?per_page=100': checks('failure') });
    expect(await check(run, content, config, gh)).toBe('needs-review #7: the tests did not pass (failure)');
    expect(writes().some((args) => (args[1] as string).endsWith('/merge'))).toBe(false);
  });

  it('a test that has not finished, or never ran, is not a pass', async () => {
    expect(await check(run, content, config, github({ 'repos/acme/site/commits/head1/check-runs?per_page=100': checks(null) }).gh)).toContain('still running');
    expect(await check(run, content, config, github({ 'repos/acme/site/commits/head1/check-runs?per_page=100': { check_runs: [] } }).gh)).toContain('the check did not run');
  });

  it('every run of the test check must have passed', async () => {
    const { gh } = github({ 'repos/acme/site/commits/head1/check-runs?per_page=100': checks('success', 'failure') });
    expect(await check(run, content, config, gh)).toContain('did not pass (failure)');
  });

  it('the branch moved after the tests ran: nothing is done', async () => {
    const { gh, writes } = github();
    expect(await check({ ...run, headSha: 'older' }, content, config, gh)).toBe(`ignored: no open pull request for ${run.headBranch} at older`);
    expect(writes()).toEqual([]);
  });

  it('another branch: nothing is asked of GitHub at all', async () => {
    const { gh, calls } = github();
    expect(await check({ ...run, headBranch: 'feat/x' }, content, config, gh)).toBe('ignored: not a content-edit branch');
    expect(calls).toEqual([]);
  });

  it('files are read at the tested commit through the API', async () => {
    const { gh, calls } = github();
    await check(run, content, config, gh);
    const reads = calls.map((args) => args[1] as string).filter((path) => path.includes('/contents/'));
    expect(reads).toEqual(['repos/acme/site/contents/content/texts.json?ref=head1', 'repos/acme/site/contents/content/rooms/blue.json?ref=head1']);
  });

  it('GitHub refusing the merge (a conflict, a moved branch) leaves it for a person', async () => {
    const { gh, writes } = github({ 'repos/acme/site/pulls/7/merge': new Error('HTTP 409: Head branch was modified\nmore') });
    expect(await check(run, content, config, gh)).toBe('needs-review #7: GitHub would not merge it: HTTP 409: Head branch was modified');
    expect(writes().map((args) => args[1])).toEqual(['repos/acme/site/pulls/7/merge', 'repos/acme/site/issues/7/labels', 'repos/acme/site/issues/7/comments']);
  });

  it('flag labels with the shared review label', () => {
    const { gh, writes } = github();
    flag('acme/site', 7, ['why'], gh);
    expect(writes()[0]).toContain(`labels[]=${LABEL}`);
    expect(LABEL).toBe('status:needs-human-review');
  });

  it('loads a declaration that exports `content`, or a default', async () => {
    const dir = new URL('./fixtures/', import.meta.url);
    expect((await loadDeclaration(new URL('merge-declaration.ts', dir).pathname)).validateText('home.title', 'Hi').ok).toBe(true);
    await expect(loadDeclaration(new URL('merge-not-a-declaration.ts', dir).pathname)).rejects.toThrow(/must export/);
  });
});

describe('the workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/content-merge.yml', import.meta.url), 'utf8');

  it('is reusable, and never triggered by a pull request', () => {
    expect(workflow).toMatch(/^on:\n  workflow_call:/m);
    expect(workflow).not.toMatch(/^\s+pull_request/m);
    expect(workflow).not.toMatch(/^\s+push:/m);
  });

  it('does nothing unless the mode is auto, and for this repository’s content-edit branches only', () => {
    const block = workflow.match(/^    if: >-\n((?:      .*\n)+)/m);
    expect(block, 'the merge job has a folded `if: >-` block').not.toBeNull();
    const condition = (block as RegExpMatchArray)[1]!.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    expect(condition).toBe(
      "inputs.mode == 'auto' && (github.event_name == 'workflow_dispatch' || " +
        "(github.event.workflow_run.event == 'pull_request' && " +
        'startsWith(github.event.workflow_run.head_branch, inputs.branch-prefix) && ' +
        'github.event.workflow_run.head_repository.full_name == github.repository))',
    );
  });

  it('never checks out the branch, and passes its name only through the environment', () => {
    const refs = workflow.split('\n').filter((line) => /^\s+ref:/.test(line));
    expect(refs).toEqual(['          ref: ${{ inputs.base-branch || github.event.repository.default_branch }}']);
    for (const line of workflow.split('\n').filter((l) => /^\s+- run:|^\s+run:/.test(l))) expect(line).not.toContain('${{');
  });
});
