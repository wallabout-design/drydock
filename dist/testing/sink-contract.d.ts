import type { Note, Sender, Sink } from '../server/feedback.js';
export declare const SAMPLE_NOTE: Note;
export declare const SAMPLE_SENDER: Sender;
export interface FakeSink extends Sink {
    /** Every note handed over, with its sender, in order. */
    readonly sent: {
        note: Note;
        sender: Sender;
    }[];
}
/** Keeps notes in memory. Pass `fail` to make every send return `{ ok: false, message }`. */
export declare function fakeSink(options?: {
    fail?: string;
}): FakeSink;
/**
 * What every sink keeps. `makeSink` makes a fresh sink for each test.
 * It cannot check where a note ends up; a sink's own tests do that.
 */
export declare function sinkContract(makeSink: () => Sink | Promise<Sink>): void;
