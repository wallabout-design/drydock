import { defineConfig, devices } from '@playwright/test';

// The editor in real browsers, against a small fixture site (e2e/server.mjs)
// that runs the built package (dist/) over the in-memory store. Run `npm run
// build` first; `npm run verify` does. One server per mode: changes go live on
// their own (auto), or wait for an admin (review).
const AUTO = 4811;
const REVIEW = 4812;

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
  webServer: [
    { command: `node e2e/server.mjs ${AUTO} auto`, url: `http://127.0.0.1:${AUTO}/__test/state`, reuseExistingServer: false },
    { command: `node e2e/server.mjs ${REVIEW} review`, url: `http://127.0.0.1:${REVIEW}/__test/state`, reuseExistingServer: false },
  ],
});
