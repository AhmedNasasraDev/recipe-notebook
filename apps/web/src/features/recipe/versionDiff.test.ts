// §9's versionDiff, and the version summary next to it.
//
// The algorithm is specified in §9, so most of these tests pin the specified
// behaviour rather than a choice of mine: which changes are detected, the
// three-name cap, the yield comparison being a FALLBACK, and "שינויים קלים"
// when nothing on the list was found.

import { describe, expect, it } from 'vitest';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { compareRecipes, versionDiff, versionSummary } from './versionDiff.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const R = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'r',
    name: 'לחם',
    yieldUnits: 2,
    unitWeight: 500,
    ingredients: [
      { id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', flour: true },
      { id: 'i2', name: 'מים', qty: 350, unit: 'g', liquid: true },
    ],
    steps: [{ id: 's1', text: 'ללוש' }],
    ...over,
  }) as Recipe;

const diff = (before: Recipe, after: Recipe) =>
  versionDiff({ before, after, recipes: [before, after], prefs });

describe('what §9 asks to be detected', () => {
  it('a name change', () => {
    expect(diff(R(), R({ name: 'לחם כוסמין' }))).toContain('שם השתנה');
  });

  it('an ingredient added', () => {
    const after = R({
      ingredients: [
        ...(R().ingredients ?? []),
        { id: 'i3', name: 'מלח', qty: 10, unit: 'g' },
      ],
    });
    expect(diff(R(), after)).toContain('נוסף מלח');
  });

  it('an ingredient removed', () => {
    const after = R({ ingredients: [R().ingredients![0]!] });
    expect(diff(R(), after)).toContain('הוסר מים');
  });

  it('a quantity change, naming the ingredient', () => {
    const after = R({
      ingredients: [
        { id: 'i1', name: 'קמח לבן', qty: 600, unit: 'g', flour: true },
        R().ingredients![1]!,
      ],
    });
    expect(diff(R(), after)).toContain('שונתה כמות: קמח לבן');
  });

  it('a change in the number of steps', () => {
    const after = R({ steps: [{ id: 's1', text: 'ללוש' }, { id: 's2', text: 'לאפות' }] });
    expect(diff(R(), after)).toContain('מספר השלבים שונה');
  });

  it('caps the quantity list at three names, per §9', () => {
    const before = R({
      ingredients: ['א', 'ב', 'ג', 'ד', 'ה'].map((n, i) => ({
        id: `x${i}`, name: n, qty: 100, unit: 'g',
      })),
    });
    const after = R({
      ingredients: ['א', 'ב', 'ג', 'ד', 'ה'].map((n, i) => ({
        id: `x${i}`, name: n, qty: 200, unit: 'g',
      })),
    });
    const out = diff(before, after);
    expect(out).toContain('ועוד');
    // three names, then the marker — not five names
    expect(out.split('ועוד')[0]!.split(',')).toHaveLength(3);
  });

  it('says "שינויים קלים" when nothing on the list changed', () => {
    // Same formula, a different note. Real, and not one of §9's categories.
    expect(diff(R(), R({ notes: 'להוסיף מלח בסוף' }))).toBe('שינויים קלים');
  });
});

describe('the yield comparison is a fallback, not an extra clause', () => {
  it('is reported when nothing else was detected', () => {
    // Recording a MEASURED yield moves `actualYield` without touching a name,
    // an ingredient, a quantity or a step — which is exactly the gap §9's
    // fallback exists for. (`yieldUnits` does not work here: it drives
    // `unitsActual`, not `actualYield`.)
    const out = diff(R(), R({ yieldActual: 800 }));
    expect(out).toBe('התשואה השתנתה');
  });

  it('is NOT appended to a quantity change', () => {
    // §9 consults it only when the list came up empty. Appending it to every
    // quantity change would be true and would say nothing new.
    const after = R({
      ingredients: [
        { id: 'i1', name: 'קמח לבן', qty: 900, unit: 'g', flour: true },
        R().ingredients![1]!,
      ],
    });
    const out = diff(R(), after);
    expect(out).toContain('שונתה כמות');
    expect(out).not.toContain('התשואה');
  });
});

describe('two departures from the prototype, both about honesty', () => {
  it('whitespace and gershayim variants are the same ingredient', () => {
    // The prototype keyed on the raw name, so "חמאה 82%" and "חמאה 82% "
    // read as one removed and one added. This uses the engine's identity —
    // the same one calibration matching uses (B4).
    const before = R({ ingredients: [{ id: 'i1', name: 'חמאה 82%', qty: 100, unit: 'g' }] });
    const after = R({ ingredients: [{ id: 'i1', name: 'חמאה 82% ', qty: 100, unit: 'g' }] });
    const out = diff(before, after);
    expect(out).not.toContain('נוסף');
    expect(out).not.toContain('הוסר');
  });

  it('a unit change that leaves the grams identical is not a quantity change', () => {
    // 2 cups at 240 ml of flour at 50 g/100 ml is exactly 240 g. The formula
    // did not move, and the prototype would have called this a change because
    // `qty` went from 2 to 240.
    const before = R({
      ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 2, unit: 'cup', flour: true }],
      steps: [],
    });
    const after = R({
      ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 240, unit: 'g', flour: true }],
      steps: [],
    });
    expect(diff(before, after)).not.toContain('שונתה כמות');
  });

  it('but a real change in an unweighable row IS reported', () => {
    // Cocoa in cups cannot be weighed, so grams cannot be compared. The
    // fallback compares what was written, and 1 cup to 2 cups is a change.
    const before = R({
      ingredients: [{ id: 'i1', name: 'קקאו', qty: 1, unit: 'cup' }],
      steps: [],
    });
    const after = R({
      ingredients: [{ id: 'i1', name: 'קקאו', qty: 2, unit: 'cup' }],
      steps: [],
    });
    expect(diff(before, after)).toContain('שונתה כמות: קקאו');
  });

  it('reports a sub-recipe link change, which §9 does not list', () => {
    // Not in §9's categories, but it IS a change to the formula, and
    // "שינויים קלים" would be a lie about it.
    const base = { id: 'base', name: 'גנאש', ingredients: [], steps: [] } as unknown as Recipe;
    const before = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g' }],
      steps: [],
    });
    const after = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g', subId: 'base' }],
      steps: [],
    });
    const out = versionDiff({ before, after, recipes: [base, before, after], prefs });
    expect(out).toContain('שונה מתכון הבסיס: מילוי');
  });
});

describe('two rows can share one identity', () => {
  // Found by the flow test: the fixture's rows both carried
  // `ingredient_key: 'flour.white'`, and the comparison keyed a Map on that
  // identity alone — so the two rows collapsed into one, the two sides ended up
  // with different row counts, and the description came out as the
  // self-contradictory "נוסף קמח מלא, מים · הוסר מים".
  //
  // Sharing an identity is legal: nothing constrains `ingredient_key` to be
  // unique within a recipe, and water added in two stages is an ordinary
  // sourdough formula.

  const twoStage = (firstQty: number, secondQty: number): Recipe =>
    R({
      ingredients: [
        { id: 'i1', name: 'מים', ingredientKey: 'water', qty: firstQty, unit: 'g', liquid: true },
        { id: 'i2', name: 'קמח לבן', ingredientKey: 'flour.white', qty: 500, unit: 'g', flour: true },
        { id: 'i3', name: 'מים', ingredientKey: 'water', qty: secondQty, unit: 'g', liquid: true },
      ],
      steps: [],
    });

  it('does not report an unchanged formula as an add plus a remove', () => {
    expect(diff(twoStage(100, 250), twoStage(100, 250))).toBe('שינויים קלים');
  });

  it('reports a change to the SECOND occurrence as a quantity change', () => {
    const out = diff(twoStage(100, 250), twoStage(100, 300));
    expect(out).toBe('שונתה כמות: מים');
  });

  it('reports a genuinely added occurrence as an addition', () => {
    const before = R({
      ingredients: [
        { id: 'i1', name: 'מים', ingredientKey: 'water', qty: 100, unit: 'g', liquid: true },
        { id: 'i2', name: 'קמח לבן', ingredientKey: 'flour.white', qty: 500, unit: 'g', flour: true },
      ],
      steps: [],
    });
    const out = diff(before, twoStage(100, 250));
    expect(out).toContain('נוסף מים');
    expect(out).not.toContain('הוסר');
  });

  it('names a repeated ingredient once, not once per row', () => {
    // Both water rows moved. "שונתה כמות: מים, מים" would waste two of the
    // three name slots §9 allows and tell the reader nothing extra.
    const out = diff(twoStage(100, 250), twoStage(150, 300));
    expect(out).toBe('שונתה כמות: מים');
  });
});

describe('the version summary (requirement 4)', () => {
  it('counts ingredients and steps, and gives the weight', () => {
    const out = versionSummary(R(), [R()], prefs);
    expect(out).toContain('2 רכיבים');
    expect(out).toContain('שלב אחד');
    expect(out).toContain('850 גר\'');
  });

  it('uses kilograms above a kilo', () => {
    const big = R({
      ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 2500, unit: 'g', flour: true }],
    });
    expect(versionSummary(big, [big], prefs)).toContain('2.5 ק"ג');
  });

  it('omits the weight entirely when it could not be established', () => {
    // A partial sum presented as "what this version weighed" would be wrong.
    const shaky = R({
      ingredients: [
        { id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', flour: true },
        { id: 'i2', name: 'קקאו', qty: 1, unit: 'cup' },
      ],
    });
    const out = versionSummary(shaky, [shaky], prefs);
    expect(out).toContain('2 רכיבים');
    expect(out).not.toMatch(/גר'|ק"ג/);
  });

  it('handles a version with no ingredients at all', () => {
    const empty = R({ ingredients: [], steps: [] });
    expect(versionSummary(empty, [empty], prefs)).toBe('0 רכיבים');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// `compareRecipes` — the structure the comparison screen renders
// (stage-6 requirements 9-12). `versionDiff` is a formatter over this, so the
// tests above already pin the summary; these pin the detail it is derived from.

describe('the recipe fields that are compared (requirement 9)', () => {
  it('reports a changed field with both sides', () => {
    const out = compareRecipes({
      before: R({ storage: 'במקרר' }),
      after: R({ storage: 'בהקפאה' }),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([
      { key: 'storage', label: 'אחסון', before: 'במקרר', after: 'בהקפאה' },
    ]);
  });

  it('covers the numeric and the text fields, not just the name', () => {
    const out = compareRecipes({
      before: R({ targetFC: 27.5, shelfLife: '3 ימים', equipment: 'מיקסר' }),
      after: R({ targetFC: 30, shelfLife: '5 ימים', equipment: 'מיקסר' }),
      recipes: [],
      prefs,
    });
    expect(out.fields.map((f) => f.key).sort()).toEqual(['shelfLife', 'targetFC']);
  });

  it('reports tags as a readable list rather than an array', () => {
    const out = compareRecipes({
      before: R({ tags: ['בדיקה'] }),
      after: R({ tags: ['בדיקה', 'כוסמין'] }),
      recipes: [],
      prefs,
    });
    expect(out.fields[0]).toMatchObject({ before: 'בדיקה', after: 'בדיקה, כוסמין' });
  });

  it('treats a flag as false when absent, not as unknown', () => {
    const out = compareRecipes({
      before: R(),
      after: R({ locked: true }),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([
      { key: 'locked', label: 'נוסחה מאושרת לייצור', before: false, after: true },
    ]);
  });

  it('leaves out identity, bookkeeping and event records', () => {
    // A version snapshot does not carry trials or batches, and `id` changing is
    // not a change to the formula. Reporting them would be noise at best.
    const out = compareRecipes({
      before: R({ id: 'a', createdAt: '2020-01-01', trials: [], versionOf: null } as never),
      after: R({ id: 'b', createdAt: '2026-01-01', trials: [{ id: 't' }], versionOf: 'x' } as never),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([]);
  });
});

describe('requirement 11 — null and 0 stay different values', () => {
  it('an absent number becoming 0 is a change, with the sides distinguishable', () => {
    const out = compareRecipes({
      before: R({ yieldActual: '' }),
      after: R({ yieldActual: 0 }),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([
      { key: 'yieldActual', label: 'תשואה מעשית', before: null, after: 0 },
    ]);
  });

  it('0 becoming absent is also a change, in the other direction', () => {
    const out = compareRecipes({
      before: R({ yieldActual: 0 }),
      after: R({ yieldActual: '' }),
      recipes: [],
      prefs,
    });
    expect(out.fields[0]).toMatchObject({ before: 0, after: null });
  });

  it('but the same number written two ways is not a change', () => {
    // The draft holds strings, the database holds numbers. `450` and `'450'`
    // are the same measurement and reporting them would be a false positive on
    // every recipe that had ever been through the form.
    const out = compareRecipes({
      before: R({ unitWeight: 500 }),
      after: R({ unitWeight: '500' }),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([]);
  });

  it('and an absent value is not equal to an empty string', () => {
    // Both are "nothing written", so this must NOT be reported — the
    // distinction that matters is nothing-vs-zero, not undefined-vs-''.
    const out = compareRecipes({
      before: R({ storage: undefined } as never),
      after: R({ storage: '' }),
      recipes: [],
      prefs,
    });
    expect(out.fields).toEqual([]);
  });
});

describe('requirement 12 — a missing price is not a price of 0', () => {
  const withPrice = (price: unknown): Recipe =>
    R({
      ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 500, unit: 'g', flour: true, price } as never],
      steps: [],
    });

  it('reports no-price becoming free', () => {
    const out = compareRecipes({
      before: withPrice(undefined),
      after: withPrice(0),
      recipes: [],
      prefs,
    });
    expect(out.changed).toHaveLength(1);
    expect(out.changed[0]!.fields).toEqual([
      { key: 'price', label: 'מחיר', before: null, after: 0 },
    ]);
  });

  it('reports free becoming unpriced', () => {
    const out = compareRecipes({
      before: withPrice(0),
      after: withPrice(undefined),
      recipes: [],
      prefs,
    });
    expect(out.changed[0]!.fields).toEqual([
      { key: 'price', label: 'מחיר', before: 0, after: null },
    ]);
  });

  it('does not report a price that did not move', () => {
    const out = compareRecipes({
      before: withPrice(4.25),
      after: withPrice(4.25),
      recipes: [],
      prefs,
    });
    expect(out.changed).toEqual([]);
  });
});

describe('requirement 10 — duplicated ingredients stay separate', () => {
  const twoStage = (first: number, second: number): Recipe =>
    R({
      ingredients: [
        { id: 'i1', name: 'מים', ingredientKey: 'water', qty: first, unit: 'g', liquid: true },
        { id: 'i2', name: 'קמח לבן', ingredientKey: 'flour.white', qty: 500, unit: 'g', flour: true },
        { id: 'i3', name: 'מים', ingredientKey: 'water', qty: second, unit: 'g', liquid: true },
      ],
      steps: [],
    });

  it('does not merge two rows that share an ingredient_key', () => {
    const out = compareRecipes({
      before: twoStage(100, 250),
      after: twoStage(100, 300),
      recipes: [],
      prefs,
    });
    // ONE of the two water rows moved, and it must be reported as one row and
    // not as the pair collapsing into a single changed entry.
    expect(out.changed).toHaveLength(1);
    expect(out.changed[0]!.name).toBe('מים');
    expect(out.changed[0]!.key).toBe('water#2');
    // the SECOND water row, 250 -> 300. The first is untouched at 100, which is
    // what "not merged" means here.
    expect(out.changed[0]!.fields).toEqual([
      { key: 'qty', label: 'כמות', before: 250, after: 300 },
    ]);
  });

  it('keys them by occurrence, so both can change independently', () => {
    const out = compareRecipes({
      before: twoStage(100, 250),
      after: twoStage(150, 300),
      recipes: [],
      prefs,
    });
    expect(out.changed.map((r) => r.key).sort()).toEqual(['water#1', 'water#2']);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  it('an added occurrence is an addition, not a change to the first one', () => {
    const before = R({
      ingredients: [
        { id: 'i1', name: 'מים', ingredientKey: 'water', qty: 100, unit: 'g', liquid: true },
        { id: 'i2', name: 'קמח לבן', ingredientKey: 'flour.white', qty: 500, unit: 'g', flour: true },
      ],
      steps: [],
    });
    const out = compareRecipes({ before, after: twoStage(100, 250), recipes: [], prefs });
    expect(out.added.map((r) => r.key)).toEqual(['water#2']);
    expect(out.changed).toEqual([]);
  });
});

describe('an added or removed ingredient carries what it was', () => {
  it('gives the written amount and the resolved grams', () => {
    const before = R({ ingredients: [], steps: [] });
    const after = R({
      ingredients: [{ id: 'i1', name: 'קמח לבן', qty: 2, unit: 'cup', flour: true }],
      steps: [],
    });
    const out = compareRecipes({ before, after, recipes: [], prefs });
    expect(out.added).toHaveLength(1);
    // 2 cups at 240 ml of white flour at 50 g/100 ml = 240 g, from the engine
    expect(out.added[0]).toMatchObject({ name: 'קמח לבן', written: '2 כוס', grams: 240 });
  });

  it('reports grams as null when the engine could not weigh it', () => {
    const before = R({ ingredients: [], steps: [] });
    const after = R({
      ingredients: [{ id: 'i1', name: 'קקאו', qty: 1, unit: 'cup' }],
      steps: [],
    });
    const out = compareRecipes({ before, after, recipes: [], prefs });
    // Not 0. A cup of cocoa has no reliable density, and calling it 0 g would
    // be the invented number the whole provenance chain exists to prevent.
    expect(out.added[0]!.grams).toBeNull();
  });
});

describe('a sub-recipe link shows the recipe, not its id', () => {
  const base = { id: 'base', name: 'גנאש', ingredients: [], steps: [] } as unknown as Recipe;

  it('names the base recipe on both sides', () => {
    const before = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g' }],
      steps: [],
    });
    const after = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g', subId: 'base' }],
      steps: [],
    });
    const out = compareRecipes({ before, after, recipes: [base, before, after], prefs });
    expect(out.changed[0]!.fields).toEqual([
      { key: 'subId', label: 'מתכון בסיס', before: null, after: 'גנאש' },
    ]);
  });

  it('falls back to the id for a recipe that is no longer visible', () => {
    // A version can reference a recipe that has since been deleted. Showing a
    // blank would read as "no base recipe", which is a different formula.
    const before = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g', subId: 'gone' }],
      steps: [],
    });
    const after = R({
      ingredients: [{ id: 'i1', name: 'מילוי', qty: 100, unit: 'g' }],
      steps: [],
    });
    const out = compareRecipes({ before, after, recipes: [before, after], prefs });
    expect(out.changed[0]!.fields).toEqual([
      { key: 'subId', label: 'מתכון בסיס', before: 'gone', after: null },
    ]);
  });
});

describe('the step count', () => {
  it('is reported as a before and after, not just "changed"', () => {
    const out = compareRecipes({
      before: R({ steps: [{ id: 's1', text: 'ללוש' }] }),
      after: R({ steps: [{ id: 's1', text: 'ללוש' }, { id: 's2', text: 'לאפות' }] }),
      recipes: [],
      prefs,
    });
    expect(out.steps).toEqual({ before: 1, after: 2 });
  });
});
