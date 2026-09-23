// Stage-8 requirements A, B, D: the purchase as it was made, and what it costs.
//
// Every case the instructions name is here, with the numbers they give, plus
// the ones that would silently produce a wrong cost: a multi-pack, a purchase
// of nothing, a yield of nothing, and the litre↔kilogram conversion that must
// NOT happen without a density.

import { describe, expect, it } from 'vitest';
import { baseQtyOf, basePriceOf, conversionsOf } from './catalog.js';
import { changeWord, formatPct, priceUnitOf } from './purchases.js';

describe('requirement A — the four purchases the instructions name', () => {
  it('5 kg for 200 is 40 per kilo, 4 per 100 g and 0.04 per gram', () => {
    const out = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 5,
      purchaseTotal: 200,
    })!;
    expect(out.price).toBeCloseTo(40, 9);
    expect(out.unit).toBe('ק"ג');

    const scales = conversionsOf(out.price, out.unit);
    expect(scales.map((s) => s.label)).toEqual(['ק"ג', "100 גר'", 'גרם']);
    expect(scales[0]!.value).toBeCloseTo(40, 9);
    expect(scales[1]!.value).toBeCloseTo(4, 9);
    expect(scales[2]!.value).toBeCloseTo(0.04, 9);
  });

  it('6 packs of 500 g for a TOTAL of 72 is 3 kg and 24 per kilo', () => {
    // The case the old single-package model could not express at all: the
    // price typed is the whole receipt, not the price of one pack.
    expect(baseQtyOf('g', 6, 500)).toBeCloseTo(3, 9);
    const out = basePriceOf({
      purchaseUnit: 'g',
      packageCount: 6,
      packageQty: 500,
      purchaseTotal: 72,
    })!;
    expect(out.price).toBeCloseTo(24, 9);
    expect(out.unit).toBe('ק"ג');
  });

  it('30 eggs for 39 is 1.30 per egg', () => {
    const out = basePriceOf({
      purchaseUnit: 'unit',
      packageCount: 1,
      packageQty: 30,
      purchaseTotal: 39,
    })!;
    expect(out.price).toBeCloseTo(1.3, 9);
    expect(out.unit).toBe("יח'");
  });

  it('12 bottles of 1 L for 180 is 15 per litre', () => {
    const out = basePriceOf({
      purchaseUnit: 'l',
      packageCount: 12,
      packageQty: 1,
      purchaseTotal: 180,
    })!;
    expect(out.price).toBeCloseTo(15, 9);
    expect(out.unit).toBe('ליטר');
  });

  it('does not assume a material is sold by weight', () => {
    // The same three numbers under five purchase units must give five
    // different answers, or the unit is decoration.
    const answers = (['kg', 'g', 'l', 'ml', 'unit'] as const).map((u) => {
      const o = basePriceOf({
        purchaseUnit: u,
        packageCount: 2,
        packageQty: 2,
        purchaseTotal: 40,
      })!;
      return `${o.price} ${o.unit}`;
    });
    expect(answers).toEqual([
      '10 ק"ג',
      '10000 ק"ג',
      '10 ליטר',
      '10000 ליטר',
      "10 יח'",
    ]);
  });

  it('a single package is one package, not a missing one', () => {
    // `packageCount` omitted must behave as 1 — every stage-7 row is stored
    // that way, and reading it as 0 or null would wipe the price.
    const withOut = basePriceOf({ purchaseUnit: 'kg', packageQty: 5, purchaseTotal: 200 })!;
    const withOne = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 5,
      purchaseTotal: 200,
    })!;
    expect(withOut).toEqual(withOne);
  });
});

describe('requirement B — one source of truth, every scale derived', () => {
  it('shows only meaningful scales for a price per item', () => {
    // "₪0.13 per 100 eggs" is not a smaller egg. One scale, or nonsense.
    expect(conversionsOf(1.3, "יח'")).toEqual([{ label: "יח'", value: 1.3 }]);
  });

  it('never converts a litre price to a kilogram price', () => {
    const labels = conversionsOf(15, 'ליטר').map((c) => c.label);
    expect(labels).toEqual(['ליטר', '100 מ"ל', 'מ"ל']);
    // A density would be needed, and there is none here to use honestly.
    expect(labels.some((l) => l.includes('ג'))).toBe(false);
  });

  it('the scales are the same number, so they cannot disagree', () => {
    const [kg, hundred, gram] = conversionsOf(37.5, 'ק"ג');
    expect(hundred!.value * 10).toBeCloseTo(kg!.value, 9);
    expect(gram!.value * 1000).toBeCloseTo(kg!.value, 9);
  });

  it('names the unit a purchase unit produces a price per', () => {
    expect(priceUnitOf('kg')).toBe('ק"ג');
    expect(priceUnitOf('g')).toBe('ק"ג');
    expect(priceUnitOf('l')).toBe('ליטר');
    expect(priceUnitOf('ml')).toBe('ליטר');
    expect(priceUnitOf('unit')).toBe("יח'");
  });
});

describe('a missing price is not a price of zero', () => {
  it('has no price when nothing was paid… because nobody said what was paid', () => {
    expect(
      basePriceOf({ purchaseUnit: 'kg', packageCount: 1, packageQty: 5, purchaseTotal: null }),
    ).toBeNull();
  });

  it('has a price of ZERO when zero was paid', () => {
    // A donated sack, water from the tap. Free is a price.
    const out = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 5,
      purchaseTotal: 0,
    })!;
    expect(out.price).toBe(0);
    expect(out.purchase).toBe(0);
  });

  it('has no price when the package size is unknown', () => {
    expect(
      basePriceOf({ purchaseUnit: 'kg', packageCount: 1, packageQty: null, purchaseTotal: 200 }),
    ).toBeNull();
  });

  it('refuses to divide by a package of nothing', () => {
    expect(
      basePriceOf({ purchaseUnit: 'kg', packageCount: 1, packageQty: 0, purchaseTotal: 200 }),
    ).toBeNull();
  });

  it('refuses a purchase of zero packages', () => {
    expect(
      basePriceOf({ purchaseUnit: 'kg', packageCount: 0, packageQty: 5, purchaseTotal: 200 }),
    ).toBeNull();
  });
});

describe('requirement D — purchase cost is not usable cost', () => {
  it('10 kg for 200 at 80% usable costs 20 to buy and 25 to use', () => {
    // The instructions' own example, to the shekel.
    const out = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 10,
      purchaseTotal: 200,
      usablePct: 80,
    })!;
    expect(out.purchase).toBeCloseTo(20, 9);
    expect(out.price).toBeCloseTo(25, 9);
  });

  it('no declared yield means the two costs are the SAME, not zero', () => {
    const out = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 10,
      purchaseTotal: 200,
      usablePct: null,
    })!;
    expect(out.purchase).toBeCloseTo(20, 9);
    expect(out.price).toBeCloseTo(20, 9);
  });

  it('100% usable is the same as no waste', () => {
    const declared = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 10,
      purchaseTotal: 200,
      usablePct: 100,
    })!;
    expect(declared.price).toBeCloseTo(20, 9);
    expect(declared.price).toBeCloseTo(declared.purchase, 9);
  });

  it('halving the yield doubles the usable cost', () => {
    const out = basePriceOf({
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 10,
      purchaseTotal: 200,
      usablePct: 50,
    })!;
    expect(out.price).toBeCloseTo(40, 9);
  });

  it('refuses a yield of 0 rather than reporting an infinite cost', () => {
    expect(
      basePriceOf({
        purchaseUnit: 'kg',
        packageCount: 1,
        packageQty: 10,
        purchaseTotal: 200,
        usablePct: 0,
      }),
    ).toBeNull();
  });

  it('refuses a yield above 100, which would mean cleaning created matter', () => {
    expect(
      basePriceOf({
        purchaseUnit: 'kg',
        packageCount: 1,
        packageQty: 10,
        purchaseTotal: 200,
        usablePct: 120,
      }),
    ).toBeNull();
  });

  it('applies the yield to a per-item purchase too', () => {
    // 100 lemons for ₪100, a fifth of them unusable: ₪1.25 per usable lemon.
    const out = basePriceOf({
      purchaseUnit: 'unit',
      packageCount: 1,
      packageQty: 100,
      purchaseTotal: 100,
      usablePct: 80,
    })!;
    expect(out.price).toBeCloseTo(1.25, 9);
    expect(out.unit).toBe("יח'");
  });
});

describe('how a price change reads', () => {
  it('formats a rise, a fall and no change', () => {
    expect(formatPct(12.53)).toBe('+12.5%');
    expect(formatPct(-8)).toBe('-8%');
    expect(formatPct(0)).toBe('0%');
  });

  it('describes the direction without calling it good or bad', () => {
    expect(changeWord(5)).toBe('התייקר');
    expect(changeWord(-5)).toBe('הוזל');
    expect(changeWord(0)).toBe('לא השתנה');
  });
});
