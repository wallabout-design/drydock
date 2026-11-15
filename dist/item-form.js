// The form for one list item, built from the list's declaration: one input per
// field type, help text, an error next to the field in a sentence, and focus
// moved to the first error. Served at /admin/item-form.js.
//
// It only draws the form and reads it back. Saving belongs to whoever opens
// it, so the list page (/admin/lists/<name>) and, later, the page itself can
// open the same form and save through the same change.
//
//   const form = createItemForm({ list, item, onSubmit, onCancel });
//   container.append(form.element);
//   form.focus();
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

export function createItemForm({ list, item, onSubmit, onCancel }) {
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
      rows.push({ ...parts, required, type: field.type });
      let alt = null;
      getters.push([field.name, () => ({ src: input.value, alt: alt?.value ?? '' })]);
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
    ...rows.map(({ input, inputId, labelText, helpEl, error, required, type }) => {
      const label = make('label', { for: inputId }, [labelText, required && type !== 'checkbox' ? ' (needed)' : '']);
      return type === 'checkbox'
        ? make('div', { class: 'wd-field wd-field--check' }, [make('div', { class: 'wd-field__box' }, [input, label]), helpEl, error].filter(Boolean))
        : make('div', { class: 'wd-field' }, [label, helpEl, input, error].filter(Boolean));
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
      result = await onSubmit(Object.fromEntries(getters.map(([name, read]) => [name, read()])));
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
  };
}
