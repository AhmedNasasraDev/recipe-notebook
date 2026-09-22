// The version-comparison screen (stage-6 requirements 7-13).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import type { StoredVersion } from '../../data/repository.js';
import { VersionCompare, formatCell } from './VersionCompare.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

/** The live recipe: 650 g flour at ₪4, 450 g water with no price. */
const LIVE: Recipe = {
  id: 'r1',
  name: 'לחם כוסמין',
  storage: 'בהקפאה',
  ingredients: [
    { id: 'i1', name: 'קמח מלא', qty: 650, unit: 'g', flour: true, price: 4, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'מים', qty: 450, unit: 'g', liquid: true },
    { id: 'i3', name: 'מלח', qty: 12, unit: 'g' },
  ],
  steps: [{ id: 's1', text: 'ללוש' }],
} as unknown as Recipe;

const version = (
  id: string,
  tag: string,
  snapshot: Partial<Recipe>,
  createdAt = '2026-03-12T14:20:00Z',
): StoredVersion => ({
  id,
  recipeId: 'r1',
  tag,
  what: 'שינוי',
  createdAt,
  snapshot: {
    id: 'r1',
    name: 'לחם כוסמין',
    ingredients: [],
    steps: [{ id: 's1', text: 'ללוש' }],
    ...snapshot,
  } as unknown as Recipe,
});

/** V1: 600 g flour with NO price, 420 g water, no salt, stored in the fridge. */
const V1 = version('v1', 'V1', {
  storage: 'במקרר',
  ingredients: [
    { id: 'i1', name: 'קמח מלא', qty: 600, unit: 'g', flour: true },
    { id: 'i2', name: 'מים', qty: 420, unit: 'g', liquid: true },
  ],
} as Partial<Recipe>);

/** V2: like the live recipe but the flour is free rather than ₪4. */
const V2 = version(
  'v2',
  'V2',
  {
    storage: 'בהקפאה',
    ingredients: [
      { id: 'i1', name: 'קמח מלא', qty: 650, unit: 'g', flour: true, price: 0, priceUnit: 'ק"ג' },
      { id: 'i2', name: 'מים', qty: 450, unit: 'g', liquid: true },
      { id: 'i3', name: 'מלח', qty: 12, unit: 'g' },
    ],
  } as Partial<Recipe>,
  '2026-03-14T09:05:00Z',
);

function renderCompare(
  opts: {
    versions?: StoredVersion[];
    recipe?: Recipe;
    from?: string;
    to?: string;
    recipes?: Recipe[];
  } = {},
) {
  const onClose = vi.fn();
  render(
    <VersionCompare
      recipe={opts.recipe ?? LIVE}
      versions={opts.versions ?? [V1, V2]}
      recipes={opts.recipes ?? [LIVE]}
      prefs={prefs}
      initialFrom={opts.from}
      initialTo={opts.to}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('requirement 7 — any two versions of the same recipe', () => {
  it('offers every version plus the live recipe, on both sides', async () => {
    renderCompare();
    for (const label of ['הגרסה להשוואה מצד אחד', 'הגרסה להשוואה מצד שני']) {
      const picker = screen.getByLabelText(label);
      const options = within(picker).getAllByRole('option').map((o) => o.textContent ?? '');
      expect(options.some((o) => o.includes('גרסה 1'))).toBe(true);
      expect(options.some((o) => o.includes('גרסה 2'))).toBe(true);
      expect(options.some((o) => o.includes('גרסה נוכחית'))).toBe(true);
    }
  });

  it('compares two OLD versions, with the live recipe out of it entirely', async () => {
    const user = userEvent.setup();
    renderCompare();
    await user.selectOptions(screen.getByLabelText('הגרסה להשוואה מצד אחד'), 'v1');
    await user.selectOptions(screen.getByLabelText('הגרסה להשוואה מצד שני'), 'v2');

    expect(screen.getByRole('status')).toHaveTextContent('גרסה 1');
    expect(screen.getByRole('status')).toHaveTextContent('גרסה 2');

    // V1 -> V2 added the salt. The live recipe also has salt, so a comparison
    // that quietly used it as one side would show no addition at all.
    const added = screen.getByLabelText('רכיבים שנוספו');
    expect(within(added).getByText('מלח')).toBeInTheDocument();
  });

  it('shows when each version was taken, so they can be told apart', () => {
    renderCompare();
    const picker = screen.getByLabelText('הגרסה להשוואה מצד אחד');
    expect(within(picker).getByRole('option', { name: /גרסה 1.*12\.03\.2026/ })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /גרסה 2.*14\.03\.2026/ })).toBeInTheDocument();
  });

  it('says so rather than showing an empty result when both sides are the same', async () => {
    const user = userEvent.setup();
    renderCompare();
    await user.selectOptions(screen.getByLabelText('הגרסה להשוואה מצד שני'), 'v1');
    await user.selectOptions(screen.getByLabelText('הגרסה להשוואה מצד אחד'), 'v1');
    expect(screen.getByText(/אותה גרסה נבחרה בשני הצדדים/)).toBeInTheDocument();
  });
});

describe('requirements 8 and 9 — added, removed, changed, across fields and ingredients', () => {
  it('lists what was added', () => {
    renderCompare({ from: 'v1', to: 'current' });
    const added = screen.getByLabelText('רכיבים שנוספו');
    expect(within(added).getByText('מלח')).toBeInTheDocument();
    expect(added).toHaveTextContent("12 גר'");
  });

  it('lists what was removed', () => {
    renderCompare({ from: 'current', to: 'v1' });
    const removed = screen.getByLabelText('רכיבים שהוסרו');
    expect(within(removed).getByText('מלח')).toBeInTheDocument();
  });

  it('lists what changed, per ingredient and per field', () => {
    renderCompare({ from: 'v1', to: 'current' });
    const changed = screen.getByLabelText('רכיבים שהשתנו');
    // the flour moved from 600 g to 650 g AND gained a price
    const flour = within(changed).getByLabelText('שינויים בקמח מלא');
    expect(within(flour).getByLabelText('כמות, לפני 600, אחרי 650')).toBeInTheDocument();
    expect(within(flour).getByText('מחיר')).toBeInTheDocument();
  });

  it('includes the recipe\'s own fields, not only the ingredients (requirement 9)', () => {
    renderCompare({ from: 'v1', to: 'current' });
    const fields = screen.getByLabelText('שדות שהשתנו');
    expect(within(fields).getByLabelText('אחסון, לפני במקרר, אחרי בהקפאה')).toBeInTheDocument();
  });

  it('reports a change in the number of steps', () => {
    const fewer = version('v3', 'V3', { steps: [] } as Partial<Recipe>);
    renderCompare({ versions: [fewer], from: 'v3', to: 'current' });
    const steps = screen.getByLabelText('שלבי ההכנה');
    expect(within(steps).getByLabelText('מספר השלבים, לפני 0, אחרי 1')).toBeInTheDocument();
  });

  it('carries the §9 one-line summary, from the same comparison', () => {
    renderCompare({ from: 'v1', to: 'current' });
    // Not recomputed here — `compareRecipes` returns it, so the line stored
    // with a version and this screen cannot disagree.
    expect(screen.getByText(/נוסף מלח/)).toBeInTheDocument();
  });

  it('says plainly when two versions are identical', () => {
    const same = version('vX', 'VX', {
      storage: 'בהקפאה',
      ingredients: LIVE.ingredients,
    } as Partial<Recipe>);
    renderCompare({ versions: [same], from: 'vX', to: 'current' });
    expect(screen.getByText(/אין הבדל בין שתי הגרסאות/)).toBeInTheDocument();
  });
});

describe('requirements 11 and 12 — null and 0 must not blur together', () => {
  it('renders an absent value as a dash and 0 as 0', () => {
    // The unit of the rule, before the component: an empty cell next to a 0
    // reads as the same thing, so absent has to LOOK like something.
    expect(formatCell(null)).toBe('—');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(false)).toBe('לא');
    expect(formatCell(true)).toBe('כן');
  });

  it('shows "no price" becoming "price 0" as a real change', () => {
    // V1's flour has no price at all; V2's costs 0. Same dash-vs-zero trap.
    renderCompare({ versions: [V1, V2], from: 'v1', to: 'v2' });
    const changed = screen.getByLabelText('רכיבים שהשתנו');
    const flour = within(changed).getByLabelText('שינויים בקמח מלא');
    // A dash where a 0 belongs, and a 0 where a dash belongs, are the two ways
    // this comparison could lie. The accessible name pins both sides.
    expect(within(flour).getByLabelText('מחיר, לפני ריק, אחרי 0')).toBeInTheDocument();
  });

  it('spells the empty side out for a screen reader rather than reading "—"', () => {
    renderCompare({ versions: [V1, V2], from: 'v1', to: 'v2' });
    const flour = within(screen.getByLabelText('רכיבים שהשתנו')).getByLabelText(
      'שינויים בקמח מלא',
    );
    // The visible text is the dash; the accessible name is the word.
    expect(within(flour).getByLabelText('מחיר, לפני ריק, אחרי 0')).toHaveTextContent('—');
  });
});

describe('requirement 10 — a duplicated ingredient stays two rows', () => {
  const twoStage = (first: number, second: number): Partial<Recipe> => ({
    ingredients: [
      { id: 'a', name: 'מים', ingredientKey: 'water', qty: first, unit: 'g', liquid: true },
      { id: 'b', name: 'קמח לבן', ingredientKey: 'flour.white', qty: 500, unit: 'g', flour: true },
      { id: 'c', name: 'מים', ingredientKey: 'water', qty: second, unit: 'g', liquid: true },
    ],
  });

  it('numbers them so the reader can tell which one moved', () => {
    const before = version('vA', 'VA', twoStage(100, 250));
    const live = { ...LIVE, storage: undefined, ...twoStage(100, 300) } as Recipe;
    renderCompare({ recipe: live, versions: [before], from: 'vA', to: 'current' });

    const changed = screen.getByLabelText('רכיבים שהשתנו');
    // "מים" twice with no way to distinguish them would be useless.
    expect(within(changed).getByLabelText('שינויים במים (2)')).toBeInTheDocument();
    expect(within(changed).queryByLabelText('שינויים במים (1)')).not.toBeInTheDocument();
  });

  it('does not report the untouched occurrence at all', () => {
    const before = version('vA', 'VA', twoStage(100, 250));
    const live = { ...LIVE, storage: undefined, ...twoStage(100, 300) } as Recipe;
    renderCompare({ recipe: live, versions: [before], from: 'vA', to: 'current' });
    expect(screen.getByLabelText('רכיבים שהשתנו').querySelectorAll('h4')).toHaveLength(1);
  });
});

describe('a snapshot with no content', () => {
  it('is reported rather than compared as "everything was removed"', () => {
    const broken = version('vB', 'VB', {});
    (broken.snapshot as Record<string, unknown>)['snapshotUnavailable'] = true;
    renderCompare({ versions: [broken], from: 'vB', to: 'current' });
    expect(screen.getByText(/אין תוכן שמור, ולכן אי אפשר להשוות/)).toBeInTheDocument();
    expect(screen.queryByLabelText('רכיבים שהוסרו')).not.toBeInTheDocument();
  });
});

describe('accessibility and closing', () => {
  it('is a named dialog', () => {
    renderCompare();
    expect(screen.getByRole('dialog', { name: 'השוואת גרסאות' })).toBeInTheDocument();
  });

  it('names the two pickers differently', () => {
    renderCompare();
    // Two identical "version" selects would be indistinguishable by name.
    expect(screen.getByLabelText('הגרסה להשוואה מצד אחד')).toBeInTheDocument();
    expect(screen.getByLabelText('הגרסה להשוואה מצד שני')).toBeInTheDocument();
  });

  it('closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderCompare();
    await user.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
