// The draft model.
//
// Most of these tests exist for one reason: the form is the place where NULL
// and 0 are easiest to lose. `mappers.test.ts` proves the row↔domain boundary
// keeps them apart; this proves the keyboard↔draft boundary does too, so the
// distinction survives the whole way from a user's finger to a column.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { recipeToRow, ingredientsToRows } from '../../data/mappers.js';
import {
  draftFromRecipe,
  draftToRecipe,
  emptyDraft,
  emptyIngredient,
  emptyStep,
  isDirty,
  moveRow,
  patchIngredientRow,
  resetDraftKeys,
  validateDraft,
  type RecipeDraft,
} from './draft.js';

const withIngredients = (
  rows: Array<Partial<ReturnType<typeof emptyIngredient>>>,
): RecipeDraft => ({
  ...emptyDraft(),
  name: 'מתכון',
  ingredients: rows.map((r) => ({ ...emptyIngredient(), ...r })),
});

describe('an empty numeric field stays empty all the way to the column', () => {
  it('an untouched measured yield becomes SQL NULL, not 0', () => {
    const draft = { ...emptyDraft(), name: 'לחם' };
    expect(draft.yieldActual).toBe('');
    const row = recipeToRow(draftToRecipe(draft), 'owner');
    expect(row.yield_actual).toBeNull();
  });

  it('a typed zero becomes 0, because someone measured it', () => {
    const draft = { ...emptyDraft(), name: 'לחם', yieldActual: '0' };
    const row = recipeToRow(draftToRecipe(draft), 'owner');
    expect(row.yield_actual).toBe(0);
  });

  it('the same holds for an ingredient\'s water percentage', () => {
    const draft = withIngredients([
      { name: 'קמח', qty: '500' },
      { name: 'שמן זית', qty: '50', waterPct: '0' },
    ]);
    const rows = ingredientsToRows(draftToRecipe(draft), 'r1');
    // untouched → the shared water table answers
    expect(rows[0]!.water_pct).toBeNull();
    // typed zero → oil really contains no water
    expect(rows[1]!.water_pct).toBe(0);
  });

  it('and for a recipe-level density (§5.1 rank 2)', () => {
    const draft = withIngredients([
      { name: 'קמח', qty: '2', unit: 'cup' },
      { name: 'קקאו', qty: '1', unit: 'cup', gPer100: '105' },
    ]);
    const rows = ingredientsToRows(draftToRecipe(draft), 'r1');
    expect(rows[0]!.g_per_100).toBeNull();
    expect(rows[1]!.g_per_100).toBe(105);
  });

  it('a field cleared after being filled goes back to NULL', () => {
    // The regression a `number`-typed input would cause: clearing the box
    // yields 0 or NaN, and either one is a different answer from "no value".
    const filled = { ...emptyDraft(), name: 'לחם', yieldActual: '1200' };
    expect(recipeToRow(draftToRecipe(filled), 'o').yield_actual).toBe(1200);
    const cleared = { ...filled, yieldActual: '' };
    expect(recipeToRow(draftToRecipe(cleared), 'o').yield_actual).toBeNull();
  });
});

describe('the draft can be handed straight to the engine', () => {
  // This is what makes the editor's preview and the recipe page agree: there is
  // no conversion step between them that could drift.
  const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

  it('computes from string quantities without a conversion pass', () => {
    const draft = withIngredients([
      { name: 'קמח לבן', qty: '500', unit: 'g', flour: true },
      { name: 'מים', qty: '350', unit: 'g', liquid: true },
    ]);
    const recipe = draftToRecipe(draft);
    const c = compute(recipe, [recipe], { prefs });
    expect(c.totalG).toBe(850);
    expect(c.hydration).toBeCloseTo(70, 1);
  });

  it('reports an unweighable row rather than treating it as zero', () => {
    const draft = withIngredients([
      { name: 'קמח לבן', qty: '2', unit: 'cup', flour: true },
      { name: 'קקאו', qty: '1', unit: 'cup' },
    ]);
    const recipe = draftToRecipe(draft);
    const c = compute(recipe, [recipe], { prefs });
    expect(c.unresolved.map((u) => u.name)).toEqual(['קקאו']);
    // and the total is the sum of what COULD be weighed, not a guess
    expect(c.totalG).toBe(240);
  });

  it('an empty quantity is not a zero-weight ingredient', () => {
    const draft = withIngredients([{ name: 'קורט מלח', qty: '' }]);
    const recipe = draftToRecipe(draft);
    // The row is kept — it is a real instruction — but it cannot be weighed.
    expect(recipe.ingredients).toHaveLength(1);
    const c = compute(recipe, [recipe], { prefs });
    expect(c.totalG).toBe(0);
  });
});

describe('what gets dropped on save', () => {
  it('drops a row with no name and no quantity', () => {
    const draft = withIngredients([{ name: 'קמח', qty: '500' }, {}]);
    expect(draftToRecipe(draft).ingredients).toHaveLength(1);
  });

  it('keeps a row with a name but no quantity — "קורט מלח" is a real line', () => {
    const draft = withIngredients([{ name: 'קורט מלח', qty: '' }]);
    expect(draftToRecipe(draft).ingredients).toHaveLength(1);
  });

  it('drops an untouched step but keeps one with only a time', () => {
    const draft: RecipeDraft = {
      ...emptyDraft(),
      name: 'x',
      ingredients: [{ ...emptyIngredient(), name: 'קמח', qty: '1' }],
      steps: [
        { key: 'a', text: '', temp: '', minutes: '', kind: '' },
        { key: 'b', text: '', temp: '', minutes: '30', kind: '' },
      ],
    };
    expect(draftToRecipe(draft).steps).toHaveLength(1);
  });

  it('never writes an optional field the user left alone', () => {
    const draft = withIngredients([{ name: 'קמח', qty: '500' }]);
    const ing = draftToRecipe(draft).ingredients![0]!;
    for (const key of ['waterPct', 'unitWeight', 'gPer100', 'price', 'priceUnit', 'note']) {
      expect(key in ing).toBe(false);
    }
    // and the booleans are absent rather than false
    expect('flour' in ing).toBe(false);
    expect('liquid' in ing).toBe(false);
  });
});

describe('a round trip through the form changes nothing', () => {
  it('recipe → draft → recipe preserves the fields that were set', () => {
    resetDraftKeys();
    const recipe: Recipe = {
      id: 'r1',
      name: 'בריוש',
      category: 'לחמים',
      tags: ['חג', 'עשיר'],
      yieldUnits: 12,
      unitWeight: 85,
      targetFC: 28,
      shelfLife: '3 ימים',
      storage: 'מקרר',
      notes: 'לא ללוש יותר מדי',
      ingredients: [
        { id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'גרם', flour: true, price: 4.2, priceUnit: 'ק"ג' },
        { id: 'i2', name: 'חמאה 82%', qty: 250, unit: 'גרם' },
      ],
      steps: [{ id: 's1', text: 'ללוש', minutes: 12 }],
    };

    const back = draftToRecipe(draftFromRecipe(recipe));
    expect(back.name).toBe('בריוש');
    expect(back.tags).toEqual(['חג', 'עשיר']);
    expect(back.ingredients!.map((i) => i.name)).toEqual(['קמח לחם', 'חמאה 82%']);
    expect(back.ingredients![0]!.flour).toBe(true);
    expect(back.ingredients![0]!.price).toBe('4.2');
    expect(back.ingredients![1]!.flour).toBeUndefined();
    expect(back.steps!.map((s) => s.text)).toEqual(['ללוש']);
  });

  it('a NULL measured yield survives the round trip as absent', () => {
    const recipe: Recipe = { id: 'r', name: 'x', ingredients: [], steps: [] };
    const back = draftToRecipe(draftFromRecipe(recipe));
    expect(recipeToRow(back, 'o').yield_actual).toBeNull();
  });

  it('a measured yield of zero survives as zero', () => {
    const recipe: Recipe = { id: 'r', name: 'x', yieldActual: 0, ingredients: [], steps: [] };
    const back = draftToRecipe(draftFromRecipe(recipe));
    expect(recipeToRow(back, 'o').yield_actual).toBe(0);
  });
});

describe('validation says what is wrong, and nothing more', () => {
  it('requires a name', () => {
    const problems = validateDraft({ ...emptyDraft(), name: '   ' });
    expect(problems.some((p) => p.field === 'name')).toBe(true);
  });

  it('requires at least one ingredient', () => {
    const problems = validateDraft({ ...emptyDraft(), name: 'לחם' });
    expect(problems.some((p) => p.field === 'ingredients')).toBe(true);
  });

  it('accepts a recipe in progress — a missing quantity is not an error', () => {
    const draft = withIngredients([{ name: 'קמח', qty: '' }]);
    expect(validateDraft(draft)).toEqual([]);
  });

  it('rejects a quantity that is not a number, and names the ingredient', () => {
    const draft = withIngredients([{ name: 'קמח לבן', qty: 'הרבה' }]);
    const problems = validateDraft(draft);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('קמח לבן');
    expect(problems[0]!.message).toContain('אינה מספר');
  });

  it('points out a quantity with no ingredient name', () => {
    const draft = withIngredients([{ name: '', qty: '500' }]);
    const problems = validateDraft(draft);
    expect(problems.some((p) => p.message.includes('אין שם'))).toBe(true);
  });

  it('checks the recipe-level numbers too', () => {
    const draft = { ...withIngredients([{ name: 'קמח', qty: '1' }]), targetFC: 'שלושים' };
    expect(validateDraft(draft).some((p) => p.field === 'targetFC')).toBe(true);
  });

  // QA 22.09.2026, finding 4
  it('refuses a quantity of zero and a negative quantity, naming the ingredient', () => {
    for (const qty of ['0', '-5']) {
      const problems = validateDraft(withIngredients([{ name: 'קמח', qty }]));
      expect(problems).toHaveLength(1);
      expect(problems[0]!.field).toBe('ingredient-0-qty');
      expect(problems[0]!.message).toContain('קמח');
      expect(problems[0]!.message).toContain('גדולה מאפס');
    }
  });

  it('refuses a negative recipe-level number', () => {
    const draft = { ...withIngredients([{ name: 'קמח', qty: '1' }]), yieldUnits: '-12' };
    expect(validateDraft(draft).some((p) => p.field === 'yieldUnits')).toBe(true);
  });

  // QA 22.09.2026, finding 5
  it('a price needs a price unit; a zero price does not', () => {
    const priced = withIngredients([{ name: 'קמח', qty: '350', price: '4' }]);
    const problems = validateDraft(priced);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe('ingredient-0-priceUnit');
    expect(problems[0]!.message).toContain('יחידת מחיר');

    const free = withIngredients([{ name: 'קמח', qty: '350', price: '0' }]);
    expect(validateDraft(free)).toEqual([]);

    const withUnit = withIngredients([{ name: 'קמח', qty: '350', price: '4', priceUnit: 'ק"ג' }]);
    expect(validateDraft(withUnit)).toEqual([]);
  });
});

describe('reordering', () => {
  it('moves a row up and down', () => {
    expect(moveRow(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at either end, rather than dropping the row', () => {
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const list = ['a', 'b', 'c'];
    moveRow(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('unsaved-changes detection ignores the local row keys', () => {
  it('sees no change in a freshly loaded draft', () => {
    const recipe: Recipe = {
      id: 'r',
      name: 'x',
      ingredients: [{ id: 'i', name: 'קמח', qty: 1, unit: 'גרם' }],
      steps: [],
    };
    const a = draftFromRecipe(recipe);
    const b = draftFromRecipe(recipe);
    // Different loads produce different row keys. If those counted, the editor
    // would warn about unsaved changes on a form nobody had touched.
    expect(a.ingredients[0]!.key).not.toBe(b.ingredients[0]!.key);
    expect(isDirty(a, b)).toBe(false);
  });

  it('sees a real edit', () => {
    const base = emptyDraft();
    expect(isDirty({ ...base, name: 'חדש' }, base)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the stored ingredient identity survives an edit', () => {
  // `ingredient_key` is what the engine matches a personal calibration and a
  // density override against (B4). Before this, the draft had no field for it:
  // loading a recipe dropped it and saving regenerated it from the name in
  // `mappers.ts`. Nothing in the app writes a key that differs from the name
  // today — `ingredient_catalog` has no UI yet — so this was latent rather
  // than active. It is still the editor silently rewriting stored data.

  const loaded = (): RecipeDraft =>
    draftFromRecipe({
      id: 'r',
      name: 'עוגה',
      ingredients: [
        { id: 'i1', name: 'קקאו 22-24%', ingredientKey: 'cocoa.dutch', qty: 60, unit: 'g' },
      ],
      steps: [],
    } as unknown as Recipe);

  it('is loaded into the draft rather than discarded', () => {
    expect(loaded().ingredients[0]!.ingredientKey).toBe('cocoa.dutch');
  });

  it('round-trips back out unchanged', () => {
    const out = draftToRecipe(loaded());
    expect(out.ingredients![0]!.ingredientKey).toBe('cocoa.dutch');
  });

  it('survives a quantity edit, which does not change what the row IS', () => {
    const row = patchIngredientRow(loaded().ingredients[0]!, { qty: '80' });
    expect(row.ingredientKey).toBe('cocoa.dutch');
  });

  it('survives a price edit too', () => {
    const row = patchIngredientRow(loaded().ingredients[0]!, { price: '42' });
    expect(row.ingredientKey).toBe('cocoa.dutch');
  });

  it('survives a whitespace-only change to the name', () => {
    // Not a rename. The comparison is the engine's own identity, the same one
    // used everywhere else.
    const row = patchIngredientRow(loaded().ingredients[0]!, { name: 'קקאו 22-24% ' });
    expect(row.ingredientKey).toBe('cocoa.dutch');
  });

  it('is cleared by a real rename, because then the row is something else', () => {
    const row = patchIngredientRow(loaded().ingredients[0]!, { name: 'קמח לבן' });
    expect(row.ingredientKey).toBe('');
    // and the save then derives the identity from the new name
    expect(row.name).toBe('קמח לבן');
  });

  it('leaves a row that never had one alone', () => {
    const fresh = emptyIngredient();
    expect(fresh.ingredientKey).toBe('');
    expect(patchIngredientRow(fresh, { name: 'מים' }).ingredientKey).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('stage 9 — the step kind', () => {
  it('is absent from the recipe until the user classifies a step', () => {
    const draft: RecipeDraft = {
      ...emptyDraft(),
      name: 'x',
      ingredients: [{ ...emptyIngredient(), name: 'קמח', qty: '1' }],
      steps: [{ ...emptyStep(), text: 'התפחה', minutes: '90' }],
    };
    const step = draftToRecipe(draft).steps![0]!;
    // NOT 'active' by default, and not inferred from the word "התפחה".
    expect('kind' in step).toBe(false);
  });

  it('carries a classified step through, and back into the form', () => {
    const draft: RecipeDraft = {
      ...emptyDraft(),
      name: 'x',
      ingredients: [{ ...emptyIngredient(), name: 'קמח', qty: '1' }],
      steps: [{ ...emptyStep(), text: 'התפחה', minutes: '90', kind: 'proof' }],
    };
    const recipe = draftToRecipe(draft);
    expect(recipe.steps![0]!.kind).toBe('proof');
    expect(draftFromRecipe(recipe).steps[0]!.kind).toBe('proof');
  });

  it('counts a step that carries only a kind as a real step', () => {
    const draft: RecipeDraft = {
      ...emptyDraft(),
      name: 'x',
      ingredients: [{ ...emptyIngredient(), name: 'קמח', qty: '1' }],
      steps: [{ ...emptyStep(), kind: 'chill' }],
    };
    expect(draftToRecipe(draft).steps).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-10 audit, §2 and §11 — the editor must be able to SHOW what is stored.
//
// Found by reading the built edit form in a real browser: every measurement
// dropdown reported grams, whatever the recipe held. The option values are the
// engine's canonical ids, the stored rows hold the Hebrew names, nothing
// matched, and the browser fell back to the first option — which is grams, so
// it looked right on a gram-measured row and wrong on every other one.
//
// The consequence was not cosmetic. Open, save, and 5 יח' of eggs are stored
// as 5 g: the quantity kept and the unit replaced, with no warning.
describe('stage-10 audit: a stored unit survives a trip through the form', () => {
  const LEGACY: Recipe = {
    id: 'legacy',
    name: 'בריוש',
    ingredients: [
      { id: 'i1', name: 'קמח לחם', qty: 500, unit: 'גרם', flour: true },
      { id: 'i2', name: 'ביצים', qty: 5, unit: "יח'", unitWeight: 55 },
      { id: 'i3', name: 'חלב', qty: 60, unit: 'מ"ל' },
      { id: 'i4', name: 'שמן', qty: 2, unit: 'כף' },
    ],
    steps: [],
  } as unknown as Recipe;

  it('normalises each stored unit to the id the dropdown can display', () => {
    const rows = draftFromRecipe(LEGACY).ingredients;
    expect(rows.map((r) => r.unit)).toEqual(['g', 'unit', 'ml', 'tbsp']);
  });

  it('and a save no longer rewrites those units as grams', () => {
    const recipe = draftToRecipe(draftFromRecipe(LEGACY));
    expect(recipe.ingredients!.map((i) => i.unit)).toEqual(['g', 'unit', 'ml', 'tbsp']);
    // The quantities are untouched: this is a re-spelling, not a conversion.
    // They come back as the strings the form holds — that is the stage-4
    // decision that keeps '' apart from 0 — and the mapper makes them numbers.
    expect(recipe.ingredients!.map((i) => String(i.qty))).toEqual(['500', '5', '60', '2']);
  });

  it('weighs the same before and after, which is what proves it is a re-spelling', () => {
    const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };
    const before = compute(LEGACY, [LEGACY], { prefs });
    const after = draftToRecipe(draftFromRecipe(LEGACY));
    const afterComputed = compute({ ...after, id: 'legacy' }, [after as Recipe], { prefs });
    expect(afterComputed.rows.map((r) => r.g)).toEqual(before.rows.map((r) => r.g));
  });

  it('keeps a unit the engine does not know, rather than calling it grams', () => {
    const odd = {
      ...LEGACY,
      ingredients: [{ id: 'i1', name: 'משהו', qty: 1, unit: 'קורט' }],
    } as unknown as Recipe;
    expect(draftFromRecipe(odd).ingredients[0]!.unit).toBe('קורט');
  });
});
