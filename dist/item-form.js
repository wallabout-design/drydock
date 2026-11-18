// The form for one list item, built from the list's declaration: one input per
// field type, help text, an error next to the field in a sentence, and focus
// moved to the first error. Served at /admin/item-form.js.
//
// It only draws the form and reads it back. Saving belongs to whoever opens
// it, so the list page (/admin/lists/<name>) and, later, the page itself can
// open the same form and save through the same change.
//
//   const form = createItemForm({ list, item, uploads, onSubmit, onCancel });
//   container.append(form.element);
//   form.focus();
//
// `uploads` ({ api, maxBytes }) comes from the page's settings when the site
// can keep uploaded images: image fields then get a file picker and, when the
// field has an `aspect`, a crop frame. Without it they only have the address box.
//
// `list` is the declaration as the server sends it (name, singular, titleField,
// fields). `item` is { id, values } to edit one, or left out to add one.
// `onSubmit(values)` saves and gives back { problems: [{ field, message }] }
// when the site refused something, or nothing when it worked. The server's
// messages are shown as they come: it checks everything again, with the site's
// own rules.
// Plain JavaScript with no dependencies and no build step.

const DEFAULT_LENGTH = { text: 200, longtext: 2000 };
let formCount = 0;

function make(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/** What to tell staff about a field before they type: how long, what shape, what it is for. */
function helpFor(field) {
  switch (field.type) {
    case 'text':
      return `Up to ${field.maxLength ?? DEFAULT_LENGTH.text} characters, on one line.`;
    case 'longtext':
      return `Up to ${field.maxLength ?? DEFAULT_LENGTH.longtext} characters. Press Enter for a new line.`;
    case 'link': {
      const schemes = field.schemes ?? ['https'];
      const starts = schemes.map((s) => (s === 'mailto' ? 'mailto:' : `${s}://`)).join(' or ');
      return `A full web address, starting with ${starts}`;
    }
    case 'number': {
      const { min, max } = field;
      const range = min !== undefined && max !== undefined ? `, from ${min} to ${max}` : min !== undefined ? `, ${min} or more` : max !== undefined ? `, ${max} or less` : '';
      return `A whole number${range}.`;
    }
    case 'date':
      return 'Pick a date.';
    case 'choice':
      return 'Choose one.';
    case 'image':
      return 'Paste the address of an image that is already online (starting with https://), or a path on this site, like /photos/house.jpg.';
    default:
      return '';
  }
}

// --- the crop ---------------------------------------------------------------
// All in whole pixels of the image as the browser shows it (EXIF turn applied).
// A crop is always inside the image and within half a percent of the field's
// shape, which is tighter than the 1% the server accepts, so rounding can't
// push it out.

const SHAPE_TOLERANCE = 0.005;

function aspectOf(text) {
  const [a, b] = text.split(':').map(Number);
  return a / b;
}

/** The biggest whole-pixel size of shape `r` (width over height) no taller than `tallest` that fits a W by H image. */
function fitSize(r, W, H, tallest) {
  for (let h = Math.min(Math.floor(tallest), H); h >= 1; h--) {
    const w = Math.round(h * r);
    if (w >= 1 && w <= W && Math.abs(w / h - r) / r <= SHAPE_TOLERANCE) return { w, h };
  }
  return null;
}

/** The largest crop that fits, or null when the image is too narrow for the shape. */
export function largestSize(aspect, W, H) {
  const r = aspectOf(aspect);
  return fitSize(r, W, H, Math.min(H, W / r));
}

/** How far staff can zoom in: the crop never gets smaller than about 20 pixels tall, or 8 times. */
export function maxZoom(aspect, W, H) {
  const base = largestSize(aspect, W, H);
  return base ? Math.max(1, Math.min(8, base.h / 20)) : 1;
}

/** A crop at `zoom` (1 is the largest) around the point `at`, kept inside the image. Null when none fits. */
export function placeCrop(aspect, W, H, zoom, at = { x: W / 2, y: H / 2 }) {
  const base = largestSize(aspect, W, H);
  if (!base) return null;
  const size = fitSize(aspectOf(aspect), W, H, base.h / Math.min(Math.max(zoom, 1), maxZoom(aspect, W, H)));
  if (!size) return null;
  const clamp = (n, max) => Math.min(Math.max(Math.round(n), 0), max);
  return { x: clamp(at.x - size.w / 2, W - size.w), y: clamp(at.y - size.h / 2, H - size.h), ...size };
}

/** The same crop moved so its top left corner is at (x, y), kept inside the image. */
export function moveCrop(crop, W, H, x, y) {
  return { ...crop, x: Math.min(Math.max(Math.round(x), 0), W - crop.w), y: Math.min(Math.max(Math.round(y), 0), H - crop.h) };
}

/** True when a crop (maybe stored long ago) is inside the image and the right shape. */
export function cropFits(crop, aspect, W, H) {
  if (!crop || ![crop.x, crop.y, crop.w, crop.h].every(Number.isInteger)) return false;
  const r = aspectOf(aspect);
  return crop.x >= 0 && crop.y >= 0 && crop.w >= 1 && crop.h >= 1 && crop.x + crop.w <= W && crop.y + crop.h <= H && Math.abs(crop.w / crop.h - r) / r <= SHAPE_TOLERANCE;
}

const PICKABLE = 'image/jpeg,image/png,image/webp';
const TRY_AGAIN = 'Couldn’t reach the site just now. Check your connection and try again.';

async function readAnswer(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * The file picker, preview and crop frame for one image field. `state.upload`
 * is what the value will hold: { key, width, height, crop } (or null).
 */
function imagePicker({ field, listName, uploads, addressInput, uid, onProblem, onClear }) {
  const aspect = field.aspect;
  const id = `${uid}-${field.name}-file`;
  const state = { upload: null, stored: null, token: 0, objectUrl: null, size: null, crop: null, zoom: 1, ready: null, pending: null, failed: null };

  const file = make('input', { type: 'file', accept: PICKABLE, id });
  const fileLabel = make('label', { for: id }, [`Or choose ${field.label.toLowerCase()} from this device`]);
  const status = make('p', { class: 'wd-image__status', role: 'status' });
  const img = make('img', { class: 'wd-image__img', alt: '' });
  const frame = make('div', { class: 'wd-image__frame', tabindex: '0', role: 'group', 'aria-label': `Part of the ${field.label.toLowerCase()} to show`, 'aria-describedby': `${id}-how`, hidden: '' });
  const canvas = make('div', { class: 'wd-image__canvas' }, aspect ? [img, frame] : [img]);
  const how = make('p', { class: 'wd-field__help', id: `${id}-how` }, ['Move the frame with the arrow keys or by dragging it. Zoom with the plus and minus keys or the slider. Hold Shift to move further.']);
  const zoom = make('input', { type: 'range', min: '100', max: '100', step: '1', value: '100', id: `${id}-zoom` });
  const zoomLabel = make('label', { for: `${id}-zoom` }, ['Zoom']);
  const remove = make('button', { type: 'button', class: 'wd-image__remove' }, [`remove ${field.label.toLowerCase()}`]);
  const tools = make('div', { class: 'wd-image__tools' }, aspect ? [how, make('div', { class: 'wd-image__zoom' }, [zoomLabel, zoom])] : []);
  const stage = make('div', { class: 'wd-image__stage', hidden: '' }, [canvas, tools, remove]);
  const element = make('div', { class: 'wd-image' }, [fileLabel, file, status, stage]);

  function forget() {
    state.token++;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    state.upload = null;
    state.stored = null;
    state.size = null;
    state.crop = null;
    state.ready = null;
    state.pending = null;
    state.failed = null;
    img.removeAttribute('src');
    stage.hidden = true;
    frame.hidden = true;
    status.textContent = '';
    file.value = '';
  }

  function draw() {
    if (!aspect || !state.crop || !state.size) return;
    const { w: W, h: H } = state.size;
    const c = state.crop;
    frame.style.left = `${(c.x / W) * 100}%`;
    frame.style.top = `${(c.y / H) * 100}%`;
    frame.style.width = `${(c.w / W) * 100}%`;
    frame.style.height = `${(c.h / H) * 100}%`;
    zoom.value = String(Math.round(state.zoom * 100));
  }

  function setZoom(next) {
    const { w: W, h: H } = state.size;
    const centre = { x: state.crop.x + state.crop.w / 2, y: state.crop.y + state.crop.h / 2 };
    const z = Math.min(Math.max(next, 1), maxZoom(aspect, W, H));
    const placed = placeCrop(aspect, W, H, z, centre);
    if (!placed) return;
    state.zoom = z;
    state.crop = placed;
    draw();
  }

  /** Shows the image, and (for a field with a shape) the frame at `crop` or at the largest size. */
  function show(src, known, crop) {
    state.ready = new Promise((resolve) => {
      img.onload = () => {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        state.size = { w: W, h: H };
        if (aspect) {
          const base = largestSize(aspect, W, H);
          if (!base) {
            state.failed = `${field.label} is too narrow for the shape this page needs. Please choose another.`;
            if (known === 'fresh') onProblem(state.failed);
            return resolve(false);
          }
          state.crop = cropFits(crop, aspect, W, H) ? crop : placeCrop(aspect, W, H, 1);
          state.zoom = Math.min(base.h / state.crop.h, maxZoom(aspect, W, H));
          zoom.max = String(Math.round(maxZoom(aspect, W, H) * 100));
          frame.hidden = false;
          draw();
        }
        if (known === 'fresh' && field.minWidth !== undefined && W < field.minWidth) {
          status.textContent = 'This photo is small and may look soft.';
        }
        resolve(true);
      };
      img.onerror = () => {
        state.failed = `${field.label} could not be shown. Please choose another.`;
        if (known === 'fresh') onProblem(state.failed);
        resolve(false);
      };
    });
    img.src = src;
    stage.hidden = false;
  }

  async function upload(chosen, token) {
    status.textContent = 'Uploading…';
    try {
      const response = await fetch(`${uploads.api}?list=${encodeURIComponent(listName)}&field=${encodeURIComponent(field.name)}`, {
        method: 'POST',
        headers: { 'content-type': chosen.type },
        body: chosen,
      });
      const body = await readAnswer(response);
      if (token !== state.token) return;
      if (!response.ok || typeof body.key !== 'string') throw new Error(body.message || TRY_AGAIN);
      state.upload = { key: body.key, width: body.width, height: body.height };
      state.stored = null;
      if (!status.textContent || status.textContent === 'Uploading…') status.textContent = '';
    } catch (error) {
      if (token !== state.token) return;
      forget();
      onProblem(error instanceof TypeError ? TRY_AGAIN : error.message);
    }
  }

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    onProblem(null);
    if (chosen.size > uploads.maxBytes) {
      file.value = '';
      return onProblem(`That image is too big. Please choose one under ${Math.round(uploads.maxBytes / 1024 / 1024)} MB.`);
    }
    forget();
    onClear();
    state.objectUrl = URL.createObjectURL(chosen);
    const token = state.token;
    show(state.objectUrl, 'fresh', null);
    state.pending = upload(chosen, token);
  });
  addressInput.addEventListener('input', () => {
    if (state.upload || state.stored) forget();
  });
  remove.addEventListener('click', () => {
    forget();
    onProblem(null);
    addressInput.focus();
  });

  // The frame: keys and dragging.
  frame.addEventListener('keydown', (event) => {
    if (!state.crop) return;
    const { w: W, h: H } = state.size;
    const step = Math.max(1, Math.round(W / (event.shiftKey ? 10 : 100)));
    const c = state.crop;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      state.crop = moveCrop(c, W, H, c.x + moves[event.key][0], c.y + moves[event.key][1]);
      draw();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(state.zoom * 1.1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setZoom(state.zoom / 1.1);
    }
  });
  zoom.addEventListener('input', () => state.crop && setZoom(Number(zoom.value) / 100));
  let drag = null;
  frame.addEventListener('pointerdown', (event) => {
    if (!state.crop) return;
    drag = { x: event.clientX, y: event.clientY, from: state.crop };
    frame.setPointerCapture(event.pointerId);
    frame.focus();
    event.preventDefault();
  });
  frame.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const scale = state.size.w / img.clientWidth;
    state.crop = moveCrop(drag.from, state.size.w, state.size.h, drag.from.x + (event.clientX - drag.x) * scale, drag.from.y + (event.clientY - drag.y) * scale);
    draw();
  });
  const drop = () => {
    drag = null;
  };
  frame.addEventListener('pointerup', drop);
  frame.addEventListener('pointercancel', drop);

  // An item that already has an upload: show it, and let staff change the crop without uploading again.
  function load(value) {
    if (typeof value.key !== 'string') return;
    state.stored = { key: value.key, width: value.width, height: value.height, crop: value.crop };
    const query = `key=${encodeURIComponent(value.key)}&list=${encodeURIComponent(listName)}&field=${encodeURIComponent(field.name)}`;
    if (aspect) {
      // The crop can only be changed against the whole original, so that is what is shown.
      show(`${uploads.api}/original?${query}`, 'stored', value.crop);
      return;
    }
    // Otherwise the preview is the largest size that was made for the page.
    fetch(`${uploads.api}/sizes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: value.key, list: listName, field: field.name }) })
      .then(readAnswer)
      .then((body) => typeof body.preview === 'string' && show(body.preview, 'stored', null))
      .catch(() => {});
  }

  /**
   * Before the item is sent: waits for the upload, then asks for each size,
   * one at a time. Returns a sentence when something failed, else nothing.
   */
  async function prepare() {
    const current = state.upload ?? state.stored;
    if (!current) return null;
    if (state.pending) await state.pending;
    if (!state.upload && !state.stored) return null;
    // A stored image that can't be shown keeps its stored crop: nothing is asked of it unless it is replaced.
    if (state.ready && !(await state.ready) && state.upload) return state.failed;
    const key = (state.upload ?? state.stored).key;
    const crop = aspect ? (state.crop ?? state.stored?.crop) : undefined;
    const unchanged = state.stored && state.stored.key === key && JSON.stringify(state.stored.crop ?? null) === JSON.stringify(crop ?? null);
    if (unchanged) return null;
    const post = async (path, payload) => {
      let response;
      try {
        response = await fetch(`${uploads.api}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {
        return { ok: false, body: { message: TRY_AGAIN } };
      }
      return { ok: response.ok, body: await readAnswer(response) };
    };
    const base = { key, list: listName, field: field.name, ...(crop ? { crop } : {}) };
    const planned = await post('sizes', base);
    if (!planned.ok) return planned.body.message || TRY_AGAIN;
    const widths = planned.body.sizes;
    for (let i = 0; i < widths.length; i++) {
      status.textContent = `Making size ${i + 1} of ${widths.length}`;
      const made = await post('renditions', { ...base, width: widths[i] });
      if (!made.ok) {
        status.textContent = '';
        return made.body.message || TRY_AGAIN;
      }
    }
    status.textContent = '';
    return null;
  }

  /** What the value holds, or null when it holds an address (or nothing). */
  function read() {
    const current = state.upload ?? state.stored;
    if (!current) return null;
    const crop = aspect ? (state.crop ?? state.stored?.crop) : undefined;
    return { key: current.key, width: current.width, height: current.height, ...(crop ? { crop } : {}) };
  }

  return { element, load, prepare, read, destroy: forget };
}

export function createItemForm({ list, item, uploads, onSubmit, onCancel }) {
  const uid = `wd-form-${++formCount}`;
  const values = item?.values ?? {};
  /** @type {Map<string, { input: HTMLElement, error: HTMLElement, describedBy: string }>} */
  const controls = new Map(); // problem field name -> its parts
  /** @type {string[]} */
  const order = [];

  /** One labelled input, with its help and its place for an error. */
  function control(name, labelText, input, help) {
    const inputId = `${uid}-${name.replace(/\W/g, '-')}`;
    input.id = inputId;
    const helpEl = help ? make('p', { class: 'wd-field__help', id: `${inputId}-help` }, [help]) : null;
    const error = make('p', { class: 'wd-field__error', id: `${inputId}-error`, hidden: '' });
    const describedBy = [helpEl?.id, error.id].filter(Boolean).join(' ');
    input.setAttribute('aria-describedby', describedBy);
    controls.set(name, { input, error, describedBy });
    order.push(name);
    return { input, inputId, labelText, helpEl, error };
  }

  const getters = [];
  const pickers = [];
  const preparers = [];
  const rows = [];

  for (const field of list.fields) {
    const value = values[field.name];
    const required = field.required === true;
    const text = (extra = {}) => make('input', { type: 'text', autocomplete: 'off', ...extra });
    let input;
    let read;

    if (field.type === 'text' || field.type === 'link') {
      input = text(field.type === 'link' ? { inputmode: 'url', spellcheck: 'false' } : {});
      input.value = typeof value === 'string' ? value : '';
      read = () => input.value;
    } else if (field.type === 'longtext') {
      input = make('textarea', { rows: '4' });
      input.value = typeof value === 'string' ? value : '';
      read = () => input.value;
    } else if (field.type === 'number') {
      // A plain box, so a mistake gets the site's sentence rather than the browser's tooltip.
      input = text({ inputmode: 'numeric' });
      input.value = typeof value === 'number' ? String(value) : '';
      read = () => input.value;
    } else if (field.type === 'date') {
      input = make('input', { type: 'date' });
      input.value = typeof value === 'string' ? value : '';
      read = () => input.value;
    } else if (field.type === 'checkbox') {
      input = make('input', { type: 'checkbox' });
      input.checked = value === true;
      read = () => input.checked;
    } else if (field.type === 'choice') {
      input = make('select', {}, [
        make('option', { value: '' }, ['Choose one']),
        ...field.options.map((o) => make('option', { value: o.value }, [o.label])),
      ]);
      input.value = typeof value === 'string' ? value : '';
      read = () => input.value;
    } else if (field.type === 'image') {
      const image = typeof value === 'object' && value !== null ? value : { src: '', alt: '' };
      input = text({ inputmode: 'url', spellcheck: 'false' });
      input.value = image.src ?? '';
      const parts = control(field.name, field.label, input, helpFor(field));
      let picker = null;
      if (uploads) {
        const mine = controls.get(field.name);
        const say = (message) => {
          mine.error.textContent = message ?? '';
          mine.error.hidden = !message;
          if (message) mine.input.setAttribute('aria-invalid', 'true');
          else mine.input.removeAttribute('aria-invalid');
        };
        picker = imagePicker({ field, listName: list.name, uploads, addressInput: input, uid, onProblem: say, onClear: () => (input.value = '') });
        pickers.push(picker);
        preparers.push(async () => {
          const message = await picker.prepare();
          return message ? { field: field.name, message } : null;
        });
        picker.load(image);
      }
      rows.push({ ...parts, required, type: field.type, extra: picker?.element });
      let alt = null;
      getters.push([field.name, () => ({ ...(picker?.read() ?? { src: input.value }), alt: alt?.value ?? '' })]);
      if (!field.decorative) {
        alt = text();
        alt.value = image.alt ?? '';
        const altParts = control(`${field.name}.alt`, `Describe ${field.label.toLowerCase()} for people who can’t see it`, alt, 'Say what the image shows, in a few words.');
        rows.push({ ...altParts, required: true, type: 'text' });
      }
      continue;
    }

    const parts = control(field.name, field.label, input, helpFor(field));
    rows.push({ ...parts, required, type: field.type });
    getters.push([field.name, read]);
  }

  const heading = make('h2', { class: 'wd-form__title', id: `${uid}--heading` }, [item ? `Edit this ${list.singular}` : `Add a new ${list.singular}`]);
  const summary = make('p', { class: 'wd-form__summary', role: 'alert', tabindex: '-1', hidden: '' });
  const save = make('button', { type: 'submit', class: 'wd-form__save' }, ['save']);
  const cancel = make('button', { type: 'button', class: 'wd-form__cancel' }, ['cancel']);
  const form = make('form', { class: 'wd-form', novalidate: '', 'aria-labelledby': heading.id }, [
    heading,
    summary,
    ...rows.map(({ input, inputId, labelText, helpEl, error, required, type, extra }) => {
      const label = make('label', { for: inputId }, [labelText, required && type !== 'checkbox' ? ' (needed)' : '']);
      return type === 'checkbox'
        ? make('div', { class: 'wd-field wd-field--check' }, [make('div', { class: 'wd-field__box' }, [input, label]), helpEl, error].filter(Boolean))
        : make('div', { class: 'wd-field' }, [label, helpEl, input, extra, error].filter(Boolean));
    }),
    make('div', { class: 'wd-form__actions' }, [save, cancel]),
  ]);

  function clearProblems() {
    summary.hidden = true;
    summary.textContent = '';
    for (const { input, error, describedBy } of controls.values()) {
      error.hidden = true;
      error.textContent = '';
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', describedBy);
    }
  }

  /** Puts each message next to its field, and moves focus to the first field with one. */
  function showProblems(problems) {
    clearProblems();
    const general = [];
    for (const { field, message } of problems) {
      const found = controls.get(field);
      if (!found) {
        general.push(message);
        continue;
      }
      found.error.textContent = found.error.textContent ? `${found.error.textContent} ${message}` : message;
      found.error.hidden = false;
      found.input.setAttribute('aria-invalid', 'true');
    }
    if (general.length > 0) {
      summary.textContent = general.join(' ');
      summary.hidden = false;
    }
    const first = order.find((name) => !controls.get(name).error.hidden);
    if (first) controls.get(first).input.focus();
    else if (general.length > 0) summary.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearProblems();
    save.disabled = true;
    let result;
    try {
      let stopped = null;
      for (const prepare of preparers) {
        stopped = await prepare();
        if (stopped) break;
      }
      result = stopped ? { problems: [stopped] } : await onSubmit(Object.fromEntries(getters.map(([name, read]) => [name, read()])));
    } catch {
      result = { problems: [{ field: '_item', message: 'Couldn’t save just now. Check your connection and try again.' }] };
    }
    save.disabled = false;
    if (result?.problems?.length) showProblems(result.problems);
  });
  cancel.addEventListener('click', () => onCancel?.());
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  });

  return {
    element: form,
    /** Moves focus to the first field. */
    focus() {
      controls.get(order[0])?.input.focus();
    },
    showProblems,
    /** Lets go of the previews' temporary addresses. Call when the form is closed. */
    destroy() {
      for (const picker of pickers) picker.destroy();
    },
  };
}
