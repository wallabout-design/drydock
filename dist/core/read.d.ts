import type { Content } from './declare.js';
import type { ContentDeclaration, ItemValues } from './types.js';
/**
 * A site makes its keys known to the types by merging its content in once:
 *
 *     declare module '@wallabout-design/drydock' {
 *       interface Register { content: typeof content }
 *     }
 *
 * Until then every key is a `string`.
 */
export interface Register {
}
type Declared = Register extends {
    content: Content<infer D>;
} ? D : ContentDeclaration;
type KeysOf<D extends ContentDeclaration> = D extends {
    texts: readonly (infer T)[];
} ? (T extends {
    key: infer K extends string;
} ? K : never) : never;
type NamesOf<D extends ContentDeclaration> = D extends {
    lists: readonly (infer L)[];
} ? (L extends {
    name: infer N extends string;
} ? N : never) : never;
/** The text keys the site declared. An unknown key is a type error. */
export type TextKey<D extends ContentDeclaration = Declared> = [KeysOf<D>] extends [never] ? string : KeysOf<D>;
/** The list names the site declared. */
export type ListName<D extends ContentDeclaration = Declared> = [NamesOf<D>] extends [never] ? string : NamesOf<D>;
/** One item of a list: a stable id (also its `data-item`) and its fields. */
export interface ListItem {
    id: string;
    values: ItemValues;
}
/** What was loaded: the edited texts (only those that differ from the defaults) and the items of each list. */
export interface Snapshot {
    texts: Readonly<Record<string, string>>;
    lists: Readonly<Record<string, readonly ListItem[]>>;
}
export declare const EMPTY_SNAPSHOT: Snapshot;
export type Report = (message: string, fields?: Record<string, unknown>) => void;
export interface Reader<D extends ContentDeclaration = Declared> {
    /** The text for a key: the edited words, or the declared default. */
    text(key: TextKey<D>): string;
    /** The items of a list, in the list's order. Empty when nothing is loaded. */
    list(name: ListName<D>): readonly ListItem[];
}
/** Reads from a snapshot. A text with no edit gives its default; an unknown key or list throws, since the types should have caught it. */
export declare function createReader<D extends ContentDeclaration>(content: Content<D>, snapshot?: Snapshot): Reader<D>;
/** Puts items in the list's order. By hand, the given order stands; otherwise by the sort field. */
export declare function orderItems(content: Content, list: string, items: ListItem[]): ListItem[];
/**
 * Builds a snapshot from items and edited texts as stored, checking each
 * against the declaration. A text that is not declared or fails its checks is
 * left out (the default shows); an item that fails its checks is left out.
 * Both are reported, never thrown, so one bad file can't take the page down.
 */
export declare function buildSnapshot(content: Content, stored: {
    texts?: Iterable<[string, unknown]>;
    lists?: Iterable<[string, ListItemInput]>;
}, report?: Report): Snapshot;
export interface ListItemInput {
    id: string;
    fields: unknown;
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
export declare function snapshotFromFiles(content: Content, files: Readonly<Record<string, string>>, report?: Report): Snapshot;
/** `data-list` for the container of a list. */
export declare function listAttrs<D extends ContentDeclaration = Declared>(name: ListName<D>): {
    'data-list': string;
};
/** `data-item` for one item of a list. */
export declare function itemAttrs(item: Pick<ListItem, 'id'>): {
    'data-item': string;
};
/** `data-copy` for an element that shows a text. */
export declare function textAttrs<D extends ContentDeclaration = Declared>(key: TextKey<D>): {
    'data-copy': string;
};
export {};
