// Hebrew-aware name normalisation, used for ingredient identity (B4).
// Deliberately conservative: it only removes noise that is definitely not
// semantic. It never strips words, so "קמח" and "קמח שקדים" stay different.

const GERESH = /[׳‘’'`´]/g; // ׳ ‘ ’ ' ` ´
const GERSHAYIM = /[״“”"]/g; // ״ “ ” "
const NIKUD = /[֑-ׇ]/g;
const DASHES = /[‐-―־]/g; // ‐ ‑ ‒ – — ― ־

/**
 * Canonical form of an ingredient name.
 * Collapses whitespace, unifies apostrophe/quote variants and dashes, strips
 * Hebrew diacritics, lowercases Latin letters. Word content is preserved.
 */
export function normalizeName(name: string | undefined | null): string {
  return (name ?? '')
    .replace(NIKUD, '')
    .replace(GERESH, "'")
    .replace(GERSHAYIM, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Stable identity for an ingredient.
 * Prefers an explicit key supplied by the host app (a catalog id, once one
 * exists); falls back to the normalised name. Never a substring.
 */
export function ingredientKeyOf(ing: {
  ingredientKey?: string;
  name?: string;
}): string {
  const explicit = (ing.ingredientKey ?? '').trim();
  if (explicit) return explicit;
  return normalizeName(ing.name);
}

/** Exact identity comparison. This is what replaces substring matching. */
export function sameIngredient(
  a: { ingredientKey?: string; name?: string },
  b: { ingredientKey?: string; name?: string },
): boolean {
  const ka = ingredientKeyOf(a);
  const kb = ingredientKeyOf(b);
  return ka !== '' && ka === kb;
}

export function num(v: unknown, fallback = 0): number {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** null-preserving numeric read: distinguishes "empty" from "zero". */
export function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
