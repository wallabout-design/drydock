// The D1 store: the Store interface on a site's D1 database, in the tables of
// migrations/0001_content.sql. Plain TypeScript; it takes the database as an
// argument and imports no Worker types.
//
// Cloudflare's D1 can't hold a transaction open across a read and a write, so a
// change is checked here against what was just read, and then written in one
// `batch` (which D1 runs as one transaction) whose first statement carries every
// "last saw" condition in its WHERE clause. If any no longer holds, that
// statement changes no row, and every later statement, which is gated on the
// first one's row, writes nothing. The store then reads again and decides what
// to say. So two saves can't both win.
import { applyOperations } from '../../core/change.js';
/** Earlier versions kept per text or item (content-editing.md, "limits"). */
export const HISTORY_KEPT = 50;
/** How often one call re-reads after losing a race before it gives up. */
const ATTEMPTS = 3;
const itemKey = (list, id) => JSON.stringify([list, id]);
const refuse = (refusal) => ({ ok: false, refusal });
const parse = (raw) => {
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
};
export function d1Store(db, options = {}) {
    const now = options.now ?? (() => new Date().toISOString());
    const newId = options.newId ?? (() => crypto.randomUUID());
    const run = (q) => db.prepare(q.sql).bind(...q.params);
    async function load() {
        const [texts, items] = await db.batch([
            db.prepare('SELECT key, text FROM content_texts'),
            db.prepare('SELECT list, id, data, position FROM content_items ORDER BY list, position, id'),
        ]);
        const state = { texts: {}, lists: {} };
        for (const t of options.content?.texts.values() ?? [])
            state.texts[t.key] = t.default;
        for (const name of options.content?.lists.keys() ?? [])
            state.lists[name] = [];
        const textRows = new Map();
        for (const row of (texts?.results ?? [])) {
            textRows.set(row.key, row.text);
            state.texts[row.key] = row.text;
        }
        const itemRows = new Map();
        for (const row of (items?.results ?? [])) {
            itemRows.set(itemKey(row.list, row.id), { raw: row.data, position: row.position });
            (state.lists[row.list] ??= []).push({ id: row.id, values: parse(row.data) });
        }
        return { state, textRows, itemRows };
    }
    async function getChange(id) {
        const { results } = await db.prepare('SELECT * FROM content_changes WHERE id = ?').bind(id).all();
        const row = results[0];
        return row === undefined ? undefined : toChange(row);
    }
    /** The "last saw" conditions: each is true only while the content is as it was read. */
    function guards(ops, loaded) {
        const out = [];
        const ordered = new Set();
        for (const o of ops) {
            if (o.op === 'setText') {
                const row = loaded.textRows.get(o.key);
                out.push(row === undefined
                    ? { sql: 'NOT EXISTS (SELECT 1 FROM content_texts WHERE key = ?)', params: [o.key] }
                    : { sql: '(SELECT text FROM content_texts WHERE key = ?) = ?', params: [o.key, row] });
                continue;
            }
            const row = loaded.itemRows.get(itemKey(o.list, o.id));
            if (o.op === 'addItem' || row === undefined) {
                out.push({ sql: 'NOT EXISTS (SELECT 1 FROM content_items WHERE list = ? AND id = ?)', params: [o.list, o.id] });
            }
            else {
                out.push({ sql: '(SELECT data FROM content_items WHERE list = ? AND id = ?) = ?', params: [o.list, o.id, row.raw] });
            }
            // Adding or moving an item places it among its neighbours as read, so the order must still be the same.
            if ((o.op === 'addItem' || o.op === 'moveItem') && !ordered.has(o.list)) {
                ordered.add(o.list);
                const ids = (loaded.state.lists[o.list] ?? []).map((i) => i.id);
                out.push({
                    sql: '(SELECT json_group_array(id) FROM (SELECT id FROM content_items WHERE list = ? ORDER BY position, id)) = ?',
                    params: [o.list, JSON.stringify(ids)],
                });
            }
        }
        return out;
    }
    const where = (parts) => parts.length === 0
        ? { sql: '1', params: [] }
        : { sql: parts.map((p) => p.sql).join(' AND '), params: parts.flatMap((p) => p.params) };
    /** True while the change `id` is the live one this call wrote. */
    const gate = (id, decidedAt) => ({
        sql: "EXISTS (SELECT 1 FROM content_changes WHERE id = ? AND state = 'live' AND decided_at IS ?)",
        params: [id, decidedAt],
    });
    /** Positions for the added and moved items, between their neighbours' positions as read. */
    function placements(final, read, fresh) {
        const out = new Map();
        let i = 0;
        while (i < final.length) {
            if (!fresh.has(final[i].id)) {
                i++;
                continue;
            }
            let j = i;
            while (j < final.length && fresh.has(final[j].id))
                j++;
            const lo = i > 0 ? read.get(final[i - 1].id) : undefined;
            const hi = j < final.length ? read.get(final[j].id) : undefined;
            const count = j - i;
            let from = 0;
            let step = 1;
            if (lo !== undefined && hi !== undefined) {
                step = (hi - lo) / (count + 1);
                from = lo + step;
            }
            else if (lo !== undefined) {
                from = lo + 1;
            }
            else if (hi !== undefined) {
                from = hi - count;
            }
            for (let n = 0; n < count; n++)
                out.set(final[i + n].id, from + n * step);
            i = j;
        }
        return out;
    }
    /** Writes the content and its history, each statement only while `live` holds. */
    function writes(ops, loaded, final, live, changeId, by, at) {
        const g = live;
        const gated = (sql, params) => run({ sql: `${sql} AND ${g.sql}`, params: [...params, ...g.params] });
        const insertWhere = (sql, params) => run({ sql: `${sql} WHERE ${g.sql}`, params: [...params, ...g.params] });
        const out = [];
        const history = (kind, list, target, before, after) => {
            out.push(insertWhere('INSERT INTO content_history (change_id, kind, list, target, before, after, by, at) SELECT ?, ?, ?, ?, ?, ?, ?, ?', [changeId, kind, list, target, before, after, by, at]), gated('DELETE FROM content_history WHERE kind = ? AND list = ? AND target = ?' +
                ' AND id <= COALESCE((SELECT id FROM content_history WHERE kind = ? AND list = ? AND target = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)', [kind, list, target, kind, list, target, HISTORY_KEPT]));
        };
        // Positions for the lists whose order changes.
        const fresh = new Map();
        for (const o of ops)
            if (o.op === 'addItem' || o.op === 'moveItem')
                (fresh.get(o.list) ?? fresh.set(o.list, new Set()).get(o.list)).add(o.id);
        const positions = new Map();
        for (const [list, ids] of fresh) {
            const read = new Map();
            for (const [key, row] of loaded.itemRows) {
                const [l, id] = JSON.parse(key);
                if (l === list)
                    read.set(id, row.position);
            }
            positions.set(list, placements(final.lists[list] ?? [], read, ids));
        }
        for (const o of ops) {
            if (o.op === 'setText') {
                // An upsert needs its conflict clause after the WHERE, so it is spelled out here.
                out.push(run({
                    sql: `INSERT INTO content_texts (key, text, updated_at) SELECT ?, ?, ? WHERE ${g.sql} ON CONFLICT (key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
                    params: [o.key, o.text, at, ...g.params],
                }));
                history('text', '', o.key, JSON.stringify(loaded.state.texts[o.key] ?? null), JSON.stringify(o.text));
                continue;
            }
            const before = loaded.itemRows.get(itemKey(o.list, o.id))?.raw ?? null;
            const position = positions.get(o.list)?.get(o.id);
            if (o.op === 'addItem') {
                const data = JSON.stringify(o.values);
                out.push(insertWhere('INSERT INTO content_items (list, id, data, position, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?', [o.list, o.id, data, position ?? 0, at, at]));
                history('item', o.list, o.id, null, data);
            }
            else if (o.op === 'editItem') {
                const data = JSON.stringify(o.values);
                out.push(gated('UPDATE content_items SET data = ?, updated_at = ? WHERE list = ? AND id = ?', [data, at, o.list, o.id]));
                history('item', o.list, o.id, before, data);
            }
            else if (o.op === 'removeItem') {
                out.push(gated('DELETE FROM content_items WHERE list = ? AND id = ?', [o.list, o.id]));
                history('item', o.list, o.id, before, null);
            }
            else {
                out.push(gated('UPDATE content_items SET position = ?, updated_at = ? WHERE list = ? AND id = ?', [position ?? 0, at, o.list, o.id]));
                history('item', o.list, o.id, before, before);
            }
        }
        // Tidy the order of each list that changed back to 0, 1, 2, ... (MATERIALIZED, so the new numbers don't feed the counting).
        for (const list of fresh.keys()) {
            out.push(run({
                sql: 'WITH ranked AS MATERIALIZED (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rank FROM content_items WHERE list = ?) ' +
                    `UPDATE content_items SET position = (SELECT rank FROM ranked WHERE ranked.id = content_items.id) WHERE list = ? AND ${g.sql}`,
                params: [list, list, ...g.params],
            }));
        }
        return out;
    }
    const stale = (loaded, index) => refuse({ reason: 'stale', index, current: structuredClone(loaded.state) });
    const refusalOf = (applied, loaded) => applied.reason === 'stale' ? stale(loaded, applied.index) : refuse({ reason: 'invalid', message: applied.message });
    return {
        capabilities: { goesLive: 'at-once', history: HISTORY_KEPT },
        async read() {
            return (await load()).state;
        },
        async submit(input, mode) {
            let loaded = await load();
            for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
                if (attempt > 0)
                    loaded = await load();
                const applied = applyOperations(loaded.state, input.ops);
                if (!applied.ok)
                    return refusalOf(applied, loaded);
                const id = newId();
                const at = now();
                const base = { id, ops: structuredClone(input.ops), by: input.by, at };
                if (mode === 'review') {
                    await db
                        .prepare("INSERT INTO content_changes (id, operations, state, by, at) VALUES (?, ?, 'waiting', ?, ?)")
                        .bind(id, JSON.stringify(input.ops), input.by, at)
                        .all();
                    return { ok: true, change: { ...base, state: 'waiting' } };
                }
                const guard = where(guards(input.ops, loaded));
                const first = run({
                    sql: `INSERT INTO content_changes (id, operations, state, by, at, reverse) SELECT ?, ?, 'live', ?, ?, ? WHERE ${guard.sql}`,
                    params: [id, JSON.stringify(input.ops), input.by, at, JSON.stringify(applied.reverse), ...guard.params],
                });
                const results = await db.batch([first, ...writes(input.ops, loaded, applied.state, gate(id, null), id, input.by, at)]);
                if (results[0]?.meta?.changes === 1)
                    return { ok: true, change: { ...base, state: 'live', reverse: applied.reverse } };
            }
            return stale(loaded, 0);
        },
        async approve(id, by) {
            let loaded;
            for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
                const change = await getChange(id);
                if (change === undefined)
                    return refuse({ reason: 'not-found' });
                if (change.state !== 'waiting')
                    return refuse({ reason: 'wrong-state', state: change.state });
                loaded = await load();
                const applied = applyOperations(loaded.state, change.ops);
                // The change stays waiting: the admin can reject it, or see what moved on.
                if (!applied.ok)
                    return refusalOf(applied, loaded);
                const at = now();
                const guard = where(guards(change.ops, loaded));
                const first = run({
                    sql: `UPDATE content_changes SET state = 'live', decided_by = ?, decided_at = ?, reverse = ? WHERE id = ? AND state = 'waiting' AND ${guard.sql}`,
                    params: [by, at, JSON.stringify(applied.reverse), id, ...guard.params],
                });
                const results = await db.batch([first, ...writes(change.ops, loaded, applied.state, gate(id, at), id, by, at)]);
                if (results[0]?.meta?.changes === 1)
                    return { ok: true, change: { ...change, state: 'live', decidedBy: by, decidedAt: at, reverse: applied.reverse } };
            }
            return stale(loaded, 0);
        },
        async reject(id, by) {
            const at = now();
            const [result] = await db.batch([
                db.prepare("UPDATE content_changes SET state = 'rejected', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'waiting'").bind(by, at, id),
            ]);
            const change = await getChange(id);
            if (change === undefined)
                return refuse({ reason: 'not-found' });
            if (result?.meta?.changes !== 1)
                return refuse({ reason: 'wrong-state', state: change.state });
            return { ok: true, change };
        },
        async undo(id, by) {
            let loaded;
            for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
                const original = await getChange(id);
                if (original === undefined)
                    return refuse({ reason: 'not-found' });
                if (original.state !== 'live' || original.reverse === undefined)
                    return refuse({ reason: 'wrong-state', state: original.state });
                loaded = await load();
                const applied = applyOperations(loaded.state, original.reverse);
                if (!applied.ok)
                    return refusalOf(applied, loaded);
                const at = now();
                const undoId = newId();
                const guard = where(guards(original.reverse, loaded));
                const mark = run({
                    sql: `UPDATE content_changes SET state = 'undone', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'live' AND ${guard.sql}`,
                    params: [by, at, id, ...guard.params],
                });
                // The undo is a new live change, written only if the mark above took.
                const record = run({
                    sql: "INSERT INTO content_changes (id, operations, state, by, at, reverse, undoes) SELECT ?, ?, 'live', ?, ?, ?, ? " +
                        "WHERE EXISTS (SELECT 1 FROM content_changes WHERE id = ? AND state = 'undone' AND decided_by = ? AND decided_at = ?)",
                    params: [undoId, JSON.stringify(original.reverse), by, at, JSON.stringify(applied.reverse), id, id, by, at],
                });
                const results = await db.batch([mark, record, ...writes(original.reverse, loaded, applied.state, gate(undoId, null), undoId, by, at)]);
                if (results[0]?.meta?.changes === 1) {
                    return { ok: true, change: { id: undoId, ops: structuredClone(original.reverse), by, at, state: 'live', undoes: id, reverse: applied.reverse } };
                }
            }
            return stale(loaded, 0);
        },
        async list(query = {}) {
            const limit = query.limit ?? 20;
            const { results } = await db
                .prepare('SELECT * FROM content_changes WHERE (? IS NULL OR state = ?)' +
                ' AND (? IS NULL OR rowid < (SELECT rowid FROM content_changes WHERE id = ?)) ORDER BY rowid DESC LIMIT ?')
                .bind(query.state ?? null, query.state ?? null, query.cursor ?? null, query.cursor ?? null, limit + 1)
                .all();
            const page = results.slice(0, limit).map(toChange);
            const last = page[page.length - 1];
            return { changes: page, next: results.length > limit && last !== undefined ? last.id : null };
        },
    };
}
function toChange(row) {
    const change = { id: row.id, ops: parse(row.operations), by: row.by, at: row.at, state: row.state };
    if (row.undoes !== null)
        change.undoes = row.undoes;
    if (row.decided_by !== null)
        change.decidedBy = row.decided_by;
    if (row.decided_at !== null)
        change.decidedAt = row.decided_at;
    if (row.reverse !== null)
        change.reverse = parse(row.reverse);
    return change;
}
