import { buildSnapshot } from '../core/read.js';
// The package's migration (with the D1 store) creates these. `fields` is the
// item's JSON; `position` is the hand order.
const TEXTS_SQL = 'SELECT key, value FROM texts';
const ITEMS_SQL = 'SELECT id, fields FROM items WHERE list = ? ORDER BY position, id';
export async function loadSnapshotFromD1(content, db, options = {}) {
    const report = options.report ?? (() => { });
    const texts = [];
    const lists = [];
    try {
        const { results } = await db.prepare(TEXTS_SQL).all();
        for (const row of results)
            texts.push([row.key, row.value]);
    }
    catch (error) {
        report('content: reading texts from D1 failed; showing the defaults', { error: errorName(error) });
    }
    for (const name of options.lists ?? []) {
        if (!content.lists.has(name)) {
            report('content: a requested list is not declared', { list: name });
            continue;
        }
        try {
            const { results } = await db.prepare(ITEMS_SQL).bind(name).all();
            for (const row of results)
                lists.push([name, { id: String(row.id), fields: parseFields(row.fields) }]);
        }
        catch (error) {
            report('content: reading a list from D1 failed; showing it empty', { list: name, error: errorName(error) });
        }
    }
    return buildSnapshot(content, { texts, lists }, report);
}
function parseFields(raw) {
    if (typeof raw !== 'string')
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
// The error's name only: a message can carry SQL or values.
const errorName = (error) => (error instanceof Error ? error.name : 'Error');
