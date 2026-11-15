export const CONTENT_DIR = 'content/';
export const TEXTS_PATH = 'content/texts.json';
/** An item id is also its file name. */
export const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const itemPath = (list, id) => `${CONTENT_DIR}${list}/${id}.json`;
/** True for a path the git store may write: inside `content/`, with no way out of it. */
export const isContentPath = (path) => path.startsWith(CONTENT_DIR) && path.length > CONTENT_DIR.length && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHand = (content, list) => content.lists.get(list)?.sort === 'hand';
/**
 * The content as the files hold it. Every declared text is there (the default
 * unless the file has an edit), and every declared list. A file that is not
 * JSON, is not declared, or fails its checks is left out, so one bad file can't
 * stop a save; it is not rewritten either, unless the change touches it.
 */
export function loadContentFiles(content, files) {
    const texts = {};
    for (const [key, declaration] of content.texts)
        texts[key] = declaration.default;
    const found = new Map();
    for (const list of content.lists.keys())
        found.set(list, []);
    for (const path of Object.keys(files).sort()) {
        let json;
        try {
            json = JSON.parse(files[path]);
        }
        catch {
            continue;
        }
        if (path === TEXTS_PATH) {
            if (!isObject(json))
                continue;
            for (const [key, value] of Object.entries(json)) {
                if (!content.texts.has(key))
                    continue;
                const check = content.validateText(key, value);
                if (check.ok)
                    texts[key] = check.text;
            }
            continue;
        }
        const parts = /^content\/([^/]+)\/([^/]+)\.json$/.exec(path);
        if (!parts || !found.has(parts[1]) || !ITEM_ID.test(parts[2]) || !isObject(json))
            continue;
        const { position, ...fields } = json;
        const check = content.validateItem(parts[1], fields);
        if (!check.ok)
            continue;
        found.get(parts[1])?.push({
            id: parts[2],
            values: check.values,
            position: Number.isSafeInteger(position) && position > 0 ? position : undefined,
        });
    }
    const lists = {};
    const positions = new Map();
    for (const [list, items] of found) {
        if (isHand(content, list)) {
            items.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            positions.set(list, new Map(items.flatMap((i) => (i.position === undefined ? [] : [[i.id, i.position]]))));
            lists[list] = items.map(({ id, values }) => ({ id, values }));
        }
        else {
            const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
            const by = content.lists.get(list).sort;
            const direction = by.order === 'desc' ? -1 : 1;
            sorted.sort((a, b) => {
                const x = a.values[by.by];
                const y = b.values[by.by];
                if (x === y)
                    return 0;
                if (x === undefined)
                    return 1;
                if (y === undefined)
                    return -1;
                return (x < y ? -1 : 1) * direction;
            });
            lists[list] = sorted.map(({ id, values }) => ({ id, values }));
        }
    }
    return { state: { texts, lists }, positions };
}
/** Positions for `order`, changing as few as possible: items whose old position still fits keep it. */
export function assignPositions(order, previous) {
    const STEP = 1000;
    const fresh = () => new Map(order.map((id, i) => [id, (i + 1) * STEP]));
    // The longest run of items, in order, whose old positions already increase: they stay.
    const known = order.flatMap((id, at) => (previous.has(id) ? [{ at, pos: previous.get(id) }] : []));
    const tails = []; // index into `known` of the smallest tail of each length
    const back = new Array(known.length).fill(-1);
    for (const [k, { pos }] of known.entries()) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (known[tails[mid]].pos < pos)
                lo = mid + 1;
            else
                hi = mid;
        }
        back[k] = lo > 0 ? tails[lo - 1] : -1;
        tails[lo] = k;
    }
    const kept = new Map(); // order index to position
    for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = back[k]) {
        const entry = known[k];
        kept.set(entry.at, entry.pos);
    }
    const result = new Map();
    let i = 0;
    while (i < order.length) {
        if (kept.has(i)) {
            result.set(order[i], kept.get(i));
            i++;
            continue;
        }
        let end = i;
        while (end < order.length && !kept.has(end))
            end++;
        const run = end - i;
        const lo = i === 0 ? 0 : result.get(order[i - 1]);
        const hi = end < order.length ? kept.get(end) : null;
        if (hi === null) {
            for (let j = 0; j < run; j++)
                result.set(order[i + j], lo + (j + 1) * STEP);
        }
        else if (hi - lo > run) {
            const step = Math.floor((hi - lo) / (run + 1));
            for (let j = 0; j < run; j++)
                result.set(order[i + j], lo + (j + 1) * step);
        }
        else {
            return fresh(); // no room between the neighbours: number the whole list again
        }
        i = end;
    }
    return result;
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function plainValue(value) {
    return typeof value === 'object' ? { src: value.src, alt: value.alt } : value;
}
/**
 * The files for a state. `previous` holds the positions the files had, so items
 * that did not move keep theirs.
 */
export function renderContentFiles(content, state, previous = new Map()) {
    const files = {};
    const edited = Object.keys(state.texts)
        .filter((key) => content.texts.has(key) && state.texts[key] !== content.texts.get(key).default)
        .sort();
    if (edited.length > 0)
        files[TEXTS_PATH] = json(Object.fromEntries(edited.map((key) => [key, state.texts[key]])));
    const positions = new Map();
    for (const [name, list] of content.lists) {
        const items = state.lists[name] ?? [];
        const hand = list.sort === 'hand';
        const where = hand ? assignPositions(items.map((i) => i.id), previous.get(name) ?? new Map()) : new Map();
        if (hand)
            positions.set(name, where);
        for (const item of items) {
            const fields = {};
            if (hand)
                fields.position = where.get(item.id);
            for (const field of list.fields) {
                const value = item.values[field.name];
                if (value !== undefined)
                    fields[field.name] = plainValue(value);
            }
            files[itemPath(name, item.id)] = json(fields);
        }
    }
    return { files, positions };
}
/** The files to write to go from one rendering to another: new text, or null to delete. */
export function fileChanges(before, after) {
    const changes = {};
    for (const path of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
        const was = before.files[path];
        const now = after.files[path];
        if (was !== now)
            changes[path] = now ?? null;
    }
    return changes;
}
