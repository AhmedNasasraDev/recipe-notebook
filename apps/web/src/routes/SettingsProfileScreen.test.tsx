// /settings/profile — "פרטים אישיים".
//
// Personal Settings, stage 2: this screen now also carries the picture (moved
// here from the deleted IdentityCard — see its own git history for the tests
// this file's "the picture" describe block continues) and the password /
// sign-out controls (moved here from the old settings hub, see
// SettingsScreen.test.tsx's git history for where those used to live).
//
// Rendered through the REAL AuthProvider against the auth double, exactly as
// AppSession.test.tsx does, so the password change exercises the real
// `changePassword` — including the re-authentication step, which is the part
// worth testing.

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

function show(groups: FakeGroupOptions = {}, canWrite = true, anonymous = false) {
  const auth = createFakeAuth({
    accounts: { [EMAIL]: { id: 'u1', password: 'sourdough1', confirmed: true } },
    storedSession: anonymous ? null : { access_token: 't', user: { id: 'u1', email: EMAIL } },
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
  return auth;
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
    const save = screen.getByRole('button', { name: 'שמירת הפרטים' });
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
    await userEvent.click(screen.getByRole('button', { name: 'שמירת הפרטים' }));
    expect(await screen.findByText('נשמר')).toBeInTheDocument();
  });

  it('disables the form when the installation cannot write', async () => {
    show({ identity: { displayName: '', avatarPath: null } }, false);
    await waitFor(() => expect(screen.getByLabelText(/שם פרטי/)).toBeDisabled());
    expect(screen.getByLabelText(/שם משפחה/)).toBeDisabled();
  });
});

describe('the picture', () => {
  it('shows initials while there is no picture', async () => {
    show({ identity: { displayName: 'אחמד נסאסרה', avatarPath: null, firstName: 'אחמד', lastName: 'נסאסרה' } });
    expect(await screen.findByText('אנ')).toBeInTheDocument();
  });

  it('uploads one and shows it', async () => {
    show({
      identity: { displayName: 'אחמד', avatarPath: null },
      avatarUrls: { 'me/avatar.webp': 'blob:avatar' },
    });
    const input = await screen.findByLabelText('העלאת תמונה');
    await userEvent.upload(
      input,
      new File([new Uint8Array(10)], 'me.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() =>
      expect(document.querySelector('img[src="blob:avatar"]')).not.toBeNull(),
    );
  });

  it('offers to remove a picture only when there is one', async () => {
    show({ identity: { displayName: 'אחמד', avatarPath: null } });
    await screen.findByLabelText('העלאת תמונה');
    expect(screen.queryByRole('button', { name: 'הסרה' })).not.toBeInTheDocument();
  });

  it('removes it', async () => {
    show({
      identity: { displayName: 'אחמד', avatarPath: 'me/avatar.webp' },
      avatarUrls: { 'me/avatar.webp': 'blob:avatar' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'הסרה' }));
    await waitFor(() =>
      expect(document.querySelector('img[src="blob:avatar"]')).toBeNull(),
    );
  });

  it('says the original data is dropped, including a location', async () => {
    show();
    expect(await screen.findByText(/ללא נתוני המקור — כולל מיקום/)).toBeInTheDocument();
  });

  it('reports a conversion failure instead of a silent nothing', async () => {
    const repo = fakeRepository({ canWrite: true, source: 'supabase' });
    const broken = {
      ...repo,
      setAvatar: async () => {
        throw new Error('הקובץ הזה אינו תמונה. אפשר להעלות JPG, PNG, HEIC או WebP.');
      },
    };
    const auth = createFakeAuth({
      accounts: { [EMAIL]: { id: 'u1', password: 'sourdough1', confirmed: true } },
      storedSession: { access_token: 't', user: { id: 'u1', email: EMAIL } },
    });
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <AuthProvider client={auth.client as TypedSupabaseClient}>
          <AppDataProvider repository={broken}>
            <SettingsProfileScreen />
          </AppDataProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await userEvent.upload(
      await screen.findByLabelText('העלאת תמונה'),
      new File([new Uint8Array(4)], 'broken.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('אינו תמונה');
  });
});

describe('phone and email', () => {
  it('shows the account email and a plain "coming soon" tag for phone, not an empty field', async () => {
    show();
    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText('בקרוב')).toBeInTheDocument();
  });
});

describe('password and sign-out', () => {
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

  it('says where preferences go when there is no account at all', async () => {
    show({}, false, true);
    expect(await screen.findByText(/על המכשיר הזה בלבד/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שינוי סיסמה' })).not.toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('goes to the settings list', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'הגדרות' }));
    expect(await screen.findByText('הגדרות')).toBeInTheDocument();
  });
});
