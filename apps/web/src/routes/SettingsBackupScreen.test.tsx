// /settings/backup (spec 5.1, stage 3ב, A-5). Moved verbatim out of the old
// §20 one-page settings — see SettingsScreen.test.tsx's git history for
// where these tests used to live.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Recipe } from '@recipe-notebook/engine';
import { SettingsBackupScreen } from './SettingsBackupScreen.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { AuthProvider } from '../auth/AuthProvider.js';
import { fakeRepository } from '../test/render.js';
import { createFakeAuth } from '../test/fakeAuth.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';

const EMAIL = 'ahmed@test.invalid';

function show(recipes?: Recipe[]) {
  const auth = createFakeAuth({
    accounts: { [EMAIL]: { id: 'u1', password: 'sourdough1', confirmed: true } },
    storedSession: { access_token: 't', user: { id: 'u1', email: EMAIL } },
  });
  const repository = fakeRepository({ ...(recipes ? { recipes } : {}) });
  render(
    <MemoryRouter initialEntries={['/settings/backup']}>
      <AuthProvider client={auth.client as TypedSupabaseClient}>
        <AppDataProvider repository={repository}>
          <Routes>
            <Route path="/settings/backup" element={<SettingsBackupScreen />} />
            <Route path="/settings" element={<p>הגדרות</p>} />
          </Routes>
        </AppDataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('spec 5.1 backup and export', () => {
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
      show(TWO);
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

  it('goes back to the settings list', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'הגדרות' }));
    expect(await screen.findByText('הגדרות')).toBeInTheDocument();
  });
});
