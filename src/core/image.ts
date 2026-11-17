// The addresses a page needs for an image field. Pure: it reads and writes nothing.
import { LIMITS } from './limits.js';
import type { ImageAddress, ImageCrop, ImageField, ImageUpload, ImageValue } from './types.js';

export interface ImageSourcesOptions {
  /** Where the images are served from. Default `/media/`. */
  prefix?: string;
}

/** What an `<img>` needs for an uploaded image. */
export interface UploadSources {
  /** The address for browsers that ignore `srcset`: the middle one. */
  src: string;
  srcset: string;
  /** The field's `sizes`, or `100vw`. */
  sizes: string;
  /** The shown shape, for the `<img>` attributes: the widest address, and the height that keeps the shape. */
  width: number;
  height: number;
  /** For a lightbox: given only when the image is wider than every declared width. */
  full?: string;
}

/** The part of a rendition's address that names the crop: `whole`, or `c<x>-<y>-<w>-<h>`. */
export function cropSegment(crop: ImageCrop | undefined): string {
  return crop === undefined ? 'whole' : `c${crop.x}-${crop.y}-${crop.w}-${crop.h}`;
}

/**
 * The widths that may be made for an upload (ascending), and the lightbox width when there is one.
 * The page's addresses and the upload route's list of allowed widths both come from here.
 */
export function renditionWidths(field: ImageField, value: ImageUpload): { widths: number[]; full: number | undefined } {
  const available = value.crop?.w ?? value.width;
  const declared = [...(field.widths ?? LIMITS.image.defaultWidths)];
  const widest = Math.max(...declared);
  const widths = declared.filter((w) => w <= available);
  if (available < widest && !widths.includes(available)) widths.push(available);
  widths.sort((a, b) => a - b);
  const full = field.full !== undefined && available > widest ? Math.min(field.full, available) : undefined;
  return { widths, full };
}

/**
 * The addresses for an image value. An address value comes back as `{ src }`.
 * An upload gets one address per declared width that is no wider than the crop
 * (or the original, with no crop), plus the crop's own width when that is
 * narrower than the widest declared width, so nothing is ever enlarged.
 */
export function imageSources(field: ImageField, value: ImageAddress, options?: ImageSourcesOptions): { src: string };
export function imageSources(field: ImageField, value: ImageUpload, options?: ImageSourcesOptions): UploadSources;
export function imageSources(field: ImageField, value: ImageValue, options?: ImageSourcesOptions): { src: string } | UploadSources;
export function imageSources(field: ImageField, value: ImageValue, options: ImageSourcesOptions = {}): { src: string } | UploadSources {
  if ('src' in value) return { src: value.src };
  const prefix = options.prefix ?? '/media/';
  const { crop } = value;
  const from = cropSegment(crop);
  const available = crop?.w ?? value.width;
  const shownHeight = crop?.h ?? value.height;
  const { widths, full } = renditionWidths(field, value);
  const address = (w: number): string => `${prefix}${value.key}/${from}/${w}.webp`;
  const top = widths[widths.length - 1] as number;
  const result: UploadSources = {
    src: address(widths[Math.floor((widths.length - 1) / 2)] as number),
    srcset: widths.map((w) => `${address(w)} ${w}w`).join(', '),
    sizes: field.sizes ?? '100vw',
    width: top,
    height: Math.round((top * shownHeight) / available),
  };
  if (full !== undefined) result.full = address(full);
  return result;
}
