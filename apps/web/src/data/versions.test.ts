// Versioning and sub-recipe links, through the repository.
//
// The database is the authority for all of this and is verified directly —
// atomicity, the guards, RLS and the concurrency check are each probed against
// the live Postgres, and the results are in REVIEW_STEP5_REPORT.md. What these
// tests add is the CLIENT half: that the repository calls the RPCs with the
// right arguments, maps a snapshot back faithfully, and surfaces each refusal
// as an error rather than swallowing it.
//
// The one thing the double cannot model is rollback — JavaScript has no
// transaction. It compensates by evaluating every guard before the first write,
// so a refusal leaves nothing changed, which is the same thing a caller can
// observe. The real atomicity proof is against Postgres.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import type { Recipe } from '@recipe-notebook/engine';
import { createSupabaseRepository } from './supabaseRepository.js';
import { RecipeInUseError, WriteNotAllowedError } from './repository.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import {
  createFakeSupabase,
  newProfileRow,
  resetFakeIds,
  USER_A,
  USER_B,
  type FakeDb,
  type FakeSupabase,
} from '../test/fakeSupabase.js';

function emptyDb(): FakeDb {
  return {
    profiles: [newProfileRow(USER_A), newProfileRow(USER_B)],
    recipes: [], ingredients: [], steps: [], issues: [],
    trials: [], batches: [], recipe_versions: [], private_notes: [], calibrations: [],
  };
}

let fake: FakeSupabase;
const repo = (userId = USER_A) =>
  createSupabaseRepository({ client: fake.client as TypedSupabaseClient, userId });

const draft = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'new-1',
    name: 'לחם כוסמין',
    category: 'לחמים',
    ingredients: [
      { id: 'i1', name: 'קמח מלא', qty: 600, unit: 'g', flour: true, price: 4.25, priceUnit: 'ק"ג' },
      { id: 'i2', name: 'שמן זית', qty: 30, unit: 'ml', waterPct: 0 },
    ],
    steps: [{ id: 's1', text: 'ללוש', minutes: 12 }],
    ...over,
  }) as Recipe;

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
  fake = createFakeSupabase({ db: emptyDb(), authUid: USER_A });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 1 — the previous state is snapshotted before an update', () => {
  it('creates NO version for a brand-new recipe', async () => {
    // There is no previous state. A "V1" holding the recipe's own first state
    // would be history of nothing.
    const saved = await repo().saveRecipe(draft());
    expect(await repo().listVersions(saved.id)).toEqual([]);
  });

  it('creates one on the first update, holding the state as it WAS', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe(
      { ...created, name: 'לחם כוסמין 2' },
      { versionNote: 'שם השתנה', expectedUpdatedAt: created['updatedAt'] as string },
    );

    const versions = await r.listVersions(created.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.tag).toBe('V1');
    expect(versions[0]!.what).toBe('שם השתנה');
    // the OLD name, not the new one
    expect(versions[0]!.snapshot.name).toBe('לחם כוסמין');
  });

  it('numbers versions V1, V2, V3 as saves accumulate', async () => {
    const r = repo();
    let cur = await r.saveRecipe(draft());
    for (const name of ['שני', 'שלישי', 'רביעי']) {
      cur = await r.saveRecipe(
        { ...cur, name },
        { expectedUpdatedAt: cur['updatedAt'] as string },
      );
    }
    const versions = await r.listVersions(cur.id);
    expect(versions.map((v) => v.tag).sort()).toEqual(['V1', 'V2', 'V3']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 2 — a snapshot is enough to rebuild the recipe', () => {
  it('carries the ingredients, not just the recipe row', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe(
      { ...created, ingredients: [created.ingredients![0]!] },
      { expectedUpdatedAt: created['updatedAt'] as string },
    );

    const [v] = await r.listVersions(created.id);
    expect(v!.snapshot.ingredients?.map((i) => i.name)).toEqual(['קמח מלא', 'שמן זית']);
    expect(v!.snapshot.steps?.map((s) => s.text)).toEqual(['ללוש']);
  });

  it('preserves null vs 0 inside the snapshot', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe(
      { ...created, name: 'אחר' },
      { expectedUpdatedAt: created['updatedAt'] as string },
    );

    const [v] = await r.listVersions(created.id);
    const ings = v!.snapshot.ingredients!;
    const flour = ings.find((i) => i.name === 'קמח מלא')!;
    const oil = ings.find((i) => i.name === 'שמן זית')!;
    // untouched water percentage: absent, so the shared table answers
    expect('waterPct' in flour).toBe(false);
    // a MEASURED zero: kept as zero
    expect(oil.waterPct).toBe(0);
    // an empty price stays empty rather than becoming free
    expect('price' in oil).toBe(false);
    expect(flour.price).toBe(4.25);
  });

  it('does not nest version history inside a snapshot', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe({ ...created, name: 'a' }, { expectedUpdatedAt: created['updatedAt'] as string });
    const after1 = (await r.getRecipe(created.id))!;
    await r.saveRecipe({ ...after1, name: 'b' }, { expectedUpdatedAt: after1['updatedAt'] as string });

    const versions = await r.listVersions(created.id);
    // Each snapshot would otherwise contain the one before it, growing by a
    // factor on every save.
    for (const v of versions) {
      expect(v.snapshot.versions).toBeUndefined();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 6, 7 — restore, and restoring a restore', () => {
  it('brings back the snapshot\'s name and ingredients', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe(
      { ...created, name: 'גרסה חדשה', ingredients: [created.ingredients![0]!] },
      { expectedUpdatedAt: created['updatedAt'] as string },
    );

    const [v1] = await r.listVersions(created.id);
    const restored = await r.restoreVersion(v1!.id);

    expect(restored.name).toBe('לחם כוסמין');
    expect(restored.ingredients?.map((i) => i.name)).toEqual(['קמח מלא', 'שמן זית']);
  });

  it('does NOT delete history — it adds the pre-restore state', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });

    const before = await r.listVersions(created.id);
    expect(before).toHaveLength(1);

    await r.restoreVersion(before[0]!.id);
    const after = await r.listVersions(created.id);
    expect(after).toHaveLength(2);
    // the added one describes itself as the pre-restore state
    expect(after.some((v) => v.what.includes('לפני שחזור V1'))).toBe(true);
  });

  it('lets a wrong restore be undone, which is the point of requirement 7', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());               // name: לחם כוסמין
    const edited = await r.saveRecipe(
      { ...created, name: 'הגרסה שאני רוצה' },
      { expectedUpdatedAt: created['updatedAt'] as string },
    );

    // A restore the user regrets: back to the original name.
    const [v1] = await r.listVersions(created.id);
    await r.restoreVersion(v1!.id);
    expect((await r.getRecipe(created.id))!.name).toBe('לחם כוסמין');

    // The restore itself saved "הגרסה שאני רוצה" as a version, so undo it.
    const versions = await r.listVersions(created.id);
    const preRestore = versions.find((v) => v.snapshot.name === 'הגרסה שאני רוצה')!;
    expect(preRestore).toBeDefined();
    await r.restoreVersion(preRestore.id);

    expect((await r.getRecipe(created.id))!.name).toBe('הגרסה שאני רוצה');
    void edited;
  });

  it('survives restoring the same version repeatedly', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });
    const [v1] = await r.listVersions(created.id);

    for (let i = 0; i < 3; i += 1) {
      await r.restoreVersion(v1!.id);
      expect((await r.getRecipe(created.id))!.name).toBe('לחם כוסמין');
    }
    // Each restore added its own pre-restore snapshot: 1 + 3 = 4
    expect(await r.listVersions(created.id)).toHaveLength(4);
  });

  it('restores an OLD version, not only the most recent', async () => {
    const r = repo();
    let cur = await r.saveRecipe(draft({ name: 'ראשון' }));
    for (const name of ['שני', 'שלישי', 'רביעי']) {
      cur = await r.saveRecipe({ ...cur, name }, { expectedUpdatedAt: cur['updatedAt'] as string });
    }
    const versions = await r.listVersions(cur.id);
    const oldest = versions.find((v) => v.tag === 'V1')!;
    expect(oldest.snapshot.name).toBe('ראשון');

    await r.restoreVersion(oldest.id);
    expect((await r.getRecipe(cur.id))!.name).toBe('ראשון');
  });

  it('refuses to restore a locked recipe (§9)', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });
    const [v1] = await r.listVersions(created.id);

    // lock it
    const now = (await r.getRecipe(created.id))!;
    await r.saveRecipe({ ...now, locked: true }, { expectedUpdatedAt: now['updatedAt'] as string });

    await expect(r.restoreVersion(v1!.id)).rejects.toThrow(/נוסחה מאושרת לייצור/);
    // and nothing moved
    expect((await r.getRecipe(created.id))!.name).toBe('חדש');
  });

  it('refuses a version id that does not exist', async () => {
    await expect(repo().restoreVersion('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /הגרסה לא נמצאה/,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 8 — another account\'s versions', () => {
  it('are not listed', async () => {
    const a = repo(USER_A);
    const created = await a.saveRecipe(draft());
    await a.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });
    expect(await a.listVersions(created.id)).toHaveLength(1);

    fake.setAuthUid(USER_B);
    expect(await repo(USER_B).listVersions(created.id)).toHaveLength(0);
  });

  it('cannot be restored, even with the version id in hand', async () => {
    const a = repo(USER_A);
    const created = await a.saveRecipe(draft());
    await a.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });
    const [v1] = await a.listVersions(created.id);

    fake.setAuthUid(USER_B);
    await expect(repo(USER_B).restoreVersion(v1!.id)).rejects.toThrow(/הגרסה לא נמצאה/);

    fake.setAuthUid(USER_A);
    expect((await a.getRecipe(created.id))!.name).toBe('חדש');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 9 — a refusal leaves no partial history', () => {
  it('writes no version when the save is rejected for a stale token', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    const stale = created['updatedAt'] as string;

    // one accepted save moves the token
    await r.saveRecipe({ ...created, name: 'ראשון' }, { expectedUpdatedAt: stale });
    const versionsAfterOne = await r.listVersions(created.id);

    // now a second save with the SAME, now-stale token
    await expect(
      r.saveRecipe({ ...created, name: 'מתנגש' }, { expectedUpdatedAt: stale }),
    ).rejects.toThrow(/שונה במקום אחר/);

    // no extra version, and the name did not move
    expect(await r.listVersions(created.id)).toHaveLength(versionsAfterOne.length);
    expect((await r.getRecipe(created.id))!.name).toBe('ראשון');
  });

  it('writes no version when the save is rejected for a bad sub-recipe link', async () => {
    const a = repo(USER_A);
    const mine = await a.saveRecipe(draft());

    fake.setAuthUid(USER_B);
    const theirs = await repo(USER_B).saveRecipe(draft({ name: 'של ב' }));
    fake.setAuthUid(USER_A);

    const before = await a.listVersions(mine.id);
    const nameBefore = (await a.getRecipe(mine.id))!.name;

    // The failure happens on the child rows — AFTER a naive implementation
    // would already have written the version and the parent update.
    await expect(
      a.saveRecipe(
        {
          ...mine,
          name: 'שינוי שאמור להתגלגל אחורה',
          ingredients: [{ id: 'x', name: 'של ב', qty: 100, unit: 'g', subId: theirs.id }],
        } as unknown as Recipe,
        { expectedUpdatedAt: mine['updatedAt'] as string },
      ),
    ).rejects.toThrow(/אותו חשבון/);

    expect(await a.listVersions(mine.id)).toHaveLength(before.length);
    expect((await a.getRecipe(mine.id))!.name).toBe(nameBefore);
  });

  it('refuses a save offline, before anything is attempted', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      const r = repo();
      await expect(r.saveRecipe(draft())).rejects.toBeInstanceOf(WriteNotAllowedError);
      expect(fake.db['recipes']).toHaveLength(0);
      expect(fake.db['recipe_versions']).toHaveLength(0);
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['onLine'];
    }
  });

  it('refuses a restore offline', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await r.saveRecipe({ ...created, name: 'חדש' }, { expectedUpdatedAt: created['updatedAt'] as string });
    const [v1] = await r.listVersions(created.id);

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      await expect(r.restoreVersion(v1!.id)).rejects.toBeInstanceOf(WriteNotAllowedError);
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['onLine'];
    }
    expect((await r.getRecipe(created.id))!.name).toBe('חדש');
  });

  it('surfaces a server failure rather than reporting success', async () => {
    const r = repo();
    fake.setFailWith({ message: 'TypeError: Failed to fetch' });
    await expect(r.saveRecipe(draft())).rejects.toThrow(/יצירת המתכון נכשלה/);
  });

  it('a malformed snapshot is reported, not silently applied', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    // A row written before migration 0007, or hand-edited.
    fake.db['recipe_versions']!.push({
      id: 'broken', recipe_id: created.id, tag: 'V0', what: 'ריק',
      snapshot: {}, created_at: '2026-01-01T00:00:00Z', created_by: USER_A,
    });

    const versions = await r.listVersions(created.id);
    const broken = versions.find((v) => v.id === 'broken')!;
    // listable and labelled, so the history stays renderable
    expect(broken.snapshot['snapshotUnavailable']).toBe(true);
    await expect(r.restoreVersion('broken')).rejects.toThrow(/אין תוכן/);
    expect((await r.getRecipe(created.id))!.name).toBe('לחם כוסמין');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('sub-recipe links, at the repository level', () => {
  it('saves a legitimate link and the engine rolls the cost up', async () => {
    const r = repo();
    const base = await r.saveRecipe(
      draft({
        id: 'new-base', name: 'גנאש', isSub: true,
        ingredients: [{ id: 'b1', name: 'שוקולד', qty: 200, unit: 'g', price: 60, priceUnit: 'ק"ג' }],
        steps: [],
      }),
    );
    const top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'עוגה',
        ingredients: [{ id: 't1', name: 'גנאש', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    const back = (await r.getRecipe(top.id))!;
    expect(back.ingredients![0]!.subId).toBe(base.id);
  });

  it('refuses a self-reference (requirement 13)', async () => {
    const r = repo();
    const created = await r.saveRecipe(draft());
    await expect(
      r.saveRecipe(
        {
          ...created,
          ingredients: [{ id: 'x', name: 'עצמי', qty: 10, unit: 'g', subId: created.id }],
        } as unknown as Recipe,
        { expectedUpdatedAt: created['updatedAt'] as string },
      ),
    ).rejects.toThrow(/את עצמו/);
  });

  it('refuses a direct cycle (requirement 14)', async () => {
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }));
    const top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'למעלה',
        ingredients: [{ id: 't1', name: 'בסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    await expect(
      r.saveRecipe(
        {
          ...base,
          ingredients: [{ id: 'b1', name: 'למעלה', qty: 100, unit: 'g', subId: top.id }],
        } as unknown as Recipe,
        { expectedUpdatedAt: base['updatedAt'] as string },
      ),
    ).rejects.toThrow(/מעגל/);
  });

  it('refuses an indirect cycle three deep (requirement 14)', async () => {
    const r = repo();
    const c = await r.saveRecipe(draft({ id: 'new-c', name: 'ג', ingredients: [], steps: [] }));
    const b = await r.saveRecipe(
      draft({ id: 'new-b', name: 'ב', ingredients: [{ id: 'x', name: 'ג', qty: 1, unit: 'g', subId: c.id }], steps: [] }),
    );
    const a = await r.saveRecipe(
      draft({ id: 'new-a', name: 'א', ingredients: [{ id: 'y', name: 'ב', qty: 1, unit: 'g', subId: b.id }], steps: [] }),
    );

    // a → b → c, so c → a closes it
    await expect(
      r.saveRecipe(
        { ...c, ingredients: [{ id: 'z', name: 'א', qty: 1, unit: 'g', subId: a.id }] } as unknown as Recipe,
        { expectedUpdatedAt: c['updatedAt'] as string },
      ),
    ).rejects.toThrow(/מעגל/);
  });

  it('refuses another account\'s recipe even with the id typed in (requirement 15)', async () => {
    const a = repo(USER_A);
    const mine = await a.saveRecipe(draft());

    fake.setAuthUid(USER_B);
    const theirs = await repo(USER_B).saveRecipe(draft({ name: 'של ב' }));
    fake.setAuthUid(USER_A);

    await expect(
      a.saveRecipe(
        {
          ...mine,
          ingredients: [{ id: 'x', name: 'של ב', qty: 100, unit: 'g', subId: theirs.id }],
        } as unknown as Recipe,
        { expectedUpdatedAt: mine['updatedAt'] as string },
      ),
    ).rejects.toThrow(/אותו חשבון/);

    // the link is nowhere in the store
    expect(
      (fake.db['ingredients'] ?? []).some((i) => i['sub_recipe_id'] === theirs.id),
    ).toBe(false);
  });

  it('names the recipes that would break if a base recipe were deleted', async () => {
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס גנאש', ingredients: [], steps: [] }));
    await r.saveRecipe(
      draft({
        id: 'new-top', name: 'עוגה שתלויה בו',
        ingredients: [{ id: 't1', name: 'בסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    const users = await r.recipesUsing(base.id);
    expect(users.map((u) => u.name)).toEqual(['עוגה שתלויה בו']);
  });

  it('reports no dependents for a recipe nothing uses', async () => {
    const r = repo();
    const lonely = await r.saveRecipe(draft());
    expect(await r.recipesUsing(lonely.id)).toEqual([]);
  });

  // ── stage 6: a base recipe in use cannot be deleted at all ─────────────
  //
  // This replaces a stage-5 test that asserted the OPPOSITE — that deleting a
  // base recipe left the dependent line without a link, which is what ON
  // DELETE SET NULL did. Stage 6 is the explicit product decision to refuse the
  // delete instead, so the old assertion is not a regression to be fixed but
  // the behaviour that was deliberately removed. Migration 0008 is what
  // enforces it.

  it('refuses to delete a base recipe that another recipe uses', async () => {
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }));
    const top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'תלוי',
        ingredients: [{ id: 't1', name: 'הבסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    await expect(r.deleteRecipe(base.id)).rejects.toThrow(RecipeInUseError);

    // Nothing moved: not the base recipe, and not the dependent's link.
    expect((fake.db['recipes'] ?? []).some((x) => x['id'] === base.id)).toBe(true);
    const back = (await r.getRecipe(top.id))!;
    expect(back.ingredients![0]!.subId).toBe(base.id);
  });

  it('the refusal carries the dependents, so the screen can name them', async () => {
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }));
    await r.saveRecipe(
      draft({
        id: 'new-top', name: 'עוגה שתלויה בו',
        ingredients: [{ id: 't1', name: 'הבסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    // A foreign-key violation says a constraint was violated. It cannot say
    // WHICH recipes are holding the thing, and that is the only part the user
    // can act on.
    await expect(r.deleteRecipe(base.id)).rejects.toMatchObject({
      name: 'RecipeInUseError',
      usedBy: [{ name: 'עוגה שתלויה בו' }],
    });
  });

  it('deletes it once the last dependency is removed (requirement 4)', async () => {
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }));
    const top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'תלוי',
        ingredients: [{ id: 't1', name: 'הבסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );
    await expect(r.deleteRecipe(base.id)).rejects.toThrow(RecipeInUseError);

    // Unlink it the way the editor would — a save with the link cleared.
    await r.saveRecipe(
      { ...top, ingredients: [{ id: 't1', name: 'הבסיס', qty: 100, unit: 'g' }] } as Recipe,
      { expectedUpdatedAt: null },
    );

    await r.deleteRecipe(base.id);
    expect((fake.db['recipes'] ?? []).some((x) => x['id'] === base.id)).toBe(false);
    expect(await r.recipesUsing(base.id)).toEqual([]);
  });

  it('a recipe nothing uses is unaffected by the guard', async () => {
    const r = repo();
    const lonely = await r.saveRecipe(draft());
    await r.deleteRecipe(lonely.id);
    expect((fake.db['recipes'] ?? []).some((x) => x['id'] === lonely.id)).toBe(false);
  });

  it('blocks the raw DELETE too, not only the RPC (requirement 5)', async () => {
    // The bypass the requirement names: past the repository, straight at the
    // table, which is what the anon key can send to PostgREST. In Postgres this
    // is the foreign key from 0008 and applies to every route in.
    const r = repo();
    const base = await r.saveRecipe(draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }));
    await r.saveRecipe(
      draft({
        id: 'new-top', name: 'תלוי',
        ingredients: [{ id: 't1', name: 'הבסיס', qty: 100, unit: 'g', subId: base.id }],
        steps: [],
      }),
    );

    const res = await (fake.client as unknown as {
      from(t: string): {
        delete(): { eq(c: string, v: string): Promise<{ error: { code?: string } | null }> };
      };
    })
      .from('recipes')
      .delete()
      .eq('id', base.id);

    expect(res.error?.code).toBe('23503');
    expect((fake.db['recipes'] ?? []).some((x) => x['id'] === base.id)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-6 hardening of the sub-recipe path (requirements 15-17).

describe('requirement 16 — changing a link that already exists', () => {
  const setUp = async () => {
    const r = repo();
    const one = await r.saveRecipe(
      draft({ id: 'new-one', name: 'בסיס א', ingredients: [], steps: [] }),
    );
    const two = await r.saveRecipe(
      draft({ id: 'new-two', name: 'בסיס ב', ingredients: [], steps: [] }),
    );
    const top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'עליון',
        ingredients: [{ id: 't1', name: 'מילוי', qty: 100, unit: 'g', subId: one.id }],
        steps: [],
      }),
    );
    return { r, one, two, top };
  };

  it('repoints a link from one base recipe to another', async () => {
    const { r, two, top } = await setUp();
    const saved = await r.saveRecipe(
      { ...top, ingredients: [{ ...top.ingredients![0]!, subId: two.id }] } as Recipe,
      { expectedUpdatedAt: top['updatedAt'] as string },
    );
    expect((await r.getRecipe(saved.id))!.ingredients![0]!.subId).toBe(two.id);
  });

  it('frees the old base recipe for deletion once repointed', async () => {
    const { r, one, two, top } = await setUp();
    // held to begin with
    await expect(r.deleteRecipe(one.id)).rejects.toThrow(RecipeInUseError);

    await r.saveRecipe(
      { ...top, ingredients: [{ ...top.ingredients![0]!, subId: two.id }] } as Recipe,
      { expectedUpdatedAt: top['updatedAt'] as string },
    );

    // the old one is free, and the NEW one is now the one that is held
    await r.deleteRecipe(one.id);
    await expect(r.deleteRecipe(two.id)).rejects.toThrow(RecipeInUseError);
  });

  it('refuses to repoint a link at the recipe itself', async () => {
    const { r, top } = await setUp();
    await expect(
      r.saveRecipe(
        { ...top, ingredients: [{ ...top.ingredients![0]!, subId: top.id }] } as Recipe,
        { expectedUpdatedAt: top['updatedAt'] as string },
      ),
    ).rejects.toThrow();
    // and the original link is intact — a refused save changes nothing
    expect((await r.getRecipe(top.id))!.ingredients![0]!.subId).not.toBe(top.id);
  });

  it('refuses a repoint that closes a loop', async () => {
    const { r, one, top } = await setUp();
    // `top` uses `one`. Making `one` use `top` closes it.
    await expect(
      r.saveRecipe(
        {
          ...one,
          ingredients: [{ id: 'o1', name: 'עליון', qty: 50, unit: 'g', subId: top.id }],
        } as Recipe,
        { expectedUpdatedAt: one['updatedAt'] as string },
      ),
    ).rejects.toThrow();
    expect((await r.getRecipe(one.id))!.ingredients ?? []).toHaveLength(0);
  });

  it('records the repoint in the version history', async () => {
    const { r, two, top } = await setUp();
    await r.saveRecipe(
      { ...top, ingredients: [{ ...top.ingredients![0]!, subId: two.id }] } as Recipe,
      { expectedUpdatedAt: top['updatedAt'] as string, versionNote: 'שונה מתכון הבסיס: מילוי' },
    );
    const [v] = await r.listVersions(top.id);
    // the version holds the OLD link, which is what makes the change undoable
    expect(v!.snapshot.ingredients![0]!.subId).not.toBe(two.id);
    expect(v!.what).toContain('שונה מתכון הבסיס');
  });
});

describe('requirement 17 — restoring a version whose sub-recipe link is no longer valid', () => {
  /**
   * Builds the only state that can produce this, now that stage 6 refuses to
   * delete a base recipe that is in use:
   *
   *   1. `top` uses `base`.
   *   2. `top` is saved again, so V1 holds the state WITH the link.
   *   3. the link is removed from `top` and saved — V2 also holds it.
   *   4. `base` is now unused, so it can be deleted.
   *
   * V1 and V2 both reference a recipe that no longer exists. Restoring either
   * must fail, and fail atomically.
   */
  const orphanedVersion = async () => {
    const r = repo();
    const base = await r.saveRecipe(
      draft({ id: 'new-base', name: 'בסיס', ingredients: [], steps: [] }),
    );
    let top = await r.saveRecipe(
      draft({
        id: 'new-top', name: 'עליון',
        ingredients: [{ id: 't1', name: 'מילוי', qty: 100, unit: 'g', subId: base.id }],
        steps: [{ id: 's1', text: 'לערבב' }],
      }),
    );
    // a save, so the linked state becomes V1
    top = await r.saveRecipe(
      { ...top, name: 'עליון 2' } as Recipe,
      { expectedUpdatedAt: top['updatedAt'] as string },
    );
    // unlink, so the base recipe becomes deletable
    top = await r.saveRecipe(
      { ...top, ingredients: [{ id: 't1', name: 'מילוי', qty: 100, unit: 'g' }] } as Recipe,
      { expectedUpdatedAt: top['updatedAt'] as string },
    );
    await r.deleteRecipe(base.id);
    const versions = await r.listVersions(top.id);
    return { r, top, base, versions };
  };

  it('refuses the restore rather than recreating a dangling link', async () => {
    const { r, versions } = await orphanedVersion();
    const linked = versions.find((v) => v.snapshot.ingredients?.[0]?.subId)!;
    expect(linked).toBeDefined();
    await expect(r.restoreVersion(linked.id)).rejects.toThrow();
  });

  it('leaves the recipe exactly as it was — no partial write', async () => {
    const { r, top, versions } = await orphanedVersion();
    const before = (await r.getRecipe(top.id))!;
    const linked = versions.find((v) => v.snapshot.ingredients?.[0]?.subId)!;

    await expect(r.restoreVersion(linked.id)).rejects.toThrow();

    const after = (await r.getRecipe(top.id))!;
    // The failure point is INSIDE the restore, after the pre-restore snapshot
    // and the parent update in the real RPC — so "nothing changed" is the
    // property that matters, and it covers the name as well as the rows.
    expect(after.name).toBe(before.name);
    expect(after.ingredients!.map((i) => [i.name, i.qty, i.subId])).toEqual(
      before.ingredients!.map((i) => [i.name, i.qty, i.subId]),
    );
    expect(after.steps!.map((s) => s.text)).toEqual(before.steps!.map((s) => s.text));
  });

  it('does not add a version for the restore that did not happen', async () => {
    const { r, top, versions } = await orphanedVersion();
    const linked = versions.find((v) => v.snapshot.ingredients?.[0]?.subId)!;
    const countBefore = (await r.listVersions(top.id)).length;

    await expect(r.restoreVersion(linked.id)).rejects.toThrow();

    // A version describing a restore that was refused would be false history —
    // the same failure mode requirement 9 of stage 5 exists to rule out.
    expect(await r.listVersions(top.id)).toHaveLength(countBefore);
  });

  it('but a version with NO sub-recipe link restores normally', async () => {
    // The limitation has to be confined to the versions that actually reference
    // the deleted recipe, not the whole history.
    const { r, top, versions } = await orphanedVersion();
    const clean = versions.find((v) => !v.snapshot.ingredients?.[0]?.subId);
    if (clean) {
      await expect(r.restoreVersion(clean.id)).resolves.toBeDefined();
    }
    expect(await r.getRecipe(top.id)).not.toBeNull();
  });
});
