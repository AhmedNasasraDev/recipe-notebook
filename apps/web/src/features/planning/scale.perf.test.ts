// Stage-10 audit: a measured ceiling, not a speculative optimisation.
//
// WHAT WAS MEASURED, and why this file exists
//
// The notebook list computed every card inside the render loop. At 120 recipes
// of 40 rows each — a real professional notebook — one render pass measured
// 24.4 ms here, so typing a ten-letter search term spent about 244 ms purely
// recomputing, several times that on a phone. `NotebookScreen` now keys the
// computation on the notebook, the catalog and the preferences, so searching
// and filtering cost nothing and only a genuine data change recomputes.
//
// The budget below is deliberately loose. It is not a benchmark and must not
// fail on a slow machine; it is a tripwire for the shape of failure that
// actually bites — an accidental O(n²) over the notebook, or a sub-recipe walk
// that stops being bounded.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { resolveFromCatalog, type CatalogItem } from '../pricing/catalog.js';
import { explode, scaleItems } from './explode.js';
import { purchaseList } from './purchase.js';
import type { PlanItem } from './plan.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const cat = (key: string, price: number): CatalogItem => ({
  id: key, key, name: key, purchaseUnit: 'kg', packageQty: 1, packageCount: 1,
  purchaseTotal: price, usablePct: null, supplier: '', purchasedAt: null,
  priceUpdatedAt: null, note: '', purchasePrice: price, price, priceUnit: 'ק"ג',
  allergens: [],
});

const catalog = Array.from({ length: 60 }, (_, j) => cat(`חומר ${j}`, 4 + (j % 7)));

/** A notebook of `n` recipes, every third one using a 3-level sub-recipe chain. */
function notebook(n: number, rows: number): Recipe[] {
  const out: Recipe[] = [
    { id: 'L3', name: 'L3', isSub: true, yieldUnits: 1, unitWeight: 100,
      ingredients: [{ id: 'a', name: 'חומר 1', qty: 100, unit: 'g' }], steps: [] },
    { id: 'L2', name: 'L2', isSub: true, yieldUnits: 1, unitWeight: 200,
      ingredients: [{ id: 'b', name: 'L3', qty: 100, unit: 'g', subId: 'L3' },
                    { id: 'c', name: 'חומר 2', qty: 100, unit: 'g' }], steps: [] },
    { id: 'L1', name: 'L1', isSub: true, yieldUnits: 1, unitWeight: 400,
      ingredients: [{ id: 'd', name: 'L2', qty: 200, unit: 'g', subId: 'L2' },
                    { id: 'e', name: 'חומר 3', qty: 200, unit: 'g' }], steps: [] },
  ] as unknown as Recipe[];

  for (let i = 0; i < n; i += 1) {
    const ings: Array<Record<string, unknown>> = Array.from({ length: rows }, (_, j) => ({
      id: `i${i}-${j}`, name: `חומר ${j % 40}`, qty: 100 + j, unit: 'g',
      ...(j === 0 ? { flour: true } : {}),
    }));
    if (i % 3 === 0) ings.push({ id: `s${i}`, name: 'L1', qty: 400, unit: 'g', subId: 'L1' });
    out.push({ id: `r${i}`, name: `מתכון ${i}`, category: 'לחמים',
      yieldUnits: 10, unitWeight: 100, ingredients: ings, steps: [] } as unknown as Recipe);
  }
  return out;
}

describe('stage-10: a big notebook stays bounded', () => {
  it('computes 120 recipes of 40 rows, sub-recipes and all, in one pass', () => {
    const recipes = notebook(120, 40);
    const priced = recipes.map((r) => resolveFromCatalog(r, catalog));

    const started = performance.now();
    let rowsSeen = 0;
    for (const r of priced) rowsSeen += compute(r, priced, { prefs }).rows.length;
    const ms = performance.now() - started;

    expect(rowsSeen).toBeGreaterThan(120 * 40);
    // Measured at ~25 ms; this catches a change of ORDER, not of milliseconds.
    expect(ms).toBeLessThan(2000);
  });

  it('plans ten products off that notebook without blowing up', () => {
    const recipes = notebook(120, 40);
    const priced = recipes.map((r) => resolveFromCatalog(r, catalog));
    const items: PlanItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, recipeId: `r${i * 7}`, qty: 100 + i * 10,
      qtyUnit: 'unit', readyAt: '08:00', note: '',
    }));

    const started = performance.now();
    const scaled = scaleItems(items, priced, prefs, (r, factor) =>
      compute(r, priced, { factor, prefs }),
    );
    const ex = explode(scaled);
    const list = purchaseList(ex.lines, catalog, {}, prefs);
    const ms = performance.now() - started;

    // Ten products really did reduce to a materials list with a cost.
    expect(ex.lines.length).toBeGreaterThan(30);
    expect(list.lines.length).toBe(ex.lines.length);
    expect(ms).toBeLessThan(2000);
  });
});
