import { describe, expect, it } from 'vitest';
import {
  compute,
  lookupDensity,
  scaleFactor,
  type Recipe,
} from '../src/index.js';
import { DEFAULT_PREFS, prefsWithCup } from './helpers.js';

const P240 = prefsWithCup(240);
const P250 = prefsWithCup(250);

/** A recipe measured the way a home baker writes one: in cups. */
const CUP_CAKE: Recipe = {
  id: 'cupcake',
  name: 'עוגה במדידות ביתיות',
  yieldUnits: 12,
  unitWeight: 60,
  targetFC: 25,
  ingredients: [
    { id: 'i1', name: 'קמח לבן', qty: 2, unit: 'כוס', flour: true, price: 5.4, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'סוכר', qty: 1, unit: 'כוס', price: 4.2, priceUnit: 'ק"ג' },
    { id: 'i3', name: 'חלב', qty: 1, unit: 'כוס', liquid: true, price: 6.5, priceUnit: 'ליטר' },
  ],
  steps: [{ id: 's1', text: 'מערבבים ואופים.', minutes: 40 }],
};

describe('cost and yield come from the same source of truth', () => {
  it('the grams in the ingredient table equal the shared table value', () => {
    const c = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const flourRow = c.rows.find((r) => r.ing.id === 'i1')!;
    const entry = lookupDensity('קמח לבן')!;
    expect(entry.gPer100).not.toBeNull();
    expect(flourRow.g).toBeCloseTo((2 * 240 * entry.gPer100!) / 100, 6);
    expect(flourRow.provenance.chain[0]?.densityKey).toBe('flour.white');
  });

  it('a 250 ml cup changes yield, cost per kilo and hydration together', () => {
    const a = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const b = compute(CUP_CAKE, [CUP_CAKE], { prefs: P250 });

    expect(a.totalG).toBeCloseTo(240 + 199.2 + 247.2, 6);
    expect(b.totalG).toBeCloseTo(250 + 207.5 + 257.5, 6);
    expect(b.totalG).toBeGreaterThan(a.totalG);

    // cost scales with the extra material
    expect(b.cost).toBeGreaterThan(a.cost);
    expect(b.cost / a.cost).toBeCloseTo(250 / 240, 6);

    // the ratio-based figures stay put, which is the correct behaviour
    expect(b.hydration).toBeCloseTo(a.hydration, 6);
    expect(b.costPerKg).toBeCloseTo(a.costPerKg, 6);
  });

  it('weight-only recipes are untouched by the cup setting', () => {
    const gramRecipe: Recipe = {
      id: 'g1',
      ingredients: [
        { id: 'a', name: 'קמח לבן', qty: 500, unit: 'גרם', flour: true, price: 5.4, priceUnit: 'ק"ג' },
        { id: 'b', name: 'מים', qty: 300, unit: 'מ"ל', liquid: true },
      ],
    };
    const a = compute(gramRecipe, [gramRecipe], { prefs: P240 });
    const b = compute(gramRecipe, [gramRecipe], { prefs: P250 });
    expect(a.totalG).toBe(800);
    expect(b.totalG).toBe(800);
    expect(a.cost).toBeCloseTo(b.cost, 12);
  });

  it('per-litre pricing uses the shared density, not a hard-coded 1.0', () => {
    const c = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const milk = c.rows.find((r) => r.ing.id === 'i3')!;
    // 1 cup of milk = 247.2 g, density 1.03 → 0.24 l → 0.24 × 6.5
    expect(milk.cost).toBeCloseTo((247.2 / 1.03 / 1000) * 6.5, 6);
  });

  it('a volume ingredient with no known density is unresolved, not priced at a guess', () => {
    const r: Recipe = {
      id: 'x',
      ingredients: [
        { id: 'a', name: 'תמצית סודית', qty: 100, unit: 'מ"ל', price: 80, priceUnit: 'ליטר' },
      ],
    };
    const c = compute(r, [r], { prefs: P240 });
    expect(c.unresolved).toHaveLength(1);
    expect(c.unresolved[0]?.name).toBe('תמצית סודית');
    expect(c.cost).toBe(0);
  });

  it('a per-litre price on a gram line with no density keeps the legacy 1.0 and warns', () => {
    const r: Recipe = {
      id: 'y',
      ingredients: [
        { id: 'a', name: 'תמצית סודית', qty: 200, unit: 'גרם', price: 80, priceUnit: 'ליטר' },
      ],
    };
    const c = compute(r, [r], { prefs: P240 });
    expect(c.unresolved).toHaveLength(0);
    expect(c.cost).toBeCloseTo((200 / 1 / 1000) * 80, 9);
    expect(c.warnings.join(' ')).toContain("1.0 גר'/מ\"ל");
  });
});

describe('scaling uses the same conversion engine', () => {
  it('a factor scales every row through toGrams, not through a second path', () => {
    const one = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const two = compute(CUP_CAKE, [CUP_CAKE], { factor: 2, prefs: P240 });
    expect(two.totalG).toBeCloseTo(one.totalG * 2, 6);
    expect(two.cost).toBeCloseTo(one.cost * 2, 6);
    for (const [i, row] of two.rows.entries()) {
      expect(row.g!).toBeCloseTo(one.rows[i]!.g! * 2, 6);
    }
  });

  it('scaling by units and by weight derive the same factor engine', () => {
    const base = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const byUnits = scaleFactor('units', 24, base);
    expect(byUnits).toBeCloseTo(24 / base.unitsActual, 9);
    const byWeight = scaleFactor('weight', base.actualYield * 3, base);
    expect(byWeight).toBeCloseTo(3, 9);
    expect(scaleFactor('recipe', 0, base)).toBe(1);
  });

  it('scale by available stock uses the chosen ingredient row', () => {
    const base = compute(CUP_CAKE, [CUP_CAKE], { prefs: P240 });
    const f = scaleFactor('stock', 480, base, 'i1'); // 480 g of flour on hand
    expect(f).toBeCloseTo(2, 9);
  });

  it('a scaled cup recipe still responds to the cup setting', () => {
    const a = compute(CUP_CAKE, [CUP_CAKE], { factor: 3, prefs: P240 });
    const b = compute(CUP_CAKE, [CUP_CAKE], { factor: 3, prefs: P250 });
    expect(b.totalG / a.totalG).toBeCloseTo(250 / 240, 6);
  });
});

describe('unresolvable ingredients are reported, never valued at a guess', () => {
  const MYSTERY: Recipe = {
    id: 'm1',
    ingredients: [
      { id: 'a', name: 'קמח לבן', qty: 1, unit: 'כוס', flour: true },
      { id: 'b', name: 'אבקת מאצ׳ה סינית', qty: 1, unit: 'כוס' },
    ],
  };

  it('lists the ingredient and leaves it out of the total', () => {
    const c = compute(MYSTERY, [MYSTERY], { prefs: P240 });
    expect(c.totalG).toBeCloseTo(120, 6); // flour only
    expect(c.unresolved).toHaveLength(1);
    expect(c.unresolved[0]?.name).toBe('אבקת מאצ׳ה סינית');
    expect(c.unresolved[0]?.reason).toContain('אין נתון אמין');
  });

  it('the row is present with g === null so the UI can render an explanation', () => {
    const c = compute(MYSTERY, [MYSTERY], { prefs: P240 });
    const row = c.rows.find((r) => r.ing.id === 'b')!;
    expect(row.g).toBeNull();
    expect(row.provenance.source).toBe('unavailable');
    expect(row.bakerPct).toBe(0);
  });

  it('the legacy engine would have invented 150 g per cup here', () => {
    const c = compute(MYSTERY, [MYSTERY], { prefs: P240 });
    expect(c.totalG).not.toBeCloseTo(270, 6);
  });
});

describe('professional calculations survive the merge', () => {
  const DOUGH: Recipe = {
    id: 'd1',
    yieldUnits: 12,
    unitWeight: 85,
    yieldActual: 1150,
    weightBefore: 100,
    weightAfter: 88,
    doughMode: true,
    ddt: 24,
    flourTemp: 21,
    roomTemp: 26,
    friction: 8,
    targetFC: 25,
    ingredients: [
      { id: 'a', name: 'קמח לחם 13% חלבון', qty: 500, unit: 'גרם', flour: true, price: 5.4, priceUnit: 'ק"ג' },
      { id: 'b', name: 'חלב 3%', qty: 250, unit: 'מ"ל', liquid: true, price: 6.5, priceUnit: 'ליטר' },
      { id: 'c', name: 'חמאה 82%', qty: 100, unit: 'גרם', liquid: true, price: 38, priceUnit: 'ק"ג' },
    ],
    steps: [],
  };

  it('raw and net hydration differ according to real water content', () => {
    const c = compute(DOUGH, [DOUGH], { prefs: DEFAULT_PREFS });
    const milkG = 250 * 1.03;
    expect(c.hydration).toBeCloseTo(((milkG + 100) / 500) * 100, 6);
    // milk 87% water, butter 16%
    expect(c.trueHydration).toBeCloseTo(
      ((milkG * 0.87 + 100 * 0.16) / 500) * 100,
      6,
    );
    expect(c.trueHydration).toBeLessThan(c.hydration);
  });

  it('a price with no price unit is named, not silently costed per kilo (QA finding 5)', () => {
    const r: Recipe = {
      id: 'no-unit',
      name: 'בלי יחידה',
      ingredients: [
        { id: 'a', name: 'קמח', qty: 350, unit: 'גרם', price: 4 },
        { id: 'b', name: 'חמאה', qty: 100, unit: 'גרם', price: 40, priceUnit: 'ק"ג' },
      ],
      steps: [],
    };
    const c = compute(r, [r], { prefs: DEFAULT_PREFS });
    expect(c.rows[0]!.priced).toBe(false);
    expect(c.rows[0]!.cost).toBe(0);
    expect(c.rows[1]!.priced).toBe(true);
    expect(c.cost).toBeCloseTo(4, 9);
    expect(c.warnings.some((w) => w.includes('בלי יחידת מחיר'))).toBe(true);
  });

  it('baking loss, scale weight and the 5% warning behave as specified', () => {
    const c = compute(DOUGH, [DOUGH], { prefs: DEFAULT_PREFS });
    expect(c.bakeLoss).toBeCloseTo(12, 6);
    expect(c.scaleWeight).toBeCloseTo(85 / 0.88, 6);
    expect(c.unitsActual).toBeCloseTo(1150 / (85 / 0.88), 6);
    // 11.91 actual against a target of 12 is a 0.8% gap — inside the 5% band
    expect(c.unitsWarn).toBe(false);
  });

  it('the 5% yield warning fires when the gap is real', () => {
    const off = { ...DOUGH, yieldActual: 1400 };
    const c = compute(off, [off], { prefs: DEFAULT_PREFS });
    expect(c.unitsWarn).toBe(true);
  });

  it('the three-temperature water rule is unchanged', () => {
    const c = compute(DOUGH, [DOUGH], { prefs: DEFAULT_PREFS });
    expect(c.waterTemp).toBe(3 * 24 - 21 - 26 - 8);
  });

  it('allergens are detected from names and from sub-recipes', () => {
    const c = compute(DOUGH, [DOUGH], { prefs: DEFAULT_PREFS });
    expect(c.allergens).toContain('גלוטן');
    expect(c.allergens).toContain('חלב');
  });

  /*
    STAGE-11 REGRESSION. An allergen the maker declared BY HAND on a base
    recipe used to stop at that base recipe. The base is deliberately called
    "תערובת סודית" — a name the allergen table knows nothing about — because a
    base called "פרלינה" resolves to nuts through its NAME and would pass this
    test while the roll-up was still broken. That coincidence is what hid the
    defect. Found while building the product label, where a missing allergen is
    not a display bug.
  */
  it('a manual allergen declared on a BASE recipe reaches the recipe that uses it', () => {
    const base: Recipe = {
      id: 'secret',
      name: 'תערובת סודית',
      isSub: true,
      manualAllergens: ['אגוזים'],
      yieldActual: 1000,
      ingredients: [{ id: 'b1', name: 'סוכר', qty: 1000, unit: 'g' }],
    };
    const cake: Recipe = {
      id: 'cake',
      name: 'עוגה',
      ingredients: [
        { id: 'c1', name: 'סוכר', qty: 200, unit: 'g' },
        { id: 'c2', name: 'תערובת סודית', subId: 'secret', qty: 100, unit: 'g' },
      ],
    };
    const c = compute(cake, [base, cake], { prefs: DEFAULT_PREFS });
    expect(c.allergens).toContain('אגוזים');
  });

  it('carries a manual allergen up through TWO levels of base recipe', () => {
    const deep: Recipe = {
      id: 'deep',
      name: 'בסיס פנימי',
      isSub: true,
      manualAllergens: ['שומשום'],
      yieldActual: 1000,
      ingredients: [{ id: 'd1', name: 'סוכר', qty: 1000, unit: 'g' }],
    };
    const mid: Recipe = {
      id: 'mid',
      name: 'בסיס אמצעי',
      isSub: true,
      yieldActual: 1000,
      ingredients: [{ id: 'm1', name: 'בסיס פנימי', subId: 'deep', qty: 1000, unit: 'g' }],
    };
    const top: Recipe = {
      id: 'top',
      name: 'מוצר',
      ingredients: [{ id: 't1', name: 'בסיס אמצעי', subId: 'mid', qty: 500, unit: 'g' }],
    };
    const c = compute(top, [deep, mid, top], { prefs: DEFAULT_PREFS });
    expect(c.allergens).toContain('שומשום');
  });

  it('sub-recipe cost is rolled up per gram', () => {
    const sub: Recipe = {
      id: 'sub',
      yieldActual: 1000,
      ingredients: [
        { id: 's1', name: 'שוקולד מריר 64%', qty: 600, unit: 'גרם', price: 62, priceUnit: 'ק"ג' },
        { id: 's2', name: 'שמנת מתוקה 38%', qty: 400, unit: 'גרם', price: 24, priceUnit: 'ליטר' },
      ],
    };
    const parent: Recipe = {
      id: 'parent',
      ingredients: [{ id: 'p1', name: 'גנאש', qty: 300, unit: 'גרם', subId: 'sub' }],
    };
    const subC = compute(sub, [sub, parent], { prefs: DEFAULT_PREFS });
    const parentC = compute(parent, [sub, parent], { prefs: DEFAULT_PREFS });
    expect(parentC.rows[0]?.cost).toBeCloseTo((subC.cost / 1000) * 300, 9);
  });

  it('a sub-recipe cycle is caught and reported instead of looping', () => {
    const a: Recipe = { id: 'A', ingredients: [{ id: '1', name: 'B', qty: 100, unit: 'גרם', subId: 'B' }] };
    const b: Recipe = { id: 'B', ingredients: [{ id: '2', name: 'A', qty: 100, unit: 'גרם', subId: 'A' }] };
    const c = compute(a, [a, b], { prefs: DEFAULT_PREFS });
    expect(c.totalG).toBe(100);
    expect(c.warnings.join(' ')).toContain('מעגל תת־מתכונים');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-11 — one weight is not a measurement.
//
// Before the recipe form asked for these two weights nothing could reach this
// state. The moment it did, "I typed the before-weight and got interrupted"
// became a normal thing for a real user to do, and the arithmetic had to have
// an answer for it that is not Infinity.
describe('bake loss needs BOTH weights', () => {
  const base = {
    id: 'loss',
    name: 'לחם',
    unitWeight: 85,
    ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 1000, unit: 'g', flour: true }],
    steps: [],
  };
  const prefs = DEFAULT_PREFS;

  it('reports no loss, and a finite scale weight, when only the before-weight is in', () => {
    const c = compute({ ...base, weightBefore: 1000 } as never, [], { prefs });
    expect(c.bakeLoss).toBe(0);
    expect(Number.isFinite(c.scaleWeight)).toBe(true);
    expect(c.scaleWeight).toBe(85);
  });

  it('and likewise when only the after-weight is in', () => {
    const c = compute({ ...base, weightAfter: 880 } as never, [], { prefs });
    expect(c.bakeLoss).toBe(0);
    expect(c.scaleWeight).toBe(85);
  });

  it('computes the loss once both are there', () => {
    const c = compute({ ...base, weightBefore: 1000, weightAfter: 880 } as never, [], { prefs });
    expect(c.bakeLoss).toBeCloseTo(12, 6);
    expect(c.scaleWeight).toBeCloseTo(85 / 0.88, 6);
  });

  it('keeps a real 0 apart from a blank: 0 after 1000 is a total loss', () => {
    const c = compute({ ...base, weightBefore: 1000, weightAfter: 0 } as never, [], { prefs });
    expect(c.bakeLoss).toBe(100);
    // 100% loss cannot produce a weight to scale to, and Infinity is not one.
    expect(c.scaleWeight).toBe(0);
  });

  it('refuses to invent a figure from weights that contradict each other', () => {
    // After heavier than before is a gain, not a loss — soaking, glazing, a
    // typo. Whatever it is, it is not a bake loss.
    const c = compute({ ...base, weightBefore: 800, weightAfter: 1000 } as never, [], { prefs });
    expect(c.bakeLoss).toBeCloseTo(-25, 6);
    expect(Number.isFinite(c.scaleWeight)).toBe(true);
  });

  it('treats an empty string as not measured, not as zero', () => {
    const c = compute({ ...base, weightBefore: '', weightAfter: '' } as never, [], { prefs });
    expect(c.bakeLoss).toBe(0);
    expect(c.scaleWeight).toBe(85);
  });
});
