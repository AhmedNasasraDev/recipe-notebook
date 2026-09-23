// Stage-9 requirements 1-7: scaling, explosion, aggregation and purchasing.
//
// The numbers in these tests are the ones the instructions name — a recipe that
// yields 20 and a target of 100 is factor 5; 100 cookies needing 3 kg of dough
// must buy flour and not dough — plus the cases that silently produce a wrong
// shopping list: a missing yield, a material in two recipes, two materials with
// the same NAME and different identities, and an on-hand field left blank.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { explode, scaleItems } from './explode.js';
import { purchaseList } from './purchase.js';
import { scaleFor, type PlanItem } from './plan.js';
import type { CatalogItem } from '../pricing/catalog.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: 'i1',
  recipeId: 'cookies',
  qty: 100,
  qtyUnit: 'unit',
  readyAt: null,
  note: '',
  ...over,
});

/** 20 cookies of 50 g: 600 g flour, 300 g butter, 100 g sugar. */
const cookies = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: 'cookies',
    name: 'עוגיות ריבה',
    yieldUnits: 20,
    unitWeight: 50,
    ingredients: [
      { id: 'c1', name: 'קמח לבן', qty: 600, unit: 'g', flour: true },
      { id: 'c2', name: 'חמאה 82%', qty: 300, unit: 'g' },
      { id: 'c3', name: 'סוכר לבן', qty: 100, unit: 'g' },
    ],
    steps: [],
    ...over,
  }) as Recipe;

const cat = (over: Partial<CatalogItem>): CatalogItem => ({
  id: over.key ?? 'x',
  key: over.key ?? 'x',
  name: over.name ?? over.key ?? 'x',
  purchaseUnit: 'kg',
  packageQty: 1,
  packageCount: 1,
  purchaseTotal: 10,
  usablePct: null,
  supplier: '',
  purchasedAt: null,
  priceUpdatedAt: null,
  note: '',
  purchasePrice: 10,
  price: 10,
  priceUnit: 'ק"ג',
  allergens: [],
  ...over,
});

const run = (items: PlanItem[], recipes: Recipe[]) =>
  scaleItems(items, recipes, prefs, (r, factor) => compute(r, recipes, { factor, prefs }));

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 1 — the scale factor', () => {
  it('20 units becoming 100 is a factor of 5', () => {
    const s = scaleFor(item(), [cookies()], prefs);
    expect(s.factor).toBeCloseTo(5, 9);
    expect(s.recipeUnits).toBeCloseTo(20, 9);
  });

  it('scales by WEIGHT when the target is a weight', () => {
    // The batch weighs 1000 g. A target of 3 kg is a factor of 3.
    const s = scaleFor(item({ qty: 3, qtyUnit: 'kg' }), [cookies()], prefs);
    expect(s.factor).toBeCloseTo(3, 9);
  });

  it('reads grams and kilograms as the same target', () => {
    const a = scaleFor(item({ qty: 3, qtyUnit: 'kg' }), [cookies()], prefs);
    const b = scaleFor(item({ qty: 3000, qtyUnit: 'g' }), [cookies()], prefs);
    expect(a.factor).toBeCloseTo(b.factor!, 9);
  });

  it('does not round the ingredient quantities it produces', () => {
    // 30 of a 20-unit recipe is a factor of 1.5, and the flour is 900 g — not
    // 900 rounded from something, and not a "nice" number.
    const s = run([item({ qty: 30 })], [cookies()]);
    const flour = s[0]!.computed!.rows[0]!;
    expect(flour.g).toBeCloseTo(900, 9);
  });

  it('refuses a target of zero or less rather than producing a factor', () => {
    expect(scaleFor(item({ qty: 0 }), [cookies()], prefs).factor).toBeNull();
    expect(scaleFor(item({ qty: -5 }), [cookies()], prefs).factor).toBeNull();
  });

  it('says the recipe is missing rather than planning against nothing', () => {
    const s = scaleFor(item({ recipeId: 'nope' }), [cookies()], prefs);
    expect(s.factor).toBeNull();
    expect(s.why).toContain('לא נמצא');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 2 — a missing yield is not a yield of one', () => {
  const noUnits = cookies({ yieldUnits: 0, unitWeight: 0 });

  it('refuses a unit target when the recipe has no unit yield', () => {
    const s = scaleFor(item(), [noUnits], prefs);
    // NOT 1. `scaleFactor` would have returned 1, and a planner would have
    // bought ingredients for 20 cookies while expecting 100.
    expect(s.factor).toBeNull();
    expect(s.why).toContain('תפוקה ביחידות');
  });

  it('still allows a weight target for the same recipe', () => {
    const s = scaleFor(item({ qty: 2, qtyUnit: 'kg' }), [noUnits], prefs);
    expect(s.factor).toBeCloseTo(2, 9);
  });

  it('refuses a weight target when nothing can be weighed', () => {
    const nothing = { id: 'x', name: 'ריק', ingredients: [], steps: [] } as unknown as Recipe;
    const s = scaleFor(item({ recipeId: 'x', qty: 1, qtyUnit: 'kg' }), [nothing], prefs);
    expect(s.factor).toBeNull();
    expect(s.why).toContain('תפוקה במשקל');
  });

  it('reports the plan line as a problem instead of dropping it silently', () => {
    const ex = explode(run([item()], [noUnits]));
    expect(ex.lines).toHaveLength(0);
    expect(ex.partial).toBe(true);
    expect(ex.problems[0]!.product).toBe('עוגיות ריבה');
  });

  it('uses the MEASURED yield when the recipe has one', () => {
    // A measured 900 g from a theoretical 1000 g: 20 units of 50 g each still
    // come out as 18 real units, and the engine's own unitsActual says so.
    const measured = cookies({ yieldActual: 900 });
    const s = scaleFor(item({ qty: 36 }), [measured], prefs);
    expect(s.recipeUnits).toBeCloseTo(18, 6);
    expect(s.factor).toBeCloseTo(2, 6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 3 — sub-recipes are exploded, never bought', () => {
  /** 1 kg of dough: 600 g flour, 400 g butter. */
  const dough = (): Recipe =>
    ({
      id: 'dough',
      name: 'בצק פריך',
      isSub: true,
      ingredients: [
        { id: 'd1', name: 'קמח לבן', qty: 600, unit: 'g', flour: true },
        { id: 'd2', name: 'חמאה 82%', qty: 400, unit: 'g' },
      ],
      steps: [],
    }) as Recipe;

  /** 20 cookies use 600 g of dough and 100 g of jam. */
  const jamCookies = (): Recipe =>
    ({
      id: 'jam',
      name: 'עוגיות ריבה',
      yieldUnits: 20,
      unitWeight: 35,
      ingredients: [
        { id: 'j1', name: 'בצק פריך', qty: 600, unit: 'g', subId: 'dough' },
        { id: 'j2', name: 'ריבת משמש', qty: 100, unit: 'g' },
      ],
      steps: [],
    }) as Recipe;

  it('reaches the base materials and does not list the dough', () => {
    const ex = explode(run([item({ recipeId: 'jam' })], [jamCookies(), dough()]));
    const names = ex.lines.map((l) => l.name);
    expect(names).toContain('קמח לבן');
    expect(names).toContain('חמאה 82%');
    expect(names).toContain('ריבת משמש');
    // "בצק פריך" is not a thing anyone can buy.
    expect(names).not.toContain('בצק פריך');
  });

  it('works out how much of the sub-recipe is really needed', () => {
    // 100 cookies = factor 5 → 3000 g of dough → 1800 g flour + 1200 g butter.
    const ex = explode(run([item({ recipeId: 'jam' })], [jamCookies(), dough()]));
    const flour = ex.lines.find((l) => l.name === 'קמח לבן')!;
    const butter = ex.lines.find((l) => l.name === 'חמאה 82%')!;
    expect(flour.grams).toBeCloseTo(1800, 6);
    expect(butter.grams).toBeCloseTo(1200, 6);
  });

  it('goes down as many levels as there are', () => {
    // cake → filling → ganache → chocolate. 200 g of filling is 100 g of
    // ganache, which is 100 g of chocolate.
    const ganache: Recipe = {
      id: 'gan',
      name: 'גנאש',
      isSub: true,
      ingredients: [{ id: 'g1', name: 'שוקולד מריר', qty: 100, unit: 'g' }],
      steps: [],
    } as Recipe;
    const filling: Recipe = {
      id: 'fill',
      name: 'מלית',
      isSub: true,
      ingredients: [
        { id: 'f1', name: 'גנאש', qty: 100, unit: 'g', subId: 'gan' },
        { id: 'f2', name: 'גבינת שמנת', qty: 100, unit: 'g' },
      ],
      steps: [],
    } as Recipe;
    const cake: Recipe = {
      id: 'cake',
      name: 'עוגת גבינה',
      yieldUnits: 1,
      unitWeight: 200,
      ingredients: [{ id: 'k1', name: 'מלית', qty: 200, unit: 'g', subId: 'fill' }],
      steps: [],
    } as unknown as Recipe;

    const ex = explode(
      run([item({ recipeId: 'cake', qty: 4 })], [cake, filling, ganache]),
    );
    const names = ex.lines.map((l) => l.name);
    expect(names).toEqual(['גבינת שמנת', 'שוקולד מריר']);
    // 4 cakes → 800 g filling → 400 g ganache → 400 g chocolate
    expect(ex.lines.find((l) => l.name === 'שוקולד מריר')!.grams).toBeCloseTo(400, 6);
    expect(ex.lines.find((l) => l.name === 'גבינת שמנת')!.grams).toBeCloseTo(400, 6);
  });

  it('adds the shares when two products share a sub-recipe', () => {
    // This is addition, not double counting: each product needs its own dough.
    const other: Recipe = {
      id: 'tart',
      name: 'טארט',
      yieldUnits: 10,
      unitWeight: 100,
      ingredients: [{ id: 't1', name: 'בצק פריך', qty: 1000, unit: 'g', subId: 'dough' }],
      steps: [],
    } as unknown as Recipe;

    const ex = explode(
      run(
        [
          item({ id: 'a', recipeId: 'jam', qty: 100 }),
          item({ id: 'b', recipeId: 'tart', qty: 10 }),
        ],
        [jamCookies(), other, dough()],
      ),
    );
    const flour = ex.lines.find((l) => l.name === 'קמח לבן')!;
    // 3000 g of dough for the cookies + 1000 g for the tarts = 4000 g dough
    // → 2400 g flour. And the line names both products.
    expect(flour.grams).toBeCloseTo(2400, 6);
    expect(flour.products).toEqual(['עוגיות ריבה', 'טארט']);
  });

  it('does not offer an unlinked sub-recipe row as a material', () => {
    const broken: Recipe = {
      id: 'broken',
      name: 'שבור',
      yieldUnits: 1,
      unitWeight: 100,
      ingredients: [{ id: 'b1', name: 'בצק שנעלם', qty: 100, unit: 'g', subId: 'gone' }],
      steps: [],
    } as unknown as Recipe;
    const ex = explode(run([item({ recipeId: 'broken', qty: 1 })], [broken]));
    expect(ex.lines).toHaveLength(0);
    expect(ex.unresolved).toContain('בצק שנעלם');
    expect(ex.partial).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 4 — one line per material, by identity', () => {
  it('sums a material that appears in several recipes', () => {
    const other: Recipe = {
      id: 'bread',
      name: 'לחם',
      yieldUnits: 2,
      unitWeight: 500,
      ingredients: [{ id: 'b1', name: 'קמח לבן', qty: 1000, unit: 'g', flour: true }],
      steps: [],
    } as unknown as Recipe;

    const ex = explode(
      run(
        [
          item({ id: 'a', recipeId: 'cookies', qty: 20 }),
          item({ id: 'b', recipeId: 'bread', qty: 2 }),
        ],
        [cookies(), other],
      ),
    );
    const flour = ex.lines.filter((l) => l.name === 'קמח לבן');
    expect(flour).toHaveLength(1);
    expect(flour[0]!.grams).toBeCloseTo(1600, 6);
  });

  it('keeps two materials with the same NAME but different identities apart', () => {
    // The catalog identity wins over the display string, which is the whole
    // reason `ingredient_key` exists.
    const twin: Recipe = {
      id: 'twin',
      name: 'תאומים',
      yieldUnits: 1,
      unitWeight: 200,
      ingredients: [
        { id: 'x1', name: 'שוקולד', ingredientKey: 'שוקולד מריר 64%', qty: 100, unit: 'g' },
        { id: 'x2', name: 'שוקולד', ingredientKey: 'שוקולד חלב 33%', qty: 100, unit: 'g' },
      ],
      steps: [],
    } as unknown as Recipe;

    const ex = explode(run([item({ recipeId: 'twin', qty: 1 })], [twin]));
    expect(ex.lines).toHaveLength(2);
    expect(ex.lines.map((l) => l.key).sort()).toEqual(
      ['שוקולד חלב 33%', 'שוקולד מריר 64%'].sort(),
    );
  });

  it('aggregates by identity even when the names differ', () => {
    const twin: Recipe = {
      id: 'twin2',
      name: 'אותו דבר',
      yieldUnits: 1,
      unitWeight: 150,
      ingredients: [
        { id: 'y1', name: 'חמאה', ingredientKey: 'חמאה 82%', qty: 100, unit: 'g' },
        { id: 'y2', name: 'חמאת חלב 82%', ingredientKey: 'חמאה 82%', qty: 50, unit: 'g' },
      ],
      steps: [],
    } as unknown as Recipe;
    const ex = explode(run([item({ recipeId: 'twin2', qty: 1 })], [twin]));
    expect(ex.lines).toHaveLength(1);
    expect(ex.lines[0]!.grams).toBeCloseTo(150, 6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 5-7 — the purchase list', () => {
  const catalog = [
    cat({ key: 'קמח לבן', name: 'קמח לבן', purchaseUnit: 'kg', packageQty: 5, purchaseTotal: 20, purchasePrice: 4, price: 4 }),
    cat({ key: 'חמאה 82%', name: 'חמאה 82%', purchaseUnit: 'g', packageQty: 200, purchaseTotal: 8, purchasePrice: 40, price: 40 }),
    cat({ key: 'סוכר לבן', name: 'סוכר לבן', purchaseUnit: 'kg', packageQty: 1, purchaseTotal: 0, purchasePrice: 0, price: 0 }),
  ];
  const plan = () => explode(run([item({ qty: 100 })], [cookies()]));

  it('converts grams to the unit the material is sold in', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    // 100 cookies = factor 5 → 3000 g of flour
    expect(flour.required).toBeCloseTo(3, 9);
    expect(flour.unit).toBe('ק"ג');
  });

  it('shows the full requirement when no on-hand figure was entered', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    expect(flour.onHand).toBeNull();
    expect(flour.toBuy).toBeCloseTo(3, 9);
  });

  it('subtracts an on-hand figure that WAS entered', () => {
    const list = purchaseList(plan().lines, catalog, { 'קמח לבן': 2 }, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    expect(flour.onHand).toBe(2);
    expect(flour.toBuy).toBeCloseTo(1, 9);
  });

  it('treats an entered 0 as an empty shelf, not as "not entered"', () => {
    const list = purchaseList(plan().lines, catalog, { 'קמח לבן': 0 }, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    expect(flour.onHand).toBe(0);
    expect(flour.toBuy).toBeCloseTo(3, 9);
  });

  it('never asks for a negative purchase', () => {
    const list = purchaseList(plan().lines, catalog, { 'קמח לבן': 99 }, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    expect(flour.toBuy).toBe(0);
    expect(flour.packages).toBe(0);
  });

  it('rounds UP to whole packages and reports the remainder', () => {
    // 8.2 kg of flour from 5 kg sacks: buy 2, get 10 kg, 1.8 kg left over.
    const req = [
      {
        key: 'קמח לבן',
        name: 'קמח לבן',
        grams: 8200,
        sample: { id: 'f', name: 'קמח לבן', qty: 1, unit: 'g' },
        products: ['x'],
        partial: false,
      },
    ];
    const list = purchaseList(req, catalog, {}, prefs);
    const flour = list.lines[0]!;
    expect(flour.required).toBeCloseTo(8.2, 9);
    expect(flour.packages).toBe(2);
    expect(flour.buyQty).toBeCloseTo(10, 9);
    expect(flour.remainder).toBeCloseTo(1.8, 9);
  });

  it('does not round the production requirement to fit the package', () => {
    const req = [
      {
        key: 'קמח לבן',
        name: 'קמח לבן',
        grams: 8200,
        sample: { id: 'f', name: 'קמח לבן', qty: 1, unit: 'g' },
        products: ['x'],
        partial: false,
      },
    ];
    const list = purchaseList(req, catalog, {}, prefs);
    // 8.2, not 10, and not 8.
    expect(list.lines[0]!.required).toBeCloseTo(8.2, 9);
  });

  it('converts a package given in grams into the base unit', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    const butter = list.lines.find((l) => l.key === 'חמאה 82%')!;
    // 1500 g needed, 200 g packs → 0.2 kg each → 8 packs → 1.6 kg
    expect(butter.packageQty).toBeCloseTo(0.2, 9);
    expect(butter.packages).toBe(8);
    expect(butter.buyQty).toBeCloseTo(1.6, 9);
  });

  it('buys extra when a usable yield is declared', () => {
    // A recipe needing 3 kg of a material that is only 80% usable must buy
    // 3.75 kg — and the requirement itself stays 3 kg.
    const withWaste = [
      cat({ key: 'קמח לבן', purchaseUnit: 'kg', packageQty: 1, usablePct: 80, purchaseTotal: 4, purchasePrice: 4, price: 5 }),
    ];
    const list = purchaseList(plan().lines, withWaste, {}, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    expect(flour.required).toBeCloseTo(3, 9);
    expect(flour.requiredPurchase).toBeCloseTo(3.75, 9);
    expect(flour.packages).toBe(4);
  });

  it('costs the purchase at the AS-BOUGHT price', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    const flour = list.lines.find((l) => l.key === 'קמח לבן')!;
    // 3 kg needs ONE 5 kg sack; at ₪4/kg as bought that is ₪20, and the ₪20
    // is for the sack, not for the 3 kg the recipe uses.
    expect(flour.cost).toBeCloseTo(20, 6);
  });

  it('keeps a price of 0 as a real price of zero', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    const sugar = list.lines.find((l) => l.key === 'סוכר לבן')!;
    expect(sugar.unitPrice).toBe(0);
    expect(sugar.cost).toBe(0);
    expect(list.unpriced).not.toContain('סוכר לבן');
  });

  it('gives a full total when every material needed has a price', () => {
    const list = purchaseList(plan().lines, catalog, {}, prefs);
    expect(list.level).toBe('full');
    // one 5 kg sack ₪20 + butter 1.6 kg at ₪40 = ₪64 + free sugar ₪0
    expect(list.total).toBeCloseTo(84, 6);
  });

  it('withholds the total when a needed material has no price', () => {
    const noPrice = catalog.map((c) =>
      c.key === 'חמאה 82%' ? cat({ ...c, purchasePrice: null, price: null }) : c,
    );
    const list = purchaseList(plan().lines, noPrice, {}, prefs);
    expect(list.level).toBe('partial');
    expect(list.total).toBeNull();
    expect(list.unpriced).toContain('חמאה 82%');
    // what IS known stays on the line
    expect(list.lines.find((l) => l.key === 'קמח לבן')!.cost).toBeCloseTo(20, 6);
  });

  it('reports a material that is not in the centre at all', () => {
    const list = purchaseList(plan().lines, [catalog[0]!], {}, prefs);
    const butter = list.lines.find((l) => l.key === 'חמאה 82%')!;
    expect(butter.inCatalog).toBe(false);
    expect(butter.why).toContain('אינו במרכז חומרי הגלם');
    expect(list.level).toBe('partial');
  });

  it('has no purchase cost at all when nothing is priced', () => {
    const list = purchaseList(plan().lines, [], {}, prefs);
    expect(list.level).toBe('none');
    expect(list.total).toBeNull();
    expect(list.why).toContain('אין מחיר');
  });

  it('counts a material sold by the unit in units, not grams', () => {
    const eggs: Recipe = {
      id: 'eggy',
      name: 'עוגה',
      yieldUnits: 1,
      // 6 eggs at 55 g IS the batch, so one unit weighs 330 g and the factor
      // for 7 cakes is exactly 7.
      unitWeight: 330,
      ingredients: [{ id: 'e1', name: 'ביצים', qty: 6, unit: "יח'", unitWeight: 55 }],
      steps: [],
    } as unknown as Recipe;
    const eggCat = [
      cat({ key: 'ביצים', purchaseUnit: 'unit', packageQty: 30, purchaseTotal: 39, purchasePrice: 1.3, price: 1.3 }),
    ];
    const ex = explode(run([item({ recipeId: 'eggy', qty: 7 })], [eggs]));
    const list = purchaseList(ex.lines, eggCat, {}, prefs);
    const line = list.lines[0]!;
    expect(line.unit).toBe("יח'");
    expect(line.required).toBeCloseTo(42, 6);
    // one tray of 30 is not enough for 42 eggs
    expect(line.packages).toBe(2);
  });

  it('refuses to convert to litres without a density rather than assuming one', () => {
    const mystery: Recipe = {
      id: 'myst',
      name: 'רוטב',
      yieldUnits: 1,
      unitWeight: 500,
      ingredients: [{ id: 'm1', name: 'נוזל מסתורי', qty: 500, unit: 'g' }],
      steps: [],
    } as unknown as Recipe;
    const litreCat = [
      cat({ key: 'נוזל מסתורי', purchaseUnit: 'l', packageQty: 1, purchaseTotal: 10, purchasePrice: 10, price: 10 }),
    ];
    const ex = explode(run([item({ recipeId: 'myst', qty: 1 })], [mystery]));
    const list = purchaseList(ex.lines, litreCat, {}, prefs);
    expect(list.lines[0]!.required).toBeNull();
    expect(list.unconvertible).toContain('נוזל מסתורי');
    // Nothing at all could be costed here, so the level is `none` rather than
    // `partial` — and the REASON is recorded, which is the point.
    expect(list.level).toBe('none');
  });

  it('marks the list partial when one material is unconvertible and others are not', () => {
    const mixed: Recipe = {
      id: 'mixed',
      name: 'רוטב עם קמח',
      yieldUnits: 1,
      unitWeight: 600,
      ingredients: [
        { id: 'm1', name: 'נוזל מסתורי', qty: 500, unit: 'g' },
        { id: 'm2', name: 'קמח לבן', qty: 100, unit: 'g' },
      ],
      steps: [],
    } as unknown as Recipe;
    const mixedCat = [
      cat({ key: 'נוזל מסתורי', purchaseUnit: 'l', packageQty: 1, purchaseTotal: 10, purchasePrice: 10, price: 10 }),
      cat({ key: 'קמח לבן', purchaseUnit: 'kg', packageQty: 1, purchaseTotal: 4, purchasePrice: 4, price: 4 }),
    ];
    const ex = explode(run([item({ recipeId: 'mixed', qty: 1 })], [mixed]));
    const list = purchaseList(ex.lines, mixedCat, {}, prefs);
    expect(list.level).toBe('partial');
    expect(list.total).toBeNull();
    expect(list.unconvertible).toEqual(['נוזל מסתורי']);
    expect(list.lines.find((l) => l.key === 'קמח לבן')!.cost).toBeCloseTo(4, 6);
  });
});
