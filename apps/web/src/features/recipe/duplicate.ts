// Duplicating a recipe.
//
// The mechanical part is trivial. The part worth thinking about is what a copy
// must NOT inherit, because a duplicate that carries the original's history is
// worse than no duplicate at all:
//
//   locked      §9 — "נוסחה מאושרת לייצור" is an approval of ONE formula. A copy
//               has not been approved, and §18.7 blocks editing while locked,
//               so inheriting it would also produce a copy nobody can change.
//   versions    §9 — version history belongs to the recipe it happened to.
//   trials      §13 — a trial log is a record of what was actually baked.
//   batches     §13a — production batches with HACCP records. Copying these
//               would fabricate food-safety records, which is the most serious
//               thing in this file.
//   versionOf /
//   versionNote §9 — a copy is a new recipe, not a version of anything.
//   savedFrom   §11 — provenance of a group copy, not of this one.
//   createdAt   the database sets it.
//   id          the database sets it.
//
// What a copy DOES inherit: the formula. Ingredients, steps, yield, pricing
// target, the texts, the tags, the category, and the `issues` list — the
// troubleshooting notes are knowledge about the formula, not a record of a
// production run, so they travel with it.
//
// `privateNotes` is deliberately NOT copied: §8 keeps private notes separate
// from the recipe, and a note written about one bake is not about another.
//
// The original is never touched. Everything here builds a new object.

import type { Recipe } from '@recipe-notebook/engine';

/** Appends a copy marker, and counts up rather than stacking markers. */
export function copyName(name: string, existing: readonly string[] = []): string {
  const base = name.trim() || 'מתכון';
  // "לחם (עותק)" duplicated again becomes "לחם (עותק 2)", not "לחם (עותק) (עותק)".
  const stripped = base.replace(/\s*\(עותק(?:\s+\d+)?\)\s*$/u, '');
  const taken = new Set(existing.map((n) => n.trim()));

  const first = `${stripped} (עותק)`;
  if (!taken.has(first)) return first;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${stripped} (עותק ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return first;
}

export interface DuplicateOptions {
  /** names already in the notebook, so the copy gets a distinct one */
  existingNames?: readonly string[];
}

/**
 * A new recipe carrying the original's formula and none of its history.
 *
 * The returned recipe has an `id` starting with `new-`, which is the signal
 * `SupabaseRepository.saveRecipe` uses to INSERT rather than UPDATE. The
 * original object is not mutated.
 */
export function duplicateRecipe(
  original: Recipe,
  { existingNames = [] }: DuplicateOptions = {},
): Recipe {
  const copy: Recipe = {
    ...original,
    id: `new-copy-${Date.now().toString(36)}`,
    name: copyName(String(original.name ?? ''), existingNames),

    // not approved
    locked: false,

    // not a version of anything
    versionOf: null,
    versionNote: '',
    savedFrom: null,

    // the database owns this
    createdAt: undefined,

    // deep-copied so editing the copy cannot reach back into the original
    tags: [...(original.tags ?? [])],
    manualAllergens: [...(original.manualAllergens ?? [])],
    ingredients: (original.ingredients ?? []).map((i) => ({ ...i })),
    steps: (original.steps ?? []).map((s) => ({ ...s })),
    issues: (original.issues ?? []).map((i) => ({ ...i })),
    pan: original.pan ? { ...original.pan } : null,
  };

  // History and production records do not travel. Deleting rather than setting
  // them to [] keeps the recipe shape identical to a freshly created one.
  delete copy.versions;
  delete copy.trials;
  delete copy.batches;
  delete copy.privateNotes;

  return copy;
}
