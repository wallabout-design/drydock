import { expect, test, type Locator, type Page } from '@playwright/test';
import { renditionWidths } from '../src/core/image.js';
import type { ImageField, ImageUpload } from '../src/core/types.js';
import { AUTO } from './ports.js';
import { png } from './png.js';

// Picking, placing and uploading an image in the item form, in a real browser,
// against the fixture site: `rooms` has a `photo` field with no shape and a
// `banner` field that must be 3:2 (sizes 200 and 400, 800 for a lightbox, and a
// warning under 600 px). The fixture's bucket and images service are in memory.

const BANNER = { name: 'banner', label: 'Banner', type: 'image', aspect: '3:2', widths: [200, 400], full: 800, minWidth: 600 } as ImageField;
type Crop = { x: number; y: number; w: number; h: number };
type Banner = { key: string; alt: string; width: number; height: number; crop: Crop };
type Room = { id: string; values: Record<string, unknown> };
type Bucket = { keys: string[]; calls: unknown[]; originals: { key: string }[] };

const state = async (page: Page): Promise<Room[]> => (await (await page.request.get(`${AUTO}/__test/state`)).json()).lists.rooms;
const bucket = async (page: Page): Promise<Bucket> => (await page.request.get(`${AUTO}/__test/bucket`)).json();
const form = (page: Page) => page.locator('form.wd-form');

async function open(page: Page) {
  await page.request.post(`${AUTO}/__test/reset`);
  await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: AUTO }]);
  await page.goto(`${AUTO}/admin/lists/rooms`);
  await expect(page.getByRole('button', { name: 'add room' })).toBeVisible();
}
async function openAdd(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'add room' }).click();
  await form(page).getByLabel('Name').fill('Garden room');
}
const banner = (page: Page) => ({
  file: form(page).getByLabel(/^Or choose banner/),
  address: form(page).getByLabel(/^Banner/),
  frame: form(page).getByRole('group', { name: /Part of the banner to show/ }),
  zoom: form(page).getByLabel('Zoom'),
  alt: form(page).getByLabel(/^Describe banner/),
  status: form(page).locator('.wd-image').nth(1).getByRole('status'),
  remove: form(page).getByRole('button', { name: 'remove banner' }),
});
const photo = (page: Page) => ({
  file: form(page).getByLabel(/^Or choose photo/),
  address: form(page).getByLabel(/^Photo/),
  alt: form(page).getByLabel(/^Describe photo/),
  remove: form(page).getByRole('button', { name: 'remove photo' }),
});
const pick = (size: [number, number]) => ({ name: 'pick.png', mimeType: 'image/png', buffer: png(...size) });
const save = (page: Page) => form(page).getByRole('button', { name: 'save' }).click();
const crop = async (frame: Locator): Promise<Crop> => {
  // The frame's position and size are percentages of the image's own pixels.
  const style = await frame.evaluate((el) => ({ l: el.style.left, t: el.style.top, w: el.style.width, h: el.style.height }));
  const img = await frame.evaluate((el) => ({ w: (el.parentElement!.querySelector('img') as HTMLImageElement).naturalWidth, h: (el.parentElement!.querySelector('img') as HTMLImageElement).naturalHeight }));
  const px = (pct: string, of: number) => Math.round((parseFloat(pct) / 100) * of);
  return { x: px(style.l, img.w), y: px(style.t, img.h), w: px(style.w, img.w), h: px(style.h, img.h) };
};
const banners = async (page: Page) => (await state(page)).map((r) => r.values.banner as Banner | undefined).filter(Boolean) as Banner[];
const made = async (page: Page, b: Banner) => {
  const upload: ImageUpload = { key: b.key, alt: '', width: b.width, height: b.height, crop: b.crop };
  const { widths, full } = renditionWidths(BANNER, upload);
  const keys = (await bucket(page)).keys.filter((k) => k.startsWith(`renditions/${b.key}/`));
  return { keys, expected: [...widths, ...(full === undefined ? [] : [full])] };
};
const segment = (c: Crop) => `c${c.x}-${c.y}-${c.w}-${c.h}`;

test.describe('picking an image', () => {
  test('crops with the keyboard, saves the crop and makes every size', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    // It starts at the largest size that fits: here the whole image.
    expect(await crop(b.frame)).toEqual({ x: 0, y: 0, w: 900, h: 600 });
    await b.frame.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('+');
    const zoomed = await crop(b.frame);
    expect(zoomed.w).toBeLessThan(900);
    expect(zoomed.w / zoomed.h).toBeCloseTo(1.5, 1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('-');
    const moved = await crop(b.frame);
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.y).toBeGreaterThan(0);
    await b.alt.fill('The garden room');
    await save(page);
    await expect(form(page)).toHaveCount(0);

    const [stored] = await banners(page);
    expect(stored).toMatchObject({ alt: 'The garden room', width: 900, height: 600 });
    expect(stored!.key).toMatch(/^\d{4}\/\d{2}\/[\w-]{24}$/);
    expect(stored!.crop).toEqual(moved);
    // The server's own tolerance: inside the image, within 1% of 3:2.
    const c = stored!.crop;
    expect(c.x + c.w).toBeLessThanOrEqual(900);
    expect(c.y + c.h).toBeLessThanOrEqual(600);
    expect(Math.abs(c.w / c.h - 1.5) / 1.5).toBeLessThan(0.01);
    const { keys, expected } = await made(page, stored!);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(keys.sort()).toEqual(expected.map((w) => `renditions/${stored!.key}/${segment(c)}/${w}.webp`).sort());
    expect((await bucket(page)).originals.map((o) => o.key)).toEqual([`originals/${stored!.key}`]);
  });

  test('the frame is a named, described group; progress is a polite live region', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    await expect(b.frame).toHaveAccessibleDescription(/arrow keys .* plus and minus/);
    await expect(b.frame).toHaveAttribute('tabindex', '0');
    await expect(b.zoom).toBeVisible();
    expect(await b.status.getAttribute('role')).toBe('status');
    // Slowed down, the line says which size is being made.
    await page.route('**/admin/api/uploads/renditions', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await b.alt.fill('Banner');
    await save(page);
    await expect(b.status).toHaveText(/Making size 1 of \d/);
    await expect(form(page)).toHaveCount(0);
  });

  test('the slider zooms and dragging moves the frame', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    await b.zoom.fill('300');
    const zoomed = await crop(b.frame);
    expect(zoomed.w).toBeLessThan(400);
    const box = (await b.frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    const after = await crop(b.frame);
    expect(after.x).toBeGreaterThan(zoomed.x);
    expect(after.y).toBeGreaterThan(zoomed.y);
    expect(after.w).toBe(zoomed.w);
  });

  test('warns, without refusing, about a small photo', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([450, 300]));
    await expect(b.status).toHaveText(/This photo is small and may look soft/);
    await b.alt.fill('Small');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const [stored] = await banners(page);
    expect(stored!.crop).toEqual({ x: 0, y: 0, w: 450, h: 300 });
    // Nothing is made wider than the crop: 200, 400 and the crop's own 450.
    expect((await made(page, stored!)).expected).toEqual([200, 400, 450]);
  });

  test('refuses a file over 15 MB in the form, before any upload', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    let uploaded = false;
    page.on('request', (r) => {
      if (r.url().endsWith('/admin/api/uploads') || r.url().includes('/admin/api/uploads?')) uploaded = true;
    });
    await b.file.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(16 * 1024 * 1024) });
    await expect(form(page).getByText('That image is too big. Please choose one under 15 MB.')).toBeVisible();
    await expect(b.address).toHaveAttribute('aria-invalid', 'true');
    await expect(b.frame).toBeHidden();
    expect(uploaded).toBe(false);
    expect((await bucket(page)).originals).toEqual([]);
  });

  test('shows the server’s refusal of a file that is not an image', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles({ name: 'note.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all') });
    await expect(form(page).getByText(/not a JPEG, PNG or WebP image/)).toBeVisible();
    await expect(b.frame).toBeHidden();
  });

  test('a size that fails keeps the form open with nothing saved, and saving again retries', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    await b.alt.fill('The garden room');
    await page.request.post(`${AUTO}/__test/failnext?count=1`);
    await save(page);
    await expect(form(page).getByText(/size could not be made\. Please try again/)).toBeVisible();
    await expect(form(page)).toHaveCount(1);
    await expect(b.address).toHaveAttribute('aria-invalid', 'true');
    expect(await banners(page)).toEqual([]);
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const [stored] = await banners(page);
    const { keys, expected } = await made(page, stored!);
    expect(keys).toHaveLength(expected.length);
  });

  test('an address and a file replace each other', async ({ page }) => {
    await openAdd(page);
    const b = banner(page);
    await b.address.fill('https://example.com/a.jpg');
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    await expect(b.address).toHaveValue('');
    await b.address.fill('https://example.com/b.jpg');
    await expect(b.frame).toBeHidden();
    await b.alt.fill('From the web');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const value = (await state(page)).at(-1)!.values.banner;
    expect(value).toEqual({ src: 'https://example.com/b.jpg', alt: 'From the web' });
  });

  test('a field with no shape has no frame and no crop', async ({ page }) => {
    await openAdd(page);
    const p = photo(page);
    await p.file.setInputFiles(pick([500, 300]));
    await expect(form(page).locator('.wd-image__img').first()).toBeVisible();
    await expect(form(page).getByRole('group', { name: /Part of the photo/ })).toHaveCount(0);
    await p.alt.fill('The view');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const value = (await state(page)).at(-1)!.values.photo as Record<string, unknown>;
    expect(value).toMatchObject({ alt: 'The view', width: 500, height: 300 });
    expect(value).not.toHaveProperty('crop');
    expect(value).not.toHaveProperty('src');
    // 480 and 960 are declared by default; the original is narrower than 960, so its own width is the last.
    expect((await bucket(page)).keys.filter((k) => k.startsWith(`renditions/${value.key}/whole/`)).sort()).toEqual(
      [480, 500].map((w) => `renditions/${value.key}/whole/${w}.webp`),
    );
  });
});

test.describe('opening an item with an uploaded image', () => {
  async function addOne(page: Page) {
    await openAdd(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([900, 600]));
    await expect(b.frame).toBeVisible();
    await b.frame.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('+');
    await b.alt.fill('The garden room');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    await page.locator('.wd-list__item', { hasText: 'Garden room' }).getByRole('button', { name: /^edit/ }).click();
    await expect(form(page)).toBeVisible();
  }

  test('shows the stored crop, and a new crop is made without uploading again', async ({ page }) => {
    await addOne(page);
    const [first] = await banners(page);
    const b = banner(page);
    await expect(b.frame).toBeVisible();
    expect(await crop(b.frame)).toEqual(first!.crop);
    await b.frame.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    const next = await crop(b.frame);
    expect(next).not.toEqual(first!.crop);
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const [second] = await banners(page);
    expect(second).toMatchObject({ key: first!.key, crop: next });
    const { keys, expected } = await made(page, second!);
    expect(keys.filter((k) => k.includes(`/${segment(next)}/`))).toHaveLength(expected.length);
    expect((await bucket(page)).originals).toHaveLength(1);
  });

  test('saving without touching the crop asks for no sizes', async ({ page }) => {
    await addOne(page);
    const before = (await bucket(page)).calls.length;
    await form(page).getByLabel('Name').fill('Garden room two');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    expect((await bucket(page)).calls.length).toBe(before);
  });

  test('a replacement is uploaded and the old original stays; remove clears the value', async ({ page }) => {
    await addOne(page);
    const [first] = await banners(page);
    const b = banner(page);
    await b.file.setInputFiles(pick([1200, 800]));
    await expect(b.frame).toBeVisible();
    await expect.poll(async () => (await bucket(page)).originals.length).toBe(2);
    await save(page);
    await expect(form(page)).toHaveCount(0);
    const [second] = await banners(page);
    expect(second!.key).not.toBe(first!.key);
    expect(second).toMatchObject({ width: 1200, height: 800 });

    await page.locator('.wd-list__item', { hasText: 'Garden room' }).getByRole('button', { name: /^edit/ }).click();
    await expect(b.frame).toBeVisible();
    await b.remove.click();
    await expect(b.frame).toBeHidden();
    await b.alt.fill('');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    expect(await banners(page)).toEqual([]);
  });

  test('a field with no shape shows the largest size that was made', async ({ page }) => {
    await openAdd(page);
    await photo(page).file.setInputFiles(pick([1000, 600]));
    await photo(page).alt.fill('The view');
    await save(page);
    await expect(form(page)).toHaveCount(0);
    await page.locator('.wd-list__item', { hasText: 'Garden room' }).getByRole('button', { name: /^edit/ }).click();
    const stored = (await state(page)).at(-1)!.values.photo as { key: string };
    const img = form(page).locator('.wd-image__img').first();
    await expect(img).toHaveAttribute('src', `/media/${stored.key}/whole/1000.webp`);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });
});
