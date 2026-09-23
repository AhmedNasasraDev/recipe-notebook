// "What changed" between two versions of a recipe (§9).
//
// Ported from the prototype's `versionDiff` at
// design_handoff_recipe_notebook/מחברת מתכונים.dc.html:1663, because §9
// specifies the algorithm precisely rather than leaving it open:
//
//   "versionDiff מזהה: שינוי שם, רכיב שנוסף, רכיב שהוסר, שינוי כמות (עד 3
//    שמות), שינוי מספר שלבים, ושינוי תשואה מחושבת. אם דבר לא זוהה —
//    'שינויים קלים'."
//
// So this is a transcription, not a design. The order of the clauses, the
// three-name cap, the yield-only-if-nothing-else-was-found fallback and the
// 1-gram threshold are all the prototype's.
//
// It lives in the web app rather than in packages/engine because it is a
// description for a human, not a calculation — but it does call the engine's
// `compute()` for the yield fallback, which is the one part that must not be
// re-implemented.
//
// STAGE 6 — ONE COMPARISON, TWO PRESENTATIONS
//
// Stage-6 requirement 14 says not to add a second diff engine if this one can
// serve, and it can, but only after being turned inside out. §9 needs a
// ONE-LINE description; the comparison screen needs the field-by-field detail
// that description was computed from and then threw away. Computing them
// separately is exactly the second source of truth the instruction rules out —
// the line and the screen could then disagree about the same two versions.
//
// So `compareRecipes()` below does the work and returns the structure, and
// `versionDiff()` is a formatter over it. §9's wording, its clause order, its
// three-name cap and its yield fallback are all unchanged and still tested
// against the prototype's specification; they are now derived from the same
// data the screen renders.
//
// Two deliberate departures from the prototype, both about honesty:
//
//   1. The prototype keys ingredients by raw name, so "קמח " and "קמח" are
//      different ingredients and renaming one reads as "added X, removed Y".
//      This uses the engine's `ingredientKeyOf`, which is the same identity
//      calibration matching uses (B4). A rename is still reported as an
//      add plus a remove — that is genuinely what happened to the formula —
//      but whitespace and gershayim variants no longer masquerade as one.
//
//   2. A quantity change compares the RESOLVED GRAMS, not the raw `qty`.
//      Changing "2 כוס" to "480 גרם" leaves `qty` looking wildly different
//      while the formula is unchanged, and the prototype would have called
//      that a quantity change. Where grams cannot be resolved it falls back
//      to comparing qty and unit, so an unweighable row still reports.

import {
  compute,
  ingredientKeyOf,
  unitId,
  unitLabel,
  type IngredientLike,
  type MeasurementPrefs,
  type Recipe,
} from '@recipe-notebook/engine';

/**
 * Which recipe fields the comparison covers (stage-6 requirement 9: "the
 * relevant recipe fields and the ingredients, not just a general heading").
 *
 * Deliberately NOT everything on `Recipe`. Left out:
 *   - `id`, `createdAt`, `versions`, `versionOf`, `savedFrom` — identity and
 *     bookkeeping, not the formula.
 *   - `trials`, `batches`, `issues` — records of events (§13/§13a). A version
 *     does not snapshot them, so there is nothing to compare.
 *   - `privateNotes` — §8: never leaves the owner's own screen, and a version
 *     snapshot does not carry it.
 *   - `ingredients`, `steps` — compared structurally below, not as fields.
 *
 * The order is the order they are shown in, which is the order they matter in.
 */
const COMPARED_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'name', label: 'שם' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'isSub', label: 'מתכון בסיס' },
  { key: 'locked', label: 'נוסחה מאושרת לייצור' },
  { key: 'yieldUnits', label: 'מספר יחידות' },
  { key: 'unitWeight', label: 'משקל ליחידה' },
  { key: 'yieldActual', label: 'תשואה מעשית' },
  { key: 'weightBefore', label: 'משקל לפני אפייה' },
  { key: 'weightAfter', label: 'משקל אחרי אפייה' },
  { key: 'doughMode', label: 'מצב בצק' },
  { key: 'ddt', label: 'טמפרטורת בצק מבוקשת' },
  { key: 'flourTemp', label: 'טמפרטורת קמח' },
  { key: 'roomTemp', label: 'טמפרטורת חדר' },
  { key: 'friction', label: 'חיכוך' },
  { key: 'targetFC', label: 'יעד פוד קוסט' },
  { key: 'tags', label: 'תגיות' },
  { key: 'shelfLife', label: 'חיי מדף' },
  { key: 'storage', label: 'אחסון' },
  { key: 'freezing', label: 'הקפאה' },
  { key: 'thawing', label: 'הפשרה' },
  { key: 'equipment', label: 'ציוד' },
  { key: 'notes', label: 'הערות' },
  { key: 'manualAllergens', label: 'אלרגנים שסומנו ידנית' },
  { key: 'versionNote', label: 'הערת גרסה' },
];

/** The fields of one ingredient row that the comparison reports on. */
const COMPARED_ING_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'qty', label: 'כמות' },
  { key: 'unit', label: 'יחידה' },
  { key: 'price', label: 'מחיר' },
  { key: 'priceUnit', label: 'יחידת המחיר' },
  { key: 'waterPct', label: 'אחוז מים' },
  { key: 'gPer100', label: 'צפיפות' },
  { key: 'unitWeight', label: 'משקל ליחידה' },
  { key: 'flour', label: 'נחשב קמח' },
  { key: 'liquid', label: 'נחשב נוזל' },
  { key: 'subId', label: 'מתכון בסיס' },
  { key: 'note', label: 'הערה' },
];

/** Up to three names, as §9 specifies. */
const MAX_NAMES = 3;

const nameList = (names: readonly string[]): string => {
  // Deduplicated: an ingredient that appears twice in the formula would
  // otherwise read as "שונתה כמות: מים, מים", which says nothing extra and
  // eats two of the three slots §9 allows.
  const unique = [...new Set(names)];
  const shown = unique.slice(0, MAX_NAMES).join(', ');
  return unique.length > MAX_NAMES ? `${shown} ועוד` : shown;
};

interface RowFacts {
  name: string;
  grams: number | null;
  qty: string;
  unit: string;
  subId: string;
}

/**
 * What each ingredient looks like for comparison purposes.
 *
 * The map key is the ingredient's identity plus WHICH OCCURRENCE it is. Two
 * rows may legitimately share an identity — water added in two stages, or two
 * rows carrying the same `ingredient_key` — and there is no unique constraint
 * stopping it. Keying on the identity alone silently collapsed them, and the
 * two sides then had different row counts, which came out as a contradictory
 * "נוסף מים · הוסר מים". Numbering the occurrences matches the nth row on one
 * side against the nth on the other, so adding a second `מים` reads as an
 * addition and changing the second one's amount reads as a quantity change.
 */
function factsOf(
  recipe: Recipe,
  recipes: readonly Recipe[],
  prefs: MeasurementPrefs | undefined,
): Map<string, RowFacts> {
  const computed = compute(recipe, recipes, { prefs });
  const byKey = new Map<string, RowFacts>();
  const seen = new Map<string, number>();

  for (const row of computed.rows) {
    const ing = row.ing as IngredientLike;
    const key = ingredientKeyOf(ing);
    if (!key) continue;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    byKey.set(`${key}#${n}`, {
      name: ing.name ?? '',
      grams: row.g,
      qty: String(ing.qty ?? ''),
      unit: String(ing.unit ?? ''),
      subId: String(ing.subId ?? ''),
    });
  }
  return byKey;
}

/** Did the amount of this ingredient really change? */
function amountChanged(a: RowFacts, b: RowFacts): boolean {
  if (a.grams !== null && b.grams !== null) {
    // A gram is the smallest difference worth reporting, matching the
    // prototype's threshold for the yield comparison.
    return Math.abs(a.grams - b.grams) >= 1;
  }
  // One or both could not be weighed: compare what was actually written.
  // The unit is compared as the engine's canonical id, so "גרם" and "g" — the
  // same unit spelled the two ways the stored data uses — is not a change.
  return a.qty !== b.qty || (unitId(a.unit) ?? a.unit) !== (unitId(b.unit) ?? b.unit);
}

export interface VersionDiffInput {
  before: Recipe;
  after: Recipe;
  /** the notebook, so a sub-recipe's contribution can be computed */
  recipes: readonly Recipe[];
  prefs?: MeasurementPrefs;
}

/**
 * One side of a value that changed.
 *
 * `null` means ABSENT, and that is the whole point of the type. The data model
 * turns on `null ≠ 0` and on "no price" ≠ "price 0" (stage-6 requirements 11
 * and 12), so a comparison that rendered both as an empty cell, or both as 0,
 * would erase exactly the distinction the rest of the system is built to keep.
 * `format()` below is the only place these become text.
 */
export type CellValue = string | number | boolean | null;

export interface FieldChange {
  key: string;
  label: string;
  before: CellValue;
  after: CellValue;
}

export interface IngredientSide {
  /** identity plus occurrence — see `factsOf` */
  key: string;
  name: string;
  /** what was written, e.g. "2 כוס" */
  written: string;
  /** resolved grams, or null when the engine could not weigh it */
  grams: number | null;
}

export interface IngredientChange extends IngredientSide {
  fields: FieldChange[];
}

export interface RecipeComparison {
  fields: FieldChange[];
  added: IngredientSide[];
  removed: IngredientSide[];
  changed: IngredientChange[];
  steps: { before: number; after: number };
  /** the §9 one-liner, from this same data */
  summary: string;
}

/** Normalises a raw field value to a cell, keeping absent distinct from 0/''. */
function cell(v: unknown): CellValue {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/**
 * Are two cells the same value?
 *
 * `null` equals only `null`. A numeric 0 and the string '0' are the same
 * written number and must not read as a change — but 0 and null never are.
 */
function sameCell(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

/** One ingredient row as a bag of comparable cells, keyed by field. */
function ingCells(ing: IngredientLike): Map<string, CellValue> {
  const out = new Map<string, CellValue>();
  for (const { key } of COMPARED_ING_FIELDS) {
    // `flour` and `liquid` are flags: absent means false, not "unknown".
    if (key === 'flour' || key === 'liquid') {
      out.set(key, (ing as Record<string, unknown>)[key] === true);
    } else if (key === 'unit') {
      // Compared, and displayed, as the Hebrew label of the canonical unit:
      // the stored data holds both "גרם" and "g" for the same unit, and a
      // comparison that called that a change would report a change on every
      // row of the first save after the units were normalised. It also reads
      // better than the id would.
      out.set(key, cell(unitLabel((ing as Record<string, unknown>)[key] as string)));
    } else {
      out.set(key, cell((ing as Record<string, unknown>)[key]));
    }
  }
  return out;
}

/**
 * Everything that differs between two states of one recipe (stage-6 7-12).
 *
 * This is the source of truth: `versionDiff()` is a formatter over it, so the
 * §9 one-liner and the comparison screen can never disagree.
 */
export function compareRecipes({
  before,
  after,
  recipes,
  prefs,
}: VersionDiffInput): RecipeComparison {
  // ── the recipe's own fields (requirement 9) ───────────────────────────
  const fields: FieldChange[] = [];
  for (const { key, label } of COMPARED_FIELDS) {
    const b =
      key === 'isSub' || key === 'locked' || key === 'doughMode'
        ? (before as Record<string, unknown>)[key] === true
        : cell((before as Record<string, unknown>)[key]);
    const a =
      key === 'isSub' || key === 'locked' || key === 'doughMode'
        ? (after as Record<string, unknown>)[key] === true
        : cell((after as Record<string, unknown>)[key]);
    if (!sameCell(b, a)) fields.push({ key, label, before: b, after: a });
  }

  // ── the ingredients ───────────────────────────────────────────────────
  // Keyed by identity AND occurrence, so two legitimately duplicated rows stay
  // two rows (requirement 10). Nothing constrains `ingredient_key` to be unique
  // within a recipe, and water added in two stages is an ordinary formula.
  const oldRows = factsOf(before, recipes, prefs);
  const newRows = factsOf(after, recipes, prefs);
  const oldIngs = ingsByKey(before);
  const newIngs = ingsByKey(after);
  const keys = [...new Set([...oldRows.keys(), ...newRows.keys()])];

  const added: IngredientSide[] = [];
  const removed: IngredientSide[] = [];
  const changed: IngredientChange[] = [];

  const sideOf = (key: string, f: RowFacts): IngredientSide => ({
    key,
    name: f.name,
    written: `${f.qty} ${unitLabel(f.unit)}`.trim(),
    grams: f.grams,
  });

  for (const key of keys) {
    const o = oldRows.get(key);
    const n = newRows.get(key);
    if (!o && n) {
      added.push(sideOf(key, n));
    } else if (o && !n) {
      removed.push(sideOf(key, o));
    } else if (o && n) {
      const ob = ingCells(oldIngs.get(key) ?? {});
      const nb = ingCells(newIngs.get(key) ?? {});
      const rowFields: FieldChange[] = [];
      for (const { key: f, label } of COMPARED_ING_FIELDS) {
        const bv = ob.get(f) ?? null;
        const av = nb.get(f) ?? null;
        if (sameCell(bv, av)) continue;
        // A sub-recipe id is meaningless on screen; show the recipe's name,
        // falling back to the id when it is a recipe we can no longer see.
        if (f === 'subId') {
          rowFields.push({
            key: f,
            label,
            before: bv === null ? null : nameOfRecipe(String(bv), recipes),
            after: av === null ? null : nameOfRecipe(String(av), recipes),
          });
        } else {
          rowFields.push({ key: f, label, before: bv, after: av });
        }
      }
      if (rowFields.length > 0) changed.push({ ...sideOf(key, n), fields: rowFields });
    }
  }

  const steps = {
    before: (before.steps ?? []).length,
    after: (after.steps ?? []).length,
  };

  // ── §9's one-liner, from the structure above ──────────────────────────
  const bits: string[] = [];
  if (fields.some((f) => f.key === 'name')) bits.push('שם השתנה');
  if (added.length) bits.push(`נוסף ${nameList(added.map((r) => r.name))}`);
  if (removed.length) bits.push(`הוסר ${nameList(removed.map((r) => r.name))}`);

  // §9 counts a QUANTITY change, which is not the same as any field changing:
  // the amount is compared in resolved grams, so a unit change that leaves the
  // formula alone is not one. `amountChanged` is that rule, unchanged.
  const moved = changed
    .filter((r) => {
      const o = oldRows.get(r.key);
      const n = newRows.get(r.key);
      return o && n ? amountChanged(o, n) : false;
    })
    .map((r) => r.name);
  if (moved.length) bits.push(`שונתה כמות: ${nameList(moved)}`);

  const relinked = changed
    .filter((r) => r.fields.some((f) => f.key === 'subId'))
    .map((r) => r.name);
  // Not in §9's list, but a sub-recipe link changing IS a change to the formula
  // and "שינויים קלים" would be a lie about it.
  if (relinked.length) bits.push(`שונה מתכון הבסיס: ${nameList(relinked)}`);

  if (steps.before !== steps.after) bits.push('מספר השלבים שונה');

  // §9: the yield comparison is a FALLBACK, only consulted when nothing above
  // was detected. Running it always would append "התשואה השתנתה" to every
  // quantity change, which is true but says nothing new.
  if (bits.length === 0) {
    const a = compute(before, recipes, { prefs });
    const b = compute(after, recipes, { prefs });
    if (Math.abs(a.actualYield - b.actualYield) > 1) bits.push('התשואה השתנתה');
  }

  return {
    fields,
    added,
    removed,
    changed,
    steps,
    summary: bits.length ? bits.join(' · ') : 'שינויים קלים',
  };
}

/** The same occurrence keys `factsOf` builds, mapped to the raw rows. */
function ingsByKey(recipe: Recipe): Map<string, IngredientLike> {
  const out = new Map<string, IngredientLike>();
  const seen = new Map<string, number>();
  for (const ing of recipe.ingredients ?? []) {
    const key = ingredientKeyOf(ing);
    if (!key) continue;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(`${key}#${n}`, ing);
  }
  return out;
}

function nameOfRecipe(id: string, recipes: readonly Recipe[]): string {
  return String(recipes.find((r) => r.id === id)?.name ?? id);
}

/**
 * A one-line description of what changed, in the §9 wording.
 * Never empty: "שינויים קלים" when nothing on the list was detected.
 */
export function versionDiff(input: VersionDiffInput): string {
  return compareRecipes(input).summary;
}

/**
 * A short label for a version in a list, e.g. "12 רכיבים · 1.2 ק״ג".
 *
 * Requirement 4 asks for enough to identify a version at a glance. The `what`
 * text says what changed; this says what the recipe WAS, which is what tells
 * you whether it is the one you want back.
 */
export function versionSummary(
  snapshot: Recipe,
  recipes: readonly Recipe[],
  prefs?: MeasurementPrefs,
): string {
  const ings = (snapshot.ingredients ?? []).length;
  const bits: string[] = [
    ings === 1 ? 'רכיב אחד' : `${ings} רכיבים`,
  ];

  const steps = (snapshot.steps ?? []).length;
  if (steps > 0) bits.push(steps === 1 ? 'שלב אחד' : `${steps} שלבים`);

  // The weight only goes in when the engine could actually establish it —
  // a partial sum presented as "what this version weighed" would be wrong.
  const c = compute(snapshot, recipes, { prefs });
  if (c.unresolved.length === 0 && c.totalG > 0) {
    bits.push(
      c.totalG >= 1000
        ? `${(c.totalG / 1000).toFixed(2).replace(/\.?0+$/, '')} ק"ג`
        : `${Math.round(c.totalG)} גר'`,
    );
  }

  return bits.join(' · ');
}

/** A human label for an ingredient line, used in the version viewer. */
export function ingredientLine(ing: IngredientLike): string {
  const qty = String(ing.qty ?? '').trim();
  const unit = unitLabel(ing.unit);
  return qty ? `${qty} ${unit}` : unit;
}
