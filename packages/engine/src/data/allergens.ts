// Allergen detection — ported verbatim from engine.js:56 (ALLERGENS).
// Single source already; moved here unchanged.

export const ALLERGEN_TABLE: readonly { allergen: string; match: string[] }[] = [
  { allergen: 'גלוטן', match: ['קמח', 'חיטה', 'שיפון', 'שעורה', 'כוסמין', 'סולת', 'פירורי לחם', 'פנקו'] },
  { allergen: 'ביצים', match: ['ביצה', 'ביצים', 'חלמון', 'חלבון ביצה', "מלנג'"] },
  { allergen: 'חלב', match: ['חלב', 'חמאה', 'שמנת', 'גבינה', 'מסקרפונה', 'יוגורט', 'לבנה', 'קרם פרש', 'ריקוטה'] },
  { allergen: 'אגוזים', match: ['שקד', 'אגוז', 'פיסטוק', 'לוז', 'פקאן', 'קשיו', 'מקדמיה', 'מרציפן', 'פרלינה'] },
  { allergen: 'בוטנים', match: ['בוטן'] },
  { allergen: 'סויה', match: ['סויה', 'לציטין'] },
  { allergen: 'שומשום', match: ['שומשום', 'טחינה'] },
  { allergen: 'דגים', match: ['דג', 'אנשובי', 'סלמון'] },
];

export function allergensFor(name: string | undefined): string[] {
  const n = (name ?? '').trim();
  return ALLERGEN_TABLE.filter((r) => r.match.some((k) => n.includes(k))).map(
    (r) => r.allergen,
  );
}
