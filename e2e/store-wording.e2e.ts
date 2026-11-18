import { expect, test, type Page } from '@playwright/test';
import { AUTO, D1, GIT } from './ports.js';

// What the edit view, the list page and the Changes page say about a saved change, for
// an auto store of each kind (StoreCapabilities.goesLive). The in-memory and D1 stores
// put a change live when it is saved ("at-once"); the git store waits for the checks
// ("after-checks"), so its save is not on the site yet and cannot be undone from the bar.

const TITLE = '[data-copy="home.title"]';

type Kind = {
  name: string;
  origin: string;
  /** The edit view's line after a text is saved. */
  saved: string;
  /** The Changes page's line under "back to editing". */
  changesLine: string;
  /** The list page's line under its heading. */
  listLine: string;
  /** Whether the save can be undone from the edit bar (only when it went live at once). */
  undoable: boolean;
};

const KINDS: Kind[] = [
  {
    name: 'in-memory',
    origin: AUTO,
    saved: 'It’s on the site now.',
    changesLine: 'changes go live on their own',
    listLine: 'What you save here is on the site straight away.',
    undoable: true,
  },
  {
    name: 'D1',
    origin: D1,
    saved: 'It’s on the site now.',
    changesLine: 'changes go live on their own',
    listLine: 'What you save here is on the site straight away.',
    undoable: true,
  },
  {
    name: 'git',
    origin: GIT,
    saved: 'It’s live in a few minutes, after checks.',
    changesLine: 'changes go live in a few minutes, after checks',
    listLine: 'What you save here is live in a few minutes, after checks.',
    undoable: false,
  },
];

async function open(page: Page, origin: string, path: string) {
  await page.request.post(`${origin}/__test/reset`);
  await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: origin }]);
  await page.goto(`${origin}${path}`);
}

const bar = (page: Page) => page.getByRole('complementary', { name: 'text editor' });

for (const kind of KINDS) {
  test.describe(`an auto ${kind.name} store`, () => {
    test('the edit view says what happens after a save, and the Changes page says the same', async ({ page }) => {
      await open(page, kind.origin, '/admin/edit?page=/');
      await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');

      await page.locator(TITLE).click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Hello from the lake');
      await page.keyboard.press('Enter');
      await bar(page).locator('.wd-editor__save').click();

      await expect(bar(page).getByRole('status')).toContainText(kind.saved);
      if (kind.undoable) await expect(bar(page).getByRole('button', { name: 'undo last save' })).toBeVisible();
      else await expect(bar(page).getByRole('button', { name: 'undo last save' })).toBeHidden();

      const changes = await (await page.request.get(`${kind.origin}/admin/changes`, { headers: { cookie: 'test-user=ed@example.com' } })).text();
      expect(changes).toContain(kind.changesLine);
    });

    test('the list page says what happens after an add', async ({ page }) => {
      await open(page, kind.origin, '/admin/lists/rooms');
      await expect(page.getByText(kind.listLine, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'add room' }).click();
      const form = page.locator('form.wd-form');
      await form.getByLabel('Name').fill('Garden room');
      await form.getByRole('button', { name: 'save' }).click();

      await expect(page.locator('.wd-list__status')).toHaveText(`Added “Garden room”. ${kind.saved}`);
    });
  });
}
