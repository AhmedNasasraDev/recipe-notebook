// The editable shape of a recipe.
//
// THE ONE DESIGN DECISION THAT MATTERS HERE: every numeric field is a STRING.
//
// That looks like sloppiness and is the opposite. The schema distinguishes NULL
// from 0 in six places — `yield_actual`, `weight_before`, `weight_after`,
// `water_pct`, `g_per_100`, `unit_weight` — and in each of them NULL means "use
// the theoretical value / the shared table" while 0 means "someone measured
// zero" (§1.1, §18.11). A React `<input type="number">` bound to a `number`
// cannot express the difference: an emptied field arrives as `0` or `NaN`, and
// either way the distinction is gone before the mapper ever sees it.
//
// Held as strings, an empty field stays `''`, `toNullableNumber('')` returns
// `null`, and the column really is NULL. The engine cooperates: its fields are
// typed `number | string` and `num('')` is 0 while `numOrNull('')` is null, so a
// draft can be handed straight to `compute()` for the live preview with no
// conversion step in between — which is also why the preview cannot drift from
// what will be saved.
//
// Nothing here invents a value. A field the user left alone stays empty all the
// way to the database.

import { normalizeName, unitId } from '@recipe-notebook/engine';
import type { IngredientLike, Pan, Recipe, Step, StepKind } from '@recipe-notebook/engine';

/** A form row for one ingredient. Ids are kept so React keys stay stable. */
export interface IngredientDraft {
  /** local row id, never sent to the database */
  key: string;
  name: string;
  /**
   * The canonical identity stored with this row (`ingredient_key`), when there
   * is one. It is what the engine matches a personal calibration and a density
   * override against (B4), so an edit that only changes a quantity must not
   * rewrite it — and before this field existed, saving through the editor
   * dropped it and `mappers.ts` regenerated it from the name.
   *
   * '' means "derive it from the name", which is what a new row gets.
   * `patchIngredientRow` clears it when the name is genuinely changed, because
   * then the row really is a different ingredient.
   */
  ingredientKey: string;
  qty: string;
  unit: string;
  flour: boolean;
  liquid: boolean;
  /** '' = use the shared water table (not 0) */
  waterPct: string;
  /** '' = no per-item weight on record */
  unitWeight: string;
  /** §5.1 rank 2 — a density typed into this recipe. '' = fall through */
  gPer100: string;
  price: string;
  priceUnit: string;
  note: string;
  /** a sub-recipe line (§18.6) — weighed, never volume-converted */
  subId: string;
}

export interface StepDraft {
  key: string;
  text: string;
  temp: string;
  minutes: string;
  /**
   * stage 9: what kind of step this is. '' = not classified, which the
   * production timeline reports rather than guessing at (migration 0018).
   */
  kind: '' | StepKind;
}

/**
 * A pan, held as form strings. Same reason as every other numeric field here:
 * '' has to stay distinguishable from '0', and a <select> plus five inputs
 * cannot hold a number|undefined without inventing one.
 */
export interface PanDraft {
  kind: '' | NonNullable<Pan['kind']>;
  diameter: string;
  width: string;
  length: string;
  height: string;
  gn: string;
  cavities: string;
}

export function emptyPan(): PanDraft {
  return { kind: '', diameter: '', width: '', length: '', height: '', gn: '', cavities: '' };
}

export interface RecipeDraft {
  /** '' for a recipe that does not exist yet */
  id: string;
  name: string;
  category: string;
  tags: string;
  isSub: boolean;
  locked: boolean;
  yieldUnits: string;
  unitWeight: string;
  /** '' = theoretical yield (§18.11). NOT the same as '0' */
  yieldActual: string;
  targetFC: string;
  /** stage 7: what the user charges. '' = not set, '0' = given away */
  salePrice: string;
  /** stage 8: is `salePrice` for the whole batch or for one unit? */
  salePriceBasis: 'batch' | 'unit';
  /**
   * stage 8, requirement E: the rest of the cost, ENTERED and never invented.
   * '' = not entered, '0' = there is none. The screen says which.
   */
  packagingCost: string;
  laborCost: string;
  otherCost: string;
  /** stage 8, requirement G: a target gross margin, in percent */
  targetGM: string;
  shelfLife: string;
  storage: string;
  /** §1.1, and the two the editor never asked for until now */
  freezing: string;
  thawing: string;
  equipment: string;
  notes: string;
  /*
    STAGE-11 COMPLETION (§1.1, §13). Everything below already existed in the
    column list, in both mappers and in `save_recipe`; the engine already
    computed from it and the recipe page already displayed the result. The form
    simply never asked. So `פחת אפייה` read 0.0% for every recipe in the
    notebook — not because there was no loss, but because nobody could enter
    the two weights — and `טמפ' מים מחושבת` could never appear at all.
  */
  /** the weight of the batch before and after baking; '' = not weighed */
  weightBefore: string;
  weightAfter: string;
  /** §13 dough mode: with it off, the four temperatures below mean nothing */
  doughMode: boolean;
  /** desired dough temperature, and the three inputs it is solved against */
  ddt: string;
  flourTemp: string;
  roomTemp: string;
  friction: string;
  /** §1.1 manualAllergens — what the table cannot know, comma separated */
  manualAllergens: string;
  /** §7 the pan this recipe is written for */
  pan: PanDraft;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
}

let seq = 0;
const nextKey = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

/** Test seam, so row keys are deterministic within a test. */
export function resetDraftKeys(): void {
  seq = 0;
}

/** A number that came out of the database, as a form string. */
const str = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '' : String(v);

export function emptyIngredient(): IngredientDraft {
  return {
    key: nextKey('ing'),
    name: '',
    ingredientKey: '',
    // Grams by default. It is the only unit that needs no density, so a new row
    // starts in the state where the calculation is certainly complete.
    qty: '',
    unit: 'g',
    flour: false,
    liquid: false,
    waterPct: '',
    unitWeight: '',
    gPer100: '',
    price: '',
    priceUnit: '',
    note: '',
    subId: '',
  };
}

export function emptyStep(): StepDraft {
  return { key: nextKey('step'), text: '', temp: '', minutes: '', kind: '' };
}

/**
 * Applies one edit to an ingredient row.
 *
 * The rule this exists for: a stored `ingredientKey` survives every edit
 * EXCEPT a real change to the name. Editing a quantity or a price must not
 * change what the row is — otherwise a personal calibration stops matching it.
 * Retyping the name is the user saying this is something else, so the key is
 * cleared and regenerated from the new name on save.
 *
 * Whitespace and gershayim variants are not a real change: the comparison is
 * the engine's own `normalizeName`, the same identity used everywhere else.
 */
export function patchIngredientRow(
  row: IngredientDraft,
  patch: Partial<IngredientDraft>,
): IngredientDraft {
  const next = { ...row, ...patch };
  if (
    patch.name !== undefined &&
    next.ingredientKey !== '' &&
    normalizeName(patch.name) !== normalizeName(row.name)
  ) {
    next.ingredientKey = '';
  }
  return next;
}

export function emptyDraft(category = 'אחר'): RecipeDraft {
  return {
    id: '',
    name: '',
    category,
    tags: '',
    isSub: false,
    locked: false,
    yieldUnits: '',
    unitWeight: '',
    yieldActual: '',
    targetFC: '',
    salePrice: '',
    salePriceBasis: 'batch',
    packagingCost: '',
    laborCost: '',
    otherCost: '',
    targetGM: '',
    shelfLife: '',
    storage: '',
    freezing: '',
    thawing: '',
    equipment: '',
    notes: '',
    weightBefore: '',
    weightAfter: '',
    doughMode: false,
    ddt: '',
    flourTemp: '',
    roomTemp: '',
    friction: '',
    manualAllergens: '',
    pan: emptyPan(),
    // One empty row of each, so the form has somewhere to start typing.
    ingredients: [emptyIngredient()],
    steps: [emptyStep()],
  };
}

export function draftFromRecipe(recipe: Recipe): RecipeDraft {
  return {
    id: recipe.id ?? '',
    name: str(recipe.name),
    category: str(recipe.category) || 'אחר',
    tags: (recipe.tags ?? []).join(', '),
    isSub: recipe.isSub === true,
    locked: recipe.locked === true,
    yieldUnits: str(recipe.yieldUnits),
    unitWeight: str(recipe.unitWeight),
    yieldActual: str(recipe.yieldActual),
    targetFC: str(recipe.targetFC),
    salePrice: str(recipe['salePrice']),
    salePriceBasis: recipe['salePriceBasis'] === 'unit' ? 'unit' : 'batch',
    packagingCost: str(recipe['packagingCost']),
    laborCost: str(recipe['laborCost']),
    otherCost: str(recipe['otherCost']),
    targetGM: str(recipe['targetGM']),
    shelfLife: str(recipe.shelfLife),
    storage: str(recipe.storage),
    freezing: str(recipe.freezing),
    thawing: str(recipe.thawing),
    equipment: str(recipe.equipment),
    notes: str(recipe.notes),
    weightBefore: str(recipe.weightBefore),
    weightAfter: str(recipe.weightAfter),
    doughMode: recipe.doughMode === true,
    ddt: str(recipe.ddt),
    flourTemp: str(recipe.flourTemp),
    roomTemp: str(recipe.roomTemp),
    friction: str(recipe.friction),
    manualAllergens: (recipe.manualAllergens ?? []).join(', '),
    pan: {
      kind: recipe.pan?.kind ?? '',
      diameter: str(recipe.pan?.diameter),
      width: str(recipe.pan?.width),
      length: str(recipe.pan?.length),
      height: str(recipe.pan?.height),
      gn: str(recipe.pan?.gn),
      cavities: str(recipe.pan?.cavities),
    },
    ingredients: (recipe.ingredients ?? []).map((ing) => ({
      key: nextKey('ing'),
      name: str(ing.name),
      ingredientKey: str(ing.ingredientKey),
      qty: str(ing.qty),
      /*
        STAGE-10 AUDIT FIX (§2, §11). This read `str(ing.unit) || 'g'`, so the
        draft carried whatever spelling the stored row used. The <select> below
        it lists the engine's canonical ids as its option VALUES ('g', 'ml',
        'unit'…), and every recipe saved before — the demo set, the fixtures,
        the rows in the database — stores the Hebrew names ('גרם', 'מ"ל',
        "יח'"). No option matched, so the browser fell back to the first one and
        the form showed GRAMS for every row.

        It looked harmless because the first option IS grams, so a
        gram-measured row appeared correct. It was not harmless: opening the
        brioche and pressing save rewrote 5 יח' of eggs as 5 g and 60 מ"ל of
        milk as 60 g — the quantity kept, the unit replaced, silently. A form
        that cannot show what is stored must not be allowed to save over it.

        `unitId` is the engine's own normaliser (units.ts, LEGACY_UNIT_NAMES),
        so there is no second mapping table here. A unit the engine does not
        recognise is kept verbatim rather than turned into grams: the select
        cannot display it, but nothing invents a value for it either.
      */
      unit: unitId(ing.unit) ?? (str(ing.unit) || 'g'),
      flour: ing.flour === true,
      liquid: ing.liquid === true,
      waterPct: str(ing.waterPct),
      unitWeight: str(ing.unitWeight),
      gPer100: str(ing.gPer100),
      price: str(ing.price),
      priceUnit: str(ing.priceUnit),
      note: str(ing.note),
      subId: str(ing.subId),
    })),
    steps: (recipe.steps ?? []).map((s) => ({
      key: nextKey('step'),
      text: str(s.text),
      temp: str(s.temp),
      minutes: str(s.minutes),
      kind: s.kind ?? '',
    })),
  };
}

/**
 * A row the user never filled in.
 *
 * Only the name is load-bearing: a row with a name and no quantity is a real
 * thing ("קורט מלח"), and it is kept — it just cannot be weighed, and the
 * partial-calculation notice already says so. A row with neither is a leftover
 * blank from the form and is dropped on save.
 */
export const isBlankIngredient = (i: IngredientDraft): boolean =>
  i.name.trim() === '' && i.qty.trim() === '';

const isBlankStep = (s: StepDraft): boolean =>
  s.text.trim() === '' && s.temp.trim() === '' && s.minutes.trim() === '' && s.kind === '';

/**
 * Draft → Recipe, ready for the repository.
 *
 * Empty strings are LEFT empty. `mappers.ts` turns them into SQL NULLs, and the
 * engine reads them as "no value" rather than as zero. Nothing is defaulted
 * here — that would be the place where a guessed number would enter the system.
 */
/**
 * A pan the user actually described, or null.
 *
 * `kind: 'none'` is kept when the user picked it on purpose — "this recipe is
 * not baked in a pan" is information, and §7 lists it as one of the six kinds.
 * What is dropped is a kind with no dimensions behind it, which would make
 * `panFactor` look answerable when it is not.
 */
export function panFromDraft(p: PanDraft): Pan | null {
  if (!p.kind) return null;
  if (p.kind === 'none') return { kind: 'none' };
  const out: Pan = { kind: p.kind };
  if (p.diameter.trim()) out.diameter = p.diameter.trim();
  if (p.width.trim()) out.width = p.width.trim();
  if (p.length.trim()) out.length = p.length.trim();
  if (p.height.trim()) out.height = p.height.trim();
  if (p.gn.trim()) out.gn = p.gn.trim();
  if (p.cavities.trim()) out.cavities = p.cavities.trim();
  return out;
}

export function draftToRecipe(draft: RecipeDraft): Recipe {
  const trimmed = draft.ingredients.filter((i) => !isBlankIngredient(i));
  const steps = draft.steps.filter((s) => !isBlankStep(s));

  const recipe: Recipe = {
    id: draft.id || `new-${Date.now().toString(36)}`,
    name: draft.name.trim(),
    category: draft.category || 'אחר',
    tags: draft.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    isSub: draft.isSub,
    locked: draft.locked,
    yieldUnits: draft.yieldUnits.trim(),
    unitWeight: draft.unitWeight.trim(),
    yieldActual: draft.yieldActual.trim(),
    targetFC: draft.targetFC.trim(),
    salePrice: draft.salePrice.trim(),
    salePriceBasis: draft.salePriceBasis,
    packagingCost: draft.packagingCost.trim(),
    laborCost: draft.laborCost.trim(),
    otherCost: draft.otherCost.trim(),
    targetGM: draft.targetGM.trim(),
    shelfLife: draft.shelfLife.trim(),
    storage: draft.storage.trim(),
    freezing: draft.freezing.trim(),
    thawing: draft.thawing.trim(),
    equipment: draft.equipment.trim(),
    notes: draft.notes.trim(),
    // Blank stays blank all the way to a NULL column: `weightBefore: ''` is
    // "nobody weighed it" and the engine must not read it as a weight of 0.
    weightBefore: draft.weightBefore.trim(),
    weightAfter: draft.weightAfter.trim(),
    doughMode: draft.doughMode,
    ddt: draft.ddt.trim(),
    flourTemp: draft.flourTemp.trim(),
    roomTemp: draft.roomTemp.trim(),
    friction: draft.friction.trim(),
    manualAllergens: draft.manualAllergens
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    // A pan with nothing in it is stored as NULL rather than as `{kind:'none'}`:
    // "no pan was recorded" and "this recipe uses no pan" are different
    // statements, and only the second one is worth a row in the column.
    pan: panFromDraft(draft.pan),
    ingredients: trimmed.map<IngredientLike>((i, idx) => {
      const ing: IngredientLike = {
        id: i.key,
        name: i.name.trim(),
        qty: i.qty.trim(),
        unit: i.unit,
      };
      if (i.ingredientKey) ing.ingredientKey = i.ingredientKey;
      if (i.flour) ing.flour = true;
      if (i.liquid) ing.liquid = true;
      if (i.waterPct.trim()) ing.waterPct = i.waterPct.trim();
      if (i.unitWeight.trim()) ing.unitWeight = i.unitWeight.trim();
      if (i.gPer100.trim()) ing.gPer100 = i.gPer100.trim();
      if (i.price.trim()) ing.price = i.price.trim();
      if (i.priceUnit) ing.priceUnit = i.priceUnit;
      if (i.note.trim()) ing.note = i.note.trim();
      if (i.subId) ing.subId = i.subId;
      void idx;
      return ing;
    }),
    steps: steps.map<Step>((s) => {
      const step: Step = { id: s.key, text: s.text.trim() };
      if (s.temp.trim()) step.temp = s.temp.trim();
      if (s.minutes.trim()) step.minutes = s.minutes.trim();
      if (s.kind) step.kind = s.kind;
      return step;
    }),
  };
  return recipe;
}

// ── validation ─────────────────────────────────────────────────────────────

export interface DraftProblem {
  field: string;
  message: string;
}

/**
 * What must be true before a save is attempted.
 *
 * Deliberately short. The database enforces the one hard rule (a non-blank
 * name) and the engine handles missing numbers honestly, so a long client-side
 * validator here would mostly be inventing requirements the product does not
 * have. A recipe in progress is a legitimate thing to save.
 */
/**
 * What a draft may be saved as, and what a finished recipe must be.
 *
 * §6 asks for both: "אפשר שמירת טיוטה חלקית והפרד בין דרישות לטיוטה לבין
 * דרישות למתכון סופי." The difference is deliberately small, because the rest
 * of the application already handles an incomplete recipe honestly — every
 * screen says "נתונים חלקיים" rather than inventing a figure.
 *
 *   · `draft` — a name, and numbers that are numbers. Nothing else. A row
 *     with a quantity and no name yet is a half-typed line, not an error.
 *   · `final` — everything above, plus at least one real ingredient and a
 *     name on every row that carries a quantity.
 *
 * A name is required in both because it is the recipe's identity: the row is
 * `recipes.name NOT NULL` in the schema, it is how the notebook lists it, and
 * "מתכון ללא שם" would be a row nobody can find again. No schema change was
 * needed for either mode.
 */
export type ValidationMode = 'draft' | 'final';

export function validateDraft(
  draft: RecipeDraft,
  mode: ValidationMode = 'final',
): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!draft.name.trim()) {
    problems.push({ field: 'name', message: 'למתכון חייב להיות שם.' });
  }

  const rows = draft.ingredients.filter((i) => !isBlankIngredient(i));
  if (rows.length === 0 && mode === 'final') {
    problems.push({ field: 'ingredients', message: 'צריך לפחות רכיב אחד.' });
  }

  rows.forEach((row, i) => {
    if (!row.name.trim() && mode === 'final') {
      problems.push({
        field: `ingredient-${i}`,
        message: `לרכיב ${i + 1} יש כמות אבל אין שם.`,
      });
    }
    for (const [key, label] of [
      ['qty', 'הכמות'],
      ['waterPct', 'אחוז המים'],
      ['unitWeight', 'המשקל ליחידה'],
      ['gPer100', 'הצפיפות'],
      ['price', 'המחיר'],
    ] as const) {
      const raw = row[key].trim();
      if (raw && !Number.isFinite(Number(raw))) {
        problems.push({
          field: `ingredient-${i}-${key}`,
          message: `${label} של "${row.name.trim() || `רכיב ${i + 1}`}" אינה מספר.`,
        });
      }
    }
  });

  for (const [key, label] of [
    ['yieldUnits', 'מספר היחידות'],
    ['unitWeight', 'המשקל ליחידה'],
    ['yieldActual', 'התשואה בפועל'],
    ['targetFC', 'יעד הפוד קוסט'],
    ['salePrice', 'מחיר המכירה'],
    ['packagingCost', 'עלות האריזה'],
    ['laborCost', 'עלות העבודה'],
    ['otherCost', 'העלויות הנוספות'],
    ['targetGM', 'יעד הרווח הגולמי'],
  ] as const) {
    const raw = draft[key].trim();
    if (raw && !Number.isFinite(Number(raw))) {
      problems.push({ field: key, message: `${label} אינה מספר.` });
    }
  }

  // A gross margin of 100% would need an infinite price, and above it a
  // negative one. Refused rather than turned into a number.
  const gm = draft.targetGM.trim();
  if (gm && Number.isFinite(Number(gm)) && (Number(gm) < 0 || Number(gm) >= 100)) {
    problems.push({
      field: 'targetGM',
      message: 'יעד הרווח הגולמי צריך להיות בין 0 ל-100, ולא 100.',
    });
  }

  for (const [key, label] of [
    ['packagingCost', 'עלות האריזה'],
    ['laborCost', 'עלות העבודה'],
    ['otherCost', 'העלויות הנוספות'],
  ] as const) {
    const raw = draft[key].trim();
    if (raw && Number.isFinite(Number(raw)) && Number(raw) < 0) {
      problems.push({ field: key, message: `${label} אינה יכולה להיות שלילית.` });
    }
  }

  return problems;
}

// ── row operations ─────────────────────────────────────────────────────────

/** Moves a row one place, and returns the list unchanged at either end. */
export function moveRow<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [row] = out.splice(from, 1);
  if (row === undefined) return [...list];
  out.splice(to, 0, row);
  return out;
}

/** True when the draft differs from the recipe it was opened from. */
export function isDirty(draft: RecipeDraft, original: RecipeDraft): boolean {
  // Row keys are local and change on every load, so they are excluded.
  const strip = (d: RecipeDraft) => ({
    ...d,
    ingredients: d.ingredients.map(({ key, ...rest }) => {
      void key;
      return rest;
    }),
    steps: d.steps.map(({ key, ...rest }) => {
      void key;
      return rest;
    }),
  });
  return JSON.stringify(strip(draft)) !== JSON.stringify(strip(original));
}
