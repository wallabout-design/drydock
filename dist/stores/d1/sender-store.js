/** Rows older than this are not returned and are deleted by `purge` (standards drydock.md). */
export const SENDER_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
export function d1SenderStore(db, options = {}) {
    const now = options.now ?? (() => new Date());
    const cutoff = () => new Date(now().getTime() - SENDER_RETENTION_DAYS * DAY_MS).toISOString();
    return {
        async put({ ref, email, site }) {
            await db
                .prepare('INSERT OR REPLACE INTO feedback_senders (ref, email, site, created_at) VALUES (?, ?, ?, ?)')
                .bind(ref, email, site, now().toISOString())
                .all();
        },
        async find(ref) {
            const { results } = await db
                .prepare('SELECT email FROM feedback_senders WHERE ref = ? AND created_at >= ?')
                .bind(ref, cutoff())
                .all();
            return results[0] ? { email: results[0].email } : null;
        },
        async purge() {
            const [result] = await db.batch([db.prepare('DELETE FROM feedback_senders WHERE created_at < ?').bind(cutoff())]);
            return result?.meta?.changes ?? 0;
        },
    };
}
