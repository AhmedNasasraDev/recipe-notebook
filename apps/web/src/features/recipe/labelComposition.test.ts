// §2 screen 8 — the ingredient declaration.
//
// These tests are about a food label, so they are written against the failure
// that matters: a declaration that looks authoritative and is wrong. The
// decisive ones are "an unresolved ingredient takes the percentages away" and
// "a base recipe is declared by its contents".

import { describe, expect, it } from 'vitest';
import { compute, type Recipe } from '@recipe-notebook/engine';
import { composition, declarationText } from './labelComposition.js';

const GANACHE: Recipe = {
  id: 'ganache',
  name: 'גנאש',
  isSub: true,
  yieldActual: 1000,
  ingredients: [
    { id: 'g1', name: 'שוקולד מריר', qty: 600, unit: 'g' },
    { id: 'g2', name: 'שמנת מתוקה', qty: 400, unit: 'g' },
  ],
};

const CAKE: Recipe = {
  id: 'cake',
  name: 'עוגת שוקולד',
  ingredients: [
    { id: 'c1', name: 'קמח לבן', qty: 300, unit: 'g' },
    { id: 'c2', name: 'סוכר', qty: 200, unit: 'g' },
    { id: 'c3', name: 'גנאש', subId: 'ganache', qty: 500, unit: 'g' },
  ],
};

const NOTEBOOK = [GANACHE, CAKE];

describe('descending by weight', () => {
  it('orders the declaration heaviest first, with shares that add to 100', () => {
    const c = composition(compute(CAKE, NOTEBOOK));
    expect(c.certain).toBe(true);
    const sum = c.lines.reduce((a, l) => a + (l.pct ?? 0), 0);
    expect(sum).toBeCloseTo(100, 6);
    const names = c.lines.map((l) => l.name);
    // 300 flour, 200 sugar, and the ganache's 500 g split 60/40 → 300 chocolate
    // and 200 cream. Flour and chocolate tie at 300 and are broken by name.
    expect(names.slice(0, 2).sort()).toEqual(['קמח לבן', 'שוקולד מריר'].sort());
    expect(c.lines.at(-1)?.grams).toBeLessThanOrEqual(c.lines[0]!.grams);
  });

  it('is stable: the same recipe declares the same order twice', () => {
    const a = declarationText(composition(compute(CAKE, NOTEBOOK)));
    const b = declarationText(composition(compute(CAKE, NOTEBOOK)));
    expect(a).toBe(b);
  });
});

describe('a base recipe is declared by its CONTENTS', () => {
  it('replaces the base line with what is inside it', () => {
    const c = composition(compute(CAKE, NOTEBOOK));
    const names = c.lines.map((l) => l.name);
    expect(names).toContain('שוקולד מריר');
    expect(names).toContain('שמנת מתוקה');
    // The base itself is NOT a line — declaring both would double the weight.
    expect(names).not.toContain('גנאש');
  });

  it('apportions the base by how much of it is used, not by its full batch', () => {
    // The cake uses 500 g of a 1000 g ganache batch, so half of each of its
    // ingredients: 300 g chocolate and 200 g cream.
    const c = composition(compute(CAKE, NOTEBOOK));
    const choc = c.lines.find((l) => l.name === 'שוקולד מריר')!;
    const cream = c.lines.find((l) => l.name === 'שמנת מתוקה')!;
    expect(choc.grams).toBeCloseTo(300, 6);
    expect(cream.grams).toBeCloseTo(200, 6);
  });

  it('adds an ingredient that appears in both the recipe and the base together', () => {
    const sweetBase: Recipe = {
      ...GANACHE,
      id: 'sweet',
      name: 'בסיס מתוק',
      ingredients: [
        { id: 's1', name: 'סוכר', qty: 500, unit: 'g' },
        { id: 's2', name: 'חמאה', qty: 500, unit: 'g' },
      ],
    };
    const r: Recipe = {
      id: 'r',
      name: 'מוצר',
      ingredients: [
        { id: 'r1', name: 'סוכר', qty: 100, unit: 'g' },
        { id: 'r2', name: 'בסיס מתוק', subId: 'sweet', qty: 400, unit: 'g' },
      ],
    };
    const c = composition(compute(r, [sweetBase, r]));
    // 100 g direct + 200 g through the base = 300 g of sugar on ONE line.
    expect(c.lines.filter((l) => l.name === 'סוכר')).toHaveLength(1);
    expect(c.lines.find((l) => l.name === 'סוכר')!.grams).toBeCloseTo(300, 6);
  });

  it('carries the roll-up through two levels of base recipe', () => {
    const inner: Recipe = {
      id: 'inner',
      name: 'בסיס פנימי',
      isSub: true,
      yieldActual: 1000,
      ingredients: [{ id: 'i1', name: 'שקדים', qty: 1000, unit: 'g' }],
    };
    const mid: Recipe = {
      id: 'mid',
      name: 'בסיס אמצעי',
      isSub: true,
      yieldActual: 1000,
      ingredients: [{ id: 'm1', name: 'בסיס פנימי', subId: 'inner', qty: 1000, unit: 'g' }],
    };
    const top: Recipe = {
      id: 'top',
      name: 'מוצר',
      ingredients: [{ id: 't1', name: 'בסיס אמצעי', subId: 'mid', qty: 250, unit: 'g' }],
    };
    const c = composition(compute(top, [inner, mid, top]));
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]!.name).toBe('שקדים');
    expect(c.lines[0]!.grams).toBeCloseTo(250, 6);
    expect(c.lines[0]!.pct).toBeCloseTo(100, 6);
  });
});

describe('what happens when a weight is not known', () => {
  it('takes EVERY percentage away, not just the missing one', () => {
    // A share is a share of a total. One unknown weight makes the total wrong,
    // so every other percentage is wrong too — and on a label that is not a
    // rounding problem, it is a false declaration.
    const r: Recipe = {
      id: 'r',
      name: 'מוצר',
      ingredients: [
        { id: 'a', name: 'קמח לבן', qty: 500, unit: 'g' },
        // A cup of something with no reliable density: no weight.
        { id: 'b', name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' },
      ],
    };
    const c = composition(compute(r, [r]));
    expect(c.certain).toBe(false);
    expect(c.lines.every((l) => l.pct === null)).toBe(true);
    expect(c.missing).toContain('אבקת מאצ׳ה');
  });

  it('names the missing ingredient rather than dropping it from the list', () => {
    const r: Recipe = {
      id: 'r',
      name: 'מוצר',
      ingredients: [{ id: 'b', name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' }],
    };
    const c = composition(compute(r, [r]));
    expect(c.missing).toEqual(['אבקת מאצ׳ה']);
    expect(c.certain).toBe(false);
  });

  it('an empty recipe is not a 0%-of-nothing declaration', () => {
    const r: Recipe = { id: 'r', name: 'מוצר', ingredients: [] };
    const c = composition(compute(r, [r]));
    expect(c.certain).toBe(false);
    expect(c.lines).toHaveLength(0);
  });

  it('an unnamed ingredient is declared as such, not as an empty line', () => {
    const r: Recipe = {
      id: 'r',
      name: 'מוצר',
      ingredients: [{ id: 'a', name: '  ', qty: 100, unit: 'g' }],
    };
    const c = composition(compute(r, [r]));
    expect(c.lines[0]!.name).toBe('רכיב ללא שם');
  });
});

describe('the declaration as text', () => {
  it('reads as a label line', () => {
    const text = declarationText(composition(compute(GANACHE, NOTEBOOK)));
    expect(text).toBe('שוקולד מריר (60.0%), שמנת מתוקה (40.0%)');
  });

  it('omits the percentages entirely when they are not established', () => {
    const r: Recipe = {
      id: 'r',
      name: 'מוצר',
      ingredients: [
        { id: 'a', name: 'קמח לבן', qty: 500, unit: 'g' },
        { id: 'b', name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' },
      ],
    };
    const text = declarationText(composition(compute(r, [r])));
    // Both names, no share for either: the unresolved one is still declared
    // (QA 22.09.2026, acceptance finding 5), just without a percentage.
    expect(text).toBe('קמח לבן, אבקת מאצ׳ה');
    expect(text).not.toContain('%');
  });
});

describe('an ingredient whose weight is unknown is still declared (QA 22.09.2026, finding 5)', () => {
  it('lists it by name, last and without a share, instead of dropping it', () => {
    const r: Recipe = {
      id: 'r',
      name: 'בריוש',
      ingredients: [
        { id: 'a', name: 'קמח לחם', qty: 500, unit: 'g' },
        { id: 'b', name: 'חמאה', qty: 250, unit: 'g' },
        // No weight per egg: unresolved, but plainly IN the product.
        { id: 'c', name: 'ביצים', qty: 4, unit: 'unit' },
      ],
    };
    const c = composition(compute(r, [r]));
    expect(c.certain).toBe(false);
    expect(c.missing).toEqual(['ביצים']);
    expect(c.lines.map((l) => l.name)).toEqual(['קמח לחם', 'חמאה', 'ביצים']);
    expect(c.lines.at(-1)).toEqual({ name: 'ביצים', grams: 0, pct: null });
    // The declaration sentence names it too — the same sentence that says
    // "מכיל: ביצים" must not omit the eggs from the ingredients.
    expect(declarationText(c)).toBe('קמח לחם, חמאה, ביצים');
  });
});
