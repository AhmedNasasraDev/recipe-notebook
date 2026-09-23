// Backward scheduling: from "ready at 08:00" to "start the chill on Thursday".
//
// WHAT IT DOES
//
// Requirement 8: a product's steps have durations, so the last step ends when
// the product must be ready and every earlier step is placed backwards from
// there. Requirement 9: that walk crosses midnight and keeps going — a
// 12-hour chill before an 08:00 Friday means starting on Thursday evening, and
// the timeline says Thursday rather than clamping to 00:00.
//
// WHAT IT REFUSES TO DO
//
// · IT DOES NOT INVENT A DURATION. A step with no minutes stops the backward
//   walk: that step and everything before it have no time, the schedule is
//   reported as PARTIAL, and the step is named. Guessing "about 20 minutes"
//   would produce a plan someone gets up at 4am for.
// · IT DOES NOT CLASSIFY A STEP IT CANNOT. `kind` is declared by the user
//   (migration 0018). Where it is absent, the one inference made is from the
//   TEMPERATURE the recipe already carries — ≤ 8 °C reads as refrigeration,
//   ≥ 100 °C as baking or cooking — and the source of the classification is
//   reported alongside it. Nothing is read out of the step's Hebrew text.
// · IT DOES NOT MOVE ANYTHING TO RESOLVE A CONFLICT (requirement 10). Two
//   products needing the oven at once are both shown at that hour. There is no
//   model of ovens, mixers or hands here, so there is no optimisation to claim
//   and nothing is silently rescheduled.
// · IT DOES NOT GUESS WHICH STEP CONSUMES A SUB-RECIPE (requirement 11). The
//   model links a recipe to a sub-recipe, not a STEP to a sub-recipe. So the
//   rule is the conservative one and it is stated on screen: a sub-recipe must
//   be finished before the product's FIRST step begins.

import type { MeasurementPrefs, Recipe, Step, StepKind } from '@recipe-notebook/engine';
import { instantOf } from './plan.js';
import type { ScaledItem } from './explode.js';

export type KindSource = 'declared' | 'temperature' | 'none';

export const KIND_LABEL: Readonly<Record<StepKind, string>> = {
  active: 'עבודה',
  passive: 'המתנה',
  chill: 'קירור',
  proof: 'התפחה',
  bake: 'אפייה/בישול',
};

export const STEP_KINDS: ReadonlyArray<{ id: StepKind; label: string }> = (
  ['active', 'passive', 'chill', 'proof', 'bake'] as const
).map((id) => ({ id, label: KIND_LABEL[id] }));

/** Is this kind of step hands-on? Refrigeration and proofing are not. */
export const isActive = (kind: StepKind | null): boolean => kind === 'active';

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** In Celsius, whatever the step declared. */
function celsius(step: Step): number | null {
  const t = numOrNull(step.temp);
  if (t === null) return null;
  return step.tempUnit === 'F' ? ((t - 32) * 5) / 9 : t;
}

/**
 * What kind of step this is, and where that answer came from.
 *
 * A declared kind always wins. The temperature is the only fallback, because
 * it is the only other thing in the row that is a measurement rather than prose.
 */
export function classify(step: Step): { kind: StepKind | null; source: KindSource } {
  if (step.kind) return { kind: step.kind, source: 'declared' };
  const c = celsius(step);
  if (c !== null) {
    if (c <= 8) return { kind: 'chill', source: 'temperature' };
    if (c >= 100) return { kind: 'bake', source: 'temperature' };
  }
  return { kind: null, source: 'none' };
}

export interface ScheduledStep {
  /** which product, and which recipe it came from */
  product: string;
  recipeId: string;
  /** '' for an unnamed step */
  text: string;
  ord: number;
  kind: StepKind | null;
  kindSource: KindSource;
  minutes: number | null;
  start: Date | null;
  end: Date | null;
  /** this step belongs to a sub-recipe that must be ready for `product` */
  forProduct: string | null;
}

export interface ProductSchedule {
  product: string;
  recipeId: string;
  /** when it must be ready. null = the user did not say */
  readyAt: Date | null;
  /** earliest start across this product and its dependencies. null when unknown */
  startsAt: Date | null;
  steps: ScheduledStep[];
  /** sub-recipes this product depends on, deepest last */
  dependencies: Array<{ name: string; recipeId: string; depth: number }>;
  /** true when a step's duration is missing, so the schedule is incomplete */
  partial: boolean;
  /** what is missing, in words */
  problems: string[];
}

export interface Timeline {
  products: ProductSchedule[];
  /** every step of every product, earliest first. Unplaced steps come last */
  all: ScheduledStep[];
  partial: boolean;
  problems: string[];
}

/** The sub-recipes a recipe depends on, deep, without repeating one. */
export function dependenciesOf(
  recipe: Recipe,
  recipes: readonly Recipe[],
  depth = 1,
  seen: Set<string> = new Set(),
): Array<{ name: string; recipeId: string; depth: number }> {
  const out: Array<{ name: string; recipeId: string; depth: number }> = [];
  for (const ing of recipe.ingredients ?? []) {
    const id = ing.subId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const sub = recipes.find((r) => r.id === id);
    if (!sub) continue;
    out.push({ name: String(sub.name ?? ''), recipeId: id, depth });
    // A → B → C: the chain is walked to the bottom. A cycle cannot occur —
    // the database refuses to store one (migration 0007) — and `seen` makes
    // this terminate anyway.
    out.push(...dependenciesOf(sub, recipes, depth + 1, seen));
  }
  return out;
}

/**
 * Places one recipe's steps backwards from `end`.
 *
 * Returns the placed steps and the earliest start. A step with no duration is
 * placed with null times, and every step BEFORE it too: once one gap exists,
 * nothing earlier has a knowable time.
 */
function scheduleBackwards(
  recipe: Recipe,
  product: string,
  end: Date | null,
  forProduct: string | null,
): { steps: ScheduledStep[]; startsAt: Date | null; problems: string[] } {
  const steps = recipe.steps ?? [];
  const out: ScheduledStep[] = [];
  const problems: string[] = [];
  let cursor = end;
  let blocked = end === null;

  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]!;
    const { kind, source } = classify(step);
    const minutes = numOrNull(step.minutes);
    const label = String(step.text ?? '').trim();

    if (minutes === null) {
      problems.push(
        `${product}: לשלב "${label || `#${i + 1}`}" אין משך זמן, ולכן אי אפשר לקבוע מתי הוא והשלבים שלפניו מתחילים.`,
      );
    }

    let start: Date | null = null;
    let stepEnd: Date | null = null;
    if (!blocked && minutes !== null && cursor) {
      stepEnd = cursor;
      // Plain millisecond arithmetic, which is what carries the walk across
      // midnight — and across a DST boundary — without a special case.
      start = new Date(cursor.getTime() - minutes * 60_000);
      cursor = start;
    } else {
      blocked = true;
    }

    out.unshift({
      product,
      recipeId: recipe.id,
      text: label,
      ord: i,
      kind,
      kindSource: source,
      minutes,
      start,
      end: stepEnd,
      forProduct,
    });
  }

  return { steps: out, startsAt: blocked ? null : cursor, problems };
}

export function buildTimeline(
  scaled: readonly ScaledItem[],
  recipes: readonly Recipe[],
  planDate: string,
  _prefs?: MeasurementPrefs,
): Timeline {
  const products: ProductSchedule[] = [];
  const problems: string[] = [];

  for (const s of scaled) {
    const recipe = s.scaled.recipe;
    if (!recipe) continue;
    const product = String(recipe.name ?? 'מוצר ללא שם');
    const readyAt = instantOf(planDate, s.item.readyAt);

    const own = scheduleBackwards(recipe, product, readyAt, null);
    const deps = dependenciesOf(recipe, recipes);

    const steps = [...own.steps];
    const depProblems: string[] = [...own.problems];
    // Requirement 11: a dependency must be FINISHED before the product's own
    // first step begins. Chained dependencies walk further back from there.
    let depEnd = own.steps[0]?.start ?? null;
    for (const dep of deps) {
      const subRecipe = recipes.find((r) => r.id === dep.recipeId);
      if (!subRecipe) continue;
      const sub = scheduleBackwards(subRecipe, dep.name, depEnd, product);
      steps.unshift(...sub.steps);
      depProblems.push(...sub.problems);
      depEnd = sub.steps[0]?.start ?? depEnd;
    }

    if (readyAt === null) {
      depProblems.push(
        `${product}: לא הוגדרה שעת מוכנות, ולכן אין לוח זמנים לשורה הזאת.`,
      );
    }
    if (recipe.steps === undefined || recipe.steps.length === 0) {
      depProblems.push(`${product}: אין שלבי הכנה במתכון, ולכן אין ממה לבנות לוח זמנים.`);
    }

    const placed = steps.filter((x) => x.start !== null);
    const startsAt =
      placed.length === 0
        ? null
        : placed.reduce((min, x) => (x.start! < min ? x.start! : min), placed[0]!.start!);

    const schedule: ProductSchedule = {
      product,
      recipeId: recipe.id,
      readyAt,
      startsAt,
      steps,
      dependencies: deps,
      partial: steps.some((x) => x.start === null),
      problems: depProblems,
    };
    products.push(schedule);
    problems.push(...depProblems);
  }

  // Requirement 10: one combined view, in time order. Overlaps are SHOWN, not
  // resolved — nothing here knows how many ovens there are.
  const all = products
    .flatMap((p) => p.steps)
    .sort((a, b) => {
      if (a.start && b.start) return a.start.getTime() - b.start.getTime();
      if (a.start) return -1;
      if (b.start) return 1;
      return 0;
    });

  return {
    products,
    all,
    partial: products.some((p) => p.partial) || problems.length > 0,
    problems,
  };
}

/** 'ה׳ 22:30' — the day matters, because a plan crosses midnight. */
export function whenLabel(d: Date | null): string {
  if (!d) return '—';
  const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getDay()]}׳ ${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
