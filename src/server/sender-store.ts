// Where a note's sender is kept after the sink returns, so the feedback routine can
// reply to them (standards drydock.md, "feedback delivery as plugins"). A plain
// interface a site passes in; `d1SenderStore` is the built-in one, and every
// implementation passes `senderStoreContract` from `@wallabout-design/drydock/testing`.
// The address is personal data: an implementation keeps nothing else about the sender,
// returns it only from `find`, and never logs it.

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
  find(ref: string): Promise<{ email: string } | null>;
}
