// The addresses of the two fixture servers. playwright.config.ts sets
// E2E_PORT_BASE once per run (before any test file loads), so the runner and
// its workers agree on it. The auto server listens on the base port, the review
// server on the next one, the feedback fixture server on the one after.
const base = Number(process.env.E2E_PORT_BASE);
if (!Number.isInteger(base)) throw new Error('E2E_PORT_BASE is not set: run the browser tests through playwright.config.ts');

export const AUTO = `http://127.0.0.1:${base}`;
export const REVIEW = `http://127.0.0.1:${base + 1}`;
export const FEEDBACK = `http://127.0.0.1:${base + 2}`;
