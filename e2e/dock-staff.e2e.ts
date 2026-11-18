import { expect, test, type Page } from '@playwright/test';
import { AUTO, REVIEW } from './ports.js';

// The dock's staff hint in a real browser: a public page asks /admin/api/me only when this
// browser has opened the edit view (the hint), and a visitor's page makes no request at all.

/** What this page asked /admin/api/me, as the browser sent it. */
function watchStaffRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/admin/api/me') asked.push(req.url());
  });
  return asked;
}

/** Asks the built helper, from the public page, who is signed in. */
const staffStatus = (page: Page) => page.evaluate(async (path: string) => (await import(path)).staffStatus(), '/__test/dock.js');

async function signInAs(page: Page, origin: string, email: string) {
  await page.context().addCookies([{ name: 'test-user', value: email, url: origin }]);
}

test.describe('the dock’s staff hint', () => {
  test('a page with no hint makes no request to /admin/api/me', async ({ page }) => {
    await page.request.post(`${AUTO}/__test/reset`);
    const asked = watchStaffRequests(page);
    await page.goto(`${AUTO}/`);
    expect(await staffStatus(page)).toBeNull();
    expect(asked).toEqual([]);
  });

  test('after the edit view has opened, a public page learns who is signed in', async ({ page }) => {
    await page.request.post(`${AUTO}/__test/reset`);
    await signInAs(page, AUTO, 'ed@example.com');
    await page.goto(`${AUTO}/admin/edit?page=/`);
    await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');
    expect(await page.evaluate(() => localStorage.getItem('drydock-staff'))).toBe('1');

    await page.goto(`${AUTO}/`);
    expect(await staffStatus(page)).toEqual({ email: 'ed@example.com', role: 'editor', waiting: 0 });
  });

  test('an admin is told how many changes wait', async ({ page }) => {
    await page.request.post(`${REVIEW}/__test/reset`);
    // An editor's change waits in review mode.
    await signInAs(page, REVIEW, 'ed@example.com');
    const submitted = await page.request.post(`${REVIEW}/admin/api/changes`, {
      headers: { origin: REVIEW, 'content-type': 'application/json' },
      data: { ops: [{ op: 'setText', key: 'home.title', seen: 'Welcome to the house', text: 'Howdy' }] },
      failOnStatusCode: false,
    });
    expect(submitted.status()).toBe(200);
    await signInAs(page, REVIEW, 'boss@example.com');
    await page.goto(`${REVIEW}/admin/edit?page=/`);
    await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');

    await page.goto(`${REVIEW}/`);
    expect(await staffStatus(page)).toEqual({ email: 'boss@example.com', role: 'admin', waiting: 1 });
  });

  test('a visitor with the hint but signed out is told nothing', async ({ page }) => {
    await page.request.post(`${AUTO}/__test/reset`);
    await signInAs(page, AUTO, 'ed@example.com');
    await page.goto(`${AUTO}/admin/edit?page=/`);
    await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');
    await page.context().clearCookies();

    const asked = watchStaffRequests(page);
    await page.goto(`${AUTO}/`);
    expect(await staffStatus(page)).toBeNull();
    expect(asked).toHaveLength(1);
  });
});
