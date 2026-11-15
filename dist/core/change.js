/** The most operations in one change (content-editing.md, "limits"). */
export const MAX_OPERATIONS = 50;
const STALE = { kind: 'stale' };
const bad = (message) => ({ kind: 'invalid', message });
/** Deep equality for stored values, which are plain JSON-like data. */
function sameValue(a, b) {
    if (a === b)
        return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const left = a;
    const right = b;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && sameValue(left[k], right[k]));
}
const predecessor = (items, at) => (at === 0 ? null : items[at - 1].id);
/** The index an item goes at to sit after `after` (0 for null), or null if that item is not there. */
function indexAfter(items, after) {
    if (after === null)
        return 0;
    const at = items.findIndex((i) => i.id === after);
    return at < 0 ? null : at + 1;
}
function checkOp(state, o) {
    if (o.op === 'setText') {
        if (!Object.hasOwn(state.texts, o.key))
            return bad(`There is no text called ${o.key}.`);
        return state.texts[o.key] === o.seen ? null : STALE;
    }
    if (!Object.hasOwn(state.lists, o.list))
        return bad(`There is no list called ${o.list}.`);
    const items = state.lists[o.list];
    const at = items.findIndex((i) => i.id === o.id);
    switch (o.op) {
        case 'addItem':
            if (at >= 0)
                return bad(`An item with id ${o.id} is already in ${o.list}.`);
            return o.after === null || items.some((i) => i.id === o.after) ? null : STALE;
        case 'editItem':
        case 'removeItem':
            if (at < 0)
                return STALE;
            return sameValue(items[at].values, o.seen) ? null : STALE;
        case 'moveItem':
            if (at < 0)
                return STALE;
            if (o.after === o.id)
                return bad('An item can’t be moved after itself.');
            if (o.after !== null && !items.some((i) => i.id === o.after))
                return STALE;
            return predecessor(items, at) === o.seen ? null : STALE;
    }
}
/**
 * Checks the operations against `state` as the editor saw it, and applies them in
 * order. Nothing is changed: the result carries the new state, or a refusal.
 * `reverse` holds the operations that put `state` back, already in the order to
 * run them. Each operation may touch a text or an item only once per change.
 */
export function applyOperations(state, ops) {
    const invalid = (message) => ({ ok: false, reason: 'invalid', message });
    if (ops.length === 0)
        return invalid('A change needs at least one operation.');
    if (ops.length > MAX_OPERATIONS)
        return invalid(`A change can hold at most ${MAX_OPERATIONS} operations.`);
    const touched = new Set();
    for (const o of ops) {
        const target = JSON.stringify(o.op === 'setText' ? ['text', o.key] : ['item', o.list, o.id]);
        if (touched.has(target))
            return invalid('A change can change each text or item only once.');
        touched.add(target);
    }
    for (const [index, o] of ops.entries()) {
        const problem = checkOp(state, o);
        if (problem === null)
            continue;
        return problem.kind === 'stale' ? { ok: false, reason: 'stale', index } : invalid(problem.message);
    }
    const next = structuredClone(state);
    const was = [];
    for (const o of ops) {
        if (o.op === 'setText') {
            was.push({ text: next.texts[o.key] });
            next.texts[o.key] = o.text;
            continue;
        }
        const items = next.lists[o.list];
        if (o.op === 'addItem') {
            const at = indexAfter(items, o.after);
            if (at === null)
                return invalid(`${o.id} can’t go after an item that is no longer in ${o.list}.`);
            items.splice(at, 0, { id: o.id, values: structuredClone(o.values) });
            was.push({});
            continue;
        }
        const at = items.findIndex((i) => i.id === o.id);
        const item = items[at];
        if (o.op === 'editItem') {
            was.push({ values: item.values });
            item.values = structuredClone(o.values);
            continue;
        }
        if (o.op === 'removeItem') {
            was.push({ values: item.values, after: predecessor(items, at) });
            items.splice(at, 1);
            continue;
        }
        was.push({ after: predecessor(items, at) });
        items.splice(at, 1);
        const to = indexAfter(items, o.after);
        if (to === null)
            return invalid(`${o.id} can’t go after an item that is no longer in ${o.list}.`);
        items.splice(to, 0, item);
    }
    // The reverse is built from the final content, so every "seen" matches what undo finds.
    const itemOf = (list, id) => {
        const items = next.lists[list];
        return { items, at: items.findIndex((i) => i.id === id) };
    };
    const reverse = [];
    for (const [i, o] of ops.entries()) {
        const w = was[i];
        if (o.op === 'setText') {
            reverse.push({ op: 'setText', key: o.key, text: w.text, seen: next.texts[o.key] });
        }
        else if (o.op === 'addItem') {
            const { items, at } = itemOf(o.list, o.id);
            reverse.push({ op: 'removeItem', list: o.list, id: o.id, seen: items[at].values });
        }
        else if (o.op === 'editItem') {
            const { items, at } = itemOf(o.list, o.id);
            reverse.push({ op: 'editItem', list: o.list, id: o.id, values: w.values, seen: items[at].values });
        }
        else if (o.op === 'removeItem') {
            reverse.push({ op: 'addItem', list: o.list, id: o.id, values: w.values, after: w.after });
        }
        else {
            const { items, at } = itemOf(o.list, o.id);
            reverse.push({ op: 'moveItem', list: o.list, id: o.id, after: w.after, seen: predecessor(items, at) });
        }
    }
    return { ok: true, state: next, reverse: reverse.reverse() };
}
