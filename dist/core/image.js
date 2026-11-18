// The addresses a page needs for an image field. Pure: it reads and writes nothing.
import { LIMITS } from './limits.js';
/** The part of a rendition's address that names the crop: `whole`, or `c<x>-<y>-<w>-<h>`. */
export function cropSegment(crop) {
    return crop === undefined ? 'whole' : `c${crop.x}-${crop.y}-${crop.w}-${crop.h}`;
}
/** The height of a size of `width` pixels, for an image shown `shownWidth` by `shownHeight` (the crop, or the whole image). */
export function renditionHeight(shownWidth, shownHeight, width) {
    return Math.round((width * shownHeight) / shownWidth);
}
/** True when a size of this many pixels is also made as AVIF: small enough that the images service always answers AVIF for it. */
export function avifFits(width, height) {
    return width * height <= LIMITS.image.avifMaxPixels;
}
/**
 * The widths that may be made for an upload (ascending), and the lightbox width when there is one.
 * The page's addresses and the upload route's list of allowed widths both come from here.
 */
export function renditionWidths(field, value) {
    const available = value.crop?.w ?? value.width;
    const declared = [...(field.widths ?? LIMITS.image.defaultWidths)];
    const widest = Math.max(...declared);
    const widths = declared.filter((w) => w <= available);
    if (available < widest && !widths.includes(available))
        widths.push(available);
    widths.sort((a, b) => a - b);
    const full = field.full !== undefined && available > widest ? Math.min(field.full, available) : undefined;
    return { widths, full };
}
export function imageSources(field, value, options = {}) {
    if ('src' in value)
        return { src: value.src };
    const prefix = options.prefix ?? '/media/';
    const { crop } = value;
    const from = cropSegment(crop);
    const available = crop?.w ?? value.width;
    const shownHeight = crop?.h ?? value.height;
    const { widths, full } = renditionWidths(field, value);
    const address = (w, format = 'webp') => `${prefix}${value.key}/${from}/${w}.${format}`;
    const top = widths[widths.length - 1];
    const avif = widths.filter((w) => avifFits(w, renditionHeight(available, shownHeight, w)));
    const result = {
        src: address(widths[Math.floor((widths.length - 1) / 2)]),
        srcset: widths.map((w) => `${address(w)} ${w}w`).join(', '),
        sizes: field.sizes ?? '100vw',
        width: top,
        height: renditionHeight(available, shownHeight, top),
    };
    if (avif.length > 0)
        result.avifSrcset = avif.map((w) => `${address(w, 'avif')} ${w}w`).join(', ');
    if (full !== undefined)
        result.full = address(full);
    return result;
}
/**
 * The attributes for an image, as plain values: the framework helpers set them
 * as attributes, so every address and alt text is escaped by the framework.
 * A decorative field gets `alt=""`. An address value gets only `src` and `alt`.
 */
export function imageMarkup(field, value, options = {}) {
    const alt = field.decorative ? '' : value.alt;
    const shown = imageSources(field, value, { prefix: options.prefix });
    const result = {
        img: 'srcset' in shown ? { src: shown.src, srcset: shown.srcset, sizes: shown.sizes, width: shown.width, height: shown.height, alt } : { src: shown.src, alt },
        sources: [],
    };
    if (options.dark !== undefined) {
        const dark = imageSources(field, options.dark, { prefix: options.prefix });
        if ('srcset' in dark) {
            if (dark.avifSrcset !== undefined)
                result.sources.push({ media: DARK_MEDIA, type: 'image/avif', srcset: dark.avifSrcset, sizes: dark.sizes });
            result.sources.push({ media: DARK_MEDIA, srcset: dark.srcset, sizes: dark.sizes });
        }
        else {
            result.sources.push({ media: DARK_MEDIA, srcset: dark.src });
        }
    }
    if ('srcset' in shown && shown.avifSrcset !== undefined)
        result.sources.push({ type: 'image/avif', srcset: shown.avifSrcset, sizes: shown.sizes });
    return result;
}
/** The media query for a dark colour scheme. It follows the device setting only. */
export const DARK_MEDIA = '(prefers-color-scheme: dark)';
/**
 * The address to link a lightbox to: an uploaded image's `full` address when
 * the field has one, otherwise its widest address; an address value's `src`.
 */
export function fullSrc(field, value, options = {}) {
    if ('src' in value)
        return value.src;
    const shown = imageSources(field, value, options);
    if (shown.full !== undefined)
        return shown.full;
    return shown.srcset.split(', ').pop().split(' ')[0];
}
