import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../src/index.js';
import { INITIAL } from '../src/testing/index.js';

describe('applyOperations', () => {
  it('a change and its reverse give back the start', () => {
    const ops: Operation[] = [
      { op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' },
      { op: 'addItem', list: 'rooms', id: 'd', values: { title: 'New room' }, after: 'a' },
      { op: 'removeItem', list: 'rooms', id: 'b', seen: { title: 'Green room' } },
    ];
    const applied = applyOperations(structuredClone(INITIAL), ops);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.state.lists.rooms?.map((i) => i.id)).toEqual(['a', 'd']);
    const back = applyOperations(applied.state, applied.reverse);
    expect(back.ok && back.state).toEqual(INITIAL);
  });

  it('reports the index of the first stale operation and changes nothing', () => {
    const ops: Operation[] = [
      { op: 'setText', key: 'home.title', seen: 'Hello', text: 'Hi' },
      { op: 'editItem', list: 'rooms', id: 'a', values: { title: 'x' }, seen: { title: 'Not it' } },
    ];
    const applied = applyOperations(structuredClone(INITIAL), ops);
    expect(applied).toEqual({ ok: false, reason: 'stale', index: 1 });
  });

  it('a move onto an item that an earlier operation removed is invalid, not applied', () => {
    const ops: Operation[] = [
      { op: 'removeItem', list: 'rooms', id: 'a', seen: { title: 'Blue room' } },
      { op: 'moveItem', list: 'rooms', id: 'b', after: 'a', seen: 'a' },
    ];
    expect(applyOperations(structuredClone(INITIAL), ops)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
