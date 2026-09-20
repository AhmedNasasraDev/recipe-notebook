// How long a recipe takes, from the steps it already has.
//
// ONE ANSWER, IN ONE PLACE
//
// The recipe screen printed this inline; the notebook card now needs the same
// sentence, and a second copy of the arithmetic is how two screens start
// disagreeing about the same recipe. There is no "total time" field in the
// data model (§1.1) and this does not invent one: the number is the sum of the
// minutes the steps carry, which is what the cook wrote down.

import type { Recipe, Step } from '@recipe-notebook/engine';

/** The sum of the minutes on the steps. 0 when no step says how long it takes. */
export function totalMinutes(recipe: Pick<Recipe, 'steps'>): number {
  return (recipe.steps ?? []).reduce((a: number, s: Step) => a + Number(s.minutes ?? 0), 0);
}

/**
 * "45 דק'" · "שעה" · "2 שע' 15 דק'".
 *
 * Latin digits inside a Hebrew sentence are the project's own convention
 * (§15), so the caller wraps the result in `.ltr` exactly as it did before.
 */
export function formatMinutes(total: number): string {
  const n = Math.max(0, Math.round(total));
  if (n < 60) return `${n} דק'`;
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  return rest === 0 ? `${hours} שע'` : `${hours} שע' ${rest} דק'`;
}

/** The label for a card or a header, or null when nothing was timed. */
export function timeLabelOf(recipe: Pick<Recipe, 'steps'>): string | null {
  const total = totalMinutes(recipe);
  return total > 0 ? formatMinutes(total) : null;
}
