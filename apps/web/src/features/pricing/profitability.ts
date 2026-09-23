// The full product cost, and what it means for the price (stage-8 E, F, G, H).
//
// WHAT THIS FILE REFUSES TO DO
//
// 1. IT DOES NOT INVENT A COST. Packaging, labour and "other" are entered by
//    the user or they are NULL. Nothing here derives rent, electricity or an
//    overhead rate, because there is no model for them and a number that looks
//    like a measurement but is a guess is worse than a blank. NULL is "not
//    entered"; 0 is "there is none", and the two are kept apart everywhere.
//
// 2. IT DOES NOT PRESENT A PARTIAL COST AS A TOTAL. If one ingredient has no
//    price the ingredient cost is incomplete, so there is no total cost, no
//    profit and no margin — a margin computed from an understated cost is
//    flatteringly wrong in exactly the direction that loses money. What IS
//    known is still shown, marked as partial.
//
// 3. IT DOES NOT CONFUSE MARGIN WITH MARKUP. They are different numbers with
//    different denominators, and mixing them up is the single most common
//    pricing error in food:
//
//      Gross Margin % = (price − cost) / PRICE × 100
//      Markup %       = profit / COST  × 100
//
//    A ₪100 item costing ₪40 has a 60% margin and a 150% markup. Both are
//    reported, each under its own name.
//
// 4. IT DOES NOT CALL A COMPUTED PRICE "THE RIGHT PRICE". A target food cost
//    or a target margin produces a price that WOULD hit that target. What the
//    item should sell for is a decision about a market, and this code knows
//    nothing about the market.

import type { Computed, Recipe } from '@recipe-notebook/engine';
import type { CalcState } from '../recipe/completeness.js';
import { foodCost, type FoodCost } from './foodCost.js';

/** Requirement E: the cost, in its parts. `null` is "not entered". */
export interface CostBreakdown {
  /** from the engine. null when nothing is priced */
  ingredients: number | null;
  packaging: number | null;
  labor: number | null;
  other: number | null;
  /**
   * ingredients + everything entered. NULL when the ingredient cost is missing
   * or incomplete, because then there is no total to state.
   */
  total: number | null;
  /** the ingredient cost is real but incomplete */
  partial: boolean;
  /** which parts nobody has entered, so the screen can say what the total omits */
  notEntered: string[];
}

/** Requirement F. Every figure `null` when it cannot be known. */
export interface Profitability {
  /** the sale price as entered, and what it refers to */
  salePrice: number | null;
  basis: 'batch' | 'unit';
  /** the number of units the recipe yields, when it has one */
  units: number | null;

  /** the sale price of the WHOLE batch, whichever basis was entered */
  batchSalePrice: number | null;
  /** the sale price of ONE unit, when there are units */
  unitSalePrice: number | null;

  totalCost: number | null;
  costPerUnit: number | null;

  /** money: batch sale price − total cost */
  profit: number | null;
  profitPerUnit: number | null;

  /** (price − cost) / PRICE × 100 */
  grossMargin: number | null;
  /** ingredient cost / price × 100 — the ratio the kitchen watches */
  foodCostPct: number | null;
  /** profit / COST × 100. Named separately on purpose; it is not the margin */
  markup: number | null;

  /** why the figures above are null, when they are. '' when they exist */
  why: string;
}

/** Requirement G. A price that WOULD hit a target — not "the right price". */
export interface TargetPrice {
  /** from `target_fc`: ingredient cost ÷ target. Batch-level */
  fromFoodCost: number | null;
  /** from `target_gm`: TOTAL cost ÷ (1 − target). Batch-level */
  fromMargin: number | null;
  /** the same two per unit, when the recipe yields units */
  fromFoodCostPerUnit: number | null;
  fromMarginPerUnit: number | null;
  targetFC: number | null;
  targetGM: number | null;
  /** why a figure is null, when it is */
  why: string;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The parts of the cost, and the total only when there is one. */
export function costBreakdown(fc: FoodCost, recipe: Recipe): CostBreakdown {
  const packaging = numOrNull(recipe['packagingCost']);
  const labor = numOrNull(recipe['laborCost']);
  const other = numOrNull(recipe['otherCost']);

  const notEntered: string[] = [];
  if (packaging === null) notEntered.push('אריזה');
  if (labor === null) notEntered.push('עבודה');
  if (other === null) notEntered.push('עלויות נוספות');

  // An incomplete ingredient cost cannot produce a total. This is requirement
  // H applied to the total rather than only to the percentage: a total that is
  // missing an ingredient reads as finished and is too low.
  const total =
    fc.cost === null || fc.partial
      ? null
      : fc.cost + (packaging ?? 0) + (labor ?? 0) + (other ?? 0);

  return {
    ingredients: fc.cost,
    packaging,
    labor,
    other,
    total,
    partial: fc.partial,
    notEntered,
  };
}

/**
 * The sale side.
 *
 * `basis` decides what the entered price MEANS, and it is stored rather than
 * guessed: reading a per-unit price as a batch price turns a 30% food cost
 * into a 300% one, and the user would have no way of knowing which happened.
 */
export function profitability(
  recipe: Recipe,
  computed: Computed,
  breakdown: CostBreakdown,
  fc: FoodCost,
): Profitability {
  const salePrice = numOrNull(recipe['salePrice']);
  const basis: 'batch' | 'unit' = recipe['salePriceBasis'] === 'unit' ? 'unit' : 'batch';
  const units = computed.unitsActual > 0 ? computed.unitsActual : null;

  // A per-unit price with no unit count cannot be turned into a batch price,
  // and inventing a count would invent the whole profit figure.
  const batchSalePrice =
    salePrice === null ? null : basis === 'batch' ? salePrice : units === null ? null : salePrice * units;
  const unitSalePrice =
    salePrice === null ? null : basis === 'unit' ? salePrice : units === null ? null : salePrice / units;

  const totalCost = breakdown.total;
  const costPerUnit = totalCost === null || units === null ? null : totalCost / units;

  const out: Profitability = {
    salePrice,
    basis,
    units,
    batchSalePrice,
    unitSalePrice,
    totalCost,
    costPerUnit,
    profit: null,
    profitPerUnit: null,
    grossMargin: null,
    foodCostPct: null,
    markup: null,
    why: '',
  };

  if (totalCost === null) {
    out.why = breakdown.partial
      ? 'העלות חלקית — חסר מחיר לחלק מחומרי הגלם, ולכן אין עלות כוללת ואין רווחיות.'
      : 'אין עלות חומרי גלם, ולכן אין עלות כוללת ואין רווחיות.';
    return out;
  }
  if (salePrice === null) {
    out.why = 'לא הוגדר מחיר מכירה, ולכן אין רווח ואין שיעור רווחיות.';
    return out;
  }
  if (basis === 'unit' && units === null) {
    out.why =
      'מחיר המכירה הוגדר ליחידה, אבל למתכון אין מספר יחידות, ולכן אי אפשר להשוות אותו לעלות.';
    return out;
  }
  if (batchSalePrice === null) {
    out.why = 'אי אפשר להשוות את מחיר המכירה לעלות.';
    return out;
  }

  out.profit = batchSalePrice - totalCost;
  out.profitPerUnit = units === null ? null : out.profit / units;

  // Margin needs a price to divide by. A price of 0 (given away) is a real
  // value, and it makes the RATIO undefined rather than 0% or −100%.
  if (batchSalePrice === 0) {
    out.why =
      'מחיר המכירה הוא 0, ולכן שיעור הרווח הגולמי ואחוז הפוד קוסט אינם מוגדרים (חילוק באפס). הרווח עצמו מוצג.';
  } else {
    out.grossMargin = ((batchSalePrice - totalCost) / batchSalePrice) * 100;
    // The kitchen's ratio: INGREDIENTS over price, not the total cost. Using
    // the total here would silently redefine the number every chef knows.
    out.foodCostPct = fc.cost === null ? null : (fc.cost / batchSalePrice) * 100;
  }

  // Markup divides by COST, so a cost of 0 leaves it undefined — and a free
  // item sold for money has no meaningful markup percentage.
  if (totalCost !== 0) out.markup = (out.profit / totalCost) * 100;

  return out;
}

/**
 * Requirement G: the price a target implies.
 *
 * Food cost target works from the INGREDIENT cost, because that is what food
 * cost means. Margin target works from the TOTAL cost, because a margin that
 * ignored packaging and labour would not be a margin on anything.
 */
export function targetPrice(
  recipe: Recipe,
  computed: Computed,
  breakdown: CostBreakdown,
  fc: FoodCost,
): TargetPrice {
  const targetFC = numOrNull(recipe['targetFC']);
  const targetGM = numOrNull(recipe['targetGM']);
  const units = computed.unitsActual > 0 ? computed.unitsActual : null;

  const out: TargetPrice = {
    fromFoodCost: null,
    fromMargin: null,
    fromFoodCostPerUnit: null,
    fromMarginPerUnit: null,
    targetFC,
    targetGM,
    why: '',
  };

  const reasons: string[] = [];

  if (fc.cost === null || fc.partial) {
    reasons.push(
      fc.partial
        ? 'העלות חלקית, ולכן מחיר לפי יעד פוד קוסט יהיה נמוך מהאמת ואינו מוצג.'
        : 'אין עלות חומרי גלם, ולכן אין מחיר לפי יעד פוד קוסט.',
    );
  } else if (targetFC === null || targetFC <= 0) {
    // A target of 0% would need an infinite price. It is not a target.
    reasons.push('לא הוגדר יעד פוד קוסט גדול מאפס.');
  } else {
    out.fromFoodCost = fc.cost / (targetFC / 100);
    out.fromFoodCostPerUnit = units === null ? null : out.fromFoodCost / units;
  }

  if (breakdown.total === null) {
    reasons.push('אין עלות כוללת, ולכן אין מחיר לפי יעד רווח גולמי.');
  } else if (targetGM === null) {
    reasons.push('לא הוגדר יעד רווח גולמי.');
  } else if (targetGM < 0 || targetGM >= 100) {
    // At 100% the price would have to be infinite; above it, negative.
    reasons.push('יעד רווח גולמי צריך להיות קטן מ-100%.');
  } else {
    out.fromMargin = breakdown.total / (1 - targetGM / 100);
    out.fromMarginPerUnit = units === null ? null : out.fromMargin / units;
  }

  out.why = reasons.join(' ');
  return out;
}

/** Everything the costing panel needs, in one call. */
export function costing(recipe: Recipe, computed: Computed, calc: CalcState) {
  const fc = foodCost(recipe, computed, calc);
  const breakdown = costBreakdown(fc, recipe);
  return {
    fc,
    breakdown,
    profit: profitability(recipe, computed, breakdown, fc),
    target: targetPrice(recipe, computed, breakdown, fc),
  };
}
