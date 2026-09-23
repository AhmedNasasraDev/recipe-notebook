// Pricing per ITEM, and the `priced` flag that came with it (stage 7).
//
// WHY THERE IS AN ENGINE CHANGE HERE AT ALL
//
// `compute()` costs a row from its weight in grams. It special-cased a
// per-litre price and nothing else, so a price in `יח'` fell through to the
// per-kilogram formula: three eggs at ₪1.30 each came out at ₪0.21 instead of
// ₪3.90. `יח'` is a selectable price unit in the editor and a legal value in
// the `ingredients.price_unit` CHECK constraint, so this was reachable from the
// UI and wrong by a factor of eighteen — with no warning.
//
// The fix needed one thing the cost branch could not reach: the weight of one
// item. `gramsPerItem` is now exported from convert.ts rather than private,
// which is a smaller change than teaching the cost branch to weigh things
// itself, and it guarantees the two answers cannot diverge.
//
// It also needed a way to say "this row carries a price that could NOT be
// applied". Costing such a row at zero is the same failure as treating a
// missing price as free, one layer down. Hence `ComputedRow.priced`.

import { describe, expect, it } from 'vitest';
import { compute, gramsPerItem, type Recipe } from '../src/index.js';
import { DEFAULT_PREFS } from './helpers.js';

const prefs = DEFAULT_PREFS;

const recipe = (ings: unknown[]): Recipe =>
  ({ id: 'r', name: 'בדיקה', ingredients: ings, steps: [] }) as Recipe;

describe('a price per item', () => {
  it('costs three eggs at 1.30 each as 3.90, not as 1.30 per kilo', () => {
    // A tray of 30 eggs at ₪39 is ₪1.30 an egg. An egg is 55 g here.
    const r = recipe([
      { id: 'i1', name: 'ביצים', qty: 3, unit: 'unit', unitWeight: 55, price: 1.3, priceUnit: "יח'" },
    ]);
    const c = compute(r, [r], { prefs });
    expect(c.rows[0]!.g).toBe(165);
    expect(c.cost).toBeCloseTo(3.9, 6);
    expect(c.rows[0]!.priced).toBe(true);
  });

  it('is not the same as the per-kilogram answer, which is the bug', () => {
    const per = { id: 'i1', name: 'ביצים', qty: 3, unit: 'unit', unitWeight: 55, price: 1.3 };
    const byItem = recipe([{ ...per, priceUnit: "יח'" }]);
    const byKg = recipe([{ ...per, priceUnit: 'ק"ג' }]);
    // 165 g at ₪1.30/kg is ₪0.21. That is what every per-item price used to do.
    expect(compute(byKg, [byKg], { prefs }).cost).toBeCloseTo(0.2145, 6);
    expect(compute(byItem, [byItem], { prefs }).cost).toBeCloseTo(3.9, 6);
  });

  it('scales with the recipe, like every other cost', () => {
    const r = recipe([
      { id: 'i1', name: 'ביצים', qty: 3, unit: 'unit', unitWeight: 55, price: 1.3, priceUnit: "יח'" },
    ]);
    expect(compute(r, [r], { prefs, factor: 2 }).cost).toBeCloseTo(7.8, 6);
  });

  it('works from a row written in grams, not only from a count unit', () => {
    // 165 g of egg at 55 g an egg is three eggs, so ₪3.90 either way. The
    // price unit and the QUANTITY unit are independent.
    const r = recipe([
      { id: 'i1', name: 'ביצים', qty: 165, unit: 'g', unitWeight: 55, price: 1.3, priceUnit: "יח'" },
    ]);
    expect(compute(r, [r], { prefs }).cost).toBeCloseTo(3.9, 6);
  });

  it('a price of 0 per item is a real price of zero', () => {
    const r = recipe([
      { id: 'i1', name: 'ביצים', qty: 3, unit: 'unit', unitWeight: 55, price: 0, priceUnit: "יח'" },
    ]);
    const c = compute(r, [r], { prefs });
    expect(c.cost).toBe(0);
    // The distinction the whole model turns on: a zero that was typed is a
    // price, and the row must not read as unpriced.
    expect(c.rows[0]!.priced).toBe(true);
  });
});

describe('a per-item price that cannot be applied', () => {
  const noItemWeight = recipe([
    { id: 'i1', name: 'ביצים', qty: 165, unit: 'g', price: 1.3, priceUnit: "יח'" },
  ]);

  it('is reported, not costed at zero and forgotten', () => {
    const c = compute(noItemWeight, [noItemWeight], { prefs });
    expect(c.rows[0]!.g).toBe(165); // the WEIGHT is fine
    expect(c.cost).toBe(0);
    expect(c.warnings.some((w) => w.includes('משקל ליחידה'))).toBe(true);
  });

  it('and `priced` is false, which is what stops it reading as a finished cost', () => {
    // Without this flag the row looks priced (the field is filled) and the
    // recipe shows a total that is missing an ingredient.
    expect(compute(noItemWeight, [noItemWeight], { prefs }).rows[0]!.priced).toBe(false);
  });

  it('does not invent an item weight to close the gap', () => {
    // `unit` has no average item weight in the table, on purpose: an egg, a
    // lemon and a sheet of gelatine are not interchangeable.
    expect(gramsPerItem({ unit: 'unit' })).toBeNull();
    expect(gramsPerItem({ unit: 'g' })).toBeNull();
  });

  it('uses the recipe\'s own item weight when it has one', () => {
    expect(gramsPerItem({ unit: 'unit', unitWeight: 55 })).toBe(55);
    // and a zero or negative item weight is not an item weight
    expect(gramsPerItem({ unit: 'unit', unitWeight: 0 })).toBeNull();
  });
});

describe('`priced` on every other kind of row', () => {
  it('is true for a per-kilogram price', () => {
    const r = recipe([{ id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', price: 5, priceUnit: 'ק"ג' }]);
    expect(compute(r, [r], { prefs }).rows[0]!.priced).toBe(true);
  });

  it('is true for a per-litre price', () => {
    const r = recipe([{ id: 'i1', name: 'חלב 3%', qty: 500, unit: 'ml', price: 6, priceUnit: 'ליטר' }]);
    expect(compute(r, [r], { prefs }).rows[0]!.priced).toBe(true);
  });

  it('is false with no price at all', () => {
    const r = recipe([{ id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g' }]);
    expect(compute(r, [r], { prefs }).rows[0]!.priced).toBe(false);
  });

  it('is false for an empty-string price, which is not a zero', () => {
    const r = recipe([{ id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', price: '', priceUnit: 'ק"ג' }]);
    expect(compute(r, [r], { prefs }).rows[0]!.priced).toBe(false);
  });

  it('is false for a row that could not be weighed', () => {
    const r = recipe([{ id: 'i1', name: 'קקאו', qty: 1, unit: 'cup', price: 40, priceUnit: 'ק"ג' }]);
    const c = compute(r, [r], { prefs });
    expect(c.rows[0]!.g).toBeNull();
    expect(c.rows[0]!.priced).toBe(false);
  });

  it('is false for a SUB-RECIPE line, which has no price of its own (§18.6)', () => {
    const base = { id: 'base', name: 'גנאש', ingredients: [
      { id: 'b1', name: 'שוקולד מריר', qty: 200, unit: 'g', price: 60, priceUnit: 'ק"ג' },
    ], steps: [] } as unknown as Recipe;
    const top = recipe([{ id: 't1', name: 'גנאש', qty: 100, unit: 'g', subId: 'base' }]);
    const c = compute(top, [base, top], { prefs });
    // its cost DID roll up...
    expect(c.cost).toBeGreaterThan(0);
    // ...but not from a price on this row, which is what `priced` reports
    expect(c.rows[0]!.priced).toBe(false);
  });
});
