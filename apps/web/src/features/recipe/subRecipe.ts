// Which recipes may be linked as a sub-recipe, and why the rest may not.
//
// THE AUTHORITY IS THE DATABASE. Migration 0007 puts a trigger on
// `ingredients` that refuses a self-reference, a cross-account link and any
// cycle, and that is what actually protects the data — a client check can be
// bypassed by anyone willing to call PostgREST directly.
//
// This exists for two other reasons:
//
//   1. A picker that only offers valid choices is better than one that offers
//      everything and reports a database error afterwards.
//   2. When a choice IS invalid, the reason belongs next to it. "הקישור הזה
//      יוצר מעגל" is useful; a raised 23514 is not.
//
// So this deliberately duplicates the trigger's logic. The duplication is the
// point, and the two are tested against each other: the SQL against the live
// database, this against the same cases.
//
// Requirement 12 — "the picker shows only recipes the user is allowed to see" —
// needs nothing special here, and that is worth stating. The candidate list is
// the notebook the repository already loaded, and that list is RLS-filtered at
// source. There is no code path that could offer someone else's recipe, because
// the client never has one.

import type { IngredientLike, Recipe } from '@recipe-notebook/engine';

export type SubRecipeRejection = 'self' | 'cycle' | 'missing';

export interface SubRecipeOption {
  id: string;
  name: string;
  /** true when this recipe is marked as a base recipe (§1.1 `isSub`) */
  isSub: boolean;
  /** null when it may be linked; otherwise why not */
  rejection: SubRecipeRejection | null;
  /** the reason, for the UI */
  reason: string;
}

const REASONS: Record<SubRecipeRejection, string> = {
  self: 'מתכון אינו יכול להכיל את עצמו',
  cycle: 'הקישור הזה יוצר מעגל בין מתכונים',
  missing: 'המתכון הזה אינו במחברת',
};

/**
 * Every recipe reachable from `startId` by following sub-recipe links.
 *
 * `seen` is what makes this terminate on a graph that already contains a cycle
 * — which can happen, because a cycle can be created by deleting and
 * recreating recipes even though no single link was ever accepted as one.
 */
export function reachableFrom(
  startId: string,
  recipes: readonly Recipe[],
): Set<string> {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const stack = [startId];

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const recipe = byId.get(id);
    if (!recipe) continue;
    for (const ing of recipe.ingredients ?? []) {
      const sub = (ing as IngredientLike).subId;
      if (sub) stack.push(String(sub));
    }
  }
  return seen;
}

/**
 * Would linking `candidateId` into `parentId` close a loop?
 *
 * Mirrors the trigger: walk forward from the candidate and see whether the
 * parent is reachable. Catches A → A, A → B → A, and chains of any depth.
 */
export function wouldCreateCycle(
  parentId: string,
  candidateId: string,
  recipes: readonly Recipe[],
): boolean {
  if (parentId === candidateId) return true;
  return reachableFrom(candidateId, recipes).has(parentId);
}

export interface SubRecipeOptionsInput {
  /** the recipe being edited; '' for one that does not exist yet */
  parentId: string;
  /** the notebook — already RLS-filtered to this account (requirement 12) */
  recipes: readonly Recipe[];
  /**
   * The draft's current sub-links, so a cycle through a link the user just
   * added in this editing session is caught too. Without this, the check would
   * only see what is saved, and two unsaved links could close a loop that only
   * the database would then refuse.
   */
  pendingLinks?: ReadonlyArray<{ parentId: string; subId: string }>;
}

/**
 * The picker's options, every one annotated with whether it may be chosen.
 *
 * A recipe that would create a CYCLE is returned, marked and disabled, with the
 * reason attached: it is a recipe the user may well be looking for, and
 * silently omitting it reads as a bug.
 *
 * The recipe being edited is the one exception — it is left out entirely. A
 * disabled "cannot contain itself" row is noise in a list nobody scans looking
 * for the thing they are already editing. `rejectSubRecipe` still reports it,
 * for the defensive path where an id arrives from somewhere other than the
 * picker.
 */
export function subRecipeOptions({
  parentId,
  recipes,
  pendingLinks = [],
}: SubRecipeOptionsInput): SubRecipeOption[] {
  // Fold the unsaved links into a copy of the graph, so the walk sees the
  // state the user is actually building.
  const graph: Recipe[] = recipes.map((r) => {
    const extra = pendingLinks.filter((l) => l.parentId === r.id);
    if (extra.length === 0) return r;
    return {
      ...r,
      ingredients: [
        ...(r.ingredients ?? []),
        ...extra.map((l) => ({ name: '', qty: 0, unit: 'g', subId: l.subId })),
      ],
    };
  });

  return recipes
    .filter((r) => !parentId || r.id !== parentId)
    .map((r) => {
      const rejection: SubRecipeRejection | null =
        parentId && wouldCreateCycle(parentId, r.id, graph) ? 'cycle' : null;

      return {
        id: r.id,
        name: String(r.name ?? ''),
        isSub: r.isSub === true,
        rejection,
        reason: rejection ? REASONS[rejection] : '',
      };
    })
    // Base recipes first — they are what someone is usually looking for —
    // then alphabetically, and unavailable ones last within each group.
    .sort((a, b) => {
      if (a.rejection !== null && b.rejection === null) return 1;
      if (a.rejection === null && b.rejection !== null) return -1;
      if (a.isSub !== b.isSub) return a.isSub ? -1 : 1;
      return a.name.localeCompare(b.name, 'he');
    });
}

/**
 * Validates one proposed link, for the message shown on a rejected choice.
 * Returns null when the link is fine.
 */
export function rejectSubRecipe(
  parentId: string,
  candidateId: string,
  recipes: readonly Recipe[],
): string | null {
  if (!candidateId) return null;
  if (parentId && candidateId === parentId) return REASONS.self;
  if (!recipes.some((r) => r.id === candidateId)) {
    // Either the recipe was deleted, or the id belongs to another account and
    // is therefore not in this RLS-filtered list. The message is the same
    // because the difference is not the user's business — and requirement 15
    // is enforced by the database regardless of what this says.
    return REASONS.missing;
  }
  if (parentId && wouldCreateCycle(parentId, candidateId, recipes)) return REASONS.cycle;
  return null;
}
