// The dock's feedback form in real browsers: a reviewer types a note and it is posted to the site's
// feedback route (served by e2e/server.mjs, with the real createFeedback). Signed out, the note stays in
// the box and the section offers sign-in and the mailto with the note in it. Too long is refused before sending.
import { expect, test, type Page } from '@playwright/test';
import { AUTO } from './ports.js';

const pagePath = '/__test/dock-feedback.html?feedback';
const launcher = (page: Page) => page.locator('[data-dock-launcher]');
const panel = (page: Page) => page.locator('[data-dock-panel]');
const note = (page: Page) => panel(page).getByRole('textbox', { name: 'Your note' });
const send = (page: Page) => panel(page).getByRole('button', { name: 'Send', exact: true });
const status = (page: Page) => panel(page).getByRole('status');

async function signInAs(page: Page, email: string) {
  await page.context().addCookies([{ name: 'test-user', value: email, url: AUTO }]);
}

async function sunkNotes(page: Page) {
  return (await (await page.request.get(`${AUTO}/__test/notes`)).json()) as { subject: string; note: string; sender: string }[];
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${AUTO}/__test/reset`);
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('a signed-in reviewer sends a note, and sees the reference', async ({ page }) => {
  await signInAs(page, 'ed@example.com');
  await page.goto(`${AUTO}${pagePath}`);
  await expect(launcher(page)).toHaveText('feedback');
  await launcher(page).click();
  await note(page).fill('The bridge is loose.');
  await send(page).click();
  await expect(status(page)).toHaveText('Sent. Reference: note-1');
  await expect(note(page)).toHaveValue('');
  const sent = await sunkNotes(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ note: 'The bridge is loose.', sender: 'ed@example.com' });
  expect(sent[0].subject).toMatch(/^\[test\] \/__test\/dock-feedback\.html #[a-z0-9]{4}$/);
});

test('signed out: the note stays, sign-in and the mailto with the note are offered, nothing is posted', async ({ page }) => {
  await page.goto(`${AUTO}${pagePath}`);
  await launcher(page).click();
  await note(page).fill('Please check the door.');
  await send(page).click();
  await expect(status(page)).toContainText('sign in');
  await expect(note(page)).toHaveValue('Please check the door.');
  const signIn = panel(page).getByRole('link', { name: 'Sign in to send' });
  await expect(signIn).toHaveAttribute('href', '/feedback/api/notes');
  await expect(signIn).toHaveAttribute('target', '_blank');
  const email = panel(page).getByRole('link', { name: 'Send by email instead' });
  await expect(email).toHaveAttribute('href', /^mailto:feedback@wallabout\.design\?/);
  const body = new URL((await email.getAttribute('href')) ?? '').searchParams.get('body') ?? '';
  expect(body).toContain('Please check the door.');
  expect(await sunkNotes(page)).toEqual([]);
});

test('a note over 5,000 characters is refused before it is sent', async ({ page }) => {
  await signInAs(page, 'ed@example.com');
  let posted = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/feedback/api/notes') posted += 1;
  });
  await page.goto(`${AUTO}${pagePath}`);
  await launcher(page).click();
  await note(page).fill('x'.repeat(5001));
  await expect(panel(page).locator('.dock-count')).toHaveText('5001 / 5000');
  await send(page).click();
  await expect(status(page)).toContainText('at most 5000 characters');
  expect(posted).toBe(0);
  expect(await sunkNotes(page)).toEqual([]);
});

test('the feedback routine looks up the sender of a sent note with a service token, and a browser session cannot', async ({ page, playwright }) => {
  await signInAs(page, 'ed@example.com');
  await page.goto(`${AUTO}${pagePath}`);
  await launcher(page).click();
  await note(page).fill('The bridge is loose.');
  await send(page).click();
  await expect(status(page)).toHaveText('Sent. Reference: note-1');

  const lookup = async (cookie: string, ref = 'note-1') => {
    const context = await playwright.request.newContext({ extraHTTPHeaders: { cookie } });
    try {
      const res = await context.get(`${AUTO}/feedback/api/sender?ref=${ref}`);
      return { status: res.status(), body: await res.text() };
    } finally {
      await context.dispose();
    }
  };
  expect(await lookup('service-token=routine-id.access')).toEqual({ status: 200, body: '{"email":"ed@example.com"}' });
  expect((await lookup('service-token=routine-id.access', 'note-9')).status).toBe(404);
  expect(await lookup('service-token=someone-else')).toEqual({ status: 403, body: '' });
  expect(await lookup('test-user=ed@example.com')).toEqual({ status: 403, body: '' });
  expect(await lookup('test-user=boss@example.com')).toEqual({ status: 403, body: '' });
});
