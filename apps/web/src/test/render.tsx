import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppDataProvider } from '../app/AppDataProvider.js';
import type { Repository, RepositoryCapabilities } from '../data/repository.js';
import { DEMO_CATEGORIES, DEMO_RECIPES } from '../data/demoRecipes.js';
import type { RecipeImage, StoredVersion } from '../data/repository.js';
import { defaultPrefs, type Calibration, type MeasurementPrefs, type Recipe } from '@recipe-notebook/engine';
import { basePriceOf, type CatalogItem } from '../features/pricing/catalog.js';
import type {
  PurchaseInput,
  PurchaseRecord,
} from '../features/pricing/purchases.js';
import type { ProductionPlan } from '../features/planning/plan.js';
import { createFakeGroups, type FakeGroupOptions } from './fakeGroups.js';

export interface FakeRepoOptions {
  prefs?: MeasurementPrefs | null;
  recipes?: readonly Recipe[];
  calibrations?: readonly Calibration[];
  canWrite?: boolean;
  onSavePrefs?(p: MeasurementPrefs): void;
  onSaveRecipe?(r: Recipe): void;
  onDeleteRecipe?(id: string): void;
  onSaveCalibrations?(list: readonly Calibration[]): void;
  versions?: readonly StoredVersion[];
  catalog?: readonly CatalogItem[];
  onSaveCatalogItem?(item: CatalogItem): void;
  pricingOn?: readonly { id: string; name: string; rows: number; overridden: number }[];
  onRestoreVersion?(versionId: string): void;
  usedBy?: readonly { id: string; name: string }[];
  onRecordPurchase?(input: PurchaseInput): void;
  plans?: readonly ProductionPlan[];
  onSavePlan?(plan: ProductionPlan): void;
  /** history rows a test wants to exist before it records anything */
  history?: readonly PurchaseRecord[];
  /** §8: personal notes the account already has, keyed by recipe id */
  notes?: Readonly<Record<string, string>>;
  onSavePrivateNote?(recipeId: string, body: string): void;
  /** §5: photographs the recipe already has */
  images?: readonly RecipeImage[];
  onAddRecipeImage?(recipeId: string, file: File | Blob): void;
  onRemoveRecipeImage?(image: RecipeImage): void;
  /** true makes every signed URL come back null, as a private object can */
  signedUrlFails?: boolean;
  /** §10 — the in-memory group world. See test/fakeGroups.ts. */
  groups?: FakeGroupOptions;
  /**
   * Which backend the screens should believe they are talking to.
   *
   * Defaults to 'local-demo', which is what every test before §10 assumed.
   * The group screens READ this — a session with no server is told so once
   * instead of being given buttons that always fail — so a group test has to
   * be able to say 'supabase'.
   */
  source?: RepositoryCapabilities['source'];
  /** the account these tests act as; also the chat's author id */
  userId?: string;
}

/**
 * The generated columns, mirrored. The DATABASE derives the unit price, so a
 * double that echoed the input would let a test pass on a price the real thing
 * would have recomputed.
 */
function derive(item: CatalogItem): CatalogItem {
  const d = basePriceOf(item);
  return d
    ? { ...item, purchasePrice: d.purchase, price: d.price, priceUnit: d.unit }
    : { ...item, purchasePrice: null, price: null, priceUnit: null };
}

/** An in-memory repository, so a screen test never touches IndexedDB. */
export function fakeRepository(opts: FakeRepoOptions = {}): Repository {
  let prefs = opts.prefs === undefined ? { ...defaultPrefs('pro'), done: true } : opts.prefs;
  let calib = [...(opts.calibrations ?? [])];
  let catalog: CatalogItem[] = [...(opts.catalog ?? [])];
  let plans: ProductionPlan[] = [...(opts.plans ?? [])];
  const purchases: Array<{ key: string; record: PurchaseRecord }> = [];
  let recipes = [...(opts.recipes ?? DEMO_RECIPES)];
  const notes: Record<string, string> = { ...(opts.notes ?? {}) };
  let images: RecipeImage[] = [...(opts.images ?? [])];
  const caps: RepositoryCapabilities = {
    source: opts.source ?? 'local-demo',
    online: true,
    canWrite: opts.canWrite ?? false,
    servingFromCache: false,
  };
  return {
    /*
      §10. An in-memory group world that ENFORCES the rank model — see
      test/fakeGroups.ts. A test opts in by passing `groups`; with none, every
      list is empty and no group screen has anything to show, which is what
      the existing tests expect.
    */
    ...createFakeGroups({ userId: opts.userId ?? 'me', ...opts.groups }),

    capabilities: () => caps,
    listCategories: async () => DEMO_CATEGORIES,
    listRecipes: async () => [...recipes],
    getRecipe: async (id) => recipes.find((r) => r.id === id) ?? null,
    saveRecipe: async (r) => {
      // Assigns an id the way a database would, so a test can tell a create
      // from an update.
      const saved = !r.id || r.id.startsWith('new-') ? { ...r, id: `saved-${recipes.length + 1}` } : r;
      recipes = [...recipes.filter((x) => x.id !== saved.id), saved];
      opts.onSaveRecipe?.(saved);
      return saved;
    },
    deleteRecipe: async (id) => {
      recipes = recipes.filter((r) => r.id !== id);
      opts.onDeleteRecipe?.(id);
    },
    listVersions: async (recipeId) =>
      (opts.versions ?? []).filter((v) => v.recipeId === recipeId),
    restoreVersion: async (versionId) => {
      const v = (opts.versions ?? []).find((x) => x.id === versionId);
      if (!v) throw new Error('הגרסה לא נמצאה');
      // Mirrors what the RPC does: the snapshot becomes the live recipe.
      const restored = { ...v.snapshot, id: v.recipeId };
      recipes = recipes.map((r) => (r.id === v.recipeId ? restored : r));
      opts.onRestoreVersion?.(versionId);
      return restored;
    },
    recipesUsing: async () => [...(opts.usedBy ?? [])],
    getPrefs: async () => prefs,
    savePrefs: async (p) => {
      prefs = p;
      opts.onSavePrefs?.(p);
      return p;
    },
    // The ingredient centre. A screen test opts in by passing `catalog`;
    // otherwise it is empty, so nothing inherits a price and the existing
    // tests keep testing what they tested.
    listCatalog: async () => [...(opts.catalog ?? [])],
    saveCatalogItem: async (item) => {
      const saved = derive(item);
      catalog = [...catalog.filter((c) => c.key !== saved.key), saved];
      opts.onSaveCatalogItem?.(saved);
      return saved;
    },
    deleteCatalogItem: async (key) => {
      catalog = catalog.filter((c) => c.key !== key);
    },
    recipesPricingOn: async () => [...(opts.pricingOn ?? [])],
    // Stage 9: plans live in memory, keyed by id, and a save assigns one the
    // way the database would — so a test can tell a create from an update.
    listPlans: async () =>
      plans.map((p) => ({
        id: p.id,
        name: p.name,
        planDate: p.planDate,
        locked: p.locked,
        items: p.items.length,
      })),
    getPlan: async (id) => plans.find((p) => p.id === id) ?? null,
    savePlan: async (plan) => {
      const saved: ProductionPlan = plan.id
        ? { ...plan }
        : { ...plan, id: `plan-${plans.length + 1}` };
      const at = plans.findIndex((p) => p.id === saved.id);
      if (at >= 0) plans[at] = saved;
      else plans.push(saved);
      opts.onSavePlan?.(saved);
      return saved;
    },
    deletePlan: async (id) => {
      plans = plans.filter((p) => p.id !== id);
    },
    setPlanLocked: async (id, locked, snapshot) => {
      plans = plans.map((p) =>
        p.id === id
          ? {
              ...p,
              locked,
              lockedAt: locked ? '2026-10-01T00:00:00Z' : null,
              // The snapshot goes with the lock, exactly as the RPC does it.
              snapshot: locked ? snapshot : null,
            }
          : p,
      );
    },
    // Stage 8: the same two writes `record_purchase` does in one transaction —
    // append the purchase, then move the active price.
    recordPurchase: async (input) => {
      const previous = catalog.find((c) => c.key === input.key);
      const saved = derive({
        id: previous?.id ?? `cat-${input.key}`,
        key: input.key,
        name: input.name || input.key,
        purchaseUnit: input.purchaseUnit,
        packageQty: input.packageQty,
        packageCount: input.packageCount,
        purchaseTotal: input.purchaseTotal,
        usablePct: input.usablePct,
        supplier: input.supplier,
        purchasedAt: input.purchasedAt,
        priceUpdatedAt: input.purchasedAt,
        note: input.note,
        purchasePrice: null,
        price: null,
        priceUnit: null,
        allergens: previous ? [...previous.allergens] : [],
      });
      const prevPrice = purchases
        .filter((r) => r.key === input.key)
        .at(-1)?.record.price ?? null;
      purchases.push({
        key: input.key,
        record: {
          id: `pur-${purchases.length + 1}`,
          purchasedAt: input.purchasedAt ?? '2026-01-01',
          supplier: input.supplier,
          purchaseUnit: input.purchaseUnit,
          packageCount: input.packageCount,
          packageQty: input.packageQty,
          purchaseTotal: input.purchaseTotal,
          usablePct: input.usablePct,
          purchasePrice: saved.purchasePrice,
          price: saved.price,
          prevPrice,
          pctChange:
            prevPrice === null || prevPrice === 0 || saved.price === null
              ? null
              : ((saved.price - prevPrice) / prevPrice) * 100,
        },
      });
      catalog = [...catalog.filter((c) => c.key !== saved.key), saved];
      opts.onRecordPurchase?.(input);
      return saved;
    },
    purchaseHistory: async (key) =>
      [
        ...(opts.history ?? []),
        ...purchases.filter((r) => r.key === key).map((r) => r.record),
      ].reverse(),
    // §8. Mirrors migration 0022: an empty body is not a note, it is the
    // absence of one, so saving one removes it.
    // §5 photographs. The double keeps them in memory and hands back a fake
    // signed URL, so a gallery test exercises the real code path — list, then
    // sign each path — without a network or a bucket.
    listRecipeImages: async (recipeId: string) =>
      images.filter((i) => i.recipeId === recipeId).sort((a, b) => a.ord - b.ord),
    addRecipeImage: async (recipeId: string, file: File | Blob) => {
      if (opts.onAddRecipeImage) opts.onAddRecipeImage(recipeId, file);
      const added: RecipeImage = {
        id: `img-${images.length + 1}`,
        recipeId,
        storagePath: `${recipeId}/img-${images.length + 1}.webp`,
        ord: images.length,
        width: 1600,
        height: 1200,
        bytes: 120000,
        caption: '',
        createdAt: new Date().toISOString(),
        /* The centre, which is what `cover` does with no position at all. */
        focalX: 50,
        focalY: 50,
      };
      images = [...images, added];
      return added;
    },
    removeRecipeImage: async (image: RecipeImage) => {
      opts.onRemoveRecipeImage?.(image);
      images = images.filter((i) => i.id !== image.id);
    },
    /* Stored, so a test can assert that a position SURVIVES rather than that
       a call was made. */
    setRecipeImageFocus: async (image: RecipeImage, focal: { x: number; y: number }) => {
      const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
      const next: RecipeImage = { ...image, focalX: clamp(focal.x), focalY: clamp(focal.y) };
      images = images.map((i) => (i.id === image.id ? next : i));
      return next;
    },
    signedImageUrl: async (path: string) =>
      opts.signedUrlFails === true ? null : `blob:signed/${path}`,

    /* The list version: the first photo of each recipe, signed, in one call.
       Same double, same rules — a recipe with no photo, or one that cannot be
       signed, is simply absent. */
    recipeThumbs: async (recipeIds: readonly string[]) => {
      if (opts.signedUrlFails === true) return {};
      const out: Record<string, string> = {};
      for (const id of recipeIds) {
        const first = images
          .filter((i) => i.recipeId === id)
          .sort((a, b) => a.ord - b.ord)[0];
        if (first) out[id] = `blob:signed/${first.storagePath}`;
      }
      return out;
    },

    getPrivateNote: async (recipeId: string) => notes[recipeId] ?? null,
    savePrivateNote: async (recipeId: string, body: string) => {
      if (body.trim() === '') delete notes[recipeId];
      else notes[recipeId] = body;
      opts.onSavePrivateNote?.(recipeId, body);
    },
    listCalibrations: async () => calib,
    saveCalibrations: async (list) => {
      calib = [...list];
      opts.onSaveCalibrations?.(calib);
      return calib;
    },
  };
}

/** Renders a single route with the providers the app supplies in production. */
export function renderRoute(
  ui: ReactElement,
  { path = '/', route = '/', repository = fakeRepository(), userId = 'me' } = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {/* `userId` is injected because there is no AuthProvider here; 'me' is
          also what fakeGroups treats as the signed-in account. */}
      <AppDataProvider repository={repository} userId={userId}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}
