import type { Content } from './declare.js';
import type { ItemCheck, TextCheck } from './types.js';
/** Cleans and checks a keyed text. */
export declare function checkText(content: Content, key: string, raw: unknown): TextCheck;
/** Cleans and checks an item's fields against its list. Every problem is reported at once. */
export declare function checkItem(content: Content, listName: string, raw: unknown): ItemCheck;
