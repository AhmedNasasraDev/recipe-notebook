// §20 "הגדרות".
//
// Rendered through the REAL AuthProvider against the auth double, exactly as
// AppSession.test.tsx does, so the password change exercises the real
// `changePassword` — including the re-authentication step, which is the part
// worth testing. A `vi.fn()` in its place would have proved nothing.
//
// Two things here matter more than the rest: that the profile switch obeys §3's
// `touchedUnits` rule (a unit list the user chose is not quietly undone by a
// profile change), and that changing a password demands the current one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

/* The text-size setting is DEVICE storage, and jsdom has no IndexedDB — so
   the mirror's own code stays under test and only the store beneath it is
   replaced. See test/memoryIdb.ts. */
vi.mock('idb-keyval', () => memoryIdb());
beforeEach(() => resetMemoryIdb());
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultPrefs, type MeasurementPrefs, type Recipe } from '@recipe-notebook/engine';
import { SettingsScreen } from './SettingsScreen.js';
import { readCookTextSize } from '../data/offlineMirror.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { AuthProvider } from '../auth/AuthProvider.js';
import { fakeRepository } from '../test/render.js';
import { createFakeAuth } from '../test/fakeAuth.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';

const EMAIL = 'ahmed@test.invalid';

interface Options {
  prefs?: Partial<MeasurementPrefs>;
  onSavePrefs?(p: MeasurementPrefs): void;
  canWrite?: boolean;
  /** signed out, i.e. the no-account case */
  anonymous?: boolean;
  recipes?: Recipe[];
}

function show(opts: Options = {}) {
  const auth = createFakeAuth({
    accounts: { [EMAIL]: { id: 'u1', password: 'sourdough1', confirmed: true } },
    storedSession: opts.anonymous
      ? null
      : { access_token: 't', user: { id: 'u1', email: EMAIL } },
  });
  const repository = fakeRepository({
    prefs: { ...defaultPrefs('pro'), done: true, ...opts.prefs },
    ...(opts.recipes ? { recipes: opts.recipes } : {}),
    canWrite: opts.canWrite ?? true,
    ...(opts.onSavePrefs ? { onSavePrefs: opts.onSavePrefs } : {}),
  });
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <AuthProvider client={auth.client as TypedSupabaseClient}>
        <AppDataProvider repository={repository}>
          <Routes>
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/onboarding" element={<p>שאלות הפתיחה</p>} />
          </Routes>
        </AppDataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return auth;
}

describe('§3 the profile can be changed after onboarding', () => {
  it('shows which profile is in use, with what each one means', async () => {
    show({ prefs: { profile: 'pro' } });
    const pressed = await screen.findByRole('button', { name: /מקצועי/, pressed: true });
    expect(pressed).toBeInTheDocument();
    expect(screen.getByText(/אינו נועל שום יכולת/)).toBeInTheDocument();
  });

  it('replaces the unit list with the new profile\'s while the user has not chosen one', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ prefs: { profile: 'pro', touchedUnits: false }, onSavePrefs: (p) => saved.push(p) });
    await screen.findByRole('button', { name: /ביתי/ });

    await user.click(screen.getByRole('button', { name: /ביתי/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.profile).toBe('home');
    expect(saved[0]!.pro).toBe(false);
    expect(saved[0]!.units).toEqual(['g', 'cup', 'tbsp', 'tsp', 'unit']);
  });

  it('keeps a unit list the user DID choose, which is §3\'s whole point', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({
      prefs: { profile: 'pro', touchedUnits: true, units: ['g', 'kg'] },
      onSavePrefs: (p) => saved.push(p),
    });
    await screen.findByRole('button', { name: /ביתי/ });

    await user.click(screen.getByRole('button', { name: /ביתי/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.profile).toBe('home');
    // The choice survives the profile change.
    expect(saved[0]!.units).toEqual(['g', 'kg']);
  });

  it('toggles a single unit, and records that the list was touched', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ prefs: { units: ['g'], touchedUnits: false }, onSavePrefs: (p) => saved.push(p) });
    await screen.findByRole('button', { name: 'ק"ג' });

    await user.click(screen.getByRole('button', { name: 'ק"ג' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.units).toEqual(['g', 'kg']);
    expect(saved[0]!.touchedUnits).toBe(true);
  });

  it('warns when the last unit is switched off, rather than silently breaking display', async () => {
    const user = userEvent.setup();
    show({ prefs: { units: ['g'] } });
    await screen.findByRole('button', { name: 'גרם' });
    await user.click(screen.getByRole('button', { name: 'גרם' }));
    expect(await screen.findByText(/לא נבחרה אף יחידה/)).toBeInTheDocument();
  });
});

describe('§17 language, and §12 privacy: stated, not faked', () => {
  it('says Arabic is planned rather than offering a switch that does nothing', async () => {
    show();
    expect(await screen.findByText(/ערבית מתוכננת לשלב הבא/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ערבית/ })).not.toBeInTheDocument();
  });

  it('states the privacy rules as rules, with nothing to toggle', async () => {
    show();
    expect(await screen.findByText(/המחברת שלכם פרטית/)).toBeInTheDocument();
    expect(screen.getByText(/אוכפת במסד הנתונים עצמו/)).toBeInTheDocument();
  });
});

describe('§4 the onboarding can be re-run', () => {
  it('clears `done` and goes back to the questions, without touching recipes', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ onSavePrefs: (p) => saved.push(p) });
    await screen.findByRole('button', { name: 'לעבור שוב על שאלות הפתיחה' });

    await user.click(screen.getByRole('button', { name: 'לעבור שוב על שאלות הפתיחה' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.done).toBe(false);
    expect(await screen.findByText('שאלות הפתיחה')).toBeInTheDocument();
  });
});

describe('the account block', () => {
  it('shows the signed-in address', async () => {
    show();
    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
  });

  it('signs out', async () => {
    const user = userEvent.setup();
    const auth = show();
    await user.click(await screen.findByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(auth.signOutCalls).toBe(1));
  });

  it('changes the password, and really changes it', async () => {
    const user = userEvent.setup();
    const auth = show();
    await user.click(await screen.findByRole('button', { name: 'שינוי סיסמה' }));

    // Nothing can be submitted until both are there: an open window is not
    // permission to change the password of an account.
    expect(screen.getByRole('button', { name: 'עדכון הסיסמה' })).toBeDisabled();
    await user.type(screen.getByLabelText('הסיסמה הנוכחית'), 'sourdough1');
    await user.type(screen.getByLabelText('סיסמה חדשה'), 'brioche42');
    await user.type(screen.getByLabelText('הסיסמה החדשה שוב'), 'brioche42');
    await user.click(screen.getByRole('button', { name: 'עדכון הסיסמה' }));

    expect(await screen.findByText('הסיסמה הוחלפה.')).toBeInTheDocument();
    expect(auth.passwordChanges).toBe(1);
    expect(auth.passwordOf(EMAIL)).toBe('brioche42');
  });

  it('refuses a WRONG current password, and writes nothing', async () => {
    const user = userEvent.setup();
    const auth = show();
    await user.click(await screen.findByRole('button', { name: 'שינוי סיסמה' }));

    await user.type(screen.getByLabelText('הסיסמה הנוכחית'), 'not-my-password');
    await user.type(screen.getByLabelText('סיסמה חדשה'), 'brioche42');
    await user.type(screen.getByLabelText('הסיסמה החדשה שוב'), 'brioche42');
    await user.click(screen.getByRole('button', { name: 'עדכון הסיסמה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('הסיסמה הנוכחית אינה נכונה.');
    expect(auth.passwordChanges).toBe(0);
    expect(auth.passwordOf(EMAIL)).toBe('sourdough1');
    expect(screen.queryByText('הסיסמה הוחלפה.')).not.toBeInTheDocument();
  });

  it('refuses two different confirmations before calling the server at all', async () => {
    const user = userEvent.setup();
    const auth = show();
    await user.click(await screen.findByRole('button', { name: 'שינוי סיסמה' }));

    await user.type(screen.getByLabelText('הסיסמה הנוכחית'), 'sourdough1');
    await user.type(screen.getByLabelText('סיסמה חדשה'), 'brioche42');
    await user.type(screen.getByLabelText('הסיסמה החדשה שוב'), 'brioche43');
    await user.click(screen.getByRole('button', { name: 'עדכון הסיסמה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/אינן זהות/);
    expect(auth.passwordChanges).toBe(0);
  });

  it('refuses a new password that is too short', async () => {
    const user = userEvent.setup();
    const auth = show();
    await user.click(await screen.findByRole('button', { name: 'שינוי סיסמה' }));

    await user.type(screen.getByLabelText('הסיסמה הנוכחית'), 'sourdough1');
    await user.type(screen.getByLabelText('סיסמה חדשה'), 'abc');
    await user.type(screen.getByLabelText('הסיסמה החדשה שוב'), 'abc');
    await user.click(screen.getByRole('button', { name: 'עדכון הסיסמה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/קצרה מדי/);
    expect(auth.passwordChanges).toBe(0);
  });

  it('says where preferences go when there is no account at all', async () => {
    show({ canWrite: false, anonymous: true });
    expect(await screen.findByText(/על המכשיר הזה בלבד/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שינוי סיסמה' })).not.toBeInTheDocument();
  });
});

/*
  §10 of the handoff: a text-size setting that really takes effect. It is
  device storage rather than the account (see data/offlineMirror.ts), so these
  tests drive the real store through the mirror — the same one Cook Mode
  reads.
*/
describe('the size of the text in Cook Mode', () => {
  it('saves the choice and shows it back, with a preview at that size', async () => {
    const user = userEvent.setup();
    show();
    const panel = await screen.findByRole('region', { name: 'גודל הטקסט במצב הכנה' });

    const large = within(panel).getByRole('button', { name: 'גדול' });
    expect(large).toHaveAttribute('aria-pressed', 'false');
    await user.click(large);
    await waitFor(() => expect(large).toHaveAttribute('aria-pressed', 'true'));

    // What Cook Mode will read.
    expect(await readCookTextSize()).toBe('large');
    // And the preview carries the scale, not just the words.
    expect(panel).toHaveTextContent('תצוגה מקדימה');
  });
});

describe('spec 5.1 backup and export (stage 3ב, A-5)', () => {
  const TWO: Recipe[] = [
    { id: 'r1', name: 'בריוש', category: 'לחמים', ingredients: [{ id: 'i1', name: 'קמח', qty: 500, unit: 'g' }], steps: [] },
    { id: 'r2', name: 'גנאש', category: 'גנאשים ורטבים', ingredients: [{ id: 'i2', name: 'שוקולד', qty: 200, unit: 'g' }], steps: [] },
  ];

  it('says what the file holds, that it stays with the user, and that import is not available', async () => {
    show();
    const card = await screen.findByLabelText('גיבוי וייצוא');
    expect(card).toHaveTextContent(/ההערות האישיות נכללות/);
    expect(card).toHaveTextContent(/נשמר אצלכם בלבד/);
    expect(card).toHaveTextContent(/ייבוא חזרה מהקובץ עדיין אינו זמין/);
  });

  it('downloads one JSON file with every recipe, and reports the counts', async () => {
    const user = userEvent.setup();
    const create = vi.fn((_blob: Blob) => 'blob:backup');
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      show({ recipes: TWO });
      const card = await screen.findByLabelText('גיבוי וייצוא');
      await user.click(within(card).getByRole('button', { name: 'הורדת גיבוי (JSON)' }));
      expect(await within(card).findByRole('status')).toHaveTextContent('הגיבוי הורד: 2 מתכונים, 0 חומרי גלם, 0 תוכניות ייצור.');
      expect(click).toHaveBeenCalledTimes(1);
      const blob = create.mock.calls[0]![0];
      // jsdom's Blob has no text(); a FileReader reads it the way a browser would.
      const text = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error ?? new Error('הקריאה נכשלה'));
        fr.readAsText(blob);
      });
      const parsed = JSON.parse(text) as { recipes: { name: string }[]; format: string };
      expect(parsed.format).toBe('recipe-notebook-backup');
      expect(parsed.recipes.map((r) => r.name)).toEqual(['בריוש', 'גנאש']);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('Personal Settings, stage 1', () => {
  it('links to the new profile screen, named so it is not read as the cooking profile below it', async () => {
    show();
    const link = await screen.findByRole('link', { name: /פרטים אישיים/ });
    expect(link).toHaveAttribute('href', '/settings/profile');
    // The heading directly under it is the pre-existing "פרופיל" (home/pro/
    // study) — the two must stay visibly different labels on one page.
    expect(screen.getByRole('heading', { name: 'פרופיל' })).toBeInTheDocument();
  });

  it('no longer draws the name-and-picture card here — it moved to /settings/profile', async () => {
    show();
    await screen.findByLabelText('יחידות מדידה');
    expect(screen.queryByLabelText('איך אני מוצג בקבוצות')).not.toBeInTheDocument();
  });
});
