// An in-memory Store, for tests here and in sites. It keeps everything in
// memory and forgets it when the process ends. Each call checks and applies
// without an await in between, so two submits can't both win.
import { applyOperations } from './change.js';
export function fakeStore(options = {}) {
    let content = structuredClone(options.initial ?? { texts: {}, lists: {} });
    const now = options.now ?? (() => new Date().toISOString());
    const changes = []; // oldest first
    let count = 0;
    const copy = (value) => structuredClone(value);
    const nextId = () => `c${++count}`;
    const refuse = (refusal) => ({ ok: false, refusal });
    const find = (id) => changes.find((c) => c.id === id);
    return {
        async read() {
            return copy(content);
        },
        async submit(input, mode) {
            const applied = applyOperations(content, input.ops);
            if (!applied.ok) {
                return refuse(applied.reason === 'stale'
                    ? { reason: 'stale', index: applied.index, current: copy(content) }
                    : { reason: 'invalid', message: applied.message });
            }
            const change = {
                id: nextId(),
                ops: copy(input.ops),
                by: input.by,
                at: now(),
                state: mode === 'auto' ? 'live' : 'waiting',
            };
            if (mode === 'auto') {
                content = applied.state;
                change.reverse = applied.reverse;
            }
            changes.push(change);
            return { ok: true, change: copy(change) };
        },
        async approve(id, by) {
            const change = find(id);
            if (change === undefined)
                return refuse({ reason: 'not-found' });
            if (change.state !== 'waiting')
                return refuse({ reason: 'wrong-state', state: change.state });
            const applied = applyOperations(content, change.ops);
            if (!applied.ok) {
                // The change stays waiting: the admin can reject it, or see what moved on.
                return refuse(applied.reason === 'stale'
                    ? { reason: 'stale', index: applied.index, current: copy(content) }
                    : { reason: 'invalid', message: applied.message });
            }
            content = applied.state;
            change.state = 'live';
            change.reverse = applied.reverse;
            change.decidedBy = by;
            change.decidedAt = now();
            return { ok: true, change: copy(change) };
        },
        async reject(id, by) {
            const change = find(id);
            if (change === undefined)
                return refuse({ reason: 'not-found' });
            if (change.state !== 'waiting')
                return refuse({ reason: 'wrong-state', state: change.state });
            change.state = 'rejected';
            change.decidedBy = by;
            change.decidedAt = now();
            return { ok: true, change: copy(change) };
        },
        async undo(id, by) {
            const original = find(id);
            if (original === undefined)
                return refuse({ reason: 'not-found' });
            if (original.state !== 'live' || original.reverse === undefined) {
                return refuse({ reason: 'wrong-state', state: original.state });
            }
            const applied = applyOperations(content, original.reverse);
            if (!applied.ok) {
                return refuse(applied.reason === 'stale'
                    ? { reason: 'stale', index: applied.index, current: copy(content) }
                    : { reason: 'invalid', message: applied.message });
            }
            content = applied.state;
            original.state = 'undone';
            original.decidedBy = by;
            original.decidedAt = now();
            const undo = {
                id: nextId(),
                ops: copy(original.reverse),
                by,
                at: now(),
                state: 'live',
                undoes: original.id,
                reverse: applied.reverse,
            };
            changes.push(undo);
            return { ok: true, change: copy(undo) };
        },
        async list(query = {}) {
            const limit = query.limit ?? 20;
            const newestFirst = [...changes].reverse();
            let start = 0;
            if (query.cursor !== undefined) {
                const at = newestFirst.findIndex((c) => c.id === query.cursor);
                start = at < 0 ? newestFirst.length : at + 1;
            }
            const matching = newestFirst.slice(start).filter((c) => query.state === undefined || c.state === query.state);
            const page = matching.slice(0, limit);
            const last = page[page.length - 1];
            return {
                changes: page.map(copy),
                next: matching.length > limit && last !== undefined ? last.id : null,
            };
        },
    };
}
