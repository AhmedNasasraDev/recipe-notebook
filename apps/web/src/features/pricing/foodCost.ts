// Food cost, and the four figures around it (stage-7 requirement 4).
//
// THE RULE THAT SHAPES ALL OF THIS
//
// "אל תציג Food Cost כאשר אחד הנתונים הדרושים אינו ידוע." Every field below is
// therefore `number | null`, and `null` means "not known" — never 0. The screen
// renders a dash for null and a number for 0, because ₪0 is a legal value
// (something priced at nothing) and 0% is a legal food cost, and neither may
// be confused with "we could not work it out".
//
// The four ways a food cost can fail to exist, all distinguished:
//
//   no cost        nothing in the recipe is priced, so there is no numerator
//   partial cost   some of it is priced. A food cost from a cost that is
//                  missing an ingredient is WORSE than no food cost, because
//                  it looks finished and is flatteringly low
//   no sale price  the user has not said what they charge
//   sale price 0   they give it away. Then the food cost is a division by zero,
//                  which is not 0% and not 100% — it does not exist
//
// No arithmetic here is new. `cost`, `costPerKg` and `costPerUnit` all come
// from `compute()`; this decides which of them may be SHOWN, and computes the
// one ratio requirement 4 defines: cost ÷ sale price × 100.

import type { Computed, Recipe } from '@recipe-notebook/engine';
import type { CalcState } from '../recipe/completeness.js';

export interface FoodCost {
  /** total ingredient cost, or null when nothing is priced */
  cost: number | null;
  /** cost per kilogram, or null when the yield is unknown */
  costPerKg: number | null;
  /** cost per unit, or null when the recipe has no unit yield */
  costPerUnit: number | null;
  /** what the user says they charge, or null when they have not said */
  salePrice: number | null;
  /** cost ÷ sale price × 100, or null when either is unusable */
  percent: number | null;
  /**
   * Why `percent` is null, when it is. '' when there is a percentage.
   * Shown to the user, because "—" on its own invites the assumption that
   * something is broken.
   */
  why: string;
  /**
   * True when `cost` is real but incomplete. The figures may be shown, marked,
   * but `percent` is withheld — an understated food cost is a pricing decision
   * made on a wrong number.
   */
  partial: boolean;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function foodCost(
  recipe: Recipe,
  computed: Computed,
  calc: CalcState,
): FoodCost {
  const salePrice = numOrNull(recipe['salePrice']);
  const priced = calc.costLevel !== 'none';
  const partial = calc.costLevel === 'partial';

  // `compute()` returns 0 for these when it has nothing to work from, so they
  // are read back through the completeness state rather than trusted directly.
  const cost = priced ? computed.cost : null;
  const costPerKg = priced && computed.costPerKg > 0 ? computed.costPerKg : null;
  const costPerUnit = priced && computed.costPerUnit > 0 ? computed.costPerUnit : null;

  let percent: number | null = null;
  let why = '';

  if (!priced) {
    why = 'אין מחיר לאף חומר גלם, ולכן אין עלות ואין אחוז פוד קוסט.';
  } else if (partial) {
    // The most important branch. A food cost computed from a partial cost is
    // always too low, and too low is exactly the direction that loses money.
    why =
      'העלות חלקית — חסר מחיר לחלק מחומרי הגלם. אחוז פוד קוסט מעלות חלקית יהיה נמוך מהאמת, ולכן אינו מוצג.';
  } else if (salePrice === null) {
    why = 'לא הוגדר מחיר מכירה, ולכן אי אפשר לחשב אחוז פוד קוסט.';
  } else if (salePrice === 0) {
    why = 'מחיר המכירה הוא 0, ולכן אחוז פוד קוסט אינו מוגדר (חילוק באפס).';
  } else if (cost === null) {
    why = 'אין עלות לחשב ממנה.';
  } else {
    percent = (cost / salePrice) * 100;
  }

  return { cost, costPerKg, costPerUnit, salePrice, percent, why, partial };
}
