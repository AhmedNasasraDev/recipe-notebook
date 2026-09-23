// Personal Settings, stage 1 — /settings/profile.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SettingsProfileScreen } from './SettingsProfileScreen.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { AuthProvider } from '../auth/AuthProvider.js';
import { fakeRepository } from '../test/render.js';
import { createFakeAuth } from '../test/fakeAuth.js';
import type { FakeGroupOptions } from '../test/fakeGroups.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';

const EMAIL = 'ahmed@test.invalid';

function show(groups: FakeGroupOptions = {}, canWrite = true) {
  const auth = createFakeAuth({
    accounts: { [EMAIL]: { id: 'u1', password: 'sourdough1', confirmed: true } },
    storedSession: { access_token: 't', user: { id: 'u1', email: EMAIL } },
  });
  const repository = fakeRepository({
    canWrite,
    source: canWrite ? 'supabase' : 'local-demo',
    groups,
  });
  render(
    <MemoryRouter initialEntries={['/settings/profile']}>
      <AuthProvider client={auth.client as TypedSupabaseClient}>
        <AppDataProvider repository={repository}>
          <Routes>
            <Route path="/settings/profile" element={<SettingsProfileScreen />} />
            <Route path="/settings" element={<p>הגדרות</p>} />
          </Routes>
        </AppDataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('first name and last name', () => {
  it('starts empty on an account that has never filled them in, and nudges towards the old display name', async () => {
    show({ identity: { displayName: 'אחמד נסאסרה', avatarPath: null } });
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toHaveValue(''));
    expect(screen.getByLabelText(/שם משפחה/)).toHaveValue('');
    expect(
      await screen.findByText(/השם המוצג היום הוא ״אחמד נסאסרה״/),
    ).toBeInTheDocument();
  });

  it('loads the stored first and last name when they exist, with no nudge', async () => {
    show({
      identity: {
        displayName: 'אחמד נסאסרה',
        avatarPath: null,
        firstName: 'אחמד',
        lastName: 'נסאסרה',
      },
    });
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toHaveValue('אחמד'));
    expect(screen.getByLabelText(/שם משפחה/)).toHaveValue('נסאסרה');
    expect(screen.queryByText(/השם המוצג היום הוא/)).not.toBeInTheDocument();
  });

  it('keeps the save button disabled until both fields are filled', async () => {
    show({ identity: { displayName: '', avatarPath: null } });
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toBeEnabled());
    const save = screen.getByRole('button', { name: 'שמירת שם פרטי ומשפחה' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/שם פרטי/), 'אחמד');
    expect(save).toBeDisabled();
    expect(await screen.findByText(/שם פרטי ושם משפחה הם שדות חובה/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/שם משפחה/), 'נסאסרה');
    expect(save).toBeEnabled();
  });

  it('saves first and last name', async () => {
    show({ identity: { displayName: '', avatarPath: null } });
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toBeEnabled());
    await userEvent.type(screen.getByLabelText(/שם פרטי/), 'אחמד');
    await userEvent.type(screen.getByLabelText(/שם משפחה/), 'נסאסרה');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת שם פרטי ומשפחה' }));
    expect(await screen.findByText('נשמר')).toBeInTheDocument();
  });

  it('disables the form when the installation cannot write', async () => {
    show({ identity: { displayName: '', avatarPath: null } }, false);
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toBeDisabled());
    expect(screen.getByLabelText(/שם משפחה/)).toBeDisabled();
  });
});

describe('phone and email', () => {
  it('shows the account email and says phone login is not yet available', async () => {
    show();
    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText('לא הוגדר')).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('goes to the settings list', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'הגדרות' }));
    expect(await screen.findByText('הגדרות')).toBeInTheDocument();
  });
});
