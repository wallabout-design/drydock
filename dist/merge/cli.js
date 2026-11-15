/// <reference types="node" />
// Run by the reusable workflow .github/workflows/content-merge.yml when a
// site's tests finish on a content-edit branch. It reads the pull request
// through the GitHub API (it never checks out or runs the branch's code),
// decides with decide.ts against the site's declaration (loaded from the
// site's own default branch), then either squash-merges the exact commit that
// was tested or labels the pull request `status:needs-human-review` and says
// why on it. In `review` mode it does nothing.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decide } from './decide.js';
export const LABEL = 'status:needs-human-review';
const realGh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/**
 * Leaves a pull request for a person: labels it and says why on it.
 */
export function flag(repository, number, reasons, gh = realGh) {
    const api = (path, ...more) => gh(['api', `repos/${repository}/${path}`, ...more]);
    api(`issues/${number}/labels`, '-X', 'POST', '-f', `labels[]=${LABEL}`);
    const body = [
        'This pull request was not merged automatically. A person needs to look:',
        '',
        ...reasons.map((reason) => `- ${reason}`),
        '',
        'Content-edit pull requests merge themselves only when the tests pass and nothing but valid content files changed.',
    ].join('\n');
    api(`issues/${number}/comments`, '-X', 'POST', '-f', `body=${body}`);
    return `needs-review #${number}: ${reasons.join('; ')}`;
}
/** @returns what was done, for the log */
export async function check(run, content, config, gh = realGh) {
    const { repository, headSha, headBranch } = run;
    if (run.mode !== 'auto')
        return `ignored: mode is ${run.mode}, not auto`;
    if (!headBranch.startsWith(config.branchPrefix))
        return 'ignored: not a content-edit branch';
    const api = (path, ...more) => gh(['api', `repos/${repository}/${path}`, ...more]);
    const owner = repository.split('/')[0];
    const pulls = JSON.parse(api(`pulls?state=open&head=${owner}:${encodeURIComponent(headBranch)}&per_page=100`));
    // Only the commit the tests ran on. If the branch has moved, its own run will come.
    const pull = pulls.find((p) => p.head.sha === headSha);
    if (!pull)
        return `ignored: no open pull request for ${headBranch} at ${headSha}`;
    const files = JSON.parse(api(`pulls/${pull.number}/files?per_page=100`, '--paginate', '--slurp')).flat();
    const reasons = [];
    if (files.length >= 3000)
        reasons.push('it changes 3000 files or more, more than GitHub lists');
    // The changed files as they are at the tip, read from the API, never from a checkout.
    const headFiles = {};
    for (const { filename, status } of files) {
        if (status === 'removed' || !filename.startsWith('content/'))
            continue;
        try {
            headFiles[filename] = api(`contents/${filename.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`, '-H', 'Accept: application/vnd.github.raw+json');
        }
        catch {
            headFiles[filename] = null;
        }
    }
    const tree = JSON.parse(api(`git/trees/${headSha}?recursive=1`));
    if (tree.truncated)
        reasons.push('the repository is too big to count the items of its lists');
    const itemCounts = {};
    for (const { path, type } of tree.tree) {
        const found = type === 'blob' ? /^content\/([^/]+)\/[^/]+\.json$/.exec(path) : null;
        if (found)
            itemCounts[found[1]] = (itemCounts[found[1]] ?? 0) + 1;
    }
    const runs = JSON.parse(api(`commits/${headSha}/check-runs?per_page=100`)).check_runs.filter((r) => r.name === run.testCheck);
    const conclusion = runs.length === 0 ? 'the check did not run' : (runs.find((r) => r.status !== 'completed' || r.conclusion !== 'success') ?? runs[0]);
    const tested = typeof conclusion === 'string' ? conclusion : conclusion.status !== 'completed' ? 'still running' : (conclusion.conclusion ?? 'unknown');
    const verdict = decide({
        headBranch: pull.head.ref,
        headRepository: pull.head.repo?.full_name ?? '',
        repository,
        baseBranch: pull.base.ref,
        files,
        headFiles,
        itemCounts,
        conclusion: tested,
    }, content, config);
    if (verdict.action === 'ignore')
        return 'ignored: not a content-edit branch';
    if (verdict.action === 'needs-review' || reasons.length > 0) {
        return flag(repository, pull.number, [...reasons, ...(verdict.action === 'needs-review' ? verdict.reasons : [])], gh);
    }
    try {
        // `sha` makes GitHub refuse if the branch moved after it was checked.
        api(`pulls/${pull.number}/merge`, '-X', 'PUT', '-f', 'merge_method=squash', '-f', `sha=${headSha}`);
    }
    catch (error) {
        return flag(repository, pull.number, [`GitHub would not merge it: ${String(error?.message ?? error).split('\n')[0]}`], gh);
    }
    return `merged #${pull.number}: ${verdict.changed.join(', ')}`;
}
/** Loads the site's declaration: the module's `content` export (or its default), as `defineContent` returned it. */
export async function loadDeclaration(path) {
    const module = (await import(pathToFileURL(resolve(path)).href));
    const content = module.content ?? module.default;
    if (!content || typeof content.validateText !== 'function' || typeof content.validateItem !== 'function') {
        throw new Error(`${path} must export the result of defineContent as \`content\``);
    }
    return content;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const { REPOSITORY, HEAD_SHA, HEAD_BRANCH, MODE, DECLARATION, BASE_BRANCH, BRANCH_PREFIX, TEST_CHECK } = process.env;
    if (!REPOSITORY || !HEAD_SHA || !HEAD_BRANCH || !MODE || !DECLARATION || !BASE_BRANCH || !BRANCH_PREFIX || !TEST_CHECK) {
        console.error('REPOSITORY, HEAD_SHA, HEAD_BRANCH, MODE, DECLARATION, BASE_BRANCH, BRANCH_PREFIX and TEST_CHECK must be set');
        process.exit(1);
    }
    const content = await loadDeclaration(DECLARATION);
    console.log(await check({ repository: REPOSITORY, headSha: HEAD_SHA, headBranch: HEAD_BRANCH, mode: MODE, testCheck: TEST_CHECK }, content, { base: BASE_BRANCH, branchPrefix: BRANCH_PREFIX }));
}
