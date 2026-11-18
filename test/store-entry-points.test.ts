import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { d1Store } from '../src/stores/d1/index.js';
import { gitStore } from '../src/stores/git/index.js';

const imports = (dir: string): string[] =>
  readdirSync(new URL(dir, import.meta.url))
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => readFileSync(new URL(`${dir}${f}`, import.meta.url), 'utf8').match(/from '[^']+'/g) ?? []);

describe('store entry points', () => {
  it('each store loads from its own entry point', () => {
    expect(typeof d1Store).toBe('function');
    expect(typeof gitStore).toBe('function');
  });

  it('the D1 store never imports from the git store', () => {
    expect(imports('../src/stores/d1/').filter((i) => i.includes('/git/'))).toEqual([]);
  });

  it('the git store never imports from the D1 store', () => {
    expect(imports('../src/stores/git/').filter((i) => i.includes('/d1/'))).toEqual([]);
  });
});
