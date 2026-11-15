// The git store: content lives in files under `content/` in the site's
// repository, and a change is a pull request that changes only those files
// (content-editing.md, "the two stores").
//
// An editor's branch is always "the base branch as it is now, plus one commit".
// Each save rebuilds it: the operations already waiting in the editor's open
// pull request are carried over (those the base branch has not overtaken), the
// new ones are added, the files are made from the result, and the branch is
// moved to the new commit. So one editing session is one pull request, it never
// falls behind, and its diff is only ever content files.
//
// Only a branch a save made for this exact editor is ever moved: its name
// carries a hash of their email, and its tip must still be one save's commit
// on the base branch. Anything else (another person's work, a fix-up pushed on
// top) is left alone, and the editor gets a new branch instead.
//
// What happens after the pull request opens depends on the mode:
//
// - `auto`: the merge workflow merges it once the tests pass. Until then the
//   change is `waiting`; the store reports `live` as soon as it sees the merge.
// - `review`: it carries the review label; `approve` merges it through the API
//   at the commit that was tested, `reject` closes it.
//
// A change's id is its pull request's number.
import { applyOperations } from '../../core/change.js';
import { CONTENT_DIR, fileChanges, isContentPath, loadContentFiles, renderContentFiles } from './files.js';
import { commitMessage, composeOps, DEFAULT_CONFIG, editorStem, normalizeOps, pullText, readCommitMessage, SAVE_ATTEMPTS, SAVE_BRANCH, UNDO_BRANCH, } from './save.js';
/** The most files read at once, to stay inside a Worker's connection limits. */
const READ_AT_ONCE = 6;
export function gitStore(options) {
    const { repo, content } = options;
    const config = { ...DEFAULT_CONFIG, ...options.config };
    const now = options.now ?? (() => new Date());
    const refuse = (refusal) => ({ ok: false, refusal });
    const invalid = (message) => refuse({ reason: 'invalid', message });
    const refusalOf = (applied, current) => refuse(applied.reason === 'stale' ? { reason: 'stale', index: applied.index, current } : { reason: 'invalid', message: applied.message });
    async function loadAt(commit) {
        const paths = (await repo.files(commit, CONTENT_DIR)).filter((path) => path.endsWith('.json') && isContentPath(path));
        const files = {};
        for (let i = 0; i < paths.length; i += READ_AT_ONCE) {
            const batch = paths.slice(i, i + READ_AT_ONCE);
            const texts = await Promise.all(batch.map((path) => repo.read(path, commit)));
            batch.forEach((path, k) => {
                if (typeof texts[k] === 'string')
                    files[path] = texts[k];
            });
        }
        const loaded = loadContentFiles(content, files);
        return { ...loaded, rendered: renderContentFiles(content, loaded.state, loaded.positions) };
    }
    async function baseTip() {
        const tip = await repo.tip(config.base);
        if (tip === null)
            throw new Error(`branch ${config.base} not found`);
        return tip;
    }
    /**
     * What a save's commit says, when `head` is exactly what a save leaves: one
     * commit with one parent, changing content files and nothing else, with its
     * operations in the message. A merge, a fix-up commit or any other file means a
     * person has worked on the branch. With `inBase`, its parent must also be in
     * the base branch's history (so a rebuild can replace it).
     */
    async function savedAt(head, inBase) {
        try {
            const facts = await repo.commitFacts(head);
            if (!facts || facts.parents.length !== 1 || facts.files.length === 0 || !facts.files.every(isContentPath))
                return null;
            const saved = readCommitMessage(facts.message);
            if (!saved)
                return null;
            if (inBase && !(await repo.contains(config.base, facts.parents[0])))
                return null;
            return { saved, date: facts.date };
        }
        catch {
            return null;
        }
    }
    const ours = (pull) => pull.branch.startsWith(config.branchPrefix);
    /** The editor's own open pull request, newest first, whose branch is still just a save's commit. */
    async function ownPull(stem) {
        const candidates = (await repo.pulls(config.base, 'open'))
            .filter((p) => p.branch.startsWith(stem) && SAVE_BRANCH.test(p.branch.slice(stem.length)))
            .sort((a, b) => b.number - a.number);
        for (const pull of candidates) {
            const tip = await repo.tip(pull.branch);
            const found = tip ? await savedAt(tip, true) : null;
            if (tip && found)
                return { pull, tip, saved: found.saved };
        }
        return null;
    }
    /**
     * A branch for a save with no open pull request to add to: "<stem><name>", or
     * "-2", "-3"… after it when that name holds someone's work. A name that is
     * free, or holds only an earlier save's commit (a closed pull request's
     * leftover), is used, from the tip it has.
     */
    async function newBranch(stem, name) {
        for (let n = 1; n <= 20; n++) {
            const branch = `${stem}${name}${n === 1 ? '' : `-${n}`}`;
            const tip = await repo.tip(branch);
            if (tip === null || (await savedAt(tip, true)) !== null)
                return { branch, expected: tip };
        }
        throw new Error(`no free branch name after ${stem}${name}`);
    }
    /** The operations that still apply to `state`, in order; one that no longer does is dropped. */
    function stillApplying(state, ops) {
        let kept = ops;
        for (;;) {
            if (kept.length === 0)
                return kept;
            const applied = applyOperations(state, kept);
            if (applied.ok)
                return kept;
            kept = applied.reason === 'stale' ? kept.filter((_, i) => i !== applied.index) : [];
        }
    }
    const changeOf = (pull, found, state) => ({
        id: String(pull.number),
        ops: found.saved.ops,
        by: found.saved.editor,
        at: found.date ?? pull.createdAt,
        state,
        ...(found.saved.undoes === undefined ? {} : { undoes: found.saved.undoes }),
        ...(state === 'live' || state === 'undone' ? { reverse: found.saved.reverse } : {}),
    });
    /** What a pull request is, as a change: not-found when it is not one of ours. */
    async function ourChange(id) {
        if (!/^\d{1,9}$/.test(id))
            return null;
        const pull = await repo.pull(Number(id));
        if (!pull || !ours(pull))
            return null;
        const found = await savedAt(pull.head, false);
        return found ? { pull, found } : null;
    }
    const stateOf = (pull) => (pull.state === 'open' ? 'waiting' : pull.state === 'merged' ? 'live' : 'rejected');
    // ---- submit ----
    async function attempt(input, ops, mode) {
        const tip = await baseTip();
        const base = await loadAt(tip);
        const stem = await editorStem(config.branchPrefix, input.by);
        const own = await ownPull(stem);
        // What the editor sees is the base branch plus their own waiting operations.
        const waiting = own ? stillApplying(base.state, own.saved.ops) : [];
        const view = waiting.length > 0 ? applyOperations(base.state, waiting).state : base.state;
        if (own && waiting.length === 0)
            await repo.closePull(own.pull.number); // everything in it was overtaken
        const applied = applyOperations(view, ops);
        if (!applied.ok)
            return refusalOf(applied, view);
        const combined = composeOps(waiting, ops);
        if (combined === null)
            return invalid('That item already has a change of yours waiting. Wait for it to go live, then change it again.');
        if (combined.length === 0) {
            // Everything is put back as it was: nothing is left to save.
            if (own && waiting.length > 0) {
                await repo.closePull(own.pull.number);
                const found = await savedAt(own.tip, false);
                if (found)
                    return { ok: true, change: { ...changeOf(own.pull, found, 'rejected'), decidedBy: input.by, decidedAt: now().toISOString() } };
            }
            return invalid('That puts everything back as it was, so there is nothing to save.');
        }
        const final = applyOperations(base.state, combined);
        if (!final.ok)
            return invalid('That can’t be combined with your changes that are waiting. Wait for them to go live, then try again.');
        const tooMany = [...content.lists].find(([name, list]) => (final.state.lists[name]?.length ?? 0) > list.maxItems);
        if (tooMany)
            return invalid(`The ${tooMany[1].label} list can hold at most ${tooMany[1].maxItems} items.`);
        const files = fileChanges(base.rendered, renderContentFiles(content, final.state, base.rendered.positions));
        if (Object.keys(files).length === 0)
            return invalid('That changes nothing.');
        const reuse = own && waiting.length > 0 ? own : null;
        const target = reuse ? { branch: reuse.pull.branch, expected: reuse.tip } : await newBranch(stem, now().toISOString().slice(0, 10));
        const sha = await repo.commit({
            branch: target.branch,
            expected: target.expected,
            parent: tip,
            files,
            message: commitMessage({ editor: input.by, ops: combined, reverse: final.reverse }),
        });
        if (sha === null)
            return 'moved';
        const text = pullText(config, input.by, combined, mode === 'review');
        let pull = null;
        if (reuse) {
            const labelled = reuse.pull.labels.includes(config.reviewLabel);
            if (mode === 'review' && !labelled)
                await repo.addLabel(reuse.pull.number, config.reviewLabel);
            if (mode === 'auto' && labelled)
                await repo.removeLabel(reuse.pull.number, config.reviewLabel);
            if (await repo.updatePull(reuse.pull.number, text))
                pull = reuse.pull;
        }
        pull ??= await repo.createPull({ branch: target.branch, base: config.base, ...text, labels: mode === 'review' ? [config.reviewLabel] : [] });
        if (!pull)
            return 'moved'; // another save opened the pull request first: start again, so both end up there
        const merged = (await repo.pull(pull.number))?.state === 'merged';
        if (!merged) {
            // Another save moved the branch after this one did: start again.
            if ((await repo.tip(target.branch)) !== sha)
                return 'moved';
            // The base branch may have moved on while this ran. If the change no longer applies, it is stale.
            const tip2 = await repo.tip(config.base);
            if (tip2 !== null && tip2 !== tip && !applyOperations((await loadAt(tip2)).state, combined).ok)
                return 'moved';
        }
        const found = { saved: { editor: input.by, ops: combined, reverse: final.reverse }, date: now().toISOString() };
        return { ok: true, change: changeOf(pull, found, merged ? 'live' : 'waiting') };
    }
    async function submit(input, mode) {
        const normalized = normalizeOps(content, input.ops);
        if (!normalized.ok)
            return invalid(normalized.message);
        for (let n = 0; n < SAVE_ATTEMPTS; n++) {
            const result = await attempt(input, normalized.ops, mode);
            if (result !== 'moved')
                return result;
        }
        return invalid('The site is busy saving other changes. Please try again in a moment.');
    }
    // ---- approve, reject ----
    /** A pull request that is one of ours and still open, or the refusal to give. */
    async function openChange(id) {
        const found = await ourChange(id);
        if (!found)
            return refuse({ reason: 'not-found' });
        if (found.pull.state !== 'open')
            return refuse({ reason: 'wrong-state', state: stateOf(found.pull) });
        return found;
    }
    const isOutcome = (x) => typeof x === 'object' && x !== null && 'ok' in x;
    async function approve(id, by) {
        const open = await openChange(id);
        if (isOutcome(open))
            return open;
        const { pull, found } = open;
        const base = await loadAt(await baseTip());
        const applied = applyOperations(base.state, found.saved.ops);
        if (!applied.ok)
            return refusalOf(applied, base.state); // it stays waiting: reject it, or see what moved on
        const runs = await repo.checks(pull.head);
        const run = runs.find((r) => r.name === config.requiredCheck);
        if (!run || run.status !== 'completed')
            return invalid('The tests are still running on this change. Try again in a few minutes.');
        if (run.conclusion !== 'success')
            return invalid('The tests did not pass on this change, so it can’t go live. It needs a developer.');
        // At the commit that was tested: if the branch has moved since, GitHub refuses.
        const merged = await repo.merge(pull.number, pull.head);
        if (!merged.ok)
            return invalid(merged.message);
        return { ok: true, change: { ...changeOf(pull, found, 'live'), decidedBy: by, decidedAt: now().toISOString() } };
    }
    async function reject(id, by) {
        const open = await openChange(id);
        if (isOutcome(open))
            return open;
        await repo.closePull(open.pull.number);
        return { ok: true, change: { ...changeOf(open.pull, open.found, 'rejected'), decidedBy: by, decidedAt: now().toISOString() } };
    }
    // ---- undo ----
    /** The pull requests of ours, newest first. */
    const allOurs = async () => (await repo.pulls(config.base, 'all')).filter(ours).sort((a, b) => b.number - a.number);
    async function undo(id, by) {
        const original = await ourChange(id);
        if (!original)
            return refuse({ reason: 'not-found' });
        if (original.pull.state !== 'merged')
            return refuse({ reason: 'wrong-state', state: stateOf(original.pull) });
        const pulls = await allOurs();
        const undoing = pulls.filter((p) => UNDO_BRANCH.exec(p.branch)?.[1] === id && p.state !== 'closed');
        if (undoing.some((p) => p.state === 'merged'))
            return refuse({ reason: 'wrong-state', state: 'undone' });
        if (undoing.length > 0)
            return refuse({ reason: 'wrong-state', state: 'live' });
        const tip = await baseTip();
        const base = await loadAt(tip);
        const applied = applyOperations(base.state, original.found.saved.reverse);
        if (!applied.ok)
            return refusalOf(applied, base.state);
        const files = fileChanges(base.rendered, renderContentFiles(content, applied.state, base.rendered.positions));
        if (Object.keys(files).length === 0)
            return invalid('That changes nothing.');
        const mode = config.undoMode;
        const ops = original.found.saved.reverse;
        const stem = await editorStem(config.branchPrefix, by);
        const target = await newBranch(stem, `undo-${id}`);
        const saved = { editor: by, ops, reverse: applied.reverse, undoes: id };
        const sha = await repo.commit({ branch: target.branch, expected: target.expected, parent: tip, files, message: commitMessage(saved) });
        if (sha === null)
            return invalid('The site is busy saving other changes. Please try again in a moment.');
        const pull = await repo.createPull({
            branch: target.branch,
            base: config.base,
            ...pullText(config, by, ops, mode === 'review', id),
            labels: mode === 'review' ? [config.reviewLabel] : [],
        });
        if (!pull)
            return invalid('That change is already being undone.');
        const merged = (await repo.pull(pull.number))?.state === 'merged';
        return { ok: true, change: changeOf(pull, { saved, date: now().toISOString() }, merged ? 'live' : 'waiting') };
    }
    // ---- list ----
    async function list(query = {}) {
        const limit = query.limit ?? 20;
        const pulls = await allOurs();
        const undone = new Set(pulls.flatMap((p) => (p.state === 'merged' ? [UNDO_BRANCH.exec(p.branch)?.[1] ?? ''] : [])));
        const stateIn = (p) => (p.state === 'merged' && undone.has(String(p.number)) ? 'undone' : stateOf(p));
        const after = query.cursor === undefined ? Infinity : Number(query.cursor);
        const matching = pulls.filter((p) => p.number < after && (query.state === undefined || stateIn(p) === query.state));
        const page = matching.slice(0, limit);
        const changes = (await Promise.all(page.map(async (p) => {
            const found = await savedAt(p.head, false);
            return found ? changeOf(p, found, stateIn(p)) : null;
        }))).filter((c) => c !== null);
        const last = page[page.length - 1];
        return { changes, next: matching.length > limit && last ? String(last.number) : null };
    }
    return {
        async read() {
            return (await loadAt(await baseTip())).state;
        },
        submit,
        approve,
        reject,
        undo,
        list,
    };
}
