// Stage-9 requirements 8-11: backward scheduling, overnight work, dependencies.
//
// The instructions' own example is the first test: a product due at 08:00 with
// an 8-hour chill, 30 minutes of shaping, 90 minutes of proofing and 25 minutes
// of baking must start the day before. The rest of the file is about the things
// that would quietly produce a plan someone gets up at 4am for: a step with no
// duration, a product with no ready time, and a dependency chain.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { scaleItems } from './explode.js';
import type { PlanItem } from './plan.js';
import { buildTimeline, classify, dependenciesOf, whenLabel } from './timeline.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: 'i1',
  recipeId: 'bread',
  qty: 10,
  qtyUnit: 'unit',
  readyAt: '08:00',
  note: '',
  ...over,
});

/** The instructions' own product: chill 8 h, shape 30 m, proof 90 m, bake 25 m. */
const bread = (steps?: Recipe['steps']): Recipe =>
  ({
    id: 'bread',
    name: 'לחם מחמצת',
    yieldUnits: 10,
    unitWeight: 100,
    ingredients: [{ id: 'b1', name: 'קמח לבן', qty: 1000, unit: 'g', flour: true }],
    steps:
      steps ??
      [
        { id: 's1', text: 'קירור בלילה', minutes: 480, kind: 'chill' },
        { id: 's2', text: 'עיצוב', minutes: 30, kind: 'active' },
        { id: 's3', text: 'התפחה', minutes: 90, kind: 'proof' },
        { id: 's4', text: 'אפייה', minutes: 25, temp: 240, kind: 'bake' },
      ],
  }) as Recipe;

const run = (items: PlanItem[], recipes: Recipe[], planDate = '2026-10-02') => {
  const scaled = scaleItems(items, recipes, prefs, (r, factor) =>
    compute(r, recipes, { factor, prefs }),
  );
  return buildTimeline(scaled, recipes, planDate, prefs);
};

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 8 — backwards from the hour it must be ready', () => {
  it('places every step back from 08:00', () => {
    const t = run([item()], [bread()]);
    const p = t.products[0]!;
    const [chill, shape, proof, bake] = p.steps;

    expect(bake!.end!.getHours()).toBe(8);
    expect(bake!.start!.getHours()).toBe(7);
    expect(bake!.start!.getMinutes()).toBe(35);
    // 07:35 − 90 m = 06:05
    expect(proof!.start!.getHours()).toBe(6);
    expect(proof!.start!.getMinutes()).toBe(5);
    // 06:05 − 30 m = 05:35
    expect(shape!.start!.getHours()).toBe(5);
    expect(shape!.start!.getMinutes()).toBe(35);
    // 05:35 − 8 h = 21:35 THE DAY BEFORE
    expect(chill!.start!.getHours()).toBe(21);
    expect(chill!.start!.getDate()).toBe(1);
    expect(p.partial).toBe(false);
  });

  it('distinguishes the kinds of step when they are declared', () => {
    const t = run([item()], [bread()]);
    const kinds = t.products[0]!.steps.map((s) => `${s.kind}/${s.kindSource}`);
    expect(kinds).toEqual([
      'chill/declared',
      'active/declared',
      'proof/declared',
      'bake/declared',
    ]);
  });

  it('falls back to the temperature, and says that is where it came from', () => {
    expect(classify({ minutes: 25, temp: 240 })).toEqual({
      kind: 'bake',
      source: 'temperature',
    });
    expect(classify({ minutes: 480, temp: 4 })).toEqual({
      kind: 'chill',
      source: 'temperature',
    });
    // Fahrenheit is converted before the comparison, not read as Celsius.
    expect(classify({ minutes: 25, temp: 425, tempUnit: 'F' })).toEqual({
      kind: 'bake',
      source: 'temperature',
    });
  });

  it('leaves a step unclassified rather than guessing from its text', () => {
    // "התפחה" in the text is not data. A room-temperature step says nothing
    // about whether it is work or waiting.
    expect(classify({ text: 'התפחה ראשונה', minutes: 90 })).toEqual({
      kind: null,
      source: 'none',
    });
    expect(classify({ text: 'ללוש', minutes: 12, temp: 22 })).toEqual({
      kind: null,
      source: 'none',
    });
  });

  it('a declared kind beats the temperature', () => {
    expect(classify({ minutes: 20, temp: 4, kind: 'active' })).toEqual({
      kind: 'active',
      source: 'declared',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 9 — the night before', () => {
  it('a 12-hour chill before a Friday 08:00 starts on Thursday', () => {
    // 2026-10-02 is a Friday.
    const t = run(
      [item()],
      [
        bread([
          { id: 'c', text: 'קירור', minutes: 720, kind: 'chill' },
          { id: 'b', text: 'אפייה', minutes: 30, kind: 'bake' },
        ]),
      ],
    );
    const chill = t.products[0]!.steps[0]!;
    // 08:00 − 30 m = 07:30; − 12 h = 19:30 on the 1st, a Thursday.
    expect(chill.start!.getDate()).toBe(1);
    expect(chill.start!.getDay()).toBe(4);
    expect(chill.start!.getHours()).toBe(19);
    expect(chill.start!.getMinutes()).toBe(30);
  });

  it('does not clamp the timeline at midnight', () => {
    const t = run([item()], [bread([{ id: 'x', text: 'קירור', minutes: 1500 }])]);
    const start = t.products[0]!.steps[0]!.start!;
    // 25 hours before Friday 08:00 is Thursday 07:00 — two calendar days back
    // from the plan date, and not 00:00 on the plan date.
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(7);
  });

  it('labels the day, because an hour alone would be a trap', () => {
    const t = run([item()], [bread()]);
    const label = whenLabel(t.products[0]!.steps[0]!.start);
    expect(label).toContain('01.10');
    expect(label).toContain('21:35');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 8 — a missing duration is not a guessed one', () => {
  it('stops the walk at the step with no duration and says so', () => {
    const t = run(
      [item()],
      [
        bread([
          { id: 's1', text: 'קירור', minutes: 480, kind: 'chill' },
          { id: 's2', text: 'עיצוב' },
          { id: 's3', text: 'אפייה', minutes: 25, kind: 'bake' },
        ]),
      ],
    );
    const p = t.products[0]!;
    // The baking still has a time: it ends when the product is due.
    expect(p.steps[2]!.start).not.toBeNull();
    // The step with no duration, and everything BEFORE it, has none.
    expect(p.steps[1]!.start).toBeNull();
    expect(p.steps[0]!.start).toBeNull();
    expect(p.partial).toBe(true);
    expect(p.problems.join(' ')).toContain('עיצוב');
  });

  it('has no timeline at all without a ready time, and says which line', () => {
    const t = run([item({ readyAt: null })], [bread()]);
    const p = t.products[0]!;
    expect(p.readyAt).toBeNull();
    expect(p.steps.every((s) => s.start === null)).toBe(true);
    expect(p.problems.join(' ')).toContain('שעת מוכנות');
  });

  it('says a recipe has no steps rather than drawing an empty schedule', () => {
    const t = run([item()], [bread([])]);
    expect(t.products[0]!.problems.join(' ')).toContain('אין שלבי הכנה');
    expect(t.partial).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 10-11 — several products, and dependencies', () => {
  const dough = (): Recipe =>
    ({
      id: 'dough',
      name: 'בצק',
      isSub: true,
      ingredients: [{ id: 'd1', name: 'קמח לבן', qty: 1000, unit: 'g', flour: true }],
      steps: [{ id: 'dd', text: 'לישה ומנוחה', minutes: 60, kind: 'passive' }],
    }) as Recipe;

  const tart = (): Recipe =>
    ({
      id: 'tart',
      name: 'טארט',
      yieldUnits: 10,
      unitWeight: 100,
      ingredients: [{ id: 't1', name: 'בצק', qty: 1000, unit: 'g', subId: 'dough' }],
      steps: [{ id: 'tt', text: 'אפייה', minutes: 30, temp: 180, kind: 'bake' }],
    }) as unknown as Recipe;

  it('shows both products in one combined list, in time order', () => {
    const t = run(
      [
        item({ id: 'a', recipeId: 'bread', readyAt: '08:00' }),
        item({ id: 'b', recipeId: 'tart', readyAt: '10:00' }),
      ],
      [bread(), tart(), dough()],
    );
    expect(t.products).toHaveLength(2);
    const placed = t.all.filter((s) => s.start !== null);
    for (let i = 1; i < placed.length; i += 1) {
      expect(placed[i]!.start!.getTime()).toBeGreaterThanOrEqual(
        placed[i - 1]!.start!.getTime(),
      );
    }
  });

  it('does not move a step to resolve an overlap', () => {
    // Two products baking at the same hour stay at the same hour: there is no
    // model of how many ovens there are, so there is nothing to optimise.
    const t = run(
      [
        item({ id: 'a', recipeId: 'bread', readyAt: '08:00' }),
        item({ id: 'b', recipeId: 'tart', readyAt: '08:00' }),
      ],
      [bread(), tart(), dough()],
    );
    const bakes = t.all.filter((s) => s.kind === 'bake' && s.start);
    expect(bakes).toHaveLength(2);
    expect(bakes[0]!.end!.getTime()).toBe(bakes[1]!.end!.getTime());
  });

  it('schedules a sub-recipe to finish before the product starts', () => {
    const t = run([item({ recipeId: 'tart', readyAt: '10:00' })], [tart(), dough()]);
    const p = t.products[0]!;
    const doughStep = p.steps.find((s) => s.forProduct === 'טארט')!;
    const bakeStep = p.steps.find((s) => s.text === 'אפייה')!;
    // The tart bakes 09:30-10:00, so the dough must be done by 09:30.
    expect(bakeStep.start!.getHours()).toBe(9);
    expect(doughStep.end!.getTime()).toBe(bakeStep.start!.getTime());
    expect(doughStep.start!.getHours()).toBe(8);
    expect(doughStep.start!.getMinutes()).toBe(30);
  });

  it('names the dependency on the product', () => {
    const t = run([item({ recipeId: 'tart' })], [tart(), dough()]);
    expect(t.products[0]!.dependencies.map((d) => d.name)).toEqual(['בצק']);
  });

  it('walks a deep chain A → B → C', () => {
    const c: Recipe = {
      id: 'c',
      name: 'C',
      isSub: true,
      ingredients: [{ id: 'c1', name: 'קמח לבן', qty: 100, unit: 'g' }],
      steps: [],
    } as Recipe;
    const b: Recipe = {
      id: 'b',
      name: 'B',
      isSub: true,
      ingredients: [{ id: 'b1', name: 'C', qty: 100, unit: 'g', subId: 'c' }],
      steps: [],
    } as Recipe;
    const a: Recipe = {
      id: 'a',
      name: 'A',
      yieldUnits: 1,
      unitWeight: 100,
      ingredients: [{ id: 'a1', name: 'B', qty: 100, unit: 'g', subId: 'b' }],
      steps: [],
    } as unknown as Recipe;

    const deps = dependenciesOf(a, [a, b, c]);
    expect(deps.map((d) => `${d.name}@${d.depth}`)).toEqual(['B@1', 'C@2']);
  });

  it('does not repeat a sub-recipe used twice in the same tree', () => {
    const shared: Recipe = {
      id: 'sh',
      name: 'משותף',
      isSub: true,
      ingredients: [],
      steps: [],
    } as unknown as Recipe;
    const parent: Recipe = {
      id: 'par',
      name: 'הורה',
      yieldUnits: 1,
      unitWeight: 100,
      ingredients: [
        { id: 'p1', name: 'משותף', qty: 50, unit: 'g', subId: 'sh' },
        { id: 'p2', name: 'משותף שוב', qty: 50, unit: 'g', subId: 'sh' },
      ],
      steps: [],
    } as unknown as Recipe;
    expect(dependenciesOf(parent, [parent, shared])).toHaveLength(1);
  });
});
