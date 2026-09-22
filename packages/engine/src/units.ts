// Unit catalog — ported verbatim from measure.js:8 (UNITS) and :27 (LEGACY).
// The only structural change: `g: 50` on the egg unit is renamed `itemG`, so a
// count unit's average item weight can never be mistaken for an exact gram
// factor the way it could in the legacy code.

import type { MeasurementPrefs, ToolId, UnitDef, UnitGroup } from './types.js';
import { num } from './text.js';

export const UNITS: readonly UnitDef[] = [
  { id: 'mg', he: 'מ"ג', short: 'מ"ג', group: 'weight', g: 0.001 },
  { id: 'g', he: 'גרם', short: "גר'", group: 'weight', g: 1 },
  { id: 'kg', he: 'ק"ג', short: 'ק"ג', group: 'weight', g: 1000 },
  { id: 'oz', he: 'אונקיה', short: 'oz', group: 'weight', g: 28.3495 },
  { id: 'ml', he: 'מ"ל', short: 'מ"ל', group: 'volume', ml: 1 },
  { id: 'l', he: 'ליטר', short: 'ליטר', group: 'volume', ml: 1000 },
  { id: 'floz', he: 'אונקיית נוזל', short: 'fl oz', group: 'volume', ml: 29.5735 },
  { id: 'shot', he: 'שוט', short: 'shot', group: 'volume', ml: 30 },
  { id: 'cup', he: 'כוס', group: 'volume', tool: 'cup' },
  { id: 'tbsp', he: 'כף', group: 'volume', tool: 'tbsp' },
  { id: 'tsp', he: 'כפית', group: 'volume', tool: 'tsp' },
  { id: 'unit', he: "יח'", group: 'count' },
  { id: 'egg', he: 'ביצה', group: 'count', itemG: 50 },
  { id: 'fruit', he: 'פרי', group: 'count' },
  { id: 'slice', he: 'פרוסה', group: 'count' },
];

const BY_ID: Record<string, UnitDef> = Object.fromEntries(
  UNITS.map((u) => [u.id, u]),
);

/** Hebrew unit names already stored inside saved recipes. */
export const LEGACY_UNIT_NAMES: Record<string, string> = {
  גרם: 'g',
  'ק"ג': 'kg',
  'מ"ל': 'ml',
  ליטר: 'l',
  כוס: 'cup',
  כף: 'tbsp',
  כפית: 'tsp',
  "יח'": 'unit',
};

export function unitId(u: string | undefined | null): string | null {
  if (!u) return null;
  if (BY_ID[u]) return u;
  return LEGACY_UNIT_NAMES[u] ?? null;
}

export function unit(u: string | undefined | null): UnitDef | null {
  const id = unitId(u);
  return id ? (BY_ID[id] ?? null) : null;
}

export function unitLabel(u: string | undefined | null): string {
  const x = unit(u);
  return x ? (x.short ?? x.he) : (u ?? '');
}

export function unitGroup(u: string | undefined | null): UnitGroup | null {
  return unit(u)?.group ?? null;
}

// ── measuring tools ─────────────────────────────────────────────────────────
// Ported from measure.js:34. These are DEFAULTS, never hard-coded constants in
// a calculation path — that hard-coding was bug B1.

export const TOOL_DEFAULTS: Record<ToolId, number> = {
  cup: 240,
  tbsp: 15,
  tsp: 5,
};

export const TOOL_OPTIONS: Record<ToolId, Array<{ ml: number; he: string }>> = {
  cup: [
    { ml: 240, he: 'תקן מטבח בינלאומי' },
    { ml: 250, he: 'כוס מטרית' },
    { ml: 236.6, he: '8 fl oz — כוס אמריקאית' },
    { ml: 266.2, he: '9 fl oz' },
    { ml: 295.7, he: '10 fl oz' },
  ],
  tbsp: [
    { ml: 15, he: 'תקן' },
    { ml: 14.8, he: '0.5 fl oz — ארה"ב' },
    { ml: 20, he: 'אוסטרליה' },
  ],
  tsp: [
    { ml: 5, he: 'תקן' },
    { ml: 4.93, he: 'ארה"ב' },
  ],
};

export function toolMl(
  prefs: MeasurementPrefs | undefined,
  tool: ToolId,
): number {
  return num(prefs?.tools?.[tool], 0) || TOOL_DEFAULTS[tool];
}

export function toolLabel(tool: ToolId): string {
  return tool === 'cup' ? 'כוס' : tool === 'tbsp' ? 'כף' : 'כפית';
}

/**
 * Millilitres in one of the given unit, resolved against the user's tools.
 * Returns null for weight and count units.
 */
export function mlPerUnit(
  u: string | undefined | null,
  prefs?: MeasurementPrefs,
): number | null {
  const x = unit(u);
  if (!x) return null;
  if (x.ml != null) return x.ml;
  if (x.tool) return toolMl(prefs, x.tool);
  return null;
}

/** Grams in one of the given unit. Returns null for volume and count units. */
export function gPerUnit(u: string | undefined | null): number | null {
  const x = unit(u);
  if (!x || x.group !== 'weight') return null;
  return x.g ?? null;
}
