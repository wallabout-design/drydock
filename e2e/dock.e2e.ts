// The dock on a fixture page, under the feedback server's CSP (default-src 'self': no inline scripts or styles).
import { test, expect, type Page } from '@playwright/test';
import { FEEDBACK } from './ports.js';

test.use({ baseURL: FEEDBACK });

const launcher = (page: Page) => page.locator('[data-dock-launcher]');
const panel = (page: Page) => page.locator('[data-dock-panel]');
const fixture = (name: string, query = '') => `/e2e/dock-fixture/${name}.html${query}`;

test.beforeEach(({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error') throw new Error(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('hidden for ordinary visitors, with no requests but the page and its own files', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(new URL(r.url()).pathname));
  await page.goto(fixture('index'));
  await page.waitForLoadState('networkidle');
  await expect(launcher(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('dock')!.childElementCount)).toBe(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(requested.filter((p) => !p.startsWith('/dist/') && !p.startsWith('/e2e/dock-fixture/'))).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe('0px');
});

test('importing the package does nothing', async ({ page }) => {
  await page.goto(fixture('import-only', '?feedback'));
  await page.waitForLoadState('load');
  await expect(launcher(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('?feedback shows the launcher, and it stays for later pages', async ({ page }) => {
  await page.goto(fixture('index', '?feedback'));
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeHidden();
  await page.goto(fixture('about'));
  await expect(launcher(page)).toBeVisible();
});

test('?feedback=off hides it again', async ({ page }) => {
  await page.goto(fixture('index', '?feedback'));
  await page.goto(fixture('about', '?feedback=off'));
  await expect(launcher(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('with one section the launcher opens it directly, and the mailto link is right', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture('about', '?feedback'));
  await launcher(page).click();
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAccessibleName('feedback');
  await expect(panel(page).locator('h2')).toHaveCount(0);
  const link = panel(page).getByRole('link', { name: 'send feedback' });
  const mail = new URL((await link.getAttribute('href'))!);
  expect(mail.protocol).toBe('mailto:');
  expect(mail.pathname).toBe('feedback@wallabout.design');
  expect(mail.searchParams.get('subject')).toMatch(/^\[test\] \/e2e\/dock-fixture\/about\.html #[2-9a-hjkmnp-z]{4}$/);
  const body = mail.searchParams.get('body')!;
  expect(body).toContain('url: ' + page.url());
  expect(body).toMatch(/viewport: 390x844 @\d+(\.\d{1,2})?x\r\n/);
  expect(body).toContain('build: abc1234');
});

test('works from the keyboard: open, then Escape closes it and focus returns to the launcher', async ({ page }) => {
  await page.goto(fixture('index', '?feedback'));
  await launcher(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('link', { name: 'send feedback' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(launcher(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(panel(page)).toBeVisible();
  await launcher(page).click();
  await expect(panel(page)).toBeHidden();
});

test('is not a modal: the page behind stays reachable', async ({ page }) => {
  await page.goto(fixture('index', '?feedback'));
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('[data-dock-panel]')!.getAttribute('aria-modal'))).toBeNull();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
});

test('with two sections the panel lists them in the fixed order', async ({ page }) => {
  await page.goto(fixture('index', '?feedback&extra'));
  await expect(launcher(page)).toHaveText('dock');
  await launcher(page).click();
  await expect(panel(page)).toHaveAccessibleName('dock');
  expect(await panel(page).locator('h2').allTextContents()).toEqual(['feedback', 'editing']);
});

test('a visitor who has not opted in sees the editing section alone only if it says so', async ({ page }) => {
  await page.goto(fixture('index', '?extra'));
  await expect(launcher(page)).toHaveText('editing');
});

test('--dock-reserve pads the page bottom while the launcher shows, and --feedback-reserve is the fallback', async ({ page }) => {
  await page.goto(fixture('index', '?feedback'));
  await expect(launcher(page)).toBeVisible();
  const padding = () => page.evaluate(() => getComputedStyle(document.body).paddingBottom);
  expect(await padding()).toBe('64px');
  await page.evaluate(() => document.documentElement.style.setProperty('--feedback-reserve', '80px'));
  expect(await padding()).toBe('80px');
  await page.evaluate(() => document.documentElement.style.setProperty('--dock-reserve', '96px'));
  expect(await padding()).toBe('96px');
});

test('the launcher sits at the bottom right, and the cleanup removes the dock', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(fixture('index', '?feedback'));
  const box = (await launcher(page).boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(300);
  expect(box.y + box.height).toBeGreaterThan(580);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => (window as unknown as { dockCleanup: () => void }).dockCleanup());
  await expect(launcher(page)).toHaveCount(0);
});
