// Food cost (stage-7 requirements 4 and 8).
//
// The rule under test throughout: a figure is shown only when its inputs are
// known, `null` means unknown, and 0 means zero. The two must never render as
// the same thing, and a food cost from a partial cost must not be shown at all.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { calcState } from '../recipe/completeness.js';
import { resolveFromCatalog, type CatalogItem } from './catalog.js';
import type { PriceUnit } from '../../lib/database.types.js';
import { foodCost } from './foodCost.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const priced = (key: string, price: number, unit: PriceUnit = 'ק"ג'): CatalogItem => ({
  id: key, key, name: key, purchaseUnit: 'kg', packageQty: 1, packageCount: 1,
  purchaseTotal: price, usablePct: null, supplier: '', purchasedAt: null,
  priceUpdatedAt: null, note: '', purchasePrice: price, price, priceUnit: unit,
  allergens: [],
});

/** 1 kg of dough: 500 g flour at ₪5/kg + 500 g water at ₪0/l. */
const dough = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r',
    name: 'בצק',
    yieldUnits: 2,
    unitWeight: 500,
    ingredients: [
      { id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', flour: true },
      { id: 'i2', name: 'מים', qty: 500, unit: 'g', liquid: true },
    ],
    steps: [],
    ...over,
  }) as Recipe;

const catalog = [priced('קמח לבן', 5), priced('מים', 0)];

const run = (recipe: Recipe, cat: CatalogItem[] = catalog) => {
  const r = resolveFromCatalog(recipe, cat);
  const c = compute(r, [r], { prefs });
  return foodCost(r, c, calcState(c));
};

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 4 — the figures', () => {
  it('gives the total ingredient cost', () => {
    // 500 g at ₪5/kg = ₪2.50, plus 500 g of free water
    expect(run(dough()).cost).toBeCloseTo(2.5, 6);
  });

  it('gives the cost per kilogram when the yield is known', () => {
    // a 1000 g batch costing ₪2.50 is ₪2.50/kg
    expect(run(dough()).costPerKg).toBeCloseTo(2.5, 6);
  });

  it('gives the cost per unit when the recipe yields units', () => {
    // 2 units of 500 g: ₪1.25 each
    expect(run(dough()).costPerUnit).toBeCloseTo(1.25, 6);
  });

  it('gives no cost per unit when there is no unit yield', () => {
    const noUnits = dough({ yieldUnits: 0, unitWeight: 0 });
    expect(run(noUnits).costPerUnit).toBeNull();
    // ...but the per-kilo figure still means something
    expect(run(noUnits).costPerKg).toBeCloseTo(2.5, 6);
  });

  it('computes the food cost from the sale price the user set', () => {
    // ₪2.50 cost against a ₪10 sale price is 25%
    const fc = run(dough({ salePrice: 10 } as never));
    expect(fc.salePrice).toBe(10);
    expect(fc.percent).toBeCloseTo(25, 6);
    expect(fc.why).toBe('');
  });

  it('is cost ÷ sale price × 100 and not the engine\'s target-based suggestion', () => {
    // `targetFC` drives a SUGGESTED price and must not be mistaken for the
    // measured food cost. Here the target says 30% and the truth is 25%.
    const fc = run(dough({ salePrice: 10, targetFC: 30 } as never));
    expect(fc.percent).toBeCloseTo(25, 6);
  });
});

describe('requirement 4 — when a figure must NOT be shown', () => {
  it('withholds everything when nothing is priced', () => {
    const fc = run(dough(), []);
    expect(fc.cost).toBeNull();
    expect(fc.costPerKg).toBeNull();
    expect(fc.costPerUnit).toBeNull();
    expect(fc.percent).toBeNull();
    expect(fc.why).toContain('אין מחיר לאף חומר גלם');
  });

  it('withholds the PERCENTAGE when the cost is only partial', () => {
    // The most consequential case. A food cost from a cost that is missing an
    // ingredient is always too low, and too low is the direction that loses
    // money — so the figures may be shown, marked, and the ratio may not.
    const fc = run(dough({ salePrice: 10 } as never), [priced('קמח לבן', 5)]);
    expect(fc.partial).toBe(true);
    expect(fc.cost).toBeCloseTo(2.5, 6);
    expect(fc.percent).toBeNull();
    expect(fc.why).toContain('חלקית');
  });

  it('withholds it when the user has not set a sale price', () => {
    const fc = run(dough());
    expect(fc.salePrice).toBeNull();
    expect(fc.percent).toBeNull();
    expect(fc.why).toContain('לא הוגדר מחיר מכירה');
  });

  it('withholds it when the sale price is 0, which is not 0%', () => {
    // Giving something away is a real decision. The food cost of it is not
    // zero and not a hundred — it does not exist, because the division does not.
    const fc = run(dough({ salePrice: 0 } as never));
    expect(fc.salePrice).toBe(0);
    expect(fc.percent).toBeNull();
    expect(fc.why).toContain('חילוק באפס');
  });

  it('distinguishes "no sale price" from "a sale price of 0"', () => {
    const none = run(dough());
    const free = run(dough({ salePrice: 0 } as never));
    expect(none.salePrice).toBeNull();
    expect(free.salePrice).toBe(0);
    expect(none.why).not.toBe(free.why);
  });

  it('a cost of 0 is a real cost and does not read as unknown', () => {
    // Everything in the recipe is priced, at zero. There IS a cost, and it is 0.
    const water = dough({
      salePrice: 10,
      ingredients: [{ id: 'i2', name: 'מים', qty: 500, unit: 'g', liquid: true }],
    } as never);
    const fc = run(water, [priced('מים', 0)]);
    expect(fc.cost).toBe(0);
    expect(fc.percent).toBe(0);
    expect(fc.why).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a price change across several recipes and levels', () => {
  const GANACHE: Recipe = {
    id: 'ganache', name: 'גנאש', isSub: true,
    ingredients: [
      { id: 'g1', name: 'שוקולד מריר', qty: 200, unit: 'g' },
      { id: 'g2', name: 'שמנת', qty: 100, unit: 'g' },
    ],
    steps: [],
  } as unknown as Recipe;

  const FILLING: Recipe = {
    id: 'filling', name: 'מילוי', isSub: true,
    ingredients: [
      { id: 'f1', name: 'גנאש', qty: 150, unit: 'g', subId: 'ganache' },
      { id: 'f2', name: 'חמאה 82%', qty: 50, unit: 'g' },
    ],
    steps: [],
  } as unknown as Recipe;

  const CAKE: Recipe = {
    id: 'cake', name: 'עוגה',
    ingredients: [
      { id: 'c1', name: 'קמח לבן', qty: 300, unit: 'g', flour: true },
      { id: 'c2', name: 'מילוי', qty: 100, unit: 'g', subId: 'filling' },
    ],
    steps: [],
  } as unknown as Recipe;

  const cat = [
    priced('שוקולד מריר', 60), priced('שמנת', 12, 'ליטר'),
    priced('חמאה 82%', 40), priced('קמח לבן', 5),
  ];

  const costOf = (r: Recipe, c: CatalogItem[]) => {
    const notebook = [GANACHE, FILLING, CAKE].map((x) => resolveFromCatalog(x, c));
    const self = resolveFromCatalog(r, c);
    return compute(self, notebook, { prefs }).cost;
  };

  it('a central price reaches three levels up', () => {
    // The chocolate is two levels below the cake, and its price is only in the
    // centre. If the notebook were not resolved as well, the cake's ganache
    // line would contribute nothing.
    expect(costOf(CAKE, cat)).toBeGreaterThan(1.5);
  });

  it('raising the price at the bottom raises the cost at the top', () => {
    const dearer = cat.map((c) =>
      c.key === 'שוקולד מריר' ? priced('שוקולד מריר', 120) : c,
    );
    expect(costOf(CAKE, dearer)).toBeGreaterThan(costOf(CAKE, cat));
    // and by the right amount: the chocolate doubled, and it reaches the cake
    // through two pro-rata divisions
    const delta = costOf(CAKE, dearer) - costOf(CAKE, cat);
    // 200 g of chocolate at +₪60/kg = +₪12 on a 300 g ganache batch;
    // 150/300 of that into a 200 g filling, then 100/200 of that into the cake
    expect(delta).toBeCloseTo(12 * (150 / 300) * (100 / 200), 6);
  });

  it('a material missing from the centre makes every level partial', () => {
    const missing = cat.filter((c) => c.key !== 'שוקולד מריר');
    for (const r of [GANACHE, FILLING, CAKE]) {
      const notebook = [GANACHE, FILLING, CAKE].map((x) => resolveFromCatalog(x, missing));
      const self = resolveFromCatalog(r, missing);
      const c = compute(self, notebook, { prefs });
      expect(calcState(c).costLevel).toBe('partial');
      // and no food cost is offered from a partial cost, at any level
      expect(foodCost(self, c, calcState(c)).percent).toBeNull();
    }
  });

  it('and names the path to the missing material from the top', () => {
    const missing = cat.filter((c) => c.key !== 'שוקולד מריר');
    const notebook = [GANACHE, FILLING, CAKE].map((x) => resolveFromCatalog(x, missing));
    const cake = resolveFromCatalog(CAKE, missing);
    expect(calcState(compute(cake, notebook, { prefs })).unpricedNames).toEqual([
      'מילוי → גנאש → שוקולד מריר',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('units, end to end through the centre', () => {
  const eggs = (over: Partial<CatalogItem> = {}): CatalogItem => ({
    id: 'e', key: 'ביצים', name: 'ביצים L', purchaseUnit: 'unit',
    packageQty: 30, packageCount: 1, purchaseTotal: 39, usablePct: null,
    supplier: '', purchasedAt: null, priceUpdatedAt: null, note: '',
    purchasePrice: 1.3, price: 1.3, priceUnit: "יח'", allergens: ['ביצים'], ...over,
  });

  it('a tray of 30 eggs at 39 costs 3 eggs at 3.90', () => {
    const r = {
      id: 'r',
      ingredients: [{ id: 'i1', name: 'ביצים', qty: 3, unit: 'unit', unitWeight: 55 }],
      steps: [],
    } as unknown as Recipe;
    const res = resolveFromCatalog(r, [eggs()]);
    expect(compute(res, [res], { prefs }).cost).toBeCloseTo(3.9, 6);
  });

  it('and without an item weight it reports that it cannot, rather than costing 0', () => {
    const r = {
      id: 'r',
      ingredients: [{ id: 'i1', name: 'ביצים', qty: 165, unit: 'g' }],
      steps: [],
    } as unknown as Recipe;
    const res = resolveFromCatalog(r, [eggs()]);
    const c = compute(res, [res], { prefs });
    expect(c.cost).toBe(0);
    expect(calcState(c).costLevel).toBe('none');
    expect(foodCost(res, c, calcState(c)).cost).toBeNull();
  });

  it('a per-litre central price converts through density', () => {
    const r = {
      id: 'r',
      ingredients: [{ id: 'i1', name: 'חלב 3%', qty: 500, unit: 'ml', liquid: true }],
      steps: [],
    } as unknown as Recipe;
    const res = resolveFromCatalog(r, [priced('חלב 3%', 6, 'ליטר')]);
    const c = compute(res, [res], { prefs });
    // half a litre of milk at ₪6/l is about ₪3 — via the density table, not
    // by assuming 1 g/ml
    expect(c.cost).toBeGreaterThan(2.7);
    expect(c.cost).toBeLessThan(3.3);
  });
});
