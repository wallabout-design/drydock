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
  /** The AVIF addresses, for the sizes small enough to have one (see `avifFits`). Absent when there are none. */
  avifSrcset?: string;
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

/** The formats a size is made in. WebP for every size; AVIF too, where `avifFits` says so. */
export type RenditionFormat = 'webp' | 'avif';

/** The height of a size of `width` pixels, for an image shown `shownWidth` by `shownHeight` (the crop, or the whole image). */
export function renditionHeight(shownWidth: number, shownHeight: number, width: number): number {
  return Math.round((width * shownHeight) / shownWidth);
}

/** True when a size of this many pixels is also made as AVIF: small enough that the images service always answers AVIF for it. */
export function avifFits(width: number, height: number): boolean {
  return width * height <= LIMITS.image.avifMaxPixels;
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
  const address = (w: number, format: RenditionFormat = 'webp'): string => `${prefix}${value.key}/${from}/${w}.${format}`;
  const top = widths[widths.length - 1] as number;
  const avif = widths.filter((w) => avifFits(w, renditionHeight(available, shownHeight, w)));
  const result: UploadSources = {
    src: address(widths[Math.floor((widths.length - 1) / 2)] as number),
    srcset: widths.map((w) => `${address(w)} ${w}w`).join(', '),
    sizes: field.sizes ?? '100vw',
    width: top,
    height: renditionHeight(available, shownHeight, top),
  };
  if (avif.length > 0) result.avifSrcset = avif.map((w) => `${address(w, 'avif')} ${w}w`).join(', ');
  if (full !== undefined) result.full = address(full);
  return result;
}

/** The options for the markup of an image. */
export interface ImageMarkupOptions extends ImageSourcesOptions {
  /** A second image shown in dark mode. Its own alt text is not used: the light image's alt text describes both. */
  dark?: ImageValue;
}

/** A `<source>` before the `<img>`: an AVIF list, or the dark-mode image. */
export interface ImageSource {
  /** The media query that selects it. Absent for the light image. */
  media?: string;
  /** The MIME type of the addresses, for AVIF. Absent when the browser must read the file to tell. */
  type?: 'image/avif';
  srcset: string;
  sizes?: string;
}

/**
 * The attributes of an image's `<img>` (WebP), and the `<source>` elements before it, in the order a
 * browser must read them: the dark-mode images first, then the light AVIF, so a dark page never takes the light one.
 */
export interface ImageMarkup {
  img: { src: string; alt: string; srcset?: string; sizes?: string; width?: number; height?: number };
  sources: ImageSource[];
}

/**
 * The attributes for an image, as plain values: the framework helpers set them
 * as attributes, so every address and alt text is escaped by the framework.
 * A decorative field gets `alt=""`. An address value gets only `src` and `alt`.
 */
export function imageMarkup(field: ImageField, value: ImageValue, options: ImageMarkupOptions = {}): ImageMarkup {
  const alt = field.decorative ? '' : value.alt;
  const shown = imageSources(field, value, { prefix: options.prefix });
  const result: ImageMarkup = {
    img: 'srcset' in shown ? { src: shown.src, srcset: shown.srcset, sizes: shown.sizes, width: shown.width, height: shown.height, alt } : { src: shown.src, alt },
    sources: [],
  };
  if (options.dark !== undefined) {
    const dark = imageSources(field, options.dark, { prefix: options.prefix });
    if ('srcset' in dark) {
      if (dark.avifSrcset !== undefined) result.sources.push({ media: DARK_MEDIA, type: 'image/avif', srcset: dark.avifSrcset, sizes: dark.sizes });
      result.sources.push({ media: DARK_MEDIA, srcset: dark.srcset, sizes: dark.sizes });
    } else {
      result.sources.push({ media: DARK_MEDIA, srcset: dark.src });
    }
  }
  if ('srcset' in shown && shown.avifSrcset !== undefined) result.sources.push({ type: 'image/avif', srcset: shown.avifSrcset, sizes: shown.sizes });
  return result;
}

/** The media query for a dark colour scheme. It follows the device setting only. */
export const DARK_MEDIA = '(prefers-color-scheme: dark)';

/**
 * The address to link a lightbox to: an uploaded image's `full` address when
 * the field has one, otherwise its widest address; an address value's `src`.
 */
export function fullSrc(field: ImageField, value: ImageValue, options: ImageSourcesOptions = {}): string {
  if ('src' in value) return value.src;
  const shown = imageSources(field, value, options);
  if (shown.full !== undefined) return shown.full;
  return (shown.srcset.split(', ').pop() as string).split(' ')[0] as string;
}
