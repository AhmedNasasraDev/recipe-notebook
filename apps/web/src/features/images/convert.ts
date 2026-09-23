/**
 * Turning whatever came off a phone into the one thing the bucket accepts.
 *
 * HANDOFF §5: "מגבלת גודל והמרה ל־WebP בהעלאה." Migration 0029 makes that a
 * precondition rather than a suggestion — the bucket's `allowed_mime_types` is
 * `{image/webp}` and its `file_size_limit` is 2 MB, so an upload that skipped
 * this module would be refused by the server. This module is what makes the
 * upload succeed, not what makes it safe.
 *
 * THREE THINGS IT DOES, IN ORDER OF HOW MUCH THEY MATTER
 *
 * 1. IT DROPS EXIF, and that is a privacy fix rather than a size one. A photo
 *    taken on a phone carries EXIF, and EXIF carries GPS: a picture of a tray
 *    of bread can publish the coordinates of the bakery. Re-encoding through a
 *    canvas produces a new file from pixels only — no EXIF survives it. This is
 *    a side effect of the format requirement, and it is the reason not to
 *    "helpfully" also accept the original JPEG.
 *
 *    It also drops the EXIF *orientation* flag, which is why the decode step
 *    must honour orientation before drawing. `createImageBitmap` with
 *    `imageOrientation: 'from-image'` does that; without it, a portrait photo
 *    from a phone arrives sideways and stays sideways forever.
 *
 * 2. It bounds the dimensions. A modern phone shoots 4032×3024, which is four
 *    times more pixels than any screen this app runs on will show.
 *
 * 3. It bounds the bytes, by lowering quality until the result fits — and
 *    REFUSES rather than uploading something that will be rejected. An upload
 *    that fails at the server with a 413 tells the user nothing useful.
 *
 * WHY THE DOM PARTS ARE INJECTED
 *
 * `createImageBitmap` and `canvas.toBlob` do not exist in jsdom, so a module
 * that called them directly could only be tested in a real browser — which
 * means, in practice, not tested. The decisions (what size, which quality, when
 * to give up) are pure functions, and the two browser calls arrive as
 * parameters with real defaults.
 */

/** §5's ceiling, and the bucket's. Keep the two in step. */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The longest edge we keep. 1600 covers a full-width photo on a 3× phone and
 * a large tablet; beyond that the extra pixels are never displayed.
 */
export const MAX_EDGE = 1600;

/**
 * Tried in order until one fits under MAX_BYTES. WebP at 0.82 is visually
 * indistinguishable from the original for a photograph; 0.5 is where a
 * pastry's surface starts to look smeared, so it is the floor.
 */
export const QUALITY_LADDER = [0.82, 0.7, 0.6, 0.5] as const;

/**
 * The largest ORIGINAL we will even decode. Decoding is where the memory goes —
 * a 100 MP image expands to hundreds of megabytes of bitmap before any of the
 * limits above apply — so this is checked before anything is decoded.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * The box to draw into: the image scaled so its longest edge is at most `max`,
 * and never scaled UP. A 400×300 photo stays 400×300 — enlarging it would add
 * bytes and no detail.
 */
export function targetSize(source: Dimensions, max = MAX_EDGE): Dimensions {
  const { width, height } = source;
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  // Round, then floor to at least 1: a 4000×3 panorama must not become ×0.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type ConvertFailure =
  | { ok: false; reason: 'not-an-image' }
  | { ok: false; reason: 'source-too-large'; bytes: number }
  | { ok: false; reason: 'undecodable' }
  | { ok: false; reason: 'still-too-large'; bytes: number };

export interface ConvertOk {
  ok: true;
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /** which rung of the ladder produced it, for the "we compressed this" note */
  quality: number;
}

export type ConvertResult = ConvertOk | ConvertFailure;

/** What a failure should say to a baker, in Hebrew, without jargon. */
export function convertErrorText(f: ConvertFailure): string {
  switch (f.reason) {
    case 'not-an-image':
      return 'הקובץ הזה אינו תמונה. אפשר להעלות JPG, PNG, HEIC או WebP.';
    case 'source-too-large':
      return `התמונה גדולה מדי לפתיחה (${Math.round(f.bytes / 1024 / 1024)} מ״ב). כדאי לצלם מחדש באיכות נמוכה יותר או להקטין אותה לפני ההעלאה.`;
    case 'undecodable':
      return 'לא הצלחנו לפתוח את התמונה. ייתכן שהפורמט אינו נתמך בדפדפן הזה — HEIC של אייפון לא נפתח בכל דפדפן.';
    case 'still-too-large':
      return 'גם אחרי דחיסה התמונה נשארה גדולה מהמותר. כדאי לחתוך אותה או לצלם מחדש.';
  }
}

/**
 * The size budget a conversion has to fit into.
 *
 * ADDED FOR AVATARS (migration 0031), and the reason is worth stating: the
 * `avatars` bucket takes 512 KB, not the recipe bucket's 2 MB, and 512 pixels
 * is plenty for a picture drawn at 40. Without this the caller's choices were
 * to duplicate the whole conversion for one different number — which is how a
 * second code path with different EXIF handling gets written — or to discover
 * the limit as a 400 from storage.
 *
 * The defaults are the recipe-photograph constants, so every existing caller
 * behaves exactly as before.
 */
export interface SizeLimits {
  maxBytes: number;
  maxEdge: number;
}

export const RECIPE_LIMITS: SizeLimits = { maxBytes: MAX_BYTES, maxEdge: MAX_EDGE };

/** The `avatars` bucket's own limit (0031), and a size an avatar is drawn at. */
export const AVATAR_LIMITS: SizeLimits = { maxBytes: 512 * 1024, maxEdge: 512 };

export interface ConvertDeps {
  /**
   * Decode to something drawable, honouring EXIF orientation. The default uses
   * `createImageBitmap`, which is where `imageOrientation: 'from-image'` lives.
   */
  decode(file: Blob): Promise<(ImageBitmap | HTMLImageElement) & Dimensions>;
  /** Draw at the given size and encode as WebP at the given quality. */
  encode(
    source: ImageBitmap | HTMLImageElement,
    size: Dimensions,
    quality: number,
  ): Promise<Blob | null>;
}

async function defaultDecode(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return bitmap as ImageBitmap & Dimensions;
}

async function defaultEncode(
  source: ImageBitmap | HTMLImageElement,
  size: Dimensions,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  /*
    White underneath. A PNG with transparency encoded straight to WebP keeps
    the alpha channel, and a transparent photo on the recipe page's paper
    background looks like a rendering bug rather than a choice.
  */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/webp', quality);
  });
}

/**
 * The whole conversion. Returns a result rather than throwing, because every
 * failure here is something the user can act on and therefore something the UI
 * has to be able to say.
 */
export async function convertToWebp(
  file: File | Blob,
  deps: Partial<ConvertDeps> = {},
  limits: SizeLimits = RECIPE_LIMITS,
): Promise<ConvertResult> {
  const type = file.type || '';
  /*
    An empty type is allowed through: some Android pickers hand over a File with
    `type: ''`, and refusing those would refuse real photographs. The decode
    step is the real filter — it fails on anything that is not an image.
  */
  if (type !== '' && !type.startsWith('image/')) {
    return { ok: false, reason: 'not-an-image' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, reason: 'source-too-large', bytes: file.size };
  }

  const decode = deps.decode ?? defaultDecode;
  const encode = deps.encode ?? defaultEncode;

  let source: (ImageBitmap | HTMLImageElement) & Dimensions;
  try {
    source = await decode(file);
  } catch {
    return { ok: false, reason: 'undecodable' };
  }
  if (!source.width || !source.height) return { ok: false, reason: 'undecodable' };

  const size = targetSize({ width: source.width, height: source.height }, limits.maxEdge);

  /*
    Down the ladder, keeping the SMALLEST result seen. Encoders are not strictly
    monotonic in quality — a lower setting can occasionally produce a slightly
    larger file — so "the last one" is not necessarily "the smallest one", and
    the error message should report the best we managed rather than the last.
  */
  let best: { blob: Blob; quality: number } | null = null;
  for (const quality of QUALITY_LADDER) {
    const blob = await encode(source, size, quality);
    if (!blob) continue;
    if (!best || blob.size < best.blob.size) best = { blob, quality };
    if (blob.size <= limits.maxBytes) {
      return {
        ok: true,
        blob,
        width: size.width,
        height: size.height,
        bytes: blob.size,
        quality,
      };
    }
  }

  if (!best) return { ok: false, reason: 'undecodable' };
  return { ok: false, reason: 'still-too-large', bytes: best.blob.size };
}

/**
 * Where the object goes: `{recipe_id}/{uuid}.webp`.
 *
 * The leading segment is not cosmetic — migration 0029's storage policies read
 * the recipe id out of it to decide access, so a path built any other way is
 * refused by the database. That is why this is a function and not a template
 * literal at a call site.
 */
export function imagePath(recipeId: string, id: string = crypto.randomUUID()): string {
  return `${recipeId}/${id}.webp`;
}
