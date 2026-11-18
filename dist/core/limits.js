// The standard's limits (content-editing.md, "what a site declares" and "limits").
export const LIMITS = {
    text: { default: 200, max: 1000 },
    longtext: { default: 2000, max: 10000 },
    /** The most a keyed text may be given. */
    keyedText: 5000,
    link: 2000,
    alt: 200,
    maxItems: { default: 500, max: 5000 },
    fieldsPerList: 40,
    /** What an image field may declare, and the biggest original. */
    /**
     * A size is also made as AVIF only up to this many pixels. The images service answers WebP instead of
     * AVIF above a count between 1 and 2 million (measured for #39), so 1 million is always AVIF.
     */
    image: { minWidth: 16, maxWidth: 2400, widthsMax: 4, defaultWidths: [480, 960, 1600], sizes: 200, original: 12000, avifMaxPixels: 1_000_000 },
    /** One item as JSON, in bytes. */
    itemBytes: 16 * 1024,
};
