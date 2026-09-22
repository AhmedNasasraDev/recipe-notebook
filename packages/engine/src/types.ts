// Shared types for the unified Recipe Notebook engine.
// Data model names follow RECIPE_NOTEBOOK_IMPLEMENTATION_SPEC.md §1.

/** Where a number came from, and how much we are allowed to trust it. */
export type Source =
  | 'exact' //         a fixed ratio inside one unit family (g↔kg, ml↔l, tool↔tool)
  | 'personal' //      the user's own calibration for this exact ingredient
  | 'recipe' //        a density typed into the recipe itself (ingredient.gPer100)
  | 'system' //        a measured, widely accepted table value
  | 'estimate' //      a value that varies a lot with the ingredient's own form
  | 'unavailable'; //  no reliable data — we must not print a number

export type Confidence = 'exact' | 'measured' | 'estimated' | 'none';

export type UnitGroup = 'weight' | 'volume' | 'count';
export type ToolId = 'cup' | 'tbsp' | 'tsp';

export interface UnitDef {
  id: string;
  he: string;
  short?: string;
  group: UnitGroup;
  /** grams per unit — weight units only */
  g?: number;
  /** millilitres per unit — fixed-size volume units only */
  ml?: number;
  /** millilitres come from the user's measuring tool, not from a constant */
  tool?: ToolId;
  /** fallback grams per item for count units (always an estimate) */
  itemG?: number;
}

/** One step in how a number was produced. Kept so the UI can never mislabel it. */
export interface ProvenanceStep {
  from: string;
  to: string;
  source: Source;
  /** grams per 100 ml used for this step, when a density was involved */
  gPer100?: number;
  /** density table key, when a table row was involved */
  densityKey?: string;
  note?: string;
}

/** The full audit trail behind a displayed value. */
export interface Provenance {
  /** weakest link of the whole chain — this is what the badge must show */
  source: Source;
  confidence: Confidence;
  /** true only when no density or item-weight estimate was involved anywhere */
  exact: boolean;
  label: string;
  color: string;
  why: string;
  chain: ProvenanceStep[];
  /** e.g. "כוס = 250 מ\"ל לפי ההגדרות שלך" */
  toolNote?: string;
  /** true when any step needs professional review (see CONFLICTS.md) */
  needsReview: boolean;
}

export interface Calibration {
  id?: string;
  /** stable ingredient identity, when the host app has one */
  ingredientKey?: string;
  /** the ingredient name as the user typed it at calibration time */
  name: string;
  tool: ToolId;
  /**
   * B5: the volume of the tool AT CALIBRATION TIME, in millilitres.
   * Frozen on purpose — changing prefs.tools later must not rewrite history.
   */
  toolMl: number;
  grams: number;
  at?: string;
  /** set when toolMl had to be assumed while migrating a legacy record */
  toolMlAssumed?: boolean;
}

export interface MeasurementPrefs {
  profile?: 'home' | 'pro' | 'study';
  units?: string[];
  touchedUnits?: boolean;
  tools?: Partial<Record<ToolId, number>>;
  calib?: Calibration[];
  pro?: boolean;
  done?: boolean;
}

/** The subset of an ingredient the conversion layer needs. */
export interface IngredientLike {
  id?: string;
  ingredientKey?: string;
  name?: string;
  qty?: number | string;
  unit?: string;
  unitWeight?: number | string;
  gPer100?: number | string;
  waterPct?: number | string;
  flour?: boolean;
  liquid?: boolean;
  price?: number | string;
  priceUnit?: string;
  subId?: string | null;
  countSubFormula?: boolean;
  note?: string;
  density?: number | string;
}

export interface DensityHit {
  gPer100: number;
  source: Source;
  densityKey?: string;
  note: string;
  needsReview: boolean;
}

export interface ConversionOk {
  ok: true;
  /** numeric result in the target unit */
  value: number;
  /** result formatted for the target unit */
  text: string;
  /** grams equivalent, when it could be established */
  grams: number | null;
  /** what the recipe itself says — never overwritten by scaling or display */
  original: { qty: number; unit: string; label: string };
  provenance: Provenance;
}

export interface ConversionFail {
  ok: false;
  why: string;
  original: { qty: number; unit: string; label: string };
  provenance: Provenance;
}

export type ConversionResult = ConversionOk | ConversionFail;

export interface GramsResult {
  /** null means: no reliable data. Callers must not substitute a number. */
  grams: number | null;
  provenance: Provenance;
}

/**
 * What kind of step this is (stage 9, requirement 8).
 *
 * WHY THIS IS IN THE ENGINE, documented before the change as the instructions
 * require: stage 9 asks a production timeline to distinguish active work from
 * proofing, refrigeration and baking, and NOTHING in the model held that fact.
 * A step had a text, a temperature and a duration; whether 90 minutes is work
 * or waiting was unknowable, and deriving it from the Hebrew text would be the
 * invention the instructions forbid.
 *
 * It is a TYPE addition and nothing else — no calculation in the engine reads
 * it, `compute()` is byte-identical, and every existing step has it absent.
 * The classifier that falls back to the temperature lives in the web layer,
 * because reading "240 °C means baking" is presentation of a fact the recipe
 * already carries, not a new engine primitive.
 */
export type StepKind = 'active' | 'passive' | 'chill' | 'proof' | 'bake';

export interface Step {
  id?: string;
  text?: string;
  temp?: string | number;
  tempUnit?: string;
  minutes?: string | number;
  /** undefined = nobody classified it, and a timeline must say so */
  kind?: StepKind;
}

/** Spec §1.1 Pan. Geometry only; the arithmetic is in `pan.ts` (§7). */
export interface Pan {
  kind: 'round' | 'rect' | 'loaf' | 'gn' | 'muffin' | 'none';
  diameter?: number | string;
  width?: number | string;
  length?: number | string;
  height?: number | string;
  gn?: string;
  cavities?: number | string;
}

/** Spec §1.1 Version — a full snapshot plus a computed description of the change. */
export interface RecipeVersion {
  tag: string;
  at: string;
  what: string;
  snapshot: Recipe;
}

/** Spec §1.1 issues — problem and solution, stored as `p` and `s`. */
export interface RecipeIssue {
  id?: string;
  p: string;
  s: string;
}

/** Spec §1.1 trials — the trial log. */
export interface RecipeTrial {
  id?: string;
  date?: string;
  note?: string;
}

/**
 * Spec §1.1 Batch. §13a: the HACCP status is DERIVED from `ccp` and `chillTemp`
 * and is deliberately not stored, so a batch cannot be marked compliant without
 * the record behind it.
 */
export interface Batch {
  id?: string;
  code: string;
  date?: string;
  coreTemp?: number | string;
  chillTemp?: number | string;
  weight?: number | string;
  by?: string;
  note?: string;
  ccp?: Record<string, boolean>;
  photo?: boolean;
}

export interface Recipe {
  id: string;
  name?: string;
  category?: string;
  tags?: string[];
  isSub?: boolean;
  locked?: boolean;
  yieldUnits?: number | string;
  unitWeight?: number | string;
  yieldActual?: number | string;
  weightBefore?: number | string;
  weightAfter?: number | string;
  doughMode?: boolean;
  ddt?: number | string;
  flourTemp?: number | string;
  roomTemp?: number | string;
  friction?: number | string;
  targetFC?: number | string;
  ingredients?: IngredientLike[];
  steps?: Step[];

  // texts (§1.1)
  shelfLife?: string;
  storage?: string;
  freezing?: string;
  thawing?: string;
  equipment?: string;
  /** §8: public notes — these DO travel into sharing, the order sheet and the label */
  notes?: string;
  /** §8: private notes — never leave the owner's own screen */
  privateNotes?: string;
  manualAllergens?: string[];

  // structure (§1.1)
  pan?: Pan | null;
  versions?: RecipeVersion[];
  versionOf?: string | null;
  versionNote?: string;
  /** "<groupId>:<itemId>" when this recipe was copied out of a group (§11) */
  savedFrom?: string | null;

  issues?: RecipeIssue[];
  trials?: RecipeTrial[];
  batches?: Batch[];

  createdAt?: string;

  /** Anything the host app carries that the engine does not read. */
  [k: string]: unknown;
}

export interface ComputedRow {
  ing: IngredientLike;
  /** null when the ingredient could not be resolved to a weight */
  g: number | null;
  provenance: Provenance;
  cost: number;
  bakerPct: number;
  sub: Computed | null;
  /**
   * Was this row's own price applied to produce `cost`? (stage 7)
   *
   * `cost` alone cannot answer it — a row can legitimately cost 0 because
   * someone priced it at 0, and can cost 0 because its price could not be
   * applied at all. Added when a per-item price with no known item weight
   * turned out to be the second case while every caller read it as the first.
   *
   * false for a sub-recipe line: it has no price of its own by design, and its
   * cost rolls up from the base recipe.
   */
  priced: boolean;
}

export interface Unresolved {
  ingredientId?: string;
  name: string;
  unit: string;
  reason: string;
}

export interface Computed {
  rows: ComputedRow[];
  totalG: number;
  theoretical: number;
  actualYield: number;
  prodLoss: number;
  bakeLoss: number;
  scaleWeight: number;
  /**
   * The unit count the recipe is taken to yield at this factor.
   *
   * A DECLARED yield (`yieldUnits`) is the recipe's own statement of what it
   * makes, and it is the baseline for "make 6 of these": 6 of a declared 12
   * is exactly half. The weights are a check on that statement, not a
   * replacement for it — so `unitsActual` follows the weights only when the
   * finished batch was actually weighed (`yieldActual`), or when no count was
   * declared at all.
   */
  unitsActual: number;
  /** `yieldUnits × factor`; 0 when the recipe declares no unit count */
  unitsDeclared: number;
  /** what the weights say the batch makes (`actualYield / scaleWeight`); 0 without a unit weight */
  unitsFromWeight: number;
  /** the declared count and the weighed count disagree by more than 5% */
  unitsWarn: boolean;
  cost: number;
  costPerUnit: number;
  costPerKg: number;
  price: number;
  flour: number;
  liquid: number;
  water: number;
  hydration: number;
  trueHydration: number;
  waterTemp: number | null;
  allergens: string[];
  factor: number;
  /** ingredients whose weight could not be established — never silently zero */
  unresolved: Unresolved[];
  /** non-fatal notes, e.g. a per-litre price with no known density */
  warnings: string[];
  error?: string;
}

export interface ComputeOptions {
  factor?: number;
  prefs?: MeasurementPrefs;
}
