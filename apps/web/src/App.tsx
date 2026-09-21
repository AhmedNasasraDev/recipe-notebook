import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { AuthGate } from './auth/AuthGate.js';
import { AppDataProvider } from './app/AppDataProvider.js';
import { OnboardingGate } from './app/OnboardingGate.js';
import { AppShell } from './shell/AppShell.js';
import { OnboardingScreen } from './routes/OnboardingScreen.js';
import { NotebookScreen } from './routes/NotebookScreen.js';
import { RecipeScreen } from './routes/RecipeScreen.js';
import { RecipeEditScreen } from './routes/RecipeEditScreen.js';
import { IngredientsScreen } from './routes/IngredientsScreen.js';
import { PlansScreen } from './routes/PlansScreen.js';
import { PlanScreen } from './routes/PlanScreen.js';
import { MoreScreen } from './routes/MoreScreen.js';
import { CookScreen } from './routes/CookScreen.js';
import { LabelScreen } from './routes/LabelScreen.js';
import { OrderScreen } from './routes/OrderScreen.js';
import { PasteScreen } from './routes/PasteScreen.js';
import { HomeScreen } from './routes/HomeScreen.js';
import { SettingsScreen } from './routes/SettingsScreen.js';
import { ToolsScreen } from './routes/ToolsScreen.js';
import { GroupsScreen } from './routes/GroupsScreen.js';
import { GroupScreen } from './routes/GroupScreen.js';
import { PermsScreen } from './routes/PermsScreen.js';
import { GroupRecipeScreen } from './routes/GroupRecipeScreen.js';
import { JoinScreen } from './routes/JoinScreen.js';

/**
 * Routing mirrors spec §2 one screen at a time. `state.screen` in the prototype
 * becomes a URL here, which the product needs anyway: a shareable recipe link,
 * a working back button, and later a group invite token that has to be a link.
 *
 * §2's tabOf() mapping lives in shell/TabBar.tsx.
 *
 * The three layers outside the router's <Routes> are ordered by what each one
 * depends on, and the order is not interchangeable:
 *
 *   AuthProvider     owns the session
 *   AuthGate         no app renders until the session is known (§2)
 *   AppDataProvider  picks the repository FROM that session, so the notebook
 *                    that loads belongs to the signed-in account and to nobody
 *                    else
 *   OnboardingGate   §4, once per account, driven by profiles.onboarding_done
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
                {/* §2 screen 6. Inside the shell: it belongs to the notebook
                    tab, which is where a new recipe comes from. */}
                <Route path="/paste" element={<PasteScreen />} />
                {/* `/recipe/new` before `/recipe/:recipeId`, so "new" is not
                    read as a recipe id. */}
                <Route path="/recipe/new" element={<RecipeEditScreen />} />
                <Route path="/recipe/:recipeId/edit" element={<RecipeEditScreen />} />
                <Route path="/recipe/:recipeId" element={<RecipeScreen />} />
                <Route path="/home" element={<HomeScreen />} />
                {/* §2 screens 15-18. `/groups` was a NotImplementedScreen
                    until §10 existed; the tab bar stopped saying "בהכנה" in
                    the same commit, so the two cannot disagree. */}
                <Route path="/groups" element={<GroupsScreen />} />
                <Route path="/group/:groupId" element={<GroupScreen />} />
                <Route path="/group/:groupId/perms" element={<PermsScreen />} />
                <Route path="/group/:groupId/item/:itemId" element={<GroupRecipeScreen />} />
                <Route path="/ingredients" element={<IngredientsScreen />} />
                <Route path="/plans" element={<PlansScreen />} />
                <Route path="/plan/:planId" element={<PlanScreen />} />
                <Route path="/more" element={<MoreScreen />} />
                {/* §2 screens 20 and 21. `tabOf()` has listed them as owned by
                    "עוד" since stage 2; until now the paths had no route and
                    fell through the catch-all to the notebook. */}
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="/tools" element={<ToolsScreen />} />
              </Route>
              {/*
                §2: "מסכי מתכון, עריכה, Cook Mode, תווית והזמנה הם מסכי עומק
                ללא טאבים". Cook Mode is therefore OUTSIDE the AppShell — it
                takes the whole screen, dark, with its own way out. It still
                needs the onboarding gate and the data provider above it.
              */}
              <Route
                path="/recipe/:recipeId/cook"
                element={
                  <OnboardingGate>
                    <CookScreen />
                  </OnboardingGate>
                }
              />
              {/*
                §2 screens 8 and 9, outside the shell for the same reason and
                one more: both exist to become paper, and a tab bar is not part
                of a printed label. `@media print` in styles/global.css hides
                what is marked `.noprint` on them.
              */}
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
              {/*
                The invitation link, OUTSIDE the shell. A person arriving here
                may not be a member of anything yet, so a tab bar offering
                "קבוצות" would lead them nowhere; and the decision on this
                screen is the only thing on it. It keeps the onboarding gate,
                because redeeming an invitation writes to the database as the
                signed-in account.
              */}
              <Route
                path="/join/:token"
                element={
                  <OnboardingGate>
                    <JoinScreen />
                  </OnboardingGate>
                }
              />
              {/*
                HOME IS WHERE AN UNKNOWN ADDRESS LANDS, AND WHERE THE APP OPENS.

                This said `/notebook`, and that one line is the whole of what
                Ahmed reported: "המערכת נפתחת אצלי במחברת המתכונים במקום בבית."
                Opening the application at its root matches no route, falls
                through to here, and was sent to the notebook.

                Nothing else was involved — there is no "last tab" to restore
                and no preference being read, so nothing had to be cleared to
                fix it and nothing of his was touched. A deep link still opens
                its own target, because a deep link MATCHES a route above and
                never reaches this line; and because the redirect only ever
                fires for an address that resolves to no screen, it cannot
                pull somebody out of a screen they are working on.
              */}
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </AppDataProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  );
}
