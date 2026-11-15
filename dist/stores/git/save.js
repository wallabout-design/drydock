// The parts of saving a change as a pull request that need no network: what a
// save's commit says about itself, how an editor's waiting operations combine
// with new ones, and the pull request's text. store.ts does the saving.
//
// A save's commit carries its operations in its message, as one-line JSON
// trailers. They are only a way to remember what the editor asked for: the
// branch is always rebuilt from the operations applied to the base branch as it
// is now, so what lands is never what a branch's files happen to hold.
import { MAX_OPERATIONS, sameValue } from '../../core/change.js';
import { ITEM_ID } from './files.js';
export const DEFAULT_CONFIG = {
    base: 'main',
    branchPrefix: 'content-edit/',
    reviewLabel: 'content:waiting-review',
    requiredCheck: 'test',
    undoMode: 'auto',
};
/** How many times a save starts again when another save moved the base branch or the branch under it. */
export const SAVE_ATTEMPTS = 3;
/** An email as part of a branch name: "ada@example.org" becomes "ada-example-org". */
export const editorSlug = (email) => email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
/**
 * The start of every branch name for one editor: "content-edit/ada-example-org-1a2b3c4d/".
 * The hash is of the whole email, so two addresses with the same slug get
 * different branches, and the "/" ends it, so one editor's names never start with another's.
 */
export async function editorStem(prefix, email) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
    const hash = [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}${editorSlug(email)}-${hash}/`;
}
/** The part of a branch name after the stem that a save's own branch has: a date, then perhaps "-2". */
export const SAVE_BRANCH = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;
/** An undo's branch: "…/undo-<id of the change it undoes>", then perhaps "-2". */
export const UNDO_BRANCH = /\/undo-(\d+)(?:-\d+)?$/;
const OP_NAMES = ['setText', 'addItem', 'editItem', 'removeItem', 'moveItem'];
function readOps(json) {
    if (json === undefined)
        return null;
    try {
        const value = JSON.parse(json);
        if (!Array.isArray(value))
            return null;
        return value.every((o) => typeof o === 'object' && o !== null && OP_NAMES.includes(o.op)) ? value : null;
    }
    catch {
        return null;
    }
}
export function commitMessage(saved) {
    const count = saved.ops.length;
    return [
        `content: ${count} operation${count === 1 ? '' : 's'} by ${saved.editor}`,
        '',
        `Content-Editor: ${saved.editor}`,
        `Content-Ops: ${JSON.stringify(saved.ops)}`,
        `Content-Reverse: ${JSON.stringify(saved.reverse)}`,
        ...(saved.undoes === undefined ? [] : [`Content-Undoes: ${saved.undoes}`]),
    ].join('\n');
}
/** What a save's commit message says, or null when it is not one (a person's own commit). */
export function readCommitMessage(message) {
    const trailer = (name) => message.split('\n').find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
    const editor = trailer('Content-Editor');
    const ops = readOps(trailer('Content-Ops'));
    const reverse = readOps(trailer('Content-Reverse'));
    if (editor === undefined || editor === '' || ops === null || reverse === null)
        return null;
    const undoes = trailer('Content-Undoes');
    return { editor, ops, reverse, ...(undoes !== undefined && /^\d+$/.test(undoes) ? { undoes } : {}) };
}
/**
 * Checks each operation against the declaration, with the same rules the editor
 * ran, and returns it with its values cleaned. `seen` is not touched: it is
 * compared with what is stored, not with what the declaration allows.
 */
export function normalizeOps(content, ops) {
    if (ops.length === 0)
        return { ok: false, message: 'A change needs at least one operation.' };
    if (ops.length > MAX_OPERATIONS)
        return { ok: false, message: `A change can hold at most ${MAX_OPERATIONS} operations.` };
    const out = [];
    for (const o of ops) {
        if (typeof o !== 'object' || o === null || !OP_NAMES.includes(o.op))
            return { ok: false, message: 'The change could not be read.' };
        if (o.op === 'setText') {
            const check = content.validateText(o.key, o.text);
            if (!check.ok)
                return { ok: false, message: check.problems[0]?.message ?? 'That text can’t be saved.' };
            out.push({ ...o, text: check.text });
            continue;
        }
        if (!content.lists.has(o.list))
            return { ok: false, message: 'This list is no longer on the site. Reload the page.' };
        if (typeof o.id !== 'string' || !ITEM_ID.test(o.id))
            return { ok: false, message: 'An item’s id is lowercase letters, digits and "-".' };
        if (o.op === 'addItem' || o.op === 'editItem') {
            const check = content.validateItem(o.list, o.values);
            if (!check.ok)
                return { ok: false, message: check.problems[0]?.message ?? 'That item can’t be saved.' };
            out.push({ ...o, values: check.values });
            continue;
        }
        out.push(o);
    }
    return { ok: true, ops: out };
}
// ---- combining an editor's waiting operations with new ones ----
const targetOf = (o) => JSON.stringify(o.op === 'setText' ? ['text', o.key] : ['item', o.list, o.id]);
/** The operation that does what `earlier` then `later` do to the same place; null when they cancel out; 'conflict' when no one operation can. */
function combine(earlier, later) {
    if (earlier.op === 'setText' && later.op === 'setText')
        return later.text === earlier.seen ? null : { ...earlier, text: later.text };
    if (earlier.op === 'addItem') {
        if (later.op === 'editItem')
            return { ...earlier, values: later.values };
        if (later.op === 'removeItem')
            return null;
        if (later.op === 'moveItem')
            return { ...earlier, after: later.after };
    }
    if (earlier.op === 'editItem') {
        if (later.op === 'editItem')
            return sameValue(later.values, earlier.seen) ? null : { ...earlier, values: later.values };
        if (later.op === 'removeItem')
            return { op: 'removeItem', list: earlier.list, id: earlier.id, seen: earlier.seen };
    }
    if (earlier.op === 'moveItem' && later.op === 'moveItem')
        return later.after === earlier.seen ? null : { ...earlier, after: later.after };
    return 'conflict';
}
/**
 * The waiting operations plus the new ones, as one list in which each text or
 * item appears once. Two edits of the same place become one, kept as the first
 * saw it. Null when two operations on one place can't be one operation: the
 * editor has to wait for the first to go live.
 */
export function composeOps(waiting, next) {
    const result = [...waiting];
    for (const later of next) {
        const at = result.findIndex((o) => o !== null && targetOf(o) === targetOf(later));
        if (at < 0) {
            result.push(later);
            continue;
        }
        const combined = combine(result[at], later);
        if (combined === 'conflict')
            return null;
        result[at] = combined;
    }
    return result.filter((o) => o !== null);
}
// ---- the pull request's text ----
/** A fence longer than any run of backticks in the text, so content can't break out of it. */
function fenced(text, lang) {
    const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${lang}\n${text}\n${fence}`;
}
const count = (n) => `${n} change${n === 1 ? '' : 's'}`;
function describe(o) {
    if (o.op === 'setText')
        return [`\`${o.key}\``, fenced(`- ${o.seen}\n+ ${o.text}`, 'diff'), ''];
    const what = { addItem: 'added', editItem: 'edited', removeItem: 'removed', moveItem: 'moved' }[o.op];
    return [`${what} \`${o.list}/${o.id}\``, ''];
}
/** The pull request's title and body: Problem, Solution, Validation, naming the editor. Old and new text sit in code blocks, so nothing typed into the page can mention people or render as Markdown. */
export function pullText(config, editor, ops, review, undoes) {
    const shown = ops.slice(0, 10);
    const more = ops.length - shown.length;
    return {
        title: `content: ${undoes === undefined ? count(ops.length) : `undo #${undoes}`} on ${config.site} by ${editor}`,
        body: [
            '**Problem**',
            '',
            `\`${editor}\` ${undoes === undefined ? `made ${count(ops.length)}` : `undid change #${undoes}`} on ${config.site} with the editor. ${review ? 'It waits for an admin to approve it' : 'It is not live until this merges'}.`,
            '',
            '**Solution**',
            '',
            'Only files in `content/` change:',
            '',
            ...shown.flatMap(describe),
            ...(more > 0 ? [`And ${more} more, in the diff.`, ''] : []),
            '**Validation**',
            '',
            `- When saved, each old value matched \`${config.base}\`, and each new one passed the site's rules.`,
            review
                ? `- Labelled \`${config.reviewLabel}\`: it merges when an admin approves it and the tests have passed.`
                : '- The merge workflow checks the same again, and that no other file changed, then merges once the tests pass.',
        ].join('\n'),
    };
}
