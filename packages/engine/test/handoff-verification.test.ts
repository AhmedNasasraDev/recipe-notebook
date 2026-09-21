/*
  ── §12 OF THE HANDOFF: THE ARITHMETIC, CHECKED AGAINST HAND-COMPUTED
     ANSWERS ────────────────────────────────────────────────────────────────

  "חישובים כספיים וכמויות ייבדקו בדוגמאות עם תוצאה צפויה שחושבה באופן עצמאי,
  כולל ערכי אפס, שברים, נתון חסר ויחידות לא תואמות."

  WHAT MAKES THIS DIFFERENT FROM THE OTHER ENGINE TESTS

  Most of them assert a RELATION the engine is supposed to keep — that scaling
  is linear, that a missing datum stays missing. These assert NUMBERS, worked
  out by hand from the inputs and written into the comment above each one, so
  the engine can be wrong in a self-consistent way and still be caught. Every
  expected value below can be checked with a calculator and nothing else.

  Two cases carry no literal: the cup case, because it would pin a density
  constant that lives in the table rather than in this arithmetic, and the
  unresolved case, where the right answer is "no number at all". Both are
  written as the relation instead, and both say why.
*/

import { describe, expect, it } from 'vitest';
import { compute, formatNis, formatGrams, type Recipe } from '../src/index.js';
import { DEFAULT_PREFS } from './helpers.js';

const prefs = DEFAULT_PREFS;

const recipe = (over: Record<string, unknown>): Recipe =>
  ({ id: 'r', name: 'בדיקה', steps: [], ...over }) as Recipe;

/** 500 g of bread flour at ₪3.60/kg and 60 g of sugar at ₪2.50/kg. */
const TWO_ROWS = [
  { id: 'i1', name: 'קמח לחם', qty: 500, unit: 'g', flour: true, price: 3.6, priceUnit: 'ק"ג' },
  { id: 'i2', name: 'סוכר', qty: 60, unit: 'g', price: 2.5, priceUnit: 'ק"ג' },
];

describe('§12 money, from prices per kilogram', () => {
  it('costs two rows at exactly the sum of their two line costs', () => {
    /*
      By hand:
        flour  500 g = 0.500 kg × ₪3.60 = ₪1.80
        sugar   60 g = 0.060 kg × ₪2.50 = ₪0.15
        total                            = ₪1.95
        weight  500 + 60                 = 560 g
    */
    const c = compute(recipe({ ingredients: TWO_ROWS }), [], { prefs });
    expect(c.rows[0]!.cost).toBeCloseTo(1.8, 10);
    expect(c.rows[1]!.cost).toBeCloseTo(0.15, 10);
    expect(c.cost).toBeCloseTo(1.95, 10);
    expect(c.totalG).toBe(560);
    /*
      AND WHAT THE SCREEN PRINTS FOR IT.

      Two decimals, always — the change Ahmed approved after this suite caught
      the old behaviour: `formatNis` rounded to one decimal below ₪100, so an
      exact ₪1.95 was displayed as ₪2. Nothing about the arithmetic moved;
      only the string did.
    */
    expect(formatNis(c.cost)).toBe('₪1.95');
    expect(formatNis(2.45)).toBe('₪2.45');
    expect(formatNis(0.195)).toBe('₪0.20');
    // Zero is a price, and it prints like one.
    expect(formatNis(0)).toBe('₪0.00');
    // Small, and large enough to carry a separator.
    expect(formatNis(0.05)).toBe('₪0.05');
    expect(formatNis(1234.491)).toBe('₪1,234.49');
  });

  it('gives the cost per kilogram and per unit, and the sale price from the target', () => {
    /*
      By hand, with 10 units and a 25% food-cost target:
        cost per kg   = 1.95 / 0.560 kg     = ₪3.482142857…
        cost per unit = 1.95 / 10           = ₪0.195
        sale price    = 0.195 / 0.25        = ₪0.78
    */
    const c = compute(
      recipe({ ingredients: TWO_ROWS, yieldUnits: 10, targetFC: 25 }),
      [],
      { prefs },
    );
    expect(c.costPerKg).toBeCloseTo(3.482142857142857, 9);
    expect(c.costPerUnit).toBeCloseTo(0.195, 10);
    expect(c.price).toBeCloseTo(0.78, 10);
  });

  it('scales the money by a FRACTION exactly, not by a rounded factor', () => {
    /*
      24 units out of a recipe written for 18 is a factor of 24/18 = 1.333…
      By hand:
        flour  500 × 4/3 = 666.666… g → 0.666666… kg × ₪3.60 = ₪2.40
        sugar   60 × 4/3 =  80 g      → 0.080 kg × ₪2.50      = ₪0.20
        total                                                  = ₪2.60
    */
    const c = compute(recipe({ ingredients: TWO_ROWS }), [], {
      prefs,
      factor: 24 / 18,
    });
    expect(c.rows[0]!.g).toBeCloseTo(666.6666666666666, 9);
    expect(c.rows[1]!.g).toBeCloseTo(80, 10);
    expect(c.cost).toBeCloseTo(2.6, 10);
  });

  it('treats a price of ZERO as a price, and a missing price as missing', () => {
    /*
      Tap water really is free, and free is not the same as unknown. By hand
      the cost of the batch is the flour alone: 0.5 × 3.60 = ₪1.80.
    */
    const c = compute(
      recipe({
        ingredients: [
          TWO_ROWS[0]!,
          { id: 'w', name: 'מים', qty: 300, unit: 'g', liquid: true, price: 0, priceUnit: 'ק"ג' },
          { id: 's', name: 'מלח', qty: 10, unit: 'g' },
        ],
      }),
      [],
      { prefs },
    );
    expect(c.cost).toBeCloseTo(1.8, 10);
    // The water was priced — at nothing. The salt was not priced at all.
    expect(c.rows[1]!.priced).toBe(true);
    expect(c.rows[1]!.cost).toBe(0);
    expect(c.rows[2]!.priced).toBe(false);
    expect(c.rows[2]!.cost).toBe(0);
  });

  it('costs a price per ITEM from the weight of one item', () => {
    /*
      A tray of 30 eggs at ₪39 is ₪1.30 an egg, and an egg here is 60 g.
      By hand:
        4 eggs        = 240 g
        cost          = 240 / 60 × ₪1.30 = ₪5.20
    */
    const c = compute(
      recipe({
        ingredients: [
          {
            id: 'e',
            name: 'ביצים',
            qty: 4,
            unit: 'unit',
            unitWeight: 60,
            price: 1.3,
            priceUnit: "יח'",
          },
        ],
      }),
      [],
      { prefs },
    );
    expect(c.rows[0]!.g).toBe(240);
    expect(c.cost).toBeCloseTo(5.2, 10);
  });

  it('refuses to cost a per-item price with no item weight, instead of costing it at zero', () => {
    /*
      There is no arithmetic to check here, and that is the point: with no
      weight for one item there is nothing to apply the price to, so the row
      has no weight, no cost, and appears in `unresolved` with a reason. A
      cost of ₪0 would read as "this ingredient is free".

      (A count unit the table knows an average weight for — an egg — is
      costed from that average and marked as an estimate; this row's unit has
      none, which is the case that has to fail loudly.)
    */
    const c = compute(
      recipe({
        ingredients: [
          { id: 'x', name: 'תבנית מיוחדת', qty: 2, unit: 'פרוסה', price: 4, priceUnit: "יח'" },
        ],
      }),
      [],
      { prefs },
    );
    expect(c.rows[0]!.g).toBeNull();
    expect(c.rows[0]!.priced).toBe(false);
    expect(c.cost).toBe(0);
    expect(c.unresolved).toHaveLength(1);
    expect(c.unresolved[0]!.reason).not.toBe('');
  });

  it('rolls a base recipe up by weight, at the base recipe\'s own cost per gram', () => {
    /*
      The base is TWO_ROWS: ₪1.95 for 560 g. A cake that uses 280 g of it
      carries, by hand:
        280 g × (1.95 / 560) = 280 × 0.0034821428… = ₪0.975
    */
    const base = recipe({ id: 'base', name: 'בסיס', ingredients: TWO_ROWS, isSub: true });
    const cake = recipe({
      id: 'cake',
      name: 'עוגה',
      ingredients: [{ id: 'l', name: 'בסיס', qty: 280, unit: 'g', subId: 'base' }],
    });
    const c = compute(cake, [base, cake], { prefs });
    expect(c.rows[0]!.cost).toBeCloseTo(0.975, 10);
    expect(c.cost).toBeCloseTo(0.975, 10);
  });
});

describe('§12 quantities, yield and loss', () => {
  it('computes the production loss from the measured yield', () => {
    /*
      By hand: theoretical 560 g, measured 500 g.
        loss = (560 − 500) / 560 × 100 = 10.714285714…%
    */
    const c = compute(recipe({ ingredients: TWO_ROWS, yieldActual: 500 }), [], { prefs });
    expect(c.theoretical).toBe(560);
    expect(c.actualYield).toBe(500);
    expect(c.prodLoss).toBeCloseTo(10.714285714285714, 9);
  });

  it('computes the bake loss, the scaling weight and the real unit count together', () => {
    /*
      By hand, with 1000 g before and 900 g after, 50 g per finished unit and
      a measured yield of 500 g:
        bake loss      = (1000 − 900) / 1000 × 100 = 10%
        scaling weight = 50 / (1 − 0.10)           = 55.555… g
        units          = 500 / 55.555…             = 9
        cost per unit  = 1.95 / 9                  = ₪0.21666…
        cost per kg    = 1.95 / 0.500 kg           = ₪3.90
    */
    const c = compute(
      recipe({
        ingredients: TWO_ROWS,
        yieldActual: 500,
        weightBefore: 1000,
        weightAfter: 900,
        unitWeight: 50,
      }),
      [],
      { prefs },
    );
    expect(c.bakeLoss).toBeCloseTo(10, 10);
    expect(c.scaleWeight).toBeCloseTo(55.55555555555556, 9);
    expect(c.unitsActual).toBeCloseTo(9, 9);
    expect(c.costPerUnit).toBeCloseTo(0.21666666666666667, 9);
    expect(c.costPerKg).toBeCloseTo(3.9, 9);
  });

  it('treats ONE of the two weights as no measurement — not as a 100% loss', () => {
    /*
      Half-filled entry: 1000 g before, nothing after. A 100% bake loss would
      make the scaling weight 50 / (1 − 1) = Infinity. By hand the honest
      answer is no loss applied:
        scaling weight = 50 g
        units          = 500 / 50 = 10
    */
    const c = compute(
      recipe({
        ingredients: TWO_ROWS,
        yieldActual: 500,
        weightBefore: 1000,
        unitWeight: 50,
      }),
      [],
      { prefs },
    );
    expect(c.bakeLoss).toBe(0);
    expect(c.scaleWeight).toBe(50);
    expect(Number.isFinite(c.unitsActual)).toBe(true);
    expect(c.unitsActual).toBeCloseTo(10, 10);
  });

  it('keeps a row with no density OUT of the totals instead of calling it zero', () => {
    /*
      No literal to check: the answer is the absence of one. A volume of
      something the table does not know cannot become grams, so the row has no
      weight, no cost, and the totals are the other rows alone — 500 + 60.
    */
    const c = compute(
      recipe({
        ingredients: [
          ...TWO_ROWS,
          { id: 'q', name: 'תמצית סודית', qty: 2, unit: 'ml', price: 90, priceUnit: 'ליטר' },
        ],
      }),
      [],
      { prefs },
    );
    expect(c.rows[2]!.g).toBeNull();
    expect(c.totalG).toBe(560);
    expect(c.cost).toBeCloseTo(1.95, 10);
    expect(c.unresolved.map((u) => u.name)).toContain('תמצית סודית');
  });

  it('scales a home measure with the volume of the reader\'s OWN cup', () => {
    /*
      A relation, not a literal: this one would otherwise pin the flour
      density, which belongs to the table and not to this arithmetic. Two cups
      measured with a 250 ml cup must weigh exactly 250/240 of the same two
      cups measured with a 240 ml cup — the conversion is linear in the tool's
      volume, and nothing else about the recipe changed.
    */
    const cups = recipe({
      ingredients: [{ id: 'c1', name: 'קמח לבן', qty: 2, unit: 'cup', flour: true }],
    });
    const at240 = compute(cups, [], { prefs: { ...prefs, tools: { ...prefs.tools, cup: 240 } } });
    const at250 = compute(cups, [], { prefs: { ...prefs, tools: { ...prefs.tools, cup: 250 } } });
    expect(at240.rows[0]!.g).not.toBeNull();
    expect(at250.rows[0]!.g! / at240.rows[0]!.g!).toBeCloseTo(250 / 240, 9);
  });

  it('survives a row of zero, and a recipe of nothing, without producing NaN', () => {
    const zero = compute(
      recipe({ ingredients: [{ id: 'z', name: 'קמח', qty: 0, unit: 'g', price: 3.6, priceUnit: 'ק"ג' }] }),
      [],
      { prefs },
    );
    expect(zero.totalG).toBe(0);
    expect(zero.cost).toBe(0);
    expect(zero.costPerKg).toBe(0);
    expect(Number.isNaN(zero.costPerUnit)).toBe(false);

    const empty = compute(recipe({ ingredients: [] }), [], { prefs });
    expect(empty.totalG).toBe(0);
    expect(empty.prodLoss).toBe(0);
    expect(empty.hydration).toBe(0);
    expect(formatGrams(empty.totalG)).toBe('0 גר\'');
  });

  it('computes hydration from the flour and the liquids, by hand', () => {
    /*
      By hand: 500 g flour, 325 g water.
        hydration = 325 / 500 × 100 = 65%
    */
    const c = compute(
      recipe({
        ingredients: [
          { id: 'f', name: 'קמח לחם', qty: 500, unit: 'g', flour: true },
          { id: 'w', name: 'מים', qty: 325, unit: 'g', liquid: true },
        ],
      }),
      [],
      { prefs },
    );
    expect(c.hydration).toBeCloseTo(65, 10);
    expect(c.trueHydration).toBeCloseTo(65, 10);
  });
});
