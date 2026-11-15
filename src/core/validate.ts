// Checking a typed value against its declaration. The editor runs this in the
// browser to show messages sooner; the server runs it again for real.
// Messages are for non-technical readers: plain words, no jargon.
import { cleanLine, cleanLines, hasMarkup, hasStackedMarks, hasVisible, lengthOf } from './clean.js';
import type { Content } from './declare.js';
import { LIMITS } from './limits.js';
import type {
  Field,
  ImageValue,
  ItemCheck,
  ItemValues,
  Problem,
  ProblemKind,
  RuleContext,
  TextCheck,
} from './types.js';

const ITEM = '_item';

const problem = (field: string, kind: ProblemKind, message: string, rule?: string): Problem =>
  rule === undefined ? { field, kind, message } : { field, kind, message, rule };

/** The built-in checks on cleaned plain text. Returns the first problem, or null. */
function plainProblem(field: string, label: string, text: string, max: number): Problem | null {
  if (hasStackedMarks(text)) {
    return problem(field, 'stacked-marks', `${label} has too many accents on one letter. Please remove the extra ones.`);
  }
  if (hasMarkup(text)) {
    return problem(field, 'markup', `${label} can only hold plain words: no tags like <b>. Please remove them.`);
  }
  const length = lengthOf(text);
  if (length > max) {
    return problem(field, 'too-long', `${label} is too long: ${length} characters, and it fits ${max}.`);
  }
  return null;
}

function ruleProblem(content: Content, field: string, text: string, context: RuleContext): Problem | null {
  for (const rule of content.rules) {
    if (!rule.test(text, context)) return problem(field, 'rule', rule.message, rule.name);
  }
  return null;
}

/** Cleans and checks a keyed text. */
export function checkText(content: Content, key: string, raw: unknown): TextCheck {
  const declared = content.texts.get(key);
  if (declared === undefined) {
    return { ok: false, text: '', problems: [problem(key, 'unknown', 'This text is no longer on the site, so it can’t be changed. Reload the page.')] };
  }
  if (typeof raw !== 'string') {
    return { ok: false, text: '', problems: [problem(key, 'type', `${declared.label} must be text.`)] };
  }
  const text = cleanLine(raw);
  const found = hasVisible(text)
    ? (plainProblem(key, declared.label, text, declared.max) ?? ruleProblem(content, key, text, { key, label: declared.label }))
    : problem(key, 'empty', `${declared.label} can’t be left empty. Put some words in, or undo the change.`);
  return found === null ? { ok: true, text, problems: [] } : { ok: false, text, problems: [found] };
}

type Checked = { value: string | number | boolean | ImageValue } | { empty: true } | { problem: Problem };

function checkWords(content: Content, list: string, field: Field & { type: 'text' | 'longtext' }, raw: unknown, label = field.label, name = field.name): Checked {
  if (typeof raw !== 'string') return { problem: problem(name, 'type', `${label} must be text.`) };
  const text = field.type === 'text' ? cleanLine(raw) : cleanLines(raw);
  if (!hasVisible(text)) return { empty: true };
  const max = field.maxLength ?? LIMITS[field.type].default;
  const found = plainProblem(name, label, text, max) ?? ruleProblem(content, name, text, { list, field: field.name, label });
  return found === null ? { value: text } : { problem: found };
}

function checkLink(field: Field & { type: 'link' }, raw: unknown): Checked {
  const schemes = field.schemes ?? ['https'];
  const hint = `${field.label} must be a full web address, starting with ${schemes.map((s) => (s === 'mailto' ? 'mailto:' : `${s}://`)).join(' or ')}.`;
  if (typeof raw !== 'string') return { problem: problem(field.name, 'type', hint) };
  const text = raw.trim();
  if (text === '') return { empty: true };
  if (/[\s\p{Cc}\p{Cf}]/u.test(text)) return { problem: problem(field.name, 'format', `${field.label} can’t contain spaces or hidden characters.`) };
  if (lengthOf(text) > LIMITS.link) return { problem: problem(field.name, 'too-long', `${field.label} is too long for a web address.`) };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { problem: problem(field.name, 'format', hint) };
  }
  if (!schemes.includes(url.protocol.slice(0, -1))) return { problem: problem(field.name, 'format', hint) };
  if (url.username || url.password) {
    return { problem: problem(field.name, 'format', `${field.label} can’t include a user name or password.`) };
  }
  return { value: url.href };
}

function checkNumber(field: Field & { type: 'number' }, raw: unknown): Checked {
  if (typeof raw === 'string' && raw.trim() === '') return { empty: true };
  const value = typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return { problem: problem(field.name, 'type', `${field.label} must be a number.`) };
  if (!Number.isSafeInteger(value)) return { problem: problem(field.name, 'format', `${field.label} must be a whole number.`) };
  const { min, max } = field;
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    const message =
      min !== undefined && max !== undefined
        ? `${field.label} must be from ${min} to ${max}.`
        : min !== undefined
          ? `${field.label} must be ${min} or more.`
          : `${field.label} must be ${max} or less.`;
    return { problem: problem(field.name, 'range', message) };
  }
  return { value };
}

function checkDate(field: Field & { type: 'date' }, raw: unknown): Checked {
  const message = `${field.label} must be a date, like 2026-03-14.`;
  if (typeof raw !== 'string') return { problem: problem(field.name, 'type', message) };
  const text = raw.trim();
  if (text === '') return { empty: true };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { problem: problem(field.name, 'format', message) };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Date rolls 2026-02-31 over to March; a real date comes back unchanged.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return { problem: problem(field.name, 'format', message) };
  }
  return { value: text };
}

function checkChoice(field: Field & { type: 'choice' }, raw: unknown): Checked {
  if (typeof raw === 'string' && raw === '') return { empty: true };
  return typeof raw === 'string' && field.options.some((o) => o.value === raw)
    ? { value: raw }
    : { problem: problem(field.name, 'format', `Please choose one of the options for ${field.label}.`) };
}

function checkImage(content: Content, list: string, field: Field & { type: 'image' }, raw: unknown): Checked {
  const message = `${field.label} must be an https web address or a path on the site starting with /.`;
  const isEmpty = raw === undefined || raw === null || raw === '' || (typeof raw === 'object' && (raw as ImageValue).src === '' && !(raw as ImageValue).alt);
  if (isEmpty) return { empty: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { problem: problem(field.name, 'type', message) };
  const { src: rawSrc, alt: rawAlt } = raw as Partial<ImageValue>;
  if (typeof rawSrc !== 'string' || (rawAlt !== undefined && typeof rawAlt !== 'string')) {
    return { problem: problem(field.name, 'type', message) };
  }
  const src = rawSrc.trim();
  if (src === '') return { problem: problem(field.name, 'empty', `${field.label} needs an image address.`) };
  if (/[\s\p{Cc}\p{Cf}\\]/u.test(src) || lengthOf(src) > LIMITS.link) {
    return { problem: problem(field.name, 'format', message) };
  }
  if (src.startsWith('/')) {
    if (src.startsWith('//') || src.split('/').some((part) => part === '..' || part === '.')) {
      return { problem: problem(field.name, 'format', message) };
    }
  } else {
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return { problem: problem(field.name, 'format', message) };
    }
    if (url.protocol !== 'https:' || url.username || url.password) return { problem: problem(field.name, 'format', message) };
  }
  if (field.decorative) return { value: { src, alt: '' } };
  const altName = `${field.name}.alt`;
  const altLabel = `The description of ${field.label.toLowerCase()}`;
  const alt = checkWords(content, list, { name: field.name, label: field.label, type: 'text', maxLength: LIMITS.alt }, rawAlt ?? '', altLabel, altName);
  if ('problem' in alt) return alt;
  if ('empty' in alt) return { problem: problem(altName, 'empty', `${altLabel} is needed, for people who can’t see the image.`) };
  return { value: { src, alt: alt.value as string } };
}

function checkField(content: Content, list: string, field: Field, raw: unknown): Checked {
  switch (field.type) {
    case 'text':
    case 'longtext':
      return checkWords(content, list, field, raw);
    case 'link':
      return checkLink(field, raw);
    case 'number':
      return checkNumber(field, raw);
    case 'date':
      return checkDate(field, raw);
    case 'checkbox':
      return typeof raw === 'boolean' ? { value: raw } : { problem: problem(field.name, 'type', `${field.label} must be ticked or not ticked.`) };
    case 'choice':
      return checkChoice(field, raw);
    case 'image':
      return checkImage(content, list, field, raw);
  }
}

/** Cleans and checks an item's fields against its list. Every problem is reported at once. */
export function checkItem(content: Content, listName: string, raw: unknown): ItemCheck {
  const list = content.lists.get(listName);
  if (list === undefined) {
    return { ok: false, values: {}, problems: [problem(ITEM, 'unknown', 'This list is no longer on the site. Reload the page.')] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, values: {}, problems: [problem(ITEM, 'type', 'The form could not be read. Please reload the page and try again.')] };
  }
  const given = raw as Record<string, unknown>;
  const problems: Problem[] = [];
  const known = new Set(list.fields.map((f) => f.name));
  if (Object.keys(given).some((name) => !known.has(name))) {
    problems.push(problem(ITEM, 'unknown', 'The form is out of date. Please reload the page and try again.'));
  }
  const values: ItemValues = {};
  for (const field of list.fields) {
    const given_ = Object.hasOwn(given, field.name) ? given[field.name] : undefined;
    if (field.type === 'checkbox' && (given_ === undefined || given_ === null)) {
      values[field.name] = false;
      continue;
    }
    const checked = given_ === undefined || given_ === null ? { empty: true as const } : checkField(content, listName, field, given_);
    if ('problem' in checked) problems.push(checked.problem);
    else if ('empty' in checked) {
      if (field.required) problems.push(problem(field.name, 'empty', `${field.label} is needed.`));
    } else values[field.name] = checked.value;
  }
  if (problems.length === 0 && new TextEncoder().encode(JSON.stringify(values)).length > LIMITS.itemBytes) {
    problems.push(problem(ITEM, 'too-big', 'This is too much to save in one item. Please shorten the longer fields.'));
  }
  return { ok: problems.length === 0, values, problems };
}
