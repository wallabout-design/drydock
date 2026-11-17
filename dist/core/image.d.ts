import type { ImageAddress, ImageField, ImageUpload, ImageValue } from './types.js';
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
