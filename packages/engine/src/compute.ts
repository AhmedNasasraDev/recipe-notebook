// Recipe computation — ported from engine.js:68 (compute).
//
// The professional content is unchanged: yield, production loss, baking loss,
// scale weight, cost per unit and per kilo, target food cost, baker's
// percentages, raw and net hydration, the three-temperature water rule,
// allergens, recursive sub-recipes and the sub-recipe cycle guard.
//
// What changed:
//   • B1 — it takes `prefs` and resolves every unit through the one conversion
//     path, so the user's measuring-tool sizes reach the ingredient table, the
//     yield, the costs, the hydration and everything downstream.
//   • An ingredient whose weight cannot be established is reported in
//     `unresolved` instead of being silently valued at 150 g per cup.
//   • Assumptions that used to be invisible (a per-litre price with no known
//     density, an unrecognised liquid treated as 100% water) are collected in
//     `warnings`.

import type {
  Computed,
  ComputedRow,
  ComputeOptions,
  IngredientLike,
  Recipe,
  Unresolved,
} from './types.js';
import { toGrams } from './convert.js';
import { densityFor } from './density.js';
import { gramsPerItem } from './convert.js';
import { allergensFor } from './data/allergens.js';
import { lookupWaterPct } from './data/water.js';
import { num, numOrNull } from './text.js';
import { unavailableProvenance } from './provenance.js';

/** Water percentage for an ingredient: the recipe's own value wins. */
export function waterPctOf(ing: IngredientLike): {
  waterPct: number;
  assumed: boolean;
} {
  const own = numOrNull(ing.waterPct);
  if (own !== null) return { waterPct: own, assumed: false };
  return lookupWaterPct(ing.name);
}

export function compute(
  recipe: Recipe,
  recipes: readonly Recipe[],
  options: ComputeOptions = {},
  seen: ReadonlySet<string> = new Set(),
): Computed {
  const prefs = options.prefs;
  const rawFactor = options.factor;
  const f =
    !rawFactor || !Number.isFinite(rawFactor) || rawFactor <= 0 ? 1 : rawFactor;

  if (seen.has(recipe.id)) {
    return {
      ...emptyComputed(f),
      error: 'מעגל תת־מתכונים',
    };
  }
  const next = new Set(seen);
  next.add(recipe.id);

  let totalG = 0;
  let cost = 0;
  let flour = 0;
  let liquid = 0;
  let water = 0;
  const unresolved: Unresolved[] = [];
  const warnings: string[] = [];

  const rows: ComputedRow[] = (recipe.ingredients ?? []).map((ing) => {
    const base = toGrams(ing, prefs);
    const g = base.grams === null ? null : base.grams * f;

    if (g === null) {
      unresolved.push({
        ingredientId: ing.id,
        name: ing.name ?? '',
        unit: ing.unit ?? '',
        reason: base.provenance.why,
      });
      return {
        ing,
        g: null,
        provenance: base.provenance,
        cost: 0,
        bakerPct: 0,
        sub: null,
        // Nothing was weighed, so nothing could be priced.
        priced: false,
      };
    }

    let lineCost = 0;
    let subInfo: Computed | null = null;
    /**
     * Was this row's own price actually APPLIED to produce `lineCost`?
     *
     * The primitive the presentation layer could not derive for itself. "This
     * row carries a price" and "this row's cost is real" are different facts
     * once a price can fail to apply — a per-item price with no item weight is
     * the case that forced it — and a caller that reads only `ing.price`
     * reports a finished cost for a row that contributed nothing.
     *
     * Deliberately narrow: false for a sub-recipe line, which has no price of
     * its own by design (§18.6) and whose cost comes from the base recipe.
     */
    let priced = false;

    if (ing.subId) {
      const sub = recipes.find((r) => r.id === ing.subId);
      if (sub) {
        const s = compute(sub, recipes, { factor: 1, prefs }, next);
        const subYield = s.actualYield || s.totalG || 1;
        lineCost = (s.cost / subYield) * g;
        subInfo = s;
        if (s.error) warnings.push(`${ing.name}: ${s.error}`);
        for (const w of s.warnings) warnings.push(w);
        if (ing.countSubFormula) {
          const k = g / subYield;
          flour += s.flour * k;
          liquid += s.liquid * k;
          water += (s.water || 0) * k;
        }
      } else {
        warnings.push(`${ing.name}: מתכון הבסיס המקושר לא נמצא.`);
      }
    } else if (ing.price !== '' && ing.price != null) {
      const p = num(ing.price, 0);
      if (ing.priceUnit === 'ליטר') {
        const d = densityFor(ing, prefs, 'ml');
        const gPer100 = d ? d.gPer100 : 100;
        if (!d) {
          warnings.push(
            `${ing.name}: מחיר לליטר בלי נתון צפיפות. העלות חושבה לפי 1.0 גר'/מ"ל, כמו בפרוטוטייפ.`,
          );
        }
        lineCost = (g / (gPer100 / 100) / 1000) * p;
        priced = true;
      } else if (ing.priceUnit === "יח'") {
        // STAGE 7. This branch did not exist: a price in `יח'` fell through to
        // the per-kilogram formula below, so three eggs at ₪1.30 each were
        // costed at ₪0.21 instead of ₪3.90 — silently, and reachable straight
        // from the editor's price-unit picker.
        //
        // Pricing per item needs the weight of one item, which is why
        // `gramsPerItem` is now exported rather than private to convert.ts.
        const per = gramsPerItem(ing);
        if (per === null || per <= 0) {
          // NOT costed at zero. An unknown item weight means the price cannot
          // be applied, and saying so is the only honest answer — costing it at
          // nothing is the "₪0 means free" failure one layer down.
          warnings.push(
            `${ing.name}: מחיר ליחידה בלי משקל ליחידה, ולכן אי אפשר לחשב את העלות של השורה הזאת.`,
          );
        } else {
          lineCost = (g / per) * p;
          priced = true;
        }
      } else if (ing.priceUnit === 'ק"ג' || ing.priceUnit === 'kg') {
        lineCost = (g / 1000) * p;
        priced = true;
      } else if (p === 0) {
        // Given away: nothing to convert, so no unit is needed to cost it.
        lineCost = 0;
        priced = true;
      } else {
        // QA 22.09.2026, finding 5: a price with NO unit used to be costed
        // per kilogram without a word. Whether ₪4 is per kilo, per litre or
        // per piece changes the answer by orders of magnitude, so the line is
        // left unpriced and the gap is named — the editor refuses to save it.
        warnings.push(
          `${ing.name}: הוזן מחיר בלי יחידת מחיר (ק"ג / ליטר / יח'), ולכן השורה לא תומחרה.`,
        );
      }
    }

    if (ing.flour) flour += g;
    if (ing.liquid) {
      liquid += g;
      const w = waterPctOf(ing);
      water += (g * w.waterPct) / 100;
      if (w.assumed) {
        warnings.push(
          `${ing.name}: אין נתון אחוז מים, חושב כ-100% מים (ברירת מחדל מהפרוטוטייפ).`,
        );
      }
    }

    totalG += g;
    cost += lineCost;

    return {
      ing,
      g,
      provenance: base.provenance,
      cost: lineCost,
      bakerPct: 0,
      sub: subInfo,
      priced,
    };
  });

  const theoretical = totalG;
  const yieldActual = numOrNull(recipe.yieldActual);
  const actualYield = yieldActual !== null ? yieldActual * f : theoretical;
  const prodLoss = theoretical
    ? ((theoretical - actualYield) / theoretical) * 100
    : 0;
  /*
    STAGE-11 DEFECT FIX. This read the two weights with `num(..., 0)` and then
    `bakeLoss = wb ? ((wb - wa) / wb) * 100 : 0`, so a recipe with only the
    BEFORE weight filled in — which is what a half-finished entry looks like —
    was read as a 100% bake loss, and `scaleWeight` then divided by
    `1 - 100/100` and came out **Infinity**. Unreachable while no form asked
    for the weights; reachable the moment one did.

    A loss needs the pair. One weight is not a measurement of anything, so it
    is treated as "not measured", which in this arithmetic means no loss is
    applied. The screen says so in words instead of printing 0%.
  */
  const wbEntered = numOrNull(recipe.weightBefore);
  const waEntered = numOrNull(recipe.weightAfter);
  const wb = wbEntered !== null && waEntered !== null && wbEntered > 0 ? wbEntered : 0;
  const wa = wb ? waEntered! : 0;
  const bakeLoss = wb ? ((wb - wa) / wb) * 100 : 0;
  const unitW = num(recipe.unitWeight, 0);
  // A loss of 100% or more would divide by zero or flip the sign. It can only
  // come from weights that contradict each other (after ≥ before is a gain, not
  // a loss), and the honest answer to a contradiction is no figure at all.
  const scaleWeight = unitW && bakeLoss < 100 ? unitW / (1 - bakeLoss / 100) : 0;
  /*
    DECLARED UNITS ARE THE BASELINE (QA 22.09.2026, finding 3).

    This used to be `actualYield / scaleWeight` whenever a unit weight was
    known, so a recipe that SAID "12 units × 85 g" but whose lines added up to
    1,083 g was taken to make 11.24 units — and "make 6" became ×0.53 rather
    than half. The count the maker wrote down is the recipe's own statement of
    its yield; the weights are a check on it (`unitsFromWeight`, surfaced as a
    warning), and they replace it only when the finished batch was actually
    weighed (`yieldActual`), or when no count was declared at all.
  */
  const unitsDeclared = num(recipe.yieldUnits, 0) * f;
  const unitsFromWeight = scaleWeight ? actualYield / scaleWeight : 0;
  const unitsActual =
    yieldActual !== null && unitsFromWeight
      ? unitsFromWeight
      : unitsDeclared || unitsFromWeight;
  const costPerUnit = unitsActual ? cost / unitsActual : 0;
  const costPerKg = actualYield ? (cost / actualYield) * 1000 : 0;
  const fc = num(recipe.targetFC, 0);
  const price = fc ? costPerUnit / (fc / 100) : 0;
  const hydration = flour ? (liquid / flour) * 100 : 0;
  const trueHydration = flour ? (water / flour) * 100 : 0;
  const waterTemp = recipe.doughMode
    ? 3 * num(recipe.ddt, 0) -
      num(recipe.flourTemp, 0) -
      num(recipe.roomTemp, 0) -
      num(recipe.friction, 0)
    : null;
  const unitsWarn =
    !!unitsDeclared &&
    !!unitsFromWeight &&
    Math.abs(unitsFromWeight - unitsDeclared) / unitsDeclared > 0.05;

  /*
    ALLERGENS, AND WHY THIS WALKS `sub.allergens` AND NOT ONLY `sub.rows`

    Two sources feed the set: names recognised by the allergen table, and
    `manualAllergens` — what the maker declared BY HAND because no name gives
    it away ("this praline is made on a line that also runs hazelnut").

    Until stage 11 the walk collected recognised NAMES recursively but read
    `manualAllergens` only from the top-level recipe. A base recipe's
    hand-declared allergen therefore stopped at the base recipe and never
    reached the cake that used it. The defect hid behind a coincidence: a base
    called "פרלינה" resolved to nuts through its NAME, so the common case
    looked right and only a base with a neutral name exposed it.

    It was found while building the product label (§2 screen 8), which is the
    one place in the app where a missing allergen is not a display bug. Reading
    `sub.allergens` — which each sub-recipe's own computation has already
    assembled, its manual declarations included — makes the roll-up complete at
    any depth. `packages/engine/test/compute.test.ts` holds it.
  */
  const allergenSet = new Set(recipe.manualAllergens ?? []);
  const collect = (rs: ComputedRow[]): void => {
    for (const r of rs) {
      for (const a of allergensFor(r.ing.name)) allergenSet.add(a);
      if (r.sub) {
        for (const a of r.sub.allergens) allergenSet.add(a);
        collect(r.sub.rows);
      }
    }
  };
  collect(rows);

  for (const r of rows) {
    r.bakerPct = flour && r.g !== null ? (r.g / flour) * 100 : 0;
  }

  return {
    rows,
    totalG,
    theoretical,
    actualYield,
    prodLoss,
    bakeLoss,
    scaleWeight,
    unitsActual,
    unitsDeclared,
    unitsFromWeight,
    unitsWarn,
    cost,
    costPerUnit,
    costPerKg,
    price,
    flour,
    liquid,
    water,
    hydration,
    trueHydration,
    waterTemp,
    allergens: [...allergenSet],
    factor: f,
    unresolved,
    warnings: [...new Set(warnings)],
  };
}

function emptyComputed(f: number): Computed {
  return {
    rows: [],
    totalG: 0,
    theoretical: 0,
    actualYield: 0,
    prodLoss: 0,
    bakeLoss: 0,
    scaleWeight: 0,
    unitsActual: 0,
    unitsDeclared: 0,
    unitsFromWeight: 0,
    unitsWarn: false,
    cost: 0,
    costPerUnit: 0,
    costPerKg: 0,
    price: 0,
    flour: 0,
    liquid: 0,
    water: 0,
    hydration: 0,
    trueHydration: 0,
    waterTemp: null,
    allergens: [],
    factor: f,
    unresolved: [],
    warnings: [],
  };
}

/** Scaling factor for the four scaling modes (spec §6). Same engine, one path. */
export function scaleFactor(
  mode: 'recipe' | 'units' | 'weight' | 'stock',
  value: number,
  baseline: Computed,
  stockIngredientId?: string,
): number {
  const v = Number(value);
  if (mode === 'recipe' || !v || v <= 0) return 1;
  // Half of a declared 12 is exactly ×0.5: `unitsActual` is the declared
  // count unless the batch was weighed (see types.ts), so the baseline is
  // the recipe's own statement and a measured batch is the measured truth.
  if (mode === 'units') return baseline.unitsActual ? v / baseline.unitsActual : 1;
  if (mode === 'weight') return baseline.actualYield ? v / baseline.actualYield : 1;
  const row =
    baseline.rows.find((r) => r.ing.id === stockIngredientId) ?? baseline.rows[0];
  return row && row.g ? v / row.g : 1;
}

export { unavailableProvenance };
