// §14 Mise en place — the state, without a screen around it.
//
// The screen test (`routes/CookScreen.test.tsx`) proves the stage cannot be
// got past. This proves the four rules it rests on: what a tick is keyed by,
// what "complete" means, when saved ticks may be trusted, and when a saved
// start still counts. Each of them has a wrong answer that would be invisible
// on screen until it mattered — a tick that followed a row's position, or
// ticks from a ×1 run restored into a ×2 bake.

import { describe, expect, it } from 'vitest';
import { compute, defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import {
  miseKeyOf,
  miseSignature,
  miseState,
  restoreMise,
  startedFrom,
  toggleMise,
} from './mise.js';

const PREFS = { ...defaultPrefs('pro'), done: true };

const CAKE = {
  id: 'cake',
  name: 'עוגה',
  category: 'עוגות',
  ingredients: [
    { id: 'a1', name: 'קמח', qty: 500, unit: 'g', flour: true },
    { id: 'a2', name: 'חמאה', qty: 220, unit: 'g' },
  ],
  steps: [{ id: 's1', text: 'לאפות', minutes: 40 }],
} as unknown as Recipe;

const rowsOf = (recipe: Recipe, factor = 1) =>
  compute(recipe, [recipe], { factor, prefs: PREFS }).rows;

describe('a tick belongs to an ingredient, not to a position', () => {
  it('keys by the ingredient id when there is one', () => {
    const rows = rowsOf(CAKE);
    expect(miseKeyOf(rows[0]!, 0)).toBe('a1');
    expect(miseKeyOf(rows[1]!, 1)).toBe('a2');
  });

  it('follows the ingredient when the list is reordered', () => {
    const rows = rowsOf(CAKE);
    const reversed = [...rows].reverse();
    const ticks = { a2: true };
    // Butter is ticked in both lists, whichever line it is on.
    expect(miseState(rows, ticks).ready).toBe(1);
    expect(miseState(reversed, ticks).ready).toBe(1);
    expect(miseKeyOf(reversed[0]!, 0)).toBe('a2');
  });

  it('falls back to the index for a row with no id, which is all that is left', () => {
    const anon = {
      ...CAKE,
      ingredients: [{ name: 'קמח', qty: 500, unit: 'g' }],
    } as unknown as Recipe;
    expect(miseKeyOf(rowsOf(anon)[0]!, 0)).toBe('#0');
  });
});

describe('complete means every line on screen, and at least one line', () => {
  it('counts the ticks that match the rows', () => {
    const rows = rowsOf(CAKE);
    expect(miseState(rows, {})).toEqual({ total: 2, ready: 0, complete: false });
    expect(miseState(rows, { a1: true })).toEqual({ total: 2, ready: 1, complete: false });
    expect(miseState(rows, { a1: true, a2: true })).toEqual({
      total: 2,
      ready: 2,
      complete: true,
    });
  });

  it('is not complete with no rows — nothing can be ready', () => {
    expect(miseState([], { a1: true })).toEqual({ total: 0, ready: 0, complete: false });
  });

  it('ignores a tick for a row that is no longer in the recipe', () => {
    const rows = rowsOf(CAKE);
    expect(miseState(rows, { a1: true, a2: true, gone: true }).complete).toBe(true);
    expect(miseState(rows, { a1: true, a2: true, gone: true }).ready).toBe(2);
  });

  it('closes again when a line is added to the recipe mid-preparation', () => {
    const bigger = {
      ...CAKE,
      ingredients: [...CAKE.ingredients!, { id: 'a3', name: 'סוכר', qty: 150, unit: 'g' }],
    } as unknown as Recipe;
    const ticks = { a1: true, a2: true };
    expect(miseState(rowsOf(CAKE), ticks).complete).toBe(true);
    expect(miseState(rowsOf(bigger), ticks).complete).toBe(false);
  });
});

describe('toggling', () => {
  it('adds and removes, and does not mutate what it was given', () => {
    const before = { a1: true };
    const off = toggleMise(before, 'a1');
    expect(off).toEqual({});
    expect(before).toEqual({ a1: true });
    expect(toggleMise(off, 'a2')).toEqual({ a2: true });
  });
});

describe('ticks are only true at the scale they were taken at', () => {
  it('signs a factor stably, and distinguishes two different ones', () => {
    expect(miseSignature(1)).toBe(miseSignature(1));
    expect(miseSignature(2)).not.toBe(miseSignature(1));
    expect(miseSignature(24 / 18)).toBe(miseSignature(24 / 18));
  });

  it('treats an unusable factor as "as written" rather than as a new scale', () => {
    expect(miseSignature(Number.NaN)).toBe(miseSignature(1));
    expect(miseSignature(0)).toBe(miseSignature(1));
    expect(miseSignature(-2)).toBe(miseSignature(1));
  });

  it('restores ticks taken at the same factor', () => {
    const saved = { mise: { a1: true }, miseScale: miseSignature(1) };
    expect(restoreMise(saved, miseSignature(1))).toEqual({ a1: true });
  });

  it('restores nothing when the factor has changed — 500 g weighed is not 1 kg', () => {
    const saved = { mise: { a1: true, a2: true }, miseScale: miseSignature(1) };
    expect(restoreMise(saved, miseSignature(2))).toEqual({});
  });

  it('restores nothing from a record written before this stage existed', () => {
    expect(restoreMise({}, miseSignature(1))).toEqual({});
    expect(restoreMise(null, miseSignature(1))).toEqual({});
  });
});

describe('a start that was saved earlier', () => {
  /*
    §7 changed the second condition: it used to be "the list is complete now",
    which was standing in for "the saved run is this batch". Since a cook may
    start with lines unticked, completeness says nothing about that — so the
    condition is the scale, which is what the ticks are keyed by anyway.
  */
  it('counts when it was saved AND at the same scale', () => {
    expect(startedFrom(true, true)).toBe(true);
  });

  it('does not count when nothing was saved — a record is not a decision', () => {
    expect(startedFrom(false, true)).toBe(false);
  });

  it('does not count when the saved run was taken at another scale', () => {
    // The ticks did not restore either (see `restoreMise`), so this is a
    // different batch: 500 g weighed is not 1 kg weighed.
    expect(startedFrom(true, false)).toBe(false);
  });
});

/*
  ── QA 22.09.2026, §3: the weighing list shows each ingredient once, and
     nothing that is not an ingredient ──────────────────────────────────────
*/
import { miseStateOfKeys, weighingRows } from './mise.js';

describe('weighingRows', () => {
  const recipe: Recipe = {
    id: 'r',
    name: 'בריוש',
    ingredients: [
      { id: 'a', name: 'חמאה', qty: 200, unit: 'g' },
      { id: 'b', name: 'חלב', qty: 100, unit: 'g' },
      { id: 'c', name: 'חמאה', qty: 50, unit: 'g' },
      { id: 'd', name: 'משקל בצק לפני אפייה', qty: 1200, unit: 'g' },
      { id: 'e', name: 'תפוקה', qty: 12, unit: 'g' },
    ],
    steps: [{ id: 's', text: 'ללוש' }],
  } as unknown as Recipe;
  const rows = compute(recipe, [recipe], { prefs: defaultPrefs() }).rows;

  it('merges a repeated ingredient into one line with the weights added', () => {
    const { rows: list } = weighingRows(rows);
    const butter = list.find((l) => l.name === 'חמאה');
    expect(butter?.g).toBe(250);
    expect(butter?.count).toBe(2);
    expect(list.filter((l) => l.name === 'חמאה')).toHaveLength(1);
    // The tick belongs to the first row's identity, so a saved tick survives.
    expect(butter?.key).toBe('a');
  });

  it('leaves the batch facts off the list and names them', () => {
    const { rows: list, skipped } = weighingRows(rows);
    expect(list.map((l) => l.name)).toEqual(['חמאה', 'חלב']);
    expect(skipped).toEqual(['משקל בצק לפני אפייה', 'תפוקה']);
  });

  it('counts readiness over the reduced list', () => {
    const { rows: list } = weighingRows(rows);
    const keys = list.map((l) => l.key);
    expect(miseStateOfKeys(keys, {})).toEqual({ total: 2, ready: 0, complete: false });
    expect(miseStateOfKeys(keys, { a: true, b: true })).toEqual({ total: 2, ready: 2, complete: true });
  });
});
