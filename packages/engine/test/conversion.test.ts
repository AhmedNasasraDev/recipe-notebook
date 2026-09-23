import { describe, expect, it } from 'vitest';
import {
  DENSITY_TABLE,
  convert,
  gramsPerCup,
  lookupDensity,
  toGrams,
} from '../src/index.js';
import { DEFAULT_PREFS, prefsWithCup } from './helpers.js';

const P240 = prefsWithCup(240);
const P250 = prefsWithCup(250);

describe('B1 — the user\'s measuring tools reach every conversion', () => {
  it('2 cups of flour weighs more with a 250 ml cup than with a 240 ml cup', () => {
    const ing = { name: 'קמח לבן', qty: 2, unit: 'cup' };
    const a = convert(ing, 'g', P240);
    const b = convert(ing, 'g', P250);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toBeCloseTo(240, 6);
    expect(b.value).toBeCloseTo(250, 6);
    expect(b.value).toBeGreaterThan(a.value);
  });

  it('toGrams — the function every calculation uses — is tool aware', () => {
    const ing = { name: 'קמח', qty: 2, unit: 'כוס' };
    expect(toGrams(ing, P240).grams).toBeCloseTo(240, 6);
    expect(toGrams(ing, P250).grams).toBeCloseTo(250, 6);
  });

  it('tablespoon and teaspoon follow their OWN settings, not cup/16 and cup/48', () => {
    const ing = { name: 'קמח', qty: 1, unit: 'כף' };
    // default: 15 ml → 7.5 g, identical to the legacy cup/16 at a 240 ml cup
    expect(toGrams(ing, DEFAULT_PREFS).grams).toBeCloseTo(7.5, 6);
    // Australian 20 ml spoon → 10 g, which the legacy engine could not express
    const au = prefsWithCup(240, { tools: { cup: 240, tbsp: 20, tsp: 5 } });
    expect(toGrams(ing, au).grams).toBeCloseTo(10, 6);
  });

  it('a 250 ml cup does not disturb weight-only ingredients', () => {
    const ing = { name: 'סוכר', qty: 500, unit: 'גרם' };
    expect(toGrams(ing, P240).grams).toBe(500);
    expect(toGrams(ing, P250).grams).toBe(500);
  });

  it('the tool note states the size actually in force', () => {
    const r = convert({ name: 'קמח', qty: 1, unit: 'cup' }, 'g', P250);
    expect(r.provenance.toolNote).toContain('250');
  });
});

describe('flour, cornstarch and powdered sugar', () => {
  it('flour: 1 cup at 240 ml = 120 g, from the shared table', () => {
    const r = convert({ name: 'קמח לחם 13% חלבון', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(120, 6);
    expect(r.provenance.source).toBe('system');
    expect(r.provenance.chain[0]?.densityKey).toBe('flour.white');
  });

  it('cornstarch resolves from the table, not from the legacy 150 g/cup guess', () => {
    const entry = lookupDensity('קורנפלור');
    expect(entry?.key).toBe('starch.corn');
    expect(entry?.gPer100).toBe(50);
    const r = convert({ name: 'קורנפלור', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(120, 6);
    // the quarantined legacy fallback would have produced 150
    expect(r.value).not.toBeCloseTo(150, 6);
  });

  it('powdered sugar is 46 g/100ml and does NOT inherit the cocoa grouping', () => {
    const powdered = lookupDensity('אבקת סוכר');
    const cocoa = lookupDensity('קקאו');
    expect(powdered?.gPer100).toBe(46);
    expect(powdered?.key).not.toBe(cocoa?.key);
    // cocoa itself is unvalued pending verification — see the cocoa block below
    expect(cocoa?.gPer100).toBeNull();
  });

  it('vanilla icing sugar still resolves as powdered sugar (order-based lookup)', () => {
    expect(lookupDensity('אבקת סוכר וניל')?.key).toBe('sugar.powdered');
  });

  it('whole-wheat flour is its own row, granulated sugar is its own row', () => {
    expect(lookupDensity('קמח מלא')?.key).toBe('flour.wholemeal');
    expect(lookupDensity('קמח מלא')?.gPer100).toBeNull(); // pending verification
    expect(lookupDensity('קמח לבן')?.gPer100).toBe(50);
    expect(lookupDensity('סוכר')?.gPer100).toBe(83);
    expect(lookupDensity('סוכר חום')?.gPer100).toBe(79);
  });
});

describe('cocoa — conflicting values, so no value at all', () => {
  const cocoa = DENSITY_TABLE.find((r) => r.key === 'cocoa')!;

  it('carries no value, and keeps every legacy candidate on record', () => {
    expect(cocoa.gPer100).toBeNull();
    expect(cocoa.resolution).toBe('pending-verification');
    expect(cocoa.sources['measure.TABLE']).toBe(42);
    expect(cocoa.sources['engine.CUP_DRY']).toBeCloseTo(45.83, 2);
    expect(cocoa.sources['parser.DRY']).toBeCloseTo(45.83, 2);
  });

  it('is flagged for professional review, not silently resolved', () => {
    expect(cocoa.needsReview).toBe(true);
    expect(cocoa.reviewNote).toContain('9.1%');
    expect(cocoa.reviewNote).toContain('אין ערך בשימוש עד אימות');
  });

  it('converting a cup of cocoa is refused, with the conflict spelled out', () => {
    const r = convert({ name: 'קקאו', qty: 1, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toContain('נתונים סותרים');
    expect(r.provenance.source).toBe('unavailable');
  });

  it('gramsPerCup returns null rather than a number', () => {
    expect(gramsPerCup(cocoa, 240)).toBeNull();
  });
});

describe('oz versus fl oz — never a direct ratio', () => {
  it('10 oz of flour converts to fl oz only through its density', () => {
    const r = convert({ name: 'קמח לבן', qty: 10, unit: 'oz' }, 'floz', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(19.172, 3);
    expect(r.provenance.source).toBe('system');
    expect(r.provenance.exact).toBe(false);
  });

  it('with no density there is no oz → fl oz answer at all', () => {
    const r = convert({ name: 'אבקת מאצ׳ה סינית', qty: 10, unit: 'oz' }, 'floz', P240);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toContain('אין נתון אמין');
    expect(r.provenance.source).toBe('unavailable');
  });

  it('oz → g stays an exact weight ratio', () => {
    const r = convert({ name: 'כל דבר', qty: 1, unit: 'oz' }, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(28.3495, 6);
    expect(r.provenance.source).toBe('exact');
  });
});

describe('unknown ingredient — no invented conversion', () => {
  it('returns no number and explains how to fix it', () => {
    const r = convert({ name: 'אבקת מאצ׳ה סינית', qty: 2, unit: 'cup' }, 'g', P240);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toContain('אפשר לשקול כוס אחת ולהוסיף כיול אישי');
  });

  it('toGrams returns null rather than the legacy 150 g per cup', () => {
    const g = toGrams({ name: 'אבקת מאצ׳ה סינית', qty: 1, unit: 'כוס' }, P240);
    expect(g.grams).toBeNull();
    expect(g.provenance.source).toBe('unavailable');
  });

  it('an unrecognised unit is refused, not treated as grams', () => {
    const g = toGrams({ name: 'קמח', qty: 5, unit: 'חופן' }, P240);
    expect(g.grams).toBeNull();
    expect(g.provenance.why).toContain('יחידה לא מזוהה');
  });

  it('count units with no item weight are refused', () => {
    const r = convert({ name: 'תפוח', qty: 5, unit: 'unit' }, 'g', P240);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.why).toContain('אין משקל ליחידה');
  });
});

describe('count units', () => {
  it('uses the recipe item weight when present and marks it as such', () => {
    const r = convert(
      { name: 'ביצים', qty: 5, unit: "יח'", unitWeight: 55 },
      'g',
      P240,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(275);
    expect(r.provenance.source).toBe('recipe');
  });

  it('weight → count is offered, which the prototype drawer never exposed', () => {
    const r = convert(
      { name: 'ביצים', qty: 275, unit: 'גרם', unitWeight: 55 },
      'unit',
      P240,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(5, 6);
  });

  it('the average egg weight is an estimate, never exact', () => {
    const r = convert({ name: 'ביצים', qty: 3, unit: 'egg' }, 'g', P240);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(150);
    expect(r.provenance.source).toBe('estimate');
    expect(r.provenance.exact).toBe(false);
  });
});

describe('sub-recipes are weighed, never volume-converted (spec §18.6)', () => {
  it('refuses a volume target for a sub-recipe line', () => {
    const r = convert(
      { name: 'גנאש', qty: 300, unit: 'גרם', subId: 'ganache' },
      'cup',
      P240,
    );
    expect(r.ok).toBe(false);
  });

  it('allows a weight target', () => {
    const r = convert(
      { name: 'גנאש', qty: 300, unit: 'גרם', subId: 'ganache' },
      'kg',
      P240,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(0.3, 6);
  });
});
