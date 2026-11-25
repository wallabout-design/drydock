import { describe, expect, it } from 'vitest';
import { editingSection } from '../src/dock/editing-section.js';

type Fetch = typeof fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hinted = { getItem: () => '1' };
const bare = { getItem: () => null };

/** A fetch that answers /admin/api/me with `body`, or 403 for null (signed out). */
function answering(body: unknown | null): Fetch {
  return async () => (body === null ? json({ error: 'forbidden' }, 403) : json(body));
}

/** The smallest element that the section's render() can fill: links appended in order. */
function fakeElement(pathname: string, search: string) {
  const children: { textContent: string; href: string; className: string }[] = [];
  const doc = {
    location: { pathname, search },
    createElement: () => ({ textContent: '', href: '', className: '' }),
  };
  const el = {
    ownerDocument: doc,
    append: (...nodes: (typeof children)[number][]) => children.push(...nodes),
  };
  return { el: el as unknown as HTMLElement, children };
}

describe('editingSection', () => {
  it('is hidden without the staff hint, and makes no request', async () => {
    let asked = false;
    const section = editingSection({ fetch: async () => ((asked = true), json({ email: 'a@b.c', role: 'admin', waiting: 2 })), storage: bare });
    expect(await section.visible()).toBe(false);
    expect(asked).toBe(false);
  });

  it('is hidden when signed out', async () => {
    const section = editingSection({ fetch: answering(null), storage: hinted });
    expect(await section.visible()).toBe(false);
  });

  it('is shown to an editor, who gets "Edit this page" and no waiting link', async () => {
    const section = editingSection({ fetch: answering({ email: 'ed@example.com', role: 'editor', waiting: 0 }), storage: hinted });
    expect(await section.visible()).toBe(true);
    const { el, children } = fakeElement('/about', '?x=1&y=2');
    section.render(el);
    expect(children.map((c) => [c.textContent, c.href])).toEqual([['Edit this page', '/admin/edit?page=%2Fabout%3Fx%3D1%26y%3D2']]);
  });

  it('adds the waiting link for an admin with changes, singular for one', async () => {
    const section = editingSection({ fetch: answering({ email: 'boss@example.com', role: 'admin', waiting: 1 }), storage: hinted });
    await section.visible();
    const { el, children } = fakeElement('/', '');
    section.render(el);
    expect(children.map((c) => c.textContent)).toEqual(['Edit this page', '1 change waiting']);
    expect(children[1]?.href).toBe('/admin/changes');
  });

  it('shows no waiting link to an admin with none waiting', async () => {
    const section = editingSection({ fetch: answering({ email: 'boss@example.com', role: 'admin', waiting: 0 }), storage: hinted });
    await section.visible();
    const { el, children } = fakeElement('/', '');
    section.render(el);
    expect(children.map((c) => c.textContent)).toEqual(['Edit this page']);
  });
});
