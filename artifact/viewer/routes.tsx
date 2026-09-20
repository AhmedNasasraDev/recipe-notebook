/*
  THE ROUTE TABLE, ONCE.

  Two non-product builds mount the product's screens: the audit viewer
  (./app.tsx) and the shareable demo (./demo.tsx). A route table copied into
  both would drift in one of them, so it lives here and they both render it —
  and `../scripts/check-routes.mjs` compares THIS file against
  `apps/web/src/App.tsx`, which is the product's own.

  The only path that is not the product's is `/__inspector/auth`: in production
  `AuthScreen` is shown by `AuthGate` when the session is signed out, not by a
  route. It is rendered only when the caller asks for it, which the audit
  viewer does and the demo does not.
*/

import { Navigate, Route, Routes } from 'react-router-dom';

import { OnboardingGate } from '../../apps/web/src/app/OnboardingGate.js';
import { AppShell } from '../../apps/web/src/shell/AppShell.js';
import { OnboardingScreen } from '../../apps/web/src/routes/OnboardingScreen.js';
import { NotebookScreen } from '../../apps/web/src/routes/NotebookScreen.js';
import { RecipeScreen } from '../../apps/web/src/routes/RecipeScreen.js';
import { RecipeEditScreen } from '../../apps/web/src/routes/RecipeEditScreen.js';
import { IngredientsScreen } from '../../apps/web/src/routes/IngredientsScreen.js';
import { PlansScreen } from '../../apps/web/src/routes/PlansScreen.js';
import { PlanScreen } from '../../apps/web/src/routes/PlanScreen.js';
import { MoreScreen } from '../../apps/web/src/routes/MoreScreen.js';
import { CookScreen } from '../../apps/web/src/routes/CookScreen.js';
import { LabelScreen } from '../../apps/web/src/routes/LabelScreen.js';
import { OrderScreen } from '../../apps/web/src/routes/OrderScreen.js';
import { PasteScreen } from '../../apps/web/src/routes/PasteScreen.js';
import { HomeScreen } from '../../apps/web/src/routes/HomeScreen.js';
import { SettingsScreen } from '../../apps/web/src/routes/SettingsScreen.js';
import { ToolsScreen } from '../../apps/web/src/routes/ToolsScreen.js';
import { GroupsScreen } from '../../apps/web/src/routes/GroupsScreen.js';
import { GroupScreen } from '../../apps/web/src/routes/GroupScreen.js';
import { PermsScreen } from '../../apps/web/src/routes/PermsScreen.js';
import { GroupRecipeScreen } from '../../apps/web/src/routes/GroupRecipeScreen.js';
import { JoinScreen } from '../../apps/web/src/routes/JoinScreen.js';
import { AuthScreen } from '../../apps/web/src/routes/AuthScreen.js';

export function AppRoutes({ authPreview = false }: { authPreview?: boolean }) {
  return (
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
          <Route path="/paste" element={<PasteScreen />} />
          <Route path="/recipe/new" element={<RecipeEditScreen />} />
          <Route path="/recipe/:recipeId/edit" element={<RecipeEditScreen />} />
          <Route path="/recipe/:recipeId" element={<RecipeScreen />} />
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/groups" element={<GroupsScreen />} />
          <Route path="/group/:groupId" element={<GroupScreen />} />
          <Route path="/group/:groupId/perms" element={<PermsScreen />} />
          <Route path="/group/:groupId/item/:itemId" element={<GroupRecipeScreen />} />
          <Route path="/ingredients" element={<IngredientsScreen />} />
          <Route path="/plans" element={<PlansScreen />} />
          <Route path="/plan/:planId" element={<PlanScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/tools" element={<ToolsScreen />} />
        </Route>
        <Route
          path="/recipe/:recipeId/cook"
          element={
            <OnboardingGate>
              <CookScreen />
            </OnboardingGate>
          }
        />
        <Route
          path="/recipe/:recipeId/label"
          element={
            <OnboardingGate>
              <LabelScreen />
            </OnboardingGate>
          }
        />
        <Route
          path="/recipe/:recipeId/order"
          element={
            <OnboardingGate>
              <OrderScreen />
            </OnboardingGate>
          }
        />
        <Route
          path="/join/:token"
          element={
            <OnboardingGate>
              <JoinScreen />
            </OnboardingGate>
          }
        />
        {/* AUDIT VIEWER ONLY — not a product route, and not in the demo
            build, which has no audit shell to label it. */}
        {authPreview && <Route path="/__inspector/auth" element={<AuthScreen />} />}
        <Route path="*" element={<Navigate to="/notebook" replace />} />
      </Routes>
  );
}
