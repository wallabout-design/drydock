// Where a note's sender is kept after the sink returns, so the feedback routine can
// reply to them (standards drydock.md, "feedback delivery as plugins"). A plain
// interface a site passes in; `d1SenderStore` is the built-in one, and every
// implementation passes `senderStoreContract` from `@wallabout-design/drydock/testing`.
// The address is personal data: an implementation keeps nothing else about the sender,
// returns it only from `find`, and never logs it.
export {};
