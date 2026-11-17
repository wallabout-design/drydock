import type { Content } from './declare.js';
import type { Field, ImageCrop, ItemCheck, Problem, TextCheck } from './types.js';
/** Cleans and checks a keyed text. */
export declare function checkText(content: Content, key: string, raw: unknown): TextCheck;
/** The shape of an upload's key: `<yyyy>/<mm>/<22 to 32 letters, digits, - or _>`. */
export declare const UPLOAD_KEY: RegExp;
/**
 * Checks the part of an original to show, against the original's size and the field's `aspect`.
 * The upload routes call this too, with the size read from the stored original.
 */
export declare function checkCrop(field: Field & {
    type: 'image';
}, raw: unknown, width: number, height: number): {
    crop: ImageCrop | undefined;
} | {
    problem: Problem;
};
/** Cleans and checks an item's fields against its list. Every problem is reported at once. */
export declare function checkItem(content: Content, listName: string, raw: unknown): ItemCheck;
