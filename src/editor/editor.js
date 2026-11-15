// The in-page text editor, served at /admin/editor.js. The server adds it to a
// public page only for signed-in staff (/admin/edit); public pages never load
// it. Every element marked data-copy="<key>" becomes editable as plain text.
// Changes collect in the bar at the bottom and are sent as one change. The
// server checks everything again: the checks here only spare a round trip.
// Plain JavaScript with no dependencies and no build step. Started from the
// site trial's public/admin/edit.js, with the extras from Rutland Reserve's
// CopyEditor: a counter, undo of the last save, "use mine instead" after a
// stale refusal, a warning before leaving, and site rules as you type.

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
const bar = make('aside', { class: 'wd-editor', 'aria-label': 'text editor' }, [
  make('div', { class: 'wd-editor__top' }, [
    make('p', { class: 'wd-editor__who' }, [`Editing as ${settings.editor ?? 'staff'}`]),
    make('a', { href: settings.changesPage ?? '/admin/changes' }, ['Changes']),
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

function stopEditing(el, { cancel = false } = {}) {
  if (editing !== el) return;
  editing = null;
  el.removeAttribute('contenteditable');
  showCounter(null, '');
  const key = el.dataset.copy;
  if (cancel) {
    el.textContent = pending.get(key)?.after ?? shown.get(key) ?? '';
    say('Cancelled.');
  } else record(key);
}

const marked = (target) => (target instanceof Element ? target.closest('[data-copy]:not(meta)') : null);

document.addEventListener(
  'click',
  (event) => {
    if (!(event.target instanceof Element) || bar.contains(event.target)) return;
    // Links and buttons on the page are switched off here: this view is for editing.
    const link = event.target.closest('a[href], button, input, select, summary');
    const el = marked(event.target);
    if (link || el) event.preventDefault();
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
  if (el && editing === el) stopEditing(el);
});

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
document.body.append(bar);
document.documentElement.dataset.editor = 'on';
render();
