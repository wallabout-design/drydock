// The addresses of the fixture servers. playwright.config.ts sets E2E_PORT_BASE
// once per run (before any test file loads), so the runner and its workers agree
// on it. The auto server (in-memory store) listens on the base port, the review
// server on the next one, the feedback fixture server on the one after, the auto
// server on the D1 store after that, and the auto server on the git store last.
const base = Number(process.env.E2E_PORT_BASE);
if (!Number.isInteger(base)) throw new Error('E2E_PORT_BASE is not set: run the browser tests through playwright.config.ts');

export const AUTO = `http://127.0.0.1:${base}`;
export const REVIEW = `http://127.0.0.1:${base + 1}`;
export const FEEDBACK = `http://127.0.0.1:${base + 2}`;
export const D1 = `http://127.0.0.1:${base + 3}`;
export const GIT = `http://127.0.0.1:${base + 4}`;
