// Production planning: the plan itself, and the scale factor it implies.
//
// WHAT THIS FILE IS CAREFUL ABOUT
//
// 1. IT DOES NOT COMPUTE A SCALE FACTOR THE ENGINE ALREADY COMPUTES. The
//    engine exports `scaleFactor(mode, value, baseline)` and has since stage 4.
//    This file establishes the BASELINE (the recipe at factor 1) and decides
//    whether a factor can honestly exist at all — which is the part the engine
//    deliberately leaves to the caller, because `scaleFactor` returns 1 when it
//    cannot divide, and "1" is a number a planner would act on.
//
// 2. A MISSING YIELD IS NOT A YIELD OF ONE. A recipe with no unit yield cannot
//    be planned in units, and the honest answer is to say which fact is
//    missing rather than to produce a plausible quantity of flour.
//
// 3. null ≠ 0 THROUGHOUT. An unentered on-hand quantity is not "none in the
//    store room", and the difference decides whether the user buys 12 kg of
//    flour they already have.

import {
  compute,
  scaleFactor,
  type Computed,
  type MeasurementPrefs,
  type Recipe,
} from '@recipe-notebook/engine';
import type { PlanQtyUnit } from '../../lib/database.types.js';

export interface PlanItem {
  /** local key while editing; the database id once saved */
  id: string;
  recipeId: string;
  qty: number;
  qtyUnit: PlanQtyUnit;
  /** 'HH:MM'. null = the user did not say when it must be ready */
  readyAt: string | null;
  note: string;
}

export interface ProductionPlan {
  id: string;
  name: string;
  /** ISO date, 'YYYY-MM-DD' */
  planDate: string;
  note: string;
  /** requirement 14: a locked plan is a record, and reads from its snapshot */
  locked: boolean;
  lockedAt: string | null;
  /**
   * The frozen figures of a locked plan, opaque on purpose — the shape belongs
   * to `snapshotOf()` in purchase.ts and nothing here should reach into it.
   * `unknown` already admits null (the unlocked case); the `| null` this used
   * to carry said nothing and hid that.
   */
  snapshot: unknown;
  /** the optimistic-concurrency token the next save sends back */
  updatedAt: string;
  items: PlanItem[];
  /**
   * What the user says they already have, by ingredient key, in the catalog's
   * base unit. A key that is ABSENT means nobody entered a quantity — which is
   * not the same as a key present with 0.
   */
  onHand: Record<string, number>;
}

export const PLAN_QTY_UNITS: ReadonlyArray<{ id: PlanQtyUnit; label: string }> = [
  { id: 'unit', label: 'יחידות' },
  { id: 'kg', label: 'ק"ג' },
  { id: 'g', label: 'גרם' },
];

export const planQtyLabel = (u: PlanQtyUnit): string =>
  PLAN_QTY_UNITS.find((x) => x.id === u)?.label ?? u;

/** The scale factor a plan line implies, or why there isn't one. */
export interface Scaled {
  recipe: Recipe | null;
  /** the recipe as written, at factor 1 — the baseline every figure derives from */
  baseline: Computed | null;
  /** null when it cannot be computed. NEVER 1 as a stand-in */
  factor: number | null;
  /** the recipe's own yield, for the screen to show beside the target */
  recipeUnits: number | null;
  recipeGrams: number | null;
  /** '' when there is a factor */
  why: string;
}

const gramsOf = (qty: number, unit: PlanQtyUnit): number =>
  unit === 'kg' ? qty * 1000 : qty;

/**
 * The factor for one plan line.
 *
 * "מתכון מפיק 20 יחידות, נדרשות 100 → factor 5" is exactly
 * `scaleFactor('units', 100, baseline)`; the work here is establishing that
 * the baseline HAS a unit yield to divide by.
 */
export function scaleFor(
  item: PlanItem,
  recipes: readonly Recipe[],
  prefs: MeasurementPrefs | undefined,
): Scaled {
  const recipe = recipes.find((r) => r.id === item.recipeId) ?? null;
  if (!recipe) {
    return {
      recipe: null,
      baseline: null,
      factor: null,
      recipeUnits: null,
      recipeGrams: null,
      why: 'המתכון של השורה הזאת לא נמצא.',
    };
  }

  const baseline = compute(recipe, recipes, { factor: 1, ...(prefs ? { prefs } : {}) });
  const recipeUnits = baseline.unitsActual > 0 ? baseline.unitsActual : null;
  const recipeGrams = baseline.actualYield > 0 ? baseline.actualYield : null;
  const out: Scaled = {
    recipe,
    baseline,
    factor: null,
    recipeUnits,
    recipeGrams,
    why: '',
  };

  if (!(item.qty > 0)) {
    out.why = 'כמות היעד חייבת להיות גדולה מאפס.';
    return out;
  }

  if (item.qtyUnit === 'unit') {
    if (recipeUnits === null) {
      // §2: do not invent a yield. Without one, planning in units would be
      // planning against a number nobody stated.
      out.why =
        'למתכון אין תפוקה ביחידות (מספר יחידות או משקל ליחידה), ולכן אי אפשר לחשב כמה לייצר ליעד ביחידות.';
      return out;
    }
    out.factor = scaleFactor('units', item.qty, baseline);
    return out;
  }

  if (recipeGrams === null) {
    out.why = 'למתכון אין תפוקה במשקל, ולכן אי אפשר לחשב כמה לייצר ליעד במשקל.';
    return out;
  }
  out.factor = scaleFactor('weight', gramsOf(item.qty, item.qtyUnit), baseline);
  return out;
}

/** 'HH:MM' → minutes since midnight. null when it is not a time. */
export function minutesOfDay(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** An ISO date and an 'HH:MM' as one instant, in the browser's own zone. */
export function instantOf(planDate: string, hhmm: string | null): Date | null {
  const mins = minutesOfDay(hhmm);
  if (mins === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(planDate.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.floor(mins / 60),
    mins % 60,
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
