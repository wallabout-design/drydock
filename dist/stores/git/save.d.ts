import { type Operation } from '../../core/change.js';
import type { Content } from '../../core/declare.js';
export interface GitStoreConfig {
    /** The branch the site deploys from, e.g. "main". */
    base: string;
    /** Edits go to `<branchPrefix><editor>-<hash>/<date>`. Default "content-edit/". */
    branchPrefix: string;
    /** The site's name in pull request text, e.g. "wallabout.design". */
    site: string;
    /** The label a pull request in `review` carries until an admin approves it. */
    reviewLabel: string;
    /** The check that must have passed on a commit before an approval merges it. */
    requiredCheck: string;
    /** How an undo goes live. Default `auto`. */
    undoMode: 'auto' | 'review';
}
export declare const DEFAULT_CONFIG: {
    readonly base: 'main';
    readonly branchPrefix: 'content-edit/';
    readonly reviewLabel: 'content:waiting-review';
    readonly requiredCheck: 'test';
    readonly undoMode: 'auto';
};
/** How many times a save starts again when another save moved the base branch or the branch under it. */
export declare const SAVE_ATTEMPTS = 3;
/** An email as part of a branch name: "ada@example.org" becomes "ada-example-org". */
export declare const editorSlug: (email: string) => string;
/**
 * The start of every branch name for one editor: "content-edit/ada-example-org-1a2b3c4d/".
 * The hash is of the whole email, so two addresses with the same slug get
 * different branches, and the "/" ends it, so one editor's names never start with another's.
 */
export declare function editorStem(prefix: string, email: string): Promise<string>;
/** The part of a branch name after the stem that a save's own branch has: a date, then perhaps "-2". */
export declare const SAVE_BRANCH: RegExp;
/** An undo's branch: "…/undo-<id of the change it undoes>", then perhaps "-2". */
export declare const UNDO_BRANCH: RegExp;
export interface Saved {
    editor: string;
    ops: Operation[];
    reverse: Operation[];
    /** The id of the change this one undoes. */
    undoes?: string;
}
export declare function commitMessage(saved: Saved): string;
/** What a save's commit message says, or null when it is not one (a person's own commit). */
export declare function readCommitMessage(message: string): Saved | null;
export type Normalized = {
    ok: true;
    ops: Operation[];
} | {
    ok: false;
    message: string;
};
/**
 * Checks each operation against the declaration, with the same rules the editor
 * ran, and returns it with its values cleaned. `seen` is not touched: it is
 * compared with what is stored, not with what the declaration allows.
 */
export declare function normalizeOps(content: Content, ops: readonly Operation[]): Normalized;
/**
 * The waiting operations plus the new ones, as one list in which each text or
 * item appears once. Two edits of the same place become one, kept as the first
 * saw it. Null when two operations on one place can't be one operation: the
 * editor has to wait for the first to go live.
 */
export declare function composeOps(waiting: readonly Operation[], next: readonly Operation[]): Operation[] | null;
/** The pull request's title and body: Problem, Solution, Validation, naming the editor. Old and new text sit in code blocks, so nothing typed into the page can mention people or render as Markdown. */
export declare function pullText(config: Pick<GitStoreConfig, 'site' | 'base' | 'reviewLabel'>, editor: string, ops: readonly Operation[], review: boolean, undoes?: string): {
    title: string;
    body: string;
};
