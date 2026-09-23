// Density resolution — the single entry point for "how heavy is a millilitre of
// this?". Precedence is exactly spec §5.1, and it is now the ONLY path: the
// recipe screen, the conversion drawer, the scaler, the cost engine and the
// importer all come through here. That is the structural fix for B1 and B2.

import type {
  DensityHit,
  IngredientLike,
  MeasurementPrefs,
  ToolId,
} from './types.js';
import {
  densityEntryByKey,
  isKnownDataGap,
  lookupDensity,
} from './data/density-table.js';
import { findCalibration } from './calibration.js';
import { numOrNull } from './text.js';
import { unit } from './units.js';

const CALIBRATE_HINT = 'אפשר לשקול כוס אחת ולהוסיף כיול אישי.';

export const NO_DENSITY_MESSAGE = (name: string | undefined): string =>
  `אין נתון אמין להמרת ${name?.trim() || 'הרכיב הזה'} בין נפח למשקל. ${CALIBRATE_HINT}`;

/**
 * Spec §5.1 precedence:
 *   1. personal   — the user's own calibration for this exact ingredient
 *   2. recipe     — ingredient.gPer100 typed into the recipe
 *   3. system     — a shared-table row that carries a value
 *   4. estimate   — a table row whose value swings with the ingredient's form
 *   5. null       — no reliable data. Never a number.
 *
 * A table row that exists but carries no value (`pending-verification` or
 * `pending-form`) lands in case 5 on purpose: the disagreement is real, so the
 * honest answer is "no number, here is why". `densityUnavailableReason` turns
 * that into a sentence the UI can show.
 *
 * `contextUnit` only picks the nicest calibration note; it never changes the
 * number, because a calibration is stored as g/100 ml.
 */
export function densityFor(
  ing: Pick<IngredientLike, 'name' | 'ingredientKey' | 'gPer100' | 'density'>,
  prefs?: MeasurementPrefs,
  contextUnit?: string | null,
): DensityHit | null {
  const tool: ToolId | null = unit(contextUnit)?.tool ?? null;

  // 1. personal — always wins, including for rows the table refuses to answer
  const cal = findCalibration(ing, prefs, tool);
  if (cal) return cal;

  // 2. recipe — ingredient.gPer100, or the legacy ingredient.density (g/ml)
  const fromRecipe = numOrNull(ing.gPer100);
  if (fromRecipe !== null && fromRecipe > 0) {
    return {
      gPer100: fromRecipe,
      source: 'recipe',
      note: 'נתון שהוזן במתכון עצמו',
      needsReview: false,
    };
  }
  const legacyDensity = numOrNull(ing.density);
  if (legacyDensity !== null && legacyDensity > 0) {
    return {
      gPer100: legacyDensity * 100,
      source: 'recipe',
      note: 'נתון צפיפות שהוזן במתכון (g/ml)',
      needsReview: false,
    };
  }

  // 3 + 4. the shared table, but only rows that actually carry a value
  const row = lookupDensity(ing.name);
  if (row && row.gPer100 != null) {
    return {
      gPer100: row.gPer100,
      source: row.confidence,
      densityKey: row.key,
      note: row.note ?? '',
      needsReview: row.needsReview === true,
    };
  }

  // 5. nothing usable. The caller must not substitute a number.
  return null;
}

/**
 * Why there is no density, in a sentence the UI can show as-is.
 * Distinguishes the three honest reasons so the user knows what to do next.
 */
export function densityUnavailableReason(
  ing: Pick<IngredientLike, 'name'>,
): string {
  const name = ing.name?.trim() || 'הרכיב הזה';

  if (isKnownDataGap(name)) {
    return `אין במערכת נתון צפיפות ל${name}. זה חומר גלם שונה מאלה שבטבלה, ולא נשתמש בערך של חומר גלם אחר. ${CALIBRATE_HINT}`;
  }

  const row = lookupDensity(name);
  if (!row) return NO_DENSITY_MESSAGE(name);

  if (row.resolution === 'pending-form') {
    const forms = (row.forms ?? [])
      .map((k) => densityEntryByKey(k)?.match[0])
      .filter(Boolean)
      .join(' · ');
    const formsText = forms ? ` (${forms})` : '';
    return `${name} נמדד אחרת בכל צורה${formsText}, ולכן אין לו ערך צפיפות אחד. אפשר לציין את הצורה, או ${CALIBRATE_HINT}`;
  }

  if (row.resolution === 'pending-verification') {
    const values = Object.values(row.sources)
      .map((v) => Math.round(v * 10) / 10)
      .sort((a, b) => a - b);
    const list = [...new Set(values)].join(' ו-');
    return `יש שני נתונים סותרים ל${name} (${list} גרם ל-100 מ"ל) שטרם אומתו, ולכן לא נציג אף אחד מהם. ${CALIBRATE_HINT}`;
  }

  return NO_DENSITY_MESSAGE(name);
}
