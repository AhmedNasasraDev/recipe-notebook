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

/*
  The editor is a wizard since §6: one stage on screen at a time (פרטים ·
  חומרי גלם · אופן ההכנה · סיכום), with the draft held above the stages so
  nothing typed is lost between them. `toStage` is how a person moves —
  the stepper at the top of the form, by its accessible name.
*/
const toStage = (u: ReturnType<typeof userEvent.setup>, n: 1 | 2 | 3 | 4) =>
  u.click(screen.getByRole('button', { name: new RegExp(`^שלב ${n} `) }));

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

  it('keeps delete and the print sheets inside the ⋮ menu, not on the page (spec §8.1)', async () => {
    const user = userEvent.setup();
    app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });

    // Not on the page at all until the menu is opened…
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.queryByText('דף הזמנה')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הדפסה/ })).not.toBeInTheDocument();
    // …and one tap away, not gone.
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    expect(screen.getByRole('menuitem', { name: 'מחיקה' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'דף הזמנה' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'תווית מוצר' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'הדפסה / שמירה כ-PDF' })).toBeInTheDocument();
  });

  it('leaves מצב הכנה in the open, and עריכה first in the menu', async () => {
    const user = userEvent.setup();
    app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });
    expect(screen.getByRole('link', { name: 'מצב הכנה' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('עריכה');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('favourites and recents, on this device', () => {
  it('a recipe marked as a favourite appears on the home screen', async () => {
    const user = userEvent.setup();
    const view = app('/recipe/bread');
    await screen.findByRole('heading', { name: 'לחם כפרי' });

    // The star is an item of the ⋮ menu (spec §8.1).
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    const star = screen.getByRole('menuitem', { name: 'הוספה למועדפים' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'הסרה מהמועדפים' })).toHaveAttribute(
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
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await user.click(screen.getByRole('menuitem', { name: 'הוספה למועדפים' }));
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await user.click(await screen.findByRole('menuitem', { name: 'הסרה מהמועדפים' }));
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await screen.findByRole('menuitem', { name: 'הוספה למועדפים' });
    await user.keyboard('{Escape}');
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
    /*
      TWO effects feed this screen — the last-opened card and the recents list
      — and the list leaves out whatever the card is already showing. So the
      assertion waits for the CARD first: reading the list while the card is
      still resolving found the bread in both places, which is the screen
      mid-flight rather than the screen being wrong. (This is what made the
      test flaky under a loaded suite while passing on its own.)
    */
    await screen.findByText('הפתיחה האחרונה במכשיר הזה');
    const recents = await screen.findByLabelText('נפתחו לאחרונה');
    expect(recents).toHaveTextContent('עוגת שוקולד');
    await waitFor(() => expect(recents).not.toHaveTextContent('לחם כפרי'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the editor says what is wrong, where it is wrong', () => {
  it('puts the message beside the field and keeps what was typed', async () => {
    const user = userEvent.setup();
    app('/recipe/new');
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    // A recipe with an ingredient and no name.
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח');
    await user.type(screen.getByLabelText('כמות של קמח'), '500');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    /*
      The refusal took us to the stage the missing field is ON — §6 asks for
      the message beside the field, and in a wizard that means going there.
    */
    const name = screen.getByLabelText('שם המתכון');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'r-name-error');
    expect(screen.getByText('למתכון חייב להיות שם.')).toBeInTheDocument();
    // Nothing the user typed was thrown away by the refusal.
    await toStage(user, 2);
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
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח');
    await user.type(screen.getByLabelText('כמות של קמח'), '500');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    expect(await screen.findByText('המתכון נשמר במחברת.')).toBeInTheDocument();
  });
});
