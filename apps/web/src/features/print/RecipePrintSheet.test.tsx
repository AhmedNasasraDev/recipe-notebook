// The printed recipe: exists only while printing, and prints only what the
// recipe knows (QA 22.09.2026, §2).

import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { PRINT_BODY_CLASS, PRINT_ROOT_ID, RecipePrintSheet } from './RecipePrintSheet.js';

const recipe: Recipe = {
  id: 'r1',
  name: 'בריוש חמאה',
  category: 'בצקים',
  yieldUnits: 12,
  unitWeight: 90,
  weightBefore: 1200,
  weightAfter: 1050,
  notes: 'להבריש בביצה לפני האפייה.',
  ingredients: [
    { id: 'a', name: 'קמח לחם', qty: 500, unit: 'g', flour: true },
    { id: 'b', name: 'חמאה', qty: 250, unit: 'g', note: 'קרה' },
  ],
  steps: [
    { id: 's1', text: 'ללוש 8 דקות', minutes: 8, kind: 'active' },
    { id: 's2', text: 'לאפות', minutes: 25, temp: '180', tempUnit: 'C', kind: 'bake' },
  ],
} as unknown as Recipe;

function show(over: Partial<Recipe> = {}) {
  const r = { ...recipe, ...over } as Recipe;
  const computed = compute(r, [r], { prefs: defaultPrefs() });
  return render(
    <RecipePrintSheet
      recipe={r}
      computed={computed}
      factor={1}
      scaleText="כמויות כמו במתכון"
      prefs={defaultPrefs()}
      imageUrl="blob:signed/r1/i1.webp"
    />,
  );
}

const root = () => document.getElementById(PRINT_ROOT_ID);
const printOn = () => act(() => { window.dispatchEvent(new Event('beforeprint')); });
const printOff = () => act(() => { window.dispatchEvent(new Event('afterprint')); });

describe('RecipePrintSheet', () => {
  it('puts nothing in the document until the browser is about to print', () => {
    show();
    expect(root()?.textContent ?? '').toBe('');
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(false);
  });

  it('renders the whole recipe for the printer, then takes it down', () => {
    show();
    printOn();
    const text = root()?.textContent ?? '';
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(true);
    expect(document.title).toContain('בריוש חמאה');
    expect(text).toContain('בריוש חמאה');
    expect(text).toContain('בצקים');
    expect(text).toContain('קמח לחם');
    expect(text).toContain('250 גר');
    expect(text).toContain('קרה');
    expect(text).toContain('ללוש 8 דקות');
    expect(text).toContain('180°C');
    expect(text).toContain('25 דק');
    expect(text).toContain('אפייה/בישול');
    expect(text).toContain('12 יחידות');
    expect(text).toContain('משקל לפני אפייה');
    expect(text).toContain('משקל אחרי אפייה');
    expect(text).toContain('33 דק'); // total time: 8 + 25
    expect(text).toContain('להבריש בביצה');
    expect(root()?.querySelector('img')?.getAttribute('src')).toBe('blob:signed/r1/i1.webp');
    // Nothing internal leaks onto paper.
    expect(text).not.toMatch(/§|\(88\)|S1|לא מצוין/);
    printOff();
    expect(root()?.textContent ?? '').toBe('');
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(false);
  });

  it('prints no line for a fact the recipe does not have', () => {
    show({ weightBefore: '', weightAfter: '', unitWeight: '', notes: '', yieldUnits: '' } as Partial<Recipe>);
    printOn();
    const text = root()?.textContent ?? '';
    expect(text).not.toContain('משקל לפני אפייה');
    expect(text).not.toContain('משקל ליחידה');
    expect(text).not.toContain('הערות');
    expect(text).not.toContain('לא מצוין');
    printOff();
  });
});
