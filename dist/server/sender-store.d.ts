export interface SenderEntry {
    /** The sink's reference for the note, such as the issue URL. */
    ref: string;
    email: string;
    /** The site's short ID. */
    site: string;
}
export interface SenderStore {
    /** Keeps the sender of the note `ref`, replacing an earlier entry for the same ref. */
    put(entry: SenderEntry): Promise<void>;
    /** The sender of the note `ref`, or null when none is kept (never stored, or past retention). */
    find(ref: string): Promise<{
        email: string;
    } | null>;
}
