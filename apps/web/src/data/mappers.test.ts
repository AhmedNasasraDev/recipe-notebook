// The row ↔ domain boundary.
//
// One rule carries almost all of the risk here: NULL is not 0. In this schema
// `yield_actual IS NULL` means "use the theoretical yield" (§1.1, §18.11) and
// `water_pct IS NULL` means "use the shared water table" — while 0 in either
// column is a measured zero. Collapse them and every yield, hydration and cost
// figure in the app shifts quietly, with no error anywhere.
//
// The second rule is that nothing is invented in either direction. A column
// with no value arrives as `undefined` and the engine decides what that means;
// the mapper does not get to pick a default on its way past.

import { describe, expect, it } from 'vitest';
import { defaultPrefs, type Calibration, type Recipe } from '@recipe-notebook/engine';
import {
  bundleToRecipe,
  calibrationRowToDomain,
  calibrationToInsert,
  ingredientsToRows,
  prefsToProfileUpdate,
  profileRowToPrefs,
  recipeToRow,
  stepsToRows,
} from './mappers.js';
import type {
  CalibrationRow,
  IngredientRow,
  ProfileRow,
  RecipeRow,
  StepRow,
} from '../lib/database.types.js';
import { newProfileRow, recipeRow, ingredientRow } from '../test/fakeSupabase.js';

const asRecipeRow = (over: Record<string, unknown> = {}) =>
  recipeRow('r1', 'owner-1', over) as unknown as RecipeRow;
const asIngredientRow = (over: Record<string, unknown> = {}) =>
  ingredientRow('r1', over) as unknown as IngredientRow;

const bundle = (recipe: RecipeRow, ingredients: IngredientRow[] = [], steps: StepRow[] = []) =>
  bundleToRecipe({ recipe, ingredients, steps });

describe('NULL is not 0 — recipe yield (§1.1, §18.11)', () => {
  it('a NULL measured yield is absent, so the engine uses the theoretical one', () => {
    const r = bundle(asRecipeRow({ yield_actual: null }));
    expect('yieldActual' in r).toBe(false);
  });

  it('a measured yield of 0 is kept as 0, because someone measured it', () => {
    const r = bundle(asRecipeRow({ yield_actual: 0 }));
    expect(r.yieldActual).toBe(0);
  });

  it('the distinction survives the trip back to the database', () => {
    const noValue = recipeToRow({ id: 'r', name: 'x' } as unknown as Recipe, 'owner-1');
    expect(noValue.yield_actual).toBeNull();

    const measuredZero = recipeToRow(
      { id: 'r', name: 'x', yieldActual: 0 } as unknown as Recipe,
      'owner-1',
    );
    expect(measuredZero.yield_actual).toBe(0);
  });

  it('holds for the two production weights as well', () => {
    const r = bundle(asRecipeRow({ weight_before: 0, weight_after: null }));
    expect(r.weightBefore).toBe(0);
    expect('weightAfter' in r).toBe(false);
  });
});

describe('NULL is not 0 — ingredient water percentage', () => {
  it('a NULL water_pct is absent, so the shared table answers', () => {
    const r = bundle(asRecipeRow(), [asIngredientRow({ water_pct: null })]);
    expect('waterPct' in r.ingredients![0]!).toBe(false);
  });

  it('a water_pct of 0 is kept — oil really does contain no water', () => {
    const r = bundle(asRecipeRow(), [
      asIngredientRow({ name: 'שמן זית', water_pct: 0, flour: false }),
    ]);
    expect(r.ingredients![0]!.waterPct).toBe(0);
  });

  it('the same holds for a recipe-level density (§5.1 rank 2)', () => {
    const r = bundle(asRecipeRow(), [asIngredientRow({ g_per_100: null })]);
    expect('gPer100' in r.ingredients![0]!).toBe(false);
  });
});

describe('nothing is invented', () => {
  it('an absent dough mode brings no dough temperatures with it', () => {
    const r = bundle(asRecipeRow({ dough_mode: false, ddt: 26, flour_temp: 20 }));
    // The row carries values, but dough mode is off, so they are not part of
    // the recipe. Reading them in would switch on a calculation nobody asked for.
    expect('ddt' in r).toBe(false);
    expect('flourTemp' in r).toBe(false);
  });

  it('an empty price stays empty rather than becoming zero', () => {
    const r = bundle(asRecipeRow(), [asIngredientRow({ price: null, price_unit: null })]);
    expect('price' in r.ingredients![0]!).toBe(false);
    expect('priceUnit' in r.ingredients![0]!).toBe(false);
  });

  it('an unrecognised price unit is dropped, not coerced to a guess', () => {
    const rows = ingredientsToRows(
      {
        id: 'r',
        name: 'x',
        ingredients: [{ id: 'i', name: 'קמח', qty: 1, unit: 'גרם', priceUnit: 'טון' }],
      } as unknown as Recipe,
      'r1',
    );
    expect(rows[0]!.price_unit).toBeNull();
  });

  it('a missing created_at becomes an empty label, not a crash and not today', () => {
    const r = bundle(asRecipeRow({ created_at: undefined }));
    expect(r.createdAt).toBe('');
  });

  it('an empty ingredient key becomes NULL, so it cannot match another empty one', () => {
    const rows = ingredientsToRows(
      { id: 'r', name: 'x', ingredients: [{ id: 'i', name: '', qty: 1, unit: 'גרם' }] } as unknown as Recipe,
      'r1',
    );
    expect(rows[0]!.ingredient_key).toBeNull();
  });
});

describe('ordering is explicit, because a set has none', () => {
  it('ingredients come back in `ord` order regardless of row order', () => {
    const r = bundle(asRecipeRow(), [
      asIngredientRow({ ord: 2, name: 'מלח' }),
      asIngredientRow({ ord: 0, name: 'קמח' }),
      asIngredientRow({ ord: 1, name: 'מים' }),
    ]);
    expect(r.ingredients!.map((i) => i.name)).toEqual(['קמח', 'מים', 'מלח']);
  });

  it('and the write side numbers them from the array position', () => {
    const rows = ingredientsToRows(
      {
        id: 'r',
        name: 'x',
        ingredients: [
          { id: 'a', name: 'קמח', qty: 1, unit: 'גרם' },
          { id: 'b', name: 'מים', qty: 1, unit: 'גרם' },
        ],
      } as unknown as Recipe,
      'r1',
    );
    expect(rows.map((r) => r.ord)).toEqual([0, 1]);
  });

  it('steps keep their order too', () => {
    const rows = stepsToRows(
      {
        id: 'r',
        name: 'x',
        steps: [{ id: 's1', text: 'ראשון' }, { id: 's2', text: 'שני', tempUnit: 'F' }],
      } as unknown as Recipe,
      'r1',
    );
    expect(rows.map((s) => [s.ord, s.text, s.temp_unit])).toEqual([
      [0, 'ראשון', 'C'],
      [1, 'שני', 'F'],
    ]);
  });
});

describe('profile ↔ MeasurementPrefs (§1.2, §4)', () => {
  it('onboarding_done on the server is `done` on the client', () => {
    const prefs = profileRowToPrefs(
      newProfileRow('u1', { onboarding_done: true }) as unknown as ProfileRow,
    );
    expect(prefs.done).toBe(true);
    expect(prefsToProfileUpdate(prefs).onboarding_done).toBe(true);
  });

  it('round-trips the profile type, units, tools and the touched flag', () => {
    const original = {
      ...defaultPrefs('home'),
      done: true,
      units: ['g', 'cup'],
      touchedUnits: true,
      tools: { cup: 250, tbsp: 15, tsp: 5 },
    };
    const update = prefsToProfileUpdate(original);
    const back = profileRowToPrefs(
      newProfileRow('u1', update as Record<string, unknown>) as unknown as ProfileRow,
    );
    expect(back.profile).toBe('home');
    expect(back.units).toEqual(['g', 'cup']);
    expect(back.tools).toEqual({ cup: 250, tbsp: 15, tsp: 5 });
    expect(back.touchedUnits).toBe(true);
    expect(back.done).toBe(true);
  });

  it('merges the calibration list in, because §1.2 hangs it off prefs', () => {
    const calib: Calibration[] = [
      { id: 'c', ingredientKey: 'קמח לבן', name: 'קמח לבן', tool: 'cup', toolMl: 240, grams: 128, at: '2026-01-01' },
    ];
    const prefs = profileRowToPrefs(newProfileRow('u1') as unknown as ProfileRow, calib);
    expect(prefs.calib).toHaveLength(1);
  });
});

describe('calibrations keep the tool volume frozen (engine B5)', () => {
  const row = {
    id: 'c1',
    user_id: 'u1',
    ingredient_name: 'סוכר',
    ingredient_key: 'סוכר',
    tool: 'cup',
    tool_ml: 240,
    grams: 200,
    tool_ml_assumed: false,
    created_at: '2026-03-05T09:00:00Z',
  } as unknown as CalibrationRow;

  it('reads tool_ml as stored, never recomputed from current preferences', () => {
    expect(calibrationRowToDomain(row).toolMl).toBe(240);
  });

  it('keeps the date as a day, for display', () => {
    expect(calibrationRowToDomain(row).at).toBe('2026-03-05');
  });

  it('omits the assumed flag when it is false, and carries it when true', () => {
    expect('toolMlAssumed' in calibrationRowToDomain(row)).toBe(false);
    const assumed = calibrationRowToDomain({
      ...row,
      tool_ml_assumed: true,
    } as unknown as CalibrationRow);
    expect(assumed.toolMlAssumed).toBe(true);
  });

  it('derives the stable key from the name when the calibration has none', () => {
    const insert = calibrationToInsert(
      { id: 'x', name: 'קמח לבן', tool: 'cup', toolMl: 240, grams: 128, at: '2026-01-01' } as Calibration,
      'u1',
    );
    // Whole-name identity, which is what replaced the substring matching of B4.
    expect(insert.ingredient_key).toBe('קמח לבן');
    expect(insert.user_id).toBe('u1');
  });
});

describe('the owner is never taken from the payload', () => {
  it('recipeToRow stamps the repository\'s user, ignoring anything on the recipe', () => {
    const row = recipeToRow(
      { id: 'r', name: 'x', owner_id: 'someone-else' } as unknown as Recipe,
      'the-real-owner',
    );
    expect(row.owner_id).toBe('the-real-owner');
  });

  it('and group_id stays null while groups are out of scope', () => {
    const row = recipeToRow({ id: 'r', name: 'x' } as unknown as Recipe, 'u1');
    expect(row.group_id).toBeNull();
  });
});
