export declare const LIMITS: {
    readonly text: {
        readonly default: 200;
        readonly max: 1000;
    };
    readonly longtext: {
        readonly default: 2000;
        readonly max: 10000;
    };
    /** The most a keyed text may be given. */
    readonly keyedText: 5000;
    readonly link: 2000;
    readonly alt: 200;
    readonly maxItems: {
        readonly default: 500;
        readonly max: 5000;
    };
    readonly fieldsPerList: 40;
    /** What an image field may declare, and the biggest original. */
    readonly image: {
        readonly minWidth: 16;
        readonly maxWidth: 2400;
        readonly widthsMax: 4;
        readonly defaultWidths: readonly [480, 960, 1600];
        readonly sizes: 200;
        readonly original: 12000;
    };
    /** One item as JSON, in bytes. */
    readonly itemBytes: number;
};
