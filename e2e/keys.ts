import type { Page } from '@playwright/test';

// The key that moves focus to the next control. WebKit on macOS follows the
// system's keyboard navigation setting: with it off (the default), Tab skips
// buttons and links, and Option+Tab reaches every control, as in Safari. The
// tests must not depend on that setting, so they press Option+Tab there.
export function nextControl(page: Page): Promise<void> {
  const webkitOnMac = page.context().browser()?.browserType().name() === 'webkit' && process.platform === 'darwin';
  return page.keyboard.press(webkitOnMac ? 'Alt+Tab' : 'Tab');
}
