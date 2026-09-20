// The UX pass, tested where it actually shows: across two screens.
//
// WHAT IS PINNED HERE
//
// The changes this file guards are about ORDER and REACH — what is in front of
// a person first, what is one tap away, and what a screen says back. Those are
// exactly the things that decay silently: nothing throws when a heading moves
// above another one, and no type error appears when a device-local list stops
// being written.
//
// The favourites and the recents go through the real `offlineMirror` with
// `idb-keyval` replaced by the in-memory store, so what is tested is the code
// that ships and not a stand-in for it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, memoryIdbStore, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { fakeRepository } from '../test/render.js';
import { HomeScreen } from '../routes/HomeScreen.js';
import { NotebookScreen } from '../routes/NotebookScreen.js';
import { RecipeScreen } from '../routes/RecipeScreen.js';
import { RecipeEditScreen } from '../routes/RecipeEditScreen.js';

const BREAD: Recipe = {
  id: 'bread',
  name: 'לחם כפרי',
  category: 'לחמים',
  yieldUnits: 2,
  unitWeight: 500,
  ingredients: [
    { id: 'b1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
    { id: 'b2', name: 'מים', qty: 700, unit: 'g' },
  ],
  steps: [
    { id: 's1', text: 'לישה', minutes: 10 },
    { id: 's2', text: 'אפייה', minutes: 40 },
  ],
} as unknown as Recipe;

const CAKE: Recipe = {
  id: 'cake',
  name: 'עוגת שוקולד',
  category: 'עוגות ועוגיות',
  ingredients: [{ id: 'c1', name: 'קמח', qty: 300, unit: 'g', flour: true }],
  steps: [{ id: 't1', text: 'אופים', minutes: 35 }],
} as unknown as Recipe;

function app(route: string, opts: { recipes?: Recipe[]; canWrite?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppDataProvider
        repository={fakeRepository({
          prefs: { ...defaultPrefs('pro'), done: true },
          recipes: opts.recipes ?? [BREAD, CAKE],
          canWrite: opts.canWrite ?? true,
        })}
        userId="me"
      >
        <Routes>
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/notebook" element={<NotebookScreen />} />
          <Route path="/recipe/new" element={<RecipeEditScreen />} />
          <Route path="/recipe/:recipeId" element={<RecipeScreen />} />
          <Route path="/recipe/:recipeId/edit" element={<RecipeEditScreen />} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMemoryIdb();
});

// ───────────────────────────────────────────────────────────────────────────
describe('the recipe page is ordered the way the work happens', () => {
  it('puts the ingredients and the method before the professional data', async () => {
    app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });

    const order = screen
      .getAllByRole('heading')
      .map((h) => h.textContent?.trim() ?? '')
      .filter((t) => ['רכיבים', 'אופן ההכנה', 'כמה להכין?'].includes(t));
    expect(order).toEqual(['כמה להכין?', 'רכיבים', 'אופן ההכנה']);
  });

  it('keeps delete and the print sheets out of the first screenful', async () => {
    const user = userEvent.setup();
    app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });

    // Not on the page at all until "עוד פעולות" is opened…
    expect(screen.queryByRole('button', { name: 'מחיקת לחם כפרי' })).not.toBeInTheDocument();
    expect(screen.queryByText('דף הזמנה')).not.toBeInTheDocument();
    // …and one tap away, not gone.
    await user.click(screen.getByText('עוד פעולות'));
    expect(screen.getByRole('button', { name: 'מחיקת לחם כפרי' })).toBeInTheDocument();
    expect(screen.getByText('דף הזמנה')).toBeInTheDocument();
    expect(screen.getByText('תווית מוצר')).toBeInTheDocument();
  });

  it('leaves עריכה and מצב הכנה in the open, where a kitchen reaches for them', async () => {
    app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });
    expect(screen.getByRole('link', { name: 'עריכת לחם כפרי' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'מצב הכנה' })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('favourites and recents, on this device', () => {
  it('a recipe marked as a favourite appears on the home screen', async () => {
    const user = userEvent.setup();
    const view = app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });

    const star = screen.getByRole('button', { name: /הוספה למועדפים/ });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /במועדפים/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    view.unmount();

    app('/home');
    const section = await screen.findByLabelText('מועדפים');
    expect(section).toHaveTextContent('לחם כפרי');
  });

  it('un-marking it takes it off the home screen again', async () => {
    const user = userEvent.setup();
    let view = app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });
    await user.click(screen.getByRole('button', { name: /הוספה למועדפים/ }));
    await screen.findByRole('button', { name: /במועדפים/ });
    await user.click(screen.getByRole('button', { name: /במועדפים/ }));
    await screen.findByRole('button', { name: /הוספה למועדפים/ });
    view.unmount();

    view = app('/home');
    await screen.findByText('3 מתכונים במחברת', { exact: false }).catch(() => null);
    await waitFor(() => expect(screen.queryByLabelText('מועדפים')).not.toBeInTheDocument());
  });

  it('opening a recipe puts it in "נפתחו לאחרונה"', async () => {
    /*
      The mirror is written in an effect and nothing on screen changes when it
      lands, so "the heading is there" is not the same as "the visit was
      recorded" — waiting for the heading alone made this flaky under load.
      The store itself is the thing to wait for.
    */
    const recorded = (id: string) =>
      waitFor(() =>
        expect((memoryIdbStore().get('rn.recents.v1') as string[] | undefined) ?? []).toContain(id),
      );

    let view = app('/recipe/cake');
    await screen.findByRole('heading', { name: 'עוגת שוקולד' });
    await recorded('cake');
    view.unmount();

    // The bread is opened second, so it becomes the "last opened" card and the
    // cake is the one left for the recents list.
    view = app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });
    await recorded('bread');
    view.unmount();

    app('/home');
    const recents = await screen.findByLabelText('נפתחו לאחרונה');
    expect(recents).toHaveTextContent('עוגת שוקולד');
    // Not repeated: it is already the card above.
    expect(recents).not.toHaveTextContent('לחם כפרי');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the editor says what is wrong, where it is wrong', () => {
  it('puts the message beside the field and keeps what was typed', async () => {
    const user = userEvent.setup();
    app('/recipe/new');
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    // A recipe with an ingredient and no name.
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח');
    await user.type(screen.getByLabelText('כמות של קמח'), '500');
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    const name = screen.getByLabelText('שם המתכון');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'r-name-error');
    expect(screen.getByText('למתכון חייב להיות שם.')).toBeInTheDocument();
    // Nothing the user typed was thrown away by the refusal.
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toHaveValue('קמח');
    expect(screen.getByLabelText('כמות של קמח')).toHaveValue('500');

    // And the message goes when the field is right — without pressing save
    // again, which is what made the old top-of-form list feel like a wall.
    await user.type(name, 'חלה');
    await waitFor(() =>
      expect(screen.queryByText('למתכון חייב להיות שם.')).not.toBeInTheDocument(),
    );
  });

  it('says so out loud when the recipe has been saved', async () => {
    const user = userEvent.setup();
    app('/recipe/new');
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'חלה');
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח');
    await user.type(screen.getByLabelText('כמות של קמח'), '500');
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    expect(await screen.findByText('המתכון נשמר במחברת.')).toBeInTheDocument();
  });
});
