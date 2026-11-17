// defineContent: checks a site's declaration when the site starts and in its
// tests, and returns the checkers. A bad declaration throws a DeclarationError
// naming every problem, so the build fails with the whole list at once.
import { hasMarkup, hasStackedMarks, hasVisible, lengthOf } from './clean.js';
import { LIMITS } from './limits.js';
import type { ContentDeclaration, Field, ItemCheck, ListDeclaration, Rule, TextCheck, TextDeclaration } from './types.js';
import { checkItem, checkText } from './validate.js';

/** A declaration that can't be used. `problems` has one line per mistake. */
export class DeclarationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`The content declaration is not valid:\n- ${problems.join('\n- ')}`);
    this.name = 'DeclarationError';
    this.problems = problems;
  }
}

const TEXT_KEY = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const NAME = /^[a-z][a-z0-9-]*$/;
const FIELD_TYPES = ['text', 'longtext', 'link', 'number', 'date', 'checkbox', 'choice', 'image'];
const SORTABLE = ['text', 'number', 'date'];

/** The declaration after checking: lists with their defaults filled in. */
export interface Content<D extends ContentDeclaration = ContentDeclaration> {
  /** Type-level only: the declaration, so keys and list names can be checked. Never set. */
  readonly declared?: D;
  texts: ReadonlyMap<string, TextDeclaration>;
  lists: ReadonlyMap<string, ListDeclaration & { maxItems: number }>;
  rules: readonly Rule[];
  /** Cleans and checks a new text for a key. Unknown keys are a problem, not a throw. */
  validateText(key: string, text: unknown): TextCheck;
  /** Cleans and checks an item's fields against a list. */
  validateItem(list: string, fields: unknown): ItemCheck;
}

const isCount = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;

function checkField(list: string, field: Field, errors: string[]): void {
  const where = `list "${list}", field "${String((field as { name?: unknown }).name)}"`;
  if (typeof field.name !== 'string' || !NAME.test(field.name)) {
    errors.push(`list "${list}": a field name must be lowercase letters, digits and "-", starting with a letter`);
    return;
  }
  if (typeof field.label !== 'string' || field.label.trim() === '') errors.push(`${where} needs a label`);
  if (!FIELD_TYPES.includes(field.type)) {
    errors.push(`${where}: "${String(field.type)}" is not a field type (${FIELD_TYPES.join(', ')})`);
    return;
  }
  if (field.type === 'text' || field.type === 'longtext') {
    const hard = LIMITS[field.type].max;
    if (field.maxLength !== undefined && !isCount(field.maxLength, hard)) {
      errors.push(`${where}: maxLength must be a whole number from 1 to ${hard}`);
    }
  }
  if (field.type === 'number') {
    const { min, max } = field;
    for (const [what, value] of [['min', min], ['max', max]] as const) {
      if (value !== undefined && !Number.isSafeInteger(value)) errors.push(`${where}: ${what} must be a whole number`);
    }
    if (min !== undefined && max !== undefined && min > max) errors.push(`${where}: min is more than max`);
  }
  if (field.type === 'link') {
    const ok = field.schemes === undefined || (Array.isArray(field.schemes) && field.schemes.length > 0 && field.schemes.every((s) => /^[a-z][a-z0-9+.-]*$/.test(s)));
    if (!ok) errors.push(`${where}: schemes must be a list of names like "https" or "mailto"`);
  }
  if (field.type === 'image') checkImageField(where, field, errors);
  if (field.type === 'choice') {
    const options = field.options;
    if (!Array.isArray(options) || options.length === 0) {
      errors.push(`${where}: a choice needs options`);
    } else {
      const seen = new Set<string>();
      for (const option of options) {
        if (typeof option?.value !== 'string' || option.value === '' || typeof option.label !== 'string' || option.label === '') {
          errors.push(`${where}: every option needs a value and a label`);
        } else if (seen.has(option.value)) errors.push(`${where}: the option "${option.value}" is repeated`);
        else seen.add(option.value);
      }
    }
  }
}

function checkImageField(where: string, field: Field & { type: 'image' }, errors: string[]): void {
  const { minWidth: lo, maxWidth: hi, widthsMax, defaultWidths, sizes: sizesMax, original } = LIMITS.image;
  const { aspect, widths, sizes, full, minWidth } = field;
  if (aspect !== undefined && !(typeof aspect === 'string' && /^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(aspect))) {
    errors.push(`${where}: aspect must be two whole numbers with a colon, like "1:1" or "16:10"`);
  }
  if (widths !== undefined) {
    if (!Array.isArray(widths) || widths.length < 1 || widths.length > widthsMax || !widths.every((w) => isCount(w, hi) && w >= lo)) {
      errors.push(`${where}: widths must be 1 to ${widthsMax} whole numbers from ${lo} to ${hi}`);
    } else if (widths.some((w, i) => i > 0 && w <= widths[i - 1]!)) {
      errors.push(`${where}: widths must go from the narrowest to the widest, with none repeated`);
    }
  }
  if (sizes !== undefined && (typeof sizes !== 'string' || sizes.trim() === '' || sizes.length > sizesMax)) {
    errors.push(`${where}: sizes must be text of 1 to ${sizesMax} characters, like "(min-width: 800px) 400px, 100vw"`);
  }
  if (full !== undefined) {
    const widest = Array.isArray(widths) && widths.length > 0 && widths.every((w) => typeof w === 'number') ? Math.max(...widths) : Math.max(...defaultWidths);
    if (!isCount(full, hi) || full < lo) errors.push(`${where}: full must be a whole number from ${lo} to ${hi}`);
    else if (full <= widest) errors.push(`${where}: full must be wider than the widest of widths (${widest})`);
  }
  if (minWidth !== undefined && !isCount(minWidth, original)) {
    errors.push(`${where}: minWidth must be a whole number from 1 to ${original}`);
  }
}

function checkList(list: ListDeclaration, errors: string[]): void {
  if (typeof list.name !== 'string' || !NAME.test(list.name)) {
    errors.push(`"${String(list.name)}" is not a valid list name (lowercase letters, digits and "-", starting with a letter)`);
    return;
  }
  const name = list.name;
  for (const word of ['label', 'singular'] as const) {
    if (typeof list[word] !== 'string' || list[word].trim() === '') errors.push(`list "${name}" needs a ${word}`);
  }
  if (list.maxItems !== undefined && !isCount(list.maxItems, LIMITS.maxItems.max)) {
    errors.push(`list "${name}": maxItems must be a whole number from 1 to ${LIMITS.maxItems.max}`);
  }
  if (!Array.isArray(list.fields) || list.fields.length === 0) {
    errors.push(`list "${name}" needs fields`);
    return;
  }
  if (list.fields.length > LIMITS.fieldsPerList) {
    errors.push(`list "${name}" has ${list.fields.length} fields; the most is ${LIMITS.fieldsPerList}`);
  }
  const byName = new Map<string, Field>();
  for (const field of list.fields) {
    checkField(name, field, errors);
    if (typeof field?.name !== 'string') continue;
    if (byName.has(field.name)) errors.push(`list "${name}": the field "${field.name}" is repeated`);
    else byName.set(field.name, field);
  }
  const title = byName.get(list.titleField);
  if (title === undefined) errors.push(`list "${name}": the title field "${String(list.titleField)}" is not one of its fields`);
  else if (title.type !== 'text' || title.required !== true) {
    errors.push(`list "${name}": the title field "${list.titleField}" must be a required text field`);
  }
  if (list.sort !== 'hand') {
    const by = typeof list.sort === 'object' && list.sort !== null ? list.sort.by : undefined;
    const field = by === undefined ? undefined : byName.get(by);
    const order = (list.sort as { order?: unknown } | null)?.order;
    if (field === undefined) errors.push(`list "${name}": sort must be "hand" or { by: <one of its fields> }`);
    else if (!SORTABLE.includes(field.type)) errors.push(`list "${name}": it can't sort by "${field.name}", a ${field.type} field`);
    else if (order !== undefined && order !== 'asc' && order !== 'desc') errors.push(`list "${name}": sort order must be "asc" or "desc"`);
  }
}

/**
 * Checks a declaration and returns the checkers for it. Throws a
 * DeclarationError for: a repeated text key, list, field or rule name; a text
 * key not shaped `<page>.<name>`; a list without a required text title field;
 * a limit over the hard maximum; or a default text that fails its own checks.
 */
export function defineContent<const D extends ContentDeclaration>(declaration: D): Content<D> {
  const errors: string[] = [];
  const texts = new Map<string, TextDeclaration>();
  const lists = new Map<string, ListDeclaration & { maxItems: number }>();
  const rules: Rule[] = [];
  const ruleNames = new Set<string>();

  for (const text of declaration.texts ?? []) {
    const key = String(text?.key);
    if (typeof text?.key !== 'string' || !TEXT_KEY.test(text.key)) {
      errors.push(`"${key}" is not a text key: use <page>.<name>, lowercase, like "home.hero.title"`);
      continue;
    }
    if (texts.has(key)) {
      errors.push(`the text key "${key}" is repeated`);
      continue;
    }
    if (typeof text.label !== 'string' || text.label.trim() === '') errors.push(`text "${key}" needs a label`);
    if (!isCount(text.max, LIMITS.keyedText)) errors.push(`text "${key}": max must be a whole number from 1 to ${LIMITS.keyedText}`);
    if (typeof text.default !== 'string') errors.push(`text "${key}" needs default words`);
    texts.set(key, text);
  }

  for (const list of declaration.lists ?? []) {
    checkList(list, errors);
    if (typeof list?.name !== 'string') continue;
    if (lists.has(list.name)) errors.push(`the list "${list.name}" is repeated`);
    else lists.set(list.name, { ...list, maxItems: list.maxItems ?? LIMITS.maxItems.default });
  }

  for (const rule of declaration.rules ?? []) {
    if (typeof rule?.name !== 'string' || rule.name === '') errors.push('every rule needs a name');
    else if (ruleNames.has(rule.name)) errors.push(`the rule "${rule.name}" is repeated`);
    else ruleNames.add(rule.name);
    if (typeof rule?.test !== 'function') errors.push(`rule "${String(rule?.name)}" needs a test function`);
    if (typeof rule?.message !== 'string' || rule.message.trim() === '') errors.push(`rule "${String(rule?.name)}" needs a message`);
    rules.push(rule);
  }

  if (errors.length > 0) throw new DeclarationError(errors);

  const content: Content<D> = {
    texts,
    lists,
    rules,
    validateText: (key, text) => checkText(content, key, text),
    validateItem: (list, fields) => checkItem(content, list, fields),
  };

  // The words a site starts with must pass its own checks, or a first edit
  // could never put them back.
  for (const text of texts.values()) {
    const words = text.default;
    const bad =
      !hasVisible(words) || hasMarkup(words) || hasStackedMarks(words) || lengthOf(words) > text.max
        ? 'fails the built-in checks'
        : content.validateText(text.key, words).problems.length > 0
          ? 'fails a site rule or changes when cleaned'
          : undefined;
    if (bad) errors.push(`the default words for "${text.key}" ${bad}`);
  }
  if (errors.length > 0) throw new DeclarationError(errors);
  return content;
}
