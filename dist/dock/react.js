import { jsx as _jsx } from "react/jsx-runtime";
// The dock as a React component. It renders an empty element, and initDock fills it after
// mount, from the bundle, so it needs no inline script under a CSP.
import { useEffect, useRef } from 'react';
import { initDock } from './dock.js';
import { feedbackSection } from './feedback-section.js';
export function Dock({ siteId, address, sections, className }) {
    const ref = useRef(null);
    useEffect(() => (ref.current ? initDock(ref.current, { siteId, sections: [feedbackSection({ siteId, address }), ...(sections ?? [])] }) : undefined), [siteId, address, sections]);
    return _jsx("div", { ref: ref, className: className, "data-dock-root": "" });
}
