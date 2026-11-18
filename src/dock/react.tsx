// The dock as a React component. It renders an empty element, and initDock fills it after
// mount, from the bundle, so it needs no inline script under a CSP.
import { useEffect, useRef } from 'react';
import { initDock, type DockSection } from './dock.js';
import { feedbackSection } from './feedback-section.js';

export interface DockProps {
  siteId: string;
  /** Feedback's email address, when it is not the default. */
  address?: string;
  /** Sections besides feedback, which the dock always has. */
  sections?: DockSection[];
  className?: string;
}

export function Dock({ siteId, address, sections, className }: DockProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () => (ref.current ? initDock(ref.current, { siteId, sections: [feedbackSection({ siteId, address }), ...(sections ?? [])] }) : undefined),
    [siteId, address, sections],
  );
  return <div ref={ref} className={className} data-dock-root="" />;
}
