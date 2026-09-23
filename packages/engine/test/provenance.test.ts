import { describe, expect, it } from 'vitest';
import {
  SOURCE_META,
  convert,
  convertScaled,
  createCalibration,
  homeMeasure,
  weakest,
} from '../src/index.js';
import { prefsWithCup } from './helpers.js';

const P240 = prefsWithCup(240);

describe('B3 — an estimate can never surface as exact', () => {
  it('the weakest link decides the label', () => {
    expect(weakest(['exact', 'system'])).toBe('system');
    expect(weakest(['exact', 'personal'])).toBe('personal');
    expect(weakest(['system', 'estimate'])).toBe('estimate');
    expect(weakest(['exact', 'exact'])).toBe('exact');
    expect(weakest(['estimate', 'unavailable'])).toBe('unavailable');
  });

  it('only exact, personal and recipe are allowed to claim exactness', () => {
    expect(SOURCE_META.exact.exact).toBe(true);
    expect(SOURCE_META.personal.exact).toBe(true);
    expect(SOURCE_META.recipe.exact).toBe(true);
    expect(SOURCE_META.system.exact).toBe(false);
    expect(SOURCE_META.estimate.exact).toBe(false);
    expect(SOURCE_META.unavailable.exact).toBe(false);
  });

  it('THE REGRESSION: a cup ingredient shown in grams is "נתון מערכת", not "המרה מדויקת"', () => {
    // This is the exact scenario the prototype got wrong: the recipe stores
    // "2 כוס קמח", the screen shows 240 g, the user opens the drawer and asks
    // for grams. The old code answered "המרה מדויקת" because it had already
    // thrown the cup away.
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(240, 6);
    expect(r.provenance.source).toBe('system');
    expect(r.provenance.label).toBe('נתון מערכת');
    expect(r.provenance.exact).toBe(false);
    expect(r.provenance.label).not.toBe('המרה מדויקת');
  });

  it('a genuine weight-to-weight conversion is still exact', () => {
    const r = convert({ name: 'קמח', qty: 500, unit: 'גרם' }, 'kg', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.source).toBe('exact');
    expect(r.provenance.exact).toBe(true);
  });

  it('the original quantity and unit travel with the result', () => {
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'g', P240);
    expect(r.original.qty).toBe(2);
    expect(r.original.unit).toBe('כוס');
    expect(r.original.label).toBe('2 כוס');
  });

  it('scaling does not overwrite what the recipe says', () => {
    const r = convertScaled({ name: 'קמח', qty: 2, unit: 'כוס' }, 2.5, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(600, 6); // 5 cups
    expect(r.original.qty).toBe(2); // still "2 כוס" in the recipe
    expect(r.original.unit).toBe('כוס');
    expect(r.provenance.source).toBe('system'); // still not "exact"
  });

  it('a chain through two densities keeps the weaker of the two', () => {
    // ground coffee is an estimate row; g → cup goes through it
    const r = convert({ name: 'קפה טחון', qty: 100, unit: 'גרם' }, 'cup', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.source).toBe('estimate');
    expect(r.provenance.exact).toBe(false);
  });

  it('the full audit trail is available, not just the badge', () => {
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'oz', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.chain).toHaveLength(2);
    expect(r.provenance.chain[0]).toMatchObject({
      from: 'cup',
      to: 'g',
      source: 'system',
      gPer100: 50,
      densityKey: 'flour.white',
    });
    expect(r.provenance.chain[1]).toMatchObject({ from: 'g', to: 'oz', source: 'exact' });
  });

  it('a personal calibration in the chain reads as personal, end to end', () => {
    const prefs = prefsWithCup(240, {
      calib: [createCalibration({ name: 'קמח', tool: 'cup', grams: 132 }, P240)],
    });
    const r = convert({ name: 'קמח', qty: 1, unit: 'כוס' }, 'oz', prefs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.source).toBe('personal');
    expect(r.provenance.exact).toBe(true);
  });

  it('the unavailable case carries a provenance too, so the UI never guesses', () => {
    const r = convert({ name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(false);
    expect(r.provenance.source).toBe('unavailable');
    expect(r.provenance.exact).toBe(false);
    expect(r.provenance.confidence).toBe('none');
  });

  it('a reviewed table row propagates needsReview to the caller', () => {
    // ground coffee: one uncontradicted source, value in use, flagged
    const r = convert({ name: 'קפה טחון', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(true);
    expect(r.provenance.needsReview).toBe(true);
    expect(r.provenance.source).toBe('estimate');
  });

  it('a row with no value at all is refused, with its own explanation', () => {
    const r = convert({ name: 'שקדים', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toContain('נמדד אחרת בכל צורה');
    expect(r.provenance.source).toBe('unavailable');
    expect(r.provenance.exact).toBe(false);
  });
});

describe('home-measure view keeps the honest badge', () => {
  it('renders a gram ingredient in cups with the table badge', () => {
    const r = homeMeasure({ name: 'קמח', qty: 500, unit: 'גרם' }, 1, P240);
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.provenance.source).toBe('system');
    expect(r.text).toContain('כוס');
  });

  it('returns null when there is no reliable data, so the UI can stay in grams', () => {
    expect(homeMeasure({ name: 'אבקת מאצ׳ה', qty: 500, unit: 'גרם' }, 1, P240)).toBeNull();
  });
});
