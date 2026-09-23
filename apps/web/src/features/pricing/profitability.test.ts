// Stage-8 requirements E, F, G and H: the full cost, the profit, and the price
// a target implies.
//
// The two mistakes these tests exist to prevent:
//
//  1. A COST THAT LOOKS FINISHED AND IS NOT. If one ingredient has no price,
//     there is no total, no profit and no margin — only a partial ingredient
//     cost, marked. A margin from an understated cost is flattering and wrong.
//  2. MARGIN READ AS MARKUP. A ₪100 item costing ₪40 has a 60% margin and a
//     150% markup. Both are asserted here, by name, on the same numbers.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { calcState } from '../recipe/completeness.js';
import { resolveFromCatalog, type CatalogItem } from './catalog.js';
import { costing } from './profitability.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const priced = (key: string, price: number): CatalogItem => ({
  id: key,
  key,
  name: key,
  purchaseUnit: 'kg',
  packageQty: 1,
  packageCount: 1,
  purchaseTotal: price,
  usablePct: null,
  supplier: '',
  purchasedAt: null,
  priceUpdatedAt: null,
  note: '',
  purchasePrice: price,
  price,
  priceUnit: 'ק"ג',
  allergens: [],
});

/** 1 kg of dough in 2 units of 500 g. Flour at ₪5/kg, water free. */
const cake = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r',
    name: 'עוגה',
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
  return costing(r, c, calcState(c));
};

// ───────────────────────────────────────────────────────────────────────────
describe('requirement E — the cost in its parts, never invented', () => {
  it('separates ingredients, packaging, labour and other', () => {
    const { breakdown } = run(
      cake({ packagingCost: 1.5, laborCost: 6, otherCost: 0.5 } as Partial<Recipe>),
    );
    expect(breakdown.ingredients).toBeCloseTo(2.5, 6);
    expect(breakdown.packaging).toBe(1.5);
    expect(breakdown.labor).toBe(6);
    expect(breakdown.other).toBe(0.5);
    expect(breakdown.total).toBeCloseTo(10.5, 6);
    expect(breakdown.notEntered).toEqual([]);
  });

  it('leaves an unentered part NULL and says which parts they are', () => {
    const { breakdown } = run(cake({ packagingCost: 1.5 } as Partial<Recipe>));
    expect(breakdown.packaging).toBe(1.5);
    expect(breakdown.labor).toBeNull();
    expect(breakdown.other).toBeNull();
    // The total sums what was entered, and the screen is told what it omits.
    expect(breakdown.total).toBeCloseTo(4, 6);
    expect(breakdown.notEntered).toEqual(['עבודה', 'עלויות נוספות']);
  });

  it('keeps an entered 0 apart from an unentered field', () => {
    const { breakdown } = run(
      cake({ packagingCost: 0, laborCost: 0, otherCost: 0 } as Partial<Recipe>),
    );
    // "There is no packaging cost" is a fact; "nobody said" is not.
    expect(breakdown.packaging).toBe(0);
    expect(breakdown.notEntered).toEqual([]);
    expect(breakdown.total).toBeCloseTo(2.5, 6);
  });

  it('invents nothing for rent, electricity or overhead', () => {
    const { breakdown } = run(cake());
    // Nothing appears that the user did not enter.
    expect(breakdown.total).toBeCloseTo(2.5, 6);
    expect(breakdown.packaging).toBeNull();
    expect(breakdown.labor).toBeNull();
    expect(breakdown.other).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement H — a partial cost is never a total', () => {
  const partial = [priced('קמח לבן', 5)]; // the water has no price at all

  it('withholds the total, the profit and the margin', () => {
    const { breakdown, profit } = run(
      cake({ salePrice: 20, packagingCost: 1 } as Partial<Recipe>),
      partial,
    );
    expect(breakdown.partial).toBe(true);
    expect(breakdown.total).toBeNull();
    expect(profit.profit).toBeNull();
    expect(profit.grossMargin).toBeNull();
    expect(profit.markup).toBeNull();
    expect(profit.why).toContain('חלקית');
  });

  it('still reports the partial ingredient cost, marked', () => {
    const { fc, breakdown } = run(cake({ salePrice: 20 } as Partial<Recipe>), partial);
    expect(breakdown.ingredients).toBeCloseTo(2.5, 6);
    expect(fc.partial).toBe(true);
  });

  it('withholds everything when nothing is priced', () => {
    const { breakdown, profit } = run(cake({ salePrice: 20 } as Partial<Recipe>), []);
    expect(breakdown.ingredients).toBeNull();
    expect(breakdown.total).toBeNull();
    expect(profit.profit).toBeNull();
    expect(profit.why).toContain('אין עלות חומרי גלם');
  });

  it('follows a missing price down through nested sub-recipes', () => {
    // A cake whose filling contains a chocolate nobody has priced. The gap is
    // two levels down, and the top-level total must still refuse to exist.
    const chocolate: Recipe = {
      id: 'choc',
      name: 'גנאש',
      isSub: true,
      ingredients: [{ id: 'c1', name: 'שוקולד', qty: 100, unit: 'g' }],
      steps: [],
    } as Recipe;
    const filling: Recipe = {
      id: 'fill',
      name: 'מלית',
      isSub: true,
      ingredients: [
        { id: 'f1', name: 'גנאש', qty: 100, unit: 'g', subId: 'choc' },
        { id: 'f2', name: 'קמח לבן', qty: 100, unit: 'g' },
      ],
      steps: [],
    } as Recipe;
    const top: Recipe = {
      id: 'top',
      name: 'עוגה',
      yieldUnits: 1,
      unitWeight: 200,
      salePrice: 50,
      ingredients: [{ id: 't1', name: 'מלית', qty: 200, unit: 'g', subId: 'fill' }],
      steps: [],
    } as unknown as Recipe;

    const all = [top, filling, chocolate].map((r) => resolveFromCatalog(r, catalog));
    const c = compute(all[0]!, all, { prefs });
    const { breakdown, profit } = costing(all[0]!, c, calcState(c));

    expect(breakdown.partial).toBe(true);
    expect(breakdown.total).toBeNull();
    expect(profit.grossMargin).toBeNull();

    // The positive control, without which the assertions above would pass on
    // a sub-recipe tree that can NEVER produce a total: price the chocolate
    // two levels down and the same tree must cost, and earn, a real number.
    const withChoc = [...catalog, priced('שוקולד', 60)];
    const fixed = [top, filling, chocolate].map((r) => resolveFromCatalog(r, withChoc));
    const c2 = compute(fixed[0]!, fixed, { prefs });
    const done = costing(fixed[0]!, c2, calcState(c2));
    expect(done.breakdown.partial).toBe(false);
    expect(done.breakdown.total).toBeGreaterThan(0);
    expect(done.profit.grossMargin).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement F — profit, margin, food cost and markup', () => {
  // A batch costing ₪40 in total, sold for ₪100. The textbook numbers.
  const textbook = () =>
    run(
      cake({
        salePrice: 100,
        packagingCost: 7.5,
        laborCost: 30,
        otherCost: 0,
      } as Partial<Recipe>),
    );

  it('gives the money profit', () => {
    expect(textbook().profit.profit).toBeCloseTo(60, 6);
  });

  it('gives a gross margin of 60% — over the PRICE', () => {
    expect(textbook().profit.grossMargin).toBeCloseTo(60, 6);
  });

  it('gives a markup of 150% — over the COST, under its own name', () => {
    // The same two numbers. If these two ever come out equal, one of them is
    // being computed with the wrong denominator.
    const { profit } = textbook();
    expect(profit.markup).toBeCloseTo(150, 6);
    expect(profit.markup).not.toBeCloseTo(profit.grossMargin!, 1);
  });

  it('gives a food cost over the INGREDIENTS, not the total', () => {
    // ₪2.50 of ingredients against a ₪100 price is 2.5%, not 40%.
    expect(textbook().profit.foodCostPct).toBeCloseTo(2.5, 6);
  });

  it('gives the per-unit figures when the recipe yields units', () => {
    const { profit } = textbook();
    expect(profit.units).toBeCloseTo(2, 6);
    expect(profit.costPerUnit).toBeCloseTo(20, 6);
    expect(profit.unitSalePrice).toBeCloseTo(50, 6);
    expect(profit.profitPerUnit).toBeCloseTo(30, 6);
  });

  it('reads a per-UNIT sale price as a per-unit price', () => {
    // The same ₪50, declared per unit: the batch sells for ₪100, and the
    // margin is the same 60%. Reading it as a batch price would report a
    // ₪10 profit and a 20% margin on the same recipe.
    const { profit } = run(
      cake({
        salePrice: 50,
        salePriceBasis: 'unit',
        packagingCost: 7.5,
        laborCost: 30,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    expect(profit.basis).toBe('unit');
    expect(profit.batchSalePrice).toBeCloseTo(100, 6);
    expect(profit.profit).toBeCloseTo(60, 6);
    expect(profit.grossMargin).toBeCloseTo(60, 6);
  });

  it('refuses a per-unit price when the recipe has no units', () => {
    const { profit } = run(
      cake({
        yieldUnits: 0,
        unitWeight: 0,
        salePrice: 50,
        salePriceBasis: 'unit',
        packagingCost: 0,
        laborCost: 0,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    expect(profit.profit).toBeNull();
    expect(profit.why).toContain('מספר יחידות');
  });

  it('withholds the ratios with no sale price, and says so', () => {
    const { profit } = run(
      cake({ packagingCost: 0, laborCost: 0, otherCost: 0 } as Partial<Recipe>),
    );
    expect(profit.totalCost).toBeCloseTo(2.5, 6);
    expect(profit.profit).toBeNull();
    expect(profit.grossMargin).toBeNull();
    expect(profit.why).toContain('מחיר מכירה');
  });

  it('a sale price of 0 is a real price: a loss, and no ratio', () => {
    const { profit } = run(
      cake({
        salePrice: 0,
        packagingCost: 0,
        laborCost: 0,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    // Given away. The money loss is real and shown; the ratios are a division
    // by zero and are not 0% or −100%.
    expect(profit.profit).toBeCloseTo(-2.5, 6);
    expect(profit.grossMargin).toBeNull();
    expect(profit.foodCostPct).toBeNull();
    expect(profit.why).toContain('חילוק באפס');
  });

  it('a total cost of 0 leaves the markup undefined but the margin real', () => {
    // Everything free, sold for ₪10: a 100% margin, and a markup that would
    // be a division by zero.
    const { profit } = run(
      cake({
        salePrice: 10,
        packagingCost: 0,
        laborCost: 0,
        otherCost: 0,
      } as Partial<Recipe>),
      [priced('קמח לבן', 0), priced('מים', 0)],
    );
    expect(profit.totalCost).toBe(0);
    expect(profit.grossMargin).toBeCloseTo(100, 6);
    expect(profit.markup).toBeNull();
  });

  it('reports a loss as a negative profit and a negative margin', () => {
    const { profit } = run(
      cake({
        salePrice: 2,
        packagingCost: 1,
        laborCost: 0,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    expect(profit.profit).toBeCloseTo(-1.5, 6);
    expect(profit.grossMargin).toBeCloseTo(-75, 6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement G — the price a target implies', () => {
  it('ingredient cost 42 at a 30% food cost target gives 140', () => {
    // The instructions' own example. Ingredients only, because that is what
    // food cost means.
    const { target } = run(
      cake({ targetFC: 30 } as Partial<Recipe>),
      // 500 g of flour at ₪84/kg = ₪42
      [priced('קמח לבן', 84), priced('מים', 0)],
    );
    expect(target.fromFoodCost).toBeCloseTo(140, 6);
  });

  it('computes the margin target from the TOTAL cost, not the ingredients', () => {
    // Total ₪40 at a 60% margin target: ₪100. From ingredients alone it would
    // have said ₪6.25, which would be a catastrophe.
    const { target } = run(
      cake({
        targetGM: 60,
        packagingCost: 7.5,
        laborCost: 30,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    expect(target.fromMargin).toBeCloseTo(100, 6);
  });

  it('gives both targets per unit as well', () => {
    const { target } = run(
      cake({
        targetFC: 30,
        targetGM: 60,
        packagingCost: 7.5,
        laborCost: 30,
        otherCost: 0,
      } as Partial<Recipe>),
    );
    expect(target.fromMarginPerUnit).toBeCloseTo(50, 6);
    expect(target.fromFoodCostPerUnit).toBeCloseTo(target.fromFoodCost! / 2, 6);
  });

  it('refuses a food cost target of 0, which would need an infinite price', () => {
    const { target } = run(cake({ targetFC: 0 } as Partial<Recipe>));
    expect(target.fromFoodCost).toBeNull();
    expect(target.why).toContain('יעד פוד קוסט');
  });

  it('refuses a margin target of 100% or more', () => {
    const { target } = run(
      cake({ targetGM: 100, packagingCost: 0, laborCost: 0, otherCost: 0 } as Partial<Recipe>),
    );
    expect(target.fromMargin).toBeNull();
    expect(target.why).toContain('100%');
  });

  it('withholds a target price when the cost is partial', () => {
    const { target } = run(cake({ targetFC: 30, targetGM: 50 } as Partial<Recipe>), [
      priced('קמח לבן', 5),
    ]);
    expect(target.fromFoodCost).toBeNull();
    expect(target.fromMargin).toBeNull();
    expect(target.why).toContain('חלקית');
  });
});
