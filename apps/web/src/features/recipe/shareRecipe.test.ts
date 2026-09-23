// "שיתוף" (spec §8.1): the recipe as written, through the device's sheet or
// the clipboard — and never a link that needs the owner's account to open.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '@recipe-notebook/engine';
import { recipeShareText, shareRecipe } from './shareRecipe.js';

const R = {
  id: 'r1',
  name: 'בריוש',
  yieldUnits: 12,
  unitWeight: 85,
  ingredients: [
    { id: 'i1', name: 'קמח לחם', qty: 500, unit: 'g' },
    { id: 'i2', name: 'ביצים', qty: 5, unit: 'unit' },
    { id: 'i3', name: 'מלח', qty: '', unit: 'g' },
  ],
  steps: [{ id: 's1', text: 'ללוש' }, { id: 's2', text: 'לאפות' }],
  notes: 'להגיש חם',
  targetFC: 28,
} as unknown as Recipe;

afterEach(() => vi.unstubAllGlobals());

describe('the shared text', () => {
  it('is the recipe as written: name, yield, ingredients, steps, public notes — and no costs', () => {
    const t = recipeShareText(R);
    expect(t).toContain('בריוש');
    expect(t).toContain('12 יחידות');
    expect(t).toContain("- 500 גר' קמח לחם");
    expect(t).toContain("- 5 יח' ביצים");
    expect(t).toContain('- מלח');
    expect(t).toContain('1. ללוש');
    expect(t).toContain('2. לאפות');
    expect(t).toContain('להגיש חם');
    expect(t).not.toMatch(/28|פוד קוסט|₪/);
  });
});

describe('sharing', () => {
  it('uses the device share sheet when there is one', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, share });
    expect(await shareRecipe(R)).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'בריוש' }));
  });

  it('reports a closed sheet as cancelled, not as a failure', async () => {
    const share = vi.fn(async () => {
      const e = new Error('closed');
      e.name = 'AbortError';
      throw e;
    });
    vi.stubGlobal('navigator', { ...navigator, share });
    expect(await shareRecipe(R)).toBe('cancelled');
  });

  it('copies to the clipboard when the device cannot share', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareRecipe(R)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('קמח לחם'));
  });

  it('says so when neither works', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    expect(await shareRecipe(R)).toBe('failed');
  });
});
