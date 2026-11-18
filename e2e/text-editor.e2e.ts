import { expect, test, type Page } from '@playwright/test';
import { nextControl } from './keys.js';
import { AUTO, REVIEW } from './ports.js';

// The text editor in a real browser, against the fixture site in server.mjs.
// Texts are named by key (data-copy), never by repeating their words, except
// where a test types its own.

const TITLE = '[data-copy="home.title"]';
const INTRO = '[data-copy="home.intro"]';

async function state(page: Page, origin = AUTO): Promise<{ texts: Record<string, string> }> {
  return (await page.request.get(`${origin}/__test/state`)).json();
}

async function open(page: Page, origin = AUTO) {
  await page.request.post(`${origin}/__test/reset`);
  await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: origin }]);
  await page.goto(`${origin}/admin/edit?page=/`);
  await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');
}

/** Clicks a text, replaces what it says and presses Enter. */
async function change(page: Page, selector: string, words: string) {
  await page.locator(selector).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
}

const bar = (page: Page) => page.getByRole('complementary', { name: 'text editor' });
const status = (page: Page) => bar(page).getByRole('status');
const save = (page: Page) => bar(page).locator('.wd-editor__save');

test.describe('moving between pages', () => {
  test('a link to another page opens it in the editor', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Other page' }).click();
    await expect(page).toHaveURL(/\/admin\/edit\?page=%2Fother$/);
    await expect(page.locator('html')).toHaveAttribute('data-editor', 'on');
  });

  test('a link whose words are editable starts editing instead', async ({ page }) => {
    await open(page);
    await page.locator('[data-copy="home.cta"]').click();
    await expect(page).toHaveURL(/page=\/$/);
  });

  test('"open this link" in the bar goes to the link\'s page while its words are edited', async ({ page }) => {
    await open(page);
    const offer = bar(page).getByRole('link', { name: 'open this link' });
    await expect(offer).toBeHidden();
    await page.locator('[data-copy="home.cta"]').click();
    await expect(offer).toBeVisible();
    await offer.click();
    await expect(page).toHaveURL(/\/admin\/edit\?page=%2Fother$/);
  });

  test('"open this link" goes once editing ends', async ({ page }) => {
    await open(page);
    const offer = bar(page).getByRole('link', { name: 'open this link' });
    await page.locator('[data-copy="home.cta"]').click();
    await expect(offer).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(offer).toBeHidden();
  });
});

test.describe('editable texts are marked', () => {
  test('the resting mark shows on light and dark backgrounds, and the bar counts the texts', async ({ page }) => {
    await open(page);
    await expect(bar(page)).toContainText('3 texts on this page can be edited');
    const ratios = await page.evaluate((selector) => {
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const rgb = (v: string) => (v.match(/[\d.]+/g) ?? []).map(Number);
      const el = document.querySelector(selector) as HTMLElement;
      const style = getComputedStyle(el);
      const mark = rgb(style.outlineColor).slice(0, 3);
      const halo = rgb(style.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? '');
      const out: Record<string, number> = { width: parseFloat(style.outlineWidth) };
      for (const [name, bg] of [['white', [255, 255, 255]], ['dark', [10, 10, 10]]] as [string, number[]][]) {
        const a = halo[3] ?? 1;
        const around = bg.map((v, i) => halo[i] * a + v * (1 - a));
        out[name] = Math.max(ratio(mark, bg), ratio(mark, around));
      }
      return out;
    }, TITLE);
    expect(ratios.width).toBeGreaterThanOrEqual(2);
    expect(ratios.white).toBeGreaterThanOrEqual(3);
    expect(ratios.dark).toBeGreaterThanOrEqual(3);
  });
});

test.describe('changes go live on their own', () => {
  test('edit a text, save it, undo the save', async ({ page }) => {
    await open(page);
    await expect(save(page)).toBeDisabled();
    await change(page, TITLE, 'Hello from the lake');
    await expect(page.locator(TITLE)).toHaveText('Hello from the lake');
    await expect(bar(page).getByRole('list', { name: 'changes to save' }).getByRole('listitem')).toHaveCount(1);
    await expect(save(page)).toHaveText('save 1 change');

    await save(page).click();
    await expect(status(page)).toContainText('on the site now');
    expect((await state(page)).texts['home.title']).toBe('Hello from the lake');
    await expect(save(page)).toBeDisabled();

    await bar(page).getByRole('button', { name: 'undo last save' }).click();
    await expect(status(page)).toContainText('back to how it was');
    await expect(page.locator(TITLE)).toHaveText('Welcome to the house');
    expect((await state(page)).texts['home.title']).toBe('Welcome to the house');
    await expect(bar(page).getByRole('button', { name: 'undo last save' })).toBeHidden();
  });

  test('several texts are sent as one change', async ({ page }) => {
    await open(page);
    await change(page, TITLE, 'One');
    await change(page, INTRO, 'Two');
    await expect(save(page)).toHaveText('save 2 changes');
    await save(page).click();
    await expect(status(page)).toContainText('on the site now');
    const { texts } = await state(page);
    expect([texts['home.title'], texts['home.intro']]).toEqual(['One', 'Two']);
    const changes = await (await page.request.get(`${AUTO}/admin/changes`, { headers: { cookie: 'test-user=ed@example.com' } })).text();
    expect(changes.match(/<strong>ed@example.com<\/strong>/g)).toHaveLength(1);
  });

  test('undoing an unsaved edit puts the text back', async ({ page }) => {
    await open(page);
    await change(page, TITLE, 'Not yet');
    await bar(page).getByRole('button', { name: /^undo the change/ }).click();
    await expect(page.locator(TITLE)).toHaveText('Welcome to the house');
    await expect(save(page)).toBeDisabled();
  });

  test('Escape drops what was typed', async ({ page }) => {
    await open(page);
    await page.locator(TITLE).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Dropped');
    await page.keyboard.press('Escape');
    await expect(page.locator(TITLE)).toHaveText('Welcome to the house');
    await expect(save(page)).toBeDisabled();
  });

  test('a text inside a link is edited, not followed', async ({ page }) => {
    await open(page);
    await change(page, '[data-copy="home.cta"]', 'Reserve');
    await expect(page).toHaveURL(/\/admin\/edit/);
    await page.getByRole('link', { name: 'Other page' }).click();
    await expect(page).toHaveURL(/\/admin\/edit/);
  });

  test('the character counter appears near the limit', async ({ page }) => {
    await open(page);
    await page.locator(TITLE).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('x'.repeat(10));
    await expect(bar(page).locator('.wd-editor__count')).toHaveText('');
    await page.keyboard.type('x'.repeat(15));
    await expect(bar(page).locator('.wd-editor__count')).toHaveText('5 characters left');
  });

  test('a text over its limit cannot be saved', async ({ page }) => {
    await open(page);
    await page.locator(TITLE).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('y'.repeat(34));
    await expect(bar(page).locator('.wd-editor__count')).toHaveText('4 over the limit of 30');
    await expect(status(page)).toContainText('too long');
    await page.keyboard.press('Enter');
    await expect(save(page)).toBeDisabled();
    await expect(bar(page).locator('.wd-editor__problem')).toContainText('fits 30');
    expect((await state(page)).texts['home.title']).toBe('Welcome to the house');
    // Shortening it clears the problem.
    await change(page, TITLE, 'Short again');
    await expect(save(page)).toBeEnabled();
  });

  test('a site rule is checked as you type', async ({ page }) => {
    await open(page);
    await page.locator(INTRO).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Find us at 12 Main Street');
    // Still typing: the message is already there.
    await expect(status(page)).toContainText('leave the street name out');
    await page.keyboard.press('Enter');
    await expect(bar(page).locator('.wd-editor__problem')).toContainText('leave the street name out');
    await expect(save(page)).toBeDisabled();
    expect((await state(page)).texts['home.intro']).toBe('A quiet place by the lake.');
  });

  test('someone else changed the text: use mine instead', async ({ page }) => {
    await open(page);
    await page.request.post(`${AUTO}/__test/other`, { data: { key: 'home.title', text: 'Their words' } });
    await change(page, TITLE, 'My words');
    await save(page).click();
    await expect(status(page)).toContainText('someone changed');
    const item = bar(page).locator('[data-key="home.title"]');
    await expect(item).toContainText('Their words');
    expect((await state(page)).texts['home.title']).toBe('Their words');

    await item.getByRole('button', { name: 'use mine instead' }).click();
    await expect(status(page)).toContainText('on the site now');
    expect((await state(page)).texts['home.title']).toBe('My words');
    await expect(page.locator(TITLE)).toHaveText('My words');
  });

  test('someone else changed the text: use the site’s text', async ({ page }) => {
    await open(page);
    await page.request.post(`${AUTO}/__test/other`, { data: { key: 'home.title', text: 'Their words' } });
    await change(page, TITLE, 'My words');
    await save(page).click();
    await bar(page).getByRole('button', { name: 'use the site’s text' }).click();
    await expect(page.locator(TITLE)).toHaveText('Their words');
    await expect(save(page)).toBeDisabled();
    expect((await state(page)).texts['home.title']).toBe('Their words');
  });

  test('markup is refused', async ({ page }) => {
    await open(page);
    await change(page, TITLE, '<b>Bold</b>');
    await expect(bar(page).locator('.wd-editor__problem')).toContainText('plain words');
    await expect(save(page)).toBeDisabled();
  });

  // The browser asks before leaving a page whose beforeunload event is cancelled.
  const asksBeforeLeaving = (page: Page) =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

  test('leaving with unsaved changes asks first', async ({ page }) => {
    await open(page);
    expect(await asksBeforeLeaving(page)).toBe(false);
    await change(page, TITLE, 'Unsaved');
    expect(await asksBeforeLeaving(page)).toBe(true);
    // Text still being typed counts too.
    await bar(page).getByRole('button', { name: /^undo the change/ }).click();
    expect(await asksBeforeLeaving(page)).toBe(false);
    await page.locator(TITLE).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Half typed');
    expect(await asksBeforeLeaving(page)).toBe(true);
  });

  test('saved changes leave without asking', async ({ page }) => {
    await open(page);
    await change(page, TITLE, 'Saved');
    await save(page).click();
    await expect(status(page)).toContainText('on the site now');
    expect(await asksBeforeLeaving(page)).toBe(false);
  });

  test('works with the keyboard alone', async ({ page }) => {
    await open(page);
    // Tab until the focus is on the element the selector names.
    const focusOn = async (selector: string) => {
      for (let presses = 0; presses < 20; presses++) {
        if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
        await nextControl(page);
      }
      throw new Error(`never reached ${selector} with Tab`);
    };
    await focusOn(TITLE);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Typed by keyboard');
    await page.keyboard.press('Enter');
    await expect(page.locator(TITLE)).toBeFocused();
    await expect(page.locator(TITLE)).toHaveText('Typed by keyboard');
    await focusOn('.wd-editor__save');
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText('on the site now');
    expect((await state(page)).texts['home.title']).toBe('Typed by keyboard');
  });
});

test.describe('changes wait for an admin', () => {
  test('the bar says so, and the text is not live until approved', async ({ page }) => {
    await open(page, REVIEW);
    await expect(bar(page)).toContainText('wait for an admin to approve');
    await change(page, TITLE, 'Waiting words');
    await save(page).click();
    await expect(status(page)).toContainText('once an admin approves it');
    await expect(page.locator(TITLE)).toHaveAttribute('data-editor-state', 'waiting');
    await expect(bar(page).getByRole('button', { name: 'undo last save' })).toBeHidden();
    expect((await state(page, REVIEW)).texts['home.title']).toBe('Welcome to the house');

    await page.request.post(`${REVIEW}/__test/approve`);
    expect((await state(page, REVIEW)).texts['home.title']).toBe('Waiting words');
  });
});

test.describe('signed out', () => {
  test('the edit view gives nothing', async ({ page }) => {
    const response = await page.request.get(`${AUTO}/admin/edit?page=/`);
    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('');
  });
});
