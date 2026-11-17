// Checking a typed value against its declaration. The editor runs this in the
// browser to show messages sooner; the server runs it again for real.
// Messages are for non-technical readers: plain words, no jargon.
import { cleanLine, cleanLines, hasMarkup, hasStackedMarks, hasVisible, lengthOf } from './clean.js';
import { LIMITS } from './limits.js';
const ITEM = '_item';
const problem = (field, kind, message, rule) => rule === undefined ? { field, kind, message } : { field, kind, message, rule };
/** The built-in checks on cleaned plain text. Returns the first problem, or null. */
function plainProblem(field, label, text, max) {
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
function ruleProblem(content, field, text, context) {
    for (const rule of content.rules) {
        if (!rule.test(text, context))
            return problem(field, 'rule', rule.message, rule.name);
    }
    return null;
}
/** Cleans and checks a keyed text. */
export function checkText(content, key, raw) {
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
function checkWords(content, list, field, raw, label = field.label, name = field.name) {
    if (typeof raw !== 'string')
        return { problem: problem(name, 'type', `${label} must be text.`) };
    const text = field.type === 'text' ? cleanLine(raw) : cleanLines(raw);
    if (!hasVisible(text))
        return { empty: true };
    const max = field.maxLength ?? LIMITS[field.type].default;
    const found = plainProblem(name, label, text, max) ?? ruleProblem(content, name, text, { list, field: field.name, label });
    return found === null ? { value: text } : { problem: found };
}
function checkLink(field, raw) {
    const schemes = field.schemes ?? ['https'];
    const hint = `${field.label} must be a full web address, starting with ${schemes.map((s) => (s === 'mailto' ? 'mailto:' : `${s}://`)).join(' or ')}.`;
    if (typeof raw !== 'string')
        return { problem: problem(field.name, 'type', hint) };
    const text = raw.trim();
    if (text === '')
        return { empty: true };
    if (/[\s\p{Cc}\p{Cf}]/u.test(text))
        return { problem: problem(field.name, 'format', `${field.label} can’t contain spaces or hidden characters.`) };
    if (lengthOf(text) > LIMITS.link)
        return { problem: problem(field.name, 'too-long', `${field.label} is too long for a web address.`) };
    let url;
    try {
        url = new URL(text);
    }
    catch {
        return { problem: problem(field.name, 'format', hint) };
    }
    if (!schemes.includes(url.protocol.slice(0, -1)))
        return { problem: problem(field.name, 'format', hint) };
    if (url.username || url.password) {
        return { problem: problem(field.name, 'format', `${field.label} can’t include a user name or password.`) };
    }
    return { value: url.href };
}
function checkNumber(field, raw) {
    if (typeof raw === 'string' && raw.trim() === '')
        return { empty: true };
    const value = typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value))
        return { problem: problem(field.name, 'type', `${field.label} must be a number.`) };
    if (!Number.isSafeInteger(value))
        return { problem: problem(field.name, 'format', `${field.label} must be a whole number.`) };
    const { min, max } = field;
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        const message = min !== undefined && max !== undefined
            ? `${field.label} must be from ${min} to ${max}.`
            : min !== undefined
                ? `${field.label} must be ${min} or more.`
                : `${field.label} must be ${max} or less.`;
        return { problem: problem(field.name, 'range', message) };
    }
    return { value };
}
function checkDate(field, raw) {
    const message = `${field.label} must be a date, like 2026-03-14.`;
    if (typeof raw !== 'string')
        return { problem: problem(field.name, 'type', message) };
    const text = raw.trim();
    if (text === '')
        return { empty: true };
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match)
        return { problem: problem(field.name, 'format', message) };
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    // Date rolls 2026-02-31 over to March; a real date comes back unchanged.
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        return { problem: problem(field.name, 'format', message) };
    }
    return { value: text };
}
function checkChoice(field, raw) {
    if (typeof raw === 'string' && raw === '')
        return { empty: true };
    return typeof raw === 'string' && field.options.some((o) => o.value === raw)
        ? { value: raw }
        : { problem: problem(field.name, 'format', `Please choose one of the options for ${field.label}.`) };
}
const UPLOAD_KEY = /^\d{4}\/(0[1-9]|1[0-2])\/[A-Za-z0-9_-]{22,32}$/;
const isWhole = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
/** The `a:b` of an aspect setting as one number, width over height. */
function aspectRatio(aspect) {
    const [a, b] = aspect.split(':').map(Number);
    return a / b;
}
function checkUpload(content, list, field, raw) {
    const broken = problem(field.name, 'format', `${field.label} could not be read. Please choose the image again.`);
    const { key, width, height, crop } = raw;
    const max = LIMITS.image.original;
    if (typeof key !== 'string' || !UPLOAD_KEY.test(key) || !isWhole(width, max) || !isWhole(height, max))
        return { problem: broken };
    let kept;
    if (crop !== undefined) {
        const c = crop;
        if (typeof c !== 'object' || c === null || Array.isArray(c))
            return { problem: broken };
        const { x, y, w, h } = c;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !isWhole(w, max) || !isWhole(h, max))
            return { problem: broken };
        if (x < 0 || y < 0 || x + w > width || y + h > height) {
            return { problem: problem(field.name, 'range', `The part of ${field.label.toLowerCase()} you chose reaches outside the image. Please choose it again.`) };
        }
        if (field.aspect !== undefined) {
            const wanted = aspectRatio(field.aspect);
            if (Math.abs(w / h - wanted) / wanted > 0.01) {
                return { problem: problem(field.name, 'range', `The part of ${field.label.toLowerCase()} you chose is the wrong shape (it should be ${field.aspect}). Please choose it again.`) };
            }
        }
        kept = { x: x, y: y, w, h };
    }
    else if (field.aspect !== undefined) {
        return { problem: problem(field.name, 'empty', `Please choose the part of ${field.label.toLowerCase()} to show (${field.aspect}).`) };
    }
    const shape = kept === undefined ? {} : { crop: kept };
    if (field.decorative)
        return { value: { key, alt: '', width, height, ...shape } };
    const alt = checkAlt(content, list, field, raw.alt);
    if ('problem' in alt)
        return alt;
    return { value: { key, alt: alt.value, width, height, ...shape } };
}
function checkAlt(content, list, field, rawAlt) {
    const altName = `${field.name}.alt`;
    const altLabel = `The description of ${field.label.toLowerCase()}`;
    if (rawAlt !== undefined && typeof rawAlt !== 'string')
        return { problem: problem(altName, 'type', `${altLabel} must be text.`) };
    const alt = checkWords(content, list, { name: field.name, label: field.label, type: 'text', maxLength: LIMITS.alt }, rawAlt ?? '', altLabel, altName);
    if ('problem' in alt)
        return alt;
    if ('empty' in alt)
        return { problem: problem(altName, 'empty', `${altLabel} is needed, for people who can’t see the image.`) };
    return { value: alt.value };
}
function checkImage(content, list, field, raw) {
    const message = `${field.label} must be an https web address or a path on the site starting with /.`;
    const isEmpty = raw === undefined || raw === null || raw === '' || (typeof raw === 'object' && raw.src === '' && !raw.alt && raw.key === undefined);
    if (isEmpty)
        return { empty: true };
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { problem: problem(field.name, 'type', message) };
    const given = raw;
    if (given.key !== undefined && given.src !== undefined) {
        return { problem: problem(field.name, 'format', `${field.label} can’t be both an uploaded image and a web address. Please choose one.`) };
    }
    if (given.key !== undefined)
        return checkUpload(content, list, field, given);
    const { src: rawSrc, alt: rawAlt } = given;
    if (typeof rawSrc !== 'string' || (rawAlt !== undefined && typeof rawAlt !== 'string')) {
        return { problem: problem(field.name, 'type', message) };
    }
    const src = rawSrc.trim();
    if (src === '')
        return { problem: problem(field.name, 'empty', `${field.label} needs an image address.`) };
    if (/[\s\p{Cc}\p{Cf}\\]/u.test(src) || lengthOf(src) > LIMITS.link) {
        return { problem: problem(field.name, 'format', message) };
    }
    if (src.startsWith('/')) {
        if (src.startsWith('//') || src.split('/').some((part) => part === '..' || part === '.')) {
            return { problem: problem(field.name, 'format', message) };
        }
    }
    else {
        let url;
        try {
            url = new URL(src);
        }
        catch {
            return { problem: problem(field.name, 'format', message) };
        }
        if (url.protocol !== 'https:' || url.username || url.password)
            return { problem: problem(field.name, 'format', message) };
    }
    if (field.decorative)
        return { value: { src, alt: '' } };
    const alt = checkAlt(content, list, field, rawAlt);
    if ('problem' in alt)
        return alt;
    return { value: { src, alt: alt.value } };
}
function checkField(content, list, field, raw) {
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
export function checkItem(content, listName, raw) {
    const list = content.lists.get(listName);
    if (list === undefined) {
        return { ok: false, values: {}, problems: [problem(ITEM, 'unknown', 'This list is no longer on the site. Reload the page.')] };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, values: {}, problems: [problem(ITEM, 'type', 'The form could not be read. Please reload the page and try again.')] };
    }
    const given = raw;
    const problems = [];
    const known = new Set(list.fields.map((f) => f.name));
    if (Object.keys(given).some((name) => !known.has(name))) {
        problems.push(problem(ITEM, 'unknown', 'The form is out of date. Please reload the page and try again.'));
    }
    const values = {};
    for (const field of list.fields) {
        const given_ = Object.hasOwn(given, field.name) ? given[field.name] : undefined;
        if (field.type === 'checkbox' && (given_ === undefined || given_ === null)) {
            values[field.name] = false;
            continue;
        }
        const checked = given_ === undefined || given_ === null ? { empty: true } : checkField(content, listName, field, given_);
        if ('problem' in checked)
            problems.push(checked.problem);
        else if ('empty' in checked) {
            if (field.required)
                problems.push(problem(field.name, 'empty', `${field.label} is needed.`));
        }
        else
            values[field.name] = checked.value;
    }
    if (problems.length === 0 && new TextEncoder().encode(JSON.stringify(values)).length > LIMITS.itemBytes) {
        problems.push(problem(ITEM, 'too-big', 'This is too much to save in one item. Please shorten the longer fields.'));
    }
    return { ok: problems.length === 0, values, problems };
}
