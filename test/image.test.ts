import { describe, expect, it } from 'vitest';
import { DeclarationError, defineContent, imageSources, type Field, type ImageField, type ImageUpload } from '../src/index.js';

const title: Field = { name: 'title', label: 'Title', type: 'text', required: true };
const declare = (image: Record<string, unknown>) =>
  defineContent({
    lists: [{ name: 'shots', label: 'shots', singular: 'shot', titleField: 'title', sort: 'hand', fields: [title, { name: 'pic', label: 'Picture', type: 'image', ...image } as Field] }],
  });
const bad = (image: Record<string, unknown>, message: RegExp) => {
  let error: unknown;
  try {
    declare(image);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(DeclarationError);
  expect((error as Error).message).toMatch(message);
};
const check = (image: Record<string, unknown>, pic: unknown) => declare(image).validateItem('shots', { title: 'A', pic });
const kinds = (r: { problems: { kind: string }[] }) => r.problems.map((p) => p.kind);

const KEY = '2026/11/abcdefghijklmnopqrstuv';
const upload = (over: Record<string, unknown> = {}) => ({ key: KEY, alt: 'A screenshot', width: 2000, height: 1000, ...over });

describe('image field settings', () => {
  it('accepts every setting', () => {
    expect(() => declare({ aspect: '16:10', widths: [400, 800, 1200, 1760], sizes: '(min-width: 800px) 400px, 100vw', full: 2400, minWidth: 1200 })).not.toThrow();
    expect(() => declare({})).not.toThrow();
  });
  it('refuses a bad aspect', () => {
    for (const aspect of ['1', '1:0', '0:1', 'wide', '1:1:1', '16/10', 5, '1000:1']) bad({ aspect }, /aspect must be/);
  });
  it('refuses bad widths', () => {
    for (const widths of [[], [1, 2, 3, 4, 5], [15], [2401], [480, 480], [960, 480], [480.5], ['480'], 480]) bad({ widths }, /widths must/);
  });
  it('refuses bad sizes', () => {
    for (const sizes of ['', '  ', 'x'.repeat(201), 5]) bad({ sizes }, /sizes must be/);
  });
  it('refuses a bad full, or one not wider than the widest width', () => {
    for (const full of [0, 2401, 1.5, '2000']) bad({ full }, /full must be a whole number/);
    bad({ full: 1600 }, /wider than the widest of widths \(1600\)/);
    bad({ widths: [400, 800], full: 800 }, /wider than the widest of widths \(800\)/);
    expect(() => declare({ widths: [400, 800], full: 801 })).not.toThrow();
  });
  it('refuses a bad minWidth', () => {
    for (const minWidth of [0, 12001, 1.5, '800']) bad({ minWidth }, /minWidth must be/);
  });
  it('names every mistake', () => {
    try {
      declare({ aspect: 'x', widths: [], sizes: '', minWidth: 0 });
    } catch (e) {
      expect((e as DeclarationError).problems).toHaveLength(4);
    }
  });
});

describe('an uploaded image value', () => {
  it('takes an upload without a crop, and keeps only its own properties', () => {
    expect(check({}, upload({ extra: 1 })).values.pic).toEqual({ key: KEY, alt: 'A screenshot', width: 2000, height: 1000 });
  });
  it('takes an upload with a crop', () => {
    const crop = { x: 100, y: 0, w: 1000, h: 1000 };
    expect(check({ aspect: '1:1' }, upload({ crop })).values.pic).toEqual({ key: KEY, alt: 'A screenshot', width: 2000, height: 1000, crop });
    expect(check({}, upload({ crop })).ok).toBe(true);
  });
  it('needs a crop when the field has an aspect', () => {
    expect(check({ aspect: '1:1' }, upload()).problems).toMatchObject([{ field: 'pic', kind: 'empty' }]);
  });
  it('refuses a crop outside the image', () => {
    for (const crop of [{ x: 1500, y: 0, w: 1000, h: 1000 }, { x: -1, y: 0, w: 1000, h: 1000 }, { x: 0, y: 1, w: 1000, h: 1000 }, { x: 0, y: 0, w: 2001, h: 1000 }]) {
      expect(kinds(check({}, upload({ crop }))), JSON.stringify(crop)).toEqual(['range']);
    }
  });
  it('refuses a crop of the wrong shape, and allows 1% either way', () => {
    expect(kinds(check({ aspect: '1:1' }, upload({ crop: { x: 0, y: 0, w: 1000, h: 800 } })))).toEqual(['range']);
    expect(check({ aspect: '1:1' }, upload({ crop: { x: 0, y: 0, w: 1000, h: 991 } })).ok).toBe(true);
    expect(kinds(check({ aspect: '1:1' }, upload({ crop: { x: 0, y: 0, w: 1000, h: 980 } })))).toEqual(['range']);
    expect(check({ aspect: '16:10' }, upload({ crop: { x: 0, y: 0, w: 1600, h: 1000 } })).ok).toBe(true);
  });
  it('refuses a value with both key and src', () => {
    expect(kinds(check({}, { ...upload(), src: '/a.jpg' }))).toEqual(['format']);
  });
  it('refuses a bad key, size or crop shape', () => {
    for (const over of [{ key: 'a/b/c' }, { key: '2026/13/abcdefghijklmnopqrstuv' }, { key: '2026/11/short' }, { key: `2026/11/${'a'.repeat(33)}` }, { key: '2026/11/abcdefghijklmnopqrstu!' }, { key: 5 }, { width: 0 }, { width: 12001 }, { height: 1.5 }, { height: '10' }, { crop: 'all' }, { crop: { x: 0, y: 0, w: 0, h: 10 } }, { crop: { x: 0.5, y: 0, w: 10, h: 10 } }, { crop: { x: 0, y: 0, w: 10 } }]) {
      expect(kinds(check({}, upload(over))), JSON.stringify(over)).toEqual(['format']);
    }
  });
  it('keeps the alt text rules', () => {
    expect(check({}, upload({ alt: '' })).problems).toMatchObject([{ field: 'pic.alt', kind: 'empty' }]);
    expect(kinds(check({}, upload({ alt: '<b>x</b>' })))).toEqual(['markup']);
    expect(check({ decorative: true }, upload({ alt: 'ignored' })).values.pic).toEqual({ key: KEY, alt: '', width: 2000, height: 1000 });
  });
  it('still takes an address value', () => {
    expect(check({ aspect: '1:1' }, { src: '/a.jpg', alt: 'x' }).values.pic).toEqual({ src: '/a.jpg', alt: 'x' });
  });
});

describe('imageSources', () => {
  const field = (over: Partial<ImageField> = {}): ImageField => ({ name: 'pic', label: 'Picture', type: 'image', ...over });
  const value = (over: Partial<ImageUpload> = {}): ImageUpload => ({ key: KEY, alt: 'x', width: 3000, height: 1500, ...over });

  it('gives an address value back unchanged', () => {
    expect(imageSources(field(), { src: '/a.jpg', alt: 'x' })).toEqual({ src: '/a.jpg' });
  });
  it('makes one address per default width for a big original', () => {
    const s = imageSources(field(), value());
    expect(s.srcset).toBe(`/media/${KEY}/whole/480.webp 480w, /media/${KEY}/whole/960.webp 960w, /media/${KEY}/whole/1600.webp 1600w`);
    expect(s.src).toBe(`/media/${KEY}/whole/960.webp`);
    expect(s.sizes).toBe('100vw');
    expect([s.width, s.height]).toEqual([1600, 800]);
    expect(s.full).toBeUndefined();
  });
  it('names the crop in each address and uses its shape', () => {
    const s = imageSources(field({ widths: [200, 400], sizes: '215px' }), value({ crop: { x: 10, y: 20, w: 900, h: 900 } }), { prefix: 'https://cdn.example.com/m/' });
    expect(s.srcset).toBe(`https://cdn.example.com/m/${KEY}/c10-20-900-900/200.webp 200w, https://cdn.example.com/m/${KEY}/c10-20-900-900/400.webp 400w`);
    expect(s.sizes).toBe('215px');
    expect([s.width, s.height]).toEqual([400, 400]);
  });
  it('never enlarges: a 225 px original gets one address at 225', () => {
    const s = imageSources(field({ aspect: '1:1', widths: [300, 600] }), value({ width: 225, height: 225, crop: { x: 0, y: 0, w: 225, h: 225 } }));
    expect(s.srcset).toBe(`/media/${KEY}/c0-0-225-225/225.webp 225w`);
    expect(s.src).toBe(`/media/${KEY}/c0-0-225-225/225.webp`);
    expect([s.width, s.height]).toEqual([225, 225]);
    expect(imageSources(field(), value({ width: 225, height: 100 })).srcset).toBe(`/media/${KEY}/whole/225.webp 225w`);
  });
  it('adds the crop width when it falls between declared widths', () => {
    expect(imageSources(field(), value({ width: 700, height: 350 })).srcset).toBe(`/media/${KEY}/whole/480.webp 480w, /media/${KEY}/whole/700.webp 700w`);
  });
  it('does not repeat a width that equals the original', () => {
    expect(imageSources(field({ widths: [480, 960] }), value({ width: 960, height: 480 })).srcset).toBe(`/media/${KEY}/whole/480.webp 480w, /media/${KEY}/whole/960.webp 960w`);
  });
  it('gives full only when the image is wider than every declared width, and never wider than the image', () => {
    const f = field({ widths: [400], full: 1760 });
    expect(imageSources(f, value({ width: 3000 })).full).toBe(`/media/${KEY}/whole/1760.webp`);
    expect(imageSources(f, value({ width: 1200, height: 600 })).full).toBe(`/media/${KEY}/whole/1200.webp`);
    expect(imageSources(f, value({ width: 400, height: 200 })).full).toBeUndefined();
    expect(imageSources(f, value({ width: 300, height: 150 })).full).toBeUndefined();
    expect(imageSources(field({ widths: [400] }), value()).full).toBeUndefined();
  });
});
