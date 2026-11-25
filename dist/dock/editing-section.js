import { staffStatus } from './staff.js';
export function editingSection(options = {}) {
    let status = null;
    return {
        id: 'editing',
        label: 'editing',
        async visible() {
            status = await staffStatus(options);
            return status !== null;
        },
        render(el) {
            if (!status)
                return;
            const doc = el.ownerDocument;
            const { pathname, search } = doc.location;
            const edit = doc.createElement('a');
            edit.className = 'dock-link';
            edit.textContent = 'Edit this page';
            edit.href = `/admin/edit?page=${encodeURIComponent(pathname + search)}`;
            el.append(edit);
            if (status.role === 'admin' && status.waiting > 0) {
                const waiting = doc.createElement('a');
                waiting.className = 'dock-link';
                waiting.textContent = `${status.waiting} ${status.waiting === 1 ? 'change' : 'changes'} waiting`;
                waiting.href = '/admin/changes';
                el.append(waiting);
            }
        },
    };
}
