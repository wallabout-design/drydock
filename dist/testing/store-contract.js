// The contract every store must pass (content-editing.md, "a change"). A store
// starts with INITIAL, so each test knows what is there. Each test makes its own
// store, so none depends on another.
import { describe, expect, it } from 'vitest';
export const INITIAL = {
    texts: { 'home.title': 'Hello', 'home.intro': 'Welcome' },
    lists: {
        rooms: [
            { id: 'a', values: { title: 'Blue room' } },
            { id: 'b', values: { title: 'Green room' } },
        ],
    },
};
const setText = (key, seen, text) => ({ op: 'setText', key, seen, text });
function changeOf(outcome) {
    if (!outcome.ok)
        throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
    return outcome.change;
}
function refusalOf(outcome) {
    if (outcome.ok)
        throw new Error(`accepted: ${outcome.change.id}`);
    return outcome.refusal;
}
const ids = (state, list) => (state.lists[list] ?? []).map((i) => i.id);
export function storeContract(makeStore) {
    const start = async () => makeStore(structuredClone(INITIAL));
    describe('store contract', () => {
        it('reads back what it was made with', async () => {
            const store = await start();
            expect(await store.read()).toEqual(INITIAL);
        });
        it('an auto change goes live at once', async () => {
            const store = await start();
            const change = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'auto'));
            expect(change.state).toBe('live');
            expect(change.by).toBe('ana');
            expect((await store.read()).texts['home.title']).toBe('Hi');
        });
        it('a stale "last saw" refuses the whole change and returns what is there now', async () => {
            const store = await start();
            const refusal = refusalOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi'), setText('home.intro', 'Nope', 'Hey')], by: 'ana' }, 'auto'));
            expect(refusal).toEqual({ reason: 'stale', index: 1, current: INITIAL });
            expect(await store.read()).toEqual(INITIAL);
        });
        it('a review change waits until an admin approves it', async () => {
            const store = await start();
            const change = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'review'));
            expect(change.state).toBe('waiting');
            expect((await store.read()).texts['home.title']).toBe('Hello');
            const waiting = await store.list({ state: 'waiting' });
            expect(waiting.changes.map((c) => c.id)).toEqual([change.id]);
            const approved = changeOf(await store.approve(change.id, 'jj'));
            expect(approved.state).toBe('live');
            expect(approved.decidedBy).toBe('jj');
            expect((await store.read()).texts['home.title']).toBe('Hi');
        });
        it('reject leaves the content alone, and a rejected change cannot be approved', async () => {
            const store = await start();
            const change = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'review'));
            expect(changeOf(await store.reject(change.id, 'jj')).state).toBe('rejected');
            expect((await store.read()).texts['home.title']).toBe('Hello');
            expect(refusalOf(await store.approve(change.id, 'jj'))).toEqual({ reason: 'wrong-state', state: 'rejected' });
        });
        it('undo puts the old content back, and the undo is a live change', async () => {
            const store = await start();
            const original = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'auto'));
            const undo = changeOf(await store.undo(original.id, 'jj'));
            expect(undo.state).toBe('live');
            expect(undo.undoes).toBe(original.id);
            expect((await store.read()).texts['home.title']).toBe('Hello');
            const page = await store.list();
            expect(page.changes.find((c) => c.id === original.id)?.state).toBe('undone');
        });
        it('undo refuses when the content has moved on since the change', async () => {
            const store = await start();
            const first = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'auto'));
            changeOf(await store.submit({ ops: [setText('home.title', 'Hi', 'Yo')], by: 'ben' }, 'auto'));
            expect(refusalOf(await store.undo(first.id, 'jj'))).toMatchObject({ reason: 'stale' });
            expect((await store.read()).texts['home.title']).toBe('Yo');
        });
        it('two submits racing on the same "last saw" cannot both win', async () => {
            const store = await start();
            const outcomes = await Promise.all([
                store.submit({ ops: [setText('home.title', 'Hello', 'A')], by: 'ana' }, 'auto'),
                store.submit({ ops: [setText('home.title', 'Hello', 'B')], by: 'ben' }, 'auto'),
            ]);
            expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
            expect(['A', 'B']).toContain((await store.read()).texts['home.title']);
        });
        it('approve refuses a waiting change that has gone stale, and it stays waiting', async () => {
            const store = await start();
            const waiting = changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Hi')], by: 'ana' }, 'review'));
            changeOf(await store.submit({ ops: [setText('home.title', 'Hello', 'Yo')], by: 'ben' }, 'auto'));
            expect(refusalOf(await store.approve(waiting.id, 'jj'))).toMatchObject({ reason: 'stale' });
            expect((await store.list({ state: 'waiting' })).changes.map((c) => c.id)).toEqual([waiting.id]);
            expect((await store.read()).texts['home.title']).toBe('Yo');
        });
        it('adds, edits, moves and removes items, and undo restores each', async () => {
            const store = await start();
            const add = (after) => ({ op: 'addItem', list: 'rooms', id: 'c', values: { title: 'Red room' }, after });
            changeOf(await store.submit({ ops: [add('b')], by: 'ana' }, 'auto'));
            expect(ids(await store.read(), 'rooms')).toEqual(['a', 'b', 'c']);
            changeOf(await store.submit({ ops: [{ op: 'editItem', list: 'rooms', id: 'c', values: { title: 'Crimson' }, seen: { title: 'Red room' } }], by: 'ana' }, 'auto'));
            expect((await store.read()).lists.rooms?.[2]?.values).toEqual({ title: 'Crimson' });
            const move = changeOf(await store.submit({ ops: [{ op: 'moveItem', list: 'rooms', id: 'c', after: null, seen: 'b' }], by: 'ana' }, 'auto'));
            expect(ids(await store.read(), 'rooms')).toEqual(['c', 'a', 'b']);
            const remove = changeOf(await store.submit({ ops: [{ op: 'removeItem', list: 'rooms', id: 'a', seen: { title: 'Blue room' } }], by: 'ana' }, 'auto'));
            expect(ids(await store.read(), 'rooms')).toEqual(['c', 'b']);
            changeOf(await store.undo(remove.id, 'jj'));
            expect(ids(await store.read(), 'rooms')).toEqual(['c', 'a', 'b']);
            expect((await store.read()).lists.rooms?.[1]?.values).toEqual({ title: 'Blue room' });
            changeOf(await store.undo(move.id, 'jj'));
            expect(ids(await store.read(), 'rooms')).toEqual(['a', 'b', 'c']);
        });
        it('refuses a change that is empty, too long, touches a text twice, or names an unknown text', async () => {
            const store = await start();
            expect(refusalOf(await store.submit({ ops: [], by: 'ana' }, 'auto'))).toMatchObject({ reason: 'invalid' });
            const many = Array.from({ length: 51 }, (_, i) => ({ op: 'addItem', list: 'rooms', id: `n${i}`, values: { title: 'x' }, after: null }));
            expect(refusalOf(await store.submit({ ops: many, by: 'ana' }, 'auto'))).toMatchObject({ reason: 'invalid' });
            expect(refusalOf(await store.submit({ ops: [setText('home.title', 'Hello', 'A'), setText('home.title', 'Hello', 'B')], by: 'ana' }, 'auto'))).toMatchObject({ reason: 'invalid' });
            expect(refusalOf(await store.submit({ ops: [setText('no.such', 'x', 'A')], by: 'ana' }, 'auto'))).toMatchObject({ reason: 'invalid' });
            expect(await store.read()).toEqual(INITIAL);
        });
        it('unknown ids are not found, and lists pages newest first', async () => {
            const store = await start();
            expect(refusalOf(await store.approve('nope', 'jj'))).toEqual({ reason: 'not-found' });
            expect(refusalOf(await store.undo('nope', 'jj'))).toEqual({ reason: 'not-found' });
            const made = [];
            for (const text of ['1', '2', '3']) {
                made.push(changeOf(await store.submit({ ops: [setText('home.title', (await store.read()).texts['home.title'] ?? '', text)], by: 'ana' }, 'auto')).id);
            }
            const first = await store.list({ limit: 2 });
            expect(first.changes.map((c) => c.id)).toEqual([made[2], made[1]]);
            expect(first.next).not.toBeNull();
            const second = await store.list({ limit: 2, cursor: first.next ?? undefined });
            expect(second.changes.map((c) => c.id)).toEqual([made[0]]);
            expect(second.next).toBeNull();
        });
    });
}
