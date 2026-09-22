/*
  "כמה להכין", as something a link can carry.

  ─────────────────────────────────────────────────────────────────────────────
  WHY THIS FILE EXISTS

  The scale is chosen on the recipe screen and needed on two others: the order
  sheet (§2 screen 9) and Cook Mode (§14), which must weigh what is actually
  being made. `OrderScreen` already solved the problem — put it in the URL, and
  rebuild the factor with the engine's own `scaleFactor()` — and its header
  explains why the other two options (router state, a stored field) are worse.

  What was NOT shared was the eleven lines that write the query string and the
  eleven that read it back. Two copies of that is a place for them to drift:
  one screen accepting a mode the other does not, or a `v` parsed differently.
  So both directions live here, and every screen that speaks about scale in a
  URL speaks through this file.

  WHAT IS NOT HERE, ON PURPOSE

  Any arithmetic. `scaleFactor()` in the engine is the only thing that turns a
  mode and a number into a factor, and this file calls it. The whole point is
  that there is one scaling rule in the project.
*/

import { scaleFactor, type Computed } from '@recipe-notebook/engine';

export type ScaleMode = 'recipe' | 'units' | 'weight' | 'stock' | 'batches';

export const SCALE_MODES: readonly ScaleMode[] = ['recipe', 'units', 'weight', 'stock', 'batches'];

/** What each mode is called on screen. One set of words, three screens. */
export const SCALE_MODE_TEXT: Record<ScaleMode, string> = {
  recipe: 'כמויות כמו במתכון',
  units: 'לפי מספר יחידות',
  weight: 'לפי משקל סופי',
  stock: 'לפי מלאי של רכיב',
  batches: 'לפי מספר אצוות',
};

export interface ScaleChoice {
  mode: ScaleMode;
  factor: number;
}

/**
 * The query string for the current choice — `''` for "as written".
 *
 * `recipe` mode and a value that produced no change both come out empty, so
 * the plain URL means "as written" rather than "×1.00", which is the same
 * thing said less clearly.
 */
export function scaleQuery(
  mode: ScaleMode,
  value: string,
  ingredientId: string,
  factor: number,
): string {
  if (mode === 'recipe' || factor === 1) return '';
  const q = new URLSearchParams({ mode, v: value });
  if (mode === 'stock' && ingredientId) q.set('ing', ingredientId);
  return `?${q.toString()}`;
}

/**
 * The scale a link asked for, rebuilt against this recipe's baseline.
 *
 * `scaleFactor` returns 1 for anything it cannot use, and a factor of 1 is
 * indistinguishable from "as written" — which is what a screen should then
 * say, rather than claiming an adjustment it did not make. An unreadable
 * parameter therefore falls back to the recipe's own quantities instead of
 * guessing.
 */
export function readScale(
  params: URLSearchParams,
  baseline: Computed | null,
): ScaleChoice {
  const raw = params.get('mode');
  const mode: ScaleMode = SCALE_MODES.includes(raw as ScaleMode)
    ? (raw as ScaleMode)
    : 'recipe';
  if (!baseline || mode === 'recipe') return { mode: 'recipe', factor: 1 };
  const factor = scaleFactor(mode, Number(params.get('v') ?? ''), baseline, params.get('ing') ?? undefined);
  return factor === 1 ? { mode: 'recipe', factor: 1 } : { mode, factor };
}
