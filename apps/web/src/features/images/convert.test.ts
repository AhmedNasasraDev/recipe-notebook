// Image conversion.
//
// The two browser calls are injected, so what is tested here is the judgement:
// what size to draw at, when to stop lowering quality, and what to refuse.
//
// The decisive tests are the refusals. An upload that fails at the server with
// a 413 tells a baker nothing, and a photo that silently uploads at 0.3 quality
// looks like a broken camera.

import { describe, expect, it, vi } from 'vitest';
import {
  AVATAR_LIMITS,
  MAX_BYTES,
  MAX_EDGE,
  RECIPE_LIMITS,
  MAX_SOURCE_BYTES,
  QUALITY_LADDER,
  convertErrorText,
  convertToWebp,
  imagePath,
  targetSize,
  type ConvertDeps,
  type ConvertFailure,
} from './convert.js';

/** A decode/encode pair whose output size is whatever the test says. */
function deps(opts: {
  width?: number;
  height?: number;
  /** bytes produced per quality rung; the default fits on the first */
  sizeFor?(quality: number): number;
  decodeThrows?: boolean;
  encodeReturnsNull?: boolean;
  onEncode?(quality: number, size: { width: number; height: number }): void;
}): ConvertDeps {
  return {
    decode: async () => {
      if (opts.decodeThrows) throw new Error('nope');
      return {
        width: opts.width ?? 800,
        height: opts.height ?? 600,
      } as unknown as ImageBitmap & { width: number; height: number };
    },
    encode: async (_src, size, quality) => {
      opts.onEncode?.(quality, size);
      if (opts.encodeReturnsNull) return null;
      const bytes = opts.sizeFor ? opts.sizeFor(quality) : 1000;
      return new Blob([new Uint8Array(bytes)], { type: 'image/webp' });
    },
  };
}

const file = (bytes = 1000, type = 'image/jpeg') =>
  new File([new Uint8Array(bytes)], 'photo.jpg', { type });

describe('targetSize', () => {
  it('leaves a small image alone rather than enlarging it', () => {
    // Scaling up adds bytes and no detail.
    expect(targetSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });

  it('bounds the LONGEST edge, whichever it is', () => {
    expect(targetSize({ width: 4032, height: 3024 })).toEqual({ width: 1600, height: 1200 });
    // portrait, the way a phone actually holds it
    expect(targetSize({ width: 3024, height: 4032 })).toEqual({ width: 1200, height: 1600 });
  });

  it('keeps the aspect ratio', () => {
    const t = targetSize({ width: 3000, height: 2000 });
    expect(t.width / t.height).toBeCloseTo(1.5, 3);
  });

  it('never rounds a dimension down to zero', () => {
    // A 4000×3 panorama scales to 1600×1.2, and 0 pixels tall is not an image.
    expect(targetSize({ width: 4000, height: 3 })).toEqual({ width: 1600, height: 1 });
  });

  it('is defensive about a zero-sized source', () => {
    expect(targetSize({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });

  it('treats exactly MAX_EDGE as already small enough', () => {
    expect(targetSize({ width: MAX_EDGE, height: 900 })).toEqual({
      width: MAX_EDGE,
      height: 900,
    });
  });
});

describe('converting', () => {
  it('encodes at the top quality when that already fits', async () => {
    const seen: number[] = [];
    const r = await convertToWebp(
      file(),
      deps({ onEncode: (q) => seen.push(q) }),
    );
    expect(r.ok).toBe(true);
    // One attempt, not four: it stops as soon as the result fits.
    expect(seen).toEqual([QUALITY_LADDER[0]]);
    if (r.ok) expect(r.quality).toBe(QUALITY_LADDER[0]);
  });

  it('reports the dimensions it actually drew at', async () => {
    const r = await convertToWebp(file(), deps({ width: 4032, height: 3024 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.width).toBe(1600);
      expect(r.height).toBe(1200);
    }
  });

  it('walks DOWN the quality ladder until the result fits', async () => {
    const seen: number[] = [];
    const r = await convertToWebp(
      file(),
      deps({
        onEncode: (q) => seen.push(q),
        // only the third rung gets under the cap
        sizeFor: (q) => (q <= 0.6 ? 1000 : MAX_BYTES + 1),
      }),
    );
    expect(seen).toEqual([0.82, 0.7, 0.6]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quality).toBe(0.6);
  });

  it('refuses rather than uploading something the server would reject', async () => {
    const r = await convertToWebp(
      file(),
      deps({ sizeFor: () => MAX_BYTES + 5000 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('still-too-large');
      expect(convertErrorText(r)).toMatch(/גם אחרי דחיסה/);
    }
  });

  it('reports the SMALLEST size it managed, not the last one it tried', async () => {
    /*
      Encoders are not strictly monotonic in quality — a lower setting can
      produce a slightly larger file. The message should not claim a worse
      number than the one actually achieved.
    */
    const r = await convertToWebp(
      file(),
      deps({
        sizeFor: (q) =>
          q === 0.7 ? MAX_BYTES + 100 : q === 0.5 ? MAX_BYTES + 9999 : MAX_BYTES + 5000,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'still-too-large') {
      expect(r.bytes).toBe(MAX_BYTES + 100);
    }
  });

  it('tries every rung before giving up', async () => {
    const seen: number[] = [];
    await convertToWebp(
      file(),
      deps({ onEncode: (q) => seen.push(q), sizeFor: () => MAX_BYTES + 1 }),
    );
    expect(seen).toEqual([...QUALITY_LADDER]);
  });
});

describe('what it refuses, and what it says', () => {
  it('refuses a non-image by its type', async () => {
    const pdf = new File([new Uint8Array(10)], 'x.pdf', { type: 'application/pdf' });
    const r = await convertToWebp(pdf, deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-an-image');
  });

  it('ALLOWS an empty type through to the decoder', async () => {
    // Some Android pickers hand over `type: ''`. Refusing those would refuse
    // real photographs; the decode step is the real filter.
    const unknown = new File([new Uint8Array(10)], 'photo', { type: '' });
    const r = await convertToWebp(unknown, deps({}));
    expect(r.ok).toBe(true);
  });

  it('refuses a source too big to decode, BEFORE decoding it', async () => {
    const decode = vi.fn();
    const r = await convertToWebp(file(MAX_SOURCE_BYTES + 1), {
      decode: decode as unknown as ConvertDeps['decode'],
      encode: async () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('source-too-large');
    // The point of the check is not to hold a 200 MB bitmap in memory.
    expect(decode).not.toHaveBeenCalled();
  });

  it('says HEIC might be the problem when the decode fails', async () => {
    const r = await convertToWebp(file(), deps({ decodeThrows: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('undecodable');
      expect(convertErrorText(r)).toMatch(/HEIC/);
    }
  });

  it('treats a zero-dimension decode as undecodable', async () => {
    const r = await convertToWebp(file(), deps({ width: 0, height: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('undecodable');
  });

  it('treats an encoder that produces nothing as undecodable, not as too large', async () => {
    const r = await convertToWebp(file(), deps({ encodeReturnsNull: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('undecodable');
  });

  it('every failure has a message that names something the user can do', () => {
    const reasons: ConvertFailure[] = [
      { ok: false, reason: 'not-an-image' },
      { ok: false, reason: 'source-too-large', bytes: 40 * 1024 * 1024 },
      { ok: false, reason: 'undecodable' },
      { ok: false, reason: 'still-too-large', bytes: MAX_BYTES + 1 },
    ];
    for (const r of reasons) {
      const text = convertErrorText(r);
      expect(text.length).toBeGreaterThan(20);
      // No English, no error codes, no "something went wrong".
      expect(text).not.toMatch(/[A-Za-z]{6,}/);
    }
  });
});

describe('the storage path', () => {
  it('puts the recipe id first, because a policy reads it from there', () => {
    // Migration 0029: `path_recipe_id` takes the first segment. A path built
    // any other way is refused by the database.
    expect(imagePath('a0000000-0000-4000-8000-00000000e001', 'abc')).toBe(
      'a0000000-0000-4000-8000-00000000e001/abc.webp',
    );
  });

  it('always ends .webp, which is the only type the bucket accepts', () => {
    expect(imagePath('r', 'x')).toMatch(/\.webp$/);
  });
});

describe('the size budget is per bucket, not per module', () => {
  /*
    Added with the avatars bucket (migration 0031), which takes 512 KB where
    the recipe bucket takes 2 MB. The alternative was a second conversion
    function for one different number — which is how a second code path with
    different EXIF handling gets written — or discovering the limit as a 400
    from storage.
  */
  it('defaults to the recipe photograph limits, so every old caller is unchanged', () => {
    expect(RECIPE_LIMITS).toEqual({ maxBytes: MAX_BYTES, maxEdge: MAX_EDGE });
  });

  it('bounds an avatar at 512 pixels rather than 1600', async () => {
    const sizes: Array<{ width: number; height: number }> = [];
    const r = await convertToWebp(
      file(),
      deps({ width: 4032, height: 3024, onEncode: (_q, size) => sizes.push(size) }),
      AVATAR_LIMITS,
    );
    expect(r.ok).toBe(true);
    expect(sizes[0]).toEqual({ width: 512, height: 384 });
  });

  it('refuses an avatar that will not fit in 512 KB, even though it would fit 2 MB', async () => {
    // 700 KB is comfortably under the recipe limit and over the avatar one.
    const bytes = 700 * 1024;
    const asRecipe = await convertToWebp(file(), deps({ sizeFor: () => bytes }));
    expect(asRecipe.ok).toBe(true);

    const asAvatar = await convertToWebp(file(), deps({ sizeFor: () => bytes }), AVATAR_LIMITS);
    expect(asAvatar).toEqual({ ok: false, reason: 'still-too-large', bytes });
  });

  it('walks the same ladder for an avatar, and stops at the first rung that fits', async () => {
    const seen: number[] = [];
    const r = await convertToWebp(
      file(),
      deps({
        onEncode: (q) => seen.push(q),
        // only the third rung gets under 512 KB
        sizeFor: (q) => (q > 0.65 ? 600 * 1024 : 400 * 1024),
      }),
      AVATAR_LIMITS,
    );
    expect(r.ok).toBe(true);
    expect(seen).toEqual([0.82, 0.7, 0.6]);
  });
});
