// The ingredient centre, on the client side (stage-7 requirements 1-5).
//
// WHERE THE TRUTH LIVES, AND WHY THERE IS A RESOLUTION STEP AT ALL
//
// Requirement 2 says a price must not be re-entered in every recipe: change
// butter in the centre and every recipe that uses butter follows. Requirement 5
// says a historical version must keep its historical meaning. Taken together
// those look contradictory, and the instructions say so. They are not, once the
// two objects are told apart:
//
//   a LIVE recipe   stores no price for a material it inherits. It resolves the
//                   price from the catalog every time it is read, so the centre
//                   is the only place a price exists and a change moves
//                   everything at once.
//   a VERSION       is not a recipe. §9 made it a frozen document, and
//                   `recipe_snapshot` (migration 0011) now freezes the price it
//                   used into it — the same act as freezing the quantities it
//                   used. "This cost ₪18.40 in March" stays true in June.
//
// A snapshot is therefore not a second source of truth about today's price. It
// is not about today. That is the whole resolution, and it needs no reconciling
// mechanism, no cache and no denormalised copy in the live rows.
//
// `ingredients.price` STILL EXISTS and is still authoritative for the row that
// has one. It is the override: a row with a price of its own keeps it, which is
// how every price entered before stage 7 survives untouched — no migration, so
// nothing to lose, and in particular no explicit 0 quietly turned into
// "missing" and no missing price quietly turned into 0.
//
// So a row's price comes from, in order:
//   1. the row's own `price` — an override, including an explicit 0
//   2. the catalog entry for its `ingredientKey`
//   3. nothing, and the cost is reported as incomplete rather than as 0

import {
  allergensFor,
  ingredientKeyOf,
  type IngredientLike,
  type Recipe,
} from '@recipe-notebook/engine';
import type { PriceUnit, PurchaseUnit } from '../../lib/database.types.js';

export interface CatalogItem {
  id: string;
  /** the stable identity a recipe row refers to (`ingredients.ingredient_key`) */
  key: string;
  name: string;
  purchaseUnit: PurchaseUnit;
  /** how much is in ONE package. null = unknown, and then there is no price */
  packageQty: number | null;
  /** how many packages were bought. 6 packs of 500 g is 6 */
  packageCount: number;
  /** what the WHOLE purchase cost. null = unpriced. 0 = free. NOT the same */
  purchaseTotal: number | null;
  /**
   * usable share after cleaning, in percent. null = no yield declared, and
   * then the usable cost is the purchase cost. null is NOT 0%.
   */
  usablePct: number | null;
  supplier: string;
  /** the date of the purchase, as the user entered it */
  purchasedAt: string | null;
  /** when the package last changed — not when the row was last touched */
  priceUpdatedAt: string | null;
  note: string;
  /** DERIVED by the database, read-only here. null when it cannot be computed */
  purchasePrice: number | null;
  price: number | null;
  priceUnit: PriceUnit | null;
  allergens: string[];
}

/** What the user is asked for, per purchase unit. */
export const PURCHASE_UNITS: ReadonlyArray<{
  id: PurchaseUnit;
  /** how the amount in the package is labelled */
  qtyLabel: string;
  /** what the derived price ends up being per */
  per: PriceUnit;
}> = [
  { id: 'kg', qtyLabel: 'ק"ג באריזה', per: 'ק"ג' },
  { id: 'g', qtyLabel: 'גרם באריזה', per: 'ק"ג' },
  { id: 'l', qtyLabel: 'ליטר באריזה', per: 'ליטר' },
  { id: 'ml', qtyLabel: 'מ"ל באריזה', per: 'ליטר' },
  { id: 'unit', qtyLabel: 'יחידות באריזה', per: "יח'" },
];

export const purchaseUnitLabel = (u: PurchaseUnit): string =>
  ({ kg: 'ק"ג', g: 'גרם', l: 'ליטר', ml: 'מ"ל', unit: "יח'" })[u];

/**
 * The per-base-unit price, computed the same way the database computes it.
 *
 * This is a MIRROR of the generated columns in migration 0013, and the
 * duplication is deliberate and narrow: the form has to show the resulting
 * ₪/kg while the user is still typing, before anything is saved. The database
 * remains the authority — `CatalogItem.price` is always the stored generated
 * value, never this — and `catalog.test.ts` pins the two against the same
 * cases so they cannot drift.
 *
 * `purchase` is the cost per base unit AS BOUGHT; `price` is the cost per
 * USABLE base unit. With no declared yield they are the same number, because
 * "no yield declared" means nothing is known to be lost — not that nothing is
 * usable.
 *
 * Returns null, never 0, when it cannot be computed. An unpriced material has
 * no price; it is not free.
 */
export function basePriceOf(item: {
  purchaseUnit: PurchaseUnit;
  packageQty: number | null;
  packageCount?: number | null;
  purchaseTotal: number | null;
  usablePct?: number | null;
}): { purchase: number; price: number; unit: PriceUnit } | null {
  const { purchaseUnit, packageQty, purchaseTotal } = item;
  const count = item.packageCount ?? 1;
  if (purchaseTotal === null || packageQty === null) return null;
  if (packageQty <= 0 || count <= 0) return null;

  const usable = item.usablePct ?? 100;
  // 0% usable means nothing comes out, so there is no usable cost to state;
  // above 100% means the cleaning created matter. Both are refused rather
  // than turned into a number.
  if (usable <= 0 || usable > 100) return null;

  const base = baseQtyOf(purchaseUnit, count, packageQty);
  if (base === null || base <= 0) return null;

  const purchase = purchaseTotal / base;
  return {
    purchase,
    price: purchase / (usable / 100),
    unit: perUnitOf(purchaseUnit),
  };
}

/** The total bought, normalised to the base unit: kilograms, litres or items. */
export function baseQtyOf(
  unit: PurchaseUnit,
  count: number,
  qty: number,
): number | null {
  switch (unit) {
    case 'kg':
    case 'l':
    case 'unit':
      return count * qty;
    case 'g':
    case 'ml':
      return (count * qty) / 1000;
  }
}

const perUnitOf = (u: PurchaseUnit): PriceUnit =>
  u === 'kg' || u === 'g' ? 'ק"ג' : u === 'l' || u === 'ml' ? 'ליטר' : "יח'";

/**
 * The scales a price is worth showing at (requirement B).
 *
 * Every entry is the SAME number rendered at a different scale, derived here
 * and stored nowhere, so ₪/kg, ₪/100g and ₪/g cannot disagree with each other
 * or with the receipt.
 *
 * Only meaningful conversions appear. A price per item has exactly one scale —
 * "₪0.13 per 100 eggs" is not a smaller egg, it is nonsense — and a litre is
 * never converted to a kilogram, because that needs a density this function
 * does not have and must not invent.
 */
export function conversionsOf(
  price: number,
  unit: PriceUnit,
): Array<{ label: string; value: number }> {
  switch (unit) {
    case 'ק"ג':
      return [
        { label: 'ק"ג', value: price },
        { label: '100 גר\'', value: price / 10 },
        { label: 'גרם', value: price / 1000 },
      ];
    case 'ליטר':
      return [
        { label: 'ליטר', value: price },
        { label: '100 מ"ל', value: price / 10 },
        { label: 'מ"ל', value: price / 1000 },
      ];
    case "יח'":
      return [{ label: "יח'", value: price }];
  }
}

/** Does this row carry a price of its own? An explicit 0 does. */
export function hasOwnPrice(ing: IngredientLike): boolean {
  const p = ing.price;
  return p !== undefined && p !== null && p !== '' && Number.isFinite(Number(p));
}

export type PriceOrigin = 'own' | 'catalog' | 'none';

/** Where a row's price came from, for the editor to show. */
export function priceOriginOf(
  ing: IngredientLike,
  byKey: ReadonlyMap<string, CatalogItem>,
): PriceOrigin {
  // A sub-recipe line has no price of its own by design (§18.6) and must not
  // inherit one either — its cost comes from the base recipe.
  if (ing.subId) return 'none';
  if (hasOwnPrice(ing)) return 'own';
  const hit = byKey.get(ingredientKeyOf(ing));
  return hit && hit.price !== null ? 'catalog' : 'none';
}

export const catalogByKey = (
  items: readonly CatalogItem[],
): Map<string, CatalogItem> => new Map(items.map((i) => [i.key, i]));

/**
 * The recipe as the engine should see it: prices and declared allergens filled
 * in from the centre.
 *
 * Called before EVERY `compute()` on a live recipe, so that the figures on the
 * screen are the ones the current prices produce. It is idempotent — a row
 * that already has a price is left alone — which is what lets a version
 * snapshot (already frozen, so every price filled) pass through it unchanged
 * and be compared against a live recipe on equal terms.
 *
 * It does NOT touch density. The catalog has had a `g_per_100` column since
 * 0003 and it stays unused: §5.1 defines a ranked density chain (the recipe's
 * own value, then the user's calibration, then the professional table) that is
 * proved and tested, and inserting a fourth rank into it is a decision about
 * provenance, not a pricing feature. The centre SHOWS the density state and
 * offers calibration instead of holding a fourth copy of it.
 */
export function resolveFromCatalog(
  recipe: Recipe,
  items: readonly CatalogItem[],
): Recipe {
  if (items.length === 0) return recipe;
  const byKey = catalogByKey(items);

  let touched = false;
  const declared = new Set<string>();

  const ingredients = (recipe.ingredients ?? []).map((ing) => {
    const hit = byKey.get(ingredientKeyOf(ing));
    if (hit) for (const a of hit.allergens) declared.add(a);

    if (ing.subId || hasOwnPrice(ing) || !hit || hit.price === null) return ing;

    touched = true;
    return { ...ing, price: hit.price, priceUnit: hit.priceUnit ?? 'ק"ג' };
  });

  // Allergens declared on a material are unioned into the recipe's manual
  // list, which is the field `compute()` already reads. Name inference stays
  // as the fallback for a material that is not in the centre, so this adds
  // knowledge and removes none.
  const manual = new Set(recipe.manualAllergens ?? []);
  const before = manual.size;
  for (const a of declared) manual.add(a);

  if (!touched && manual.size === before) return recipe;
  return { ...recipe, ingredients, manualAllergens: [...manual] };
}

/**
 * Which materials in this recipe have no price from anywhere.
 *
 * Used by the recipe page to say what to go and price, which
 * `calcState.unpricedNames` cannot do on its own: it reports names, and the
 * action is "open the centre and price this key".
 */
export function unpricedKeys(
  recipe: Recipe,
  items: readonly CatalogItem[],
): Array<{ key: string; name: string; inCentre: boolean }> {
  const byKey = catalogByKey(items);
  const out = new Map<string, { key: string; name: string; inCentre: boolean }>();

  for (const ing of recipe.ingredients ?? []) {
    if (ing.subId || hasOwnPrice(ing)) continue;
    const key = ingredientKeyOf(ing);
    if (!key) continue;
    const hit = byKey.get(key);
    if (hit && hit.price !== null) continue;
    out.set(key, { key, name: String(ing.name ?? key), inCentre: hit !== undefined });
  }
  return [...out.values()];
}

/**
 * The allergens a material would contribute on its own, for the centre to
 * suggest. Derived from the engine's own name table, so the centre agrees with
 * what a recipe would have inferred anyway.
 */
export const suggestedAllergens = (name: string): string[] => allergensFor(name);
