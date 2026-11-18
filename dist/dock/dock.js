// The dock: one launcher and one panel for everything a page offers to staff and reviewers
// (standards drydock.md, "the dock"). Each feature registers a section; the dock shows the
// sections this browser may use, and nothing at all when there are none. Every decision
// about who may do what stays on the server: a section only shows links and buttons.
//
// Nothing runs at import. `initDock` is the only entry, and a section's `visible()` is
// where it decides whether this browser has opted in (so an ordinary visitor makes no request).
/** The fixed order of the sections. Any other id goes after these, in the order given. */
export const SECTION_ORDER = ['feedback', 'editing'];
const rank = (id) => {
    const i = SECTION_ORDER.indexOf(id);
    return i === -1 ? SECTION_ORDER.length : i;
};
let counter = 0;
async function safeVisible(section) {
    try {
        return (await section.visible()) === true;
    }
    catch {
        return false;
    }
}
/**
 * Shows the dock in `root` (an empty element the page owns) when at least one section is visible,
 * and returns a function that removes it. Without a visible section the root stays empty.
 */
export function initDock(root, { siteId, sections, label = 'dock' }) {
    let stopped = false;
    const cleanups = [];
    const stop = () => {
        stopped = true;
        for (const fn of cleanups.splice(0).reverse())
            fn();
        root.replaceChildren();
    };
    const ordered = sections.map((section, index) => ({ section, index })).sort((a, b) => rank(a.section.id) - rank(b.section.id) || a.index - b.index).map((x) => x.section);
    void (async () => {
        const shown = (await Promise.all(ordered.map(async (s) => ((await safeVisible(s)) ? s : null)))).filter((s) => s !== null);
        if (stopped || shown.length === 0)
            return;
        const n = ++counter;
        const panelId = `dock-panel-${n}`;
        const doc = root.ownerDocument;
        root.dataset.dock = '';
        root.dataset.site = siteId;
        const launcher = doc.createElement('button');
        launcher.type = 'button';
        launcher.className = 'dock-launcher';
        launcher.dataset.dockLauncher = '';
        launcher.textContent = shown.length === 1 ? shown[0].label : label;
        launcher.setAttribute('aria-expanded', 'false');
        launcher.setAttribute('aria-controls', panelId);
        const panel = doc.createElement('div');
        panel.id = panelId;
        panel.className = 'dock-panel';
        panel.dataset.dockPanel = '';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', shown.length === 1 ? shown[0].label : label);
        panel.hidden = true;
        for (const section of shown) {
            const box = doc.createElement('div');
            box.className = 'dock-section';
            box.dataset.dockSection = section.id;
            if (shown.length > 1) {
                const heading = doc.createElement('h2');
                heading.className = 'dock-heading';
                heading.textContent = section.label;
                box.append(heading);
            }
            const body = doc.createElement('div');
            box.append(body);
            panel.append(box);
            try {
                const undo = section.render(body);
                if (undo)
                    cleanups.push(undo);
            }
            catch {
                box.remove();
            }
        }
        let isOpen = false;
        const setOpen = (open, returnFocus = false) => {
            isOpen = open;
            panel.hidden = !open;
            launcher.setAttribute('aria-expanded', String(open));
            if (open) {
                panel.querySelector('a[href], button, input, textarea, select, [tabindex]')?.focus();
            }
            else if (returnFocus) {
                launcher.focus();
            }
        };
        const onLauncher = () => setOpen(!isOpen);
        const onKey = (event) => {
            if (event.key === 'Escape' && isOpen) {
                event.preventDefault();
                setOpen(false, true);
            }
        };
        launcher.addEventListener('click', onLauncher);
        doc.addEventListener('keydown', onKey);
        cleanups.push(() => {
            launcher.removeEventListener('click', onLauncher);
            doc.removeEventListener('keydown', onKey);
        });
        root.replaceChildren(launcher, panel);
    })();
    return stop;
}
