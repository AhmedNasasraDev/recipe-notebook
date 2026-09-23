// Personal calibration — the fix for B4 and B5.
//
// B4 (was measure.js:90):
//     list.filter(c => n.includes(c.name) || c.name.includes(n))
//   Bidirectional substring matching. A calibration recorded for "קמח" was
//   applied to "קמח שקדים" and presented as a green "כיול אישי · מדויק" badge.
//   Replaced by exact identity matching only. A near-miss is never applied
//   automatically; it is offered through `suggestCalibrations` so the user can
//   attach it explicitly.
//
// B5 (was measure.js:106):
//     const ml = hit.ml || (hit.tool ? toolMl(prefs, hit.tool) : null);
//   The density was recomputed from the CURRENT tool size, so changing the cup
//   setting silently rewrote every past calibration. Now every calibration
//   freezes `toolMl` at the moment it is taken, and nothing later can move it.

import type {
  Calibration,
  DensityHit,
  IngredientLike,
  MeasurementPrefs,
  ToolId,
} from './types.js';
import { TOOL_DEFAULTS, toolLabel, toolMl } from './units.js';
import { ingredientKeyOf, normalizeName, num } from './text.js';

export interface CalibrationInput {
  name: string;
  tool: ToolId;
  grams: number;
  ingredientKey?: string;
  at?: string;
  id?: string;
}

/**
 * Create a calibration, freezing the tool volume in effect right now.
 * This snapshot is what makes the record stable for the rest of its life (B5).
 */
export function createCalibration(
  input: CalibrationInput,
  prefs?: MeasurementPrefs,
): Calibration {
  const name = input.name.trim();
  const grams = num(input.grams);
  if (!name) throw new Error('calibration requires an ingredient name');
  if (!(grams > 0)) throw new Error('calibration requires grams > 0');
  return {
    id: input.id ?? `cal_${Date.now().toString(36)}`,
    ingredientKey: input.ingredientKey ?? ingredientKeyOf({ name }),
    name,
    tool: input.tool,
    toolMl: toolMl(prefs, input.tool),
    grams,
    at: input.at ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Bring a stored record up to the current shape.
 * A legacy record has no `toolMl`. We must not invent one from today's prefs —
 * that is exactly bug B5 — so we fall back to the documented factory default
 * and mark the record `toolMlAssumed` so the UI can ask the user to confirm.
 */
export function normalizeCalibration(
  raw: Partial<Calibration> & { ml?: number },
): Calibration | null {
  const name = (raw.name ?? '').trim();
  const tool = raw.tool;
  const grams = num(raw.grams);
  if (!name || !tool || !(grams > 0)) return null;
  const explicit = num(raw.toolMl, 0) || num(raw.ml, 0);
  // `toolMlAssumed` must survive re-normalisation: once a record has been
  // migrated it carries a real toolMl, and without this the "please confirm"
  // flag would silently disappear on the next pass.
  const assumed = explicit === 0 || raw.toolMlAssumed === true;
  return {
    id: raw.id ?? `cal_${normalizeName(name)}_${tool}`,
    ingredientKey: raw.ingredientKey ?? ingredientKeyOf({ name }),
    name,
    tool,
    toolMl: explicit === 0 ? TOOL_DEFAULTS[tool] : explicit,
    grams,
    at: raw.at,
    ...(assumed ? { toolMlAssumed: true } : {}),
  };
}

export function normalizeCalibrations(
  list: ReadonlyArray<Partial<Calibration> & { ml?: number }> | undefined,
): Calibration[] {
  return (list ?? [])
    .map(normalizeCalibration)
    .filter((c): c is Calibration => c !== null);
}

/** Grams per 100 ml implied by a calibration, from its frozen snapshot. */
export function calibrationGPer100(calib: Calibration): number {
  return (calib.grams / calib.toolMl) * 100;
}

/**
 * Upsert by (identity, tool) — one calibration per ingredient per tool.
 * Mirrors the legacy `addCalib` de-duplication, but on identity rather than
 * on a raw string compare.
 */
export function upsertCalibration(
  list: ReadonlyArray<Calibration>,
  next: Calibration,
): Calibration[] {
  const key = next.ingredientKey ?? ingredientKeyOf(next);
  return [
    ...list.filter(
      (c) => !((c.ingredientKey ?? ingredientKeyOf(c)) === key && c.tool === next.tool),
    ),
    next,
  ];
}

/**
 * Find the calibration that applies to this ingredient.
 * EXACT identity only. "קמח" does not answer for "קמח שקדים".
 *
 * `requestedTool` only affects the wording of the note: because the stored
 * density is grams-per-100-ml, a cup calibration is physically valid for a
 * tablespoon too (spec §18.4), and the note says so.
 */
export function findCalibration(
  ing: Pick<IngredientLike, 'name' | 'ingredientKey'>,
  prefs: MeasurementPrefs | undefined,
  requestedTool?: ToolId | null,
): DensityHit | null {
  const list = normalizeCalibrations(prefs?.calib);
  if (list.length === 0) return null;
  const key = ingredientKeyOf(ing);
  if (!key) return null;

  const matches = list.filter(
    (c) => (c.ingredientKey ?? ingredientKeyOf(c)) === key,
  );
  if (matches.length === 0) return null;

  // Prefer a calibration taken with the very tool being asked about, then the
  // most recent one. Deterministic either way.
  const hit =
    matches.find((c) => requestedTool != null && c.tool === requestedTool) ??
    matches.slice().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0];
  if (!hit) return null;

  const derived = requestedTool != null && hit.tool !== requestedTool;
  const parts = [
    `${toolLabel(hit.tool)} אחת = ${hit.grams} גרם`,
    `נמדד בכלי של ${round(hit.toolMl)} מ"ל`,
  ];
  if (derived) parts.push(`נגזר מהכיול של ${toolLabel(hit.tool)} ביחס נפח`);
  if (hit.toolMlAssumed) {
    parts.push('גודל הכלי לא נשמר בכיול הזה והונח לפי ברירת המחדל — כדאי לאמת');
  }

  return {
    gPer100: calibrationGPer100(hit),
    source: 'personal',
    densityKey: `calib:${hit.id ?? key}`,
    note: parts.join(' · '),
    needsReview: hit.toolMlAssumed === true,
  };
}

/**
 * Calibrations that are *related* to this name but are NOT the same ingredient.
 * The UI may offer these for the user to attach on purpose. Nothing here is
 * ever applied automatically — that was the whole of B4.
 */
export function suggestCalibrations(
  ing: Pick<IngredientLike, 'name' | 'ingredientKey'>,
  prefs: MeasurementPrefs | undefined,
): Array<{ calib: Calibration; reason: string }> {
  const list = normalizeCalibrations(prefs?.calib);
  const key = ingredientKeyOf(ing);
  const name = normalizeName(ing.name);
  if (!name) return [];
  const out: Array<{ calib: Calibration; reason: string }> = [];
  for (const c of list) {
    const ck = c.ingredientKey ?? ingredientKeyOf(c);
    if (ck === key) continue; // already applied by findCalibration
    const cn = normalizeName(c.name);
    if (!cn) continue;
    if (name.includes(cn) || cn.includes(name)) {
      out.push({
        calib: c,
        reason: `יש לכם כיול ל"${c.name}". זה לא אותו חומר גלם, ולכן הוא לא הוחל אוטומטית. אפשר להחיל אותו במפורש.`,
      });
    }
  }
  return out;
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}
