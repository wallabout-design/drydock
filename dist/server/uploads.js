// Uploaded images (content-editing.md, "images"): the original is kept as it came
// in a bucket, and each size a page needs is made once, from /admin, when staff
// save. The public route only reads files that exist, so a visitor can't spend
// the month's image allowance.
//
//   POST /admin/api/uploads?list=<list>&field=<field>   the image itself; answers { key, width, height }
//   POST /admin/api/uploads/renditions                   { key, list, field, crop?, width }: makes one size
//   serveMedia(request, bucket)                          GET /media/<key>/<crop>/<w>.webp, for the site's Worker
//
// The bucket and the images binding are described by the few methods used, so
// a site passes its R2 bucket and `IMAGES` binding as they are and tests pass fakes.
import { cropSegment, imageSources, renditionWidths } from '../core/image.js';
import { LIMITS } from '../core/limits.js';
import { checkCrop, UPLOAD_KEY } from '../core/validate.js';
/** The biggest original, in bytes. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const DEFAULT_MEDIA_PREFIX = '/media/';
export const RENDITION_CACHE = 'public, max-age=31536000, immutable';
const WEBP_QUALITY = 80;
/** The kind of image from its first bytes (never from a name or a header), or null. */
export function sniffImage(bytes) {
    const at = (i) => bytes[i] ?? -1;
    if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff)
        return 'image/jpeg';
    if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b))
        return 'image/png';
    const ascii = (from, text) => [...text].every((c, i) => at(from + i) === c.charCodeAt(0));
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP'))
        return 'image/webp';
    return null;
}
/** A key for a new original: this year and month, then 24 random characters. */
export function newUploadKey(now) {
    const random = new Uint8Array(18);
    crypto.getRandomValues(random);
    const text = btoa(String.fromCharCode(...random)).replace(/\+/g, '-').replace(/\//g, '_');
    return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${text}`;
}
const stream = (bytes) => new Blob([bytes]).stream();
/** Reads the body once, refusing more than `max` bytes however the size is told (a header can be missing or wrong). */
async function readBytes(request, max) {
    const told = Number(request.headers.get('content-length') ?? 0);
    if (told > max)
        return 'too-large';
    if (!request.body)
        return new Uint8Array(0);
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            return 'too-large';
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }
    return bytes;
}
const wholeNumber = (text) => {
    const n = Number(text);
    return text !== undefined && Number.isInteger(n) && n >= 1 && n <= LIMITS.image.original ? n : null;
};
export const originalKey = (key) => `originals/${key}`;
export const renditionKey = (key, crop, width) => `renditions/${key}/${cropSegment(crop)}/${width}.webp`;
/** What the bucket knows about an original, or why it can't be used for this field. */
export async function readOriginal(bucket, key, list, field) {
    if (!UPLOAD_KEY.test(key))
        return null;
    const found = await bucket.head(originalKey(key));
    const meta = found?.customMetadata;
    if (!meta || meta.list !== list || meta.field !== field)
        return null;
    const width = wholeNumber(meta.width);
    const height = wholeNumber(meta.height);
    return width === null || height === null ? null : { width, height };
}
/** True when the images service says this month's free allowance is used up (error 9422). */
function isAllowanceUsedUp(error) {
    const e = error;
    return e?.code === 9422 || (typeof e?.message === 'string' && e.message.includes('9422'));
}
export function createUploadRoutes(content, options, json) {
    const { bucket, images } = options;
    const imageField = (list, field) => {
        const found = list === null || field === null ? undefined : content.lists.get(list)?.fields.find((f) => f.name === field);
        return found?.type === 'image' ? found : null;
    };
    const unknownField = () => json(404, { error: 'unknown-field', message: 'This image field is no longer on the site. Reload the page.' });
    return {
        async upload(request, query, now) {
            const list = query.get('list');
            const field = query.get('field');
            if (!imageField(list, field))
                return unknownField();
            const bytes = await readBytes(request, MAX_UPLOAD_BYTES);
            if (bytes === 'too-large')
                return json(413, { error: 'too-large', message: 'That image is too big. Please choose one under 15 MB.' });
            const type = sniffImage(bytes);
            if (type === null)
                return json(415, { error: 'not-an-image', message: 'That is not a JPEG, PNG or WebP image. Please choose a photo in one of those types.' });
            let width = null;
            let height = null;
            try {
                const info = await images.info(stream(bytes));
                width = wholeNumber(String(info.width));
                height = wholeNumber(String(info.height));
            }
            catch {
                // Falls through to the refusal below.
            }
            if (width === null || height === null) {
                return json(422, { error: 'unreadable', message: `That image could not be read, or it is more than ${LIMITS.image.original.toLocaleString('en-US')} pixels across. Please choose another.` });
            }
            const key = newUploadKey(now);
            await bucket.put(originalKey(key), bytes, {
                httpMetadata: { contentType: type },
                customMetadata: { list: list, field: field, contentType: type, width: String(width), height: String(height) },
            });
            return json(200, { key, width, height });
        },
        async rendition(body) {
            const malformed = () => json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
            if (typeof body !== 'object' || body === null || Array.isArray(body))
                return malformed();
            const { key, list, field: fieldName, crop, width } = body;
            if (typeof key !== 'string' || typeof list !== 'string' || typeof fieldName !== 'string' || typeof width !== 'number')
                return malformed();
            const field = imageField(list, fieldName);
            if (!field)
                return unknownField();
            const original = await readOriginal(bucket, key, list, fieldName);
            if (!original)
                return json(404, { error: 'unknown-upload', message: 'That image was not uploaded for this field. Please choose it again.' });
            const checked = checkCrop(field, crop === null ? undefined : crop, original.width, original.height);
            if ('problem' in checked)
                return json(422, { error: 'invalid', message: checked.problem.message });
            const upload = { key, alt: '', width: original.width, height: original.height, ...(checked.crop ? { crop: checked.crop } : {}) };
            const allowed = renditionWidths(field, upload);
            if (!Number.isInteger(width) || ![...allowed.widths, ...(allowed.full === undefined ? [] : [allowed.full])].includes(width)) {
                return json(422, { error: 'width-not-allowed', message: `This field has no ${String(width)} px size. Reload the page and try again.` });
            }
            const target = renditionKey(key, checked.crop, width);
            if (await bucket.head(target))
                return json(200, { key: target, made: false });
            const source = await bucket.get(originalKey(key));
            if (!source)
                return json(404, { error: 'unknown-upload', message: 'That image was not uploaded for this field. Please choose it again.' });
            let made;
            try {
                const c = checked.crop;
                const transform = images.input(source.body);
                const shaped = c ? transform.transform({ trim: { left: c.x, top: c.y, width: c.w, height: c.h }, width }) : transform.transform({ width });
                made = (await shaped.output({ format: 'image/webp', quality: WEBP_QUALITY })).response();
            }
            catch (error) {
                if (isAllowanceUsedUp(error)) {
                    return json(429, { error: 'allowance', message: 'This month’s free image allowance is used up, so new sizes can’t be made until next month. Images already on the site still work. Choose an image that is already online, or try again next month.' });
                }
                return json(502, { error: 'resize-failed', message: `The ${width} px size could not be made. Please try again.` });
            }
            const type = (made.headers.get('content-type') ?? '').split(';')[0]?.trim();
            if (type !== 'image/webp')
                return json(502, { error: 'resize-failed', message: `The ${width} px size could not be made as a WebP image. Please try again.` });
            await bucket.put(target, new Uint8Array(await made.arrayBuffer()), { httpMetadata: { contentType: 'image/webp', cacheControl: RENDITION_CACHE } });
            return json(200, { key: target, made: true });
        },
        async sizes(body) {
            const malformed = () => json(400, { error: 'malformed', message: 'The editor sent something this site did not understand. Reload the page and try again.' });
            if (typeof body !== 'object' || body === null || Array.isArray(body))
                return malformed();
            const { key, list, field: fieldName, crop } = body;
            if (typeof key !== 'string' || typeof list !== 'string' || typeof fieldName !== 'string')
                return malformed();
            const field = imageField(list, fieldName);
            if (!field)
                return unknownField();
            const original = await readOriginal(bucket, key, list, fieldName);
            if (!original)
                return json(404, { error: 'unknown-upload', message: 'That image was not uploaded for this field. Please choose it again.' });
            const checked = checkCrop(field, crop === null ? undefined : crop, original.width, original.height);
            if ('problem' in checked)
                return json(422, { error: 'invalid', message: checked.problem.message });
            const upload = { key, alt: '', width: original.width, height: original.height, ...(checked.crop ? { crop: checked.crop } : {}) };
            const { widths, full } = renditionWidths(field, upload);
            const shown = imageSources(field, upload, { prefix: options.prefix ?? DEFAULT_MEDIA_PREFIX });
            const largest = shown.srcset.split(', ').pop().split(' ')[0];
            return json(200, { sizes: [...widths, ...(full === undefined ? [] : [full])], preview: largest, width: original.width, height: original.height });
        },
        async original(query) {
            const key = query.get('key');
            const list = query.get('list');
            const field = query.get('field');
            if (key === null || list === null || field === null || !imageField(list, field))
                return unknownField();
            const found = await readOriginal(bucket, key, list, field);
            const object = found ? await bucket.get(originalKey(key)) : null;
            const type = object?.customMetadata?.contentType;
            if (!object || (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp')) {
                return json(404, { error: 'unknown-upload', message: 'That image was not uploaded for this field. Please choose it again.' });
            }
            return new Response(object.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' } });
        },
        async settle(list, values) {
            const problems = [];
            const out = { ...values };
            for (const [name, value] of Object.entries(values)) {
                if (typeof value !== 'object' || !('key' in value))
                    continue;
                const field = imageField(list, name);
                if (!field)
                    continue;
                const original = await readOriginal(bucket, value.key, list, name);
                if (!original) {
                    problems.push({ field: name, kind: 'format', message: `${field.label} was not uploaded for this field, or is no longer kept. Please choose the image again.` });
                    continue;
                }
                // The size comes from the stored original; what the browser said is not used.
                const checked = checkCrop(field, value.crop, original.width, original.height);
                if ('problem' in checked) {
                    problems.push(checked.problem);
                    continue;
                }
                out[name] = { key: value.key, alt: value.alt, width: original.width, height: original.height, ...(checked.crop ? { crop: checked.crop } : {}) };
            }
            return problems.length > 0 ? { problems } : { values: out };
        },
    };
}
/** What an item with an upload gets when no bucket is set up. */
export function uploadsNotSetUp(content, list, values) {
    const problems = [];
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'object' && 'key' in value) {
            const label = content.lists.get(list)?.fields.find((f) => f.name === name)?.label ?? name;
            problems.push({ field: name, kind: 'format', message: `This site can’t keep uploaded images yet, so ${label} can’t be saved. Use the address of an image that is already online.` });
        }
    }
    return problems;
}
const MEDIA_PATH = /^(\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]{22,32})\/(whole|c\d{1,5}-\d{1,5}-\d{1,5}-\d{1,5})\/(\d{1,4})\.webp$/;
/**
 * For the site's Worker: answers `GET <prefix><key>/<crop>/<w>.webp` from the sizes already made.
 * It never transforms, and never reads under `originals/`: any other path is a 404.
 */
export async function serveMedia(request, bucket, prefix = DEFAULT_MEDIA_PREFIX) {
    const missing = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'x-content-type-options': 'nosniff' } });
    }
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(prefix))
        return missing();
    const match = MEDIA_PATH.exec(pathname.slice(prefix.length));
    if (!match)
        return missing();
    const object = await bucket.get(`renditions/${match[1]}/${match[2]}/${match[3]}.webp`);
    if (!object)
        return missing();
    return new Response(request.method === 'HEAD' ? null : object.body, {
        status: 200,
        headers: { 'content-type': 'image/webp', 'cache-control': RENDITION_CACHE, 'x-content-type-options': 'nosniff' },
    });
}
