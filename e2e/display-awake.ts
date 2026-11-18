// Global setup: keep a Mac's display awake while the tests run (rr#131, editor#52).
//
// Playwright's WebKit on macOS places synthetic mouse events wrongly while the
// display is asleep: a click sent to (954, 696) arrives at (-135, 1859), on
// <html>, so Playwright reports "<html> intercepts pointer events" and retries
// until the test times out. Every WebKit page breaks at once when the display
// turns off (2 minutes idle on a maintainer's Mac) and recovers when it turns back on,
// which is why long local runs failed in waves and looked like load. Chromium
// and Linux (CI) are not affected.
//
// `caffeinate -u` turns the display on if it is off and declares the user
// active; `-d` keeps the display from idling off; `-w` ends it with this run.
import { spawn } from 'node:child_process';

export default function displayAwake() {
  if (process.platform !== 'darwin') return;
  const child = spawn('caffeinate', ['-d', '-u', '-w', String(process.pid)], { stdio: 'ignore' });
  child.on('error', () => {}); // no caffeinate: run anyway
  child.unref();
  return () => {
    child.kill();
  };
}
