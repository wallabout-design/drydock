import { expect, test, type Page } from '@playwright/test';
import { AUTO } from './ports.js';

// The rebuild images page (/admin/images) in a real browser, against the fixture
// site in server.mjs: its R2 bucket and images service are fakes, and the test
// routes seed rooms that hold uploads and change what the `photo` field declares.

const ROOMS = [
  { id: 'blue', n: 1 },
  { id: 'attic', n: 2 },
];

async function seed(page: Page, photo: object, rooms: object[] = ROOMS) {
  await page.request.post(`${AUTO}/__test/uploads`, { data: { rooms, photo } });
}
const made = async (page: Page): Promise<string[]> => (await (await page.request.get(`${AUTO}/__test/renditions`)).json()) as string[];
const allowance = (page: Page, data: object) => page.request.post(`${AUTO}/__test/allowance`, { data });

async function open(page: Page, who = 'boss@example.com') {
  await page.context().addCookies([{ name: 'test-user', value: who, url: AUTO }]);
  await page.goto(`${AUTO}/admin/images`);
}
const status = (page: Page) => page.getByRole('status');
const counts = (page: Page) => page.locator('[data-counts="rooms"]');

test.describe('rebuild images', () => {
  test('makes the size a field gained, for every item that lacks it', async ({ page }) => {
    await seed(page, { widths: [480, 960] });
    await open(page);
    await expect(counts(page)).toHaveText('4 sizes needed, 4 missing');
    await page.getByRole('button', { name: /^make missing sizes \(4\)/ }).click();
    await expect(status(page)).toHaveText('Done. 4 sizes were made.');
    expect(await made(page)).toHaveLength(4);

    // The site is deployed with a third width: only that one is missing.
    await page.request.post(`${AUTO}/__test/declare`, { data: { widths: [480, 960, 1200] } });
    await page.reload();
    await expect(counts(page)).toHaveText('6 sizes needed, 2 missing');
    await page.getByRole('button', { name: /^make missing sizes \(2\)/ }).click();
    await expect(status(page)).toHaveText('Done. 2 sizes were made.');
    const keys = await made(page);
    expect(keys).toHaveLength(6);
    expect(keys.filter((k) => k.endsWith('/1200.webp'))).toHaveLength(2);

    await page.getByRole('button', { name: 'check again' }).click();
    await expect(counts(page)).toHaveText('6 sizes needed, 0 missing');
    await expect(status(page)).toHaveText('Every size is made.');
  });

  test('stops at 429, keeps what was made, and resumes', async ({ page }) => {
    await seed(page, { widths: [480, 960] });
    await allowance(page, { left: 1 });
    await open(page);
    await page.getByRole('button', { name: /^make missing sizes \(4\)/ }).click();
    await expect(status(page)).toContainText('free image allowance is used up');
    await expect(status(page)).toContainText('1 size was made; 3 sizes are still missing');
    expect(await made(page)).toHaveLength(1);
    await expect(counts(page)).toHaveText('4 sizes needed, 3 missing, 1 made just now');

    // Resume in the same visit once the allowance is back.
    await allowance(page, { exhausted: false });
    await page.getByRole('button', { name: 'resume (3)' }).click();
    await expect(status(page)).toHaveText('Done. 4 sizes were made.');
    expect(await made(page)).toHaveLength(4);
  });

  test('a new visit finds what a stopped run left, so it can be resumed next month', async ({ page }) => {
    await seed(page, { widths: [480, 960] });
    await allowance(page, { left: 3 });
    await open(page);
    await page.getByRole('button', { name: /^make missing sizes/ }).click();
    await expect(status(page)).toContainText('Come back next month');
    await allowance(page, { exhausted: false });
    await page.reload();
    await expect(counts(page)).toHaveText('4 sizes needed, 1 missing');
    await page.getByRole('button', { name: /^make missing sizes \(1\)/ }).click();
    await expect(status(page)).toHaveText('Done. 1 size was made.');
    expect(await made(page)).toHaveLength(4);
  });

  test('the stop button ends the run after the request in flight', async ({ page }) => {
    await seed(page, { widths: [480, 960] });
    await open(page);
    await expect(counts(page)).toHaveText('4 sizes needed, 4 missing');
    // Hold the first request until stop has been pressed.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let requests = 0;
    await page.route('**/admin/api/uploads/renditions', async (route) => {
      requests += 1;
      await held;
      await route.continue();
    });
    await page.getByRole('button', { name: /^make missing sizes/ }).click();
    await page.getByRole('button', { name: 'stop' }).click();
    release();
    await expect(status(page)).toContainText('Stopped. 1 size was made; 3 sizes are still missing.');
    expect(requests).toBe(1);
    expect(await made(page)).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'resume (3)' })).toBeEnabled();
  });

  test('lists an item whose crop no longer fits the new shape, with a link to its form', async ({ page }) => {
    const rooms = [
      { id: 'square', n: 1, crop: { x: 0, y: 0, w: 3000, h: 3000 } },
      { id: 'wide', n: 2, crop: { x: 0, y: 0, w: 1600, h: 1000 } },
    ];
    await seed(page, { aspect: '1:1', widths: [480] }, rooms);
    await page.request.post(`${AUTO}/__test/declare`, { data: { aspect: '16:10', widths: [480] } });
    await open(page);
    await expect(counts(page)).toHaveText('1 size needed, 1 missing');
    const problem = page.locator('[data-problems="rooms"] [data-item="square"]');
    await expect(problem).toContainText('wrong shape');
    await page.getByRole('button', { name: /^make missing sizes \(1\)/ }).click();
    await expect(status(page)).toHaveText('Done. 1 size was made.');
    expect(await made(page)).toHaveLength(1);

    await problem.getByRole('link', { name: /form/ }).click();
    await expect(page).toHaveURL(/\/admin\/lists\/rooms\?edit=square$/);
    await expect(page.locator('form.wd-form')).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('square');
  });

  test('is only for admins', async ({ page }) => {
    await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: AUTO }]);
    for (const path of ['/admin/images', '/admin/api/uploads/missing?list=rooms&offset=0']) {
      const response = await page.request.get(`${AUTO}${path}`);
      expect([path, response.status()]).toEqual([path, 403]);
      expect(await response.text()).toBe('');
    }
  });
});
