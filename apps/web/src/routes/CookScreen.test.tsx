// §14 Cook Mode.
//
// The arithmetic of the timers is tested in `features/cook/timers.test.ts` and
// the Mise en place state in `features/cook/mise.test.ts`. What is tested here
// is the screen: that the weighing stage comes first and cannot be got round,
// that marking a step advances and undoes, that the bar can be jumped, that a
// timer started on one step is visible from another — which is the whole point
// of a parallel timer — and that a recipe with no steps says so instead of
// opening an empty dark screen.
//
// EVERY TEST ABOUT THE STEPS NOW PASSES THROUGH THE WEIGHING FIRST
//
// That is the feature, not an inconvenience: the steps are not rendered at all
// until the ingredients are ticked, so a test that went straight to step 1 was
// testing a screen that no longer exists. `startCooking()` does what a cook
// does — ticks the list, presses the button — and the tests that assert the
// gate itself are in their own block at the bottom.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

// Cook Mode keeps its progress in the device mirror, which is idb-keyval.
vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { CookScreen } from './CookScreen.js';
import { writeCookProgress } from '../data/offlineMirror.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { fakeRepository } from '../test/render.js';

beforeEach(() => {
  resetMemoryIdb();
});

const BREAD: Recipe = {
  id: 'bread',
  name: 'לחם כפרי',
  category: 'לחמים',
  ingredients: [
    { id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
    { id: 'i2', name: 'מים', qty: 700, unit: 'g', liquid: true },
  ],
  steps: [
    { id: 's1', text: 'לשים 8 דקות', minutes: 8, kind: 'active' },
    { id: 's2', text: 'תפיחה ראשונה', minutes: 90, kind: 'proof' },
    { id: 's3', text: 'אפייה', minutes: 40, temp: 230, kind: 'bake' },
  ],
} as unknown as Recipe;

function show(recipe: Recipe = BREAD, search = '') {
  return render(
    <MemoryRouter initialEntries={[`/recipe/${recipe.id}/cook${search}`]}>
      <AppDataProvider repository={fakeRepository({
        prefs: { ...defaultPrefs('pro'), done: true },
        recipes: [recipe],
      })}
      >
        <Routes>
          <Route path="/recipe/:recipeId/cook" element={<CookScreen />} />
          <Route path="/recipe/:recipeId" element={<p>דף המתכון</p>} />
          <Route path="/notebook" element={<p>המחברת</p>} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

/**
 * Mise en place, the way a cook clears it: tick every line, press the button.
 *
 * Takes the user-event instance so the fake-timer block can pass its own.
 */
async function startCooking(user = userEvent.setup()): Promise<void> {
  const boxes = await screen.findAllByRole('checkbox');
  for (const box of boxes) await user.click(box);
  await user.click(
    screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
  );
}

describe('§14 one step at a time', () => {
  it('opens on the first step, with its number, text and timing', async () => {
    show();
    await startCooking();
    expect(await screen.findByText('לשים 8 דקות')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 3');
  });

  it('marks a step as done and advances, which is §14\'s rule', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');

    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));
    expect(await screen.findByText('תפיחה ראשונה')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 3');
  });

  it('un-marks on a second press, and does not move', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');

    // Mark step 1 (advances to 2), jump back, press again.
    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));
    await user.click(screen.getByRole('button', { name: 'שלב 1, הושלם' }));
    await user.click(
      screen.getByRole('button', { name: 'השלב מסומן כהושלם · ביטול' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 3');
    expect(screen.getByText('לשים 8 דקות')).toBeInTheDocument();
  });

  it('does not advance off the end when the LAST step is marked', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    await user.click(screen.getByRole('button', { name: 'שלב 3' }));
    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));

    expect(screen.getByText('אפייה')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 3');
  });

  it('jumps straight to a step from the progress bar (§14)', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    await user.click(screen.getByRole('button', { name: 'שלב 3' }));
    expect(screen.getByText('אפייה')).toBeInTheDocument();
    expect(screen.getByText('230°C')).toBeInTheDocument();
  });

  it('offers "סיום ההכנה" on the last step and nowhere else', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    expect(screen.queryByRole('button', { name: /סיום ההכנה/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'שלב 3' }));
    expect(screen.getByRole('button', { name: /סיום ההכנה/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הבא' })).not.toBeInTheDocument();
  });

  it('disables "הקודם" on the first step rather than hiding it', async () => {
    show();
    await startCooking();
    await screen.findByText('לשים 8 דקות');
    expect(screen.getByRole('button', { name: 'הקודם' })).toBeDisabled();
  });

  it('keeps the ingredients one tap away, so checking does not lose your place', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await user.click(await screen.findByText('הרכיבים'));
    expect(screen.getByText('קמח לחם')).toBeInTheDocument();
    // Still on the same step.
    expect(screen.getByText('לשים 8 דקות')).toBeInTheDocument();
  });
});

describe('§14 the parallel timers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  it('starts a timer for the step, from the step', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));

    const timers = screen.getByRole('region', { name: 'טיימרים' });
    expect(timers).toHaveTextContent('08:00');
  });

  it('is still visible from ANOTHER step, which is what parallel means', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));
    await u.click(screen.getByRole('button', { name: 'שלב 3' }));

    expect(screen.getByText('אפייה')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'טיימרים' })).toHaveTextContent('שלב 1');
  });

  it('runs two at once, each with its own clock', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));
    await u.click(screen.getByRole('button', { name: 'שלב 2' }));
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));

    const timers = screen.getByRole('region', { name: 'טיימרים' });
    expect(timers).toHaveTextContent('08:00');
    expect(timers).toHaveTextContent('1:30:00');
  });

  it('counts down in real time, and turns into an alert at zero', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));

    vi.advanceTimersByTime(7 * 60_000);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'טיימרים' })).toHaveTextContent('01:00'),
    );

    // §14 marks a finished timer in red; `role="alert"` is the same statement
    // to a screen reader, which cannot see red.
    vi.advanceTimersByTime(65_000);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('00:00'));
  });

  it('pauses and resumes', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));

    vi.advanceTimersByTime(60_000);
    await u.click(screen.getByRole('button', { name: 'עצירת הטיימר של שלב 1' }));
    const frozen = screen.getByRole('region', { name: 'טיימרים' }).textContent ?? '';
    expect(frozen).toContain('07:00');

    vi.advanceTimersByTime(5 * 60_000);
    expect(screen.getByRole('region', { name: 'טיימרים' })).toHaveTextContent('07:00');

    await u.click(screen.getByRole('button', { name: 'המשך הטיימר של שלב 1' }));
    vi.advanceTimersByTime(60_000);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'טיימרים' })).toHaveTextContent('06:00'),
    );
  });

  it('deletes one', async () => {
    const u = user();
    show();
    await startCooking(u);
    await screen.findByText('לשים 8 דקות');
    await u.click(screen.getByRole('button', { name: /הפעלת טיימר/ }));
    await u.click(screen.getByRole('button', { name: 'מחיקת הטיימר של שלב 1' }));

    expect(screen.queryByRole('region', { name: 'טיימרים' })).not.toBeInTheDocument();
    // And the step offers to start it again.
    expect(screen.getByRole('button', { name: /הפעלת טיימר/ })).toBeInTheDocument();
  });
});

describe('§17 a screen that cannot do its job says so', () => {
  it('explains a recipe with no steps, and offers the editor', async () => {
    const noSteps = { ...BREAD, steps: [] } as unknown as Recipe;
    show(noSteps);
    expect(await screen.findByText(/לא נרשמו שלבי הכנה/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'עריכת המתכון' })).toBeInTheDocument();
  });

  it('explains a recipe id that is not in the notebook', async () => {
    // The URL has to name an id the repository does NOT hold — passing a
    // renamed recipe to `show` also renames the route, and the first version
    // of this test found the recipe it was supposed to be missing.
    render(
      <MemoryRouter initialEntries={['/recipe/no-such-recipe/cook']}>
        <AppDataProvider repository={fakeRepository({
          prefs: { ...defaultPrefs('pro'), done: true },
          recipes: [BREAD],
        })}
        >
          <Routes>
            <Route path="/recipe/:recipeId/cook" element={<CookScreen />} />
            <Route path="/notebook" element={<p>המחברת</p>} />
          </Routes>
        </AppDataProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('המתכון הזה לא נמצא במחברת.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מצב הכנה' })).toBeInTheDocument();
  });

  it('shows a step with no text as a step rather than as a blank', async () => {
    const odd = {
      ...BREAD,
      steps: [{ id: 's1', minutes: 30, kind: 'chill' }],
    } as unknown as Recipe;
    show(odd);
    await startCooking();
    expect(await screen.findByText('שלב בלי תיאור')).toBeInTheDocument();
    expect(screen.getByText(/קירור/)).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §14 progress that survives the app being closed.
//
// `CookProgress` had been sitting in `offlineMirror` since stage 3 with no
// caller. It matters in exactly the situation Cook Mode exists for: a
// 90-minute proof means the phone goes in a pocket, and coming back to a reset
// checklist is the difference between a tool and a toy.
describe('§14 the progress is remembered on the device', () => {
  it('comes back to the step you were on, with the ticks you made', async () => {
    const user = userEvent.setup();
    const first = show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');

    // Tick step 1 — which advances to step 2 — then leave.
    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));
    await screen.findByText('תפיחה ראשונה');
    first.unmount();

    // Reopening is what a backgrounded app coming back really is. The
    // weighing was done before leaving, so it is not asked for again — which
    // is restoring the preparation, not skipping a stage of it.
    show();
    expect(await screen.findByText('תפיחה ראשונה')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 3'),
    );
  });

  it('starts clean after "סיום ההכנה", because the next bake is a new one', async () => {
    const user = userEvent.setup();
    const first = show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));
    await user.click(screen.getByRole('button', { name: 'שלב 3' }));
    await user.click(screen.getByRole('button', { name: /סיום ההכנה/ }));
    await screen.findByText('דף המתכון');
    first.unmount();

    // A new preparation weighs again, and inherits no tick from the last one.
    show();
    expect(await screen.findByRole('heading', { name: 'הכנת חומרי גלם' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 2 חומרי גלם מוכנים'),
    );
    await startCooking();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 3'),
    );
  });

  it('keeps each recipe\'s progress to itself', async () => {
    const user = userEvent.setup();
    const CAKE = {
      ...BREAD,
      id: 'cake',
      name: 'עוגה',
      steps: [{ id: 'c1', text: 'לערבב', minutes: 5 }],
    } as unknown as Recipe;

    const first = show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    await user.click(screen.getByRole('button', { name: 'סימון השלב כהושלם' }));
    first.unmount();

    // Another recipe starts at its own weighing, with nothing ticked.
    show(CAKE);
    expect(await screen.findByRole('heading', { name: 'הכנת חומרי גלם' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 2 חומרי גלם מוכנים'),
    );
    await startCooking();
    await screen.findByText('לערבב');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 1'),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §14 Mise en place.
//
// The stage that has to be true for the rest of Cook Mode to mean anything:
// everything weighed, on the bench, before the first step exists. What is
// checked here is the RULE, not the decoration — where the quantities come
// from, that they follow the scale, that a tick survives being put down, and
// above all that there is no way from this screen to the steps except through
// a complete list.
describe('§14 Mise en place — the stage that cannot be skipped', () => {
  /** The list from the request, with quantities the engine will print as-is. */
  const CAKE = {
    id: 'cake',
    name: 'עוגת חמאה',
    category: 'עוגות',
    ingredients: [
      { id: 'a1', name: 'קמח', qty: 500, unit: 'g', flour: true },
      { id: 'a2', name: 'חמאה', qty: 220, unit: 'g' },
      { id: 'a3', name: 'ביצים', qty: 180, unit: 'g' },
      { id: 'a4', name: 'סוכר', qty: 150, unit: 'g' },
      { id: 'a5', name: 'אבקת אפייה', qty: 12, unit: 'g' },
    ],
    steps: [
      { id: 'k1', text: 'להקציף חמאה וסוכר', minutes: 6, kind: 'active' },
      { id: 'k2', text: 'לאפות', minutes: 45, temp: 170, kind: 'bake' },
    ],
  } as unknown as Recipe;

  it('opens on the weighing list and not on the first step', async () => {
    show(CAKE);
    expect(
      await screen.findByRole('heading', { name: 'הכנת חומרי גלם' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('הכינו ושקלו את כל חומרי הגלם לפני שמתחילים בהכנה.'),
    ).toBeInTheDocument();
    // The steps are not merely hidden behind a disabled control: they are not
    // on the page.
    expect(screen.queryByText('להקציף חמאה וסוכר')).not.toBeInTheDocument();
  });

  it('lists this recipe’s own ingredients, one line each', async () => {
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    for (const name of ['קמח', 'חמאה', 'ביצים', 'סוכר', 'אבקת אפייה']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 5 חומרי גלם מוכנים');
  });

  it('prints the quantities the engine computed, in the engine’s own words', async () => {
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    // `formatGrams` is what produces these — 500 → "500 גר'", and 1000 would
    // become "1 ק\"ג". Nothing in the Mise en place list formats a number.
    expect(screen.getByText("500 גר'")).toBeInTheDocument();
    expect(screen.getByText("220 גר'")).toBeInTheDocument();
    expect(screen.getByText("12 גר'")).toBeInTheDocument();
  });

  it('follows the scale the link carries, and says which scale it is', async () => {
    // The recipe weighs 1,062 g; asking for 2,124 g is ×2 — computed by the
    // engine's own `scaleFactor`, not by this screen and not by this test.
    show(CAKE, '?mode=weight&v=2124');
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    expect(screen.getByText('1 ק"ג')).toBeInTheDocument(); // 500 → 1000
    expect(screen.getByText("440 גר'")).toBeInTheDocument(); // 220 → 440
    expect(screen.getByText("24 גר'")).toBeInTheDocument(); // 12 → 24
    expect(screen.getByText(/לפי משקל סופי/)).toBeInTheDocument();
    expect(screen.getByText(/×2\.00/)).toBeInTheDocument();
  });

  it('does not carry ticks across a change of scale — 500 g weighed is not 1 kg weighed', async () => {
    const user = userEvent.setup();
    const first = show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('5 מתוך 5'),
    );
    first.unmount();

    show(CAKE, '?mode=weight&v=2124');
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    // Nothing ticked, the new quantities on screen, and the gate shut.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 5'),
    );
    expect(screen.getByText('1 ק"ג')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).toBeDisabled();
  });

  it('remembers a tick, and remembers taking it back', async () => {
    const user = userEvent.setup();
    const first = show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 מתוך 5'),
    );
    first.unmount();

    // Put the phone down, pick it up: the same two lines are still ticked.
    const second = show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 מתוך 5'),
    );
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.getAllByRole('checkbox')[2]).not.toBeChecked();

    // Un-tick one, leave again, and the un-tick is what comes back.
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 5'),
    );
    second.unmount();

    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 5'),
    );
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  it('keeps the button disabled while even one line is missing', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    const boxes = screen.getAllByRole('checkbox');
    for (const box of boxes.slice(0, 4)) await user.click(box);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('4 מתוך 5'),
    );
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).toBeDisabled();
    expect(screen.queryByText('להקציף חמאה וסוכר')).not.toBeInTheDocument();
    expect(screen.queryByText(/Mise en place הושלם/)).not.toBeInTheDocument();
  });

  it('offers nothing that gets past it — no skip, no "start anyway", no other way in', async () => {
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });

    for (const word of [/דלג/, /בכל זאת/, /ללא הכנ/, /התחל ללא/, /לשלבים/]) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
    /*
      The only controls are the five ticks, "מסך מלא", the gate, and the way
      out of Cook Mode — which goes to the recipe, not to the steps. What this
      test is really about is that NOTHING here gets past the gate, so the
      fullscreen button is named and accounted for rather than merely counted.
    */
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'מסך מלא',
      'הכול מוכן — מתחילים בהכנה',
    ]);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/recipe/cake');
  });

  it('says why the shut gate is shut, and stops saying it when it opens', async () => {
    // Ahmed: "אם כפתור ההמשך מושבת, הצג סיבה קצרה וברורה."
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });

    const gate = screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
    expect(gate).toBeDisabled();
    const why = screen.getByText(/כדי להתחיל, סמנו את כל חומרי הגלם/);
    // The reason is not only next to the button; it is attached to it, so it
    // reaches a cook who arrives there by keyboard or screen reader.
    expect(gate.getAttribute('aria-describedby')).toBe(why.getAttribute('id'));
    expect(why).toHaveTextContent('נשארו 5');

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]!);
    await waitFor(() => expect(why).toHaveTextContent('נשארו 4'));

    for (const box of boxes.slice(1)) await user.click(box);
    await waitFor(() =>
      expect(
        screen.queryByText(/כדי להתחיל, סמנו את כל חומרי הגלם/),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).not.toHaveAttribute('aria-describedby');
  });

  it('opens the gate at 100%, and the press lands on step 1', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);

    await waitFor(() =>
      expect(screen.getByText(/Mise en place הושלם/)).toBeInTheDocument(),
    );
    const gate = screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
    expect(gate).toBeEnabled();

    await user.click(gate);
    // The existing first step of the existing Cook Mode, unchanged.
    expect(await screen.findByText('להקציף חמאה וסוכר')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סימון השלב כהושלם' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'הכנת חומרי גלם' })).not.toBeInTheDocument();
  });

  it('takes the gate back the moment a tick is undone', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    const boxes = screen.getAllByRole('checkbox');
    for (const box of boxes) await user.click(box);
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).toBeEnabled();

    await user.click(boxes[2]!);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('4 מתוך 5'),
    );
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).toBeDisabled();
    expect(screen.queryByText(/Mise en place הושלם/)).not.toBeInTheDocument();
  });

  it('treats a base recipe as one thing to prepare, and does not unpack it', async () => {
    const CREAM = {
      id: 'cream',
      name: 'קרם פטיסייר',
      category: 'קרמים',
      isSub: true,
      ingredients: [
        { id: 'c1', name: 'חלב', qty: 500, unit: 'g', liquid: true },
        { id: 'c2', name: 'חלמונים', qty: 90, unit: 'g' },
        { id: 'c3', name: 'סוכר לקרם', qty: 110, unit: 'g' },
      ],
      steps: [{ id: 'cs1', text: 'לבשל', minutes: 8 }],
    } as unknown as Recipe;
    const TART = {
      id: 'tart',
      name: 'טארט',
      category: 'טארטים',
      ingredients: [
        { id: 't1', name: 'בצק שקדים', qty: 300, unit: 'g' },
        { id: 't2', name: 'קרם פטיסייר', qty: 500, unit: 'g', subId: 'cream' },
      ],
      steps: [{ id: 'ts1', text: 'להרכיב', minutes: 10 }],
    } as unknown as Recipe;

    render(
      <MemoryRouter initialEntries={['/recipe/tart/cook']}>
        <AppDataProvider repository={fakeRepository({
          prefs: { ...defaultPrefs('pro'), done: true },
          recipes: [TART, CREAM],
        })}
        >
          <Routes>
            <Route path="/recipe/:recipeId/cook" element={<CookScreen />} />
            <Route path="/recipe/:recipeId" element={<p>דף המתכון</p>} />
          </Routes>
        </AppDataProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    // Two lines, as the recipe is written: the base recipe is ONE of them.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('קרם פטיסייר')).toBeInTheDocument();
    expect(screen.getByText("500 גר'")).toBeInTheDocument();
    // And its own ingredients are the base recipe's business, not this list's.
    expect(screen.queryByText('חלב')).not.toBeInTheDocument();
    expect(screen.queryByText('חלמונים')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 2');
  });

  it('is not opened by stored step progress — a reload is not a way past it', async () => {
    // A record from a session that never weighed anything: steps marked, no
    // Mise en place. Reading it back must not put the steps on the screen.
    await writeCookProgress({
      recipeId: 'cake',
      done: { 0: true },
      step: 1,
      updatedAt: Date.now(),
    });

    show(CAKE);
    expect(
      await screen.findByRole('heading', { name: 'הכנת חומרי גלם' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 5'),
    );
    expect(screen.queryByText('להקציף חמאה וסוכר')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }),
    ).toBeDisabled();
  });

  it('is not opened by a stored "started" whose ticks belong to another scale', async () => {
    await writeCookProgress({
      recipeId: 'cake',
      done: {},
      step: 0,
      updatedAt: Date.now(),
      mise: { a1: true, a2: true, a3: true, a4: true, a5: true },
      miseScale: '1.000000',
      started: true,
    });

    show(CAKE, '?mode=weight&v=2124');
    expect(
      await screen.findByRole('heading', { name: 'הכנת חומרי גלם' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 5'),
    );
  });

  it('is right-to-left, like every other screen in the app', async () => {
    show(CAKE);
    const list = await screen.findByLabelText('הכנת חומרי גלם');
    expect(list.closest('div[dir="rtl"]')).not.toBeNull();
  });

  it('says so when there is nothing to weigh, instead of being a dead end', async () => {
    const NOTHING = {
      id: 'nothing',
      name: 'טמפרור שוקולד',
      category: 'שוקולד',
      ingredients: [],
      steps: [{ id: 'n1', text: 'להמיס ל־45°', minutes: 5 }],
    } as unknown as Recipe;

    const user = userEvent.setup();
    show(NOTHING);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    expect(screen.getByText(/לא נרשמו חומרי גלם/)).toBeInTheDocument();
    const gate = screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
    expect(gate).toBeEnabled();
    await user.click(gate);
    expect(await screen.findByText('להמיס ל־45°')).toBeInTheDocument();
  });

  /*
    THE GATE AND THE COUNT ARE PINNED TO THE BOTTOM OF THE SCREEN

    Cook Mode is the one screen rendered OUTSIDE the AppShell (§14 asks for a
    full screen without tabs), so the DOCUMENT scrolls it. With the gate at the
    end of the ingredient list it fell below the fold — measured on the
    published page at 412×620: the gate's bottom edge at 775 in a 620px
    viewport — and the count that says whether the stage is finished was off
    the other end, so nothing on screen answered "can I start?".

    jsdom has no layout, so this asserts the rules that hold the shape, the way
    `styles/tokens.test.ts` pins the tokens; the measuring is done in a real
    browser by `artifact/scripts/responsive.mjs`, which checks at five widths —
    including a deliberately short one — that the gate is inside the viewport,
    that the list scrolls to its end, and that the last ingredient and the gate
    are both reachable there.
  */
  it('pins the progress line and the gate to the bottom of the screen', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, 'CookScreen.module.css'), 'utf8');

    expect(css).toMatch(/\.gateBar\s*\{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/\.gateBar\s*\{[^}]*inset-block-end:\s*0/s);
    // Opaque: the rows scroll underneath it. (The surface token changed with
    // the design roll-out — `--c-ink` is the light application's text colour
    // now and this screen has its own dark chocolate.)
    expect(css).toMatch(/\.gateBar\s*\{[^}]*background:\s*var\(--c-cook-bg\)/s);

    // And the two things it carries are really inside it, not merely styled.
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    const bar = screen.getByRole('status').closest('div');
    expect(bar?.className).toMatch(/gateBar/);
    expect(
      bar?.contains(screen.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' })),
    ).toBe(true);
  });

  /* ── "מסך מלא" ──────────────────────────────────────────────────────── */

  /*
    WHAT THESE PIN, AND WHAT THEY CANNOT

    jsdom has no Fullscreen API and no layout, so what is testable here is the
    CONTRACT: the control exists on both stages, it says which state it is in,
    pressing it turns the focused mode on without navigating anywhere, and the
    step, the ticks and the chosen quantity are untouched by it. Whether a real
    fullscreen is granted is a browser decision measured in
    `artifact/scripts/fullscreen.mjs`.
  */
  it('offers "מסך מלא" on the weighing stage and on the steps', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });
    expect(screen.getByRole('button', { name: 'מסך מלא' })).toBeInTheDocument();

    await startCooking(user);
    expect(screen.getByRole('button', { name: 'מסך מלא' })).toBeInTheDocument();
  });

  it('turns the focused mode on and off, and says which it is', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await screen.findByRole('heading', { name: 'הכנת חומרי גלם' });

    const btn = screen.getByRole('button', { name: 'מסך מלא' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);

    const out = await screen.findByRole('button', { name: 'יציאה ממסך מלא' });
    expect(out).toHaveAttribute('aria-pressed', 'true');
    await user.click(out);
    expect(await screen.findByRole('button', { name: 'מסך מלא' })).toBeInTheDocument();
  });

  it('leaving fullscreen is not leaving Cook Mode, and loses nothing', async () => {
    const user = userEvent.setup();
    show(CAKE);
    await startCooking(user);

    // Somewhere in the middle, with a step marked.
    await user.click(screen.getByRole('button', { name: /^שלב 2/ }));
    await user.click(screen.getByRole('button', { name: /סימון השלב/ }));
    const before = screen.getByRole('status').textContent;

    await user.click(screen.getByRole('button', { name: 'מסך מלא' }));
    await user.click(screen.getByRole('button', { name: 'יציאה ממסך מלא' }));

    // Still in Cook Mode, on the same step, with the same marks.
    expect(screen.getByRole('navigation', { name: 'שלבי ההכנה' })).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe(before);
  });

  /* ── the fade that covered the last card ───────────────────────────────── */

  it('draws an edge under the pinned bar instead of washing over the list', () => {
    /*
      THE DEFECT: `.gateBar` carried `box-shadow: 0 -10px 14px 10px` in the
      screen's own colour — 24px of opaque wash painted OVER whatever was
      above it, which on a full list was the last ingredient's weight and its
      checkbox, half dissolved. jsdom cannot see a shadow, so the rule itself
      is the assertion, the way `styles/tokens.test.ts` pins the tokens; that
      the last row is really clear of the bar is measured in a browser by
      `artifact/scripts/fullscreen.mjs`.
    */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, 'CookScreen.module.css'), 'utf8');

    const bar = /\.gateBar\s*\{([^}]*)\}/s.exec(css)?.[1] ?? '';
    expect(bar).not.toMatch(/box-shadow/);
    expect(bar).toMatch(/border-block-start:\s*1px solid/);
    // And the page reserves room for it when something is scrolled into view.
    expect(css).toMatch(/scroll-padding-block-end:/);
  });

  it('lays the kitchen screen out for a phone on its side', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, 'CookScreen.module.css'), 'utf8');

    // Landscape AND short: a tablet in landscape has the height for the
    // portrait layout and keeps it.
    const q = /@media \(orientation: landscape\) and \(max-height: 600px\) \{/;
    expect(css).toMatch(q);
    const block = css.slice(css.search(q));
    // The instruction gets the room: the 54px numeral shrinks, the text does
    // not, and a long instruction scrolls rather than being cut.
    expect(block).toMatch(/\.stepNum\s*\{[^}]*font-size:\s*26px/s);
    expect(block).toMatch(/\.stepText\s*\{[^}]*font-size:\s*21px/s);
    // The scroller is the instruction itself now, not the whole step box:
    // §8 asks for the instruction on one side and the facts and controls on
    // the other, and a long step must not push those off the screen.
    expect(block).toMatch(/\.stepText\s*\{[^}]*overflow-y:\s*auto/s);
    expect(block).toMatch(/\.stepBox\s*\{[^}]*grid-template-areas:/s);
    // The weighing list uses the width instead of one long column.
    expect(block).toMatch(/\.miseList\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
    // Nothing is rotated and no orientation is locked.
    expect(css).not.toMatch(/transform:\s*rotate/);
    expect(css).not.toMatch(/orientation:\s*(portrait|landscape)\s*!important/);
  });
});
/*
  ── the design pass on Cook Mode ───────────────────────────────────────────

  Two things the handoff asks for that this screen did not have: one primary
  action that finishes the step AND moves on ("עיון או חזרה אינם מסמנים שלב
  כהושלם" is the other half of that rule, and the browse controls still obey
  it), a personal timer on a step that carries no time of its own, and a way
  to clear the weighing ticks that cannot be hit by accident.
*/
describe('§8 one primary action, and a timer you can set yourself', () => {
  it('finishes the step and moves on, in one press', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');

    await user.click(screen.getByRole('button', { name: 'סיימתי — לשלב הבא' }));
    expect(await screen.findByText('תפיחה ראשונה')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 מתוך 3');
  });

  it('browsing back and forth marks nothing', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');

    await user.click(screen.getByRole('button', { name: 'שלב 2' }));
    await user.click(screen.getByRole('button', { name: 'הקודם' }));
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך 3');
  });

  it('times a step by asking for the minutes, never by guessing them', async () => {
    const user = userEvent.setup();
    show();
    await startCooking(user);
    await screen.findByText('לשים 8 דקות');
    // Every step in the fixture carries a time, so the recipe's own timer is
    // offered here too — what matters is that the personal one asks for its
    // minutes and starts a timer with exactly those.
    await user.click(screen.getByRole('button', { name: 'טיימר אישי' }));
    await user.type(screen.getByLabelText('דקות'), '12');
    await user.click(screen.getByRole('button', { name: 'הפעלה' }));

    const timers = await screen.findByRole('region', { name: 'טיימרים' });
    expect(timers).toHaveTextContent('12:00');
  });

  it('clears the weighing ticks only after it has asked', async () => {
    const user = userEvent.setup();
    show();
    // On the weighing stage: tick one line, then reset it.
    const boxes = await screen.findAllByRole('checkbox');
    await user.click(boxes[0]!);
    expect(screen.getByRole('status')).toHaveTextContent('1 מתוך');

    await user.click(screen.getByRole('button', { name: 'איפוס הסימונים' }));
    // The question, not the deed.
    expect(screen.getByRole('status')).toHaveTextContent('1 מתוך');
    await user.click(screen.getByRole('button', { name: 'כן, לנקות' }));
    expect(screen.getByRole('status')).toHaveTextContent('0 מתוך');
  });
});
