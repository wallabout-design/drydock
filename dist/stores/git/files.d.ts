import type { ContentState } from '../../core/change.js';
import type { Content } from '../../core/declare.js';
export declare const CONTENT_DIR = "content/";
export declare const TEXTS_PATH = "content/texts.json";
/** An item id is also its file name. */
export declare const ITEM_ID: RegExp;
export declare const itemPath: (list: string, id: string) => string;
/** True for a path the git store may write: inside `content/`, with no way out of it. */
export declare const isContentPath: (path: string) => boolean;
/** Where each item of each hand-sorted list sits: list name to item id to `position`. */
export type Positions = Map<string, Map<string, number>>;
export interface Loaded {
    state: ContentState;
    positions: Positions;
}
/**
 * The content as the files hold it. Every declared text is there (the default
 * unless the file has an edit), and every declared list. A file that is not
 * JSON, is not declared, or fails its checks is left out, so one bad file can't
 * stop a save; it is not rewritten either, unless the change touches it.
 */
export declare function loadContentFiles(content: Content, files: Readonly<Record<string, string>>): Loaded;
/** Positions for `order`, changing as few as possible: items whose old position still fits keep it. */
export declare function assignPositions(order: readonly string[], previous: ReadonlyMap<string, number>): Map<string, number>;
export interface Rendered {
    /** Path to the file's text, for every content file the state needs. */
    files: Record<string, string>;
    positions: Positions;
}
/**
 * The files for a state. `previous` holds the positions the files had, so items
 * that did not move keep theirs.
 */
export declare function renderContentFiles(content: Content, state: ContentState, previous?: Positions): Rendered;
/** The files to write to go from one rendering to another: new text, or null to delete. */
export declare function fileChanges(before: Rendered, after: Rendered): Record<string, string | null>;
