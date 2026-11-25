// The dock's editing section in real browsers: a public page asks /admin/api/me only when this browser
// carries the staff hint, and the section shows only to someone signed in. Runs on the auto server
// (one change live at once) and the review server (changes wait for an admin).
import { expect, test, type Page } from '@playwright/test';
import { AUTO, REVIEW } from './ports.js';

const launcher = (page: Page) => page.locator('[data-dock-launcher]');
const panel = (page: Page) => page.locator('[data-dock-panel]');
const pagePath = '/__test/dock-editing.html';

/** Opens the page on `origin` with the staff hint set (as the edit view leaves it), then reloads so the dock sees it. */
async function openWithHint(page: Page, origin: string) {
  await page.goto(`${origin}${pagePath}`);
  await page.evaluate(() => localStorage.setItem('drydock-staff', '1'));
  await page.reload();
}

async function signInAs(page: Page, origin: string, email: string) {
  await page.context().addCookies([{ name: 'test-user', value: email, url: origin }]);
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${AUTO}/__test/reset`);
  await page.request.post(`${REVIEW}/__test/reset`);
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('no staff hint: no section and no request to /admin/api/me', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/admin/api/me') asked.push(r.url());
  });
  await page.goto(`${AUTO}${pagePath}`);
  await page.waitForLoadState('networkidle');
  await expect(launcher(page)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('with the hint but signed out: no section', async ({ page }) => {
  await openWithHint(page, AUTO);
  await page.waitForLoadState('networkidle');
  await expect(launcher(page)).toHaveCount(0);
});

test('an editor sees "Edit this page" for the current path and query', async ({ page }) => {
  await signInAs(page, AUTO, 'ed@example.com');
  await openWithHint(page, AUTO);
  await expect(launcher(page)).toHaveText('editing');
  await launcher(page).click();
  const edit = panel(page).getByRole('link', { name: 'Edit this page' });
  await expect(edit).toHaveAttribute('href', `/admin/edit?page=${encodeURIComponent(`${pagePath}`)}`);
  await expect(panel(page).getByRole('link', { name: /changes? waiting/ })).toHaveCount(0);
});

test('an admin with two waiting changes sees "2 changes waiting"', async ({ page }) => {
  // Two editor changes wait in review mode.
  await signInAs(page, REVIEW, 'ed@example.com');
  for (const [key, seen, text] of [
    ['home.title', 'Welcome to the house', 'Howdy'],
    ['home.intro', 'A quiet place by the lake.', 'Come in'],
  ]) {
    const submitted = await page.request.post(`${REVIEW}/admin/api/changes`, {
      headers: { origin: REVIEW, 'content-type': 'application/json' },
      data: { ops: [{ op: 'setText', key, seen, text }] },
      failOnStatusCode: false,
    });
    expect(submitted.status()).toBe(200);
  }
  await signInAs(page, REVIEW, 'boss@example.com');
  await openWithHint(page, REVIEW);
  await launcher(page).click();
  const waiting = panel(page).getByRole('link', { name: '2 changes waiting' });
  await expect(waiting).toHaveAttribute('href', '/admin/changes');
  await expect(panel(page).getByRole('link', { name: 'Edit this page' })).toBeVisible();
});
