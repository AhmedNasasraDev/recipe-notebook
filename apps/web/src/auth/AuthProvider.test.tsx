import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, memoryIdbStore, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, authErrorInHebrew, useAuth } from './AuthProvider.js';
import { AuthGate } from './AuthGate.js';
import { createFakeAuth, CONFIRMED_ACCOUNT, type FakeAuthClient } from '../test/fakeAuth.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import { MIRROR_KEYS } from '../data/offlineMirror.js';

/** Prints the provider's state, so a test can assert on it without a screen. */
function Probe() {
  const { status, user } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="email">{user?.email ?? '-'}</p>
    </div>
  );
}

const renderWith = (fake: FakeAuthClient | null) =>
  render(
    <AuthProvider client={(fake?.client ?? null) as TypedSupabaseClient | null}>
      <Probe />
    </AuthProvider>,
  );

const status = () => screen.getByTestId('status').textContent;

beforeEach(() => {
  resetMemoryIdb();
});

describe('the session decides what the app shows', () => {
  it('reports unconfigured when there is no client, rather than signed-out', async () => {
    renderWith(null);
    // The difference matters: signed-out means "show the sign-in screen", and
    // unconfigured means "there is no server to sign in to".
    await waitFor(() => expect(status()).toBe('unconfigured'));
  });

  it('starts as signed-out when no session is stored', async () => {
    renderWith(createFakeAuth());
    await waitFor(() => expect(status()).toBe('signed-out'));
  });

  it('restores a stored session, so a refresh does not sign the user out', async () => {
    const fake = createFakeAuth({
      storedSession: {
        access_token: 't',
        user: { id: 'user-ahmed', email: 'ahmed@test.invalid' },
      },
    });
    renderWith(fake);
    await waitFor(() => expect(status()).toBe('signed-in'));
    expect(screen.getByTestId('email').textContent).toBe('ahmed@test.invalid');
  });

  it('treats a failed restore as signed-out, not as a broken app', async () => {
    renderWith(createFakeAuth({ failRestore: true }));
    await waitFor(() => expect(status()).toBe('signed-out'));
  });

  it('follows a sign-out that happened somewhere else, e.g. another tab', async () => {
    const fake = createFakeAuth({
      storedSession: { access_token: 't', user: { id: 'u1', email: 'a@test.invalid' } },
    });
    renderWith(fake);
    await waitFor(() => expect(status()).toBe('signed-in'));
    fake.emit('SIGNED_OUT', null);
    await waitFor(() => expect(status()).toBe('signed-out'));
  });
});

describe('the sign-in screen, end to end through the provider', () => {
  const renderApp = (fake: FakeAuthClient) =>
    render(
      <AuthProvider client={fake.client as TypedSupabaseClient}>
        <AuthGate>
          <Probe />
        </AuthGate>
      </AuthProvider>,
    );

  it('signs an existing account in and hands over to the app', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({ accounts: { ...CONFIRMED_ACCOUNT } });
    renderApp(fake);

    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.type(screen.getByLabelText('אימייל'), 'ahmed@test.invalid');
    await user.type(screen.getByLabelText('סיסמה'), 'sourdough1');
    await user.click(screen.getByRole('button', { name: 'כניסה למחברת' }));

    await waitFor(() => expect(status()).toBe('signed-in'));
  });

  it('says the password is wrong in Hebrew, and stays put', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({ accounts: { ...CONFIRMED_ACCOUNT } });
    renderApp(fake);

    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.type(screen.getByLabelText('אימייל'), 'ahmed@test.invalid');
    await user.type(screen.getByLabelText('סיסמה'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'כניסה למחברת' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'האימייל או הסיסמה אינם נכונים.',
    );
    expect(screen.queryByTestId('status')).not.toBeInTheDocument();
  });

  it('refuses an address that is not an address, without calling the server (QA 22.09.2026, finding 16)', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({ accounts: { ...CONFIRMED_ACCOUNT } });
    renderApp(fake);
    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.type(screen.getByLabelText('אימייל'), 'not-an-email');
    await user.type(screen.getByLabelText('סיסמה'), 'sourdough1');
    await user.click(screen.getByRole('button', { name: 'כניסה למחברת' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('כתובת האימייל אינה תקינה');
    expect(screen.queryByText('רגע…')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status')).not.toBeInTheDocument();
  });

  it('refuses an empty form without calling the server', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth();
    renderApp(fake);
    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.click(screen.getByRole('button', { name: 'כניסה למחברת' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('יש למלא אימייל וסיסמה.');
  });

  it('signs a new account up and goes straight in when confirmation is off', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({ confirmEmail: false });
    renderApp(fake);

    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.click(screen.getByRole('button', { name: 'הרשמה' }));
    await user.type(screen.getByLabelText('אימייל'), 'new@test.invalid');
    await user.type(screen.getByLabelText('סיסמה'), 'brioche123');
    await user.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    await waitFor(() => expect(status()).toBe('signed-in'));
  });

  it('does NOT claim the user is in when the project requires a confirmation email', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({ confirmEmail: true });
    renderApp(fake);

    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.click(screen.getByRole('button', { name: 'הרשמה' }));
    await user.type(screen.getByLabelText('אימייל'), 'new@test.invalid');
    await user.type(screen.getByLabelText('סיסמה'), 'brioche123');
    await user.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/יש לאשר אותו ואז להתחבר/);
    // still outside the app
    expect(screen.queryByTestId('status')).not.toBeInTheDocument();
  });

  it('explains an unconfirmed account on a later sign-in attempt', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({
      accounts: {
        'pending@test.invalid': { id: 'u9', password: 'brioche123', confirmed: false },
      },
    });
    renderApp(fake);

    await screen.findByRole('heading', { name: 'מחברת מתכונים' });
    await user.type(screen.getByLabelText('אימייל'), 'pending@test.invalid');
    await user.type(screen.getByLabelText('סיסמה'), 'brioche123');
    await user.click(screen.getByRole('button', { name: 'כניסה למחברת' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/עדיין לא אושר/);
  });
});

describe('signing out', () => {
  function SignOutProbe() {
    const { status: s, signOut } = useAuth();
    return (
      <div>
        <p data-testid="status">{s}</p>
        <button type="button" onClick={() => void signOut()}>
          התנתקות
        </button>
      </div>
    );
  }

  it('ends the session', async () => {
    const user = userEvent.setup();
    const fake = createFakeAuth({
      storedSession: { access_token: 't', user: { id: 'u1', email: 'a@test.invalid' } },
    });
    render(
      <AuthProvider client={fake.client as TypedSupabaseClient}>
        <SignOutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe('signed-in'));

    await user.click(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(fake.signOutCalls).toBe(1);
  });

  it('wipes the local copy, so the next person on the device cannot read it', async () => {
    const user = userEvent.setup();
    const { writePrefs, writeRecipe } = await import('../data/offlineMirror.js');
    await writePrefs({ profile: 'pro', pro: true, tools: { cup: 250 }, done: true });
    await writeRecipe({ id: 'r1', name: 'סוד מקצועי' } as never);
    expect(memoryIdbStore().has(MIRROR_KEYS.prefs)).toBe(true);

    const fake = createFakeAuth({
      storedSession: { access_token: 't', user: { id: 'u1', email: 'a@test.invalid' } },
    });
    render(
      <AuthProvider client={fake.client as TypedSupabaseClient}>
        <SignOutProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe('signed-in'));
    await user.click(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(status()).toBe('signed-out'));

    expect(memoryIdbStore().size).toBe(0);
  });
});

describe('Supabase error messages are translated, not surfaced raw', () => {
  it.each([
    ['Invalid login credentials', 'האימייל או הסיסמה אינם נכונים.'],
    ['Email not confirmed', 'החשבון עדיין לא אושר. יש לאשר את הקישור שנשלח באימייל ואז להתחבר.'],
    ['User already registered', 'קיים כבר חשבון עם האימייל הזה. אפשר להתחבר איתו.'],
    ['Password should be at least 8 characters', 'הסיסמה קצרה מדי. נדרשים לפחות 8 תווים.'],
    ['Unable to validate email address: invalid format', 'כתובת האימייל אינה תקינה.'],
    ['Request rate limit reached', 'יותר מדי נסיונות. נסו שוב בעוד דקה.'],
    ['TypeError: Failed to fetch', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'],
  ])('%s', (input, expected) => {
    expect(authErrorInHebrew(input)).toBe(expected);
  });

  it('passes an unknown message through rather than hiding it', () => {
    // A failure nobody anticipated must stay visible, even in English.
    expect(authErrorInHebrew('Something nobody mapped')).toBe('Something nobody mapped');
  });
});
