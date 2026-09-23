// /settings/recipe-preferences. Moved out of the old §20 one-page settings —
// see SettingsScreen.test.tsx's git history for where these tests used to
// live. "רמת פירוט" was called "פרופיל" there; only the label changed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

/* The text-size setting is DEVICE storage, and jsdom has no IndexedDB — so
   the mirror's own code stays under test and only the store beneath it is
   replaced. See test/memoryIdb.ts. */
vi.mock('idb-keyval', () => memoryIdb());
beforeEach(() => resetMemoryIdb());

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { defaultPrefs, type MeasurementPrefs } from '@recipe-notebook/engine';
import { SettingsRecipePreferencesScreen } from './SettingsRecipePreferencesScreen.js';
import { readCookTextSize } from '../data/offlineMirror.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { fakeRepository } from '../test/render.js';

function show(prefs: Partial<MeasurementPrefs> = {}, onSavePrefs?: (p: MeasurementPrefs) => void) {
  const repository = fakeRepository({
    prefs: { ...defaultPrefs('pro'), done: true, ...prefs },
    ...(onSavePrefs ? { onSavePrefs } : {}),
  });
  render(
    <MemoryRouter initialEntries={['/settings/recipe-preferences']}>
      <AppDataProvider repository={repository}>
        <Routes>
          <Route path="/settings/recipe-preferences" element={<SettingsRecipePreferencesScreen />} />
          <Route path="/onboarding" element={<p>שאלות הפתיחה</p>} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

describe('§3 the level can be changed after onboarding', () => {
  it('shows which level is in use, with what each one means', async () => {
    show({ profile: 'pro' });
    const pressed = await screen.findByRole('button', { name: /מקצועי/, pressed: true });
    expect(pressed).toBeInTheDocument();
    expect(screen.getByText(/אינה נועלת שום יכולת/)).toBeInTheDocument();
  });

  it("replaces the unit list with the new level's while the user has not chosen one", async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ profile: 'pro', touchedUnits: false }, (p) => saved.push(p));
    await screen.findByRole('button', { name: /ביתי/ });

    await user.click(screen.getByRole('button', { name: /ביתי/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.profile).toBe('home');
    expect(saved[0]!.pro).toBe(false);
    expect(saved[0]!.units).toEqual(['g', 'cup', 'tbsp', 'tsp', 'unit']);
  });

  it("keeps a unit list the user DID choose, which is §3's whole point", async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ profile: 'pro', touchedUnits: true, units: ['g', 'kg'] }, (p) => saved.push(p));
    await screen.findByRole('button', { name: /ביתי/ });

    await user.click(screen.getByRole('button', { name: /ביתי/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.profile).toBe('home');
    expect(saved[0]!.units).toEqual(['g', 'kg']);
  });

  it('toggles a single unit, and records that the list was touched', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ units: ['g'], touchedUnits: false }, (p) => saved.push(p));
    await screen.findByRole('button', { name: 'ק"ג' });

    await user.click(screen.getByRole('button', { name: 'ק"ג' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.units).toEqual(['g', 'kg']);
    expect(saved[0]!.touchedUnits).toBe(true);
  });

  it('warns when the last unit is switched off, rather than silently breaking display', async () => {
    const user = userEvent.setup();
    show({ units: ['g'] });
    await screen.findByRole('button', { name: 'גרם' });
    await user.click(screen.getByRole('button', { name: 'גרם' }));
    expect(await screen.findByText(/לא נבחרה אף יחידה/)).toBeInTheDocument();
  });
});

describe('the size of the text in Cook Mode', () => {
  it('saves the choice and shows it back, with a preview at that size', async () => {
    const user = userEvent.setup();
    show();
    const panel = await screen.findByRole('region', { name: 'גודל הטקסט במצב הכנה' });

    const large = within(panel).getByRole('button', { name: 'גדול' });
    expect(large).toHaveAttribute('aria-pressed', 'false');
    await user.click(large);
    await waitFor(() => expect(large).toHaveAttribute('aria-pressed', 'true'));

    expect(await readCookTextSize()).toBe('large');
    expect(panel).toHaveTextContent('תצוגה מקדימה');
  });
});

describe('§4 the onboarding can be re-run', () => {
  it('clears `done` and goes back to the questions, without touching recipes', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({}, (p) => saved.push(p));
    await screen.findByRole('button', { name: 'לעבור שוב על שאלות הפתיחה' });

    await user.click(screen.getByRole('button', { name: 'לעבור שוב על שאלות הפתיחה' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.done).toBe(false);
    expect(await screen.findByText('שאלות הפתיחה')).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('goes to the settings list', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
  });
});
