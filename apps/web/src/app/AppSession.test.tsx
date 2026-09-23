// The whole session, end to end: sign in → profile → onboarding → notebook,
// with the real AuthProvider, the real AppDataProvider, the real repository and
// the real screens. Only the network is a double.
//
// This is the test that covers the seams the unit tests cannot see between:
//   • which repository a signed-in session actually gets (requirement 1, 4)
//   • that a new account's notebook is EMPTY, not seeded with the demo recipes
//     (requirement 6)
//   • that onboarding writes to profiles and is not asked twice (requirement 3)
//   • that a remount — which is what a refresh or a second device is — reads the
//     answers back from the server rather than from component state

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import { AuthGate } from '../auth/AuthGate.js';
import { AppDataProvider } from './AppDataProvider.js';
import { OnboardingGate } from './OnboardingGate.js';
import { AppShell } from '../shell/AppShell.js';
import { OnboardingScreen } from '../routes/OnboardingScreen.js';
import { NotebookScreen } from '../routes/NotebookScreen.js';
import { RecipeScreen } from '../routes/RecipeScreen.js';
import { MoreScreen } from '../routes/MoreScreen.js';
import { SettingsScreen } from '../routes/SettingsScreen.js';
import { ToolsScreen } from '../routes/ToolsScreen.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import {
  createFakeSupabase,
  ingredientRow,
  newProfileRow,
  recipeRow,
  resetFakeIds,
  USER_A,
  USER_B,
  type FakeDb,
} from '../test/fakeSupabase.js';
import { createFakeAuth, type FakeAuthOptions } from '../test/fakeAuth.js';

/** The app's real route tree, rendered into a MemoryRouter. */
function AppUnderTest({ client, route = '/notebook' }: { client: unknown; route?: string }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider client={client as TypedSupabaseClient | null}>
        <AuthGate>
          <AppDataProvider>
            <Routes>
              <Route path="/onboarding" element={<OnboardingScreen />} />
              <Route
                element={
                  <OnboardingGate>
                    <AppShell />
                  </OnboardingGate>
                }
              >
                <Route path="/notebook" element={<NotebookScreen />} />
                <Route path="/recipe/:recipeId" element={<RecipeScreen />} />
                <Route path="/more" element={<MoreScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="/tools" element={<ToolsScreen />} />
              </Route>
              <Route path="*" element={<Navigate to="/notebook" replace />} />
            </Routes>
          </AppDataProvider>
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>
  );
}

/** A signed-in session against a seeded database. */
function project(db: FakeDb, userId: string, authOpts: FakeAuthOptions = {}) {
  const data = createFakeSupabase({ db, authUid: userId });
  const auth = createFakeAuth({
    storedSession: { access_token: 't', user: { id: userId, email: 'ahmed@test.invalid' } },
    ...authOpts,
  });
  const client = {
    from: (t: string) => (data.client as { from(t: string): unknown }).from(t),
    rpc: (n: string, a: Record<string, unknown>) =>
      (data.client as { rpc(n: string, a: Record<string, unknown>): unknown }).rpc(n, a),
    auth: (auth.client as { auth: unknown }).auth,
  };
  return { client, data, auth, db };
}

function emptyDb(): FakeDb {
  return {
    profiles: [], recipes: [], ingredients: [], steps: [], issues: [],
    trials: [], batches: [], recipe_versions: [], private_notes: [], calibrations: [],
  };
}

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
});

describe('requirement 6 — a new account gets an empty notebook, not the demo set', () => {
  it('shows no recipes at all for a fresh account', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);

    expect(await screen.findByText('המחברת ריקה.')).toBeInTheDocument();
    // The five demo recipes must be nowhere near this account.
    expect(screen.queryByText('בריוש נאנטר')).not.toBeInTheDocument();
    expect(screen.getByText(/^0 מתכונים$/)).toBeInTheDocument();
  });

  it('shows the account\'s own recipes once they exist', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('r1', USER_A, { name: 'חלה של אחמד' }));
    db['ingredients']!.push(ingredientRow('r1'));
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);
    expect(await screen.findByText('חלה של אחמד')).toBeInTheDocument();
  });

  it('does not show another account\'s recipe, even when it is in the same store', async () => {
    const db = emptyDb();
    db['profiles']!.push(
      newProfileRow(USER_A, { onboarding_done: true }),
      newProfileRow(USER_B, { onboarding_done: true }),
    );
    db['recipes']!.push(
      recipeRow('r1', USER_A, { name: 'חלה של אחמד' }),
      recipeRow('r2', USER_B, { name: 'הבריוש הסודי של ב' }),
    );
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);
    expect(await screen.findByText('חלה של אחמד')).toBeInTheDocument();
    expect(screen.queryByText('הבריוש הסודי של ב')).not.toBeInTheDocument();
  });
});

describe('requirement 3 — onboarding runs once and is answered on the server', () => {
  it('sends a new account to onboarding rather than into the notebook', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A)); // onboarding_done: false
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);
    // §4: the first question of the onboarding
    expect(await screen.findByRole('button', { name: /מקצועי/ })).toBeInTheDocument();
  });

  it('writes the answers to profiles, and does not ask again after a remount', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A));
    const { client } = project(db, USER_A);

    const first = render(<AppUnderTest client={client} />);
    await screen.findByRole('button', { name: /מקצועי/ });

    // Walk the onboarding to the end.
    await user.click(screen.getByRole('button', { name: /מקצועי/ }));
    let next = screen.queryByRole('button', { name: /המשך|סיום|למחברת/ });
    let guard = 0;
    while (next && guard++ < 8) {
      await user.click(next);
      next = screen.queryByRole('button', { name: /המשך|סיום|למחברת/ });
    }

    await waitFor(() =>
      expect(db['profiles']![0]!['onboarding_done']).toBe(true),
    );
    first.unmount();

    // A remount is what a refresh, or a login on another device, actually is.
    render(<AppUnderTest client={client} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /מקצועי/ })).toBeNull());
    expect(await screen.findByText('המחברת ריקה.')).toBeInTheDocument();
  });

  it('persists the cup size, and the recipe page then computes with it', async () => {
    // 2 cups of flour at 250 ml/cup is 250 g, at 240 ml/cup it is 240 g (B1).
    const db = emptyDb();
    db['profiles']!.push(
      newProfileRow(USER_A, {
        onboarding_done: true,
        tools: { cup: 250, tbsp: 15, tsp: 5 },
      }),
    );
    db['recipes']!.push(
      recipeRow('r1', USER_A, { name: 'עוגה בכוסות', yield_units: 12, unit_weight: 60 }),
    );
    db['ingredients']!.push(
      ingredientRow('r1', { name: 'קמח לבן', qty: 2, unit: 'כוס' }),
    );
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} route="/recipe/r1" />);
    await screen.findByRole('heading', { name: 'עוגה בכוסות' });

    const row = within(screen.getByText('קמח לבן').closest('button')!);
    expect(row.getByText("250 גר'")).toBeInTheDocument();
    expect(row.queryByText("240 גר'")).not.toBeInTheDocument();
  });
});

describe('requirement 1 and 4 — a signed-in session is served by Supabase', () => {
  it('reports the account as the data source, with no demo banner', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);
    await screen.findByText('המחברת ריקה.');
    expect(screen.queryByText(/מתכוני הדמו/)).not.toBeInTheDocument();
  });

  it('runs the onboarding locally when no project is configured', async () => {
    // client = null is the "no .env.local" case. There is no account, so the
    // answers live on the device — but they are still asked for.
    render(<AppUnderTest client={null} />);
    expect(await screen.findByRole('button', { name: /מקצועי/ })).toBeInTheDocument();
  });

  it('then serves the demo set, explicitly labelled, from the read-only repository', async () => {
    // Onboarding already answered on this device, which for the demo repository
    // means the mirror holds the preferences.
    const { writePrefs } = await import('../data/offlineMirror.js');
    await writePrefs({
      profile: 'pro', pro: true, units: ['g'], tools: { cup: 240, tbsp: 15, tsp: 5 },
      done: true, calib: [],
    });

    render(<AppUnderTest client={null} />);
    // The demo set is labelled as such, and it is not an account's private
    // notebook — which is the distinction requirement 6 asks for.
    expect(await screen.findByText(/מתכוני הדמו לקריאה בלבד/)).toBeInTheDocument();
    expect(screen.getByText('בריוש נאנטר')).toBeInTheDocument();
  });
});

describe('requirement 2 — signing out', () => {
  it('offers sign-out with the account address, and returns to the sign-in screen', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const { client, auth } = project(db, USER_A);

    // STAGE-11: the account block moved from "עוד" to הגדרות, which is where
    // §2 screen 20 puts it. The behaviour under test is unchanged.
    render(<AppUnderTest client={client} route="/settings" />);
    expect(await screen.findByText('ahmed@test.invalid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(auth.signOutCalls).toBe(1));
    // AuthGate swaps the app for the sign-in screen.
    expect(await screen.findByRole('button', { name: 'כניסה למחברת' })).toBeInTheDocument();
  });

  // ── stage-10 audit, §11: a session that dies on its own ────────────────
  it('an expired session lands on the sign-in screen, not on a broken app', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('r1', USER_A, { name: 'בריוש' }));
    const { client, auth } = project(db, USER_A);

    render(<AppUnderTest client={client} route="/notebook" />);
    expect(await screen.findByText('בריוש')).toBeInTheDocument();

    // GoTrue emits this when a refresh fails and the token is gone — the user
    // pressed nothing. Nothing else in the app tells it the session died.
    auth.emit('SIGNED_OUT', null);

    expect(await screen.findByRole('button', { name: 'כניסה למחברת' })).toBeInTheDocument();
    // And the notebook is no longer on screen behind it.
    expect(screen.queryByText('בריוש')).not.toBeInTheDocument();
  });
});
