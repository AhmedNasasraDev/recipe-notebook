/*
  What one ingredient row SHOWS — §5.4's three views, in one place.

  ─────────────────────────────────────────────────────────────────────────────
  MOVED HERE, NOT WRITTEN HERE

  This is the `rowLabel` that lived inside `RecipeScreen`, unchanged. It came
  out when Cook Mode needed to print the same quantities for Mise en place
  (§14): a second implementation would have been a second answer to "how much
  flour", and the two would have disagreed the first time somebody touched one
  of them — which is exactly the class of bug the costing stage spent a day on.

  WHAT IT IS NOT ALLOWED TO DO, AND DOES NOT

  Scale anything. `row.g` arrives already multiplied by the factor, because
  `compute()` did it; the only arithmetic here is `qty * factor` for the "as
  written" view, which converts nothing and computes no weight — it restates
  the recipe's own number in the recipe's own unit.

  WHY A NULL WEIGHT PRINTS THE WRITTEN QUANTITY, AND SAYS SO

  It used to print an em dash in every view: the app does not know the
  weight, so it printed nothing. QA 22.09.2026 (acceptance, finding 3) showed
  what nothing looks like on a bench — "ביצים —" on the weighing list for a
  recipe that says "4 ביצים". The recipe's own number is not a verified
  weight, but it is not unknown either, and a cook who reads "4 יח'" with
  "כמות לפי המתכון" under it knows exactly what to do. No gram figure is
  invented: the text is the recipe's quantity in the recipe's unit, and the
  hint says that is all it is.
*/

import { formatGrams, homeMeasure, unitLabel, type ComputedRow } from '@recipe-notebook/engine';
import type { MeasurementPrefs } from '@recipe-notebook/engine';

/** §5.4: as written · grams · home measures. */
export type ViewMode = 'orig' | 'g' | 'home';

export interface RowLabel {
  text: string;
  /** a secondary line, '' when it would only repeat `text` */
  hint: string;
}

export function rowLabel(
  row: ComputedRow,
  view: ViewMode,
  factor: number,
  prefs: MeasurementPrefs,
): RowLabel {
  if (row.g === null) {
    const written = asWritten(row, factor);
    return written === ''
      ? { text: '—', hint: 'אין כמות במתכון' }
      : { text: written, hint: 'כמות לפי המתכון' };
  }
  if (view === 'g' || row.ing.subId) {
    return { text: formatGrams(row.g), hint: '' };
  }
  if (view === 'home') {
    const home = homeMeasure(row.ing, factor, prefs);
    return home?.ok
      ? { text: home.text, hint: formatGrams(row.g) }
      : // §5.4: a row with no reliable data stays in grams and is marked as such
        { text: formatGrams(row.g), hint: 'בגרמים — אין נתון להמרה לכלי מדידה' };
  }
  // "as written": keep the recipe's own unit, scaled
  const text = asWritten(row, factor);
  const grams = formatGrams(row.g);
  // The gram hint is only worth showing when it adds something. For an
  // ingredient already written in grams it would just repeat the line.
  return { text, hint: text === grams ? '' : grams };
}

/** The recipe's own number in the recipe's own unit, scaled; '' when there is none. */
function asWritten(row: ComputedRow, factor: number): string {
  const raw = row.ing.qty;
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';
  const qty = Number(raw) * factor;
  if (!Number.isFinite(qty)) return '';
  const rounded =
    Math.abs(qty - Math.round(qty)) < 0.01 ? Math.round(qty) : Math.round(qty * 100) / 100;
  return `${rounded} ${unitLabel(row.ing.unit)}`.trim();
}
