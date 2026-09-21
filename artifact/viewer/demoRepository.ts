/*
  THE DEMO'S REPOSITORY = THE FIXTURE, PLUS A MEMORY.

  `createViewerRepository` already answers every call the screens make, with
  the five demo recipes and the fixture world around them — but it keeps that
  world in module variables, so a reload starts over. In the audit viewer that
  is correct. In something a person is given to try, losing the recipe they
  just typed is not.

  So this wraps it rather than reimplementing it: reads pass straight through,
  and after every WRITE the demo's own data is read back out of the fixture and
  written to `localStorage` as one snapshot. At boot the snapshot is replayed
  through the same public methods the screens use — no private state is poked,
  and anything the fixture refuses (deleting a base recipe that another recipe
  uses) is refused during the replay exactly as it would be live.

  WHAT IS PERSISTED, AND WHAT IS HONESTLY NOT

  Persisted: recipes, measurement preferences, calibrations, the ingredient
  centre, production plans and private notes.

  Not persisted: photographs added in the demo (they are object URLs for blobs
  that only exist while the tab does), and the group conversation (a simulated
  world with several people in it, which belongs to the session). The demo's
  notice says both.
*/

import type { Recipe } from '@recipe-notebook/engine';
import type { Repository } from '../../apps/web/src/data/repository.js';
import type { CatalogItem } from '../../apps/web/src/features/pricing/catalog.js';
import type { ProductionPlan } from '../../apps/web/src/features/planning/plan.js';
import { createViewerRepository } from './fixtures.js';
import { readSnapshot, writeSnapshot, type DemoSnapshot } from './demoStore.js';

/** The demo's own account name, so nobody's real one travels in the file. */
export const DEMO_DISPLAY_NAME = 'שף לדוגמה';

const idsOf = (list: readonly { id?: string }[]): Set<string> =>
  new Set(list.map((x) => String(x.id ?? '')).filter(Boolean));

export interface DemoRepository {
  readonly repository: Repository;
  /** True once a snapshot has been written in this session. */
  saved(): boolean;
}

export async function createDemoRepository(userId: string): Promise<DemoRepository> {
  const base = createViewerRepository(userId);

  /* The notes the demo knows about: the repository cannot list them, so the
     wrapper keeps the map it has written, seeded from the snapshot. */
  const notes: Record<string, string> = {};
  let everSaved = false;
  /*
    WHOSE NOTEBOOK THIS IS IN THE DEMO.

    The fixture's rosters name the account after the person this project
    belongs to. A file that goes to other people should not: the demo's account
    is "שף לדוגמה" until someone renames it in the settings screen, and that
    rename is then what is restored.
  */
  let displayName = DEMO_DISPLAY_NAME;

  const snapshot = async (): Promise<DemoSnapshot> => {
    const plans: ProductionPlan[] = [];
    for (const summary of await base.listPlans()) {
      const plan = await base.getPlan(summary.id);
      if (plan) plans.push(plan);
    }
    return {
      v: 1,
      savedAt: new Date().toISOString(),
      recipes: await base.listRecipes(),
      prefs: await base.getPrefs(),
      calibrations: await base.listCalibrations(),
      catalog: await base.listCatalog(),
      plans,
      notes: { ...notes },
      displayName,
    };
  };

  /*
    One write per burst. Editing a recipe fires several repository calls in a
    row (the recipe, then the mirror, then the prefs), and snapshotting each of
    them would serialise the whole demo three times for one press.
  */
  let pending: ReturnType<typeof setTimeout> | null = null;
  const remember = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void snapshot().then((next) => {
        if (writeSnapshot(next)) everSaved = true;
      });
    }, 150);
  };

  // ── the replay, before anything is rendered ──────────────────────────────
  const saved = readSnapshot();
  if (saved) {
    for (const recipe of saved.recipes) await base.saveRecipe(recipe as Recipe);
    const keep = idsOf(saved.recipes);
    for (const recipe of await base.listRecipes()) {
      if (keep.has(recipe.id)) continue;
      try {
        await base.deleteRecipe(recipe.id);
      } catch {
        /* the fixture refuses to delete a base recipe another one uses — the
           same refusal the screen shows. It stays, which is the honest result. */
      }
    }
    if (saved.prefs) await base.savePrefs(saved.prefs);
    if (saved.calibrations.length) await base.saveCalibrations(saved.calibrations);
    for (const item of saved.catalog) await base.saveCatalogItem(item as CatalogItem);
    /*
      NO `if (saved.catalog.length)` GUARD — THAT GUARD WAS THE BUG.

      The sweep removes whatever the snapshot does not carry. Skipping it when
      the snapshot is EMPTY meant that deleting every ingredient in the trial
      and reloading brought the seeded fixture catalogue back: the emptied
      list came back as demo data, which is precisely the failure the design
      package asked us to look for. An empty `keptKeys` is a legitimate
      answer — it means everything was deleted — and the loop below already
      handles it correctly. The recipes above never had the guard, which is
      the contrast that showed these two were an oversight.
    */
    const keptKeys = new Set(saved.catalog.map((i) => i.key));
    for (const item of await base.listCatalog()) {
      if (!keptKeys.has(item.key)) await base.deleteCatalogItem(item.key);
    }
    for (const plan of saved.plans) await base.savePlan(plan as ProductionPlan);
    const keptPlans = new Set(saved.plans.map((p) => p.id));
    for (const summary of await base.listPlans()) {
      if (!keptPlans.has(summary.id)) await base.deletePlan(summary.id);
    }
    if (typeof saved.displayName === 'string' && saved.displayName.trim() !== '') {
      displayName = saved.displayName;
    }
    for (const [recipeId, body] of Object.entries(saved.notes ?? {})) {
      notes[recipeId] = body;
      await base.savePrivateNote(recipeId, body);
    }
  }

  await base.saveDisplayName(displayName);

  // ── the wrapper: reads through, writes remembered ────────────────────────
  const repository: Repository = {
    ...base,
    saveRecipe: async (recipe, options) => {
      const out = await base.saveRecipe(recipe, options);
      remember();
      return out;
    },
    deleteRecipe: async (id) => {
      await base.deleteRecipe(id);
      remember();
    },
    restoreVersion: async (versionId) => {
      const out = await base.restoreVersion(versionId);
      remember();
      return out;
    },
    savePrefs: async (prefs) => {
      const out = await base.savePrefs(prefs);
      remember();
      return out;
    },
    saveCalibrations: async (list) => {
      const out = await base.saveCalibrations(list);
      remember();
      return out;
    },
    saveCatalogItem: async (item) => {
      const out = await base.saveCatalogItem(item);
      remember();
      return out;
    },
    deleteCatalogItem: async (key) => {
      await base.deleteCatalogItem(key);
      remember();
    },
    recordPurchase: async (input) => {
      const out = await base.recordPurchase(input);
      remember();
      return out;
    },
    savePlan: async (plan) => {
      const out = await base.savePlan(plan);
      remember();
      return out;
    },
    deletePlan: async (id) => {
      await base.deletePlan(id);
      remember();
    },
    setPlanLocked: async (id, locked, snap) => {
      await base.setPlanLocked(id, locked, snap);
      remember();
    },
    saveDisplayName: async (name) => {
      const out = await base.saveDisplayName(name);
      displayName = name.trim();
      remember();
      return out;
    },
    savePrivateNote: async (recipeId, body) => {
      await base.savePrivateNote(recipeId, body);
      notes[recipeId] = body;
      remember();
    },
  };

  return { repository, saved: () => everSaved };
}
