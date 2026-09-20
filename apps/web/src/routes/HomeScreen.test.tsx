// §2 screen 2 — "בית".
//
// The screen computes everything from the notebook that is already loaded, so
// what is worth testing is the judgement in it: that a category tile leads to
// the notebook FILTERED, that a base recipe with no establishable cost is not
// sorted to the front of a list about cost, and that "המשך מאיפה שעצרת" says
// which of the two things it is showing — a page you looked at, or a bake you
// left half done.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { HomeScreen } from './HomeScreen.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { fakeRepository } from '../test/render.js';
import type { CatalogItem } from '../features/pricing/catalog.js';
import { writeCookProgress, writeLastOpened } from '../data/offlineMirror.js';

const GANACHE: Recipe = {
  id: 'ganache',
  name: 'גנאש מריר',
  category: 'גנאשים ורטבים',
  isSub: true,
  ingredients: [
    { id: 'g1', name: 'שוקולד מריר', ingredientKey: 'שוקולד', qty: 500, unit: 'g' },
  ],
  steps: [],
} as unknown as Recipe;

const CREAM: Recipe = {
  id: 'cream',
  name: 'קרם פטיסייר',
  category: 'קרמים ומילויים',
  isSub: true,
  ingredients: [{ id: 'c1', name: 'חלב', ingredientKey: 'חלב', qty: 1000, unit: 'g' }],
  steps: [],
} as unknown as Recipe;

const BREAD: Recipe = {
  id: 'bread',
  name: 'לחם כפרי',
  category: 'לחמים',
  ingredients: [{ id: 'b1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true }],
  steps: [
    { id: 's1', text: 'לישה', minutes: 10 },
    { id: 's2', text: 'תפיחה', minutes: 90 },
    { id: 's3', text: 'אפייה', minutes: 40 },
  ],
} as unknown as Recipe;

const priceOf = (key: string, total: number): CatalogItem => ({
  id: `cat-${key}`,
  key,
  name: key,
  purchaseUnit: 'kg',
  packageQty: 1,
  packageCount: 1,
  purchaseTotal: total,
  usablePct: null,
  supplier: '',
  purchasedAt: null,
  priceUpdatedAt: null,
  note: '',
  purchasePrice: total,
  price: total,
  priceUnit: 'ק"ג',
  allergens: [],
});

/* Where the router ended up — the UX pass added a screen that navigates. */
let seenLocation = '/home';
function LocationSpy() {
  const l = useLocation();
  seenLocation = `${l.pathname}${l.search}`;
  return null;
}
const lastLocation = () => seenLocation;

function show(
  opts: { recipes?: Recipe[]; catalog?: CatalogItem[]; pro?: boolean; canWrite?: boolean } = {},
) {
  seenLocation = '/home';
  render(
    <MemoryRouter initialEntries={['/home']}>
      <LocationSpy />
      <AppDataProvider
        repository={fakeRepository({
          prefs: { ...defaultPrefs(opts.pro === false ? 'home' : 'pro'), done: true },
          recipes: opts.recipes ?? [BREAD, GANACHE, CREAM],
          catalog: opts.catalog ?? [],
          canWrite: opts.canWrite ?? true,
        })}
      >
        <Routes>
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/notebook" element={<p>המחברת</p>} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMemoryIdb();
});

describe('§2 the notebook at a glance', () => {
  it('counts what is in the notebook', async () => {
    show();
    expect(await screen.findByText('3 מתכונים במחברת')).toBeInTheDocument();
  });

  it('says the notebook is empty rather than showing empty sections', async () => {
    show({ recipes: [] });
    expect(await screen.findByText('המחברת ריקה')).toBeInTheDocument();
    expect(screen.getByText(/הקטגוריות יופיעו כאן/)).toBeInTheDocument();
    /*
      Nothing on the screen claims a category or a base recipe exists. The ONE
      link that is right to offer an empty notebook is the way out of it, and
      the UX pass put it here: "+ מתכון חדש".
    */
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/recipe/new');
  });

  /* ── UX pass ─────────────────────────────────────────────────────────── */

  it('offers a search that hands the term to the notebook', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('3 מתכונים במחברת');
    await user.type(screen.getByLabelText('חיפוש מתכון'), 'בריוש');
    await user.click(screen.getByRole('button', { name: 'חיפוש' }));
    expect(lastLocation()).toBe('/notebook?q=%D7%91%D7%A8%D7%99%D7%95%D7%A9');
  });

  it('an empty search term just opens the notebook', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('3 מתכונים במחברת');
    await user.click(screen.getByRole('button', { name: 'חיפוש' }));
    expect(lastLocation()).toBe('/notebook');
  });
});

describe('categories', () => {
  it('shows a tile per category that HAS recipes, with the count', async () => {
    show();
    const tile = await screen.findByRole('link', { name: /לחמים/ });
    expect(tile).toHaveTextContent('1');
    // A category with nothing in it is not offered: an empty filter is a dead
    // end, and the notebook already says "אין מתכון שתואם" for that.
    expect(screen.queryByRole('link', { name: /מנות חמות/ })).not.toBeInTheDocument();
  });

  it('links to the notebook FILTERED by that category', async () => {
    show();
    const tile = await screen.findByRole('link', { name: /לחמים/ });
    expect(tile.getAttribute('href')).toBe(`/notebook?category=${encodeURIComponent('לחמים')}`);
  });
});

describe('base recipes, by cost', () => {
  it('lists the sub-recipes cheapest first', async () => {
    // Milk at ₪6/kg → the cream is ₪6/kg; chocolate at ₪60/kg → the ganache is
    // ₪60/kg. The cheaper one comes first.
    show({ catalog: [priceOf('חלב', 6), priceOf('שוקולד', 60)] });
    await screen.findByText('קרם פטיסייר');
    const rows = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    const cream = rows.findIndex((t) => t.includes('קרם פטיסייר'));
    const ganache = rows.findIndex((t) => t.includes('גנאש מריר'));
    expect(cream).toBeLessThan(ganache);
  });

  it('puts a base with NO establishable cost last, and says so', async () => {
    // Only the milk is priced. The ganache's cost cannot be established, and
    // "no cost" must not sort as if it were free.
    show({ catalog: [priceOf('חלב', 6)] });
    await screen.findByText('גנאש מריר');
    expect(screen.getByText('אין עלות')).toBeInTheDocument();

    const rows = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    const cream = rows.findIndex((t) => t.includes('קרם פטיסייר'));
    const ganache = rows.findIndex((t) => t.includes('גנאש מריר'));
    expect(cream).toBeLessThan(ganache);
  });

  it('shows no costs at all on a home profile (§3)', async () => {
    show({ catalog: [priceOf('חלב', 6), priceOf('שוקולד', 60)], pro: false });
    await screen.findByText('קרם פטיסייר');
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
  });

  it('explains what a base recipe is when there are none', async () => {
    show({ recipes: [BREAD] });
    expect(await screen.findByText(/מתכון בסיס הוא מתכון שמשמש כרכיב/)).toBeInTheDocument();
  });
});

describe('המשך מאיפה שעצרת', () => {
  it('offers the last recipe opened on this device, and says that is what it is', async () => {
    await writeLastOpened('bread');
    show();
    expect(await screen.findByText('הפתיחה האחרונה במכשיר הזה')).toBeInTheDocument();
    const card = screen.getByRole('link', { name: /לחם כפרי/ });
    expect(card.getAttribute('href')).toBe('/recipe/bread');
  });

  it('prefers a bake left half done, with how far it got', async () => {
    await writeLastOpened('bread');
    await writeCookProgress({
      recipeId: 'bread',
      done: { 0: true },
      step: 1,
      updatedAt: Date.now(),
    });
    show();
    expect(await screen.findByText('הכנה באמצע')).toBeInTheDocument();
    // Scoped to the card: "1" on its own matches half the screen.
    const card = screen.getByRole('link', { name: /לחם כפרי/ });
    expect(card).toHaveTextContent('1');
    expect(card).toHaveTextContent('3');
    expect(card).toHaveTextContent(/שלבים הושלמו/);
    expect(screen.getByRole('link', { name: 'חזרה למצב הכנה' }).getAttribute('href')).toBe(
      '/recipe/bread/cook',
    );
  });

  it('does not call a FINISHED bake "in progress"', async () => {
    await writeLastOpened('bread');
    await writeCookProgress({
      recipeId: 'bread',
      done: { 0: true, 1: true, 2: true },
      step: 2,
      updatedAt: Date.now(),
    });
    show();
    await screen.findByText('הפתיחה האחרונה במכשיר הזה');
    expect(screen.queryByText('הכנה באמצע')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'חזרה למצב הכנה' })).not.toBeInTheDocument();
  });

  it('says what will appear there when nothing has been opened yet', async () => {
    show();
    expect(
      await screen.findByText(/כאן יופיע המתכון האחרון שנפתח במכשיר הזה/),
    ).toBeInTheDocument();
  });

  it('ignores a remembered recipe that is no longer in the notebook', async () => {
    // Deleted on another device, or the account signed out and back in.
    await writeLastOpened('deleted-recipe');
    show();
    await waitFor(() =>
      expect(screen.getByText(/כאן יופיע המתכון האחרון/)).toBeInTheDocument(),
    );
  });
});
