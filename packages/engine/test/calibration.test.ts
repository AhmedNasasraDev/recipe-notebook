import { describe, expect, it } from 'vitest';
import {
  calibrationGPer100,
  convert,
  createCalibration,
  densityFor,
  findCalibration,
  ingredientKeyOf,
  normalizeCalibration,
  sameIngredient,
  suggestCalibrations,
  toGrams,
  upsertCalibration,
} from '../src/index.js';
import { prefsWithCup } from './helpers.js';

const P240 = prefsWithCup(240);

const FLOUR_CAL = createCalibration(
  { name: 'קמח לחם 13% חלבון', tool: 'cup', grams: 132, at: '2026-01-01' },
  P240,
);

describe('personal calibration takes precedence (spec §5.1)', () => {
  const prefs = prefsWithCup(240, { calib: [FLOUR_CAL] });

  it('overrides the system table', () => {
    const d = densityFor({ name: 'קמח לחם 13% חלבון' }, prefs, 'cup');
    expect(d?.source).toBe('personal');
    expect(d?.gPer100).toBeCloseTo(55, 6);
  });

  it('2 cups becomes 264 g instead of 240 g', () => {
    const r = convert(
      { name: 'קמח לחם 13% חלבון', qty: 2, unit: 'cup' },
      'g',
      prefs,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(264, 6);
    expect(r.provenance.label).toBe('כיול אישי');
    expect(r.provenance.exact).toBe(true);
  });

  it('a recipe-level gPer100 does NOT beat a personal calibration', () => {
    const d = densityFor(
      { name: 'קמח לחם 13% חלבון', gPer100: 58 },
      prefs,
      'cup',
    );
    expect(d?.source).toBe('personal');
  });

  it('with no calibration, a recipe-level gPer100 beats the table', () => {
    const d = densityFor({ name: 'קמח לבן', gPer100: 58 }, P240, 'cup');
    expect(d?.source).toBe('recipe');
    expect(d?.gPer100).toBe(58);
  });

  it('a cup calibration is valid for a tablespoon, and says so', () => {
    const d = densityFor({ name: 'קמח לחם 13% חלבון' }, prefs, 'tbsp');
    expect(d?.source).toBe('personal');
    expect(d?.gPer100).toBeCloseTo(55, 6);
    expect(d?.note).toContain('נגזר מהכיול של כוס');
  });
});

describe('B4 — "קמח" must never answer for "קמח שקדים"', () => {
  const prefs = prefsWithCup(240, {
    calib: [createCalibration({ name: 'קמח', tool: 'cup', grams: 120 }, P240)],
  });

  it('the calibration is not applied to almond flour', () => {
    const hit = findCalibration({ name: 'קמח שקדים' }, prefs, 'cup');
    expect(hit).toBeNull();
  });

  it('almond flour gets no density at all, so no number is shown', () => {
    const d = densityFor({ name: 'קמח שקדים' }, prefs, 'cup');
    expect(d).toBeNull();
    const r = convert({ name: 'קמח שקדים', qty: 1, unit: 'cup' }, 'g', prefs);
    expect(r.ok).toBe(false);
  });

  it('the table itself also refuses to answer for non-wheat flours', () => {
    for (const n of [
      'קמח שקדים', 'קמח קוקוס', 'קמח חומוס', 'קמח אורז', 'קמח תירס',
      'קמח כוסמת', 'קמח סויה', 'אבקת חלב',
    ]) {
      expect(
        densityFor({ name: n }, prefsWithCup(240), 'cup'),
        `"${n}" must not resolve`,
      ).toBeNull();
    }
  });

  it('a known data gap is still answerable by the USER, on purpose', () => {
    // refusing the table's guess must not block the user's own measurement
    const own = prefsWithCup(240, {
      calib: [createCalibration({ name: 'קמח שקדים', tool: 'cup', grams: 96 }, P240)],
    });
    const d = densityFor({ name: 'קמח שקדים' }, own, 'cup');
    expect(d?.source).toBe('personal');
    expect(d?.gPer100).toBeCloseTo(40, 6);
    // and a value typed into the recipe works too
    const r = densityFor({ name: 'קמח שקדים', gPer100: 40 }, prefsWithCup(240), 'cup');
    expect(r?.source).toBe('recipe');
  });

  it('plain wheat flour is still resolved normally', () => {
    // no calibration in these prefs → falls through to the shared table
    const d = densityFor({ name: 'קמח' }, prefsWithCup(240), 'cup');
    expect(d?.source).toBe('system');
    expect(d?.gPer100).toBe(50);
    // and with the "קמח" calibration present it IS applied to plain flour
    const withCal = densityFor({ name: 'קמח' }, prefs, 'cup');
    expect(withCal?.source).toBe('personal');
  });

  it('the near-miss is OFFERED for explicit attachment, never auto-applied', () => {
    const s = suggestCalibrations({ name: 'קמח שקדים' }, prefs);
    expect(s).toHaveLength(1);
    expect(s[0]?.calib.name).toBe('קמח');
    expect(s[0]?.reason).toContain('לא הוחל אוטומטית');
  });

  it('identity is exact, normalised, and not a substring test', () => {
    expect(sameIngredient({ name: 'קמח' }, { name: ' קמח ' })).toBe(true);
    expect(sameIngredient({ name: 'קמח' }, { name: 'קמח שקדים' })).toBe(false);
    expect(sameIngredient({ name: "מלנג'" }, { name: 'מלנג׳' })).toBe(true);
    expect(ingredientKeyOf({ name: 'קמח לחם  13%  חלבון' })).toBe(
      'קמח לחם 13% חלבון',
    );
  });

  it('an explicit ingredientKey wins over the name', () => {
    const cal = createCalibration(
      { name: 'שם שונה לגמרי', ingredientKey: 'flour.bread.13', tool: 'cup', grams: 132 },
      P240,
    );
    const prefs2 = prefsWithCup(240, { calib: [cal] });
    const hit = findCalibration(
      { name: 'קמח לחם', ingredientKey: 'flour.bread.13' },
      prefs2,
      'cup',
    );
    expect(hit?.source).toBe('personal');
  });
});

describe('B5 — changing the cup size must not rewrite past calibrations', () => {
  it('freezes the tool volume at calibration time', () => {
    expect(FLOUR_CAL.toolMl).toBe(240);
    expect(calibrationGPer100(FLOUR_CAL)).toBeCloseTo(55, 6);
  });

  it('a later switch to a 250 ml cup leaves the historical calibration intact', () => {
    const before = prefsWithCup(240, { calib: [FLOUR_CAL] });
    const after = prefsWithCup(250, { calib: [FLOUR_CAL] });
    const dBefore = densityFor({ name: FLOUR_CAL.name }, before, 'cup');
    const dAfter = densityFor({ name: FLOUR_CAL.name }, after, 'cup');
    expect(dBefore?.gPer100).toBeCloseTo(55, 6);
    expect(dAfter?.gPer100).toBeCloseTo(55, 6);
    // the legacy code recomputed 132/250*100 = 52.8 here
    expect(dAfter?.gPer100).not.toBeCloseTo(52.8, 3);
  });

  it('a new cup size still changes how much a cup HOLDS, as it should', () => {
    const after = prefsWithCup(250, { calib: [FLOUR_CAL] });
    const g = toGrams({ name: FLOUR_CAL.name, qty: 1, unit: 'כוס' }, after);
    // one 250 ml cup of a 55 g/100 ml ingredient
    expect(g.grams).toBeCloseTo(137.5, 6);
  });

  it('a legacy record with no toolMl is migrated and flagged, not reinterpreted', () => {
    const migrated = normalizeCalibration({
      name: 'קמח לחם 13% חלבון',
      tool: 'cup',
      grams: 132,
    });
    expect(migrated?.toolMl).toBe(240);
    expect(migrated?.toolMlAssumed).toBe(true);
    const prefs = prefsWithCup(295.7, { calib: [migrated!] });
    const d = densityFor({ name: migrated!.name }, prefs, 'cup');
    expect(d?.gPer100).toBeCloseTo(55, 6);
    expect(d?.needsReview).toBe(true);
    expect(d?.note).toContain('כדאי לאמת');
  });

  it('upsert keeps one calibration per ingredient per tool', () => {
    const a = createCalibration({ name: 'קמח', tool: 'cup', grams: 120 }, P240);
    const b = createCalibration({ name: 'קמח', tool: 'cup', grams: 128 }, P240);
    const c = createCalibration({ name: 'קמח', tool: 'tbsp', grams: 8 }, P240);
    let list = upsertCalibration([], a);
    list = upsertCalibration(list, b);
    list = upsertCalibration(list, c);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.tool === 'cup')?.grams).toBe(128);
  });

  it('rejects a calibration with no grams', () => {
    expect(() =>
      createCalibration({ name: 'קמח', tool: 'cup', grams: 0 }, P240),
    ).toThrow();
  });
});
