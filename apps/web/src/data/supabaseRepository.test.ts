// The Supabase repository, against the in-memory double in test/fakeSupabase.ts.
//
// Two distinct things are under test and they are worth keeping apart:
//
//   1. Mapping — a row goes in, a Recipe comes out, and back again, without
//      anything being invented or flattened. The `null` vs `0` distinction is
//      the one that would corrupt real numbers if it broke.
//   2. Scoping — a repository built for user A never returns user B's data,
//      even though the double, like the real database, applies the policies
//      regardless of what filter the query carried.
//
// The live-database proof of (2) is supabase/tests/rls-isolation.sql.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

// The mirror's own code stays under test; only IndexedDB underneath it is
// replaced, because jsdom has none. See test/memoryIdb.ts.
vi.mock('idb-keyval', () => memoryIdb());

import { defaultPrefs, type Calibration, type Recipe } from '@recipe-notebook/engine';
import { createSupabaseRepository } from './supabaseRepository.js';
import { WriteNotAllowedError } from './repository.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import {
  createFakeSupabase,
  ingredientRow,
  newProfileRow,
  recipeRow,
  resetFakeIds,
  USER_A,
  USER_B,
  type FakeDb,
  type FakeSupabase,
} from '../test/fakeSupabase.js';

function seed(): FakeDb {
  return {
    profiles: [
      newProfileRow(USER_A),
      newProfileRow(USER_B, {
        tools: { cup: 250, tbsp: 15, tsp: 5 },
        profile: 'home',
        pro: false,
        onboarding_done: true,
      }),
    ],
    recipes: [
      recipeRow('ra1', USER_A, { name: 'עוגת שוקולד של א', yield_units: 12, unit_weight: 85 }),
      recipeRow('rb1', USER_B, { name: 'הבריוש הסודי של ב' }),
    ],
    ingredients: [
      ingredientRow('ra1', { name: 'קמח לבן', qty: 500 }),
      ingredientRow('rb1', { name: 'חמאה 82%', qty: 250, flour: false }),
    ],
    steps: [],
    issues: [],
    trials: [],
    batches: [],
    recipe_versions: [],
    private_notes: [
      { id: 'pna', user_id: USER_A, recipe_id: 'ra1', group_item_id: null, body: 'סוד של א', updated_at: 'x' },
      { id: 'pnb', user_id: USER_B, recipe_id: 'rb1', group_item_id: null, body: 'סוד של ב', updated_at: 'x' },
    ],
    calibrations: [
      {
        id: 'ca', user_id: USER_A, ingredient_name: 'קמח לבן', ingredient_key: 'flour.white',
        tool: 'cup', tool_ml: 240, grams: 128, tool_ml_assumed: false,
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        id: 'cb', user_id: USER_B, ingredient_name: 'קמח לבן', ingredient_key: 'flour.white',
        tool: 'cup', tool_ml: 250, grams: 141, tool_ml_assumed: false,
        created_at: '2026-02-01T00:00:00Z',
      },
    ],
  };
}

let fake: FakeSupabase;
const repoFor = (userId: string) =>
  createSupabaseRepository({ client: fake.client as TypedSupabaseClient, userId });

/**
 * Runs `fn` with the browser reporting no network, then puts it back.
 *
 * `navigator.onLine` is an accessor on Navigator.prototype, not an own property
 * of the instance — so `Object.getOwnPropertyDescriptor(navigator, 'onLine')`
 * returns undefined, and a restore guarded on that value never runs. The first
 * version of this leaked `onLine = false` into every test declared after it,
 * which then failed with "no connection" for no visible reason. The fix is to
 * delete the own property that defineProperty added, letting the prototype
 * accessor take over again.
 */
async function whileOffline(fn: () => Promise<void>): Promise<void> {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  try {
    await fn();
  } finally {
    delete (navigator as unknown as Record<string, unknown>)['onLine'];
  }
}

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
  fake = createFakeSupabase({ db: seed(), authUid: USER_A });
});

describe('the repository reads the signed-in account, and only it', () => {
  it('lists A\'s recipes and not B\'s', async () => {
    const list = await repoFor(USER_A).listRecipes();
    expect(list.map((r) => r.name)).toEqual(['עוגת שוקולד של א']);
  });

  it('brings the ingredient rows with the recipe, in order', async () => {
    const list = await repoFor(USER_A).listRecipes();
    expect(list[0]!.ingredients?.map((i) => i.name)).toEqual(['קמח לבן']);
  });

  it('returns null for a recipe id that belongs to another account', async () => {
    // The id is real and exists. RLS is what makes it invisible, not the id.
    expect(await repoFor(USER_A).getRecipe('rb1')).toBeNull();
  });

  it('reads A\'s preferences, including the tool sizes', async () => {
    const prefs = await repoFor(USER_A).getPrefs();
    expect(prefs?.tools).toEqual({ cup: 240, tbsp: 15, tsp: 5 });
    expect(prefs?.done).toBe(false);
  });

  it('never returns B\'s tool sizes to A', async () => {
    const prefs = await repoFor(USER_A).getPrefs();
    expect(prefs?.tools?.cup).not.toBe(250);
  });

  it('reads only A\'s calibrations', async () => {
    const list = await repoFor(USER_A).listCalibrations();
    expect(list).toHaveLength(1);
    expect(list[0]!.toolMl).toBe(240);
  });
});

describe('isolation between two accounts, at the repository level', () => {
  it('gives each account its own notebook from the same store', async () => {
    fake.setAuthUid(USER_A);
    const a = await repoFor(USER_A).listRecipes();
    fake.setAuthUid(USER_B);
    const b = await repoFor(USER_B).listRecipes();

    expect(a.map((r) => r.name)).toEqual(['עוגת שוקולד של א']);
    expect(b.map((r) => r.name)).toEqual(['הבריוש הסודי של ב']);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });

  it('keeps calibrations apart — the value that would silently change every conversion', async () => {
    fake.setAuthUid(USER_A);
    const a = await repoFor(USER_A).listCalibrations();
    fake.setAuthUid(USER_B);
    const b = await repoFor(USER_B).listCalibrations();
    expect(a.map((c) => c.grams)).toEqual([128]);
    expect(b.map((c) => c.grams)).toEqual([141]);
  });

  it('refuses to save a recipe into another account, even when asked directly', async () => {
    // A signed in as A, handing the repository a recipe it will own as A. There
    // is no code path that lets a client choose the owner — recipeToRow takes
    // the owner from the repository's own userId, not from the payload.
    fake.setAuthUid(USER_A);
    const saved = await repoFor(USER_A).saveRecipe({
      id: 'new-1',
      name: 'מתכון חדש',
      ingredients: [],
      steps: [],
    } as unknown as Recipe);
    const row = fake.db['recipes']!.find((r) => r['id'] === saved.id);
    expect(row!['owner_id']).toBe(USER_A);
  });

  it('cannot forge an owner, because the server picks it (stage 5)', async () => {
    // Before stage 5 this was a client-side INSERT carrying `owner_id`, and a
    // repository built with the wrong id had its write REJECTED by WITH CHECK.
    // The save_recipe RPC does not accept an owner at all — it takes
    // auth.uid() — so the forgery is no longer expressible rather than merely
    // refused. The stronger property, and the one worth asserting.
    fake.setAuthUid(USER_A);
    const saved = await repoFor(USER_B).saveRecipe({
      id: 'new-2', name: 'מתכון מושתל', ingredients: [], steps: [],
    } as unknown as Recipe);

    const row = fake.db['recipes']!.find((r) => r['id'] === saved.id)!;
    expect(row['owner_id']).toBe(USER_A);   // the session
    expect(row['owner_id']).not.toBe(USER_B); // not the repository's id
  });
});

describe('writing a recipe', () => {
  const draft = {
    id: 'new-3',
    name: 'לחם כוסמין',
    category: 'לחמים ובצקים',
    yieldUnits: 2,
    unitWeight: 800,
    ingredients: [
      { id: 'i1', name: 'קמח מלא', qty: 600, unit: 'גרם', flour: true },
      { id: 'i2', name: 'מים', qty: 420, unit: 'גרם', liquid: true },
    ],
    steps: [{ id: 's1', text: 'ללוש', minutes: 12 }],
  } as unknown as Recipe;

  it('creates the parent row and its children, and reads the result back', async () => {
    const saved = await repoFor(USER_A).saveRecipe(draft);
    expect(saved.id).not.toBe('new-3'); // the database assigned the real id
    expect(saved.name).toBe('לחם כוסמין');
    expect(saved.ingredients?.map((i) => i.name)).toEqual(['קמח מלא', 'מים']);
    expect(saved.steps?.map((s) => s.text)).toEqual(['ללוש']);
  });

  it('updates in place rather than creating a second recipe', async () => {
    const created = await repoFor(USER_A).saveRecipe(draft);
    const before = fake.db['recipes']!.length;

    await repoFor(USER_A).saveRecipe({ ...created, name: 'לחם כוסמין 2' });

    expect(fake.db['recipes']!.length).toBe(before);
    const again = await repoFor(USER_A).getRecipe(created.id);
    expect(again?.name).toBe('לחם כוסמין 2');
  });

  it('replaces the ingredient list instead of appending to it', async () => {
    const created = await repoFor(USER_A).saveRecipe(draft);
    await repoFor(USER_A).saveRecipe({
      ...created,
      ingredients: [{ id: 'i9', name: 'שיפון', qty: 100, unit: 'גרם' }],
    } as unknown as Recipe);

    const again = await repoFor(USER_A).getRecipe(created.id);
    expect(again?.ingredients?.map((i) => i.name)).toEqual(['שיפון']);
  });

  it('refuses a nameless recipe before it reaches the database', async () => {
    await expect(
      repoFor(USER_A).saveRecipe({ id: 'new-4', name: '  ' } as unknown as Recipe),
    ).rejects.toBeInstanceOf(WriteNotAllowedError);
    // and nothing was written
    expect(fake.db['recipes']!.map((r) => r['name'])).not.toContain('  ');
  });
});

describe('preferences and onboarding persist to the server (§4, §1.2)', () => {
  it('writes the onboarding flag, so it is not asked again on another device', async () => {
    const repo = repoFor(USER_A);
    await repo.savePrefs({ ...defaultPrefs('pro'), done: true });
    expect(fake.db['profiles']![0]!['onboarding_done']).toBe(true);

    // the round trip a fresh login performs
    const reloaded = await repo.getPrefs();
    expect(reloaded?.done).toBe(true);
  });

  it('writes the tool sizes, which every volume conversion depends on (B1)', async () => {
    const repo = repoFor(USER_A);
    await repo.savePrefs({
      ...defaultPrefs('pro'),
      done: true,
      tools: { cup: 250, tbsp: 15, tsp: 5 },
    });
    const reloaded = await repo.getPrefs();
    expect(reloaded?.tools).toEqual({ cup: 250, tbsp: 15, tsp: 5 });
  });

  it('writes the profile type and the units list', async () => {
    const repo = repoFor(USER_A);
    await repo.savePrefs({
      ...defaultPrefs('home'),
      done: true,
      units: ['g', 'cup'],
      touchedUnits: true,
    });
    const row = fake.db['profiles']![0]!;
    expect(row['profile']).toBe('home');
    expect(row['units']).toEqual(['g', 'cup']);
    expect(row['touched_units']).toBe(true);
  });

  it('does not touch another account\'s profile', async () => {
    await repoFor(USER_A).savePrefs({ ...defaultPrefs('home'), done: true });
    const b = fake.db['profiles']!.find((p) => p['user_id'] === USER_B)!;
    expect(b['profile']).toBe('home'); // B was seeded as 'home' and is unchanged
    expect(b['tools']).toEqual({ cup: 250, tbsp: 15, tsp: 5 });
  });

  it('returns null when the account has no profile row yet', async () => {
    fake.db['profiles'] = [];
    expect(await repoFor(USER_A).getPrefs()).toBeNull();
  });
});

describe('calibrations round-trip with the frozen tool volume (B5)', () => {
  const calib: Calibration = {
    id: 'c-new',
    ingredientKey: 'sugar.granulated',
    name: 'סוכר',
    tool: 'cup',
    toolMl: 240,
    grams: 200,
    at: '2026-03-01',
  };

  it('saves the list and reads it back with toolMl intact', async () => {
    const repo = repoFor(USER_A);
    await repo.saveCalibrations([calib]);
    const back = await repo.listCalibrations();
    expect(back).toHaveLength(1);
    expect(back[0]!.toolMl).toBe(240);
    expect(back[0]!.grams).toBe(200);
    expect(back[0]!.ingredientKey).toBe('sugar.granulated');
  });

  it('a later change to the cup size does not rewrite a stored calibration', async () => {
    const repo = repoFor(USER_A);
    await repo.saveCalibrations([calib]);
    await repo.savePrefs({
      ...defaultPrefs('pro'),
      done: true,
      tools: { cup: 250, tbsp: 15, tsp: 5 },
    });
    const back = await repo.listCalibrations();
    expect(back[0]!.toolMl).toBe(240);
  });

  it('replacing the set removes only this account\'s rows', async () => {
    await repoFor(USER_A).saveCalibrations([]);
    expect(fake.db['calibrations']!.map((c) => c['user_id'])).toEqual([USER_B]);
  });
});

describe('when the network is gone', () => {
  it('reports itself unable to write and refuses, rather than losing the edit silently', async () => {
    await whileOffline(async () => {
      const repo = repoFor(USER_A);
      expect(repo.capabilities().canWrite).toBe(false);
      await expect(
        repo.saveRecipe({ id: 'new-5', name: 'משהו', ingredients: [], steps: [] } as unknown as Recipe),
      ).rejects.toBeInstanceOf(WriteNotAllowedError);
    });
  });

  it('is online again once that test is over — the guard restores it', () => {
    // A regression test for the leak itself: without the delete above, every
    // test declared after the offline one ran against a browser that believed
    // it had no network.
    expect(repoFor(USER_A).capabilities().canWrite).toBe(true);
  });

  it('serves the notebook from the mirror when the read fails, and says so', async () => {
    const repo = repoFor(USER_A);
    await repo.listRecipes(); // populates the mirror
    await repo.getRecipe('ra1');

    fake.setFailWith({ message: 'TypeError: Failed to fetch' });
    const cached = await repo.listRecipes();
    expect(cached.map((r) => r.name)).toEqual(['עוגת שוקולד של א']);
    expect(repo.capabilities().servingFromCache).toBe(true);
  });

  it('raises the failure when there is nothing in the mirror either', async () => {
    fake.setFailWith({ message: 'TypeError: Failed to fetch' });
    await expect(repoFor(USER_A).listRecipes()).rejects.toThrow(/טעינת המחברת נכשלה/);
  });
});

describe('deleting a recipe (stage 4, requirement 7)', () => {
  it('removes the recipe and its children', async () => {
    const repo = repoFor(USER_A);
    await repo.deleteRecipe('ra1');
    expect(fake.db['recipes']!.map((r) => r['id'])).toEqual(['rb1']);
    // ON DELETE CASCADE, emulated by the double the same way the schema does it
    expect(fake.db['ingredients']!.every((i) => i['recipe_id'] === 'rb1')).toBe(true);
    expect(fake.db['private_notes']!.every((n) => n['recipe_id'] === 'rb1')).toBe(true);
  });

  it('is a no-op on another account\'s recipe, not an error', async () => {
    // RLS makes the row invisible, so the DELETE matches nothing. Reporting a
    // failure here would tell the caller the id exists, which is itself a leak.
    await repoFor(USER_A).deleteRecipe('rb1');
    expect(fake.db['recipes']!.map((r) => r['id']).sort()).toEqual(['ra1', 'rb1']);
  });

  it('drops the local copy too, so a deleted recipe cannot come back from cache', async () => {
    const repo = repoFor(USER_A);
    await repo.listRecipes();
    await repo.getRecipe('ra1');
    await repo.deleteRecipe('ra1');

    // With the network gone the mirror is what answers, and it must not serve
    // a recipe that was deleted.
    fake.setFailWith({ message: 'TypeError: Failed to fetch' });
    await expect(repo.listRecipes()).rejects.toThrow(/טעינת המחברת נכשלה/);
  });

  it('refuses to delete while offline rather than losing track of it', async () => {
    await whileOffline(async () => {
      await expect(repoFor(USER_A).deleteRecipe('ra1')).rejects.toBeInstanceOf(
        WriteNotAllowedError,
      );
      expect(fake.db['recipes']).toHaveLength(2);
    });
  });
});

describe('a brand-new account starts empty (requirement 6)', () => {
  it('gets no recipes at all — not the demo set, not anyone else\'s', async () => {
    const NEW_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    fake.db['profiles']!.push(newProfileRow(NEW_USER));
    fake.setAuthUid(NEW_USER);

    const repo = repoFor(NEW_USER);
    expect(await repo.listRecipes()).toEqual([]);
    expect(await repo.listCalibrations()).toEqual([]);
    const prefs = await repo.getPrefs();
    // The profile exists (the trigger made it) but onboarding has not run.
    expect(prefs?.done).toBe(false);
  });

  it('still gets the category list, which is UI copy rather than someone\'s data', async () => {
    const cats = await repoFor(USER_A).listCategories();
    expect(cats.length).toBeGreaterThan(0);
  });
});

/*
  ── QA 22.09.2026, finding 1: "שמירת מיקום התמונה נכשלה (PGRST204)" ─────────

  The real project had not had migration 0038 applied, so the two focal
  columns did not exist. PostgREST reports a column named in the request body
  that is missing from its schema cache as PGRST204 — not as Postgres's
  42703, which was the only code the repository recognised — and the person
  got a generic sentence with a code in it instead of the one fact that
  explains the failure. Pinned with a client that answers exactly what the
  real one answered.
*/
describe('a focal point on a database without migration 0038', () => {
  it('names the missing migration for PGRST204 as well as for 42703', async () => {
    for (const code of ['PGRST204', '42703']) {
      const client = {
        from: () => ({
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code, message: "Could not find the 'focal_x' column of 'recipe_images'" },
                }),
              }),
            }),
          }),
        }),
        storage: { from: () => ({}) },
      } as unknown as TypedSupabaseClient;
      const repo = createSupabaseRepository({ client, userId: USER_A });
      await expect(
        repo.setRecipeImageFocus(
          {
            id: 'i1', recipeId: 'ra1', storagePath: 'ra1/i1.webp', ord: 0, width: 1, height: 1,
            bytes: 1, caption: '', createdAt: 'x', focalX: 50, focalY: 50,
          },
          { x: 10, y: 10 },
        ),
      ).rejects.toThrow(/מיגרציה 0038/);
    }
  });
});
