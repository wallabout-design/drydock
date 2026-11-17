// The in-page text editor, served at /admin/editor.js. The server adds it to a
// public page only for signed-in staff (/admin/edit); public pages never load
// it. Every element marked data-copy="<key>" becomes editable as plain text.
// Changes collect in the bar at the bottom and are sent as one change. The
// server checks everything again: the checks here only spare a round trip.
// Plain JavaScript with no dependencies and no build step. Started from the
// site trial's public/admin/edit.js, with the extras from Rutland Reserve's
// CopyEditor: a counter, undo of the last save, "use mine instead" after a
// stale refusal, a warning before leaving, and site rules as you type.
// Lists are edited here too (the "lists on the page" section below): edit,
// remove and move on each data-item, add on each data-list, each sent at once
// as its own change and opening the same item form as the list page.

const settings = JSON.parse(document.getElementById('editor-settings')?.textContent ?? '{}');
const review = settings.mode === 'review';

/** Plain text on one line: one space between words, none at the ends. */
const tidy = (text) => text.replace(/\s+/g, ' ').trim();
const lengthOf = (text) => [...text].length;
/** Anything that could start a tag, comment or doctype (the same test the server runs). */
const MARKUP = /<\s*[A-Za-z/!?]/;
/** The counter shows once this share of the limit is used. */
const NEAR = 0.8;

const declared = new Map((settings.texts ?? []).map((t) => [t.key, t]));
const surfaces = new Map(); // key -> the element that holds the text
const live = new Map(); // key -> what the site holds now, as far as this page knows (sent as "seen")
const shown = new Map(); // key -> what the page shows as saved (live, or waiting for approval)
const pending = new Map(); // key -> { before, after, problem?, current? }
const waiting = new Set(); // keys saved but not on the site yet (review mode)
let saving = false;
let editing = null;
let lastSave = null; // { id, keys } of the last change that went live, for "undo last save"

const read = (el) => tidy(el.textContent ?? '');
const labelOf = (key) => declared.get(key)?.label ?? 'This text';
const maxOf = (key) => declared.get(key)?.max ?? Infinity;

/** What stops this text being saved, in plain words, or ''. */
function problemWith(key, text) {
  const label = labelOf(key);
  if (MARKUP.test(text)) return `${label} can only hold plain words: no tags like <b>. Please remove them.`;
  const length = lengthOf(text);
  if (length > maxOf(key)) return `${label} is too long: ${length} characters, and it fits ${maxOf(key)}.`;
  return '';
}

/** The counter's words once a text is near its limit, or null while there is plenty of room. */
function counterFor(key, text) {
  const max = maxOf(key);
  if (!Number.isFinite(max)) return null;
  const length = lengthOf(text);
  if (length < Math.ceil(max * NEAR)) return null;
  const left = max - length;
  if (left > 0) return { over: false, text: `${left} ${left === 1 ? 'character' : 'characters'} left` };
  if (left === 0) return { over: false, text: `That is as long as this text can be (${max} characters).` };
  return { over: true, text: `${-left} over the limit of ${max}` };
}

function make(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

// --- the bar ---------------------------------------------------------------

const statusLine = make('p', { class: 'wd-editor__status', role: 'status' });
const counter = make('p', { class: 'wd-editor__count' });
const list = make('ul', { class: 'wd-editor__list', 'aria-label': 'changes to save' });
const saveButton = make('button', { type: 'button', class: 'wd-editor__save' }, ['nothing to save']);
const undoSaveButton = make('button', { type: 'button', class: 'wd-editor__undo-save', hidden: '' }, ['undo last save']);
const hint = make('p', { class: 'wd-editor__hint', id: 'wd-editor-hint' }, [
  'Click any outlined text to change it, or tab to it and press Enter. Enter finishes, Escape cancels.',
]);
const reviewNote = make('p', { class: 'wd-editor__note', hidden: '' }, [
  'Changes you save wait for an admin to approve them. Then they appear on the site.',
]);
// Shown while a text inside a link is edited: the link's own page, so it can still be reached.
const openLink = make('a', { class: 'wd-editor__open', hidden: '' }, ['open this link']);
const bar = make('aside', { class: 'wd-editor', 'aria-label': 'text editor' }, [
  make('div', { class: 'wd-editor__top' }, [
    make('p', { class: 'wd-editor__who' }, [`Editing as ${settings.editor ?? 'staff'}`]),
    make('a', { href: settings.changesPage ?? '/admin/changes' }, ['Changes']),
    openLink,
  ]),
  hint,
  reviewNote,
  list,
  make('div', { class: 'wd-editor__actions' }, [saveButton, undoSaveButton, counter, statusLine]),
]);
reviewNote.hidden = !review;

function say(message, kind = '') {
  statusLine.textContent = message;
  statusLine.dataset.kind = kind;
}

function showCounter(key, text) {
  const c = key ? counterFor(key, text) : null;
  counter.textContent = c ? c.text : '';
  counter.dataset.over = c?.over ? 'true' : 'false';
}

function setState(key, state) {
  const el = surfaces.get(key);
  if (!el) return;
  if (state) el.dataset.editorState = state;
  else delete el.dataset.editorState;
}

function render() {
  list.replaceChildren(
    ...[...pending].map(([key, change]) => {
      const undo = make('button', { type: 'button', 'data-undo': key }, ['undo']);
      undo.setAttribute('aria-label', `undo the change to “${change.before}”`);
      const item = make('li', { class: 'wd-editor__item', 'data-key': key }, [
        make('span', { class: 'wd-editor__old' }, [change.before]),
        make('span', { 'aria-hidden': 'true' }, [' → ']),
        make('span', { class: 'wd-editor__sr' }, [' becomes ']),
        make('span', { class: 'wd-editor__new' }, [change.after]),
        undo,
      ]);
      if (change.problem) {
        item.dataset.problem = 'true';
        item.append(make('p', { class: 'wd-editor__problem' }, [change.problem]));
      }
      if (change.current !== undefined) {
        item.append(
          make('p', {}, ['The site now says: ', make('q', {}, [change.current])]),
          make('p', { class: 'wd-editor__choice' }, [
            make('button', { type: 'button', 'data-mine': key }, ['use mine instead']),
            make('button', { type: 'button', 'data-theirs': key }, ['use the site’s text']),
          ]),
        );
      }
      return item;
    }),
  );
  for (const key of surfaces.keys()) {
    const change = pending.get(key);
    if (change) setState(key, change.problem ? 'problem' : 'changed');
    else if (waiting.has(key)) setState(key, 'waiting');
    else if (surfaces.get(key).dataset.editorState !== 'saved') setState(key, '');
  }
  const blocked = [...pending.values()].some((change) => change.problem);
  const n = pending.size;
  saveButton.textContent = n === 0 ? 'nothing to save' : `save ${n} change${n === 1 ? '' : 's'}`;
  saveButton.disabled = n === 0 || blocked || saving;
  undoSaveButton.hidden = lastSave === null;
}

/** Puts the page's text back to a saved state. */
function put(key, text) {
  const el = surfaces.get(key);
  if (el && editing !== el) el.textContent = text;
}

// --- site rules as you type ------------------------------------------------

const checks = new Map(); // key -> { n, controller }

/** Asks the server whether a site rule refuses this text. Gives the message, '' or null (no answer). */
async function ruleProblem(key, text) {
  const previous = checks.get(key);
  previous?.controller.abort();
  const mine = { n: (previous?.n ?? 0) + 1, controller: new AbortController() };
  checks.set(key, mine);
  try {
    const response = await fetch(settings.check, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, text }),
      signal: mine.controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (checks.get(key) !== mine) return null;
    return body.problems?.[0]?.message ?? '';
  } catch {
    return null;
  }
}

// --- editing text on the page ----------------------------------------------

function startEditing(el) {
  if (editing === el) return;
  editing = el;
  // A text inside a link: the click starts editing, so offer the link's page in the bar instead.
  setOpenLink(el.closest('a[href]'));
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    el.contentEditable = 'true'; // older browsers; paste and Enter are handled below either way
  }
  el.focus();
  // Where the caret did not land in the text (editing started from the keyboard),
  // select it all, so typing replaces it and the arrow keys move within it.
  const selection = getSelection();
  if (selection && !(selection.anchorNode && el.contains(selection.anchorNode))) selection.selectAllChildren(el);
  showCounter(el.dataset.copy, read(el));
}

/** Records (or clears) the change for a key from what its element now holds. */
function record(key) {
  const el = surfaces.get(key);
  if (!el) return;
  const before = shown.get(key) ?? '';
  const after = read(el);
  // Empty text is put back: a heading or button with no words breaks the page.
  el.textContent = after === '' ? before : after;
  if (after === before || after === '') pending.delete(key);
  else pending.set(key, { before, after, problem: problemWith(key, after) });
  const change = pending.get(key);
  if (after === '') say(`${labelOf(key)} can’t be left empty, so it was put back as it was.`, 'problem');
  else if (change?.problem) say(change.problem, 'problem');
  else if (change) say('Changed. Press save when you’re ready.');
  else say('');
  render();
  if (change && !change.problem) {
    ruleProblem(key, after).then((message) => {
      const now = pending.get(key);
      if (!message || !now || now.after !== after) return;
      now.problem = message;
      if (editing === null) say(message, 'problem');
      render();
    });
  }
}

function stopEditing(el, { cancel = false, keepLink = false } = {}) {
  if (editing !== el) return;
  editing = null;
  if (!keepLink) setOpenLink(null);
  el.removeAttribute('contenteditable');
  showCounter(null, '');
  const key = el.dataset.copy;
  if (cancel) {
    el.textContent = pending.get(key)?.after ?? shown.get(key) ?? '';
    say('Cancelled.');
  } else record(key);
}

/** Shows "open this link" for the link around an editing text (null hides it). */
function setOpenLink(link) {
  const to = link instanceof HTMLAnchorElement ? pageToEdit(link) : null;
  openLink.hidden = to === null;
  if (to !== null) openLink.href = `/admin/edit?page=${encodeURIComponent(to)}`;
  else openLink.removeAttribute('href');
}

// The path (and query) a link goes to when it is a page of this site outside /admin, else null.
function pageToEdit(link) {
  let url;
  try {
    url = new URL(link.getAttribute('href') ?? '', location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return null;
  // A link that stays on this page (an anchor, or the page itself) goes nowhere new.
  if (url.pathname + url.search === settings.page) return null;
  return url.pathname + url.search;
}

const marked = (target) => (target instanceof Element ? target.closest('[data-copy]:not(meta)') : null);

document.addEventListener(
  'click',
  (event) => {
    if (!(event.target instanceof Element) || bar.contains(event.target)) return;
    // Links and buttons on the page are switched off here: this view is for editing.
    // The editor's own controls (the list link, item tools, the item form) are not.
    if (event.target.closest('.wd-editor__list-link, [data-editor-ui]')) return;
    const link = event.target.closest('a[href], button, input, select, summary');
    const el = marked(event.target);
    if (link || el) event.preventDefault();
    // A link to another page of this site opens that page in the editor, unless its words are
    // themselves editable (then the click starts editing). Unsaved changes are asked about by
    // the beforeunload warning.
    if (!el && link instanceof HTMLAnchorElement) {
      const to = pageToEdit(link);
      if (to) location.assign(`/admin/edit?page=${encodeURIComponent(to)}`);
    }
    if (el) {
      event.stopPropagation();
      startEditing(el);
    }
  },
  true,
);
document.addEventListener('submit', (event) => event.preventDefault(), true);

document.addEventListener(
  'keydown',
  (event) => {
    const el = marked(event.target);
    if (!el || !surfaces.has(el.dataset.copy)) return;
    if (editing === el) {
      if (event.key === 'Enter') {
        event.preventDefault();
        stopEditing(el);
        el.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        stopEditing(el, { cancel: true });
        el.focus();
      }
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      startEditing(el);
    }
  },
  true,
);

document.addEventListener('focusout', (event) => {
  const el = marked(event.target);
  // Tabbing from the text to "open this link" keeps the link until it loses focus itself.
  if (el && editing === el) stopEditing(el, { keepLink: event.relatedTarget === openLink });
});
// The link is hidden once focus leaves it, so a keyboard user can tab on past it.
openLink.addEventListener('focusout', () => setOpenLink(null));
// Pressing on the link must not move focus away from the text first, or the link
// would be hidden before the click lands. The link then navigates as usual.
openLink.addEventListener('mousedown', (event) => event.preventDefault());

// Pasted and dropped content comes in as plain text on one line.
document.addEventListener('paste', (event) => {
  const el = marked(event.target);
  if (!el || editing !== el) return;
  event.preventDefault();
  const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
  const selection = getSelection();
  if (!text || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  el.normalize();
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
});
document.addEventListener('drop', (event) => {
  if (marked(event.target)) event.preventDefault();
});

// Say so as soon as the text runs past its limit or a site rule refuses it.
document.addEventListener('input', (event) => {
  const el = marked(event.target);
  if (!el || editing !== el) return;
  const key = el.dataset.copy;
  const text = read(el);
  showCounter(key, text);
  const problem = problemWith(key, text);
  el.dataset.editorState = problem ? 'problem' : 'editing';
  if (problem) return say(problem, 'problem');
  if (statusLine.dataset.kind === 'problem') say('');
  if (text === '') return;
  ruleProblem(key, text).then((message) => {
    if (editing !== el || read(el) !== text) return;
    el.dataset.editorState = message ? 'problem' : 'editing';
    if (message) say(message, 'problem');
  });
});

// --- the bar's buttons, and saving -----------------------------------------

bar.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button) return;
  const { undo, mine, theirs } = button.dataset;
  if (undo) {
    pending.delete(undo);
    put(undo, shown.get(undo) ?? '');
    say('Change undone.');
    render();
    surfaces.get(undo)?.focus();
  }
  if (mine) {
    // Their newest text is what this change is now measured against.
    const change = pending.get(mine);
    if (change?.current !== undefined) {
      live.set(mine, change.current);
      shown.set(mine, change.current);
      pending.set(mine, { before: change.current, after: change.after, problem: problemWith(mine, change.after) });
      render();
      save();
    }
  }
  if (theirs) {
    const change = pending.get(theirs);
    if (change?.current !== undefined) {
      live.set(theirs, change.current);
      shown.set(theirs, change.current);
      pending.delete(theirs);
      put(theirs, change.current);
      say('Now showing the site’s newest text.');
      render();
      surfaces.get(theirs)?.focus();
    }
  }
});

async function post(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      // An expired sign-in answers with a redirect to a login page; don't follow it.
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

async function save() {
  if (saving || pending.size === 0) return;
  saving = true;
  render();
  say('Saving…');
  const sent = [...pending].map(([key, change]) => ({ key, after: change.after }));
  const ops = sent.map(({ key, after }) => ({ op: 'setText', key, text: after, seen: live.get(key) ?? shown.get(key) ?? '' }));
  const { status, body } = await post(settings.api, { ops });
  saving = false;

  if (status === 200 && body.change) {
    const texts = new Map(body.change.ops.map((o) => [o.key, o.text]));
    lastSave = null;
    for (const { key, after } of sent) {
      const text = texts.get(key) ?? after;
      shown.set(key, text);
      pending.delete(key);
      put(key, text);
      if (review) {
        waiting.add(key);
        setState(key, 'waiting');
      } else {
        live.set(key, text);
        waiting.delete(key);
        setState(key, 'saved');
      }
    }
    if (review) say('Saved. It will appear on the site once an admin approves it.', 'saved');
    else {
      lastSave = { id: body.change.id };
      say('Saved. It’s on the site now.', 'saved');
    }
  } else if (status === 409 && body.error === 'stale') {
    const key = sent[body.index]?.key;
    const change = key ? pending.get(key) : undefined;
    if (change) {
      change.current = body.current?.texts?.[key] ?? change.before;
      change.problem = 'Someone changed this text after you opened the page. Their text is below; choose which to keep.';
    }
    say('Not saved: someone changed some of this text after you opened the page. Choose what to do with it below.', 'problem');
  } else if (status === 422 && Array.isArray(body.problems)) {
    for (const problem of body.problems) {
      const change = pending.get(sent[problem.index]?.key);
      if (change) change.problem = problem.message;
    }
    say('Not saved yet: one of the changes needs fixing. See the list.', 'problem');
  } else if (status === 403 || status === 0) {
    say('Not saved: you’re signed out. Open this site’s /admin in a new tab, sign in, then come back and press save.', 'problem');
  } else if (status === -1) {
    say('Couldn’t reach the site. Check your connection and press save again; your changes are still here.', 'problem');
  } else {
    say(body.message ?? 'Couldn’t save just now. Your changes are still here; try again in a minute.', 'problem');
  }
  render();
  if (pending.size > 0) saveButton.focus();
}
saveButton.addEventListener('click', save);

undoSaveButton.addEventListener('click', async () => {
  if (!lastSave) return;
  const { id } = lastSave;
  undoSaveButton.disabled = true;
  const { status, body } = await post(`${settings.api}/${encodeURIComponent(id)}/undo`);
  undoSaveButton.disabled = false;
  if (status === 200 && body.change) {
    for (const o of body.change.ops) {
      if (o.op !== 'setText') continue;
      live.set(o.key, o.text);
      shown.set(o.key, o.text);
      pending.delete(o.key);
      put(o.key, o.text);
      setState(o.key, 'saved');
    }
    lastSave = null;
    say('Undone. The text is back to how it was.', 'saved');
  } else {
    say('Couldn’t undo that: the text has been changed again since. Edit it instead.', 'problem');
  }
  render();
});

// Leaving with changes that aren't saved loses them: ask first.
addEventListener('beforeunload', (event) => {
  const unsaved = pending.size > 0 || (editing !== null && read(editing) !== (shown.get(editing.dataset.copy) ?? ''));
  if (!unsaved) return;
  event.preventDefault();
  event.returnValue = '';
});

// --- lists on the page -------------------------------------------------------

const lists = new Map(); // name -> { decl, items: [{ id, values }], el }
const newId = () => `i-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
let formOpen = false;
let removing = null; // { list, id } while an item asks "really remove?"

const titleOf = (decl, values) => {
  const title = values?.[decl.titleField];
  return typeof title === 'string' && title !== '' ? title : `this ${decl.singular}`;
};

/** The order shown: as stored for a list moved by hand, otherwise by its sort field. */
function ordered(entry) {
  const { decl, items } = entry;
  if (decl.sort === 'hand') return items;
  const direction = decl.sort.order === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = a.values[decl.sort.by];
    const y = b.values[decl.sort.by];
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * direction;
  });
}

const itemElements = (entry) =>
  [...entry.el.querySelectorAll('[data-item]')].filter((el) => el.closest('[data-list]') === entry.el && entry.items.some((i) => i.id === el.getAttribute('data-item')));
const elementOf = (entry, id) => itemElements(entry).find((el) => el.getAttribute('data-item') === id);

/** Sends one change for a list. Gives { ok, change } or { problems } to show in words. */
async function sendOps(entry, ops) {
  const { status, body } = await post(settings.api, { ops });
  if (status === 200 && body.change) return { ok: true, change: body.change };
  const problem = (message) => ({ problems: [{ field: '_item', message }] });
  if (status === 409 && body.error === 'stale') {
    const current = body.current?.lists?.[entry.decl.name];
    if (current) entry.items = current;
    return problem(`Someone else changed this ${entry.decl.singular} or the list after you opened the page. Reload the page to see the newest version, then try again.`);
  }
  if (status === 422 && Array.isArray(body.problems)) return { problems: body.problems.map((p) => ({ field: p.field, message: p.message })) };
  if (status === 403 || status === 0) return problem('You’re signed out. Open this site’s /admin in a new tab, sign in, then come back and try again.');
  if (status === -1) return problem('Couldn’t reach the site. Check your connection and try again.');
  return problem(body.message ?? 'Couldn’t save just now. Try again in a minute.');
}

/** Puts a saved change into what this page knows and shows, once it is live. */
function applyLive(entry, ops) {
  for (const o of ops) {
    if (o.list !== entry.decl.name) continue;
    if (o.op === 'addItem') {
      const at = o.after === null ? 0 : entry.items.findIndex((i) => i.id === o.after) + 1;
      entry.items.splice(at, 0, { id: o.id, values: o.values });
    } else if (o.op === 'editItem') {
      const item = entry.items.find((i) => i.id === o.id);
      const old = item ? titleOf(entry.decl, item.values) : '';
      if (item) item.values = o.values;
      const el = item && elementOf(entry, o.id);
      if (el) entry.retitled = retitle(el, old, titleOf(entry.decl, o.values));
    } else if (o.op === 'removeItem') {
      elementOf(entry, o.id)?.remove();
      entry.items = entry.items.filter((i) => i.id !== o.id);
    } else if (o.op === 'moveItem') {
      const el = elementOf(entry, o.id);
      const at = entry.items.findIndex((i) => i.id === o.id);
      if (at < 0) continue;
      const [item] = entry.items.splice(at, 1);
      entry.items.splice(o.after === null ? 0 : entry.items.findIndex((i) => i.id === o.after) + 1, 0, item);
      const anchor = o.after === null ? null : elementOf(entry, o.after);
      if (el && anchor) anchor.after(el);
      else if (el && o.after === null) itemElements(entry).find((other) => other !== el)?.before(el);
    }
  }
}

/** Shows a new title where the old one is, when the item is plain text there. Gives whether it did. */
function retitle(el, before, after) {
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() === before);
  if (!node) return false;
  node.nodeValue = node.nodeValue.replace(before, after);
  return true;
}

/** An element for a newly added item, when the list's items are plain text; otherwise null. */
function newItemElement(entry, id, title) {
  const last = itemElements(entry).at(-1);
  if (!last) return null;
  const copy = last.cloneNode(true);
  copy.querySelectorAll('[data-editor-ui]').forEach((n) => n.remove());
  if (copy.children.length > 0 || copy.textContent.trim() === '') return null;
  copy.setAttribute('data-item', id);
  copy.textContent = title;
  return copy;
}

function toolButton(action, label, title) {
  return make('button', { type: 'button', 'data-action': action, 'aria-label': `${label} ${title}` }, [label]);
}

/** Draws each item's tools (edit, remove, move) from what the list holds now. */
function drawTools(entry, focus) {
  const byHand = entry.decl.sort === 'hand';
  const els = itemElements(entry);
  els.forEach((el, index) => {
    const id = el.getAttribute('data-item');
    const item = entry.items.find((i) => i.id === id);
    const title = titleOf(entry.decl, item.values);
    el.querySelector(':scope > [data-editor-tools]')?.remove();
    const tools = make('span', { class: 'wd-item-tools', 'data-editor-ui': '', 'data-editor-tools': '' });
    if (removing?.list === entry.decl.name && removing.id === id) {
      tools.append(
        make('span', { class: 'wd-item-tools__ask' }, [`Remove “${title}” from the site?`]),
        make('button', { type: 'button', 'data-action': 'confirm-remove' }, ['yes, remove']),
        make('button', { type: 'button', 'data-action': 'keep' }, ['keep it']),
      );
    } else {
      const up = toolButton('up', 'move up', title);
      const down = toolButton('down', 'move down', title);
      if (index === 0) up.disabled = true;
      if (index === els.length - 1) down.disabled = true;
      tools.append(toolButton('edit', 'edit', title), toolButton('remove', 'remove', title), ...(byHand ? [up, down] : []));
    }
    tools.addEventListener('click', (event) => onTool(event, entry, id));
    el.append(tools);
  });
  const full = entry.items.length >= entry.decl.maxItems;
  entry.add.disabled = full || formOpen;
  entry.add.title = full ? `This list is full: it holds at most ${entry.decl.maxItems} ${entry.decl.label}. Remove one to add another.` : '';
  if (focus) {
    const scope = focus.id ? elementOf(entry, focus.id) : null;
    const target = scope?.querySelector(`[data-action="${focus.action}"]:not(:disabled)`) ?? scope?.querySelector('button:not(:disabled)') ?? entry.add;
    target.focus();
  }
}

function markWaiting(entry, ops) {
  for (const o of ops) {
    const el = o.id ? elementOf(entry, o.id) : null;
    if (el) el.dataset.editorState = 'waiting';
  }
}

/** What staff are told once a list change is accepted. */
function savedLine(done, extra = '') {
  say(review ? `${done} It will appear on the site once an admin approves it.` : `${done} It’s on the site now.${extra}`, 'saved');
}

/** Sends a change from an item's tools, then updates the page. */
async function runOps(entry, ops, done, focus) {
  say('Saving…');
  const result = await sendOps(entry, ops);
  removing = null;
  if (!result.ok) {
    say(result.problems.map((p) => p.message).join(' '), 'problem');
    return drawTools(entry, focus);
  }
  if (review) markWaiting(entry, ops);
  else applyLive(entry, result.change.ops);
  drawTools(entry, focus);
  savedLine(done);
}

function onTool(event, entry, id) {
  const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const item = entry.items.find((i) => i.id === id);
  if (!item) return;
  const { name } = entry.decl;
  const title = titleOf(entry.decl, item.values);
  const action = button.dataset.action;
  if (action === 'edit') openForm(entry, item);
  else if (action === 'remove') {
    removing = { list: name, id };
    drawTools(entry);
    elementOf(entry, id)?.querySelector('[data-action="keep"]')?.focus();
  } else if (action === 'keep') {
    removing = null;
    drawTools(entry, { id, action: 'remove' });
  } else if (action === 'confirm-remove') {
    // The item is gone, so focus goes to the add button.
    runOps(entry, [{ op: 'removeItem', list: name, id, seen: item.values }], `Removed “${title}”.`, { id: null });
  } else if (action === 'up' || action === 'down') {
    const shown = ordered(entry);
    const index = shown.findIndex((i) => i.id === id);
    const seen = index === 0 ? null : shown[index - 1].id;
    // Up goes after the item two places up; down goes after the item below.
    const after = action === 'up' ? (index < 2 ? null : shown[index - 2].id) : shown[index + 1]?.id;
    if (after === undefined) return;
    runOps(entry, [{ op: 'moveItem', list: name, id, after, seen }], `Moved “${title}” ${action}.`, { id, action });
  }
}

// The item form opens in a dialog over the page, so it works whatever the page's markup is.
let formModule = null;
async function openForm(entry, item) {
  if (formOpen) return;
  formOpen = true;
  const { decl } = entry;
  let module;
  try {
    formModule ??= import('/admin/item-form.js');
    module = await formModule;
  } catch {
    formModule = null;
    formOpen = false;
    return say('Couldn’t open the form. Check your connection and try again.', 'problem');
  }
  const dialog = make('dialog', { class: 'wd-editor__dialog', 'data-editor-ui': '', 'aria-label': item ? `Edit ${titleOf(decl, item.values)}` : `Add ${decl.singular}` });
  const close = (focus) => {
    if (!formOpen) return;
    formOpen = false;
    // Closing a modal dialog hands focus back to what was focused before it opened (WebKit does
    // this after close() returns, and that element is gone once the tools are drawn again). So
    // focus is set again once the dialog has finished closing, not only now.
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        drawTools(entry, focus);
      },
      { once: true },
    );
    dialog.close();
    drawTools(entry, focus);
  };
  const form = module.createItemForm({
    list: decl,
    item,
    onCancel: () => close(item ? { id: item.id, action: 'edit' } : { id: null }),
    async onSubmit(values) {
      const id = item ? item.id : newId();
      const ops = item
        ? [{ op: 'editItem', list: decl.name, id, values, seen: item.values }]
        : [{ op: 'addItem', list: decl.name, id, values, after: entry.items.length > 0 ? entry.items[entry.items.length - 1].id : null }];
      const result = await sendOps(entry, ops);
      if (!result.ok) return result;
      const saved = result.change.ops[0];
      const title = titleOf(decl, saved.values);
      let extra = '';
      if (review) {
        if (item) markWaiting(entry, ops);
      } else {
        entry.retitled = false;
        applyLive(entry, result.change.ops);
        if (!item) {
          const copy = newItemElement(entry, id, title);
          const previous = itemElements(entry).at(-1);
          if (copy && previous) previous.after(copy);
          else extra = ' Reload the page to see it here.';
        } else if (!entry.retitled) extra = ' Reload the page to see how it looks.';
      }
      close(item ? { id, action: 'edit' } : { id: review ? null : id, action: 'edit' });
      savedLine(`${item ? 'Changed' : 'Added'} “${title}”.`, extra);
    },
  });
  dialog.append(form.element);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(item ? { id: item.id, action: 'edit' } : { id: null });
  });
  document.body.append(dialog);
  drawTools(entry);
  dialog.showModal();
  form.focus();
}

// A list on the page gets a link to its own page (for fields the page does not show),
// an add button, and edit, remove and move on each item.
const listNames = new Map((settings.lists ?? []).map((l) => [l.name, l]));
for (const el of document.querySelectorAll('[data-list]')) {
  const decl = listNames.get(el.getAttribute('data-list') ?? '');
  if (!decl || lists.has(decl.name)) continue;
  const link = make('a', { class: 'wd-editor__list-link', href: `/admin/lists/${encodeURIComponent(decl.name)}` }, ['Edit this list']);
  link.setAttribute('aria-label', `Edit this list: ${decl.label}`);
  el.insertAdjacentElement('afterend', link);
  const add = make('button', { type: 'button', class: 'wd-editor__add', 'data-editor-ui': '' }, [`add ${decl.singular}`]);
  link.insertAdjacentElement('afterend', add);
  const entry = { decl, items: decl.items ?? [], el, add };
  lists.set(decl.name, entry);
  add.addEventListener('click', (event) => {
    event.preventDefault();
    openForm(entry, null);
  });
  drawTools(entry);
}

// --- start -----------------------------------------------------------------

for (const el of document.querySelectorAll('[data-copy]:not(meta)')) {
  const key = el.getAttribute('data-copy') ?? '';
  if (!key || surfaces.has(key) || !declared.has(key)) continue;
  const text = tidy(el.textContent ?? '');
  surfaces.set(key, el);
  live.set(key, declared.get(key).current ?? text);
  shown.set(key, text);
  el.tabIndex = 0;
  el.setAttribute('aria-describedby', hint.id);
}
hint.textContent =
  surfaces.size === 0
    ? 'No texts on this page can be edited.'
    : `${surfaces.size} ${surfaces.size === 1 ? 'text' : 'texts'} on this page can be edited. ${hint.textContent}`;
document.body.append(bar);
document.documentElement.dataset.editor = 'on';
render();
