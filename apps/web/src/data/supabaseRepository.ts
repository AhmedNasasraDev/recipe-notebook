// The Supabase implementation of the Repository interface.
//
// Sits behind the seam defined in repository.ts, so no screen changed to
// accommodate it. Every mapping between the normalised schema and the engine's
// recipe shape happens in mappers.ts.
//
// Security posture (HANDOFF §3, §6):
//   • Every statement here runs as the signed-in user through the anon key, so
//     RLS is the enforcement, not these queries. The `owner_id = auth.uid()`
//     filters below are belt-and-braces and a query-planner hint — never the
//     security boundary.
//   • A write that RLS refuses surfaces as an error. It is never swallowed.
//
// Recipes are stored across six tables, so a save has to write a parent row,
// replace three sets of child rows, and — since stage 5 — snapshot the previous
// state into recipe_versions first. PostgREST has no multi-statement
// transaction, so as separate client calls that is five ways to end up with a
// half-written recipe or a version describing a change that never landed.
//
// So a save is ONE call to the `save_recipe` RPC (migration 0007), which does
// all of it in a single transaction. Reads stay as ordinary selects.

import { describeCause } from '../lib/errorText.js';
import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import type { CatalogItem } from '../features/pricing/catalog.js';
import type {
  PurchaseInput,
  PurchaseRecord,
} from '../features/pricing/purchases.js';
import type { ProductionPlan } from '../features/planning/plan.js';
import { normalizeCalibrations } from '@recipe-notebook/engine';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import type {
  Json,
  ProductionPlanItemRow,
  ProductionPlanRow,
  ProductionPlanStockRow,
  RecipeImageRow,
  RecipeVersionRow,
} from '../lib/database.types.js';
import {
  RecipeInUseError,
  SavedButNotReloadedError,
  WriteNotAllowedError,
  type PlanSummary,
  type RecipeImage,
  type Repository,
  type RepositoryCapabilities,
  type SaveOptions,
  type StoredVersion,
} from './repository.js';
import {
  convertErrorText,
  convertToWebp,
  imagePath,
} from '../features/images/convert.js';

/** The private bucket from migration 0029. */
const RECIPE_IMAGE_BUCKET = 'recipe-images';

function imageFromRow(row: RecipeImageRow): RecipeImage {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    storagePath: row.storage_path,
    ord: row.ord,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    caption: row.caption,
    createdAt: row.created_at,
    /*
      A database that predates migration 0038 has no columns here, and a
      picture with no stored focal point is a picture nobody has adjusted —
      which is the centre, which is what `cover` does anyway. So the default
      is applied in the mapper rather than the screen: one place, and every
      reader gets a number instead of an undefined.
    */
    focalX: row.focal_x ?? 50,
    focalY: row.focal_y ?? 50,
  };
}
import {
  bundleToRecipe,
  calibrationRowToDomain,
  calibrationToInsert,
  catalogItemToRow,
  catalogRowToItem,
  ingredientsToRows,
  issuesToRows,
  planRowToDomain,
  planToPayload,
  prefsToProfileUpdate,
  profileRowToPrefs,
  recipeToRow,
  snapshotToRecipe,
  stepsToRows,
  type RecipeBundle,
} from './mappers.js';
import { createSupabaseGroups } from './supabaseGroups.js';
import * as mirror from './offlineMirror.js';
import { DEMO_CATEGORIES } from './demoRecipes.js';

/**
 * The column list used to pull a whole recipe in one round trip.
 *
 * `ingredients` names its foreign key. The table has TWO keys to `recipes` —
 * `recipe_id` (the recipe the line belongs to) and `sub_recipe_id` (a line
 * that is itself a recipe, migration 0002) — and PostgREST refuses to guess
 * between them: without the hint every read of a recipe answered HTTP 300
 * "more than one relationship was found" (PGRST201), so the notebook never
 * loaded against the real project. The lines of a recipe are the ones whose
 * `recipe_id` is this recipe, which is what the hint says.
 */
const RECIPE_SELECT = `
  *,
  ingredients!ingredients_recipe_id_fkey (*),
  steps (*),
  issues (*),
  trials (*),
  batches (*),
  recipe_versions (*)
`;

export class SupabaseRepositoryError extends Error {
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    // The cause is translated (lib/errorText.ts) so the screen prints Hebrew,
    // and a cause with nothing to add leaves the operation alone.
    const detail = describeCause(cause);
    super(detail ? `${operation}: ${detail}` : operation);
    this.name = 'SupabaseRepositoryError';
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/**
 * Is this the refusal from migration 0008's guard?
 *
 * The code is checked, not the message. `delete_recipe` raises with
 * `errcode = 'foreign_key_violation'` and its own Hebrew text, while the bare
 * constraint raises Postgres's own English text — and the message is the part
 * that changes with a Postgres version or a locale. The code is the contract.
 *
 * PostgREST puts the SQLSTATE in `code`, and a `PostgrestError` is a plain
 * object rather than an Error subclass, so this reads defensively: a shape that
 * is not what we expect must fall through to the generic failure rather than be
 * mistaken for "in use".
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === '23503'
  );
}

export interface SupabaseRepositoryDeps {
  client: TypedSupabaseClient;
  /** the signed-in user's id; the repository refuses to work without one */
  userId: string;
}

export function createSupabaseRepository({
  client,
  userId,
}: SupabaseRepositoryDeps): Repository {
  let servingFromCache = false;

  const capabilities = (): RepositoryCapabilities => ({
    source: 'supabase',
    online: isOnline(),
    canWrite: isOnline(),
    servingFromCache,
  });

  /** Writes are refused offline rather than queued — no sync engine in this stage. */
  const requireOnline = (what: string): void => {
    if (!isOnline()) {
      throw new WriteNotAllowedError(
        `אין חיבור לאינטרנט, ולכן ${what} לא נשמר. הנתונים שמוצגים נשמרו על המכשיר לקריאה בלבד.`,
      );
    }
  };

  return {
    /*
      §10 — the whole group surface, from data/supabaseGroups.ts. Spread rather
      than implemented here because it is a large, self-contained set of
      methods; nothing above the seam knows there are two files. It is given
      `requireOnline` so a group write is refused offline for the same reason
      and in the same words as every other write.
    */
    ...createSupabaseGroups({ client, userId, requireOnline }),

    capabilities,

    async listCategories() {
      // §1.1: category comes from a closed list. It is UI copy, not user data,
      // so it stays in the client rather than becoming a table.
      return DEMO_CATEGORIES;
    },

    // ── recipes ────────────────────────────────────────────────────────────

    async listRecipes(): Promise<Recipe[]> {
      const { data, error } = await client
        .from('recipes')
        .select(RECIPE_SELECT)
        .eq('owner_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        // Fall back to the offline mirror rather than showing an empty notebook
        const cachedIndex = await mirror.readRecipeIndex();
        if (cachedIndex.length > 0) {
          const cached = await Promise.all(
            cachedIndex.map((row) => mirror.readRecipe(row.id)),
          );
          const usable = cached.filter((r): r is Recipe => r !== null);
          if (usable.length > 0) {
            servingFromCache = true;
            return usable;
          }
        }
        throw new SupabaseRepositoryError('טעינת המחברת נכשלה', error);
      }

      servingFromCache = false;
      const recipes = (data ?? []).map((row) => {
        const r = row as unknown as Record<string, unknown>;
        return bundleToRecipe({
          recipe: r as never,
          ingredients: (r['ingredients'] ?? []) as never,
          steps: (r['steps'] ?? []) as never,
          issues: (r['issues'] ?? []) as never,
          trials: (r['trials'] ?? []) as never,
          batches: (r['batches'] ?? []) as never,
          versions: (r['recipe_versions'] ?? []) as never,
        } as RecipeBundle);
      });

      void mirror.writeRecipeIndex(
        recipes.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          category: r.category ?? 'אחר',
          isSub: r.isSub === true,
          locked: r.locked === true,
          tags: [...(r.tags ?? [])],
        })),
      );
      return recipes;
    },

    async getRecipe(id: string): Promise<Recipe | null> {
      const { data, error } = await client
        .from('recipes')
        .select(RECIPE_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        const cached = await mirror.readRecipe(id);
        servingFromCache = cached !== null;
        if (cached) return cached;
        throw new SupabaseRepositoryError('טעינת המתכון נכשלה', error);
      }
      if (!data) return null;

      servingFromCache = false;
      const r = data as unknown as Record<string, unknown>;
      const recipe = bundleToRecipe({
        recipe: r as never,
        ingredients: (r['ingredients'] ?? []) as never,
        steps: (r['steps'] ?? []) as never,
        issues: (r['issues'] ?? []) as never,
        trials: (r['trials'] ?? []) as never,
        batches: (r['batches'] ?? []) as never,
        versions: (r['recipe_versions'] ?? []) as never,
      } as RecipeBundle);

      // This is now the active recipe — mirror it so the page and Cook Mode
      // keep working if the network drops a minute from now.
      void mirror.writeRecipe(recipe);
      return recipe;
    },

    async saveRecipe(recipe: Recipe, options: SaveOptions = {}): Promise<Recipe> {
      requireOnline('המתכון');
      if (!recipe.name || !String(recipe.name).trim()) {
        throw new WriteNotAllowedError('למתכון חייב להיות שם.');
      }

      const isNew = !recipe.id || recipe.id.startsWith('new-');
      const parent = recipeToRow(recipe, userId);

      const { data, error } = await client.rpc('save_recipe', {
        p_recipe: parent as unknown as Json,
        p_ingredients: ingredientsToRows(recipe, '') as unknown as Json,
        p_steps: stepsToRows(recipe, '') as unknown as Json,
        p_issues: issuesToRows(recipe, '') as unknown as Json,
        p_recipe_id: isNew ? null : recipe.id,
        // Optimistic concurrency: the value this client loaded. The RPC refuses
        // the save if the row has moved on, rather than overwriting whatever
        // somebody else just wrote.
        p_expected_updated_at: isNew ? null : (options.expectedUpdatedAt ?? null),
        p_version_note: options.versionNote ?? '',
      });

      if (error) {
        throw new SupabaseRepositoryError(
          isNew ? 'יצירת המתכון נכשלה' : 'עדכון המתכון נכשל',
          error,
        );
      }

      const recipeId = data as unknown as string;
      let saved: Recipe | null;
      try {
        saved = await this.getRecipe(recipeId);
      } catch (e) {
        throw new SavedButNotReloadedError('המתכון', recipeId, e);
      }
      if (!saved) {
        throw new SavedButNotReloadedError('המתכון', recipeId, 'המתכון לא נמצא אחרי השמירה');
      }
      return saved;
    },

    // ── versions (§9) ──────────────────────────────────────────────────────

    async listVersions(recipeId: string): Promise<StoredVersion[]> {
      const { data, error } = await client
        .from('recipe_versions')
        .select('id, recipe_id, tag, what, snapshot, created_at, created_by')
        .eq('recipe_id', recipeId)
        .order('created_at', { ascending: false });

      if (error) throw new SupabaseRepositoryError('טעינת היסטוריית הגרסאות נכשלה', error);

      return (data ?? []).map((row) => {
        const r = row as unknown as RecipeVersionRow;
        return {
          id: r.id,
          recipeId: r.recipe_id,
          tag: r.tag,
          what: r.what,
          createdAt: r.created_at,
          // ONE mapper reads both a live row set and a stored snapshot, because
          // the RPC writes the snapshot in exactly the RecipeBundle shape. A
          // restored version therefore cannot be interpreted differently from
          // a live one.
          snapshot: snapshotToRecipe(r.snapshot, r.recipe_id),
        };
      });
    },

    async restoreVersion(versionId: string): Promise<Recipe> {
      requireOnline('השחזור');

      const { data, error } = await client.rpc('restore_recipe_version', {
        p_version_id: versionId,
      });
      if (error) throw new SupabaseRepositoryError('השחזור נכשל', error);

      const recipeId = data as unknown as string;
      const restored = await this.getRecipe(recipeId);
      if (!restored) {
        throw new SupabaseRepositoryError('שחזור', 'המתכון לא נמצא אחרי השחזור');
      }
      return restored;
    },

    async recipesUsing(recipeId: string): Promise<Array<{ id: string; name: string }>> {
      const { data, error } = await client.rpc('recipes_using', {
        p_recipe_id: recipeId,
      });
      // A failure here must not decide anything. Since stage 6 the DELETE is
      // refused by the database whatever this returns; this only supplies the
      // names for the message.
      if (error) return [];
      return (data ?? []) as Array<{ id: string; name: string }>;
    },

    async deleteRecipe(id: string): Promise<void> {
      requireOnline('המתכון');

      /*
        THE ROW FIRST, THE PHOTOGRAPHS AFTER — and the paths are read before
        either, because the rows that hold them cascade away with the recipe.

        It was the other way round: files first, then the row, because the
        storage policy from 0029 recognised the owner through the recipe and
        could not delete a file once the recipe was gone. QA 22.09.2026
        (acceptance, finding 2) showed what that order costs: the network
        dropped between the two steps, the delete was refused, the recipe
        stayed — and its photographs were already gone for good. A refused
        delete must leave the recipe exactly as it was, pictures included.

        Migration 0039 lets the account that UPLOADED a file delete it whether
        or not the recipe still exists, so the file can go after the row.
        Removing it is still best effort: the recipe is deleted either way,
        and a file nothing points at is a leak, not a loss.
      */
      let paths: string[] = [];
      try {
        const { data: rows } = await client
          .from('recipe_images')
          .select('storage_path')
          .eq('recipe_id', id);
        paths = (rows ?? [])
          .map((r) => (r as { storage_path?: string }).storage_path)
          .filter((p): p is string => typeof p === 'string' && p !== '');
      } catch {
        /* no list, nothing to remove afterwards */
      }

      // `delete_recipe` rather than a plain DELETE. The guarantee is the
      // foreign key from migration 0008, which no client can get around — but
      // that constraint is DEFERRED (so that deleting an account still
      // cascades), which means a raw DELETE is refused at COMMIT rather than at
      // the statement. The function runs the check inside the call, so the
      // refusal arrives as an ordinary error with a code to branch on.
      //
      // RLS still applies inside it: another account's id matches no row and
      // the call is a silent no-op, which is the right shape for a delete and
      // also refuses to confirm that the id exists.
      const { error } = await client.rpc('delete_recipe', { p_recipe_id: id });

      if (error) {
        // 23503 is the one refusal that has a meaning worth translating: the
        // recipe is in use as somebody's base. Anything else is a real failure.
        if (isForeignKeyViolation(error)) {
          // Asked only now, and only to name them. An empty list is possible
          // (a dependency added between the two calls) and `RecipeInUseError`
          // handles that rather than pretending the delete succeeded.
          throw new RecipeInUseError(await this.recipesUsing(id));
        }
        throw new SupabaseRepositoryError('מחיקת המתכון נכשלה', error);
      }

      if (paths.length > 0) {
        try {
          await client.storage.from(RECIPE_IMAGE_BUCKET).remove(paths);
        } catch {
          /* the recipe is gone; a leftover file is invisible to everyone */
        }
      }

      // Drop the local copy too. Leaving it would make a deleted recipe
      // reappear the next time the network drops and the mirror answers.
      await mirror.forgetRecipe(id);
      const index = await mirror.readRecipeIndex();
      void mirror.writeRecipeIndex(index.filter((r) => r.id !== id));
    },

    // ── the ingredient centre (stage 7) ────────────────────────────────────

    async listCatalog(): Promise<CatalogItem[]> {
      const { data, error } = await client
        .from('ingredient_catalog')
        .select('*')
        .eq('owner_id', userId)
        .order('name');
      if (error) throw new SupabaseRepositoryError('טעינת חומרי הגלם נכשלה', error);
      return (data ?? []).map(catalogRowToItem);
    },

    async saveCatalogItem(item: CatalogItem): Promise<CatalogItem> {
      requireOnline('חומר הגלם');
      if (!item.key.trim()) {
        throw new WriteNotAllowedError('לחומר גלם חייב להיות שם.');
      }

      // `price` and `price_unit` are generated columns, so the row that goes
      // up deliberately does not contain them — see `catalogItemToRow`. What
      // comes BACK does, computed by the database, which is why this reads the
      // saved row rather than echoing the input.
      const { data, error } = await client
        .from('ingredient_catalog')
        .upsert(catalogItemToRow(item, userId) as never, { onConflict: 'owner_id,key' })
        .select('*')
        .single();
      if (error) throw new SupabaseRepositoryError('שמירת חומר הגלם נכשלה', error);
      return catalogRowToItem(data as never);
    },

    async deleteCatalogItem(key: string): Promise<void> {
      requireOnline('חומר הגלם');
      const { error } = await client
        .from('ingredient_catalog')
        .delete()
        .eq('owner_id', userId)
        .eq('key', key);
      if (error) throw new SupabaseRepositoryError('מחיקת חומר הגלם נכשלה', error);
    },

    async recordPurchase(input: PurchaseInput): Promise<CatalogItem> {
      requireOnline('הרכישה');
      if (!input.key.trim()) {
        throw new WriteNotAllowedError('לחומר גלם חייב להיות שם.');
      }

      // One RPC, one transaction: the history row and the active price. The
      // client cannot get between them and leave a price with no purchase
      // behind it, or a purchase that never became the price.
      const { error } = await client.rpc('record_purchase', {
        p_key: input.key.trim(),
        p_name: input.name,
        p_purchase_unit: input.purchaseUnit,
        p_package_count: input.packageCount,
        p_package_qty: input.packageQty,
        p_purchase_total: input.purchaseTotal,
        p_usable_pct: input.usablePct,
        p_supplier: input.supplier,
        p_purchased_at: input.purchasedAt,
        p_note: input.note,
      });
      if (error) throw new SupabaseRepositoryError('רישום הרכישה נכשל', error);

      // Read the row back rather than echo the input: the prices are generated
      // columns, so only the database knows them.
      const { data, error: readError } = await client
        .from('ingredient_catalog')
        .select('*')
        .eq('owner_id', userId)
        .eq('key', input.key.trim())
        .single();
      if (readError) {
        throw new SupabaseRepositoryError('טעינת חומר הגלם אחרי הרכישה נכשלה', readError);
      }
      return catalogRowToItem(data as never);
    },

    async purchaseHistory(key: string): Promise<PurchaseRecord[]> {
      const { data, error } = await client.rpc('purchase_history', { p_key: key });
      // Informative only. A history that fails to load must not stop the user
      // recording a new purchase.
      if (error) return [];
      return (data ?? []).map((r) => ({
        id: r.id,
        purchasedAt: r.purchased_at,
        supplier: r.supplier,
        purchaseUnit: r.purchase_unit,
        packageCount: Number(r.package_count),
        packageQty: r.package_qty === null ? null : Number(r.package_qty),
        purchaseTotal: r.purchase_total === null ? null : Number(r.purchase_total),
        usablePct: r.usable_pct === null ? null : Number(r.usable_pct),
        purchasePrice: r.purchase_price === null ? null : Number(r.purchase_price),
        price: r.price === null ? null : Number(r.price),
        prevPrice: r.prev_price === null ? null : Number(r.prev_price),
        pctChange: r.pct_change === null ? null : Number(r.pct_change),
      }));
    },

    // ── production plans (stage 9) ─────────────────────────────────────────

    async listPlans(): Promise<PlanSummary[]> {
      const { data, error } = await client
        .from('production_plans')
        .select('*, production_plan_items (id)')
        .eq('owner_id', userId)
        .order('plan_date', { ascending: false });
      if (error) throw new SupabaseRepositoryError('טעינת תוכניות הייצור נכשלה', error);
      return (data ?? []).map((row) => {
        const r = row as unknown as ProductionPlanRow & {
          production_plan_items?: unknown[];
        };
        return {
          id: r.id,
          name: r.name,
          planDate: r.plan_date,
          locked: r.locked,
          items: r.production_plan_items?.length ?? 0,
        };
      });
    },

    async getPlan(id: string): Promise<ProductionPlan | null> {
      const { data, error } = await client
        .from('production_plans')
        .select('*, production_plan_items (*), production_plan_stock (*)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new SupabaseRepositoryError('טעינת תוכנית הייצור נכשלה', error);
      if (!data) return null;
      const row = data as unknown as ProductionPlanRow & {
        production_plan_items?: ProductionPlanItemRow[];
        production_plan_stock?: ProductionPlanStockRow[];
      };
      return planRowToDomain(
        row,
        row.production_plan_items ?? [],
        row.production_plan_stock ?? [],
      );
    },

    async savePlan(plan: ProductionPlan): Promise<ProductionPlan> {
      requireOnline('תוכנית הייצור');
      const payload = planToPayload(plan);
      // ONE call: the plan row, its lines and its on-hand figures are replaced
      // together, so a half-saved plan cannot exist.
      const { data, error } = await client.rpc('save_production_plan', {
        p_plan: payload.p_plan,
        p_items: payload.p_items,
        p_stock: payload.p_stock,
        p_plan_id: plan.id || null,
        p_expected_updated_at: plan.id ? plan.updatedAt : null,
      });
      if (error) throw new SupabaseRepositoryError('שמירת תוכנית הייצור נכשלה', error);

      const saved = await this.getPlan(String(data));
      if (!saved) {
        throw new SupabaseRepositoryError('התוכנית נשמרה אבל לא נמצאה בקריאה חזרה', {
          message: 'not found after save',
        });
      }
      return saved;
    },

    async deletePlan(id: string): Promise<void> {
      requireOnline('תוכנית הייצור');
      const { error } = await client.rpc('delete_production_plan', { p_plan_id: id });
      if (error) throw new SupabaseRepositoryError('מחיקת תוכנית הייצור נכשלה', error);
    },

    async setPlanLocked(id: string, locked: boolean, snapshot: unknown): Promise<void> {
      requireOnline('תוכנית הייצור');
      const { error } = await client.rpc('set_plan_locked', {
        p_plan_id: id,
        p_locked: locked,
        p_snapshot: locked ? (snapshot as never) : null,
      });
      if (error) throw new SupabaseRepositoryError('שינוי מצב התוכנית נכשל', error);
    },

    async recipesPricingOn(key: string) {
      const { data, error } = await client.rpc('recipes_pricing_on', { p_key: key });
      // Informative only — it tells the user what a price change will move. A
      // failure must not stop them changing a price.
      if (error) return [];
      return (data ?? []) as Array<{
        id: string;
        name: string;
        rows: number;
        overridden: number;
      }>;
    },

    // ── preferences (§1.2) ─────────────────────────────────────────────────

    async getPrefs(): Promise<MeasurementPrefs | null> {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // Preferences drive every conversion, so a stale local copy beats none
        const cached = await mirror.readPrefs();
        if (cached) {
          servingFromCache = true;
          return cached;
        }
        throw new SupabaseRepositoryError('טעינת ההעדפות נכשלה', error);
      }
      if (!data) return null;

      const calibrations = await this.listCalibrations();
      const prefs = profileRowToPrefs(data, calibrations);
      void mirror.writePrefs(prefs);
      return prefs;
    },

    async savePrefs(prefs: MeasurementPrefs): Promise<MeasurementPrefs> {
      // Mirror first: the preferences are the one thing that must survive a
      // dropped connection, because without them nothing converts.
      void mirror.writePrefs(prefs);
      requireOnline('ההעדפות');

      const { error } = await client
        .from('profiles')
        .update(prefsToProfileUpdate(prefs))
        .eq('user_id', userId);
      if (error) throw new SupabaseRepositoryError('שמירת ההעדפות נכשלה', error);
      return prefs;
    },

    // ── calibrations (§1.2, engine B4/B5) ──────────────────────────────────

    // ── §8 personal notes ──────────────────────────────────────────────────

    async getPrivateNote(recipeId: string): Promise<string | null> {
      const { data, error } = await client
        .from('private_notes')
        .select('body')
        .eq('user_id', userId)
        .eq('recipe_id', recipeId)
        .maybeSingle();

      if (error) throw new SupabaseRepositoryError('טעינת ההערה האישית נכשלה', error);
      // No row is not an error, and it is not an empty note either — it is the
      // absence of one, which the caller distinguishes.
      const body = (data as { body?: string } | null)?.body;
      return body === undefined || body === '' ? null : body;
    },

    async savePrivateNote(recipeId: string, body: string): Promise<void> {
      requireOnline('ההערה האישית');
      // One RPC rather than an upsert from here: the uniqueness of one note per
      // recipe is a PARTIAL index, and PostgREST cannot name an index predicate
      // in an upsert. Migration 0022 has the whole reason.
      const { error } = await client.rpc('save_private_note', {
        p_recipe_id: recipeId,
        p_body: body,
      });
      if (error) throw new SupabaseRepositoryError('שמירת ההערה האישית נכשלה', error);
    },

    // ── §5 recipe photographs (migration 0029) ─────────────────────────────

    async listRecipeImages(recipeId: string): Promise<RecipeImage[]> {
      const { data, error } = await client
        .from('recipe_images')
        .select('*')
        .eq('recipe_id', recipeId)
        .order('ord', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw new SupabaseRepositoryError('טעינת התמונות נכשלה', error);
      return (data ?? []).map(imageFromRow);
    },

    async addRecipeImage(recipeId: string, file: File | Blob): Promise<RecipeImage> {
      requireOnline('העלאת תמונה');

      /*
        Convert FIRST. The bucket accepts only image/webp under 2 MB, so a
        failure here is a failure the user can act on — and reporting it before
        any network call is the difference between "the photo is too big, crop
        it" and a 400 from storage with no explanation.
      */
      const converted = await convertToWebp(file);
      if (!converted.ok) {
        throw new SupabaseRepositoryError(convertErrorText(converted), null);
      }

      const path = imagePath(recipeId);
      const upload = await client.storage
        .from(RECIPE_IMAGE_BUCKET)
        .upload(path, converted.blob, {
          contentType: 'image/webp',
          // No overwrite: the path carries a fresh uuid, so a collision would
          // mean something is wrong rather than something to paper over.
          upsert: false,
        });
      if (upload.error) {
        throw new SupabaseRepositoryError('העלאת התמונה נכשלה', upload.error);
      }

      const { data, error } = await client
        .from('recipe_images')
        .insert({
          recipe_id: recipeId,
          storage_path: path,
          width: converted.width,
          height: converted.height,
          bytes: converted.bytes,
          created_by: userId,
        })
        .select('*')
        .single();

      if (error) {
        /*
          The object is up and the row failed. Remove the object rather than
          leave a file nothing points at — this is the only place the two can
          get out of step, and it is worth the extra call.
        */
        await client.storage.from(RECIPE_IMAGE_BUCKET).remove([path]);
        throw new SupabaseRepositoryError('שמירת התמונה נכשלה', error);
      }
      return imageFromRow(data);
    },

    async removeRecipeImage(image: RecipeImage): Promise<void> {
      requireOnline('מחיקת תמונה');
      /*
        The ROW first, then the object. Postgres cannot reach into storage, so
        nothing deletes the file for us (0029 says why there is no trigger).

        It was object-first, on the argument that a row pointing at a missing
        file is survivable and a file nothing points at is not. QA 22.09.2026
        (acceptance, finding 2) showed the survivable case from the user's
        side: a photograph that is gone from the server but still listed on the
        recipe, with a message that blamed the account. Row first means a
        failure leaves the picture whole and visible; a file left behind after
        the row is gone is a leak nobody sees (0039 lets the uploader remove
        it, so the next delete of the same recipe sweeps it too).
      */
      const { error } = await client.from('recipe_images').delete().eq('id', image.id);
      if (error) throw new SupabaseRepositoryError('מחיקת התמונה נכשלה', error);
      try {
        await client.storage.from(RECIPE_IMAGE_BUCKET).remove([image.storagePath]);
      } catch {
        /* the picture is off the recipe; the file is invisible without its row */
      }
    },

    async setRecipeImageFocus(
      image: RecipeImage,
      focal: { x: number; y: number },
    ): Promise<RecipeImage> {
      requireOnline('מיקום התמונה');
      /*
        Clamped here as well as in the CHECK constraint, and that is not
        belt-and-braces for its own sake: the numbers come from a drag
        gesture, and a gesture that ends a few pixels outside the box produces
        101. Rejecting that with a 400 would be correct and useless — the
        person did nothing wrong. Rounded to one decimal because a focal point
        is not a measurement and 37.4% is already finer than an eye can place.
      */
      const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
      const { data, error } = await client
        .from('recipe_images')
        .update({ focal_x: clamp(focal.x), focal_y: clamp(focal.y) })
        .eq('id', image.id)
        .select('*')
        .single();
      /*
        42703 is "column does not exist": migration 0038 has not been applied
        to this database. Said plainly, because the alternative is a save that
        looks like it worked and a position that is back in the middle after a
        reload.
      */
      if (error) {
        /*
          Two spellings of the same fact. Postgres says 42703 when a column
          is named in SQL; PostgREST says PGRST204 when the column is named in
          the request body and is not in its schema cache — which is what an
          UPDATE from supabase-js produces. QA on the real project (22.09.2026)
          got PGRST204 and the generic sentence, because only 42703 was
          checked; the person then had no way to know the fix was a migration.
        */
        const code = (error as { code?: string }).code;
        const missing = code === '42703' || code === 'PGRST204';
        throw new SupabaseRepositoryError(
          missing
            ? 'שמירת מיקום התמונה דורשת עדכון של מסד הנתונים (מיגרציה 0038) שעדיין לא הוחל.'
            : 'שמירת מיקום התמונה נכשלה',
          missing ? null : error,
        );
      }
      return imageFromRow(data);
    },

    async replaceRecipeImage(image: RecipeImage, file: File | Blob): Promise<RecipeImage> {
      requireOnline('החלפת תמונה');
      /*
        Upload the new picture first, under a fresh path, and only then take
        the old one down: a failure at any point before the last step leaves
        the recipe with the picture it had. The new row inherits the place,
        the caption and the focal point, so the hero does not jump.
      */
      const converted = await convertToWebp(file);
      if (!converted.ok) {
        throw new SupabaseRepositoryError(convertErrorText(converted), null);
      }
      const path = imagePath(image.recipeId);
      const upload = await client.storage
        .from(RECIPE_IMAGE_BUCKET)
        .upload(path, converted.blob, { contentType: 'image/webp', upsert: false });
      if (upload.error) {
        throw new SupabaseRepositoryError('העלאת התמונה נכשלה', upload.error);
      }
      const { data, error } = await client
        .from('recipe_images')
        .insert({
          recipe_id: image.recipeId,
          storage_path: path,
          width: converted.width,
          height: converted.height,
          bytes: converted.bytes,
          caption: image.caption,
          ord: image.ord,
          focal_x: image.focalX,
          focal_y: image.focalY,
          created_by: userId,
        })
        .select('*')
        .single();
      if (error) {
        await client.storage.from(RECIPE_IMAGE_BUCKET).remove([path]);
        throw new SupabaseRepositoryError('שמירת התמונה נכשלה', error);
      }
      // The old picture: row, then object (see removeRecipeImage for the
      // order). A failed row delete is reported, because the recipe would then
      // list two pictures; a leftover file is not, because nobody can see it.
      const gone = await client.from('recipe_images').delete().eq('id', image.id);
      if (gone.error) {
        throw new SupabaseRepositoryError(
          'התמונה החדשה נשמרה, אבל מחיקת הישנה נכשלה',
          gone.error,
        );
      }
      try {
        await client.storage.from(RECIPE_IMAGE_BUCKET).remove([image.storagePath]);
      } catch {
        /* the new picture is in place and is what the recipe shows */
      }
      return imageFromRow(data);
    },

    async copyRecipeImages(
      fromRecipeId: string,
      toRecipeId: string,
    ): Promise<{ copied: number; failed: number }> {
      requireOnline('העתקת תמונות');
      const { data, error } = await client
        .from('recipe_images')
        .select('*')
        .eq('recipe_id', fromRecipeId)
        .order('ord', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw new SupabaseRepositoryError('טעינת התמונות נכשלה', error);
      let copied = 0;
      let failed = 0;
      for (const row of (data ?? []) as RecipeImageRow[]) {
        /*
          A server-side copy: the bytes never come down to the phone. The
          storage policies decide it — reading the source needs the original
          to be ours, writing the target needs the copy to be ours — which is
          exactly the ownership "שכפול" has by construction.
        */
        const path = imagePath(toRecipeId);
        const copy = await client.storage.from(RECIPE_IMAGE_BUCKET).copy(row.storage_path, path);
        if (copy.error) {
          failed += 1;
          continue;
        }
        const inserted = await client.from('recipe_images').insert({
          recipe_id: toRecipeId,
          storage_path: path,
          width: row.width,
          height: row.height,
          bytes: row.bytes,
          caption: row.caption,
          ord: row.ord,
          focal_x: row.focal_x ?? 50,
          focal_y: row.focal_y ?? 50,
          created_by: userId,
        });
        if (inserted.error) {
          await client.storage.from(RECIPE_IMAGE_BUCKET).remove([path]);
          failed += 1;
          continue;
        }
        copied += 1;
      }
      return { copied, failed };
    },

    /*
      One select and one batch of signatures — see the interface for why this
      exists beside `listRecipeImages`. `ord` then `created_at` is the same
      order the gallery uses, so the card's picture is the one the recipe page
      opens with.
    */
    async recipeThumbs(recipeIds: readonly string[]): Promise<Record<string, string>> {
      const ids = [...new Set(recipeIds)].filter((id) => id !== '');
      if (ids.length === 0) return {};

      const { data, error } = await client
        .from('recipe_images')
        .select('recipe_id, storage_path, ord, created_at')
        .in('recipe_id', ids)
        .order('ord', { ascending: true })
        .order('created_at', { ascending: true });

      // A thumbnail is decoration on a list that has to render anyway: a
      // failure here leaves the cards with their category picture, and does
      // not take the notebook down.
      if (error || !data) return {};

      const first = new Map<string, string>();
      for (const row of data) {
        const id = String(row.recipe_id);
        const path = String(row.storage_path);
        if (!first.has(id)) first.set(id, path);
      }
      if (first.size === 0) return {};

      const paths = [...first.values()];
      const { data: signed, error: signError } = await client.storage
        .from(RECIPE_IMAGE_BUCKET)
        .createSignedUrls(paths, 600);
      if (signError || !signed) return {};

      const urlByPath = new Map<string, string>();
      for (const item of signed) {
        // `path` comes back as given; an item can carry an error instead of a
        // URL, which is the "this account may not see it" case.
        if (item.signedUrl && item.path) urlByPath.set(item.path, item.signedUrl);
      }

      const out: Record<string, string> = {};
      for (const [id, path] of first) {
        const url = urlByPath.get(path);
        if (url !== undefined) out[id] = url;
      }
      return out;
    },

    async signedImageUrl(storagePath: string): Promise<string | null> {
      /*
        Ten minutes. Long enough for a recipe page to stay usable while someone
        bakes from it, short enough that a URL pasted into a chat stops working
        — which matters, because the signed URL bypasses RLS for whoever holds
        it. Not throwing: a photo this account may not see is a legitimate
        answer, and it should render as a missing photo rather than take the
        page down.
      */
      const { data, error } = await client.storage
        .from(RECIPE_IMAGE_BUCKET)
        .createSignedUrl(storagePath, 600);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },

    async listCalibrations(): Promise<Calibration[]> {
      const { data, error } = await client
        .from('calibrations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        const cached = await mirror.readCalibrations();
        if (cached.length) {
          servingFromCache = true;
          return normalizeCalibrations(cached);
        }
        throw new SupabaseRepositoryError('טעינת הכיולים נכשלה', error);
      }
      const list = (data ?? []).map(calibrationRowToDomain);
      void mirror.writeCalibrations(list);
      return list;
    },

    async saveCalibrations(list: readonly Calibration[]): Promise<Calibration[]> {
      const normalized = normalizeCalibrations(list);
      void mirror.writeCalibrations(normalized);
      requireOnline('הכיול');

      // Replace the set. One calibration per (ingredient, tool) is the rule the
      // unique index enforces anyway.
      const { error: delError } = await client
        .from('calibrations')
        .delete()
        .eq('user_id', userId);
      if (delError) throw new SupabaseRepositoryError('עדכון הכיולים נכשל', delError);

      if (normalized.length > 0) {
        const { error } = await client
          .from('calibrations')
          .insert(normalized.map((c) => calibrationToInsert(c, userId)));
        if (error) throw new SupabaseRepositoryError('שמירת הכיולים נכשלה', error);
      }
      return normalized;
    },
  };
}

/*
 * `replaceChildren` used to live here, doing three DELETEs and three INSERTs as
 * separate client calls. It is now `public.replace_recipe_children` in
 * migration 0007, called from inside the save and restore RPCs — the same six
 * statements, in one transaction instead of six.
 */
