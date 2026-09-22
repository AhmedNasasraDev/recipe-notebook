// "כמה להכין" in a URL — written by the recipe screen, read by the order
// sheet and by Cook Mode.
//
// The round trip is the point: what `scaleQuery` writes, `readScale` has to
// read back as the same factor, or the sheet somebody is weighing from shows
// different quantities than the screen they set. Both directions were copied
// per screen before Cook Mode needed them too; these tests are why one copy is
// enough.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { readScale, scaleQuery, SCALE_MODE_TEXT } from './scaleLink.js';

const PREFS = { ...defaultPrefs('pro'), done: true };

/** 1,000 g of flour and 700 g of water: the yield is 1,700 g. */
const BREAD = {
  id: 'bread',
  name: 'לחם',
  category: 'לחמים',
  ingredients: [
    { id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
    { id: 'i2', name: 'מים', qty: 700, unit: 'g', liquid: true },
  ],
  steps: [{ id: 's1', text: 'לאפות', minutes: 40 }],
} as unknown as Recipe;

const baseline = compute(BREAD, [BREAD], { prefs: PREFS });
const read = (search: string) => readScale(new URLSearchParams(search), baseline);

describe('writing the scale into a link', () => {
  it('writes nothing for "as written" — a plain URL says it more clearly', () => {
    expect(scaleQuery('recipe', '', '', 1)).toBe('');
    expect(scaleQuery('units', '12', '', 1)).toBe('');
  });

  it('writes the mode and the value', () => {
    expect(scaleQuery('weight', '3400', '', 2)).toBe('?mode=weight&v=3400');
  });

  it('carries the ingredient only for the mode that has one', () => {
    expect(scaleQuery('stock', '500', 'i1', 0.5)).toBe('?mode=stock&v=500&ing=i1');
    expect(scaleQuery('weight', '3400', 'i1', 2)).toBe('?mode=weight&v=3400');
  });
});

describe('reading it back', () => {
  it('is the recipe’s own quantities with no parameters at all', () => {
    expect(read('')).toEqual({ mode: 'recipe', factor: 1 });
  });

  it('rebuilds the factor with the engine’s rule', () => {
    // 3,400 g out of a 1,700 g recipe is ×2. This test does not do that
    // division — `scaleFactor` does, inside `readScale`.
    expect(read('?mode=weight&v=3400')).toEqual({ mode: 'weight', factor: 2 });
  });

  it('scales by the stock of one ingredient', () => {
    expect(read('?mode=stock&v=500&ing=i1')).toEqual({ mode: 'stock', factor: 0.5 });
  });

  it('falls back to the recipe rather than guessing at an unreadable parameter', () => {
    for (const bad of ['?mode=nonsense&v=2', '?mode=weight&v=', '?mode=weight&v=abc', '?mode=weight&v=0', '?mode=weight&v=-5']) {
      expect(read(bad)).toEqual({ mode: 'recipe', factor: 1 });
    }
  });

  it('reports "as written" for a value that produced no change', () => {
    // ×1 is indistinguishable from not scaling, and a screen should say the
    // honest one of the two.
    expect(read('?mode=weight&v=1700')).toEqual({ mode: 'recipe', factor: 1 });
  });

  it('cannot scale before the baseline exists', () => {
    expect(readScale(new URLSearchParams('?mode=weight&v=3400'), null)).toEqual({
      mode: 'recipe',
      factor: 1,
    });
  });
});

describe('the round trip, which is the reason both live in one file', () => {
  it('reads back exactly what was written', () => {
    for (const [mode, value, ing, factor] of [
      ['weight', '3400', '', 2],
      ['weight', '850', '', 0.5],
      ['stock', '500', 'i1', 0.5],
    ] as const) {
      const query = scaleQuery(mode, value, ing, factor);
      expect(read(query)).toEqual({ mode, factor });
    }
  });

  it('names each mode once, for every screen that shows it', () => {
    expect(SCALE_MODE_TEXT.recipe).toBe('כמויות כמו במתכון');
    expect(SCALE_MODE_TEXT.weight).toBe('לפי משקל סופי');
  });
});

describe('batches (QA 22.09.2026, §6)', () => {
  it('round-trips "two batches" and "half a batch" through the link', () => {
    expect(scaleQuery('batches', '2', '', 2)).toBe('?mode=batches&v=2');
    expect(readScale(new URLSearchParams('mode=batches&v=2'), baseline)).toEqual({ mode: 'batches', factor: 2 });
    expect(readScale(new URLSearchParams('mode=batches&v=0.5'), baseline)).toEqual({ mode: 'batches', factor: 0.5 });
  });
});
