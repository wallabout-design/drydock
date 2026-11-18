import { expect, test, type Locator, type Page } from '@playwright/test';
import { nextControl } from './keys.js';
import { AUTO, REVIEW } from './ports.js';

// The list page and the item form in a real browser, against the fixture site
// in server.mjs: a `rooms` list with one field of every type, three rooms to
// start with, room for two more.


type Room = { id: string; values: Record<string, unknown> };
const STARTING = ['blue', 'attic', 'porch'];

async function rooms(page: Page, origin = AUTO): Promise<Room[]> {
  return ((await (await page.request.get(`${origin}/__test/state`)).json()).lists.rooms as Room[]);
}
const ids = async (page: Page, origin = AUTO) => (await rooms(page, origin)).map((r) => r.id);

async function open(page: Page, origin = AUTO) {
  await page.request.post(`${origin}/__test/reset`);
  await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: origin }]);
  await page.goto(`${origin}/admin/lists/rooms`);
  await expect(page.getByRole('button', { name: 'add room' })).toBeVisible();
}

const titles = (page: Page) => page.locator('.wd-list__item .wd-list__title');
const status = (page: Page) => page.locator('.wd-list__status');
const form = (page: Page) => page.locator('form.wd-form');
const addRoom = (page: Page) => page.getByRole('button', { name: 'add room' });

/** The form's fields, by the words staff see. */
const fields = (page: Page) => ({
  name: form(page).getByLabel('Name'),
  about: form(page).getByLabel('About the room'),
  link: form(page).getByLabel('More information'),
  beds: form(page).getByLabel('Beds'),
  opens: form(page).getByLabel('First available'),
  pets: form(page).getByLabel('Pets welcome'),
  view: form(page).getByLabel('View'),
  photo: form(page).getByLabel(/^Photo/),
  alt: form(page).getByLabel(/^Describe photo/),
  save: form(page).getByRole('button', { name: 'save' }),
});

async function saveForm(page: Page) {
  await fields(page).save.click();
}

/** Opens the add form, fills in the fields given, and saves. */
async function add(page: Page, name: string) {
  await addRoom(page).click();
  await fields(page).name.fill(name);
  await saveForm(page);
}

test.describe('the page', () => {
  test('the edit view links to it, and it lists the items in order', async ({ page }) => {
    await page.request.post(`${AUTO}/__test/reset`);
    await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: AUTO }]);
    await page.goto(`${AUTO}/admin/edit?page=/`);
    const link = page.getByRole('link', { name: 'Edit this list' });
    await expect(link).toHaveCount(1);
    // The link sits next to the list it belongs to.
    expect(await page.locator('[data-list="rooms"] + a.wd-editor__list-link').count()).toBe(1);
    await link.click();
    await expect(page).toHaveURL(/\/admin\/lists\/rooms$/);
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch']);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit rooms');
  });

  test('signed out it gives nothing, and an unknown list is not found', async ({ page }) => {
    const signedOut = await page.request.get(`${AUTO}/admin/lists/rooms`);
    expect([signedOut.status(), await signedOut.text()]).toEqual([403, '']);
    await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: AUTO }]);
    expect((await page.request.get(`${AUTO}/admin/lists/nothing`)).status()).toBe(404);
  });
});

test.describe('add and edit', () => {
  test('add a room with every kind of field', async ({ page }) => {
    await open(page);
    await addRoom(page).click();
    await expect(form(page).getByRole('heading', { name: 'Add a new room' })).toBeVisible();
    await expect(fields(page).name).toBeFocused();
    const f = fields(page);
    await f.name.fill('Garden room');
    await f.about.fill('Opens onto the garden.\nQuiet at night.');
    await f.link.fill('https://example.com/garden');
    await f.beds.fill('3');
    await f.opens.fill('2026-07-04');
    await f.pets.check();
    await f.view.selectOption('garden');
    await f.photo.fill('https://example.com/garden.jpg');
    await f.alt.fill('The garden at dusk');
    await saveForm(page);

    await expect(status(page)).toHaveText('Added “Garden room”. It’s on the site now.');
    await expect(form(page)).toHaveCount(0);
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch', 'Garden room']);
    const added = (await rooms(page)).at(-1)!;
    expect(added.values).toEqual({
      title: 'Garden room',
      blurb: 'Opens onto the garden.\nQuiet at night.',
      link: 'https://example.com/garden',
      beds: 3,
      opens: '2026-07-04',
      pets: true,
      view: 'garden',
      photo: { src: 'https://example.com/garden.jpg', alt: 'The garden at dusk' },
    });
    // Focus goes back to the new room's own button.
    await expect(page.locator(`[data-item="${added.id}"] [data-action="edit"]`)).toBeFocused();
  });

  test('edit a room: the form starts with what is there, other fields stay', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'edit Blue room' }).click();
    const f = fields(page);
    await expect(form(page).getByRole('heading', { name: 'Edit this room' })).toBeVisible();
    await expect(f.name).toHaveValue('Blue room');
    await expect(f.beds).toHaveValue('2');
    await expect(f.view).toHaveValue('lake');
    await expect(f.pets).not.toBeChecked();
    await f.name.fill('Big blue room');
    await f.pets.check();
    await saveForm(page);
    await expect(status(page)).toHaveText('Changed “Big blue room”. It’s on the site now.');
    await expect(titles(page)).toHaveText(['Big blue room', 'Attic', 'Porch']);
    const blue = (await rooms(page)).find((r) => r.id === 'blue')!;
    expect(blue.values).toEqual({ title: 'Big blue room', beds: 2, pets: true, view: 'lake' });
    await expect(page.getByRole('button', { name: 'edit Big blue room' })).toBeFocused();
  });

  test('a change can be undone', async ({ page }) => {
    await open(page);
    await add(page, 'Cellar');
    await expect(titles(page)).toHaveCount(4);
    await page.getByRole('button', { name: 'undo' }).click();
    await expect(status(page)).toContainText('Undone');
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch']);
    expect(await ids(page)).toEqual(STARTING);
  });

  test('cancel closes the form and saves nothing', async ({ page }) => {
    await open(page);
    await addRoom(page).click();
    await fields(page).name.fill('Never saved');
    await form(page).getByRole('button', { name: 'cancel' }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(addRoom(page)).toBeFocused();
    await addRoom(page).click();
    await page.keyboard.press('Escape');
    await expect(form(page)).toHaveCount(0);
    expect(await ids(page)).toEqual(STARTING);
  });
});

test.describe('remove', () => {
  test('asks first, then offers undo', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'remove Attic' }).click();
    await expect(page.getByText('Remove “Attic” from the site?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'keep it' })).toBeFocused();
    expect(await ids(page)).toEqual(STARTING);

    await page.getByRole('button', { name: 'keep it' }).click();
    await expect(page.getByText('Remove “Attic” from the site?')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'remove Attic' })).toBeFocused();
    expect(await ids(page)).toEqual(STARTING);

    await page.getByRole('button', { name: 'remove Attic' }).click();
    await page.getByRole('button', { name: 'yes, remove' }).click();
    await expect(status(page)).toHaveText('Removed “Attic”. It’s on the site now.');
    await expect(titles(page)).toHaveText(['Blue room', 'Porch']);
    expect(await ids(page)).toEqual(['blue', 'porch']);

    await page.getByRole('button', { name: 'undo' }).click();
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch']);
    const state = await rooms(page);
    expect(state.map((r) => r.id)).toEqual(STARTING);
    expect(state[1]!.values).toEqual({ title: 'Attic', pets: true });
  });
});

test.describe('move', () => {
  test('up and down change the order, and the ends cannot go further', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'move up Blue room' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'move down Porch' })).toBeDisabled();

    await page.getByRole('button', { name: 'move down Blue room' }).click();
    await expect(titles(page)).toHaveText(['Attic', 'Blue room', 'Porch']);
    expect(await ids(page)).toEqual(['attic', 'blue', 'porch']);
    await expect(status(page)).toContainText('Moved “Blue room” down');
    // Focus stays on the button just used, so it can be pressed again.
    await expect(page.getByRole('button', { name: 'move down Blue room' })).toBeFocused();

    await page.getByRole('button', { name: 'move up Porch' }).click();
    await expect(titles(page)).toHaveText(['Attic', 'Porch', 'Blue room']);
    expect(await ids(page)).toEqual(['attic', 'porch', 'blue']);

    await page.getByRole('button', { name: 'move up Porch' }).click();
    await expect(titles(page)).toHaveText(['Porch', 'Attic', 'Blue room']);
    expect(await ids(page)).toEqual(['porch', 'attic', 'blue']);
    // Now first: the up button is off, so focus lands on another button of the row.
    await expect(page.locator('[data-item="porch"] button:focus')).toHaveCount(1);

    await page.getByRole('button', { name: 'undo' }).click();
    await expect(titles(page)).toHaveText(['Attic', 'Porch', 'Blue room']);
    expect(await ids(page)).toEqual(['attic', 'porch', 'blue']);
  });
});

test.describe('mistakes', () => {
  /** Saves and expects the form to stay open, with this message next to this field. */
  async function refused(page: Page, field: Locator, message: RegExp) {
    await saveForm(page);
    await expect(form(page)).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(message);
    await expect(field).toBeFocused();
    expect(await ids(page)).toEqual(STARTING);
  }

  test('each kind of mistake is said next to its field, with focus on the first', async ({ page }) => {
    await open(page);
    await addRoom(page).click();
    const f = fields(page);

    // Nothing filled in: the name is needed.
    await refused(page, f.name, /Name is needed\./);

    await f.name.fill('x'.repeat(41));
    await refused(page, f.name, /Name is too long: 41 characters, and it fits 40\./);

    await f.name.fill('<b>Bold</b>');
    await refused(page, f.name, /Name can only hold plain words/);

    await f.name.fill('Room at 12 Main Street');
    await refused(page, f.name, /leave the street name out/);

    await f.name.fill('Fine name');
    await f.about.fill('y'.repeat(201));
    await refused(page, f.about, /too long: 201 characters, and it fits 200\./);
    await f.about.fill('');

    await f.link.fill('notalink');
    await refused(page, f.link, /must be a full web address, starting with https:\/\//);
    await f.link.fill('http://example.com');
    await refused(page, f.link, /starting with https:\/\//);
    await f.link.fill('');

    await f.beds.fill('many');
    await refused(page, f.beds, /Beds must be a number\./);
    await f.beds.fill('11');
    await refused(page, f.beds, /Beds must be from 1 to 10\./);
    await f.beds.fill('2.5');
    await refused(page, f.beds, /Beds must be a whole number\./);
    await f.beds.fill('');

    await f.photo.fill('ftp://example.com/a.jpg');
    await f.alt.fill('Described');
    await refused(page, f.photo, /Photo must be an https web address or a path on the site/);
    await f.photo.fill('https://example.com/a.jpg');
    await f.alt.fill('');
    await refused(page, f.alt, /description of photo is needed, for people who can’t see the image/i);

    // Several at once: every one is shown, and focus goes to the first in the form.
    await f.name.fill('');
    await f.beds.fill('99');
    await f.link.fill('nope');
    await saveForm(page);
    await expect(f.name).toHaveAccessibleDescription(/Name is needed/);
    await expect(f.link).toHaveAccessibleDescription(/web address/);
    await expect(f.beds).toHaveAccessibleDescription(/from 1 to 10/);
    await expect(f.alt).toHaveAccessibleDescription(/is needed/);
    await expect(f.name).toBeFocused();

    // Fixing them all saves it, and the errors are gone.
    await f.name.fill('Fixed');
    await f.beds.fill('4');
    await f.link.fill('https://example.com/ok');
    await f.alt.fill('A bright room');
    await saveForm(page);
    await expect(form(page)).toHaveCount(0);
    expect((await ids(page)).length).toBe(4);
  });

  test('every field has help text before anything goes wrong', async ({ page }) => {
    await open(page);
    await addRoom(page).click();
    const f = fields(page);
    await expect(f.name).toHaveAccessibleDescription(/Up to 40 characters/);
    await expect(f.about).toHaveAccessibleDescription(/Up to 200 characters/);
    await expect(f.link).toHaveAccessibleDescription(/starting with https:\/\//);
    await expect(f.beds).toHaveAccessibleDescription(/whole number, from 1 to 10/);
    await expect(f.opens).toHaveAccessibleDescription(/Pick a date/);
    await expect(f.view).toHaveAccessibleDescription(/Choose one/);
    await expect(f.photo).toHaveAccessibleDescription(/image that is already online/);
    await expect(f.alt).toHaveAccessibleDescription(/what the image shows/);
  });

  test('someone else changed the list while the form was open', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'edit Blue room' }).click();
    await page.request.post(`${AUTO}/__test/submit`, {
      data: { ops: [{ op: 'editItem', list: 'rooms', id: 'blue', values: { title: 'Their blue room', pets: false }, seen: { title: 'Blue room', beds: 2, pets: false, view: 'lake' } }] },
    });
    await fields(page).name.fill('My blue room');
    await saveForm(page);
    const summary = form(page).locator('.wd-form__summary');
    await expect(summary).toContainText('Someone else changed');
    await expect(summary).toBeFocused();
    // What is shown behind the form is what the site has now.
    await expect(titles(page).first()).toHaveText('Their blue room');
    expect((await rooms(page)).find((r) => r.id === 'blue')!.values.title).toBe('Their blue room');
  });
});

test.describe('limits and keyboard', () => {
  test('a full list says so and cannot take more', async ({ page }) => {
    await page.request.post(`${AUTO}/__test/reset`);
    let after = 'porch';
    for (const id of ['d', 'e']) {
      const response = await page.request.post(`${AUTO}/__test/submit`, {
        data: { ops: [{ op: 'addItem', list: 'rooms', id, values: { title: `Room ${id}` }, after }] },
      });
      expect(response.status()).toBe(200);
      after = id;
    }
    await page.context().addCookies([{ name: 'test-user', value: 'ed@example.com', url: AUTO }]);
    await page.goto(`${AUTO}/admin/lists/rooms`);
    await expect(titles(page)).toHaveCount(5);
    await expect(addRoom(page)).toBeDisabled();
    await expect(page.getByText('This list is full: it holds at most 5 rooms.')).toBeVisible();
    // Removing one makes room again.
    await page.getByRole('button', { name: 'remove Room e' }).click();
    await page.getByRole('button', { name: 'yes, remove' }).click();
    await expect(addRoom(page)).toBeEnabled();
  });

  test('add a room with the keyboard alone', async ({ page }) => {
    await open(page);
    for (let presses = 0; presses < 30 && !(await addRoom(page).evaluate((el) => el === document.activeElement)); presses++) {
      await nextControl(page);
    }
    await expect(addRoom(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fields(page).name).toBeFocused();
    await page.keyboard.type('Keyboard room');
    await page.keyboard.press('Enter');
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch', 'Keyboard room']);
  });
});

test.describe('changes wait for an admin', () => {
  test('a saved change waits, and the list shows what is on the site', async ({ page }) => {
    await open(page, REVIEW);
    await expect(page.getByText('waits for an admin to approve it')).toBeVisible();
    await add(page, 'Waiting room');
    await expect(status(page)).toContainText('once an admin approves it');
    await expect(page.getByRole('button', { name: 'undo' })).toBeHidden();
    await expect(titles(page)).toHaveText(['Blue room', 'Attic', 'Porch']);
    expect(await ids(page, REVIEW)).toEqual(STARTING);

    await page.request.post(`${REVIEW}/__test/approve`);
    expect((await ids(page, REVIEW)).length).toBe(4);
    await page.reload();
    await expect(titles(page).last()).toHaveText('Waiting room');
  });
});
