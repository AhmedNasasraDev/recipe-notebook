// The ingredient centre: package arithmetic, resolution, and the two
// distinctions the whole stage turns on (stage-7 requirements 1-3, 8).

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { calcState } from '../recipe/completeness.js';
import {
  basePriceOf,
  catalogByKey,
  hasOwnPrice,
  priceOriginOf,
  resolveFromCatalog,
  unpricedKeys,
  type CatalogItem,
} from './catalog.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'c1',
  key: 'חמאה 82%',
  name: 'חמאה 82%',
  purchaseUnit: 'g',
  packageQty: 200,
  packageCount: 1,
  purchaseTotal: 8.9,
  usablePct: null,
  supplier: 'תנובה',
  purchasedAt: '2026-09-01',
  priceUpdatedAt: '2026-09-01T00:00:00Z',
  note: '',
  purchasePrice: 44.5,
  price: 44.5,
  priceUnit: 'ק"ג',
  allergens: ['חלב'],
  ...over,
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 3 — the real purchase scenarios', () => {
  // The four the instructions name, verbatim.
  it('flour: a 25 kg sack for 110 is 4.40 per kilo', () => {
    expect(basePriceOf({ purchaseUnit: 'kg', packageQty: 25, purchaseTotal: 110 })).toEqual({
      // With no declared yield the purchase cost and the usable cost are the
      // same number — not zero, and not absent.
      purchase: 4.4,
      price: 4.4,
      unit: 'ק"ג',
    });
  });

  it('butter: a 200 g pack for 8.90 is 44.50 per kilo', () => {
    const out = basePriceOf({ purchaseUnit: 'g', packageQty: 200, purchaseTotal: 8.9 })!;
    expect(out.unit).toBe('ק"ג');
    expect(out.price).toBeCloseTo(44.5, 6);
  });

  it('cream: 1 litre for 18 is 18 per litre', () => {
    expect(basePriceOf({ purchaseUnit: 'l', packageQty: 1, purchaseTotal: 18 })).toEqual({
      purchase: 18,
      price: 18,
      unit: 'ליטר',
    });
  });

  it('eggs: a tray of 30 for 39 is 1.30 per egg', () => {
    const out = basePriceOf({ purchaseUnit: 'unit', packageQty: 30, purchaseTotal: 39 })!;
    expect(out.unit).toBe("יח'");
    expect(out.price).toBeCloseTo(1.3, 6);
  });

  it('and a 100 ml bottle for 45 is 450 per litre', () => {
    // The one that catches a factor-of-1000 slip in the other direction.
    expect(basePriceOf({ purchaseUnit: 'ml', packageQty: 100, purchaseTotal: 45 })).toEqual({
      purchase: 450,
      price: 450,
      unit: 'ליטר',
    });
  });

  it('does not assume everything is bought by the kilo', () => {
    // The same package numbers under five purchase units must give five
    // different answers. If they did not, the unit would be decoration.
    const answers = (['kg', 'g', 'l', 'ml', 'unit'] as const).map(
      (u) => basePriceOf({ purchaseUnit: u, packageQty: 2, purchaseTotal: 10 })!,
    );
    expect(answers.map((a) => `${a.price} ${a.unit}`)).toEqual([
      '5 ק"ג',
      '5000 ק"ג',
      '5 ליטר',
      '5000 ליטר',
      "5 יח'",
    ]);
  });
});

describe('an unpriced material is not a free one (requirement 8)', () => {
  it('has no price when the package price is unknown', () => {
    expect(basePriceOf({ purchaseUnit: 'kg', packageQty: 25, purchaseTotal: null })).toBeNull();
  });

  it('has no price when the package size is unknown', () => {
    expect(basePriceOf({ purchaseUnit: 'kg', packageQty: null, purchaseTotal: 110 })).toBeNull();
  });

  it('has no price for a package of nothing, rather than dividing by zero', () => {
    expect(basePriceOf({ purchaseUnit: 'kg', packageQty: 0, purchaseTotal: 110 })).toBeNull();
  });

  it('but an explicit price of 0 IS a price, of zero', () => {
    // Water from the tap, a donated sack. Free is not unpriced.
    expect(basePriceOf({ purchaseUnit: 'l', packageQty: 1, purchaseTotal: 0 })).toEqual({
      purchase: 0,
      price: 0,
      unit: 'ליטר',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 2 — one price, and every recipe follows it', () => {
  const butter = item();
  const recipe = (over: Partial<Recipe> = {}): Recipe =>
    ({
      id: 'r',
      name: 'בצק',
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g' }],
      steps: [],
      ...over,
    }) as Recipe;

  it('a row with no price of its own inherits the central one', () => {
    const out = resolveFromCatalog(recipe(), [butter]);
    expect(out.ingredients![0]!.price).toBe(44.5);
    expect(out.ingredients![0]!.priceUnit).toBe('ק"ג');
  });

  it('and the cost is the engine\'s, from that price', () => {
    const out = resolveFromCatalog(recipe(), [butter]);
    // 250 g at ₪44.50/kg = ₪11.125
    expect(compute(out, [out], { prefs }).cost).toBeCloseTo(11.125, 6);
  });

  it('changing the central price changes the cost, with no edit to the recipe', () => {
    const before = resolveFromCatalog(recipe(), [butter]);
    // ₪36/kg, the instructions' own example
    const after = resolveFromCatalog(recipe(), [
      item({ purchaseUnit: 'kg', packageQty: 1, purchaseTotal: 36, price: 36, priceUnit: 'ק"ג' }),
    ]);
    expect(compute(before, [before], { prefs }).cost).toBeCloseTo(11.125, 6);
    expect(compute(after, [after], { prefs }).cost).toBeCloseTo(9, 6);
  });

  it('one price change moves EVERY recipe that inherits it', () => {
    const a = recipe({ id: 'a', ingredients: [{ id: 'i', name: 'חמאה 82%', qty: 100, unit: 'g' }] });
    const b = recipe({ id: 'b', ingredients: [{ id: 'i', name: 'חמאה 82%', qty: 500, unit: 'g' }] });
    const dear = item({ purchaseTotal: 17.8, price: 89, priceUnit: 'ק"ג' });

    const costOf = (r: Recipe, cat: CatalogItem[]) => {
      const res = resolveFromCatalog(r, cat);
      return compute(res, [res], { prefs }).cost;
    };
    expect(costOf(a, [butter])).toBeCloseTo(4.45, 6);
    expect(costOf(b, [butter])).toBeCloseTo(22.25, 6);
    // doubled in the centre, doubled in both
    expect(costOf(a, [dear])).toBeCloseTo(8.9, 6);
    expect(costOf(b, [dear])).toBeCloseTo(44.5, 6);
  });

  it('a row with its own price KEEPS it — the centre does not overwrite', () => {
    const withOwn = recipe({
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g', price: 30, priceUnit: 'ק"ג' }],
    });
    expect(resolveFromCatalog(withOwn, [butter]).ingredients![0]!.price).toBe(30);
  });

  it('and an explicit price of 0 in a recipe is an override, not an empty field', () => {
    // The trap: 0 is falsy. A resolution that tested truthiness would silently
    // replace "this is free" with the shop price.
    const free = recipe({
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g', price: 0, priceUnit: 'ק"ג' }],
    });
    expect(resolveFromCatalog(free, [butter]).ingredients![0]!.price).toBe(0);
    expect(compute(resolveFromCatalog(free, [butter]), [free], { prefs }).cost).toBe(0);
  });

  it('matches on the engine\'s identity, so whitespace does not break inheritance', () => {
    const spaced = recipe({
      ingredients: [{ id: 'i1', name: 'חמאה 82% ', qty: 250, unit: 'g' }],
    });
    expect(resolveFromCatalog(spaced, [butter]).ingredients![0]!.price).toBe(44.5);
  });

  it('leaves a sub-recipe line alone — its cost comes from the base (§18.6)', () => {
    const withSub = recipe({
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g', subId: 'base' }],
    });
    expect(resolveFromCatalog(withSub, [butter]).ingredients![0]!.price).toBeUndefined();
  });

  it('is idempotent, which is what lets a frozen snapshot pass through it', () => {
    const once = resolveFromCatalog(recipe(), [butter]);
    const twice = resolveFromCatalog(once, [butter]);
    expect(twice.ingredients![0]!.price).toBe(44.5);
    // A version snapshot arrives with every price already filled. Resolution
    // must not touch it, or a historical cost would drift to today's price.
    const frozen = resolveFromCatalog(
      recipe({ ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g', price: 12, priceUnit: 'ק"ג' }] }),
      [butter],
    );
    expect(frozen.ingredients![0]!.price).toBe(12);
  });

  it('does nothing at all when the centre is empty', () => {
    const r = recipe();
    expect(resolveFromCatalog(r, [])).toBe(r);
  });
});

describe('a material with no central price', () => {
  it('leaves the row unpriced rather than costing it at 0', () => {
    const unpriced = item({ purchaseTotal: null, price: null, priceUnit: null });
    const r = {
      id: 'r',
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g' }],
      steps: [],
    } as unknown as Recipe;
    const out = resolveFromCatalog(r, [unpriced]);
    expect(out.ingredients![0]!.price).toBeUndefined();
    // and the recipe says so, rather than showing a finished cost of ₪0
    expect(calcState(compute(out, [out], { prefs })).costLevel).toBe('none');
  });

  it('is reported as something to go and price, with whether it is in the centre', () => {
    const r = {
      id: 'r',
      ingredients: [
        { id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g' },
        { id: 'i2', name: 'מלח אטלנטי', qty: 10, unit: 'g' },
      ],
      steps: [],
    } as unknown as Recipe;
    const out = unpricedKeys(r, [item({ purchaseTotal: null, price: null, priceUnit: null })]);
    expect(out).toEqual([
      // in the centre, but with no price on it
      { key: 'חמאה 82%', name: 'חמאה 82%', inCentre: true },
      // not in the centre at all
      { key: 'מלח אטלנטי', name: 'מלח אטלנטי', inCentre: false },
    ]);
  });

  it('does not list a row that has its own price, or a sub-recipe line', () => {
    const r = {
      id: 'r',
      ingredients: [
        { id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g', price: 0 },
        { id: 'i2', name: 'גנאש', qty: 100, unit: 'g', subId: 'base' },
      ],
      steps: [],
    } as unknown as Recipe;
    expect(unpricedKeys(r, [])).toEqual([]);
  });
});

describe('where a price came from, for the editor to show', () => {
  const byKey = catalogByKey([item()]);
  const row = (over: Record<string, unknown> = {}) => ({ name: 'חמאה 82%', ...over });

  it('own, when the row has a price', () => {
    expect(priceOriginOf(row({ price: 30 }), byKey)).toBe('own');
    // including an explicit zero
    expect(priceOriginOf(row({ price: 0 }), byKey)).toBe('own');
  });

  it('catalog, when it does not and the centre has one', () => {
    expect(priceOriginOf(row(), byKey)).toBe('catalog');
  });

  it('none, when nobody has priced it', () => {
    expect(priceOriginOf(row({ name: 'משהו אחר' }), byKey)).toBe('none');
    expect(
      priceOriginOf(row(), catalogByKey([item({ price: null, priceUnit: null })])),
    ).toBe('none');
  });

  it('none for a sub-recipe line, which must not inherit a price', () => {
    expect(priceOriginOf(row({ subId: 'base' }), byKey)).toBe('none');
  });

  it('an empty string is not a price, and a 0 is', () => {
    expect(hasOwnPrice({ price: '' })).toBe(false);
    expect(hasOwnPrice({})).toBe(false);
    expect(hasOwnPrice({ price: 0 })).toBe(true);
    expect(hasOwnPrice({ price: '0' })).toBe(true);
  });
});

describe('allergens declared on a material', () => {
  it('reach every recipe that uses it', () => {
    const r = {
      id: 'r',
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g' }],
      steps: [],
    } as unknown as Recipe;
    const out = resolveFromCatalog(r, [item({ allergens: ['חלב', 'גלוטן'] })]);
    expect(compute(out, [out], { prefs }).allergens).toContain('גלוטן');
  });

  it('are added to what the recipe already declares, not substituted for it', () => {
    const r = {
      id: 'r',
      manualAllergens: ['סולפיטים'],
      ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 250, unit: 'g' }],
      steps: [],
    } as unknown as Recipe;
    const out = resolveFromCatalog(r, [item({ allergens: ['חלב'] })]);
    expect(out.manualAllergens).toContain('סולפיטים');
    expect(out.manualAllergens).toContain('חלב');
  });
});
