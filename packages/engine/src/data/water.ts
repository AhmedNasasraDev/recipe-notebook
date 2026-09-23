// Water content per ingredient — the source for net hydration (spec §13).
// Ported verbatim from engine.js:18 (WATER_PCT). This was already a single
// source, so nothing had to be merged; it is moved here so the engine has one
// data directory.

export interface WaterEntry {
  match: string[];
  waterPct: number;
}

export const WATER_TABLE: readonly WaterEntry[] = [
  { match: ['חלב'], waterPct: 87 },
  { match: ['שמנת', 'קרם פרש'], waterPct: 65 },
  { match: ['ביצה', 'ביצים', "מלנג'"], waterPct: 75 },
  { match: ['חלמון'], waterPct: 50 },
  { match: ['חלבון'], waterPct: 88 },
  { match: ['יוגורט', 'לבנה'], waterPct: 85 },
  { match: ['דבש', 'סילאן', 'גלוקוז', 'אינוורט'], waterPct: 18 },
  { match: ['סירופ', 'מולסה'], waterPct: 25 },
  { match: ['שמן', 'קנולה', 'זית', 'חמניות'], waterPct: 0 },
  { match: ['חמאה'], waterPct: 16 },
  { match: ['מיץ', 'פירה', 'פולפה'], waterPct: 88 },
  { match: ['ליקר', 'רום', 'ברנדי', 'וודקה'], waterPct: 60 },
];

/**
 * engine.js:29 fell back to 100% for any unrecognised liquid, which silently
 * inflates net hydration. Kept for behavioural parity, but named and exported
 * so a caller can tell an assumption from a measurement.
 */
export const WATER_PCT_FALLBACK = 100;

export function lookupWaterPct(name: string | undefined): {
  waterPct: number;
  assumed: boolean;
} {
  const n = (name ?? '').trim();
  for (const row of WATER_TABLE) {
    if (row.match.some((k) => n.includes(k))) {
      return { waterPct: row.waterPct, assumed: false };
    }
  }
  return { waterPct: WATER_PCT_FALLBACK, assumed: true };
}
