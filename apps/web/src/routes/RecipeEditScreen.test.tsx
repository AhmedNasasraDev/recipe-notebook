import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { RecipeEditScreen } from './RecipeEditScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const BRIOCHE: Recipe = {
  id: 'r1',
  name: 'בריוש נאנטר',
  category: 'לחמים',
  tags: ['חג'],
  yieldUnits: 12,
  unitWeight: 85,
  targetFC: 28,
  ingredients: [
    { id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'גרם', flour: true, price: 4.2, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'חמאה 82%', qty: 250, unit: 'גרם' },
  ],
  steps: [{ id: 's1', text: 'ללוש 12 דקות', minutes: 12 }],
};

function renderNew(opts: { onSaveRecipe?(r: Recipe): void; canWrite?: boolean } = {}) {
  return renderRoute(<RecipeEditScreen />, {
    path: '/recipe/new',
    route: '/recipe/new',
    repository: fakeRepository({
      prefs,
      recipes: [],
      canWrite: opts.canWrite ?? true,
      ...(opts.onSaveRecipe ? { onSaveRecipe: opts.onSaveRecipe } : {}),
    }),
  });
}

function renderEdit(
  recipe: Recipe = BRIOCHE,
  opts: { onSaveRecipe?(r: Recipe): void } = {},
) {
  return renderRoute(<RecipeEditScreen />, {
    path: '/recipe/:recipeId/edit',
    route: `/recipe/${recipe.id}/edit`,
    repository: fakeRepository({
      prefs,
      recipes: [recipe],
      canWrite: true,
      ...(opts.onSaveRecipe ? { onSaveRecipe: opts.onSaveRecipe } : {}),
    }),
  });
}

/*
  ── THE EDITOR IS A WIZARD (§6) ──────────────────────────────────────────

  One stage on screen at a time: פרטים · חומרי גלם · אופן ההכנה · סיכום. The
  draft itself is held above the stages, so moving between them changes what
  is RENDERED and never what is held — which is the thing these tests keep
  checking by filling a field on one stage and reading it back from another.

  `toStage` is how a person moves: the stepper at the top, by its accessible
  name ("שלב 2 מתוך 4 — חומרי גלם").
*/
const toStage = (u: ReturnType<typeof userEvent.setup>, n: 1 | 2 | 3 | 4) =>
  u.click(screen.getByRole('button', { name: new RegExp(`^שלב ${n} `) }));

describe('creating a recipe', () => {
  it('opens on the first stage, with the name, and the row is one stage on', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(await screen.findByRole('heading', { name: 'מתכון חדש' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('');
    // Stage 2 is where the ingredients are — one stage at a time is the point.
    expect(screen.queryByLabelText('שם הרכיב בשורה 1')).not.toBeInTheDocument();
    await toStage(user, 2);
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toBeInTheDocument();
  });

  it('refuses to save a nameless recipe and says what is missing', async () => {
    const user = userEvent.setup();
    const onSaveRecipe = vi.fn();
    renderNew({ onSaveRecipe });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('למתכון חייב להיות שם.');
    expect(onSaveRecipe).not.toHaveBeenCalled();
  });

  it('refuses a recipe with no ingredients', async () => {
    const user = userEvent.setup();
    const onSaveRecipe = vi.fn();
    renderNew({ onSaveRecipe });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'לחם');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('צריך לפחות רכיב אחד.');
    expect(onSaveRecipe).not.toHaveBeenCalled();
  });

  it('saves a filled-in recipe through the repository', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderNew({ onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'לחם כוסמין');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח מלא');
    await user.type(screen.getByLabelText('כמות של קמח מלא'), '600');

    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 2'), 'מים');
    await user.type(screen.getByLabelText('כמות של מים'), '420');

    // Everything typed on two different stages arrives in one save.
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('לחם כוסמין');
    expect(saved[0]!.ingredients!.map((i) => i.name)).toEqual(['קמח מלא', 'מים']);
    expect(saved[0]!.ingredients!.map((i) => i.qty)).toEqual(['600', '420']);
  });

  it('cannot save when the repository cannot write, and says so', async () => {
    const user = userEvent.setup();
    renderNew({ canWrite: false });
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    // The draft save is refused on every stage; the full save is on the last.
    expect(screen.getByRole('button', { name: 'שמירת טיוטה' })).toBeDisabled();
    await toStage(user, 4);
    expect(screen.getByRole('button', { name: 'שמירת המתכון' })).toBeDisabled();
    expect(screen.getByText(/אי אפשר לשמור/)).toBeInTheDocument();
  });
});

describe('ingredient rows — add, remove, reorder', () => {
  it('adds a row', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);
    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    expect(screen.getByLabelText('שם הרכיב בשורה 2')).toBeInTheDocument();
  });

  it('removes a row, by a button that names the ingredient', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 2);
    // The accessible name carries the ingredient, so a screen-reader user does
    // not get a list of identical "הסרה" buttons.
    await user.click(screen.getByRole('button', { name: 'הסרת חמאה 82%' }));

    expect(screen.queryByDisplayValue('חמאה 82%')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('קמח לחם')).toBeInTheDocument();
  });

  it('moves a row down and the numbering follows', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 2);
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toHaveValue('קמח לחם');
    await user.click(screen.getByRole('button', { name: 'הורדת קמח לחם למטה' }));
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toHaveValue('חמאה 82%');
    expect(screen.getByLabelText('שם הרכיב בשורה 2')).toHaveValue('קמח לחם');
  });

  it('disables the move buttons at the ends rather than hiding them', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    expect(screen.getByRole('button', { name: 'העלאת קמח לחם למעלה' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'הורדת חמאה 82% למטה' })).toBeDisabled();
  });

  it('saves the new order', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 2);
    await user.click(screen.getByRole('button', { name: 'הורדת קמח לחם למטה' }));
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.ingredients!.map((i) => i.name)).toEqual(['חמאה 82%', 'קמח לחם']);
  });
});

describe('opening a saved recipe for editing', () => {
  it('fills the form from the stored recipe, stage by stage', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש נאנטר');
    expect(screen.getByLabelText('תגים')).toHaveValue('חג');
    await toStage(user, 2);
    expect(screen.getByLabelText('כמות של קמח לחם')).toHaveValue('1000');
    // And back again: the first stage still holds what it held.
    await toStage(user, 1);
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש נאנטר');
  });

  it('explains a recipe id that is not in the notebook', async () => {
    renderRoute(<RecipeEditScreen />, {
      path: '/recipe/:recipeId/edit',
      route: '/recipe/nope/edit',
      repository: fakeRepository({ prefs, recipes: [], canWrite: true }),
    });
    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
  });

  it('saves an edit against the same id, rather than creating a second recipe', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await user.clear(screen.getByLabelText('שם המתכון'));
    await user.type(screen.getByLabelText('שם המתכון'), 'בריוש נאנטר 2');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.id).toBe('r1');
    expect(saved[0]!.name).toBe('בריוש נאנטר 2');
  });

  it('warns that an approved production formula is being edited (§9, §18.7)', async () => {
    renderEdit({ ...BRIOCHE, locked: true });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    expect(screen.getByText(/נוסחה מאושרת לייצור/)).toBeInTheDocument();
    expect(screen.getByText(/כדאי לשכפל אותו/)).toBeInTheDocument();
  });
});

describe('requirement 11 — full / partial / none inside the editor', () => {
  it('says the calculation is complete when every row can be weighed', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');

    expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('חישוב מלא');
  });

  it('announces a partial calculation the moment an unweighable row is typed', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');
    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 2'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '1');
    // cocoa in cups: pending-verification, so no weight can be produced
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');

    const notice = screen.getByLabelText('שלמות החישוב');
    expect(notice).toHaveTextContent('נתונים חלקיים');
    expect(notice).toHaveTextContent('קקאו');
  });

  it('marks the running total as partial rather than presenting it as final', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');
    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 2'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '1');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');

    const totalRow = screen.getByText('סך המשקל').closest('div')!;
    expect(within(totalRow).getByText('חלקי')).toBeInTheDocument();
  });

  it('shows a dash, not a zero, when nothing at all can be weighed', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '1');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');

    expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('לא ניתן לחשב');
    const totalRow = screen.getByText('סך המשקל').closest('div')!;
    expect(within(totalRow).getByText('—')).toBeInTheDocument();
  });

  it('offers the two honest ways out of an unweighable row, and no third one', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '1');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');

    expect(screen.getByRole('button', { name: 'כיול אישי של קקאו' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מדידת קקאו בגרמים' })).toBeInTheDocument();
  });

  it('switching the row to grams resolves it, with no invented density', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '100');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');
    expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('לא ניתן לחשב');

    await user.click(screen.getByRole('button', { name: 'מדידת קקאו בגרמים' }));
    expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('חישוב מלא');
  });

  it('shows the computed weight and its source badge per row', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);

    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '2');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קמח לבן'), 'cup');

    // 2 cups at 240 ml and 50 g/100 ml = 240 g, tagged as a system value —
    // never as an exact conversion (that was B3). Scoped to the row, because
    // the running total legitimately shows the same figure.
    const result = within(screen.getByLabelText('המשקל המחושב של קמח לבן'));
    expect(result.getByText("240 גר'")).toBeInTheDocument();
    expect(result.getByText(/נתון מערכת/)).toBeInTheDocument();
  });
});

describe('the null-versus-zero rule is explained where the user meets it', () => {
  it('says so next to the measured-yield field', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));
    expect(
      screen.getByText(/שדה ריק פירושו .*לפי החישוב.*אפס פירושו שנמדדה תשואה של אפס/s),
    ).toBeInTheDocument();
  });

  it('keeps an untouched measured yield out of the saved recipe', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderNew({ onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'לחם');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.yieldActual).toBe('');
  });
});

describe('accessibility of the per-row controls', () => {
  it('gives every row control a name that identifies its row', async () => {
    renderEdit();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);

    for (const name of [
      'כמות של קמח לחם',
      'יחידת המדידה של קמח לחם',
      'הסרת קמח לחם',
      'הורדת קמח לחם למטה',
      'כמות של חמאה 82%',
      'הסרת חמאה 82%',
    ]) {
      expect(screen.getByLabelText(name) ?? screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('falls back to the row number before the ingredient has a name', async () => {
    renderNew();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 2);
    expect(screen.getByRole('button', { name: 'הסרת רכיב 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('כמות של רכיב 1')).toBeInTheDocument();
  });

  it('names the step controls by their position', async () => {
    renderNew();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await toStage(user, 3);
    expect(screen.getByLabelText('תיאור שלב 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הסרת שלב 1' })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-10 audit, §11 — what the editor does when the SERVER says no.
//
// The rule being tested is the one that matters most in this section: a save
// that did not happen must never look like one that did. The form stays open
// with its typed values, the reason is announced, and nothing navigates away
// to a page that would then show the old recipe as if it had been updated.
describe('stage-10 audit, §11: a save the server refuses', () => {
  /** A repository whose write fails the way PostgREST reports a failure. */
  function renderWithFailingSave(message: string) {
    const calls: Recipe[] = [];
    renderRoute(<RecipeEditScreen />, {
      path: '/recipe/:recipeId/edit',
      route: `/recipe/${BRIOCHE.id}/edit`,
      repository: fakeRepository({
        prefs,
        recipes: [BRIOCHE],
        canWrite: true,
        onSaveRecipe: (r) => {
          calls.push(r);
          throw new Error(message);
        },
      }),
    });
    return calls;
  }

  it('keeps the user on the form and says why, rather than reporting success', async () => {
    const user = userEvent.setup();
    // The message the RPC really raises when another device saved in between
    // (migration 0007, errcode serialization_failure).
    renderWithFailingSave(
      'עדכון המתכון נכשל: המתכון שונה במקום אחר מאז שנטען. יש לרענן ולנסות שוב.',
    );
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await user.clear(screen.getByLabelText('שם המתכון'));
    await user.type(screen.getByLabelText('שם המתכון'), 'בריוש מעודכן');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/המתכון שונה במקום אחר/);
    // Still the editor, and still holding what was typed: nothing was lost and
    // nothing pretended to be saved.
    expect(screen.getByRole('heading', { name: 'עריכת מתכון' })).toBeInTheDocument();
    // The name is on the first stage, and it still holds what was typed.
    await toStage(user, 1);
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש מעודכן');
  });

  it('can be retried after the failure, rather than leaving the button dead', async () => {
    const user = userEvent.setup();
    const calls = renderWithFailingSave('עדכון המתכון נכשל: השרת לא זמין.');
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 4);
    const save = screen.getByRole('button', { name: 'שמירת השינויים' });
    await user.click(save);
    await screen.findByRole('alert');
    // `busy` is cleared in a finally block, so the second attempt is possible.
    await waitFor(() => expect(save).not.toBeDisabled());
    await user.click(save);
    await waitFor(() => expect(calls.length).toBe(2));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-11 completion, §1.1 / §7 / §13 — the fields the form never asked for.
//
// Every one of these already had a column, both mappers and a line in
// `save_recipe`; the engine already computed from them and the recipe page
// already displayed the result. The form was the only missing link, which is
// why "פחת אפייה" read 0.0% on every recipe in the notebook.
describe('stage-11: the professional inputs reach the saved recipe', () => {
  it('saves the two weights that bake loss is computed from', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.type(screen.getByLabelText('משקל לפני אפייה, גרם'), '1000');
    await user.type(screen.getByLabelText('משקל אחרי אפייה, גרם'), '880');
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.weightBefore).toBe('1000');
    expect(saved[0]!.weightAfter).toBe('880');
  });

  it('keeps a blank weight blank, so "not weighed" never becomes a weight of 0', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.weightBefore).toBe('');
    expect(saved[0]!.weightAfter).toBe('');
  });

  it('asks for the four dough temperatures only once dough mode is on (§13)', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));

    // Hidden until the recipe is declared a dough, because the water
    // temperature is meaningless without the four inputs.
    expect(screen.queryByLabelText(/טמפ' בצק מבוקשת/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /מתכון בצק/ }));
    await user.type(screen.getByLabelText(/טמפ' בצק מבוקשת/), '24');
    await user.type(screen.getByLabelText(/טמפ' הקמח/), '20');
    await user.type(screen.getByLabelText(/טמפ' החדר/), '22');
    await user.type(screen.getByLabelText(/חימום המערבל/), '5');
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.doughMode).toBe(true);
    expect(saved[0]!.ddt).toBe('24');
    expect(saved[0]!.flourTemp).toBe('20');
    expect(saved[0]!.roomTemp).toBe('22');
    expect(saved[0]!.friction).toBe('5');
  });

  it('saves the pan, asking only for the dimensions its kind needs (§7)', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 4);
    // The pan lives in step 4, "פרטים מקצועיים", which is collapsed.
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.selectOptions(screen.getByLabelText('סוג התבנית של המתכון'), 'round');
    expect(screen.queryByLabelText('מידת GN')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '20');
    await user.type(screen.getByLabelText('גובה, ס"מ'), '7');
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.pan).toEqual({ kind: 'round', diameter: '20', height: '7' });
  });

  it('stores no pan at all when a kind was picked with no dimensions', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 4);
    // The pan lives in step 4, "פרטים מקצועיים", which is collapsed.
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.selectOptions(screen.getByLabelText('סוג התבנית של המתכון'), 'round');
    expect(screen.getByText(/נבחר סוג תבנית בלי מידות/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    // `{kind:'round'}` with nothing behind it would make panFactor look
    // answerable. The kind alone is not a pan.
    expect(saved[0]!.pan).toEqual({ kind: 'round' });
  });

  it('saves freezing, thawing and hand-added allergens', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.type(screen.getByLabelText('הקפאה'), 'עד חודש, בקירור ספירלי');
    await user.type(screen.getByLabelText('הפשרה'), 'לילה בקירור');
    await user.type(screen.getByLabelText('אלרגנים להוספה ידנית'), 'שומשום, סויה');
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.freezing).toBe('עד חודש, בקירור ספירלי');
    expect(saved[0]!.thawing).toBe('לילה בקירור');
    expect(saved[0]!.manualAllergens).toEqual(['שומשום', 'סויה']);
  });

  it('fills the form back from a recipe that has all of it', async () => {
    const full = {
      ...BRIOCHE,
      weightBefore: 1000,
      weightAfter: 880,
      doughMode: true,
      ddt: 24,
      flourTemp: 20,
      roomTemp: 22,
      friction: 5,
      freezing: 'עד חודש',
      thawing: 'לילה בקירור',
      manualAllergens: ['שומשום'],
      pan: { kind: 'rect', width: 20, length: 30, height: 5 },
    } as unknown as Recipe;
    const user = userEvent.setup();
    renderEdit(full);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 4);
    await user.click(screen.getByText('פרטים מקצועיים'));

    expect(screen.getByLabelText('הקפאה')).toHaveValue('עד חודש');
    expect(screen.getByLabelText('אלרגנים להוספה ידנית')).toHaveValue('שומשום');
    expect(screen.getByLabelText('סוג התבנית של המתכון')).toHaveValue('rect');
    expect(screen.getByLabelText('רוחב, ס"מ')).toHaveValue('20');
    expect(screen.getByLabelText('גובה, ס"מ')).toHaveValue('5');
  });
});

/*
  ── §6, STAGE 3: THE WIZARD'S OWN GUARANTEES ─────────────────────────────

  The four things Ahmed asked for when he approved it: one stage at a time,
  nothing lost moving between them, a partial draft that can be saved, and
  validation that appears where the field is — which in a wizard means being
  taken to it.
*/
describe('the four stages', () => {
  it('shows one stage at a time, and marks which one', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    expect(screen.getByRole('button', { name: /^שלב 1 / })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByLabelText('שם המתכון')).toBeInTheDocument();
    expect(screen.queryByLabelText('שם הרכיב בשורה 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('תיאור שלב 1')).not.toBeInTheDocument();

    await toStage(user, 3);
    expect(screen.getByLabelText('תיאור שלב 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('שם המתכון')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^שלב 3 / })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('keeps everything typed when moving forward and back', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'חלה');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח');
    await user.type(screen.getByLabelText('כמות של קמח'), '700');
    await toStage(user, 3);
    await user.type(screen.getByLabelText('תיאור שלב 1'), 'ללוש');

    // All the way back, and all the way forward again.
    await toStage(user, 1);
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('חלה');
    await toStage(user, 2);
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toHaveValue('קמח');
    expect(screen.getByLabelText('כמות של קמח')).toHaveValue('700');
    await toStage(user, 3);
    expect(screen.getByLabelText('תיאור שלב 1')).toHaveValue('ללוש');
  });

  it('moves with the foot controls too, not only with the stepper', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.click(screen.getByRole('button', { name: 'המשך לחומרי גלם' }));
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הקודם' }));
    expect(screen.getByLabelText('שם המתכון')).toBeInTheDocument();
  });

  it('saves a partial draft of an EXISTING recipe and stays where it is', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderEdit(BRIOCHE, { onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await user.clear(screen.getByLabelText('שם המתכון'));
    await user.type(screen.getByLabelText('שם המתכון'), 'בריוש — טיוטה');
    await user.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('בריוש — טיוטה');
    // Still in the editor, and it says the DRAFT was saved.
    expect(await screen.findByText(/הטיוטה נשמרה/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'עריכת מתכון' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש — טיוטה');
  });

  it('saves a partial draft of a NEW recipe — a name is enough', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderNew({ onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.type(screen.getByLabelText('שם המתכון'), 'רעיון לעוגה');
    await user.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));

    /*
      One row, with the name and nothing else — no ingredients, which a
      finished recipe still requires. The editor then moves to the saved row's
      own address, so the NEXT save updates it instead of creating a second
      recipe; that navigation is covered by the flow tests, which render the
      whole router.
    */
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('רעיון לעוגה');
    expect(saved[0]!.ingredients ?? []).toHaveLength(0);
  });

  it('still refuses a nameless draft, because a name is the recipe\'s identity', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    renderNew({ onSaveRecipe: (r) => saved.push(r) });
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    await user.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('למתכון חייב להיות שם.');
    expect(saved).toHaveLength(0);
  });

  it('takes a refused save to the stage that holds the missing field', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByRole('heading', { name: 'מתכון חדש' });

    // A name, no ingredients — and the refusal is about stage 2.
    await user.type(screen.getByLabelText('שם המתכון'), 'בלי רכיבים');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('צריך לפחות רכיב אחד.');
    // We are on the ingredients stage now, where the problem is.
    expect(screen.getByLabelText('שם הרכיב בשורה 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^שלב 2 / })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});
