// Unit conversion — the single conversion path for the whole product.
//
// B1 (was engine.js:43): `toGrams(ing)` took no prefs, hard-coded a 240 ml cup
//   and its own gram-per-cup table, and derived tablespoon/teaspoon as cup/16
//   and cup/48. Every calculation in the app went through it, so the user's
//   measuring-tool settings changed nothing outside the conversion drawer.
//   `toGrams` now takes prefs and resolves every volume unit through
//   mlPerUnit() × the shared density table.
//
// B3 (was the recipe screen handing the drawer a pre-converted gram figure):
//   conversions now always start from the unit the RECIPE stores, the original
//   qty/unit travel with the result, and the reported confidence is the weakest
//   link of the whole chain — see provenance.ts.

import type {
  ConversionResult,
  GramsResult,
  IngredientLike,
  MeasurementPrefs,
  ProvenanceStep,
  Source,
} from './types.js';
import {
  buildProvenance,
  unavailableProvenance,
} from './provenance.js';
import { densityFor, densityUnavailableReason } from './density.js';
import { formatForUnit } from './format.js';
import { num } from './text.js';
import {
  gPerUnit,
  mlPerUnit,
  toolLabel,
  toolMl,
  unit,
  unitLabel,
} from './units.js';

const SUB_RECIPE_NOTE = 'רכיב שהוא מתכון בסיס נמדד במשקל בלבד.';

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

function toolNoteFor(
  fromUnit: string | undefined,
  toUnit: string | undefined,
  prefs?: MeasurementPrefs,
): string | undefined {
  const f = unit(fromUnit);
  const t = unit(toUnit);
  const tool = f?.tool ?? t?.tool;
  if (!tool) return undefined;
  return `${toolLabel(tool)} = ${round(toolMl(prefs, tool))} מ"ל לפי ההגדרות שלך`;
}

/**
 * Grams per item, for pricing a row whose price is per ITEM.
 *
 * ADDED IN STAGE 7, and the reason is recorded here because changing the engine
 * needs one. `compute()` costs a row from its weight in grams, and it
 * special-cased a per-litre price but nothing else — so a price in `יח'` fell
 * through to the per-kilogram formula. Three eggs at ₪1.30 each came out at
 * ₪0.21 instead of ₪3.90, with no warning. `יח'` is a selectable price unit in
 * the editor and a legal value in the database, so this was reachable from the
 * UI and wrong by a factor of eighteen.
 *
 * Pricing per item needs one thing the cost branch could not get: how much one
 * item weighs. `itemGrams` below already knows, so this exports it rather than
 * computing a second answer — the recipe's own `unitWeight` first, then the
 * unit table's average, and null when neither exists.
 *
 * Returns null when the item weight is unknown, which is not the same as zero:
 * the caller must report that it cannot price the row rather than costing it
 * at nothing.
 */
export function gramsPerItem(
  ing: Pick<IngredientLike, 'unitWeight' | 'unit'>,
  countUnitId?: string,
): number | null {
  return itemGrams(ing, countUnitId ?? unit(ing.unit)?.id)?.grams ?? null;
}

/** Grams per item for a count unit: the recipe's value, else the unit average. */
function itemGrams(
  ing: Pick<IngredientLike, 'unitWeight'>,
  countUnitId: string | undefined,
): { grams: number; source: Source; note: string } | null {
  const own = num(ing.unitWeight, 0);
  if (own > 0) {
    return {
      grams: own,
      source: 'recipe',
      note: 'משתמש במשקל היחידה שהוזן במתכון.',
    };
  }
  const avg = unit(countUnitId)?.itemG;
  if (avg != null && avg > 0) {
    return {
      grams: avg,
      source: 'estimate',
      note: `משתמש במשקל ממוצע (${avg} גרם ליחידה). מומלץ לשקול.`,
    };
  }
  return null;
}

/**
 * Weight of an ingredient line, in grams.
 *
 * Returns `grams: null` when there is no reliable way to know — the caller must
 * surface that, not substitute a number (spec §5.1 rule 5, §18.1).
 */
export function toGrams(
  ing: IngredientLike,
  prefs?: MeasurementPrefs,
): GramsResult {
  const qty = num(ing.qty, 0);
  const u = unit(ing.unit);
  const uid = u?.id;

  if (!u) {
    return {
      grams: null,
      provenance: unavailableProvenance(
        `יחידה לא מזוהה: ${ing.unit ?? '—'}`,
      ),
    };
  }
  if (qty === 0) {
    return {
      grams: 0,
      provenance: buildProvenance([
        { from: uid!, to: 'g', source: 'exact', note: 'כמות אפס.' },
      ]),
    };
  }

  if (u.group === 'weight') {
    const g = gPerUnit(uid)!;
    return {
      grams: qty * g,
      provenance: buildProvenance(
        [{ from: uid!, to: 'g', source: 'exact', note: 'המרת משקל למשקל היא יחס קבוע.' }],
        { toolNote: toolNoteFor(ing.unit, 'g', prefs) },
      ),
    };
  }

  if (u.group === 'volume') {
    const ml = mlPerUnit(uid, prefs);
    if (ml == null) {
      return {
        grams: null,
        provenance: unavailableProvenance('אין גודל כלי מוגדר'),
      };
    }
    const d = densityFor(ing, prefs, uid);
    if (!d) {
      return {
        grams: null,
        provenance: unavailableProvenance(densityUnavailableReason(ing)),
      };
    }
    const grams = (qty * ml * d.gPer100) / 100;
    const step: ProvenanceStep = {
      from: uid!,
      to: 'g',
      source: d.source,
      gPer100: d.gPer100,
      note: `${d.note ? d.note + '. ' : ''}${round(d.gPer100)} גרם ל־100 מ"ל.`,
    };
    if (d.densityKey) step.densityKey = d.densityKey;
    return {
      grams,
      provenance: buildProvenance([step], {
        toolNote: toolNoteFor(ing.unit, 'g', prefs),
        needsReview: d.needsReview,
      }),
    };
  }

  // count
  const per = itemGrams(ing, uid);
  if (!per) {
    return {
      grams: null,
      provenance: unavailableProvenance(
        'אין משקל ליחידה. אפשר להזין אותו בעריכת הרכיב.',
      ),
    };
  }
  return {
    grams: qty * per.grams,
    provenance: buildProvenance([
      { from: uid!, to: 'g', source: per.source, note: per.note },
    ]),
  };
}

/**
 * Convert an ingredient line to another unit.
 *
 * The input is the line as the RECIPE stores it — `{ name, qty, unit }`. Never
 * pass a pre-converted gram figure; use `convertScaled` when the screen shows a
 * scaled amount.
 */
export function convert(
  ing: IngredientLike,
  toUnit: string,
  prefs?: MeasurementPrefs,
): ConversionResult {
  const qty = num(ing.qty, 0);
  const from = unit(ing.unit);
  const to = unit(toUnit);
  const original = {
    qty,
    unit: ing.unit ?? '',
    label: `${qty} ${unitLabel(ing.unit)}`.trim(),
  };
  const toolNote = toolNoteFor(ing.unit, toUnit, prefs);

  const fail = (why: string): ConversionResult => ({
    ok: false,
    why,
    original,
    provenance: unavailableProvenance(why),
  });

  if (!from || !to) return fail('יחידה לא מזוהה');
  if (!qty) return fail('אין כמות להמיר');

  if (ing.subId && to.group !== 'weight') return fail(SUB_RECIPE_NOTE);

  // ── same family, no density needed: a fixed ratio ────────────────────────
  if (from.group === to.group && from.group !== 'count') {
    const a =
      from.group === 'weight' ? gPerUnit(from.id) : mlPerUnit(from.id, prefs);
    const b = to.group === 'weight' ? gPerUnit(to.id) : mlPerUnit(to.id, prefs);
    if (!a || !b) return fail('אין גודל כלי מוגדר');
    const value = (qty * a) / b;
    const why =
      from.group === 'weight'
        ? 'המרת משקל למשקל היא יחס קבוע.'
        : 'המרת נפח לנפח היא יחס קבוע לפי גודל הכלי.';
    return {
      ok: true,
      value,
      text: formatForUnit(value, to.id),
      grams: from.group === 'weight' ? qty * a : null,
      original,
      provenance: buildProvenance(
        [{ from: from.id, to: to.id, source: 'exact', note: why }],
        { why, toolNote },
      ),
    };
  }

  if (from.group === 'count' && to.group === 'count') {
    if (from.id === to.id) {
      return {
        ok: true,
        value: qty,
        text: formatForUnit(qty, to.id),
        grams: null,
        original,
        provenance: buildProvenance([
          { from: from.id, to: to.id, source: 'exact', note: 'אותה יחידה.' },
        ]),
      };
    }
  }

  // ── everything else goes through grams ───────────────────────────────────
  const g = toGrams(ing, prefs);
  if (g.grams === null) return fail(g.provenance.why);
  const chain = [...g.provenance.chain];
  let needsReview = g.provenance.needsReview;

  if (to.group === 'weight') {
    const b = gPerUnit(to.id)!;
    const value = g.grams / b;
    chain.push({
      from: 'g',
      to: to.id,
      source: 'exact',
      note: 'המרת משקל למשקל היא יחס קבוע.',
    });
    return {
      ok: true,
      value,
      text: formatForUnit(value, to.id),
      grams: g.grams,
      original,
      provenance: buildProvenance(chain, { toolNote, needsReview }),
    };
  }

  if (to.group === 'volume') {
    const ml = mlPerUnit(to.id, prefs);
    if (ml == null) return fail('אין גודל כלי מוגדר');
    const d = densityFor(ing, prefs, to.id);
    if (!d) return fail(densityUnavailableReason(ing));
    needsReview = needsReview || d.needsReview;
    const value = ((g.grams / d.gPer100) * 100) / ml;
    const step: ProvenanceStep = {
      from: 'g',
      to: to.id,
      source: d.source,
      gPer100: d.gPer100,
      note: `${d.note ? d.note + '. ' : ''}${round(d.gPer100)} גרם ל־100 מ"ל.`,
    };
    if (d.densityKey) step.densityKey = d.densityKey;
    chain.push(step);
    return {
      ok: true,
      value,
      text: formatForUnit(value, to.id),
      grams: g.grams,
      original,
      provenance: buildProvenance(chain, { toolNote, needsReview }),
    };
  }

  // to count
  const per = itemGrams(ing, to.id);
  if (!per) {
    return fail('אין משקל ליחידה. אפשר להזין אותו בעריכת הרכיב.');
  }
  const value = g.grams / per.grams;
  chain.push({ from: 'g', to: to.id, source: per.source, note: per.note });
  return {
    ok: true,
    value,
    text: formatForUnit(value, to.id),
    grams: g.grams,
    original,
    provenance: buildProvenance(chain, { toolNote, needsReview }),
  };
}

/**
 * Convert the SCALED amount of an ingredient while keeping the original unit as
 * the starting point. This is what the conversion drawer must call when the
 * recipe screen is showing scaled quantities.
 *
 * The legacy screen instead passed `qty: row.g, unit: 'גרם'`, which threw away
 * the original unit and made a table estimate look like an exact g→g ratio.
 */
export function convertScaled(
  ing: IngredientLike,
  factor: number,
  toUnit: string,
  prefs?: MeasurementPrefs,
): ConversionResult {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const scaled: IngredientLike = { ...ing, qty: num(ing.qty, 0) * f };
  const result = convert(scaled, toUnit, prefs);
  // `original` must still describe the recipe, not the scaled figure.
  const original = {
    qty: num(ing.qty, 0),
    unit: ing.unit ?? '',
    label: `${num(ing.qty, 0)} ${unitLabel(ing.unit)}`.trim(),
  };
  return { ...result, original } as ConversionResult;
}

/**
 * The best home-measure rendering of a gram amount, for the "ביתי" view.
 * Ported from the prototype's `homeLabel`, but it now keeps the original unit
 * so the badge stays honest.
 */
export function homeMeasure(
  ing: IngredientLike,
  factor: number,
  prefs?: MeasurementPrefs,
): ConversionResult | null {
  for (const u of ['cup', 'tbsp', 'tsp'] as const) {
    const res = convertScaled(ing, factor, u, prefs);
    if (!res.ok) return null;
    if (res.value >= 0.24 || u === 'tsp') return res;
  }
  return null;
}
