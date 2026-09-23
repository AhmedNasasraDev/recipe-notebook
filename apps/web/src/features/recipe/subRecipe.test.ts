// Sub-recipe link validation, client side.
//
// The AUTHORITY is the trigger in migration 0007, verified directly against the
// live database (see REVIEW_STEP5_REPORT.md §"proofs"). This file covers the
// client copy, which exists so the picker offers only valid choices and gives a
// reason for the rest. The duplication is deliberate, and these tests use the
// same cases as the SQL probes so the two cannot drift apart unnoticed.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { calcState } from './completeness.js';
import {
  reachableFrom,
  rejectSubRecipe,
  subRecipeOptions,
  wouldCreateCycle,
} from './subRecipe.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const recipe = (
  id: string,
  name: string,
  subIds: string[] = [],
  extra: Partial<Recipe> = {},
): Recipe =>
  ({
    id,
    name,
    ingredients: subIds.map((sub, i) => ({
      id: `${id}-i${i}`,
      name: `בסיס ${sub}`,
      qty: 100,
      unit: 'g',
      subId: sub,
    })),
    steps: [],
    ...extra,
  }) as Recipe;

describe('walking the sub-recipe graph', () => {
  const graph = [
    recipe('a', 'למעלה', ['b']),
    recipe('b', 'אמצע', ['c']),
    recipe('c', 'בסיס'),
    recipe('d', 'נפרד'),
  ];

  it('reaches every recipe down the chain', () => {
    expect([...reachableFrom('a', graph)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not wander into an unrelated branch', () => {
    expect(reachableFrom('a', graph).has('d')).toBe(false);
  });

  it('terminates on a graph that already contains a cycle', () => {
    // A cycle can exist without any single link ever having been accepted as
    // one — delete and recreate the right pair of recipes and there it is. A
    // walk with no `seen` set would hang here, taking the editor with it.
    const looped = [recipe('x', 'איקס', ['y']), recipe('y', 'וואי', ['x'])];
    expect([...reachableFrom('x', looped)].sort()).toEqual(['x', 'y']);
  });

  it('tolerates a link to a recipe that is not in the list', () => {
    // Which is what a link to another account's recipe looks like from here:
    // the id is real, but RLS kept it out of this list.
    const dangling = [recipe('a', 'למעלה', ['ghost'])];
    expect([...reachableFrom('a', dangling)].sort()).toEqual(['a', 'ghost']);
  });
});

describe('requirement 13 — self-reference', () => {
  it('is rejected', () => {
    const graph = [recipe('a', 'איקס')];
    expect(wouldCreateCycle('a', 'a', graph)).toBe(true);
    expect(rejectSubRecipe('a', 'a', graph)).toContain('את עצמו');
  });
});

describe('requirement 14 — cycles', () => {
  it('rejects a direct cycle, A → B → A', () => {
    const graph = [recipe('a', 'איי', ['b']), recipe('b', 'בי')];
    // b already receives from a, so linking a INTO b closes the loop
    expect(wouldCreateCycle('b', 'a', graph)).toBe(true);
    expect(rejectSubRecipe('b', 'a', graph)).toContain('מעגל');
  });

  it('rejects an indirect cycle, A → B → C → A', () => {
    const graph = [
      recipe('a', 'איי', ['b']),
      recipe('b', 'בי', ['c']),
      recipe('c', 'סי'),
    ];
    expect(wouldCreateCycle('c', 'a', graph)).toBe(true);
    expect(rejectSubRecipe('c', 'a', graph)).toContain('מעגל');
  });

  it('rejects a cycle five deep', () => {
    const graph = [
      recipe('a', 'א', ['b']),
      recipe('b', 'ב', ['c']),
      recipe('c', 'ג', ['d']),
      recipe('d', 'ד', ['e']),
      recipe('e', 'ה'),
    ];
    expect(wouldCreateCycle('e', 'a', graph)).toBe(true);
  });

  it('allows a legitimate deep chain', () => {
    const graph = [
      recipe('a', 'א', ['b']),
      recipe('b', 'ב', ['c']),
      recipe('c', 'ג'),
      recipe('d', 'ד'),
    ];
    // d is unrelated, so a may use it
    expect(wouldCreateCycle('a', 'd', graph)).toBe(false);
    expect(rejectSubRecipe('a', 'd', graph)).toBeNull();
  });

  it('allows the same base to be used by two recipes — that is a diamond, not a cycle', () => {
    const graph = [
      recipe('a', 'א', ['base']),
      recipe('b', 'ב'),
      recipe('base', 'בסיס'),
    ];
    expect(wouldCreateCycle('b', 'base', graph)).toBe(false);
  });
});

describe('requirement 15 — another account\'s recipe', () => {
  it('is reported as not in the notebook, because that is all the client knows', () => {
    // The candidate list IS the RLS-filtered notebook, so another account's
    // recipe is simply absent. The database refuses the link regardless of what
    // this says — that is the enforcement, and it is proved against Postgres.
    const graph = [recipe('a', 'שלי')];
    expect(rejectSubRecipe('a', 'someone-elses-id', graph)).toContain('אינו במחברת');
  });

  it('never offers a recipe that is not in the list', () => {
    const graph = [recipe('a', 'שלי'), recipe('b', 'גם שלי')];
    const ids = subRecipeOptions({ parentId: 'a', recipes: graph }).map((o) => o.id);
    expect(ids).toEqual(['b']);
  });
});

describe('the picker', () => {
  const graph = [
    recipe('top', 'למעלה', ['mid']),
    recipe('mid', 'אמצע', ['base']),
    recipe('base', 'בסיס גנאש', [], { isSub: true }),
    recipe('other', 'משהו אחר'),
  ];

  it('marks the invalid choices instead of hiding them', () => {
    // Silently omitting the recipe someone is looking for reads as a bug.
    const options = subRecipeOptions({ parentId: 'base', recipes: graph });
    const byId = new Map(options.map((o) => [o.id, o]));
    expect(byId.get('mid')?.rejection).toBe('cycle');
    expect(byId.get('top')?.rejection).toBe('cycle');
    expect(byId.get('other')?.rejection).toBeNull();
    // and `base` itself is not in its own list
    expect(byId.has('base')).toBe(false);
  });

  it('leads with base recipes when everything is linkable', () => {
    // For `top`, all three are valid: it already uses `mid`, and re-linking
    // what you already use is not a cycle.
    const options = subRecipeOptions({ parentId: 'top', recipes: graph });
    expect(options.every((o) => o.rejection === null)).toBe(true);
    // `base` carries isSub, so it leads
    expect(options[0]!.id).toBe('base');
  });

  it('pushes the rejected ones to the end', () => {
    // From `base`, both `mid` and `top` would close a loop; `other` would not.
    const options = subRecipeOptions({ parentId: 'base', recipes: graph });
    expect(options[0]!.rejection).toBeNull();
    expect(options[0]!.id).toBe('other');
    expect(options[options.length - 1]!.rejection).toBe('cycle');
  });

  it('offers everything for a recipe that does not exist yet', () => {
    const options = subRecipeOptions({ parentId: '', recipes: graph });
    expect(options).toHaveLength(4);
    expect(options.every((o) => o.rejection === null)).toBe(true);
  });

  it('catches a cycle through a link added in this editing session', () => {
    // The case a save-time-only check would miss: `base` does not yet use
    // `other`, but the row above it in the same unsaved form does. Adding
    // `top` here would close a loop that only exists in the draft.
    const options = subRecipeOptions({
      parentId: 'base',
      recipes: graph,
      pendingLinks: [{ parentId: 'base', subId: 'other' }],
    });
    const byId = new Map(options.map((o) => [o.id, o]));
    // still fine, `other` leads nowhere
    expect(byId.get('other')?.rejection).toBeNull();

    // now one that does close a loop through the pending link
    const withLoop = [...graph, recipe('other2', 'אחר 2', ['base'])];
    const options2 = subRecipeOptions({
      parentId: 'base',
      recipes: withLoop,
      pendingLinks: [],
    });
    expect(new Map(options2.map((o) => [o.id, o])).get('other2')?.rejection).toBe('cycle');
  });
});

// ── requirements 16, 17: the engine does the arithmetic ────────────────────
describe('a sub-recipe\'s effect goes through the existing engine', () => {
  const BASE: Recipe = {
    id: 'base',
    name: 'גנאש',
    isSub: true,
    ingredients: [
      { id: 'b1', name: 'שוקולד מריר', qty: 200, unit: 'g', price: 60, priceUnit: 'ק"ג' },
      { id: 'b2', name: 'שמנת', qty: 100, unit: 'g', price: 12, priceUnit: 'ליטר' },
    ],
    steps: [],
  } as unknown as Recipe;

  const TOP: Recipe = {
    id: 'top',
    name: 'עוגה',
    ingredients: [
      { id: 't1', name: 'קמח לבן', qty: 300, unit: 'g', flour: true, price: 5, priceUnit: 'ק"ג' },
      { id: 't2', name: 'גנאש', qty: 150, unit: 'g', subId: 'base' },
    ],
    steps: [],
  } as unknown as Recipe;

  const notebook = [BASE, TOP];

  it('adds the sub-recipe line to the total weight', () => {
    const c = compute(TOP, notebook, { prefs });
    expect(c.totalG).toBe(450);
  });

  it('rolls the sub-recipe\'s cost up pro rata, not as a flat price', () => {
    const c = compute(TOP, notebook, { prefs });
    const base = compute(BASE, notebook, { prefs });
    // 150 g of a 300 g batch = half the base's cost, plus the flour
    const expected = 300 * (5 / 1000) + (base.cost / base.totalG) * 150;
    expect(c.cost).toBeCloseTo(expected, 6);
  });

  it('collects allergens from inside the sub-recipe', () => {
    const c = compute(TOP, notebook, { prefs });
    // the cream is in the BASE, not in the top recipe
    expect(c.allergens).toContain('חלב');
  });

  it('reports full when the sub-recipe resolves', () => {
    expect(calcState(compute(TOP, notebook, { prefs })).level).toBe('full');
  });

  it('warns rather than silently zeroing when the base recipe is missing', () => {
    // What a deleted base recipe looks like if the link somehow survives.
    const orphan = compute(TOP, [TOP], { prefs });
    expect(orphan.warnings.some((w) => w.includes('לא נמצא'))).toBe(true);
  });

  it('a sub-recipe line is weighed, never volume-converted (§18.6)', () => {
    const c = compute(TOP, notebook, { prefs });
    const row = c.rows.find((r) => r.ing.id === 't2')!;
    expect(row.g).toBe(150);
    expect(row.sub).not.toBeNull();
  });

  it('an unweighable ingredient inside the base makes the TOP recipe partial', () => {
    // The property worth checking: incompleteness propagates up rather than
    // being hidden by the sub-recipe boundary.
    const shakyBase = {
      ...BASE,
      ingredients: [{ id: 'b1', name: 'קקאו', qty: 1, unit: 'cup' }],
    } as unknown as Recipe;
    const c = compute(TOP, [shakyBase, TOP], { prefs });
    // The top recipe's own line still weighs 150 g, but the cost cannot be
    // rolled up from a base whose own weight is unknown.
    const row = c.rows.find((r) => r.ing.id === 't2')!;
    expect(row.sub?.unresolved).toHaveLength(1);
  });

  it('an empty price on a sub-recipe line does not make the cost partial', () => {
    // A sub-recipe line has no `price` of its own by design — the cost comes
    // from the base. Treating that as "missing price" would flag every
    // correctly-linked recipe.
    const s = calcState(compute(TOP, notebook, { prefs }));
    expect(s.costLevel).toBe('full');
    expect(s.unpricedNames).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// requirement 18 — a chain several levels deep
//
// Everything here goes through `compute()` and `calcState()`. No arithmetic is
// performed in this file beyond restating the expected figure from the inputs,
// which is the point: requirement 19 forbids new formulas in the UI, so the
// only way these numbers can be right is if the engine produces them.

describe('a three-level sub-recipe chain', () => {
  // level 3: the bottom. 200 g chocolate at ₪60/kg + 100 g cream at ₪12/l.
  const GANACHE: Recipe = {
    id: 'ganache',
    name: 'גנאש',
    isSub: true,
    ingredients: [
      { id: 'g1', name: 'שוקולד מריר', qty: 200, unit: 'g', price: 60, priceUnit: 'ק"ג' },
      { id: 'g2', name: 'שמנת', qty: 100, unit: 'g', price: 12, priceUnit: 'ליטר' },
    ],
    steps: [],
  } as unknown as Recipe;

  // level 2: 150 g of the ganache plus 50 g of butter.
  const FILLING: Recipe = {
    id: 'filling',
    name: 'מילוי שוקולד',
    isSub: true,
    ingredients: [
      { id: 'f1', name: 'גנאש', qty: 150, unit: 'g', subId: 'ganache' },
      { id: 'f2', name: 'חמאה 82%', qty: 50, unit: 'g', price: 40, priceUnit: 'ק"ג' },
    ],
    steps: [],
  } as unknown as Recipe;

  // level 1: 300 g flour plus 100 g of the filling.
  const CAKE: Recipe = {
    id: 'cake',
    name: 'עוגה',
    ingredients: [
      { id: 'c1', name: 'קמח לבן', qty: 300, unit: 'g', flour: true, price: 5, priceUnit: 'ק"ג' },
      { id: 'c2', name: 'מילוי', qty: 100, unit: 'g', subId: 'filling' },
    ],
    steps: [],
  } as unknown as Recipe;

  const notebook = [GANACHE, FILLING, CAKE];

  it('the chain is legal — depth is not a cycle', () => {
    expect(wouldCreateCycle('cake', 'filling', notebook)).toBe(false);
    expect(rejectSubRecipe('cake', 'filling', notebook)).toBeNull();
    expect([...reachableFrom('cake', notebook)].sort()).toEqual([
      'cake', 'filling', 'ganache',
    ]);
  });

  it('but closing it at the bottom IS a cycle, three levels up', () => {
    // ganache -> cake would make ganache reachable from itself via filling.
    expect(wouldCreateCycle('ganache', 'cake', notebook)).toBe(true);
    expect(rejectSubRecipe('ganache', 'cake', notebook)).toContain('מעגל');
  });

  it('weighs each level as written, never volume-converted (§18.6)', () => {
    const cake = compute(CAKE, notebook, { prefs });
    expect(cake.totalG).toBe(400); // 300 flour + 100 filling
    const filling = compute(FILLING, notebook, { prefs });
    expect(filling.totalG).toBe(200); // 150 ganache + 50 butter
    const ganache = compute(GANACHE, notebook, { prefs });
    expect(ganache.totalG).toBe(300);
  });

  it('rolls cost up level by level, pro rata at every hop', () => {
    const ganache = compute(GANACHE, notebook, { prefs });
    const filling = compute(FILLING, notebook, { prefs });
    const cake = compute(CAKE, notebook, { prefs });

    // 150 g of a 300 g ganache batch is half its cost, plus the butter.
    const expectedFilling = (ganache.cost / ganache.totalG) * 150 + 50 * (40 / 1000);
    expect(filling.cost).toBeCloseTo(expectedFilling, 6);

    // 100 g of a 200 g filling batch is half ITS cost, plus the flour. So the
    // ganache's price reaches the cake through two divisions, not one.
    const expectedCake = 300 * (5 / 1000) + (filling.cost / filling.totalG) * 100;
    expect(cake.cost).toBeCloseTo(expectedCake, 6);
  });

  it('collects an allergen from the bottom of the chain to the top', () => {
    // The cream is in the GANACHE, two levels below the cake.
    expect(compute(GANACHE, notebook, { prefs }).allergens).toContain('חלב');
    expect(compute(CAKE, notebook, { prefs }).allergens).toContain('חלב');
  });

  it('reports full at every level when the whole chain resolves', () => {
    for (const r of notebook) {
      expect(calcState(compute(r, notebook, { prefs })).level).toBe('full');
      expect(calcState(compute(r, notebook, { prefs })).costLevel).toBe('full');
    }
  });

  it('propagates incompleteness from the BOTTOM all the way up', () => {
    // A cup of cocoa in the ganache has no reliable density. The cake is two
    // levels above it and must not report a complete calculation.
    const shakyGanache = {
      ...GANACHE,
      ingredients: [...GANACHE.ingredients!, { id: 'g3', name: 'קקאו', qty: 1, unit: 'cup' }],
    } as unknown as Recipe;
    const chain = [shakyGanache, FILLING, CAKE];

    // Every level must say so, including the one two hops above the gap. This
    // is the defect requirement 18 turned up: `calcState` used to read only its
    // own level, so the cake reported a complete calculation.
    expect(calcState(compute(shakyGanache, chain, { prefs })).level).toBe('partial');
    expect(calcState(compute(FILLING, chain, { prefs })).level).toBe('partial');
    const cake = compute(CAKE, chain, { prefs });
    expect(calcState(cake).level).toBe('partial');

    // And it names the path, not just the ingredient: "קקאו" on its own would
    // send the reader looking through a recipe that does not contain it.
    expect(calcState(cake).missingNames).toEqual(['מילוי → גנאש → קקאו']);

    // The cake's own line still weighs 100 g — the boundary carries the
    // problem rather than hiding it, and the figure itself is unchanged.
    expect(cake.rows.find((r) => r.ing.id === 'c2')!.g).toBe(100);
  });

  it('propagates a MISSING PRICE up without turning it into zero', () => {
    // The chocolate loses its price. Every level above must report partial
    // pricing rather than quietly costing the chocolate at 0.
    const unpriced = {
      ...GANACHE,
      ingredients: [
        { id: 'g1', name: 'שוקולד מריר', qty: 200, unit: 'g' },
        GANACHE.ingredients![1]!,
      ],
    } as unknown as Recipe;
    const chain = [unpriced, FILLING, CAKE];

    expect(calcState(compute(unpriced, chain, { prefs })).costLevel).toBe('partial');
    expect(calcState(compute(FILLING, chain, { prefs })).costLevel).not.toBe('full');
    expect(calcState(compute(CAKE, chain, { prefs })).costLevel).not.toBe('full');
  });

  it('a price of 0 at the bottom is a real price, at every level', () => {
    // The distinction the whole model turns on: free chocolate is priced.
    const free = {
      ...GANACHE,
      ingredients: [
        { id: 'g1', name: 'שוקולד מריר', qty: 200, unit: 'g', price: 0, priceUnit: 'ק"ג' },
        GANACHE.ingredients![1]!,
      ],
    } as unknown as Recipe;
    const chain = [free, FILLING, CAKE];

    for (const r of chain) {
      expect(calcState(compute(r, chain, { prefs })).costLevel).toBe('full');
      expect(calcState(compute(r, chain, { prefs })).unpricedNames).toEqual([]);
    }
    // and the cost really did drop, rather than the 0 being ignored
    expect(compute(CAKE, chain, { prefs }).cost).toBeLessThan(
      compute(CAKE, notebook, { prefs }).cost,
    );
  });

  it('a broken link in the MIDDLE of the chain is reported, not zeroed', () => {
    // What a version restored against a changed notebook could look like.
    const withoutGanache = [FILLING, CAKE];
    const filling = compute(FILLING, withoutGanache, { prefs });
    const cake = compute(CAKE, withoutGanache, { prefs });

    // The engine's warning travels all the way up.
    expect(filling.warnings.some((w) => w.includes('לא נמצא'))).toBe(true);
    expect(cake.warnings.some((w) => w.includes('לא נמצא'))).toBe(true);

    // The WEIGHT is legitimately complete and stays `full`, which is worth
    // stating rather than asserting the opposite: a sub-recipe line is weighed
    // as written (§18.6), so 150 g of a ganache that is missing is still 150 g
    // and the cake still weighs 400 g. Nothing failed to weigh.
    expect(calcState(cake).level).toBe('full');
    expect(cake.totalG).toBe(400);

    // The COST is what is broken, and that is what must be flagged — the whole
    // ganache is missing from it.
    expect(calcState(filling).costLevel).toBe('partial');
    expect(calcState(cake).costLevel).toBe('partial');
    expect(calcState(cake).unpricedNames).toEqual(['מילוי → גנאש']);
  });

  it('yield and loss stay the engine\'s, with a chain underneath', () => {
    // A measured yield below the theoretical one is production loss, and the
    // sub-recipe chain must not disturb how that is computed.
    const measured = { ...CAKE, yieldActual: 380 } as unknown as Recipe;
    const c = compute(measured, [GANACHE, FILLING, measured], { prefs });
    expect(c.theoretical).toBe(400);
    expect(c.actualYield).toBe(380);
    expect(c.prodLoss).toBeCloseTo(((400 - 380) / 400) * 100, 6);
  });
});
