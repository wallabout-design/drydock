/** Length as a person counts it: characters, not UTF-16 units. */
export declare const lengthOf: (text: string) => number;
export declare const hasVisible: (text: string) => boolean;
export declare const hasStackedMarks: (text: string) => boolean;
export declare const hasMarkup: (text: string) => boolean;
/** Plain text on one line: every kind of space and break becomes one space, none at the ends. */
export declare function cleanLine(raw: string): string;
/** Plain text with line breaks kept: at most one blank line in a row, no trailing spaces. */
export declare function cleanLines(raw: string): string;
