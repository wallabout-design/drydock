import type { ContentDeclaration, ItemCheck, ListDeclaration, Rule, TextCheck, TextDeclaration } from './types.js';
/** A declaration that can't be used. `problems` has one line per mistake. */
export declare class DeclarationError extends Error {
    readonly problems: string[];
    constructor(problems: string[]);
}
/** The declaration after checking: lists with their defaults filled in. */
export interface Content<D extends ContentDeclaration = ContentDeclaration> {
    /** Type-level only: the declaration, so keys and list names can be checked. Never set. */
    readonly declared?: D;
    texts: ReadonlyMap<string, TextDeclaration>;
    lists: ReadonlyMap<string, ListDeclaration & {
        maxItems: number;
    }>;
    rules: readonly Rule[];
    /** Cleans and checks a new text for a key. Unknown keys are a problem, not a throw. */
    validateText(key: string, text: unknown): TextCheck;
    /** Cleans and checks an item's fields against a list. */
    validateItem(list: string, fields: unknown): ItemCheck;
}
/**
 * Checks a declaration and returns the checkers for it. Throws a
 * DeclarationError for: a repeated text key, list, field or rule name; a text
 * key not shaped `<page>.<name>`; a list without a required text title field;
 * a limit over the hard maximum; or a default text that fails its own checks.
 */
export declare function defineContent<const D extends ContentDeclaration>(declaration: D): Content<D>;
