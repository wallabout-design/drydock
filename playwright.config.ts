import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// The editor in real browsers, against a small fixture site (e2e/server.mjs)
// that runs the built package (dist/) over the in-memory store. Run `npm run
// build` first; `npm run verify` does. One server per mode: changes go live on
// their own (auto), or wait for an admin (review). A third, static server
// (e2e/feedback-server.mjs) serves the feedback link's fixture pages.

// Five servers need five free ports in a row: the auto server on the base port,
// the review server on the next one, the feedback server on the one after, and
// the auto servers on the D1 and git stores after that (ports.ts). Without
// E2E_PORT_BASE, pick a free run now, once, and set it, so the workers this run
// starts inherit the same one.
// Two runs at once (in two worktrees) then never share a port.
const FREE_PAIR_PROBE = `
const net = require('node:net');
const free = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});
(async () => {
  for (;;) {
    const port = 49152 + Math.floor(Math.random() * 15000);
    if ((await free(port)) && (await free(port + 1)) && (await free(port + 2)) && (await free(port + 3)) && (await free(port + 4))) return console.log(port);
  }
})();
`;
process.env.E2E_PORT_BASE ??= execFileSync(process.execPath, ['-e', FREE_PAIR_PROBE], { encoding: 'utf8' }).trim();

const AUTO = Number(process.env.E2E_PORT_BASE);
const REVIEW = AUTO + 1;
const FEEDBACK = AUTO + 2;
const D1 = AUTO + 3;
const GIT = AUTO + 4;

// CHROMIUM_PATH points Chromium at a browser already installed on the machine,
// for where `playwright install` can't download one.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/display-awake.ts',
  // The two servers hold state that every test resets, so tests run one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${AUTO}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Playwright stops these servers when the run ends, including when it fails or is interrupted.
  webServer: [
    { command: `node e2e/server.mjs ${AUTO} auto`, url: `http://127.0.0.1:${AUTO}/__test/state`, reuseExistingServer: false },
    { command: `node e2e/server.mjs ${REVIEW} review`, url: `http://127.0.0.1:${REVIEW}/__test/state`, reuseExistingServer: false },
    { command: `node e2e/feedback-server.mjs ${FEEDBACK}`, url: `http://127.0.0.1:${FEEDBACK}/e2e/feedback-fixture/index.html`, reuseExistingServer: false },
    { command: `node e2e/server.mjs ${D1} auto d1`, url: `http://127.0.0.1:${D1}/__test/state`, reuseExistingServer: false },
    { command: `node e2e/server.mjs ${GIT} auto git`, url: `http://127.0.0.1:${GIT}/__test/state`, reuseExistingServer: false },
  ],
});
