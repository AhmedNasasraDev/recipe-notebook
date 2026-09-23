// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for ingredient density.
//
// Replaces all four legacy tables:
//   engine.js:31  CUP_DRY   (grams per cup)
//   engine.js:3   DENS      (grams per millilitre, liquids)
//   measure.js:55 TABLE     (grams per 100 ml)
//   parser.js:3   DRY       (grams per cup)
//
// Canonical unit is grams per 100 ml — the only one of the four that does not
// depend on how big a cup happens to be.
//
// RESOLUTION POLICY (approved, stage 1):
//  1. No value is ever chosen by averaging, nor by "whatever was there before".
//  2. Where a disagreement exists because the sources describe DIFFERENT FORMS
//     of the same ingredient, the ingredient is split into separate entities and
//     NONE of them carries a value until each form has a verified one. A bare,
//     form-less name never resolves to a single exact density.
//  3. Where two sources simply disagree, NEITHER is adopted. `gPer100` stays
//     null and the row is `pending-verification`.
//  4. A row with one uncontradicted source keeps its value and is flagged
//     `accepted-single-source`.
//  5. Every legacy value is preserved in `sources`. Nothing is discarded, and
//     when `gPer100` is null those sources are the candidates awaiting a ruling.
//  6. No density value in this file was invented. Every number traces to a
//     legacy source recorded beside it.
//
// `gPer100: null` means the engine answers `unavailable` and the UI offers a
// personal calibration — spec §5.1 rule 5.
//
// Lookup is ORDER-BASED: the first row whose `match` hits wins. The order is
// copied from measure.TABLE because it encodes specificity ('קמח מלא' before
// 'קמח', 'אבקת סוכר' before 'סוכר'), with form rows before their form-less row.
// ─────────────────────────────────────────────────────────────────────────────

import type { Source } from '../types.js';

/** Legacy tables are quoted at the 240 ml cup they hard-coded. */
export const LEGACY_CUP_ML = 240;

/** Above this relative difference two legacy values are treated as a conflict. */
export const CONFLICT_TOLERANCE_PCT = 3;

export type Resolution =
  /** sources agree — value in use */
  | 'accepted'
  /** one uncontradicted source — value in use, flagged for a second opinion */
  | 'accepted-single-source'
  /** sources disagree — no value adopted, answers `unavailable` */
  | 'pending-verification'
  /** the name covers several physical forms — no value until split and verified */
  | 'pending-form';

export type LegacySource =
  | 'measure.TABLE'
  | 'engine.CUP_DRY'
  | 'engine.DENS'
  | 'parser.DRY';

export interface DensityEntry {
  /** stable machine key — safe to store in a database */
  key: string;
  /** Hebrew substrings, ordered most specific first */
  match: string[];
  /**
   * Names that must NOT resolve through this row even though they contain one
   * of its `match` terms. Guards the same failure class as B4 at the table
   * layer: "קמח" must not answer for "קמח שקדים".
   */
  exclude?: string[];
  /**
   * Match this row's terms as whole Hebrew words rather than as substrings.
   * Needed for short terms that live inside unrelated words: 'מים' is inside
   * "שקדים שלמים", and 'חלב' is inside "חלבון". The legacy tables had the same
   * flaw — it was invisible only because engine.DENS happened to give milk and
   * egg white the same 1.03.
   */
  wordMatch?: boolean;
  /** grams per 100 ml, or null when no value may be used yet */
  gPer100: number | null;
  confidence: Extract<Source, 'system' | 'estimate'>;
  resolution: Resolution;
  note?: string;
  /** every legacy value found for this ingredient, in g/100 ml */
  sources: Partial<Record<LegacySource, number>>;
  /** true whenever a human still has to look at this row */
  needsReview?: boolean;
  reviewNote?: string;
  /** for `pending-form` rows: the sibling forms this ingredient splits into */
  forms?: string[];
}

const cup = (gPerCup: number) => round2((gPerCup / LEGACY_CUP_ML) * 100);
const dens = (gPerMl: number) => round2(gPerMl * 100);
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ingredients we KNOW are distinct from anything in this table and for which we
 * have no value at all. Refused before row matching, so a general term can never
 * answer for them. Filling these in is a DATA task needing professional input.
 */
export const KNOWN_DATA_GAPS: readonly string[] = [
  'קמח קוקוס',
  'קמח חומוס',
  'קמח תירס',
  'קמח אורז',
  'קמח כוסמת',
  'קמח טפיוקה',
  'קמח קינואה',
  'קמח חרובים',
  'קמח סויה',
  'אבקת חלב',
  'אבקת חלבון',
];

/** Second line of defence on the flour rows themselves. */
const NON_WHEAT_FLOURS = [
  'שקדים',
  'שקד',
  'קוקוס',
  'חומוס',
  'תירס',
  'אורז',
  'כוסמת',
  'טפיוקה',
  'קינואה',
  'חרובים',
  'סויה',
];

export const DENSITY_TABLE: readonly DensityEntry[] = [
  // ── flours ────────────────────────────────────────────────────────────────
  {
    key: 'flour.wholemeal',
    match: ['קמח מלא', 'כוסמין'],
    exclude: NON_WHEAT_FLOURS,
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-verification',
    note: 'כוס מכופלת בכף, בלי לדחוס',
    sources: { 'measure.TABLE': 54, 'engine.CUP_DRY': cup(120) },
    needsReview: true,
    reviewNote:
      'measure.TABLE נותן 54, ו-engine.CUP_DRY נתן 120 גר\' לכוס (=50) כי לא הבדיל בין קמח מלא לקמח לבן. פער 7.4%. אין ערך בשימוש עד אימות.',
  },
  {
    key: 'flour.white',
    match: ['קמח תופח', 'קמח לבן', 'קמח'],
    exclude: NON_WHEAT_FLOURS,
    gPer100: 50,
    confidence: 'system',
    resolution: 'accepted',
    note: 'כוס מכופלת בכף, בלי לדחוס',
    sources: {
      'measure.TABLE': 50,
      'engine.CUP_DRY': cup(120),
      'parser.DRY': cup(120),
    },
  },

  // ── starches and sugars ───────────────────────────────────────────────────
  {
    key: 'starch.corn',
    match: ['קורנפלור', 'קורן פלור', 'עמילן'],
    gPer100: 50,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 50 },
    needsReview: true,
    reviewNote: 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.',
  },
  {
    key: 'sugar.powdered',
    match: ['אבקת סוכר'],
    gPer100: 46,
    confidence: 'system',
    resolution: 'accepted',
    sources: {
      'measure.TABLE': 46,
      'engine.CUP_DRY': cup(110),
      'parser.DRY': cup(110),
    },
  },
  {
    key: 'cocoa',
    match: ['קקאו'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-verification',
    sources: {
      'measure.TABLE': 42,
      'engine.CUP_DRY': cup(110),
      'parser.DRY': cup(110),
    },
    needsReview: true,
    reviewNote:
      'measure.TABLE נותן 42. engine.CUP_DRY ו-parser.DRY נתנו 110 גר\' לכוס (=45.8) כי קיבצו קקאו יחד עם אבקת סוכר. פער 9.1%. אין ערך בשימוש עד אימות.',
  },
  {
    key: 'sugar.brown',
    match: ['סוכר חום', 'דמררה', 'מוסקובדו'],
    gPer100: 79,
    confidence: 'system',
    resolution: 'accepted',
    note: 'נמדד דחוס קלות',
    sources: {
      'measure.TABLE': 79,
      'engine.CUP_DRY': cup(190),
      'parser.DRY': cup(190),
    },
  },
  {
    key: 'sugar.granulated',
    // 'אבקת סוכר וניל' is listed here in measure.TABLE. Order-based lookup means
    // the powdered-sugar row above wins for that name, which is the sane result.
    // Kept verbatim so no legacy term is lost. See CONFLICTS.md → suspect terms.
    match: ['אבקת סוכר וניל', 'סוכר'],
    gPer100: 83,
    confidence: 'system',
    resolution: 'accepted',
    sources: {
      'measure.TABLE': 83,
      'engine.CUP_DRY': cup(200),
      'parser.DRY': cup(200),
    },
  },

  // ── fats and dairy ────────────────────────────────────────────────────────
  {
    key: 'butter',
    match: ['חמאה', 'מרגרינה'],
    gPer100: 95,
    confidence: 'system',
    resolution: 'accepted',
    note: 'רכה, נדחסת לכלי',
    sources: {
      'measure.TABLE': 95,
      'engine.CUP_DRY': cup(227),
      'parser.DRY': cup(227),
    },
  },
  {
    key: 'water',
    match: ['מים'],
    wordMatch: true,
    gPer100: 100,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 100, 'engine.DENS': dens(1.0) },
  },
  {
    key: 'milk',
    match: ['חלב'],
    exclude: ['אבקת חלב'],
    wordMatch: true,
    gPer100: 103,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 103, 'engine.DENS': dens(1.03) },
  },
  {
    key: 'cream',
    match: ['שמנת', 'קרם פרש', 'מסקרפונה'],
    gPer100: 99,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 99, 'engine.DENS': dens(0.99) },
  },
  {
    key: 'yogurt',
    match: ['יוגורט', 'לבנה', 'שמנת חמוצה'],
    gPer100: 104,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 104 },
    needsReview: true,
    reviewNote: 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.',
  },
  {
    key: 'oil',
    match: ['שמן', 'קנולה', 'זית', 'חמניות'],
    gPer100: 92,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 92, 'engine.DENS': dens(0.92) },
  },

  // ── syrups ────────────────────────────────────────────────────────────────
  {
    key: 'syrup.invert',
    match: ['דבש', 'סילאן', 'גלוקוז', 'מייפל', 'אינוורט'],
    gPer100: 142,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 142, 'engine.DENS': dens(1.42) },
  },
  {
    key: 'syrup.thick',
    match: ['סירופ', 'מולסה'],
    gPer100: dens(1.33),
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'engine.DENS': dens(1.33) },
    needsReview: true,
    reviewNote:
      'קיים רק ב-engine.DENS (1.33). אין שורה מקבילה ב-measure.TABLE ולכן אין מקור שני לאימות.',
  },

  // ── seasoning and leaven ──────────────────────────────────────────────────
  {
    key: 'salt',
    match: ['מלח'],
    gPer100: 121,
    confidence: 'system',
    resolution: 'accepted',
    note: 'מלח שולחן דק',
    sources: {
      'measure.TABLE': 121,
      'engine.CUP_DRY': cup(290),
      'parser.DRY': cup(290),
    },
  },
  {
    key: 'leaven.chemical',
    match: ['אבקת אפייה', 'סודה לשתייה'],
    gPer100: 92,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 92 },
    needsReview: true,
    reviewNote: 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.',
  },
  {
    key: 'yeast.dry',
    match: ['שמרים יבשים', 'שמרים אינסטנט'],
    gPer100: 62,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 62 },
    needsReview: true,
    reviewNote: 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.',
  },

  // ── chocolate ─────────────────────────────────────────────────────────────
  {
    key: 'chocolate',
    match: ['שוקולד', "צ'יפס שוקולד"],
    gPer100: 71,
    confidence: 'estimate',
    resolution: 'accepted',
    note: 'תלוי בגודל הפיסות',
    sources: { 'measure.TABLE': 71, 'engine.CUP_DRY': cup(170) },
  },

  // ── nuts: split by form. NONE carries a value yet (approved decision §2) ──
  // The two legacy values describe two different forms: measure.TABLE's 42 fits
  // ground nuts, engine.CUP_DRY's 66.7 fits whole nuts. Assigning them to those
  // forms would be an inference, not verified data, so both stay candidates.
  {
    key: 'nuts.ground',
    match: [
      'אבקת שקדים',
      'שקדים טחונים',
      'שקד טחון',
      'אגוזים טחונים',
      'אגוז טחון',
      'פיסטוק טחון',
      'אבקת פיסטוק',
      'אבקת אגוזים',
      'קמח שקדים',
    ],
    gPer100: null,
    confidence: 'estimate',
    resolution: 'pending-form',
    forms: ['nuts.ground', 'nuts.chopped', 'nuts.whole'],
    sources: { 'measure.TABLE': 42 },
    needsReview: true,
    reviewNote:
      'הערך 42 של measure.TABLE מתאים לצורה הטחונה, אבל הוא נמדד לשורה מקובצת ולא לצורה הזו במפורש. דרוש נתון מאומת לאגוז טחון.',
  },
  {
    key: 'nuts.chopped',
    match: [
      'שקדים קצוצים',
      'שקדים פרוסים',
      'אגוזים קצוצים',
      'אגוז קצוץ',
      'פקאן קצוץ',
      'פיסטוק קצוץ',
    ],
    gPer100: null,
    confidence: 'estimate',
    resolution: 'pending-form',
    forms: ['nuts.ground', 'nuts.chopped', 'nuts.whole'],
    sources: {},
    needsReview: true,
    reviewNote:
      'אין לצורה הזו נתון באף אחת מארבע הטבלאות. דרושה מדידה.',
  },
  {
    key: 'nuts.whole',
    match: ['שקדים שלמים', 'שקד שלם', 'אגוזים שלמים', 'אגוז שלם', 'פקאן שלם'],
    gPer100: null,
    confidence: 'estimate',
    resolution: 'pending-form',
    forms: ['nuts.ground', 'nuts.chopped', 'nuts.whole'],
    sources: { 'engine.CUP_DRY': cup(160), 'parser.DRY': cup(160) },
    needsReview: true,
    reviewNote:
      'הערך 66.7 (=160 גר\' לכוס) מתאים לצורה השלמה, אבל engine.CUP_DRY קיבץ אגוזים יחד עם אורז באותה שורה ולכן הוא לא נמדד לצורה הזו במפורש. דרוש נתון מאומת.',
  },
  {
    key: 'nuts.unspecified',
    match: ['שקד', 'אגוז', 'פקאן', 'פיסטוק', 'קשיו', 'לוז', 'מקדמיה'],
    gPer100: null,
    confidence: 'estimate',
    resolution: 'pending-form',
    forms: ['nuts.ground', 'nuts.chopped', 'nuts.whole'],
    sources: {
      'measure.TABLE': 42,
      'engine.CUP_DRY': cup(160),
      'parser.DRY': cup(160),
    },
    needsReview: true,
    reviewNote:
      'שם בלי צורה. אגוז שלם, קצוץ וטחון נמדדים אחרת — פער של פי 1.6 בין שני המקורות הישנים. לא מוצג ערך אחד לצורה לא ידועה.',
  },

  // ── grains ────────────────────────────────────────────────────────────────
  {
    key: 'oats',
    match: ['שיבולת שועל', 'קוואקר'],
    gPer100: 38,
    confidence: 'estimate',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 38, 'engine.CUP_DRY': cup(90) },
  },
  {
    key: 'rice',
    match: ['אורז'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-verification',
    sources: {
      'measure.TABLE': 77,
      'engine.CUP_DRY': cup(160),
      'parser.DRY': cup(160),
    },
    needsReview: true,
    reviewNote:
      'measure.TABLE נותן 77. engine.CUP_DRY ו-parser.DRY נתנו 160 גר\' לכוס (=66.7) כי קיבצו אורז יחד עם אגוזים. פער 13.4%. אין ערך בשימוש עד אימות.',
  },

  // ── juices ────────────────────────────────────────────────────────────────
  {
    key: 'juice',
    match: ['מיץ', 'פולפה', 'פירה'],
    gPer100: 105,
    confidence: 'system',
    resolution: 'accepted',
    sources: { 'measure.TABLE': 105, 'engine.DENS': dens(1.05) },
  },

  // ── alcohol: split by type (approved decision §3) ─────────────────────────
  // A value is kept only where a source actually covers that type on its own.
  {
    key: 'alcohol.wine',
    match: ['יין'],
    gPer100: 98,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 98 },
    needsReview: true,
    reviewNote:
      'רק measure.TABLE מכסה יין, ובתוך שורה מקובצת יחד עם משקאות חריפים. ל-engine.DENS אין שורה ליין. אין סתירה, אבל גם אין מקור שני.',
  },
  {
    key: 'alcohol.spirit',
    match: ['רום', 'ברנדי', 'וודקה'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-verification',
    sources: { 'measure.TABLE': 98, 'engine.DENS': dens(0.94) },
    needsReview: true,
    reviewNote:
      'measure.TABLE נותן 98 (בשורה מקובצת עם יין), engine.DENS נותן 0.94 (=94). פער 4.1%. פיזיקלית 0.94 מתאים ל-40% אלכוהול ו-0.98 ליין — שתיהן נכונות לחומר גלם אחר. אין ערך בשימוש עד אימות.',
  },
  {
    key: 'alcohol.liqueur',
    match: ['ליקר'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-verification',
    sources: { 'measure.TABLE': 98, 'engine.DENS': dens(0.94) },
    needsReview: true,
    reviewNote:
      'שתי הטבלאות קיבצו ליקר יחד עם משקאות חריפים, ואף אחת לא מדדה ליקר בנפרד. צפיפות ליקר משתנה מאוד עם תכולת הסוכר. אין ערך בשימוש עד אימות.',
  },

  // ── coffee ────────────────────────────────────────────────────────────────
  {
    key: 'coffee.liquid',
    match: ['אספרסו', 'קפה נוזלי'],
    gPer100: 100,
    confidence: 'system',
    resolution: 'accepted-single-source',
    sources: { 'measure.TABLE': 100 },
    needsReview: true,
    reviewNote: 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.',
  },
  {
    key: 'coffee.ground',
    match: ['קפה טחון', 'קפה'],
    gPer100: 42,
    confidence: 'estimate',
    resolution: 'accepted-single-source',
    note: 'תלוי בדרגת הטחינה',
    sources: { 'measure.TABLE': 42 },
    needsReview: true,
    reviewNote:
      'מקור אחד בלבד, ומסומן כהערכה כי הצפיפות משתנה מאוד עם דרגת הטחינה.',
  },

  // ── eggs: split into whole / white / yolk (approved decision §4) ──────────
  // engine.DENS was the only source and it gave all three 1.03, grouped
  // together with milk. One density for three different things is exactly what
  // the decision forbids, and there is no per-part value to put in its place.
  {
    key: 'egg.yolk',
    match: ['חלמון'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-form',
    forms: ['egg.whole', 'egg.white', 'egg.yolk'],
    sources: { 'engine.DENS': dens(1.03) },
    needsReview: true,
    reviewNote:
      'engine.DENS נתן 1.03 לחלמון, לחלבון, לביצה שלמה ולחלב — אותו ערך לארבעה דברים שונים. דרוש נתון מאומת לחלמון.',
  },
  {
    key: 'egg.white',
    match: ['חלבון ביצה', 'חלבון'],
    exclude: ['קמח', 'אבקת חלבון'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-form',
    forms: ['egg.whole', 'egg.white', 'egg.yolk'],
    sources: { 'engine.DENS': dens(1.03) },
    needsReview: true,
    reviewNote:
      'engine.DENS נתן 1.03 גם לחלבון. דרוש נתון מאומת לחלבון ביצה.',
  },
  {
    key: 'egg.whole',
    match: ['ביצה', 'ביצים', "מלנג'"],
    exclude: ['קמח'],
    gPer100: null,
    confidence: 'system',
    resolution: 'pending-form',
    forms: ['egg.whole', 'egg.white', 'egg.yolk'],
    sources: { 'engine.DENS': dens(1.03) },
    needsReview: true,
    reviewNote:
      'engine.DENS נתן 1.03 לביצה שלמה, בשורה מקובצת עם חלב, חלמון וחלבון. דרוש נתון מאומת לביצה שלמה. שימו לב: ביצים במתכונים נמדדות כמעט תמיד ביחידות עם משקל ליחידה, ולכן שורה זו כמעט אינה בשימוש.',
  },
] as const;

/** Hebrew single-letter prefixes: ה ו ב ל מ כ ש */
const HEBREW_PREFIX = /^[\u05d4\u05d5\u05d1\u05dc\u05de\u05db\u05e9]/;

/** Splits a name into word tokens, keeping Hebrew, Latin, digits, % and '. */
function tokens(name: string): string[] {
  return name.split(/[^\u0590-\u05FFA-Za-z0-9%']+/).filter(Boolean);
}

/**
 * Whole-word match: the term must be a token on its own, optionally carrying a
 * single Hebrew prefix letter ("במים" counts, "שלמים" does not).
 */
function matchesWord(name: string, term: string): boolean {
  for (const t of tokens(name)) {
    if (t === term) return true;
    if (t.length === term.length + 1 && HEBREW_PREFIX.test(t) && t.slice(1) === term) {
      return true;
    }
  }
  return false;
}

function rowMatches(row: DensityEntry, name: string): boolean {
  if (row.exclude?.some((x) => name.includes(x))) return false;
  return row.wordMatch
    ? row.match.some((k) => matchesWord(name, k))
    : row.match.some((k) => name.includes(k));
}

/** True when we know this is a distinct ingredient we have no data for. */
export function isKnownDataGap(name: string | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  return KNOWN_DATA_GAPS.some((g) => n.includes(g));
}

/**
 * Order-based lookup, like the legacy `tableLookup`, plus the guards.
 * Returns the row even when it carries no value — the caller decides. That is
 * what lets `densityFor` explain WHY there is no number.
 */
export function lookupDensity(name: string | undefined): DensityEntry | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  if (isKnownDataGap(n)) return null;
  for (const row of DENSITY_TABLE) {
    if (rowMatches(row, n)) return row;
  }
  return null;
}

export function densityEntryByKey(key: string): DensityEntry | null {
  return DENSITY_TABLE.find((r) => r.key === key) ?? null;
}

/** Grams per one cup of the given size, or null when the row has no value. */
export function gramsPerCup(
  entry: DensityEntry,
  cupMl: number,
): number | null {
  if (entry.gPer100 == null) return null;
  return (entry.gPer100 * cupMl) / 100;
}

/** Rows that currently carry a usable value. */
export function valuedEntries(): DensityEntry[] {
  return DENSITY_TABLE.filter((e) => e.gPer100 != null);
}

/** Rows declared but deliberately unvalued. */
export function unvaluedEntries(): DensityEntry[] {
  return DENSITY_TABLE.filter((e) => e.gPer100 == null);
}
