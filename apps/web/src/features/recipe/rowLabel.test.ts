// QA 22.09.2026 (acceptance, finding 3): an ingredient the engine could not
// weigh printed "—" everywhere — on the recipe page, on the weighing list, on
// the print sheet — for a recipe that plainly says "4 ביצים". The written
// quantity is what the cook needs, marked as the recipe's own number.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { rowLabel } from './rowLabel.js';

const RECIPE: Recipe = {
  id: 'r',
  name: 'בריוש',
  ingredients: [
    { id: 'f', name: 'קמח לחם', qty: 500, unit: 'g', flour: true },
    // No weight per egg anywhere: the engine cannot resolve it.
    { id: 'e', name: 'ביצים', qty: 4, unit: 'unit' },
    { id: 'v', name: 'תמצית וניל', qty: 1, unit: 'tsp' },
  ],
};

const prefs = defaultPrefs();
const rows = () => compute(RECIPE, [RECIPE], { prefs }).rows;

describe('an ingredient without a resolved weight', () => {
  it('prints the written count in every view, and says it is the recipe\'s own number', () => {
    const eggs = rows()[1]!;
    expect(eggs.g).toBeNull();
    for (const view of ['orig', 'g', 'home'] as const) {
      const label = rowLabel(eggs, view, 1, prefs);
      expect(label.text).toBe("4 יח'");
      expect(label.hint).toBe('כמות לפי המתכון');
    }
  });

  it('scales the written count with the factor, like every other row', () => {
    const eggs = rows()[1]!;
    expect(rowLabel(eggs, 'g', 2, prefs).text).toBe("8 יח'");
  });

  it('never prints an English unit code', () => {
    const vanilla = rows()[2]!;
    const label = rowLabel(vanilla, 'g', 1, prefs);
    expect(label.text).toBe('1 כפית');
    expect(label.text).not.toMatch(/\b(tsp|unit|ml|g)\b/);
  });
});

describe('a resolved weight is unchanged by this', () => {
  it('prints grams in the gram view', () => {
    const flour = rows()[0]!;
    expect(rowLabel(flour, 'g', 1, prefs)).toEqual({ text: "500 גר'", hint: '' });
  });
});
