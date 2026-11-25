// The dock as a React component. It renders an empty element, and initDock fills it after
// mount, from the bundle, so it needs no inline script under a CSP.
import { useEffect, useRef } from 'react';
import { initDock, type DockSection } from './dock.js';
import { editingSection } from './editing-section.js';
import { feedbackSection } from './feedback-section.js';
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

export function Dock({ siteId, address, submit, sections, className }: DockProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () => (ref.current ? initDock(ref.current, { siteId, sections: [feedbackSection({ siteId, address, submit }), editingSection(), ...(sections ?? [])] }) : undefined),
    [siteId, address, submit, sections],
  );
  return <div ref={ref} className={className} data-dock-root="" />;
}
