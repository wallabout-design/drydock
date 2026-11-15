// Reading content: text(key) and list(name) over a loaded snapshot. Plain
// TypeScript: loaders hand in files or rows, nothing here touches a store.
import type { Content } from './declare.js';
import type { ContentDeclaration, ItemValues } from './types.js';

/**
 * A site makes its keys known to the types by merging its content in once:
 *
 *     declare module '@wallabout-design/editor' {
 *       interface Register { content: typeof content }
 *     }
 *
 * Until then every key is a `string`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

type Declared = Register extends { content: Content<infer D> } ? D : ContentDeclaration;

type KeysOf<D extends ContentDeclaration> = D extends { texts: readonly (infer T)[] } ? (T extends { key: infer K extends string } ? K : never) : never;
type NamesOf<D extends ContentDeclaration> = D extends { lists: readonly (infer L)[] } ? (L extends { name: infer N extends string } ? N : never) : never;

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

export const EMPTY_SNAPSHOT: Snapshot = { texts: {}, lists: {} };

export type Report = (message: string, fields?: Record<string, unknown>) => void;

export interface Reader<D extends ContentDeclaration = Declared> {
  /** The text for a key: the edited words, or the declared default. */
  text(key: TextKey<D>): string;
  /** The items of a list, in the list's order. Empty when nothing is loaded. */
  list(name: ListName<D>): readonly ListItem[];
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Reads from a snapshot. A text with no edit gives its default; an unknown key or list throws, since the types should have caught it. */
export function createReader<D extends ContentDeclaration>(content: Content<D>, snapshot: Snapshot = EMPTY_SNAPSHOT): Reader<D> {
  return {
    text(key) {
      const declaration = content.texts.get(key);
      if (!declaration) throw new Error(`"${key}" is not a declared text key`);
      return has(snapshot.texts, key) ? snapshot.texts[key]! : declaration.default;
    },
    list(name) {
      if (!content.lists.has(name)) throw new Error(`"${name}" is not a declared list`);
      return has(snapshot.lists, name) ? snapshot.lists[name]! : [];
    },
  };
}

/** Puts items in the list's order. By hand, the given order stands; otherwise by the sort field. */
export function orderItems(content: Content, list: string, items: ListItem[]): ListItem[] {
  const sort = content.lists.get(list)?.sort;
  if (sort === undefined || sort === 'hand') return items;
  const direction = sort.order === 'desc' ? -1 : 1;
  const by = sort.by;
  return [...items].sort((a, b) => {
    const x = a.values[by];
    const y = b.values[by];
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * direction;
  });
}

/**
 * Builds a snapshot from items and edited texts as stored, checking each
 * against the declaration. A text that is not declared or fails its checks is
 * left out (the default shows); an item that fails its checks is left out.
 * Both are reported, never thrown, so one bad file can't take the page down.
 */
export function buildSnapshot(
  content: Content,
  stored: { texts?: Iterable<[string, unknown]>; lists?: Iterable<[string, ListItemInput]> },
  report: Report = () => {},
): Snapshot {
  const texts: Record<string, string> = {};
  for (const [key, value] of stored.texts ?? []) {
    if (!content.texts.has(key)) {
      report('content: a stored text has no declaration', { key });
      continue;
    }
    const check = content.validateText(key, value);
    if (check.ok) texts[key] = check.text;
    else report('content: a stored text is not valid', { key, problems: check.problems.map((p) => p.kind) });
  }
  const grouped = new Map<string, ListItem[]>();
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
  const lists: Record<string, readonly ListItem[]> = {};
  for (const [list, items] of grouped) lists[list] = orderItems(content, list, items);
  return { texts, lists };
}

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
 *   come in file name order (`001-first.json`).
 */
export function snapshotFromFiles(content: Content, files: Readonly<Record<string, string>>, report: Report = () => {}): Snapshot {
  const texts: [string, unknown][] = [];
  const lists: [string, ListItemInput][] = [];
  for (const path of Object.keys(files).sort()) {
    const m = /(?:^|\/)content\/(.+)$/.exec(path) ?? /^(.+)$/.exec(path);
    const rel = m![1]!;
    let json: unknown;
    try {
      json = JSON.parse(files[path]!);
    } catch {
      report('content: a content file is not JSON', { path: rel });
      continue;
    }
    if (rel === 'texts.json') {
      if (json && typeof json === 'object' && !Array.isArray(json)) texts.push(...Object.entries(json));
      else report('content: texts.json is not an object', { path: rel });
      continue;
    }
    const parts = /^([^/]+)\/([^/]+)\.json$/.exec(rel);
    if (!parts) {
      report('content: a content file is not where one belongs', { path: rel });
      continue;
    }
    lists.push([parts[1]!, { id: parts[2]!, fields: json }]);
  }
  return buildSnapshot(content, { texts, lists }, report);
}

/** `data-list` for the container of a list. */
export function listAttrs<D extends ContentDeclaration = Declared>(name: ListName<D>): { 'data-list': string } {
  return { 'data-list': name };
}
/** `data-item` for one item of a list. */
export function itemAttrs(item: Pick<ListItem, 'id'>): { 'data-item': string } {
  return { 'data-item': item.id };
}
/** `data-copy` for an element that shows a text. */
export function textAttrs<D extends ContentDeclaration = Declared>(key: TextKey<D>): { 'data-copy': string } {
  return { 'data-copy': key };
}
