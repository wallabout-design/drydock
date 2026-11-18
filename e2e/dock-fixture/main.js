import { initDock, feedbackSection } from '/dist/dock/index.js';

const params = new URLSearchParams(location.search);
const sections = [feedbackSection({ siteId: 'test' })];
// A stand-in for the editing section (its own issue): registered first, to show the fixed order.
if (params.has('extra')) {
  sections.unshift({
    id: 'editing',
    label: 'editing',
    visible: () => true,
    render: (el) => {
      const a = document.createElement('a');
      a.href = '/admin/edit';
      a.textContent = 'edit this page';
      el.append(a);
    },
  });
}
window.dockCleanup = initDock(document.getElementById('dock'), { siteId: 'test', sections });
