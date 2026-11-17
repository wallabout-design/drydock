import { type RenditionFormat } from '../core/image.js';
import type { Content } from '../core/declare.js';
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
export interface UploadRoutes {
    /** The upload route's work, after the caller has checked who is asking and where from. */
    upload(request: Request, query: URLSearchParams, now: Date): Promise<Response>;
    /** The renditions route's work, given the parsed JSON body. */
    rendition(body: unknown): Promise<Response>;
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
