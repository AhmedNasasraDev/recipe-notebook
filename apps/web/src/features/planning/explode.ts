// Sub-recipe explosion: from "100 cookies" down to flour, butter and sugar.
//
// THE RULE THAT SHAPES THIS FILE (requirement 3)
//
// A sub-recipe is NOT a purchasable material. "3 kg of dough" must never appear
// on a shopping list; the flour, butter and sugar inside it must. So a
// sub-recipe row is never emitted as a requirement — it is walked into, and
// only the leaves come out.
//
// WHY THERE IS NO SECOND CALCULATION HERE
//
// `compute(recipe, all, { factor })` already scales every row and already
// computes the nested sub-recipes. The only arithmetic below is the one the
// ENGINE ITSELF uses to relate a sub-recipe line to the base recipe:
//
//     k = grams of the sub used / the sub's own yield at factor 1
//
// That is `compute`'s own `k` (see the `countSubFormula` branch), reused rather
// than re-derived, so a change to how the engine prorates a sub-recipe cannot
// leave this file quietly disagreeing with the costs on the recipe screen.
//
// DOUBLE COUNTING, AND WHAT IT ACTUALLY MEANS HERE
//
// Two products sharing a sub-recipe must each contribute their own share — that
// is addition, not double counting. Double counting would be counting the
// dough AND its flour, which cannot happen because a sub-recipe row is not
// emitted. Both cases have tests.

import {
  ingredientKeyOf,
  type Computed,
  type ComputedRow,
  type IngredientLike,
  type MeasurementPrefs,
  type Recipe,
} from '@recipe-notebook/engine';
import { scaleFor, type PlanItem, type Scaled } from './plan.js';

/** One material the plan needs, aggregated across every product in it. */
export interface Requirement {
  /** the identity the catalog and the recipes share — never the display string */
  key: string;
  /** what to call it on screen: the name of the first row that contributed */
  name: string;
  /** total grams needed, across the whole plan */
  grams: number;
  /** a row that contributed, so a per-item or per-litre conversion can be tried */
  sample: IngredientLike;
  /** which products in the plan need it */
  products: string[];
  /**
   * True when at least one contribution could NOT be weighed, so `grams` is
   * real but incomplete. Not the same as a requirement of zero.
   */
  partial: boolean;
}

export interface Explosion {
  lines: Requirement[];
  /** plan lines that produced nothing usable, with the reason */
  problems: Array<{ product: string; why: string }>;
  /** names of rows that could not be weighed anywhere in the plan */
  unresolved: string[];
  /** true when any product could not be scaled or any row could not be weighed */
  partial: boolean;
}

/** Per plan line, what the scale worked out to. Kept for the screen to show. */
export interface ScaledItem {
  item: PlanItem;
  scaled: Scaled;
  /** the recipe at the plan's factor. null when there is no factor */
  computed: Computed | null;
}

export function scaleItems(
  items: readonly PlanItem[],
  recipes: readonly Recipe[],
  prefs: MeasurementPrefs | undefined,
  computeAt: (recipe: Recipe, factor: number) => Computed,
): ScaledItem[] {
  return items.map((item) => {
    const scaled = scaleFor(item, recipes, prefs);
    const computed =
      scaled.recipe && scaled.factor !== null
        ? computeAt(scaled.recipe, scaled.factor)
        : null;
    return { item, scaled, computed };
  });
}

/**
 * Walks one computed recipe and adds every LEAF row to the accumulator.
 *
 * `k` is the factor already applied to the rows being walked. A sub-recipe's
 * rows were computed at factor 1 (that is what `compute` stores in
 * `row.sub`), so they are scaled here by the share actually used.
 */
function walk(
  rows: readonly ComputedRow[],
  k: number,
  product: string,
  acc: Map<string, Requirement>,
  unresolved: Set<string>,
): void {
  for (const row of rows) {
    const name = String(row.ing.name ?? '');

    if (row.ing.subId) {
      // A sub-recipe line. NOT a material, whether or not it resolved.
      if (!row.sub || row.g === null) {
        unresolved.add(name || 'תת־מתכון לא מקושר');
        continue;
      }
      const subYield = row.sub.actualYield || row.sub.totalG;
      if (!subYield) {
        // The base recipe yields nothing measurable, so the share of it that
        // this line uses cannot be worked out. Refused, not guessed.
        unresolved.add(name);
        continue;
      }
      walk(row.sub.rows, (row.g * k) / subYield, product, acc, unresolved);
      continue;
    }

    if (row.g === null) {
      unresolved.add(name);
      continue;
    }

    const key = row.ing.ingredientKey ?? ingredientKeyOf(row.ing);
    if (!key) {
      unresolved.add(name || 'שורה בלי שם');
      continue;
    }

    const hit = acc.get(key);
    if (hit) {
      hit.grams += row.g * k;
      if (!hit.products.includes(product)) hit.products.push(product);
    } else {
      acc.set(key, {
        key,
        name: name || key,
        grams: row.g * k,
        sample: row.ing,
        products: [product],
        partial: false,
      });
    }
  }
}

/** The whole plan, reduced to the materials it needs. */
export function explode(scaled: readonly ScaledItem[]): Explosion {
  const acc = new Map<string, Requirement>();
  const problems: Array<{ product: string; why: string }> = [];
  const unresolved = new Set<string>();

  for (const s of scaled) {
    const product = String(s.scaled.recipe?.name ?? 'מוצר ללא שם');
    if (!s.computed || s.scaled.factor === null) {
      problems.push({ product, why: s.scaled.why || 'אי אפשר לחשב את הכמות.' });
      continue;
    }
    walk(s.computed.rows, 1, product, acc, unresolved);
  }

  const lines = [...acc.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const partial = problems.length > 0 || unresolved.size > 0;
  // A material whose own name is among the unresolved rows carries a real but
  // incomplete quantity — it was weighable in one recipe and not in another.
  for (const line of lines) if (unresolved.has(line.name)) line.partial = true;

  return { lines, problems, unresolved: [...unresolved], partial };
}
