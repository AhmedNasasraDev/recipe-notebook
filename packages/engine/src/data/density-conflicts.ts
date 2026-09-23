// Conflict report, DERIVED from density-table.ts rather than hand-written, so it
// can never drift from the data it describes.
//
// Approved policy: a disagreement is reported, never averaged and never settled
// by keeping "whatever was there before". A row only carries a value when one
// uncontradicted source covers it; otherwise it stays unvalued and appears here.

import {
  CONFLICT_TOLERANCE_PCT,
  DENSITY_TABLE,
  KNOWN_DATA_GAPS,
  LEGACY_CUP_ML,
  type DensityEntry,
  type LegacySource,
  type Resolution,
} from './density-table.js';

export interface DensityConflict {
  key: string;
  ingredient: string;
  resolution: Resolution;
  /** the value in use, or null when none was adopted */
  resolved: number | null;
  /** every legacy value on record for this row, awaiting a ruling */
  candidates: Array<{ source: LegacySource; gPer100: number }>;
  /** widest relative gap between candidates, 0 when there is one or none */
  maxDeltaPct: number;
  /** sibling forms, for rows split by physical form */
  forms?: string[];
  reviewNote: string;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === 0) return 0;
  return Math.round(((max - min) / min) * 1000) / 10;
}

function toConflict(entry: DensityEntry): DensityConflict {
  const candidates = (
    Object.entries(entry.sources) as Array<[LegacySource, number]>
  ).map(([source, gPer100]) => ({ source, gPer100 }));
  return {
    key: entry.key,
    ingredient: entry.match[0] ?? entry.key,
    resolution: entry.resolution,
    resolved: entry.gPer100,
    candidates,
    maxDeltaPct: spread(candidates.map((c) => c.gPer100)),
    ...(entry.forms ? { forms: entry.forms } : {}),
    reviewNote: entry.reviewNote ?? '',
  };
}

/** Everything a human still has to look at. */
export const DENSITY_CONFLICTS: readonly DensityConflict[] = DENSITY_TABLE
  .filter((e) => e.needsReview === true)
  .map(toConflict)
  .sort((a, b) => b.maxDeltaPct - a.maxDeltaPct);

/** Sources disagree; no value adopted. The engine answers `unavailable`. */
export const PENDING_VERIFICATION: readonly DensityConflict[] =
  DENSITY_CONFLICTS.filter((c) => c.resolution === 'pending-verification');

/** The name covers several physical forms; no value until each form is measured. */
export const PENDING_FORM: readonly DensityConflict[] =
  DENSITY_CONFLICTS.filter((c) => c.resolution === 'pending-form');

/** One uncontradicted source; the value is in use but wants a second opinion. */
export const ACCEPTED_SINGLE_SOURCE: readonly DensityConflict[] =
  DENSITY_CONFLICTS.filter((c) => c.resolution === 'accepted-single-source');

/** Rows whose sources agree and which need no further attention. */
export const ACCEPTED: readonly string[] = DENSITY_TABLE.filter(
  (e) => e.resolution === 'accepted',
).map((e) => e.key);

/**
 * Cases where a legacy table had NO row and silently used its invented fallback,
 * while another table does hold a real value. Not a disagreement between two
 * claims — a disagreement between a claim and a guess.
 */
export interface FallbackDivergence {
  key: string;
  ingredient: string;
  tableValue: number;
  legacyFallback: number;
  deltaPct: number;
  legacySource: LegacySource;
}

const FALLBACK_DRY_G_PER_100 = (150 / LEGACY_CUP_ML) * 100; // 62.5

export const FALLBACK_DIVERGENCES: readonly FallbackDivergence[] = (
  [
    ['starch.corn', 'קורנפלור', 50],
    ['yogurt', 'יוגורט', 104],
    ['leaven.chemical', 'אבקת אפייה', 92],
    ['yeast.dry', 'שמרים יבשים', 62],
    ['coffee.liquid', 'אספרסו', 100],
    ['coffee.ground', 'קפה טחון', 42],
  ] as Array<[string, string, number]>
).map(([key, ingredient, tableValue]) => ({
  key,
  ingredient,
  tableValue,
  legacyFallback: FALLBACK_DRY_G_PER_100,
  deltaPct:
    Math.round(((FALLBACK_DRY_G_PER_100 - tableValue) / tableValue) * 1000) / 10,
  legacySource: 'engine.CUP_DRY' as LegacySource,
}));

/** Legacy match terms that look mis-filed. Kept verbatim; flagged, not changed. */
export const SUSPECT_TERMS: readonly {
  term: string;
  filedUnder: string;
  looksLike: string;
  effect: string;
}[] = [
  {
    term: 'אבקת סוכר וניל',
    filedUnder: 'sugar.granulated (83 g/100ml)',
    looksLike: 'sugar.powdered (46 g/100ml)',
    effect:
      'חיפוש לפי סדר מחזיר את שורת אבקת הסוכר (46) ולכן התוצאה בפועל נכונה. המונח נשמר כפי שהיה.',
  },
  {
    term: 'חלבון',
    filedUnder: 'egg.white',
    looksLike: 'גם חלק מהשם "קמח לחם 13% חלבון"',
    effect:
      'שורת הקמח מופיעה לפניה בסדר החיפוש, ובנוסף יש החרגה מפורשת של "קמח" בשורות הביצה.',
  },
];

/**
 * The legacy "we do not know, so here is a number anyway" fallbacks.
 * REMOVED from the lookup path by approved decision §7. Kept here so nothing is
 * lost and so a migration can compare old and new behaviour.
 *
 * Spec §5.1 rule 5 and §18.1: no reliable data → no number.
 */
export const LEGACY_INVENTED_FALLBACKS = {
  /** engine.js:40 and parser.js:26 — any unrecognised dry ingredient */
  dryGramsPerCup: 150,
  dryGPer100AtLegacyCup: FALLBACK_DRY_G_PER_100,
  /** engine.js:16 — any unrecognised liquid */
  liquidGPerMl: 1.0,
  liquidGPer100: 100,
  /** engine.js:25 — any unrecognised liquid's water content */
  waterPctDefault: 100,
} as const;

/**
 * Ingredients the table refuses to answer for, and what the prototype used to
 * say instead. Approved decision §6: leave them unresolved, do not guess.
 */
export const KNOWN_GAPS: readonly {
  name: string;
  legacyAnswerGramsPerCup: number;
  legacyVia: string;
}[] = KNOWN_DATA_GAPS.map((name) =>
  name.startsWith('קמח')
    ? {
        name,
        legacyAnswerGramsPerCup: 120,
        legacyVia: "engine.CUP_DRY matched the substring 'קמח'",
      }
    : {
        name,
        legacyAnswerGramsPerCup: LEGACY_INVENTED_FALLBACKS.dryGramsPerCup,
        legacyVia: 'engine.CUP_DRY fell through to its 150 g/cup default',
      },
);

/**
 * Defects the merge itself uncovered: engine.cupGrams only consulted engine.DENS
 * when the name matched an internal liquid regex, so an ingredient that WAS in
 * one of its own tables still fell through to the 150 g/cup guess.
 */
export const SPLIT_TABLE_ERRORS: readonly {
  name: string;
  legacyGramsPerCup: number;
  mergedGramsPerCup: number;
  factor: number;
  cause: string;
}[] = [
  {
    name: 'דבש / סילאן / גלוקוז / מייפל / אינוורט',
    legacyGramsPerCup: 150,
    mergedGramsPerCup: 142 * 2.4,
    factor: (142 * 2.4) / 150,
    cause:
      "engine.DENS knew honey was 1.42 g/ml, but engine.cupGrams only consulted it when the name matched its liquid regex /מים|חלב|שמנת|שמן|מיץ|יין|ביצ/ — honey does not. Any cup or spoon of honey was weighed and costed at 150 g/cup instead of 340.8.",
  },
  {
    name: 'סירופ / מולסה',
    legacyGramsPerCup: 150,
    mergedGramsPerCup: 133 * 2.4,
    factor: (133 * 2.4) / 150,
    cause: 'Same cause: present in engine.DENS (1.33) but outside the liquid regex.',
  },
  {
    name: 'יוגורט / לבנה / שמנת חמוצה',
    legacyGramsPerCup: 150,
    mergedGramsPerCup: 104 * 2.4,
    factor: (104 * 2.4) / 150,
    cause:
      'Present in measure.TABLE (104) but absent from both engine tables and from the liquid regex.',
  },
];

/** One-line summary, handy for a status screen or a CI log. */
export function conflictSummary(): {
  rows: number;
  accepted: number;
  acceptedSingleSource: number;
  pendingVerification: number;
  pendingForm: number;
  knownGaps: number;
  tolerancePct: number;
} {
  return {
    rows: DENSITY_TABLE.length,
    accepted: ACCEPTED.length,
    acceptedSingleSource: ACCEPTED_SINGLE_SOURCE.length,
    pendingVerification: PENDING_VERIFICATION.length,
    pendingForm: PENDING_FORM.length,
    knownGaps: KNOWN_DATA_GAPS.length,
    tolerancePct: CONFLICT_TOLERANCE_PCT,
  };
}
