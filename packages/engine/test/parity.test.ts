// Requirement §7: unify and fix, do not replace. These tests load the UNTOUCHED
// prototype from design_handoff_recipe_notebook/ and assert that, at factory
// tool sizes and on the real demo data, the new engine reproduces the old one.
//
// Where the two deliberately differ (the cocoa/nuts/rice conflicts, the invented
// 150 g-per-cup fallback) the difference is asserted explicitly, so no divergence
// can slip in unnoticed.

import { describe, expect, it } from 'vitest';
import { compute, convert, parseTime, parseTemp, toGrams } from '../src/index.js';
import { DEFAULT_PREFS, loadLegacy } from './helpers.js';

const legacy = loadLegacy();
const LEGACY_ENGINE = legacy.PN_ENGINE;
const LEGACY_PARSER = legacy.PN_PARSER;
const DEMO: any[] = legacy.PN_DATA.RECIPES;

describe('parity with the prototype on the five demo recipes', () => {
  it('loaded the untouched prototype', () => {
    expect(DEMO).toHaveLength(5);
    expect(typeof LEGACY_ENGINE.compute).toBe('function');
  });

  for (const recipe of DEMO) {
    it(`${recipe.name}: every computed figure matches`, () => {
      const old = LEGACY_ENGINE.compute(recipe, DEMO, 1);
      const nu = compute(recipe, DEMO, { factor: 1, prefs: DEFAULT_PREFS });

      expect(nu.unresolved, 'nothing should be unresolvable in the demo data').toEqual([]);

      expect(nu.totalG).toBeCloseTo(old.totalG, 9);
      expect(nu.theoretical).toBeCloseTo(old.theoretical, 9);
      expect(nu.actualYield).toBeCloseTo(old.actualYield, 9);
      expect(nu.prodLoss).toBeCloseTo(old.prodLoss, 9);
      expect(nu.bakeLoss).toBeCloseTo(old.bakeLoss, 9);
      expect(nu.scaleWeight).toBeCloseTo(old.scaleWeight, 9);
      expect(nu.unitsActual).toBeCloseTo(old.unitsActual, 9);
      expect(Boolean(nu.unitsWarn)).toBe(Boolean(old.unitsWarn)); // ours is a real boolean; legacy returned 0
      expect(nu.cost).toBeCloseTo(old.cost, 9);
      expect(nu.costPerUnit).toBeCloseTo(old.costPerUnit, 9);
      expect(nu.costPerKg).toBeCloseTo(old.costPerKg, 9);
      expect(nu.price).toBeCloseTo(old.price, 9);
      expect(nu.flour).toBeCloseTo(old.flour, 9);
      expect(nu.liquid).toBeCloseTo(old.liquid, 9);
      expect(nu.water).toBeCloseTo(old.water, 9);
      expect(nu.hydration).toBeCloseTo(old.hydration, 9);
      expect(nu.trueHydration).toBeCloseTo(old.trueHydration, 9);
      expect(nu.waterTemp === null ? null : Math.round(nu.waterTemp)).toBe(
        old.waterTemp === null ? null : Math.round(old.waterTemp),
      );
      expect([...nu.allergens].sort()).toEqual([...old.allergens].sort());

      expect(nu.rows).toHaveLength(old.rows.length);
      for (const [i, row] of nu.rows.entries()) {
        expect(row.g!).toBeCloseTo(old.rows[i].g, 9);
        expect(row.cost).toBeCloseTo(old.rows[i].cost, 9);
        expect(row.bakerPct).toBeCloseTo(old.rows[i].bakerPct, 9);
      }
    });
  }

  it('scaled computation matches too', () => {
    for (const recipe of DEMO) {
      for (const f of [0.5, 2, 3.75]) {
        const old = LEGACY_ENGINE.compute(recipe, DEMO, f);
        const nu = compute(recipe, DEMO, { factor: f, prefs: DEFAULT_PREFS });
        expect(nu.totalG).toBeCloseTo(old.totalG, 9);
        expect(nu.cost).toBeCloseTo(old.cost, 9);
        expect(nu.unitsActual).toBeCloseTo(old.unitsActual, 9);
      }
    }
  });
});

describe('toGrams parity at factory tool sizes — exact', () => {
  // Weight, volume and count paths must match the prototype to the last digit.
  const cases = [
    { name: 'קמח לחם 13% חלבון', qty: 500, unit: 'גרם' },
    { name: 'סוכר', qty: 1.5, unit: 'ק"ג' },
    { name: 'חלב 3%', qty: 250, unit: 'מ"ל' },
    { name: 'שמנת מתוקה 38%', qty: 0.4, unit: 'ליטר' },
    { name: 'מים', qty: 420, unit: 'מ"ל' },
    { name: 'ביצים', qty: 5, unit: "יח'", unitWeight: 55 },
    { name: 'קמח', qty: 2, unit: 'כוס' },
    { name: 'שמן', qty: 1, unit: 'כוס' },
  ];
  for (const c of cases) {
    it(`${c.qty} ${c.unit} ${c.name}`, () => {
      const old = LEGACY_ENGINE.toGrams(c);
      const nu = toGrams(c, DEFAULT_PREFS).grams;
      expect(nu).not.toBeNull();
      expect(nu!).toBeCloseTo(old, 6);
    });
  }
});

describe('toGrams parity — within the merged table\'s own rounding', () => {
  // measure.TABLE stores whole grams per 100 ml, so a cup of these lands within
  // ~1.3% of the legacy grams-per-cup figure. Well inside CONFLICT_TOLERANCE_PCT,
  // therefore not a conflict — but asserted so it can never quietly widen.
  const cases: Array<[any, number]> = [
    [{ name: 'סוכר', qty: 1, unit: 'כוס' }, 0.5],
    [{ name: 'חמאה', qty: 0.5, unit: 'כוס' }, 0.5],
    [{ name: 'מלח', qty: 1, unit: 'כפית' }, 0.5],
    [{ name: 'שיבולת שועל', qty: 1, unit: 'כוס' }, 1.5],
    [{ name: 'שוקולד', qty: 1, unit: 'כוס' }, 0.5],
    [{ name: 'אבקת סוכר', qty: 1, unit: 'כוס' }, 0.5],
    [{ name: 'סוכר חום', qty: 1, unit: 'כוס' }, 0.5],
  ];
  for (const [c, maxPct] of cases) {
    it(`${c.qty} ${c.unit} ${c.name} — within ${maxPct}%`, () => {
      const old = LEGACY_ENGINE.toGrams(c);
      const nu = toGrams(c, DEFAULT_PREFS).grams!;
      const deltaPct = Math.abs((nu - old) / old) * 100;
      expect(deltaPct).toBeLessThanOrEqual(maxPct);
      expect(deltaPct).toBeGreaterThan(0); // these genuinely differ slightly
    });
  }
});

describe('the deliberate, documented divergences', () => {
  it('cocoa: the prototype answered 110 g per cup, we refuse until verified', () => {
    const ing = { name: 'קקאו', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(110, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeNull();
  });

  it('almonds: the prototype answered 160 g per cup, we ask for the form', () => {
    const ing = { name: 'שקדים', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(160, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeNull();
  });

  it('rice: the prototype answered 160 g per cup, we refuse until verified', () => {
    const ing = { name: 'אורז', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(160, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeNull();
  });

  it('spirits: the two sources disagree, so we refuse; wine keeps its value', () => {
    expect(LEGACY_ENGINE.toGrams({ name: 'רום', qty: 100, unit: 'מ"ל' })).toBeCloseTo(94, 6);
    expect(toGrams({ name: 'רום', qty: 100, unit: 'מ"ל' }, DEFAULT_PREFS).grams).toBeNull();
    // wine has one uncontradicted source, so it still resolves
    expect(toGrams({ name: 'יין לבן', qty: 100, unit: 'מ"ל' }, DEFAULT_PREFS).grams!)
      .toBeCloseTo(98, 6);
  });

  it('eggs by volume are refused; eggs by the piece are unaffected', () => {
    expect(toGrams({ name: 'ביצים', qty: 1, unit: 'כוס' }, DEFAULT_PREFS).grams).toBeNull();
    expect(
      toGrams({ name: 'ביצים', qty: 5, unit: "יח'", unitWeight: 55 }, DEFAULT_PREFS).grams,
    ).toBe(275);
  });

  it('honey: the split tables made the prototype use 150 g/cup instead of 340.8', () => {
    // engine.DENS knew honey was 1.42 g/ml, but engine.cupGrams only consulted
    // DENS for names matching its liquid regex, which honey does not.
    const ing = { name: 'דבש', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(150, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams!).toBeCloseTo(340.8, 6);
  });

  it('syrup and yogurt were mis-weighed by the same split-table cause', () => {
    expect(LEGACY_ENGINE.toGrams({ name: 'סירופ', qty: 1, unit: 'כוס' })).toBeCloseTo(150, 6);
    expect(toGrams({ name: 'סירופ', qty: 1, unit: 'כוס' }, DEFAULT_PREFS).grams!).toBeCloseTo(319.2, 6);
    expect(LEGACY_ENGINE.toGrams({ name: 'יוגורט', qty: 1, unit: 'כוס' })).toBeCloseTo(150, 6);
    expect(toGrams({ name: 'יוגורט', qty: 1, unit: 'כוס' }, DEFAULT_PREFS).grams!).toBeCloseTo(249.6, 6);
  });

  it('an unknown ingredient: the prototype invented 150 g per cup, we refuse', () => {
    const ing = { name: 'אבקת מאצ׳ה סינית', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(150, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeNull();
  });

  it('almond flour: the prototype answered 120 g per cup, we refuse', () => {
    const ing = { name: 'קמח שקדים', qty: 1, unit: 'כוס' };
    expect(LEGACY_ENGINE.toGrams(ing)).toBeCloseTo(120, 6);
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeNull();
  });
});

describe('measure.js conversion parity where the prototype was already correct', () => {
  const LEGACY_MEASURE = legacy.PN_MEASURE;
  const prefs = { tools: { cup: 240, tbsp: 15, tsp: 5 }, calib: [] };

  const cases: Array<[any, string]> = [
    [{ name: 'קמח לבן', qty: 2, unit: 'cup' }, 'g'],
    [{ name: 'סוכר', qty: 1, unit: 'cup' }, 'g'],
    [{ name: 'חמאה', qty: 200, unit: 'g' }, 'cup'],
    [{ name: 'חלב', qty: 1, unit: 'cup' }, 'ml'],
    [{ name: 'קמח לבן', qty: 10, unit: 'oz' }, 'floz'],
    [{ name: 'ביצים', qty: 5, unit: 'unit', unitWeight: 55 }, 'g'],
    [{ name: 'מים', qty: 1, unit: 'l' }, 'ml'],
  ];

  for (const [ing, to] of cases) {
    it(`${ing.qty} ${ing.unit} ${ing.name} → ${to}`, () => {
      const old = LEGACY_MEASURE.convert(ing, to, prefs);
      const nu = convert(ing, to, prefs);
      expect(nu.ok).toBe(old.ok);
      if (nu.ok && old.ok) expect(nu.value).toBeCloseTo(old.value, 6);
    });
  }
});

describe('parser parity for the parts that had no defect', () => {
  const lines = [
    'שעתיים וחצי',
    'שעה וחצי',
    'חצי שעה',
    '2 שעות',
    '45 דקות',
    'מחממים ל-180 מעלות',
    'אופים ב־165 מעלות 18 דקות',
  ];
  for (const l of lines) {
    it(`"${l}"`, () => {
      expect(parseTime(l)).toBe(LEGACY_PARSER.parseTime(l));
      expect(parseTemp(l)).toBe(LEGACY_PARSER.parseTemp(l));
    });
  }
});
