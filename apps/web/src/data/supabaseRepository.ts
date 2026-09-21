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

/** The column list used to pull a whole recipe in one round trip. */
const RECIPE_SELECT = `
  *,
  ingredients (*),
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
    const detail =
      typeof cause === 'object' && cause !== null && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`${operation}: ${detail}`);
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
      const saved = await this.getRecipe(recipeId);
      if (!saved) throw new SupabaseRepositoryError('שמירה', 'המתכון לא נמצא אחרי השמירה');
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
        The OBJECT first, then the row. Postgres cannot reach into storage, so
        nothing deletes the file for us (0029 says why there is no trigger). In
        this order a failure leaves a row pointing at a missing file, which the
        gallery already has to survive — a signed URL can fail for other
        reasons. The other order leaves a file nothing points at, which nothing
        will ever clean up.
      */
      const removed = await client.storage
        .from(RECIPE_IMAGE_BUCKET)
        .remove([image.storagePath]);
      if (removed.error) {
        throw new SupabaseRepositoryError('מחיקת התמונה נכשלה', removed.error);
      }
      const { error } = await client.from('recipe_images').delete().eq('id', image.id);
      if (error) throw new SupabaseRepositoryError('מחיקת התמונה נכשלה', error);
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
