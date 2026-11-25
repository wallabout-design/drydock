import { type DockSection } from './dock.js';
import type { SubmitTransport } from '../feedback/transports.js';
export interface DockProps {
    siteId: string;
    /** Feedback's email address, when it is not the default. */
    address?: string;
    /** Sends feedback notes from a text box to the site's Worker, with the mailto as the fallback. */
    submit?: SubmitTransport;
    /** Sections after feedback and editing, which the dock always has. */
    sections?: DockSection[];
    className?: string;
}
export declare function Dock({ siteId, address, submit, sections, className }: DockProps): import("react").JSX.Element;
