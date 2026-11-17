import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// The editor in real browsers, against a small fixture site (e2e/server.mjs)
// that runs the built package (dist/) over the in-memory store. Run `npm run
// build` first; `npm run verify` does. One server per mode: changes go live on
// their own (auto), or wait for an admin (review).

// Two servers need two free ports in a row: the auto server on the base port,
// the review server on the next one. Without E2E_PORT_BASE, pick a free pair
// now, once, and set it, so the workers this run starts inherit the same one.
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
    if ((await free(port)) && (await free(port + 1))) return console.log(port);
  }
})();
`;
process.env.E2E_PORT_BASE ??= execFileSync(process.execPath, ['-e', FREE_PAIR_PROBE], { encoding: 'utf8' }).trim();

const AUTO = Number(process.env.E2E_PORT_BASE);
const REVIEW = AUTO + 1;

// CHROMIUM_PATH points Chromium at a browser already installed on the machine,
// for where `playwright install` can't download one.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
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
  ],
});
