import type { ItemValues } from './types.js';
/** The most operations in one change (content-editing.md, "limits"). */
export declare const MAX_OPERATIONS = 50;
/** One list item as stored: an id that never changes, and its fields. */
export interface ListItem {
    id: string;
    values: ItemValues;
}
/** The content as stored: every text's words, and every list's items in order. */
export interface ContentState {
    texts: Record<string, string>;
    lists: Record<string, ListItem[]>;
}
/**
 * One operation on the content. `seen` is what the editor last saw in the place
 * the operation changes; for `addItem` it is `after`, the item the new one goes
 * after (null for the first place). A store refuses the whole change if any of
 * them no longer matches the content.
 */
export type Operation = {
    op: 'setText';
    key: string;
    text: string;
    seen: string;
} | {
    op: 'addItem';
    list: string;
    id: string;
    values: ItemValues;
    after: string | null;
} | {
    op: 'editItem';
    list: string;
    id: string;
    values: ItemValues;
    seen: ItemValues;
} | {
    op: 'removeItem';
    list: string;
    id: string;
    seen: ItemValues;
} | {
    op: 'moveItem';
    list: string;
    id: string;
    after: string | null;
    seen: string | null;
};
export type Applied = {
    ok: true;
    state: ContentState;
    reverse: Operation[];
} | {
    ok: false;
    reason: 'stale';
    index: number;
} | {
    ok: false;
    reason: 'invalid';
    message: string;
};
/**
 * Checks the operations against `state` as the editor saw it, and applies them in
 * order. Nothing is changed: the result carries the new state, or a refusal.
 * `reverse` holds the operations that put `state` back, already in the order to
 * run them. Each operation may touch a text or an item only once per change.
 */
export declare function applyOperations(state: ContentState, ops: readonly Operation[]): Applied;
