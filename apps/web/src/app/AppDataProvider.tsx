// The single place the rest of the app gets its data from.
//
// Holds the repository, the measurement preferences and the recipe list. Nothing
// below this provider knows whether the data came from Supabase, from the demo
// set or from the offline mirror — that is the point of data/repository.ts.
//
// Still plain React context and no server-state library. The app fetches three
// things once per session — preferences, calibrations and the recipe list — and
// re-reads a recipe on save. There is no background refetch and no cross-screen
// cache to invalidate, so TanStack Query would be structure without a job. It
// slots in behind this provider if and when there is one.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import type { CatalogItem } from '../features/pricing/catalog.js';
import type {
  PurchaseInput,
  PurchaseRecord,
} from '../features/pricing/purchases.js';
import type { ProductionPlan } from '../features/planning/plan.js';
import { normalizeCalibrations } from '@recipe-notebook/engine';
import { createLocalDemoRepository, firstRunPrefs } from '../data/localDemoRepository.js';
import { createSupabaseRepository } from '../data/supabaseRepository.js';
import {
  WriteNotAllowedError,
  type GroupRepository,
  type IdentityRepository,
  type Repository,
  type RepositoryCapabilities,
  type SaveOptions,
  type PlanSummary,
  type RecipeImage,
  type StoredVersion,
} from '../data/repository.js';
import { supabaseStatus } from '../lib/supabase.js';
import { useOptionalAuth } from '../auth/AuthProvider.js';

export interface AppData {
  ready: boolean;
  /** null only before the first load resolves */
  prefs: MeasurementPrefs;
  recipes: readonly Recipe[];
  categories: readonly string[];
  capabilities: RepositoryCapabilities;
  /** a human-readable note about where the data is coming from */
  backendNote: string;
  error: string | null;
  setPrefs(patch: Partial<MeasurementPrefs>): Promise<void>;
  setCalibrations(list: readonly Calibration[]): Promise<void>;
  getRecipe(id: string): Recipe | null;
  /**
   * Reads ONE recipe from the repository, by id.
   *
   * `getRecipe` above looks in the list this provider holds, which is the
   * ACCOUNT's own recipes — and that is the right answer for every screen that
   * came before §10. A group recipe is not in that list: it belongs to the
   * instructor, and `recipes_group_read` is what lets this account see it. So
   * screen 17 needs a real read, and asking the in-memory list would have
   * shown "המתכון אינו נטען" for every group recipe there is.
   *
   * Found by lint, of all things: `await`ing the synchronous `getRecipe`
   * inside a `Promise.all` is an `await-thenable` error, and the error was
   * pointing at a real defect rather than at a style.
   */
  fetchRecipe(id: string): Promise<Recipe | null>;
  /**
   * Persists a recipe and returns it as the server stored it — with the real
   * id, which a newly created recipe does not have until now.
   *
   * Unlike `setPrefs`, this is NOT optimistic and it does NOT swallow the
   * failure into the banner. The caller is a form that has to know whether to
   * navigate away, and a form that navigates away from an unsaved recipe loses
   * the user's work. So this throws.
   */
  saveRecipe(recipe: Recipe, options?: SaveOptions): Promise<Recipe>;
  /** Removes a recipe. Throws on failure, for the same reason. */
  deleteRecipe(id: string): Promise<void>;
  /** The version history for one recipe, newest first (§9). */
  listVersions(recipeId: string): Promise<StoredVersion[]>;
  /**
   * Restores a version. The current state is snapshotted first, so this is
   * itself undoable (§9). Throws on failure.
   */
  restoreVersion(versionId: string): Promise<Recipe>;
  /** Which of the account's recipes use this one as a base. */
  recipesUsing(recipeId: string): Promise<Array<{ id: string; name: string }>>;

  /**
   * The ingredient centre (stage 7). Held in context rather than fetched per
   * screen because EVERY recipe computation needs it: a row with no price of
   * its own resolves one from here, so the catalog is an input to the engine's
   * figures and not a side panel.
   */
  catalog: readonly CatalogItem[];
  saveCatalogItem(item: CatalogItem): Promise<CatalogItem>;
  deleteCatalogItem(key: string): Promise<void>;
  recipesPricingOn(key: string): Promise<
    Array<{ id: string; name: string; rows: number; overridden: number }>
  >;
  /** Stage 8: records a purchase and moves the active price with it. */
  recordPurchase(input: PurchaseInput): Promise<CatalogItem>;
  purchaseHistory(key: string): Promise<PurchaseRecord[]>;
  /**
   * Stage 9: production plans. Fetched per screen rather than held here — a
   * plan is not an input to anyone else's figures, unlike the catalog, and
   * loading every plan to open one would be waste.
   */
  /**
   * §8 personal notes. Fetched per recipe rather than held here, for the same
   * reason as a plan: nobody else's figure depends on it, and pulling every
   * note to open one recipe would be waste.
   */
  getPrivateNote(recipeId: string): Promise<string | null>;
  savePrivateNote(recipeId: string, body: string): Promise<void>;
  /* §5 photographs. Passed straight through: the gallery owns its own state,
     because a photo list is per-recipe and nothing else on the screen needs
     it — putting it in the provider would reload every recipe's photos on
     every render of the notebook. */
  listRecipeImages(recipeId: string): Promise<RecipeImage[]>;
  addRecipeImage(recipeId: string, file: File | Blob): Promise<RecipeImage>;
  removeRecipeImage(image: RecipeImage): Promise<void>;
  signedImageUrl(storagePath: string): Promise<string | null>;
  /** The first photo of each recipe, signed, in one call — for the notebook's
      cards. See the repository interface. */
  recipeThumbs(recipeIds: readonly string[]): Promise<Record<string, string>>;
  listPlans(): Promise<PlanSummary[]>;
  getPlan(id: string): Promise<ProductionPlan | null>;
  savePlan(plan: ProductionPlan): Promise<ProductionPlan>;
  deletePlan(id: string): Promise<void>;
  setPlanLocked(id: string, locked: boolean, snapshot: unknown): Promise<void>;
  /**
   * §10 — groups, courses, invitations, members, the chat and the account's
   * own name and picture.
   *
   * Passed through as ONE object rather than as forty wrapped methods, which
   * is a deliberate exception to how this provider exposes everything else.
   * Two reasons:
   *
   *   · nothing outside a group screen depends on a group. The catalog is in
   *     context because every recipe computation reads a price from it; a
   *     course list is an input to one screen, so holding it here would mean
   *     reloading it on every render of the notebook.
   *   · a wrapper that only forwards its arguments is a place for a bug and
   *     nowhere for a decision. Forty of them would be forty chances to drop
   *     a parameter, and not one line of behaviour.
   *
   * The object comes straight off the repository, which is memoised, so its
   * identity is stable and it can sit in a `useEffect` dependency list.
   */
  groups: GroupRepository & IdentityRepository;
  /**
   * The signed-in account's id, or null when there is no session.
   *
   * §10 needs it and nothing before §10 did: a chat has to know which
   * messages are the reader's own — for the edit button, for the alignment,
   * and for the unread divider, which must not be drawn above your own
   * sentence. Every USE of it is cosmetic; the enforcement is `author_id =
   * auth.uid()` in the insert policy and `old.author_id = auth.uid()` in the
   * update guard, neither of which trusts anything from here.
   */
  userId: string | null;
  /**
   * Raises a failure on the shell's own banner.
   *
   * For a write whose own screen is GONE by the time it fails — the personal
   * note's unmount flush is the case that forced it: a cook types a line and
   * presses back inside the debounce, the save is attempted from a component
   * that no longer exists, and nothing was left to say so (§11's silent save
   * failure). The banner lives in `AppShell`, above every screen, so it is
   * still there to carry the message.
   */
  raiseError(message: string): void;
  clearError(): void;
}

const AppDataContext = createContext<AppData | null>(null);

function describeBackend(caps: RepositoryCapabilities): string {
  if (caps.source === 'supabase') {
    if (caps.servingFromCache) {
      return 'מוצג מהעתק שנשמר על המכשיר. אין כרגע חיבור לשרת, ולכן אי אפשר לשמור שינויים.';
    }
    return caps.online
      ? 'מחובר לחשבון שלכם.'
      : 'אין כרגע חיבור לאינטרנט. אפשר לקרוא, אבל לא לשמור.';
  }

  /*
    'simulated' HAS NO SENTENCE HERE ANY MORE.

    It used to return one — "סימולציה מקומית. אין חשבון ואין שרת: …" — and
    AppShell drew it as a box on every screen. Ahmed asked for that box gone
    from the interface, so `showBackendNote` no longer includes 'simulated'
    and this branch would be dead text. The trial still discloses what it is,
    but in its own "גרסת ניסוי" sheet, not as a box over the product.

    The source value itself is untouched: 'simulated' still means no account
    and no server, and nothing here claims otherwise.
  */

  const s = supabaseStatus();
  if (!s.configured && s.reason === 'service-role-key-in-browser') {
    return 'המפתח שהוגדר הוא service_role ולכן לא נעשה בו שימוש. בדפדפן מותר רק מפתח anon או publishable.';
  }
  return 'אין חיבור לשרת בהתקנה הזאת. מוצגים מתכוני הדמו לקריאה בלבד, וההעדפות נשמרות על המכשיר הזה בלבד.';
}

export function AppDataProvider({
  children,
  repository,
  userId: userIdOverride,
}: {
  children: ReactNode;
  /** injected in tests */
  repository?: Repository;
  /** injected in tests, alongside `repository` — there is no AuthProvider there */
  userId?: string | null;
}) {
  const auth = useOptionalAuth();
  const userId = userIdOverride ?? auth?.user?.id ?? null;
  const client = auth?.client ?? null;

  /**
   * Which repository is in force.
   *
   * This is the whole point of the seam in data/repository.ts: the decision is
   * three lines here, and not one screen below this provider knows or cares.
   *
   * A signed-in user gets Supabase. Everyone else — no project configured, or
   * configured but signed out — gets the read-only demo repository, which
   * refuses writes rather than faking them.
   */
  const repo = useMemo(() => {
    if (repository) return repository;
    if (client && userId) return createSupabaseRepository({ client, userId });
    return createLocalDemoRepository();
  }, [repository, client, userId]);

  const [ready, setReady] = useState(false);
  const [prefs, setPrefsState] = useState<MeasurementPrefs>(firstRunPrefs);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [catalog, setCatalog] = useState<readonly CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<RepositoryCapabilities>(() => repo.capabilities());

  useEffect(() => {
    let cancelled = false;
    // `void`: the body catches everything, so there is nothing to await and
    // nothing that can reject — but saying so explicitly is what keeps the next
    // edit from adding a throw path nobody handles.
    void (async () => {
      try {
        const [stored, calib, list, cats, materials] = await Promise.all([
          repo.getPrefs(),
          repo.listCalibrations(),
          repo.listRecipes(),
          repo.listCategories(),
          repo.listCatalog(),
        ]);
        if (cancelled) return;
        // §1.2: prefs own the calibration list, so they are merged into one object
        // the engine can consume directly.
        setPrefsState({ ...(stored ?? firstRunPrefs()), calib: normalizeCalibrations(calib) });
        setRecipes(list);
        setCategories(cats);
        setCatalog(materials);
        setCaps(repo.capabilities());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'טעינת הנתונים נכשלה');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // The offline half of the hybrid model needs to know when the network drops,
  // so a screen can say "מוצג מהמכשיר" instead of silently showing stale data.
  useEffect(() => {
    const sync = () => setCaps(repo.capabilities());
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [repo]);

  const setPrefs = useCallback(
    async (patch: Partial<MeasurementPrefs>) => {
      const next = { ...prefs, ...patch };
      // optimistic: preferences drive every conversion on screen, so a 200ms
      // round trip would make the whole page feel laggy
      setPrefsState(next);
      try {
        await repo.savePrefs(next);
        setError(null);
      } catch (e) {
        setError(
          e instanceof WriteNotAllowedError
            ? e.reason
            : e instanceof Error
              ? e.message
              : 'שמירת ההעדפות נכשלה',
        );
      }
    },
    [prefs, repo],
  );

  const setCalibrations = useCallback(
    async (list: readonly Calibration[]) => {
      const normalized = normalizeCalibrations(list);
      setPrefsState((p) => ({ ...p, calib: normalized }));
      try {
        await repo.saveCalibrations(normalized);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שמירת הכיול נכשלה');
      }
    },
    [repo],
  );

  const getRecipe = useCallback(
    (id: string) => recipes.find((r) => r.id === id) ?? null,
    [recipes],
  );

  const fetchRecipe = useCallback((id: string) => repo.getRecipe(id), [repo]);

  const saveRecipe = useCallback(
    async (recipe: Recipe, options?: SaveOptions): Promise<Recipe> => {
      const saved = await repo.saveRecipe(recipe, options);
      // Replace by id rather than refetching the notebook: the repository
      // already re-read the recipe after writing it, so this list is as fresh
      // as a round trip would make it, for one less round trip.
      setRecipes((list) => {
        const without = list.filter((r) => r.id !== saved.id && r.id !== recipe.id);
        return [...without, saved];
      });
      setError(null);
      return saved;
    },
    [repo],
  );

  const deleteRecipe = useCallback(
    async (id: string): Promise<void> => {
      await repo.deleteRecipe(id);
      setRecipes((list) => list.filter((r) => r.id !== id));
      setError(null);
    },
    [repo],
  );

  const listVersions = useCallback(
    (recipeId: string) => repo.listVersions(recipeId),
    [repo],
  );

  const restoreVersion = useCallback(
    async (versionId: string): Promise<Recipe> => {
      const restored = await repo.restoreVersion(versionId);
      setRecipes((list) => list.map((r) => (r.id === restored.id ? restored : r)));
      setError(null);
      return restored;
    },
    [repo],
  );

  const recipesUsing = useCallback(
    (recipeId: string) => repo.recipesUsing(recipeId),
    [repo],
  );

  const saveCatalogItem = useCallback(
    async (item: CatalogItem): Promise<CatalogItem> => {
      const saved = await repo.saveCatalogItem(item);
      // Replaced in place, so every open screen recomputes with the new price
      // immediately. This is what requirement 2 means in practice: one write,
      // and every recipe that inherits the price has moved.
      setCatalog((list) => [...list.filter((c) => c.key !== saved.key), saved]);
      setError(null);
      return saved;
    },
    [repo],
  );

  const deleteCatalogItem = useCallback(
    async (key: string): Promise<void> => {
      await repo.deleteCatalogItem(key);
      setCatalog((list) => list.filter((c) => c.key !== key));
      setError(null);
    },
    [repo],
  );

  const recipesPricingOn = useCallback(
    (key: string) => repo.recipesPricingOn(key),
    [repo],
  );

  const recordPurchase = useCallback(
    async (input: PurchaseInput): Promise<CatalogItem> => {
      const saved = await repo.recordPurchase(input);
      // Same replacement as a save: the new price is in effect everywhere at
      // once, because there is only one place it lives.
      setCatalog((list) => [...list.filter((c) => c.key !== saved.key), saved]);
      setError(null);
      return saved;
    },
    [repo],
  );

  const purchaseHistory = useCallback(
    (key: string) => repo.purchaseHistory(key),
    [repo],
  );

  const listRecipeImages = useCallback((id: string) => repo.listRecipeImages(id), [repo]);
  const addRecipeImage = useCallback(
    (id: string, file: File | Blob) => repo.addRecipeImage(id, file),
    [repo],
  );
  const removeRecipeImage = useCallback(
    (image: RecipeImage) => repo.removeRecipeImage(image),
    [repo],
  );
  const signedImageUrl = useCallback(
    (path: string) => repo.signedImageUrl(path),
    [repo],
  );
  const recipeThumbs = useCallback(
    (ids: readonly string[]) => repo.recipeThumbs(ids),
    [repo],
  );

  const getPrivateNote = useCallback((id: string) => repo.getPrivateNote(id), [repo]);
  const savePrivateNote = useCallback(
    (id: string, body: string) => repo.savePrivateNote(id, body),
    [repo],
  );

  const listPlans = useCallback(() => repo.listPlans(), [repo]);
  const getPlan = useCallback((id: string) => repo.getPlan(id), [repo]);
  const savePlan = useCallback(
    async (plan: ProductionPlan) => {
      const saved = await repo.savePlan(plan);
      setError(null);
      return saved;
    },
    [repo],
  );
  const deletePlan = useCallback((id: string) => repo.deletePlan(id), [repo]);
  const setPlanLocked = useCallback(
    (id: string, locked: boolean, snapshot: unknown) =>
      repo.setPlanLocked(id, locked, snapshot),
    [repo],
  );

  const value = useMemo<AppData>(
    () => ({
      ready,
      prefs,
      recipes,
      categories,
      capabilities: caps,
      backendNote: describeBackend(caps),
      error,
      setPrefs,
      setCalibrations,
      getRecipe,
      fetchRecipe,
      saveRecipe,
      deleteRecipe,
      listVersions,
      restoreVersion,
      recipesUsing,
      catalog,
      saveCatalogItem,
      deleteCatalogItem,
      recipesPricingOn,
      recordPurchase,
      purchaseHistory,
      getPrivateNote,
      savePrivateNote,
      listRecipeImages,
      recipeThumbs,
      addRecipeImage,
      removeRecipeImage,
      signedImageUrl,
      listPlans,
      getPlan,
      savePlan,
      deletePlan,
      setPlanLocked,
      // §10, straight off the repository — see the note on AppData.groups.
      groups: repo,
      userId,
      raiseError: (message: string) => setError(message),
      clearError: () => setError(null),
    }),
    [
      ready,
      prefs,
      recipes,
      categories,
      caps,
      error,
      setPrefs,
      setCalibrations,
      getRecipe,
      fetchRecipe,
      saveRecipe,
      deleteRecipe,
      listVersions,
      restoreVersion,
      recipesUsing,
      catalog,
      saveCatalogItem,
      deleteCatalogItem,
      recipesPricingOn,
      recordPurchase,
      purchaseHistory,
      getPrivateNote,
      savePrivateNote,
      listRecipeImages,
      recipeThumbs,
      addRecipeImage,
      removeRecipeImage,
      signedImageUrl,
      listPlans,
      getPlan,
      savePlan,
      deletePlan,
      setPlanLocked,
      repo,
      userId,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside <AppDataProvider>');
  return ctx;
}
