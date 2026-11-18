import { type RenditionFormat } from '../core/image.js';
import type { Content } from '../core/declare.js';
import type { ListItem } from '../core/read.js';
import type { ImageCrop, ItemValues, Problem } from '../core/types.js';
/** The biggest original, in bytes. */
export declare const MAX_UPLOAD_BYTES: number;
/** What is read of a stored object. An R2 object has all of this. */
export interface MediaObject {
    size: number;
    customMetadata?: Record<string, string>;
}
export interface MediaObjectBody extends MediaObject {
    body: ReadableStream<Uint8Array>;
}
/** The methods used of an R2 bucket. */
export interface MediaBucket {
    head(key: string): Promise<MediaObject | null>;
    get(key: string): Promise<MediaObjectBody | null>;
    put(key: string, value: ArrayBuffer | Uint8Array, options?: {
        httpMetadata?: {
            contentType?: string;
            cacheControl?: string;
        };
        customMetadata?: Record<string, string>;
    }): Promise<unknown>;
}
/** The methods used of Cloudflare's `IMAGES` binding. */
export interface ImagesResult {
    response(): Response;
}
export interface ImagesTransformer {
    transform(options: {
        trim?: {
            left: number;
            top: number;
            width: number;
            height: number;
        };
        width?: number;
    }): ImagesTransformer;
    output(options: {
        format: 'image/webp' | 'image/avif';
        quality?: number;
    }): Promise<ImagesResult>;
}
export interface ImagesBinding {
    info(stream: ReadableStream<Uint8Array>): Promise<{
        format: string;
        width?: number;
        height?: number;
    }>;
    input(stream: ReadableStream<Uint8Array>): ImagesTransformer;
}
export interface UploadsOptions {
    /** The R2 bucket that holds originals and the sizes made from them. */
    bucket: MediaBucket;
    /** The `IMAGES` binding. */
    images: ImagesBinding;
    /** Where `serveMedia` answers, ending in `/`. Default `/media/`. */
    prefix?: string;
}
export declare const DEFAULT_MEDIA_PREFIX = "/media/";
export declare const RENDITION_CACHE = "public, max-age=31536000, immutable";
/** For a WebP answered where an AVIF was asked for and is not there: short, so an AVIF made later is picked up. */
export declare const FALLBACK_CACHE = "public, max-age=3600";
/** The `customMetadata` of the zero-byte file stored at an AVIF key when the images service can't make that AVIF. */
export declare const NO_AVIF: {
    readonly avif: 'none';
};
/** The kind of image from its first bytes (never from a name or a header), or null. */
export declare function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null;
/** A key for a new original: this year and month, then 24 random characters. */
export declare function newUploadKey(now: Date): string;
export declare const originalKey: (key: string) => string;
export declare const renditionKey: (key: string, crop: ImageCrop | undefined, width: number, format?: RenditionFormat) => string;
/** What the bucket knows about an original, or why it can't be used for this field. */
export declare function readOriginal(bucket: MediaBucket, key: string, list: string, field: string): Promise<{
    width: number;
    height: number;
} | null>;
/** One size to make: exactly the body of `POST /admin/api/uploads/renditions`, and the item it is for. */
export interface RenditionTask {
    item: string;
    key: string;
    list: string;
    field: string;
    crop: ImageCrop | null;
    width: number;
}
/** An item the page can't rebuild by itself, with why. */
export interface RenditionProblem {
    item: string;
    title: string;
    field: string;
    label: string;
    kind: 'crop' | 'original';
    message: string;
}
/** What one request of the rebuild page's check found, for a run of items from `offset`. */
export interface MissingReport {
    list: string;
    /** Items in the list, and the index to ask for next (null when the list is done). */
    items: number;
    offset: number;
    next: number | null;
    /** Sizes the items in this run need, and those that are not made yet. */
    needed: number;
    missing: RenditionTask[];
    problems: RenditionProblem[];
}
/**
 * Heads one check request may spend: a Worker on the free plan makes at most
 * 50 subrequests, and the request also reads the store. A run starts an item
 * only when the item's most heads fit in what is left, except the run's first
 * item, which it always checks so the page moves on.
 */
export declare const HEAD_BUDGET = 40;
export interface UploadRoutes {
    /** Which sizes the items of a list need and lack, from `offset`, within a bounded number of heads. */
    missing(list: string, items: readonly ListItem[], offset: number): Promise<MissingReport>;
    /** The upload route's work, after the caller has checked who is asking and where from. */
    upload(request: Request, query: URLSearchParams, now: Date): Promise<Response>;
    /** The renditions route's work, given the parsed JSON body. */
    rendition(body: unknown): Promise<Response>;
    /** The sizes that saving an upload will ask for, given the parsed JSON body `{ key, list, field, crop? }`, and the address of the largest. */
    sizes(body: unknown): Promise<Response>;
    /** A stored original, for staff to change its crop: `?key=&list=&field=`. */
    original(query: URLSearchParams): Promise<Response>;
    /** Checks the uploads in an item's values, and takes their size from the stored original. */
    settle(list: string, values: ItemValues): Promise<{
        values: ItemValues;
    } | {
        problems: Problem[];
    }>;
}
export declare function createUploadRoutes(content: Content, options: UploadsOptions, json: (status: number, body: Record<string, unknown>) => Response): UploadRoutes;
/** What an item with an upload gets when no bucket is set up. */
export declare function uploadsNotSetUp(content: Content, list: string, values: ItemValues): Problem[];
/**
 * For the site's Worker: answers `GET <prefix><key>/<crop>/<w>.<webp|avif>` from the sizes already made.
 * It never transforms, and never reads under `originals/`: any other path is a 404.
 */
export declare function serveMedia(request: Request, bucket: Pick<MediaBucket, 'get'>, prefix?: string): Promise<Response>;
