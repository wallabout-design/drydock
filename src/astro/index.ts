// Astro helpers. The components are `@wallabout-design/drydock/astro/Text.astro`
// and `.../List.astro`; this module re-exports the plain helpers for pages.
export { DARK_MEDIA, fullSrc, imageMarkup, type ImageMarkup, type ImageMarkupOptions } from '../core/image.js';
export { createReader, itemAttrs, listAttrs, snapshotFromFiles, textAttrs } from '../core/read.js';
