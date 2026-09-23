// §2 screen 6 — "הדבקה".
//
// The parsing itself is the engine's, and `packages/engine/test/acceptance.test.ts`
// already holds it to the rules that matter (no invented density, the user's
// cup size, fractions). What is tested here is the screen's own job, and the
// most important test in the file is the one about a line the parser REFUSED to
// convert: it has to be on screen, by name, before anything can be saved. An
// importer that quietly invents a weight is worse than no importer.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { PasteScreen } from './PasteScreen.js';
import { pastedDraftFrom } from './pastedDraft.js';
import { fakeRepository, renderRoute } from '../test/render.js';

const BRIOCHE_TEXT = [
  'בריוש נאנטר',
  '500 גרם קמח לחם',
  '60 מ"ל חלב',
  '11 גרם מלח',
  '',
  'ללוש 12 דקות במהירות בינונית',
  'לאפות 20 דקות ב-180 מעלות',
].join('\n');

const PREFS = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

function show(opts: { onSaveRecipe?(r: Recipe): void; canWrite?: boolean } = {}) {
  renderRoute(<PasteScreen />, {
    path: '/paste',
    route: '/paste',
    repository: fakeRepository({
      prefs: PREFS,
      recipes: [],
      canWrite: opts.canWrite ?? true,
      ...(opts.onSaveRecipe ? { onSaveRecipe: opts.onSaveRecipe } : {}),
    }),
  });
}

/*
  Stands in for the recipe editor at /recipe/new: prints the draft it was
  handed through `location.state`, so a test can read what the paste screen
  sent without rendering the whole editor.
*/
function EditorProbe() {
  const pasted = pastedDraftFrom(useLocation().state);
  if (!pasted) return <p>editor: no draft</p>;
  return (
    <div>
      <h1>editor</h1>
      <p data-testid="draft-name">{pasted.draft.name}</p>
      <p data-testid="draft-category">{pasted.draft.category}</p>
      <p data-testid="draft-id">{String(pasted.draft.id)}</p>
      <p data-testid="draft-note">{pasted.versionNote}</p>
      <ul>
        {(pasted.draft.ingredients ?? []).map((i) => (
          <li key={i.name}>{`${i.name}|${i.qty}|${i.unit}`}</li>
        ))}
      </ul>
      <p data-testid="draft-steps">{String((pasted.draft.steps ?? []).length)}</p>
    </div>
  );
}

function showWithEditor(opts: { onSaveRecipe?(r: Recipe): void } = {}) {
  render(
    <MemoryRouter initialEntries={['/paste']}>
      <AppDataProvider
        repository={fakeRepository({
          prefs: PREFS,
          recipes: [],
          canWrite: true,
          ...(opts.onSaveRecipe ? { onSaveRecipe: opts.onSaveRecipe } : {}),
        })}
        userId="me"
      >
        <Routes>
          <Route path="/paste" element={<PasteScreen />} />
          <Route path="/recipe/new" element={<EditorProbe />} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

describe('§2 screen 6 — pasting a recipe', () => {
  it('says where the parsing happens, because that is a privacy question', async () => {
    show();
    expect(await screen.findByText(/הפענוח נעשה על המכשיר שלכם/)).toBeInTheDocument();
  });

  it('shows nothing until asked, and cannot be asked with an empty box', async () => {
    show();
    await screen.findByLabelText('הטקסט של המתכון');
    expect(screen.getByRole('button', { name: 'פענוח' })).toBeDisabled();
    expect(screen.queryByText(/רכיבים זוהו/)).not.toBeInTheDocument();
  });

  it('parses ingredients, quantities, units and steps with their timings', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('הטקסט של המתכון'), BRIOCHE_TEXT);
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    expect(screen.getByText('3 רכיבים זוהו')).toBeInTheDocument();
    expect(screen.getByText('קמח לחם')).toBeInTheDocument();
    expect(screen.getByText('חלב')).toBeInTheDocument();
    expect(screen.getByText('2 שלבים זוהו')).toBeInTheDocument();
    // The step's own numbers, read out of the text by the engine. Scoped to
    // the parsed steps, because the textarea's own placeholder is an example
    // recipe and contains the same words.
    const steps = screen.getByLabelText('שלבים שזוהו');
    expect(steps).toHaveTextContent(/12 דק/);
    expect(steps).toHaveTextContent(/180°C/);
  });

  it('guesses the name from the first line, and lets it be changed', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('הטקסט של המתכון'), BRIOCHE_TEXT);
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש נאנטר');
    await user.clear(screen.getByLabelText('שם המתכון'));
    await user.type(screen.getByLabelText('שם המתכון'), 'בריוש של אחמד');
    expect(screen.getByLabelText('שם המתכון')).toHaveValue('בריוש של אחמד');
  });

  it('hands what was parsed to the editor as a draft, and saves NOTHING itself (spec 5.1, A-4)', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    showWithEditor({ onSaveRecipe: (r) => saved.push(r) });
    await user.type(screen.getByLabelText('הטקסט של המתכון'), BRIOCHE_TEXT);
    await user.click(screen.getByRole('button', { name: 'פענוח' }));
    await user.click(screen.getByRole('button', { name: 'המשך לעריכה ואישור' }));

    // The editor opened with the parsed recipe…
    expect(await screen.findByRole('heading', { name: 'editor' })).toBeInTheDocument();
    expect(screen.getByTestId('draft-name')).toHaveTextContent('בריוש נאנטר');
    expect(screen.getByTestId('draft-steps')).toHaveTextContent('2');
    // 500 g of flour arrived as grams, not as the string "500 גרם".
    expect(screen.getByText('קמח לחם|500|g')).toBeInTheDocument();
    expect(screen.getByText('חלב|60|ml')).toBeInTheDocument();
    // …with no id (the server assigns one on the first real save) and the
    // note the editor will record for that save.
    expect(screen.getByTestId('draft-id')).toHaveTextContent('undefined');
    expect(screen.getByTestId('draft-note')).toHaveTextContent('יובא מהדבקת טקסט');
    // …and the notebook was not written to.
    expect(saved).toHaveLength(0);
  });

  it('says on the screen that nothing is saved until the editor saves', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('הטקסט של המתכון'), BRIOCHE_TEXT);
    await user.click(screen.getByRole('button', { name: 'פענוח' }));
    expect(screen.getByText(/שום דבר לא נשמר במחברת עד שלוחצים/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שמירה למחברת' })).not.toBeInTheDocument();
  });
});

describe('what the parser would not guess at', () => {
  it('names the line it refused to convert, with the reason, before any save', async () => {
    const user = userEvent.setup();
    show();
    // Matcha powder has no reliable density in the table (it is a known gap),
    // so `parseLocal` keeps the cup rather than inventing 150 g.
    await user.type(
      screen.getByLabelText('הטקסט של המתכון'),
      'עוגת מאצ\'ה\n1 כוס אבקת מאצ\'ה\n200 גרם סוכר',
    );
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    const box = screen.getByLabelText('שורות שנשמרו כפי שנכתבו');
    expect(box).toHaveTextContent(/מאצ/);
    expect(screen.getByText(/לא המציאה להם משקל/)).toBeInTheDocument();
  });

  it('converts a cup that DOES have a density, using the account\'s cup size', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('הטקסט של המתכון'), 'עוגה\n2 כוסות קמח לבן');
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    // 2 cups of white flour at the account's 240 ml cup, through the shared
    // density path — not a hard-coded 150 g per cup.
    expect(screen.queryByLabelText('שורות שנשמרו כפי שנכתבו')).not.toBeInTheDocument();
    expect(screen.getByText('קמח לבן')).toBeInTheDocument();
  });
});

describe('§17 the screen does not pretend', () => {
  it('explains why smart parsing is absent instead of offering a dead button', async () => {
    show();
    expect(await screen.findByText(/פענוח חכם בעזרת בינה מלאכותית אינו זמין/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /חכם/ })).not.toBeInTheDocument();
  });

  it('says so when nothing could be recognised, rather than saving an empty recipe', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('הטקסט של המתכון'), 'שלום');
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/לא זוהו רכיבים ולא שלבים/);
    expect(screen.queryByRole('button', { name: 'המשך לעריכה ואישור' })).not.toBeInTheDocument();
  });

  it('refuses to continue without a name, and says which field', async () => {
    const user = userEvent.setup();
    const saved: Recipe[] = [];
    show({ onSaveRecipe: (r) => saved.push(r) });
    await user.type(screen.getByLabelText('הטקסט של המתכון'), '500 גרם קמח לחם');
    await user.click(screen.getByRole('button', { name: 'פענוח' }));
    await user.clear(screen.getByLabelText('שם המתכון'));
    await user.click(screen.getByRole('button', { name: 'המשך לעריכה ואישור' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('למתכון חייב להיות שם.');
    expect(saved).toHaveLength(0);
  });

  it('parses but cannot continue with no server, and says which of the two', async () => {
    const user = userEvent.setup();
    show({ canWrite: false });
    await user.type(screen.getByLabelText('הטקסט של המתכון'), BRIOCHE_TEXT);
    await user.click(screen.getByRole('button', { name: 'פענוח' }));

    expect(screen.getByText('3 רכיבים זוהו')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך לעריכה ואישור' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/לא להמשיך לעריכה ולשמירה/);
  });
});
