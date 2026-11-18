export interface DockSection {
    /** Names the section and sets its place: `feedback`, then `editing`. */
    id: string;
    /** A short lowercase label: the panel's heading when there is more than one section, and the launcher's name when there is one. */
    label: string;
    /** Whether this browser should see the section. Called once, when the dock starts. A rejection counts as false. */
    visible(): boolean | Promise<boolean>;
    /** Fills `el` with the section's links and buttons. May return a function that undoes what it set up. */
    render(el: HTMLElement): void | (() => void);
}
export interface DockOptions {
    /** Short site ID, such as `rr`. Sections use it (the feedback subject tag), and the dock marks its root with it. */
    siteId: string;
    sections: DockSection[];
    /** The launcher's name when two or more sections show. Defaults to `dock`. */
    label?: string;
}
/** The fixed order of the sections. Any other id goes after these, in the order given. */
export declare const SECTION_ORDER: string[];
/**
 * Shows the dock in `root` (an empty element the page owns) when at least one section is visible,
 * and returns a function that removes it. Without a visible section the root stays empty.
 */
export declare function initDock(root: HTMLElement, { siteId, sections, label }: DockOptions): () => void;
