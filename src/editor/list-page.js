// The list page, served at /admin/lists/<name>: the items in order, with add,
// edit, remove (asks first, then offers undo) and move up and down. Every action
// is one change sent to POST /admin/api/changes. The form for an item is its own
// module (item-form.js), so the page itself can open the same form later.
// Plain JavaScript with no dependencies and no build step.
import { createItemForm } from '/admin/item-form.js';

const settings = JSON.parse(document.getElementById('editor-settings')?.textContent ?? '{}');
const { list } = settings;
const review = settings.mode === 'review';
// When a saved change is live, as the store says (settings.capabilities.goesLive, see StoreCapabilities).
const liveLine = settings.capabilities?.goesLive === 'after-checks' ? 'It’s live in a few minutes, after checks.' : 'It’s on the site now.';
const byHand = list.sort === 'hand';
let items = settings.items;
let lastChange = null; // { id } of the last change that went live, for "undo"
let open = null; // { form, mount } while the add or edit form is showing
let removing = null; // id of the item asking "really remove?"

function make(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

const titleOf = (values) => {
  const title = values?.[list.titleField];
  return typeof title === 'string' && title !== '' ? title : `this ${list.singular}`;
};
const newId = () => `i-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** The order shown: as stored for a list moved by hand, otherwise by the sort field. */
function ordered() {
  if (byHand) return items;
  const direction = list.sort.order === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = a.values[list.sort.by];
    const y = b.values[list.sort.by];
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * direction;
  });
}

// --- applying a change to what is shown ------------------------------------

function apply(ops) {
  for (const o of ops) {
    if (o.list !== list.name) continue;
    if (o.op === 'addItem') {
      const at = o.after === null ? 0 : items.findIndex((i) => i.id === o.after) + 1;
      items.splice(at, 0, { id: o.id, values: o.values });
    } else if (o.op === 'editItem') {
      const item = items.find((i) => i.id === o.id);
      if (item) item.values = o.values;
    } else if (o.op === 'removeItem') {
      items = items.filter((i) => i.id !== o.id);
    } else if (o.op === 'moveItem') {
      const at = items.findIndex((i) => i.id === o.id);
      if (at < 0) continue;
      const [item] = items.splice(at, 1);
      items.splice(o.after === null ? 0 : items.findIndex((i) => i.id === o.after) + 1, 0, item);
    }
  }
}

// --- the page --------------------------------------------------------------

const status = make('p', { class: 'wd-list__status', role: 'status' });
const undoButton = make('button', { type: 'button', class: 'wd-list__undo', hidden: '' }, ['undo']);
const rows = make('ol', { class: 'wd-list__items', 'aria-label': list.label });
const empty = make('p', { class: 'wd-list__empty' }, [`There are no ${list.label} yet.`]);
const addButton = make('button', { type: 'button', class: 'wd-list__add' }, [`add ${list.singular}`]);
const full = make('p', { class: 'wd-list__full' }, [`This list is full: it holds at most ${list.maxItems} ${list.label}. Remove one to add another.`]);
const formMount = make('div', { class: 'wd-list__form' });
const root = document.getElementById('wd-list');
root.replaceChildren(
  make('div', { class: 'wd-list__bar' }, [status, undoButton]),
  rows,
  empty,
  make('div', { class: 'wd-list__add-row' }, [addButton, full]),
  formMount,
);

function say(message, kind = '', { undo = false } = {}) {
  status.textContent = message;
  status.dataset.kind = kind;
  undoButton.hidden = !undo;
}

function render(focus) {
  const shown = ordered();
  empty.hidden = shown.length > 0;
  rows.hidden = shown.length === 0;
  const isFull = items.length >= list.maxItems;
  addButton.disabled = isFull || open !== null;
  full.hidden = !isFull;
  rows.replaceChildren(
    ...shown.map((item, index) => {
      const title = titleOf(item.values);
      const button = (action, label) => make('button', { type: 'button', 'data-action': action, 'aria-label': `${label} ${title}` }, [label]);
      const li = make('li', { class: 'wd-list__item', 'data-item': item.id }, [make('span', { class: 'wd-list__title' }, [title])]);
      if (removing === item.id) {
        li.append(
          make('span', { class: 'wd-list__confirm' }, [
            make('span', {}, [`Remove “${title}” from the site?`]),
            make('button', { type: 'button', 'data-action': 'confirm-remove' }, ['yes, remove']),
            make('button', { type: 'button', 'data-action': 'keep' }, ['keep it']),
          ]),
        );
        return li;
      }
      const up = button('up', 'move up');
      const down = button('down', 'move down');
      if (index === 0) up.disabled = true;
      if (index === shown.length - 1) down.disabled = true;
      li.append(
        make('span', { class: 'wd-list__actions' }, [
          button('edit', 'edit'),
          button('remove', 'remove'),
          ...(byHand ? [up, down] : []),
        ]),
      );
      return li;
    }),
  );
  if (focus) {
    const target = focus.item
      ? rows.querySelector(`[data-item="${CSS.escape(focus.item)}"] [data-action="${focus.action}"]:not(:disabled)`) ??
        rows.querySelector(`[data-item="${CSS.escape(focus.item)}"] button:not(:disabled)`)
      : addButton;
    (target ?? addButton).focus();
  }
}

// --- sending a change ------------------------------------------------------

async function post(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { status: -1, body: {} };
  }
  const json = await response.json().catch(() => ({}));
  return { status: response.type === 'opaqueredirect' ? 0 : response.status, body: json };
}

/**
 * Sends one change. Gives { ok: true } when it worked, or { problems } to show
 * (in the form when one is open, otherwise in the status line).
 */
async function submit(ops) {
  const { status: code, body } = await post(settings.api, { ops });
  if (code === 200 && body.change) {
    // Waiting (an admin's approval, or the store's checks) is not on the site yet: nothing is applied or undone.
    if (review || body.change.state === 'waiting') {
      lastChange = null;
    } else {
      apply(body.change.ops);
      lastChange = { id: body.change.id };
    }
    return { ok: true };
  }
  const problem = (message, field = '_item') => ({ problems: [{ field, message }] });
  if (code === 409 && body.error === 'stale') {
    items = body.current?.lists?.[list.name] ?? items;
    removing = null;
    render();
    return problem(`Someone else changed this ${list.singular} or the list while you had it open. It is up to date below now; please check it and try again.`);
  }
  if (code === 422 && Array.isArray(body.problems)) return { problems: body.problems.map((p) => ({ field: p.field, message: p.message })) };
  if (code === 403 || code === 0) return problem('You’re signed out. Open this site’s /admin in a new tab, sign in, then come back and try again.');
  if (code === -1) return problem('Couldn’t reach the site. Check your connection and try again.');
  return problem(body.message ?? 'Couldn’t save just now. Try again in a minute.');
}

/** What staff are told once a change has been sent and accepted. */
function saved(done) {
  if (review) return say(`${done} It will appear on the site once an admin approves it.`, 'saved');
  say(`${done} ${liveLine}`, 'saved', { undo: lastChange !== null });
}

/** An action outside the form: a refusal goes to the status line. */
async function run(ops, done, focus) {
  const result = await submit(ops);
  if (!result.ok) {
    say(result.problems.map((p) => p.message).join(' '), 'problem');
    return render(focus);
  }
  removing = null;
  render(focus);
  saved(done);
}

// --- the form --------------------------------------------------------------

function closeForm(focus) {
  open?.form.destroy();
  open = null;
  formMount.replaceChildren();
  render(focus);
}

function openForm(item) {
  if (open) return;
  const form = createItemForm({
    list,
    item,
    uploads: settings.uploads,
    onCancel: () => closeForm(item ? { item: item.id, action: 'edit' } : { item: null }),
    async onSubmit(values) {
      const ops = item
        ? [{ op: 'editItem', list: list.name, id: item.id, values, seen: item.values }]
        : [{ op: 'addItem', list: list.name, id: newId(), values, after: items.length > 0 ? items[items.length - 1].id : null }];
      const result = await submit(ops);
      if (!result.ok) return result;
      const title = titleOf(ops[0].values);
      // What the server kept is what is shown, so the message names the cleaned title.
      closeForm(item ? { item: item.id, action: 'edit' } : { item: lastChange === null ? null : ops[0].id, action: 'edit' });
      saved(`${item ? 'Changed' : 'Added'} “${title}”.`);
    },
  });
  open = { form };
  formMount.replaceChildren(form.element);
  render();
  form.focus();
}

// --- buttons ---------------------------------------------------------------

addButton.addEventListener('click', () => openForm(null));

undoButton.addEventListener('click', async () => {
  if (!lastChange) return;
  undoButton.disabled = true;
  const { status: code, body } = await post(`${settings.api}/${encodeURIComponent(lastChange.id)}/undo`);
  undoButton.disabled = false;
  if (code === 200 && body.change) {
    apply(body.change.ops);
    lastChange = null;
    render();
    say('Undone. The list is back to how it was.', 'saved');
    addButton.focus();
  } else {
    say('Couldn’t undo that: the list has been changed again since. Change it by hand instead.', 'problem');
  }
});

rows.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  const li = button?.closest('[data-item]');
  if (!button || !li) return;
  const id = li.dataset.item;
  const at = items.findIndex((i) => i.id === id);
  const item = items[at];
  if (!item) return;
  const action = button.dataset.action;
  if (action === 'edit') openForm(item);
  else if (action === 'remove') {
    removing = id;
    render();
    rows.querySelector(`[data-item="${CSS.escape(id)}"] [data-action="keep"]`)?.focus();
  } else if (action === 'keep') {
    removing = null;
    render({ item: id, action: 'remove' });
  } else if (action === 'confirm-remove') {
    run([{ op: 'removeItem', list: list.name, id, seen: item.values }], `Removed “${titleOf(item.values)}”.`, null);
  } else if (action === 'up' || action === 'down') {
    const shown = ordered();
    const index = shown.findIndex((i) => i.id === id);
    const seen = index === 0 ? null : shown[index - 1].id;
    // Up goes after the item two places up; down goes after the item below.
    const after = action === 'up' ? (index < 2 ? null : shown[index - 2].id) : shown[index + 1]?.id;
    if (after === undefined) return;
    run([{ op: 'moveItem', list: list.name, id, after, seen }], `Moved “${titleOf(item.values)}” ${action}.`, { item: id, action });
  }
});

render();

// A link from another page (the rebuild images page) opens one item's form: ?edit=<id>.
const wanted = new URLSearchParams(location.search).get('edit');
const wantedItem = wanted === null ? undefined : items.find((i) => i.id === wanted);
if (wantedItem) openForm(wantedItem);
