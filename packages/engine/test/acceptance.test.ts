// The two acceptance criteria from RECIPE_NOTEBOOK_IMPLEMENTATION_SPEC.md §19
// that the prototype failed, stated as executable tests.

import { describe, expect, it } from 'vitest';
import {
  compute,
  convert,
  createCalibration,
  formatForUnit,
  parseLocal,
  scaleFactor,
  type Recipe,
} from '../src/index.js';
import { prefsWithCup } from './helpers.js';

describe('AC #2 — "2 cups of flour" shows grams with a "נתון מערכת" badge', () => {
  const prefs = prefsWithCup(240);

  it('shows the grams', () => {
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'g', prefs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.round(r.value)).toBe(240);
  });

  it('labels it "נתון מערכת" — not an arbitrary rounded number, not "מדויק"', () => {
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'g', prefs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.label).toBe('נתון מערכת');
    expect(r.provenance.color).toBe('#A56A0E');
    expect(r.provenance.exact).toBe(false);
    expect(r.provenance.why).toContain('50 גרם ל־100 מ"ל');
  });

  it('AC #3 — adding a personal calibration turns the same badge green', () => {
    const withCal = prefsWithCup(240, {
      calib: [createCalibration({ name: 'קמח', tool: 'cup', grams: 132 }, prefs)],
    });
    const r = convert({ name: 'קמח', qty: 2, unit: 'כוס' }, 'g', withCal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.label).toBe('כיול אישי');
    expect(Math.round(r.value)).toBe(264);
  });

  it('AC #4 — an ingredient with no density shows an explanation, not a number', () => {
    const r = convert({ name: 'אבקת מאצ׳ה סינית', qty: 2, unit: 'כוס' }, 'g', prefs);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toMatch(/אין נתון אמין/);
  });
});

describe('AC #5 — changing the cup from 240 to 250 changes ALL conversions at once', () => {
  const P240 = prefsWithCup(240);
  const P250 = prefsWithCup(250);

  const RECIPE: Recipe = {
    id: 'ac5',
    yieldUnits: 10,
    unitWeight: 50,
    targetFC: 25,
    ingredients: [
      { id: 'a', name: 'קמח לבן', qty: 2, unit: 'כוס', flour: true, price: 5.4, priceUnit: 'ק"ג' },
      { id: 'b', name: 'חלב', qty: 1, unit: 'כוס', liquid: true, price: 6.5, priceUnit: 'ליטר' },
    ],
    steps: [],
  };

  it('the conversion drawer', () => {
    const a = convert({ name: 'קמח לבן', qty: 2, unit: 'כוס' }, 'g', P240);
    const b = convert({ name: 'קמח לבן', qty: 2, unit: 'כוס' }, 'g', P250);
    expect(a.ok && b.ok && a.value !== b.value).toBe(true);
  });

  it('the ingredient table', () => {
    const a = compute(RECIPE, [RECIPE], { prefs: P240 });
    const b = compute(RECIPE, [RECIPE], { prefs: P250 });
    expect(b.rows[0]!.g!).toBeGreaterThan(a.rows[0]!.g!);
    expect(b.rows[1]!.g!).toBeGreaterThan(a.rows[1]!.g!);
  });

  it('the yield', () => {
    const a = compute(RECIPE, [RECIPE], { prefs: P240 });
    const b = compute(RECIPE, [RECIPE], { prefs: P250 });
    expect(b.totalG / a.totalG).toBeCloseTo(250 / 240, 9);
    expect(b.actualYield).toBeGreaterThan(a.actualYield);
  });

  it('the total cost of the batch', () => {
    const a = compute(RECIPE, [RECIPE], { prefs: P240 });
    const b = compute(RECIPE, [RECIPE], { prefs: P250 });
    expect(b.cost).toBeGreaterThan(a.cost);
    expect(b.cost / a.cost).toBeCloseTo(250 / 240, 9);
  });

  it('the declared unit count stays the baseline; the weighed count follows the cup', () => {
    // QA 22.09.2026 finding 3: a recipe that SAYS it makes 10 makes 10 — the
    // weights are a check on that statement (`unitsFromWeight`), not a
    // replacement for it. A bigger cup means a heavier batch, so the weights
    // now say "more than 10", and the cost of each of the 10 declared units
    // rises with the flour in it.
    const a = compute(RECIPE, [RECIPE], { prefs: P240 });
    const b = compute(RECIPE, [RECIPE], { prefs: P250 });
    expect(a.unitsActual).toBe(10);
    expect(b.unitsActual).toBe(10);
    expect(b.unitsFromWeight).toBeGreaterThan(a.unitsFromWeight);
    expect(b.costPerUnit).toBeGreaterThan(a.costPerUnit);
    expect(b.costPerKg).toBeCloseTo(a.costPerKg, 9);
  });

  it('half of the declared yield is exactly half the batch (QA finding 3)', () => {
    const base = compute(RECIPE, [RECIPE], { prefs: P240 });
    expect(scaleFactor('units', 5, base)).toBe(0.5);
    expect(scaleFactor('units', 20, base)).toBe(2);
    // The weighed count is still reported, and the disagreement is flagged.
    expect(base.unitsFromWeight).toBeGreaterThan(0);
  });

  it('the cost per unit and sale price, when the unit count is fixed', () => {
    // A recipe with a target unit count and no per-unit weight: the same 10
    // cupcakes now need a bigger cup of flour each, so each one costs more.
    const fixed: Recipe = { ...RECIPE, id: 'ac5-fixed', unitWeight: 0 };
    const a = compute(fixed, [fixed], { prefs: P240 });
    const b = compute(fixed, [fixed], { prefs: P250 });
    expect(a.unitsActual).toBe(10);
    expect(b.unitsActual).toBe(10);
    expect(b.costPerUnit).toBeGreaterThan(a.costPerUnit);
    expect(b.price).toBeGreaterThan(a.price);
  });

  it('the importer', () => {
    const text = 'עוגה\n2 כוסות קמח\n1 כוס חלב';
    const a = parseLocal(text, P240);
    const b = parseLocal(text, P250);
    expect(a.ingredients[0]!.qty).toBeCloseTo(240, 6);
    expect(b.ingredients[0]!.qty).toBeCloseTo(250, 6);
    expect(a.keptAsWritten).toEqual([]);
  });

  it('and a tablespoon setting moves independently of the cup', () => {
    const au = prefsWithCup(240, { tools: { cup: 240, tbsp: 20, tsp: 5 } });
    const a = convert({ name: 'קמח לבן', qty: 1, unit: 'כף' }, 'g', P240);
    const b = convert({ name: 'קמח לבן', qty: 1, unit: 'כף' }, 'g', au);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toBeCloseTo(7.5, 6);
    expect(b.value).toBeCloseTo(10, 6);
  });
});

describe('the importer refuses to invent a weight (spec §5.1 rule 5)', () => {
  it('keeps an unknown cup ingredient in cups instead of guessing 150 g', () => {
    const p = parseLocal('עוגה\n1 כוס אבקת מאצ׳ה סינית', prefsWithCup(240));
    expect(p.ingredients[0]!.unit).toBe('כוס');
    expect(p.ingredients[0]!.qty).toBe(1);
    expect(p.keptAsWritten).toHaveLength(1);
    expect(p.keptAsWritten[0]!.reason).toContain('אין נתון צפיפות אמין');
  });

  it('still records the original wording for lines it did convert', () => {
    const p = parseLocal('1 1/2 כוסות סוכר', prefsWithCup(240));
    expect(p.ingredients[0]!.note).toBe('במקור 1.5 כוס');
    expect(p.ingredients[0]!.qty).toBeCloseTo(298.8, 1);
  });
});

describe('spec §5.2 formatting', () => {
  it('cups round to quarters', () => {
    expect(formatForUnit(1.24, 'cup')).toBe('1 ¼ כוסות');
    expect(formatForUnit(0.5, 'cup')).toBe('½ כוס');
    expect(formatForUnit(1, 'cup')).toBe('1 כוס');
  });

  it('spoons round to halves, as the spec asks', () => {
    expect(formatForUnit(1.5, 'tbsp')).toBe('1 ½ כפות');
    expect(formatForUnit(1.3, 'tbsp')).toBe('1 ½ כפות');
    expect(formatForUnit(1.1, 'tsp')).toBe('1 כפית');
  });

  it('a sliver of a cup says so instead of showing "0 כוס"', () => {
    expect(formatForUnit(0.05, 'cup')).toBe('פחות מרבע כוס');
  });

  it('count plurals are grammatical Hebrew', () => {
    expect(formatForUnit(1, 'egg')).toBe('1 ביצה');
    expect(formatForUnit(2, 'egg')).toBe('2 ביצים');
    expect(formatForUnit(3, 'slice')).toBe('3 פרוסות');
  });
});
