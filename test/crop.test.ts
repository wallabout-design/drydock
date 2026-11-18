import { describe, expect, it } from 'vitest';
import { checkCrop } from '../src/core/validate.js';
import type { ImageField } from '../src/core/types.js';
// @ts-expect-error The browser's form is plain JavaScript without types.
import { cropFits, largestSize, maxZoom, moveCrop, placeCrop } from '../src/editor/item-form.js';

// The crop the form sends must pass the server's own check, for any image and any zoom.
const ASPECTS = ['1:1', '3:2', '16:10', '4:3', '5:4', '21:9', '2:3', '9:16'];
const SIZES: [number, number][] = [[7, 5], [16, 9], [100, 100], [333, 1000], [1000, 333], [1201, 799], [4000, 3000], [12000, 40], [123, 457], [2400, 1600]];

describe('the item form crop', () => {
  for (const aspect of ASPECTS) {
    it(`is inside the image and the right shape at every zoom (${aspect})`, () => {
      const field = { name: 'photo', label: 'Photo', type: 'image', aspect } as ImageField;
      for (const [W, H] of SIZES) {
        const top = maxZoom(aspect, W, H);
        for (let step = 0; step <= 40; step++) {
          const zoom = 1 + ((top - 1) * step) / 40;
          for (const at of [undefined, { x: 0, y: 0 }, { x: W, y: H }, { x: W / 3, y: H / 7 }]) {
            const crop = placeCrop(aspect, W, H, zoom, at);
            if (crop === null) {
              expect(largestSize(aspect, W, H)).toBeNull();
              continue;
            }
            expect(checkCrop(field, crop, W, H)).toEqual({ crop });
            expect(cropFits(crop, aspect, W, H)).toBe(true);
            const moved = moveCrop(crop, W, H, -50, W * 2);
            expect(checkCrop(field, moved, W, H)).toEqual({ crop: moved });
          }
        }
      }
    });
  }

  it('starts at the largest size that fits, centred', () => {
    expect(placeCrop('1:1', 1000, 600, 1)).toEqual({ x: 200, y: 0, w: 600, h: 600 });
    expect(placeCrop('3:2', 900, 600, 1)).toEqual({ x: 0, y: 0, w: 900, h: 600 });
  });

  it('refuses a stored crop that no longer fits', () => {
    expect(cropFits({ x: 0, y: 0, w: 900, h: 600 }, '3:2', 800, 600)).toBe(false);
    expect(cropFits({ x: 0, y: 0, w: 900, h: 500 }, '3:2', 900, 600)).toBe(false);
  });
});
