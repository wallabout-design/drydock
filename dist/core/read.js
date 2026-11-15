export const EMPTY_SNAPSHOT = { texts: {}, lists: {} };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Reads from a snapshot. A text with no edit gives its default; an unknown key or list throws, since the types should have caught it. */
export function createReader(content, snapshot = EMPTY_SNAPSHOT) {
    return {
        text(key) {
            const declaration = content.texts.get(key);
            if (!declaration)
                throw new Error(`"${key}" is not a declared text key`);
            return has(snapshot.texts, key) ? snapshot.texts[key] : declaration.default;
        },
        list(name) {
            if (!content.lists.has(name))
                throw new Error(`"${name}" is not a declared list`);
            return has(snapshot.lists, name) ? snapshot.lists[name] : [];
        },
    };
}
/** Puts items in the list's order. By hand, the given order stands; otherwise by the sort field. */
export function orderItems(content, list, items) {
    const sort = content.lists.get(list)?.sort;
    if (sort === undefined || sort === 'hand')
        return items;
    const direction = sort.order === 'desc' ? -1 : 1;
    const by = sort.by;
    return [...items].sort((a, b) => {
        const x = a.values[by];
        const y = b.values[by];
        if (x === y)
            return 0;
        if (x === undefined)
            return 1;
        if (y === undefined)
            return -1;
        return (x < y ? -1 : 1) * direction;
    });
}
/**
 * Builds a snapshot from items and edited texts as stored, checking each
 * against the declaration. A text that is not declared or fails its checks is
 * left out (the default shows); an item that fails its checks is left out.
 * Both are reported, never thrown, so one bad file can't take the page down.
 */
export function buildSnapshot(content, stored, report = () => { }) {
    const texts = {};
    for (const [key, value] of stored.texts ?? []) {
        if (!content.texts.has(key)) {
            report('content: a stored text has no declaration', { key });
            continue;
        }
        const check = content.validateText(key, value);
        if (check.ok)
            texts[key] = check.text;
        else
            report('content: a stored text is not valid', { key, problems: check.problems.map((p) => p.kind) });
    }
    const grouped = new Map();
    for (const [list, input] of stored.lists ?? []) {
        if (!content.lists.has(list)) {
            report('content: a stored item has no list declared', { list });
            continue;
        }
        const check = content.validateItem(list, input.fields);
        if (!check.ok) {
            report('content: a stored item is not valid', { list, item: input.id, problems: check.problems.map((p) => `${p.field}:${p.kind}`) });
            continue;
        }
        const items = grouped.get(list) ?? [];
        items.push({ id: input.id, values: check.values });
        grouped.set(list, items);
    }
    const lists = {};
    for (const [list, items] of grouped)
        lists[list] = orderItems(content, list, items);
    return { texts, lists };
}
/**
 * The git store at build time. `files` maps a path inside `content/` (or with
 * the `content/` prefix) to the file's text, which is what `import.meta.glob`
 * gives with `query: '?raw'`:
 *
 * - `content/texts.json`: `{ "home.hero.title": "words", ... }`
 * - `content/<list>/<id>.json`: one item's fields. With a hand order, items
 *   come in `position` order (a whole number the git store writes), then file
 *   name order (`001-first.json`).
 */
export function snapshotFromFiles(content, files, report = () => { }) {
    const texts = [];
    const lists = [];
    const positions = new Map();
    for (const path of Object.keys(files).sort()) {
        const m = /(?:^|\/)content\/(.+)$/.exec(path) ?? /^(.+)$/.exec(path);
        const rel = m[1];
        let json;
        try {
            json = JSON.parse(files[path]);
        }
        catch {
            report('content: a content file is not JSON', { path: rel });
            continue;
        }
        if (rel === 'texts.json') {
            if (json && typeof json === 'object' && !Array.isArray(json))
                texts.push(...Object.entries(json));
            else
                report('content: texts.json is not an object', { path: rel });
            continue;
        }
        const parts = /^([^/]+)\/([^/]+)\.json$/.exec(rel);
        if (!parts) {
            report('content: a content file is not where one belongs', { path: rel });
            continue;
        }
        let fields = json;
        if (json && typeof json === 'object' && !Array.isArray(json) && 'position' in json) {
            const { position, ...rest } = json;
            if (typeof position === 'number')
                positions.set(`${parts[1]}/${parts[2]}`, position);
            fields = rest;
        }
        lists.push([parts[1], { id: parts[2], fields }]);
    }
    // Array.sort is stable: items without a position keep their file name order.
    if (positions.size > 0) {
        const at = ([list, item]) => positions.get(`${list}/${item.id}`) ?? Infinity;
        lists.sort((a, b) => (a[0] === b[0] ? (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    }
    return buildSnapshot(content, { texts, lists }, report);
}
/** `data-list` for the container of a list. */
export function listAttrs(name) {
    return { 'data-list': name };
}
/** `data-item` for one item of a list. */
export function itemAttrs(item) {
    return { 'data-item': item.id };
}
/** `data-copy` for an element that shows a text. */
export function textAttrs(key) {
    return { 'data-copy': key };
}
