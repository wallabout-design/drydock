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
export declare function cropSegment(crop: ImageCrop | undefined): string;
/** The formats a size is made in. WebP for every size; AVIF too, where `avifFits` says so. */
export type RenditionFormat = 'webp' | 'avif';
/** The height of a size of `width` pixels, for an image shown `shownWidth` by `shownHeight` (the crop, or the whole image). */
export declare function renditionHeight(shownWidth: number, shownHeight: number, width: number): number;
/** True when a size of this many pixels is also made as AVIF: small enough that the images service always answers AVIF for it. */
export declare function avifFits(width: number, height: number): boolean;
/**
 * The widths that may be made for an upload (ascending), and the lightbox width when there is one.
 * The page's addresses and the upload route's list of allowed widths both come from here.
 */
export declare function renditionWidths(field: ImageField, value: ImageUpload): {
    widths: number[];
    full: number | undefined;
};
/**
 * The addresses for an image value. An address value comes back as `{ src }`.
 * An upload gets one address per declared width that is no wider than the crop
 * (or the original, with no crop), plus the crop's own width when that is
 * narrower than the widest declared width, so nothing is ever enlarged.
 */
export declare function imageSources(field: ImageField, value: ImageAddress, options?: ImageSourcesOptions): {
    src: string;
};
export declare function imageSources(field: ImageField, value: ImageUpload, options?: ImageSourcesOptions): UploadSources;
export declare function imageSources(field: ImageField, value: ImageValue, options?: ImageSourcesOptions): {
    src: string;
} | UploadSources;
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
    img: {
        src: string;
        alt: string;
        srcset?: string;
        sizes?: string;
        width?: number;
        height?: number;
    };
    sources: ImageSource[];
}
/**
 * The attributes for an image, as plain values: the framework helpers set them
 * as attributes, so every address and alt text is escaped by the framework.
 * A decorative field gets `alt=""`. An address value gets only `src` and `alt`.
 */
export declare function imageMarkup(field: ImageField, value: ImageValue, options?: ImageMarkupOptions): ImageMarkup;
/** The media query for a dark colour scheme. It follows the device setting only. */
export declare const DARK_MEDIA = "(prefers-color-scheme: dark)";
/**
 * The address to link a lightbox to: an uploaded image's `full` address when
 * the field has one, otherwise its widest address; an address value's `src`.
 */
export declare function fullSrc(field: ImageField, value: ImageValue, options?: ImageSourcesOptions): string;
