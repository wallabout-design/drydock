import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The "./dock" entry point is what sites import. It must resolve to the index, and the index
// must export staffStatus. JSON keeps the last of two duplicate keys, so the count checks the raw text.
const pkgText = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const pkg = JSON.parse(pkgText) as { exports: Record<string, { default: string }> };

describe('the ./dock package entry', () => {
  it('is defined once in package.json', () => {
    expect(pkgText.match(/"\.\/dock":/g)).toHaveLength(1);
  });

  it('resolves to the dock index', () => {
    expect(pkg.exports['./dock'].default).toBe('./dist/dock/index.js');
  });

  it('exports staffStatus', async () => {
    const dock = await import(new URL(`../${pkg.exports['./dock'].default}`, import.meta.url).href);
    expect(typeof dock.staffStatus).toBe('function');
    expect(await dock.staffStatus({ storage: { getItem: () => null } })).toBeNull();
  });
});
