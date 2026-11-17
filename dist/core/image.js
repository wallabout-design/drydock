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
