// Row ↔ domain mapping.
//
// The database shape (snake_case, normalised across six tables, SQL nulls) and
// the engine's shape (camelCase, one nested object, optional fields) are
// deliberately different. This file is the only place that knows both.
//
// The instruction for this stage was explicit: the UI must not change to suit
// Supabase — the repository does the adapting. That happens here.
//
// Two rules that matter more than they look:
//   1. `null` and `0` are not the same. `yield_actual IS NULL` means "use the
//      theoretical yield" (§1.1, §18.11); zero means a measured zero. Collapsing
//      them would silently change every yield and cost figure.
//   2. Nothing is invented on the way in or out. A column with no value arrives
//      as undefined, and the engine decides what that means.

import type {
  Batch,
  Calibration,
  IngredientLike,
  MeasurementPrefs,
  Pan,
  Recipe,
  RecipeIssue,
  RecipeTrial,
  RecipeVersion,
  Step,
} from '@recipe-notebook/engine';
import { ingredientKeyOf } from '@recipe-notebook/engine';
import type { CatalogItem } from '../features/pricing/catalog.js';
import type { PlanItem, ProductionPlan } from '../features/planning/plan.js';
import type {
  BatchRow,
  CalibrationRow,
  IngredientCatalogRow,
  IngredientCatalogWrite,
  IngredientRow,
  IssueRow,
  Json,
  PriceUnit,
  ProductionPlanItemRow,
  ProductionPlanRow,
  ProductionPlanStockRow,
  ProfileRow,
  RecipeRow,
  RecipeVersionRow,
  StepRow,
  ToolId,
  TrialRow,
} from '../lib/database.types.js';

/** SQL numeric arrives as a number or a string depending on the driver. */
const numOrUndef = (v: number | string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const numOrZero = (v: number | string | null | undefined): number => numOrUndef(v) ?? 0;

/** undefined and '' both mean "no value" on the way to a nullable column. */
/**
 * A nullable numeric column as a nullable number.
 *
 * PostgREST hands `numeric` back as a string when it cannot fit a JS number
 * safely, so the read side has to coerce — but NULL must survive as null and
 * not become 0, which is the distinction the whole model turns on.
 */
const numOrNullable = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toNullableNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toText = (v: unknown): string => (v == null ? '' : String(v));

/**
 * The date part of a timestamp, for display.
 *
 * Defensive on purpose. `created_at` is NOT NULL with a default, so a full row
 * always carries it — but a projection that did not ask for the column, or a
 * row read back before the default was applied, would otherwise hand `.slice`
 * to undefined and take down the whole screen over a label. A missing timestamp
 * is a missing label, never a crash, and nothing is invented to fill it.
 */
const toDay = (v: unknown): string =>
  typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '';

const PRICE_UNITS: readonly PriceUnit[] = ['ק"ג', 'ליטר', "יח'"];
const toPriceUnit = (v: unknown): PriceUnit | null =>
  PRICE_UNITS.includes(v as PriceUnit) ? (v as PriceUnit) : null;

// ── profile ↔ MeasurementPrefs (§1.2) ──────────────────────────────────────

export function profileRowToPrefs(
  row: ProfileRow,
  calibrations: readonly Calibration[] = [],
): MeasurementPrefs {
  return {
    profile: row.profile,
    pro: row.pro,
    units: Array.isArray(row.units) ? [...row.units] : [],
    tools: row.tools ?? {},
    touchedUnits: row.touched_units,
    // §4: `done` on the client is `onboarding_done` on the server
    done: row.onboarding_done,
    calib: [...calibrations],
  };
}

export function prefsToProfileUpdate(
  prefs: MeasurementPrefs,
): Partial<Omit<ProfileRow, 'user_id' | 'created_at' | 'updated_at'>> {
  return {
    profile: prefs.profile ?? 'pro',
    pro: prefs.pro ?? true,
    units: [...(prefs.units ?? [])],
    tools: prefs.tools ?? {},
    touched_units: prefs.touchedUnits ?? false,
    onboarding_done: prefs.done ?? false,
  };
}

// ── calibrations (§1.2, engine B4/B5) ──────────────────────────────────────

export function calibrationRowToDomain(row: CalibrationRow): Calibration {
  return {
    id: row.id,
    ingredientKey: row.ingredient_key,
    name: row.ingredient_name,
    tool: row.tool,
    // B5: the frozen snapshot, never recomputed from current preferences
    toolMl: numOrZero(row.tool_ml),
    grams: numOrZero(row.grams),
    at: toDay(row.created_at),
    ...(row.tool_ml_assumed ? { toolMlAssumed: true } : {}),
  };
}

export function calibrationToInsert(
  calib: Calibration,
  userId: string,
): Omit<CalibrationRow, 'id' | 'created_at'> {
  return {
    user_id: userId,
    ingredient_name: calib.name,
    ingredient_key: calib.ingredientKey ?? ingredientKeyOf(calib),
    tool: calib.tool as ToolId,
    tool_ml: calib.toolMl,
    grams: calib.grams,
    tool_ml_assumed: calib.toolMlAssumed === true,
  };
}

// ── recipe ─────────────────────────────────────────────────────────────────

export interface RecipeBundle {
  recipe: RecipeRow;
  ingredients: IngredientRow[];
  steps: StepRow[];
  issues?: IssueRow[];
  trials?: TrialRow[];
  batches?: BatchRow[];
  versions?: RecipeVersionRow[];
}

function ingredientRowToDomain(row: IngredientRow): IngredientLike {
  const ing: IngredientLike = {
    id: row.id,
    name: row.name,
    qty: numOrZero(row.qty),
    unit: row.unit,
  };
  if (row.ingredient_key) ing.ingredientKey = row.ingredient_key;
  if (row.flour) ing.flour = true;
  if (row.liquid) ing.liquid = true;
  // NULL means "use the shared water table"; 0 means a measured zero (e.g. oil)
  const waterPct = numOrUndef(row.water_pct);
  if (waterPct !== undefined) ing.waterPct = waterPct;
  const unitWeight = numOrUndef(row.unit_weight);
  if (unitWeight !== undefined) ing.unitWeight = unitWeight;
  const gPer100 = numOrUndef(row.g_per_100);
  if (gPer100 !== undefined) ing.gPer100 = gPer100;
  const price = numOrUndef(row.price);
  if (price !== undefined) ing.price = price;
  if (row.price_unit) ing.priceUnit = row.price_unit;
  if (row.sub_recipe_id) ing.subId = row.sub_recipe_id;
  if (row.note) ing.note = row.note;
  return ing;
}

function stepRowToDomain(row: StepRow): Step {
  const step: Step = { id: row.id, text: row.text };
  const temp = numOrUndef(row.temp);
  if (temp !== undefined) step.temp = temp;
  if (row.temp_unit) step.tempUnit = row.temp_unit;
  const minutes = numOrUndef(row.minutes);
  if (minutes !== undefined) step.minutes = minutes;
  if (row.kind) step.kind = row.kind;
  return step;
}

function batchRowToDomain(row: BatchRow): Batch {
  const batch: Batch = { id: row.id, code: row.code, ccp: row.ccp ?? {} };
  if (row.date) batch.date = row.date;
  const core = numOrUndef(row.core_temp);
  if (core !== undefined) batch.coreTemp = core;
  // §13a: an empty chill temperature is not an excursion, so it stays absent
  const chill = numOrUndef(row.chill_temp);
  if (chill !== undefined) batch.chillTemp = chill;
  const weight = numOrUndef(row.weight);
  if (weight !== undefined) batch.weight = weight;
  if (row.owner) batch.by = row.owner;
  if (row.note) batch.note = row.note;
  if (row.photo_path) batch.photo = true;
  return batch;
}

/**
 * A stored version snapshot, turned back into a Recipe.
 *
 * The RPC in migration 0007 writes the snapshot in exactly `RecipeBundle`
 * shape, which is what lets this be a thin wrapper over `bundleToRecipe`
 * rather than a second mapper. That is the whole point: a version read back
 * cannot be interpreted differently from the live rows it was taken from, so
 * there is one source of truth for "what does this row set mean".
 *
 * The recipe id is overridden with the LIVE recipe's id. A snapshot carries
 * the id it had, which is the same recipe — but being explicit means a
 * snapshot that was somehow written with the wrong id cannot make the viewer
 * show a different recipe.
 */
export function snapshotToRecipe(snapshot: unknown, recipeId: string): Recipe {
  const s = (snapshot ?? {}) as {
    recipe?: RecipeRow;
    ingredients?: IngredientRow[];
    steps?: StepRow[];
    issues?: IssueRow[];
  };
  if (!s.recipe) {
    // An empty or malformed snapshot is a real possibility (a row written
    // before 0007, or hand-edited). Returning a named placeholder keeps the
    // history list renderable and says plainly that this one cannot be used.
    return {
      id: recipeId,
      name: '',
      ingredients: [],
      steps: [],
      snapshotUnavailable: true,
    } as Recipe;
  }
  return {
    ...bundleToRecipe({
      recipe: s.recipe,
      ingredients: s.ingredients ?? [],
      steps: s.steps ?? [],
      issues: s.issues ?? [],
    }),
    id: recipeId,
  };
}

export function bundleToRecipe(bundle: RecipeBundle): Recipe {
  const r = bundle.recipe;
  const recipe: Recipe = {
    id: r.id,
    name: r.name,
    category: r.category,
    tags: [...(r.tags ?? [])],
    isSub: r.is_sub,
    locked: r.locked,
    yieldUnits: numOrZero(r.yield_units),
    unitWeight: numOrZero(r.unit_weight),
    targetFC: numOrZero(r.target_fc),
    shelfLife: r.shelf_life,
    storage: r.storage,
    freezing: r.freezing,
    thawing: r.thawing,
    equipment: r.equipment,
    notes: r.notes,
    manualAllergens: [...(r.manual_allergens ?? [])],
    versionNote: r.version_note,
    createdAt: toDay(r.created_at),
    // Carried verbatim (not via toDay) because it is the optimistic-concurrency
    // token the next save sends back, not a label. Truncating it to a day would
    // make every save within the same day look concurrent.
    updatedAt: r.updated_at,
    ingredients: [...bundle.ingredients]
      .sort((a, b) => a.ord - b.ord)
      .map(ingredientRowToDomain),
    steps: [...bundle.steps].sort((a, b) => a.ord - b.ord).map(stepRowToDomain),
  };

  // Stage 7: the sale price. Absent when the user has not set one, which is
  // NOT the same as 0 — 0 means they give it away, and then the food cost is
  // undefined rather than zero. `numOrUndef` keeps the two apart.
  const salePrice = numOrUndef(r.sale_price);
  if (salePrice !== undefined) recipe.salePrice = salePrice;
  // Stage 8: the basis is always present (the column is NOT NULL), the costs
  // are absent until entered.
  recipe.salePriceBasis = r.sale_price_basis === 'unit' ? 'unit' : 'batch';
  const packagingCost = numOrUndef(r.packaging_cost);
  if (packagingCost !== undefined) recipe.packagingCost = packagingCost;
  const laborCost = numOrUndef(r.labor_cost);
  if (laborCost !== undefined) recipe.laborCost = laborCost;
  const otherCost = numOrUndef(r.other_cost);
  if (otherCost !== undefined) recipe.otherCost = otherCost;
  const targetGM = numOrUndef(r.target_gm);
  if (targetGM !== undefined) recipe.targetGM = targetGM;

  // §1.1 / §18.11: NULL yield_actual means theoretical. Leave it absent.
  const yieldActual = numOrUndef(r.yield_actual);
  if (yieldActual !== undefined) recipe.yieldActual = yieldActual;
  const wb = numOrUndef(r.weight_before);
  if (wb !== undefined) recipe.weightBefore = wb;
  const wa = numOrUndef(r.weight_after);
  if (wa !== undefined) recipe.weightAfter = wa;

  if (r.dough_mode) {
    recipe.doughMode = true;
    const ddt = numOrUndef(r.ddt);
    if (ddt !== undefined) recipe.ddt = ddt;
    const flourTemp = numOrUndef(r.flour_temp);
    if (flourTemp !== undefined) recipe.flourTemp = flourTemp;
    const roomTemp = numOrUndef(r.room_temp);
    if (roomTemp !== undefined) recipe.roomTemp = roomTemp;
    const friction = numOrUndef(r.friction);
    if (friction !== undefined) recipe.friction = friction;
  }

  if (r.pan) recipe.pan = r.pan as unknown as Pan;
  if (r.version_of) recipe.versionOf = r.version_of;
  if (r.saved_from_item_id) recipe.savedFrom = r.saved_from_item_id;

  if (bundle.issues?.length) {
    recipe.issues = [...bundle.issues]
      .sort((a, b) => a.ord - b.ord)
      .map<RecipeIssue>((i) => ({ id: i.id, p: i.problem, s: i.solution }));
  }
  if (bundle.trials?.length) {
    recipe.trials = bundle.trials.map<RecipeTrial>((t) => ({
      id: t.id,
      ...(t.date ? { date: t.date } : {}),
      note: t.note,
    }));
  }
  if (bundle.batches?.length) {
    recipe.batches = bundle.batches.map(batchRowToDomain);
  }
  if (bundle.versions?.length) {
    recipe.versions = [...bundle.versions]
      .sort((a, b) => toDay(a.created_at).localeCompare(toDay(b.created_at)))
      .map<RecipeVersion>((v) => ({
        tag: v.tag,
        at: toDay(v.created_at),
        what: v.what,
        snapshot: v.snapshot as unknown as Recipe,
      }));
  }

  return recipe;
}

// ── domain → rows (insert / update) ────────────────────────────────────────

export type RecipeInsert = Omit<RecipeRow, 'id' | 'created_at' | 'updated_at'>;

export function recipeToRow(recipe: Recipe, ownerId: string): RecipeInsert {
  return {
    owner_id: ownerId,
    group_id: null,
    name: toText(recipe.name).trim(),
    category: toText(recipe.category) || 'אחר',
    tags: [...(recipe.tags ?? [])],
    is_sub: recipe.isSub === true,
    locked: recipe.locked === true,
    yield_units: numOrZero(recipe.yieldUnits as number | string | undefined),
    unit_weight: numOrZero(recipe.unitWeight as number | string | undefined),
    yield_actual: toNullableNumber(recipe.yieldActual),
    weight_before: toNullableNumber(recipe.weightBefore),
    weight_after: toNullableNumber(recipe.weightAfter),
    dough_mode: recipe.doughMode === true,
    ddt: toNullableNumber(recipe.ddt),
    flour_temp: toNullableNumber(recipe.flourTemp),
    room_temp: toNullableNumber(recipe.roomTemp),
    friction: toNullableNumber(recipe.friction),
    target_fc: numOrZero(recipe.targetFC as number | string | undefined),
    // NULL-preserving on purpose: an untouched sale price must stay NULL, and
    // an explicit 0 must stay 0. `numOrZero` here would turn "not set" into
    // "given away", which changes whether a food cost exists at all.
    sale_price: toNullableNumber(recipe['salePrice']),
    // Stage 8, requirement E/F. All NULL-preserving for the same reason: "not
    // entered" and "there is none" are different facts, and a cost of 0 that
    // was never entered would make a total look complete when it is not.
    sale_price_basis: recipe['salePriceBasis'] === 'unit' ? 'unit' : 'batch',
    packaging_cost: toNullableNumber(recipe['packagingCost']),
    labor_cost: toNullableNumber(recipe['laborCost']),
    other_cost: toNullableNumber(recipe['otherCost']),
    target_gm: toNullableNumber(recipe['targetGM']),
    shelf_life: toText(recipe.shelfLife),
    storage: toText(recipe.storage),
    freezing: toText(recipe.freezing),
    thawing: toText(recipe.thawing),
    equipment: toText(recipe.equipment),
    notes: toText(recipe.notes),
    manual_allergens: [...(recipe.manualAllergens ?? [])],
    pan: (recipe.pan ?? null) as Json | null,
    version_of: recipe.versionOf ?? null,
    version_note: toText(recipe.versionNote),
    saved_from_item_id: recipe.savedFrom ?? null,
  };
}

// ── ingredient centre (stage 7) ────────────────────────────────────────────

/**
 * A catalog row as the app uses it.
 *
 * `price` and `price_unit` are GENERATED columns — read them, never write
 * them. `catalogItemToRow` below omits them for exactly that reason, and
 * Postgres would reject the insert if it did not.
 */
export function catalogRowToItem(row: IngredientCatalogRow): CatalogItem {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    purchaseUnit: row.purchase_unit,
    // NULL-preserving: an unpriced package is not a package costing 0.
    packageQty: numOrNullable(row.package_qty),
    packageCount: numOrZero(row.package_count) || 1,
    purchaseTotal: numOrNullable(row.purchase_total),
    usablePct: numOrNullable(row.usable_pct),
    supplier: row.supplier,
    purchasedAt: row.purchased_at,
    priceUpdatedAt: row.price_updated_at,
    note: row.note,
    purchasePrice: numOrNullable(row.purchase_price),
    price: numOrNullable(row.price),
    priceUnit: row.price_unit,
    allergens: [...(row.allergens ?? [])],
  };
}

export function catalogItemToRow(
  item: CatalogItem,
  ownerId: string,
): IngredientCatalogWrite {
  return {
    owner_id: ownerId,
    group_id: null,
    key: item.key,
    name: toText(item.name),
    purchase_unit: item.purchaseUnit,
    package_qty: item.packageQty,
    package_count: item.packageCount,
    purchase_total: item.purchaseTotal,
    usable_pct: item.usablePct,
    supplier: toText(item.supplier),
    purchased_at: item.purchasedAt,
    note: toText(item.note),
    g_per_100: null,
    water_pct: null,
    allergens: [...item.allergens],
  };
}

export type IngredientInsert = Omit<IngredientRow, 'id'>;

export function ingredientsToRows(
  recipe: Recipe,
  recipeId: string,
): IngredientInsert[] {
  return (recipe.ingredients ?? []).map((ing, ord) => ({
    recipe_id: recipeId,
    ord,
    name: toText(ing.name),
    // `ingredientKeyOf` returns '' for an ingredient it cannot identify, and an
    // empty key would match every other empty key — so that becomes NULL.
    ingredient_key: ing.ingredientKey ?? (ingredientKeyOf(ing) || null),
    qty: numOrZero(ing.qty),
    unit: toText(ing.unit) || 'גרם',
    flour: ing.flour === true,
    liquid: ing.liquid === true,
    water_pct: toNullableNumber(ing.waterPct),
    unit_weight: toNullableNumber(ing.unitWeight),
    g_per_100: toNullableNumber(ing.gPer100),
    price: toNullableNumber(ing.price),
    price_unit: toPriceUnit(ing.priceUnit),
    sub_recipe_id: ing.subId ?? null,
    note: toText(ing.note),
  }));
}

export type StepInsert = Omit<StepRow, 'id'>;

export function stepsToRows(recipe: Recipe, recipeId: string): StepInsert[] {
  return (recipe.steps ?? []).map((s, ord) => ({
    recipe_id: recipeId,
    ord,
    text: toText(s.text),
    temp: toNullableNumber(s.temp),
    temp_unit: s.tempUnit === 'F' ? 'F' : 'C',
    minutes: toNullableNumber(s.minutes),
    // stage 9: null = nobody classified the step, which the timeline reports
    // rather than guessing at.
    kind: s.kind ?? null,
  }));
}

export type IssueInsert = Omit<IssueRow, 'id'>;

export function issuesToRows(recipe: Recipe, recipeId: string): IssueInsert[] {
  return (recipe.issues ?? []).map((i, ord) => ({
    recipe_id: recipeId,
    ord,
    problem: toText(i.p),
    solution: toText(i.s),
  }));
}

// ── production planning (stage 9) ──────────────────────────────────────────

/**
 * A plan as the app uses it.
 *
 * `onHand` is a plain object keyed by ingredient key, and a key is PRESENT only
 * when the user entered a number. That is the whole of requirement 5's
 * null-vs-0 rule at this layer: absence means nobody said, and a present 0
 * means the shelf is empty.
 */
export function planRowToDomain(
  row: ProductionPlanRow,
  items: readonly ProductionPlanItemRow[],
  stock: readonly ProductionPlanStockRow[],
): ProductionPlan {
  const onHand: Record<string, number> = {};
  for (const s of stock) {
    const n = numOrNullable(s.on_hand);
    if (n !== null) onHand[s.key] = n;
  }
  return {
    id: row.id,
    name: row.name,
    planDate: row.plan_date,
    note: row.note,
    locked: row.locked,
    lockedAt: row.locked_at,
    snapshot: row.snapshot,
    updatedAt: row.updated_at,
    items: [...items]
      .sort((a, b) => a.ord - b.ord)
      .map<PlanItem>((i) => ({
        id: i.id,
        recipeId: i.recipe_id,
        qty: Number(i.qty),
        qtyUnit: i.qty_unit,
        // A `time` comes back as 'HH:MM:SS'; the form and the timeline both
        // work in 'HH:MM'.
        readyAt: i.ready_at ? i.ready_at.slice(0, 5) : null,
        note: i.note,
      })),
    onHand,
  };
}

/** The three payloads `save_production_plan` takes. */
export function planToPayload(plan: ProductionPlan): {
  p_plan: Json;
  p_items: Json;
  p_stock: Json;
} {
  return {
    p_plan: {
      name: toText(plan.name),
      plan_date: plan.planDate,
      note: toText(plan.note),
    } as unknown as Json,
    p_items: plan.items.map((i, ord) => ({
      recipe_id: i.recipeId,
      ord,
      qty: i.qty,
      qty_unit: i.qtyUnit,
      ready_at: i.readyAt ?? '',
      note: toText(i.note),
    })) as unknown as Json,
    // Only entered numbers are sent. A blank field is not a row, which is how
    // "not entered" stays distinguishable from 0 without a nullable row that
    // means nothing.
    p_stock: Object.entries(plan.onHand)
      .filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v))
      .map(([key, v]) => ({ key, on_hand: String(v) })) as unknown as Json,
  };
}
