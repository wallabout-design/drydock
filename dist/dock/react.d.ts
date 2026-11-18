import { type DockSection } from './dock.js';
export interface DockProps {
    siteId: string;
    /** Feedback's email address, when it is not the default. */
    address?: string;
    /** Sections besides feedback, which the dock always has. */
    sections?: DockSection[];
    className?: string;
}
export declare function Dock({ siteId, address, sections, className }: DockProps): import("react").JSX.Element;
