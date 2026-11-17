// The addresses a page needs for an image field. Pure: it reads and writes nothing.
import { LIMITS } from './limits.js';
export function imageSources(field, value, options = {}) {
    if ('src' in value)
        return { src: value.src };
    const prefix = options.prefix ?? '/media/';
    const { crop } = value;
    const from = crop === undefined ? 'whole' : `c${crop.x}-${crop.y}-${crop.w}-${crop.h}`;
    const available = crop?.w ?? value.width;
    const shownHeight = crop?.h ?? value.height;
    const declared = [...(field.widths ?? LIMITS.image.defaultWidths)];
    const widest = Math.max(...declared);
    const widths = declared.filter((w) => w <= available);
    if (available < widest && !widths.includes(available))
        widths.push(available);
    widths.sort((a, b) => a - b);
    const address = (w) => `${prefix}${value.key}/${from}/${w}.webp`;
    const top = widths[widths.length - 1];
    const result = {
        src: address(widths[Math.floor((widths.length - 1) / 2)]),
        srcset: widths.map((w) => `${address(w)} ${w}w`).join(', '),
        sizes: field.sizes ?? '100vw',
        width: top,
        height: Math.round((top * shownHeight) / available),
    };
    if (field.full !== undefined && available > widest)
        result.full = address(Math.min(field.full, available));
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
    };
    if (options.dark !== undefined) {
        const dark = imageSources(field, options.dark, { prefix: options.prefix });
        result.dark = 'srcset' in dark ? { media: DARK_MEDIA, srcset: dark.srcset, sizes: dark.sizes } : { media: DARK_MEDIA, srcset: dark.src };
    }
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
