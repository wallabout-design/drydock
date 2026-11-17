// The rebuild images page, served at /admin/images (admins). For each list with
// an image field it counts the sizes the stored items need and the ones not made
// yet (GET /admin/api/uploads/missing, a bounded run at a time), and a button
// makes the missing ones from the browser, one request each to
// POST /admin/api/uploads/renditions. It stops when asked, or when the month's
// image allowance is used up (429); what is still missing is found again by a
// new check, so a stopped run can be resumed next month.
// Plain JavaScript with no dependencies and no build step.
const settings = JSON.parse(document.getElementById('editor-settings')?.textContent ?? '{}');
const mount = document.getElementById('wd-images');

function make(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// What the checks found: one entry for each list.
const found = new Map(
  settings.lists.map((l) => [l.name, { list: l, needed: 0, missing: [], problems: [], checked: false, made: 0 }]),
);
let queue = []; // the sizes still to make, in order
let state = 'idle'; // idle | checking | making | stopping
let stopReason = null; // null, 'asked', 'allowance', 'network'
let failed = []; // { task, message }
let made = 0;
let alreadyThere = 0;
let total = 0; // sizes this run set out to make

const status = make('p', { class: 'wd-images__status', role: 'status' });
const makeButton = make('button', { type: 'button', 'data-action': 'make' });
const stopButton = make('button', { type: 'button', 'data-action': 'stop' }, ['stop']);
const checkButton = make('button', { type: 'button', 'data-action': 'check' }, ['check again']);
const bar = make('div', { class: 'wd-images__bar' }, [makeButton, stopButton, checkButton]);
const sections = make('div', { class: 'wd-images__lists' });
mount.replaceChildren(status, bar, sections);

const say = (message, kind = '') => {
  status.textContent = message;
  if (kind) status.setAttribute('data-kind', kind);
  else status.removeAttribute('data-kind');
};

const keyOf = (t) => `${t.list}|${t.key}|${t.crop ? `${t.crop.x}-${t.crop.y}-${t.crop.w}-${t.crop.h}` : 'whole'}|${t.width}`;

function render() {
  const missingNow = [...found.values()].reduce((n, f) => n + f.missing.length, 0);
  makeButton.textContent = stopReason === 'allowance' || stopReason === 'asked' || stopReason === 'network' ? `resume (${missingNow})` : `make missing sizes (${missingNow})`;
  makeButton.disabled = state !== 'idle' || missingNow === 0;
  stopButton.disabled = state !== 'making';
  checkButton.disabled = state !== 'idle';
  sections.replaceChildren(
    ...[...found.values()].map(({ list, needed, missing, problems, checked, made: madeHere }) => {
      const counts = checked
        ? `${plural(needed, 'size', 'sizes')} needed, ${missing.length.toLocaleString('en-US')} missing${madeHere > 0 ? `, ${madeHere.toLocaleString('en-US')} made just now` : ''}`
        : 'checking…';
      const parts = [make('h2', {}, [list.label]), make('p', { 'data-counts': list.name }, [counts])];
      if (problems.length > 0) {
        parts.push(
          make('p', {}, [`${plural(problems.length, 'image needs', 'images need')} you to open ${problems.length === 1 ? 'its' : 'their'} form:`]),
          make(
            'ul',
            { class: 'wd-images__problems', 'data-problems': list.name },
            problems.map((p) =>
              make('li', { 'data-item': p.item }, [
                make('strong', {}, [p.title]),
                ` (${p.label}): ${p.message} `,
                make('a', { href: `/admin/lists/${encodeURIComponent(list.name)}?edit=${encodeURIComponent(p.item)}` }, [`open the ${list.singular}’s form`]),
              ]),
            ),
          ),
        );
      }
      return make('section', { 'data-list': list.name }, parts);
    }),
  );
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status is all there is.
  }
  return { status: response.status, body };
}

/** Counts every list, a bounded run at a time. */
async function check() {
  state = 'checking';
  stopReason = null;
  failed = [];
  made = 0;
  alreadyThere = 0;
  for (const f of found.values()) Object.assign(f, { needed: 0, missing: [], problems: [], checked: false, made: 0 });
  render();
  say('Checking which sizes exist…');
  try {
    for (const f of found.values()) {
      let offset = 0;
      while (offset !== null) {
        const { status: code, body } = await getJson(`${settings.missing}?list=${encodeURIComponent(f.list.name)}&offset=${offset}`);
        if (code !== 200) {
          say(body.message ?? 'Couldn’t check the sizes. Reload the page and try again.', 'problem');
          state = 'idle';
          render();
          return;
        }
        f.needed += body.needed;
        f.missing.push(...body.missing);
        f.problems.push(...body.problems);
        offset = body.next;
      }
      f.checked = true;
      render();
    }
  } catch {
    say('Couldn’t reach the site to check. Check your connection and try again.', 'problem');
    state = 'idle';
    render();
    return;
  }
  queue = [...found.values()].flatMap((f) => f.missing);
  total = queue.length;
  state = 'idle';
  const problems = [...found.values()].reduce((n, f) => n + f.problems.length, 0);
  if (queue.length === 0) say(problems > 0 ? 'No sizes can be made until the images below are chosen again.' : 'Every size is made.', problems > 0 ? 'problem' : 'saved');
  else say(`${plural(queue.length, 'size is', 'sizes are')} missing.`);
  render();
}

function tidy(task) {
  const f = found.get(task.list);
  f.missing = f.missing.filter((t) => t !== task);
}

/** Makes the queued sizes one by one, until the queue is empty, someone stops it, or the allowance is used up. */
async function make_() {
  state = 'making';
  stopReason = null;
  render();
  const seen = new Set();
  while (queue.length > 0 && stopReason === null) {
    const task = queue[0];
    const id = keyOf(task);
    if (seen.has(id)) {
      queue.shift();
      tidy(task);
      continue;
    }
    say(`Making size ${(made + alreadyThere + failed.length + 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}…`);
    let response;
    try {
      response = await fetch(settings.renditions, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: task.key, list: task.list, field: task.field, crop: task.crop, width: task.width }),
      });
    } catch {
      stopReason = 'network';
      break;
    }
    let body = {};
    try {
      body = await response.json();
    } catch {
      // Not JSON: the status is all there is.
    }
    if (response.status === 429) {
      stopReason = 'allowance';
      break;
    }
    queue.shift();
    seen.add(id);
    if (response.status === 200) {
      if (body.made) {
        made += 1;
        found.get(task.list).made += 1;
      } else alreadyThere += 1;
      tidy(task);
    } else {
      failed.push({ task, message: body.message ?? `The ${task.width} px size could not be made.` });
    }
    render();
  }
  if (stopReason === 'allowance') {
    say(
      `Stopped: this month’s free image allowance is used up. ${plural(made, 'size was', 'sizes were')} made; ${plural(queue.length, 'size is', 'sizes are')} still missing. Images already on the site still work. Come back next month and this page will find the rest.`,
      'problem',
    );
  } else if (stopReason === 'network') {
    say(`Stopped: couldn’t reach the site. ${plural(made, 'size was', 'sizes were')} made; ${plural(queue.length, 'size is', 'sizes are')} still missing. Resume when you are back online.`, 'problem');
  } else if (stopReason === 'asked') {
    say(`Stopped. ${plural(made, 'size was', 'sizes were')} made; ${plural(queue.length, 'size is', 'sizes are')} still missing.`);
  } else if (failed.length > 0) {
    say(`Done, but ${plural(failed.length, 'size', 'sizes')} could not be made: ${failed[0].message} Check again to see what is left.`, 'problem');
  } else {
    say(`Done. ${plural(made, 'size was', 'sizes were')} made.`, 'saved');
  }
  state = 'idle';
  render();
  (stopReason === null ? checkButton : makeButton).focus();
}

makeButton.addEventListener('click', () => {
  if (state === 'idle' && queue.length > 0) void make_();
});
stopButton.addEventListener('click', () => {
  if (state !== 'making') return;
  // The request in flight finishes; the next one is not sent.
  stopReason = 'asked';
  state = 'stopping';
  render();
});
checkButton.addEventListener('click', () => {
  if (state === 'idle') void check();
});

if (settings.lists.length === 0) {
  mount.replaceChildren(make('p', {}, ['No list on this site has an image field.']));
} else {
  void check();
}
