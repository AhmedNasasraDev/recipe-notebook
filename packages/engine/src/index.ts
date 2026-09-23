// @recipe-notebook/engine — unified calculation engine.
//
// One density source, one conversion path, full provenance, stable ingredient
// identity for calibration. See README.md for the before/after map and
// CONFLICTS.md for every legacy disagreement this merge surfaced.

export type * from './types.js';

// data — the single source of truth
export {
  DENSITY_TABLE,
  CONFLICT_TOLERANCE_PCT,
  LEGACY_CUP_ML,
  KNOWN_DATA_GAPS,
  densityEntryByKey,
  gramsPerCup,
  isKnownDataGap,
  lookupDensity,
  unvaluedEntries,
  valuedEntries,
  type DensityEntry,
  type LegacySource,
  type Resolution,
} from './data/density-table.js';
export {
  ACCEPTED,
  ACCEPTED_SINGLE_SOURCE,
  DENSITY_CONFLICTS,
  FALLBACK_DIVERGENCES,
  KNOWN_GAPS,
  LEGACY_INVENTED_FALLBACKS,
  PENDING_FORM,
  PENDING_VERIFICATION,
  SPLIT_TABLE_ERRORS,
  SUSPECT_TERMS,
  conflictSummary,
  type DensityConflict,
  type FallbackDivergence,
} from './data/density-conflicts.js';
export {
  ALLERGEN_TABLE,
  allergensFor,
} from './data/allergens.js';
export {
  WATER_TABLE,
  WATER_PCT_FALLBACK,
  lookupWaterPct,
} from './data/water.js';

// units and tools
export {
  LEGACY_UNIT_NAMES,
  TOOL_DEFAULTS,
  TOOL_OPTIONS,
  UNITS,
  gPerUnit,
  mlPerUnit,
  toolLabel,
  toolMl,
  unit,
  unitGroup,
  unitId,
  unitLabel,
} from './units.js';

// identity, calibration, density
export {
  ingredientKeyOf,
  normalizeName,
  sameIngredient,
} from './text.js';
export {
  calibrationGPer100,
  createCalibration,
  findCalibration,
  normalizeCalibration,
  normalizeCalibrations,
  suggestCalibrations,
  upsertCalibration,
  type CalibrationInput,
} from './calibration.js';
export {
  NO_DENSITY_MESSAGE,
  densityFor,
  densityUnavailableReason,
} from './density.js';

// provenance
export {
  SOURCE_META,
  buildProvenance,
  extendProvenance,
  unavailableProvenance,
  weakest,
} from './provenance.js';

// conversion
export { convert, convertScaled, gramsPerItem, homeMeasure, toGrams } from './convert.js';

// formatting
export {
  formatForUnit,
  formatGrams,
  formatNis,
  round1,
} from './format.js';

// recipe computation
export { compute, scaleFactor, waterPctOf } from './compute.js';

// profiles
export {
  PROFILES,
  UNIT_GROUPS,
  defaultPrefs,
  preferredUnit,
  type ProfileDef,
} from './profiles.js';

// parsing
export {
  GN,
  GN_SIZES,
  PAN_KINDS,
  PAN_SUGGEST_THRESHOLD,
  panArea,
  panFactor,
  panIsEmpty,
  panKindLabel,
  panLabel,
  panWorthAdapting,
  type PanComparison,
  type PanKindDef,
} from './pan.js';
export {
  SMART_PARSE_PROMPT,
  parseLocal,
  parseQuantity,
  parseTemp,
  parseTime,
  type ParsedRecipe,
} from './parse.js';
