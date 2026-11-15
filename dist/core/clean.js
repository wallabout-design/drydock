// Turning what a person typed into plain text. Ported and merged from the
// three trial sites: wallabout.design (worker/copy-edit/rules.ts), Rutland
// Reserve (app/lib/copy.ts, cleanCopy) and album-guide (collections/validate.ts).
// Escapes are written \u{...} so every pattern needs the `u` flag.
// Every format character (zero-width characters, the word joiner, soft hyphens,
// direction marks, embeddings, overrides and isolates, byte order marks, tag
// characters) is removed, so a text can't show nothing, render reversed or
// hide a word from a rule. The zero-width joiner is kept only between emoji.
const FORMAT = /(?!(?<=\p{Extended_Pictographic}\u{FE0F}?)\u{200D}(?=\p{Extended_Pictographic}))\p{Cf}/gu;
// Variation selectors are dropped except one after an emoji.
const SELECTORS = /(\p{Emoji})?([\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]+)/gu;
const keepSelector = (_, emoji, selectors) => emoji ? emoji + ([...selectors].find((c) => c === '\u{FE0E}' || c === '\u{FE0F}') ?? '') : '';
// Characters that look like a space: the Hangul fillers and the blank braille pattern.
const BLANK_LOOKING = /[\u{115F}\u{1160}\u{2800}\u{3164}\u{FFA0}]/gu;
// Control characters other than tab and line feed, and the line and paragraph separators.
const CONTROL = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu;
/** Something a reader can see: a letter, number, punctuation or symbol. */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
/** More than four combining marks in a row. */
const STACKED_MARKS = /\p{M}{5,}/u;
/** Anything that could start a tag, comment or doctype. */
const MARKUP = /<\s*[A-Za-z/!?]/;
/** Length as a person counts it: characters, not UTF-16 units. */
export const lengthOf = (text) => [...text].length;
export const hasVisible = (text) => VISIBLE.test(text);
export const hasStackedMarks = (text) => STACKED_MARKS.test(text);
export const hasMarkup = (text) => MARKUP.test(text);
function strip(raw) {
    return raw
        .normalize('NFC')
        .replace(FORMAT, '')
        .replace(SELECTORS, keepSelector)
        .replace(BLANK_LOOKING, ' ')
        .replace(CONTROL, ' ');
}
/** Plain text on one line: every kind of space and break becomes one space, none at the ends. */
export function cleanLine(raw) {
    return strip(raw).replace(/[\p{Z}\s]+/gu, ' ').trim();
}
/** Plain text with line breaks kept: at most one blank line in a row, no trailing spaces. */
export function cleanLines(raw) {
    return strip(raw.replace(/\r\n?/g, '\n'))
        .replace(/[^\S\n]+/gu, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
