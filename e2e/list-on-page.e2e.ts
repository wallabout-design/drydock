import { expect, test, type Page } from '@playwright/test';
import { AUTO, REVIEW } from './ports.js';

// Lists edited on the page itself (the edit view): edit, remove and move on each
// item, add on the list, all opening the same item form as the list page. The
// fixture page (server.mjs) has a `rooms` list of three plain-text items.


type Room = { id: string; values: Record<string, unknown> };
const STARTING = ['blue', 'attic', 'porch'];

const stored = async (page: Page, origin = AUTO) => (await (await page.request.get(`${origin}/__test/state`)).json()).lists.rooms as Room[];
const storedIds = async (page: Page, origin = AUTO) => (await stored(page, origin)).map((r) => r.id);
/** The items as the page shows them, in order. */
const shownIds = (page: Page) => page.locator('[data-list="rooms"] > [data-item]').evaluateAll((els) => els.map((el) => el.getAttribute('data-item')));

async function open(page: Page, origin = AUTO) {
  await page.request.post(`${origin}/__test/reset`);
  await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: origin }]);
  await page.goto(`${origin}/admin/edit?page=/`);
  await expect(page.getByRole('button', { name: 'add room' })).toBeVisible();
}

const bar = (page: Page) => page.locator('.wd-editor');
const status = (page: Page) => bar(page).locator('.wd-editor__status');
const form = (page: Page) => page.locator('dialog form.wd-form');
const item = (page: Page, id: string) => page.locator(`[data-list="rooms"] > [data-item="${id}"]`);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('on the page', () => {
  test('every item has its tools, the list has add, and the list page is still linked', async ({ page }) => {
    await open(page);
    for (const id of STARTING) await expect(item(page, id).locator('[data-action]')).toHaveCount(4);
    await expect(tool(page, 'move up Blue room')).toBeDisabled();
    await expect(tool(page, 'move down Porch')).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Edit this list' })).toHaveAttribute('href', '/admin/lists/rooms');
    // Public pages never get any of this.
    await page.goto(`${AUTO}/`);
    await expect(page.locator('[data-editor-tools]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'add room' })).toHaveCount(0);
  });

  test('add a room: the form opens over the page and the room appears in the list', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'add room' }).click();
    await expect(form(page).getByRole('heading', { name: 'Add a new room' })).toBeVisible();
    await expect(form(page).getByLabel('Name')).toBeFocused();
    await form(page).getByLabel('Name').fill('Garden room');
    await form(page).getByLabel('Beds').fill('3');
    await form(page).getByRole('button', { name: 'save' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Added “Garden room”. It’s on the site now.');
    const added = (await stored(page)).at(-1)!;
    expect(added.values).toEqual({ title: 'Garden room', beds: 3, pets: false });
    expect(await shownIds(page)).toEqual([...STARTING, added.id]);
    await expect(item(page, added.id)).toContainText('Garden room');
    await expect(tool(page, 'edit Garden room')).toBeFocused();
    // The new room has its own tools.
    await expect(item(page, added.id).locator('[data-action]')).toHaveCount(4);
  });

  test('the form shows what the site refuses, next to the field, and keeps what was typed', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'add room' }).click();
    await form(page).getByRole('button', { name: 'save' }).click();
    // Wait for the refusal itself. The label always says "(needed)", so text alone is there before
    // the site answers; the answer then moves focus to Name, and what is typed next lands there.
    const name = form(page).getByLabel('Name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toBeFocused();
    await expect(form(page).getByText('Name is needed.')).toBeVisible();
    await form(page).getByLabel('Name').fill('Half done');
    await form(page).getByLabel('Beds').fill('99');
    await form(page).getByRole('button', { name: 'save' }).click();
    await expect(form(page)).toBeVisible();
    await expect(form(page).getByLabel('Name')).toHaveValue('Half done');
    expect(await storedIds(page)).toEqual(STARTING);
  });

  test('cancel and Escape close the form and save nothing', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'add room' }).click();
    await form(page).getByLabel('Name').fill('Never saved');
    await form(page).getByRole('button', { name: 'cancel' }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'add room' })).toBeFocused();
    await tool(page, 'edit Attic').click();
    await page.keyboard.press('Escape');
    await expect(form(page)).toHaveCount(0);
    await expect(tool(page, 'edit Attic')).toBeFocused();
    expect(await storedIds(page)).toEqual(STARTING);
  });

  test('edit a room: the form starts with what is there, and the new title shows', async ({ page }) => {
    await open(page);
    await tool(page, 'edit Blue room').click();
    await expect(form(page).getByRole('heading', { name: 'Edit this room' })).toBeVisible();
    await expect(form(page).getByLabel('Name')).toHaveValue('Blue room');
    await expect(form(page).getByLabel('Beds')).toHaveValue('2');
    await form(page).getByLabel('Name').fill('Big blue room');
    await form(page).getByRole('button', { name: 'save' }).click();
    await expect(status(page)).toHaveText('Changed “Big blue room”. It’s on the site now.');
    await expect(item(page, 'blue')).toContainText('Big blue room');
    await expect(tool(page, 'edit Big blue room')).toBeFocused();
    const blue = (await stored(page)).find((r) => r.id === 'blue')!;
    expect(blue.values).toEqual({ title: 'Big blue room', beds: 2, pets: false, view: 'lake' });
  });

  test('remove asks first', async ({ page }) => {
    await open(page);
    await tool(page, 'remove Attic').click();
    await expect(page.getByText('Remove “Attic” from the site?')).toBeVisible();
    await expect(tool(page, 'keep it')).toBeFocused();
    await tool(page, 'keep it').click();
    await expect(tool(page, 'remove Attic')).toBeFocused();
    expect(await storedIds(page)).toEqual(STARTING);

    await tool(page, 'remove Attic').click();
    await tool(page, 'yes, remove').click();
    await expect(status(page)).toHaveText('Removed “Attic”. It’s on the site now.');
    await expect(item(page, 'attic')).toHaveCount(0);
    expect(await shownIds(page)).toEqual(['blue', 'porch']);
    expect(await storedIds(page)).toEqual(['blue', 'porch']);
    await expect(page.getByRole('button', { name: 'add room' })).toBeFocused();
  });

  test('move up and down reorder the page and the stored list', async ({ page }) => {
    await open(page);
    await tool(page, 'move down Blue room').click();
    await expect(status(page)).toContainText('Moved “Blue room” down');
    await expect.poll(() => shownIds(page)).toEqual(['attic', 'blue', 'porch']);
    expect(await storedIds(page)).toEqual(['attic', 'blue', 'porch']);
    await expect(tool(page, 'move down Blue room')).toBeFocused();

    await tool(page, 'move up Porch').click();
    await expect.poll(() => shownIds(page)).toEqual(['attic', 'porch', 'blue']);
    expect(await storedIds(page)).toEqual(['attic', 'porch', 'blue']);

    await tool(page, 'move up Porch').click();
    await expect.poll(() => shownIds(page)).toEqual(['porch', 'attic', 'blue']);
    expect(await storedIds(page)).toEqual(['porch', 'attic', 'blue']);
    await expect(tool(page, 'move up Porch')).toBeDisabled();
  });

  test('a full list cannot be added to', async ({ page }) => {
    await open(page);
    for (const name of ['Cellar', 'Loft']) {
      await page.getByRole('button', { name: 'add room' }).click();
      await form(page).getByLabel('Name').fill(name);
      await form(page).getByRole('button', { name: 'save' }).click();
      await expect(form(page)).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'add room' })).toBeDisabled();
    expect(await storedIds(page)).toHaveLength(5);
  });

  test('someone else changed the list: nothing is overwritten, and the page says so', async ({ page }) => {
    await open(page);
    await page.request.post(`${AUTO}/__test/submit`, {
      data: { ops: [{ op: 'editItem', list: 'rooms', id: 'attic', values: { title: 'Attic suite', pets: true }, seen: { title: 'Attic', pets: true } }] },
    });
    await tool(page, 'edit Attic').click();
    await form(page).getByLabel('Name').fill('My attic');
    await form(page).getByRole('button', { name: 'save' }).click();
    await expect(form(page).getByText(/Someone else changed/)).toBeVisible();
    expect((await stored(page)).find((r) => r.id === 'attic')!.values).toEqual({ title: 'Attic suite', pets: true });
  });

  test('the list page stays available as the fallback', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Edit this list' }).click();
    await expect(page).toHaveURL(/\/admin\/lists\/rooms$/);
    await expect(page.getByRole('button', { name: 'add room' })).toBeVisible();
  });

  test('the page does not scroll sideways with the tools on it', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('when changes wait for an admin', () => {
  test('actions are sent, marked as waiting, and not shown as live', async ({ page }) => {
    await open(page, REVIEW);
    await tool(page, 'move down Blue room').click();
    await expect(status(page)).toHaveText('Moved “Blue room” down. It will appear on the site once an admin approves it.');
    await expect(item(page, 'blue')).toHaveAttribute('data-editor-state', 'waiting');
    expect(await storedIds(page, REVIEW)).toEqual(STARTING);

    await page.getByRole('button', { name: 'add room' }).click();
    await form(page).getByLabel('Name').fill('Cellar');
    await form(page).getByRole('button', { name: 'save' }).click();
    await expect(status(page)).toContainText('once an admin approves it');
    expect(await storedIds(page, REVIEW)).toEqual(STARTING);

    await page.request.post(`${REVIEW}/__test/approve`);
    const after = await stored(page, REVIEW);
    expect(after.map((r) => r.values.title)).toEqual(['Attic', 'Blue room', 'Porch', 'Cellar']);
  });
});
