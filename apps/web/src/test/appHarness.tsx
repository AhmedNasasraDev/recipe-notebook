// The real component tree, with only the network doubled.
//
// Shared by the flow tests (`RecipeFlow.test.tsx`, `VersionFlow.test.tsx`).
// Everything below the network is production code: the router, AuthProvider,
// AuthGate, AppDataProvider, the screens, the draft model, `mappers.ts` and
// `SupabaseRepository`. The double enforces the row-level policies from the
// migrations and emulates the RPCs from 0007, so "this account cannot see that
// row" and "a save is one atomic call" both still mean what they mean in
// production.
//
// A caller must still declare `vi.mock('idb-keyval', () => memoryIdb())` in its
// own file — `vi.mock` is hoisted per file and cannot be shared from here.

import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import { AuthGate } from '../auth/AuthGate.js';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { OnboardingGate } from '../app/OnboardingGate.js';
import { AppShell } from '../shell/AppShell.js';
import { OnboardingScreen } from '../routes/OnboardingScreen.js';
import { NotebookScreen } from '../routes/NotebookScreen.js';
import { RecipeScreen } from '../routes/RecipeScreen.js';
import { RecipeEditScreen } from '../routes/RecipeEditScreen.js';
import { IngredientsScreen } from '../routes/IngredientsScreen.js';
import { PlansScreen } from '../routes/PlansScreen.js';
import { PlanScreen } from '../routes/PlanScreen.js';
import { MoreScreen } from '../routes/MoreScreen.js';
import { SettingsScreen } from '../routes/SettingsScreen.js';
import { ToolsScreen } from '../routes/ToolsScreen.js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import { createFakeSupabase, type FakeDb, type FakeSupabase } from './fakeSupabase.js';
import { createFakeAuth, type FakeAuthClient } from './fakeAuth.js';

export function AppUnderTest({
  client,
  route = '/notebook',
}: {
  client: unknown;
  route?: string;
}) {
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
                <Route path="/recipe/new" element={<RecipeEditScreen />} />
                <Route path="/recipe/:recipeId/edit" element={<RecipeEditScreen />} />
                <Route path="/recipe/:recipeId" element={<RecipeScreen />} />
                <Route path="/ingredients" element={<IngredientsScreen />} />
                <Route path="/plans" element={<PlansScreen />} />
                <Route path="/plan/:planId" element={<PlanScreen />} />
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

export function emptyDb(): FakeDb {
  return {
    profiles: [], recipes: [], ingredients: [], steps: [], issues: [],
    trials: [], batches: [], recipe_versions: [], private_notes: [], calibrations: [],
    ingredient_catalog: [],
    ingredient_purchases: [],
    production_plans: [],
    production_plan_items: [],
    production_plan_stock: [],
  };
}

export interface Project {
  client: unknown;
  data: FakeSupabase;
  auth: FakeAuthClient;
  db: FakeDb;
}

/** One project, one signed-in account, reusable across "refreshes". */
export function project(db: FakeDb, userId: string, email = 'ahmed@test.invalid'): Project {
  const data = createFakeSupabase({ db, authUid: userId });
  const auth = createFakeAuth({
    storedSession: { access_token: 't', user: { id: userId, email } },
  });
  return {
    client: {
      from: (t: string) => (data.client as { from(t: string): unknown }).from(t),
      // The RPCs from migration 0007 must be forwarded too: since stage 5 a
      // save IS an rpc call, so a client without this silently breaks saving.
      rpc: (n: string, a: Record<string, unknown>) =>
        (data.client as { rpc(n: string, a: Record<string, unknown>): unknown }).rpc(n, a),
      auth: (auth.client as { auth: unknown }).auth,
    },
    data,
    auth,
    db,
  };
}
