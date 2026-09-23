import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppData } from './AppDataProvider.js';
import { LoadFailedScreen, LoadingScreen } from './LoadState.js';

/**
 * §4: the onboarding appears once, when `prefs.done === false`, and can be reset
 * from settings. Everything behind the tab bar waits for it.
 *
 * QA 22.09.2026 (acceptance, finding 1): while the data loads the gate shows a
 * loading screen, and when the first load fails it shows the failure with a
 * retry — it used to return null for both, which was a blank page. The
 * failure comes BEFORE the onboarding check on purpose: with nothing loaded,
 * `prefs.done` is the first-run default, and sending a signed-in account back
 * through the onboarding because the network dropped would be wrong twice.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { ready, prefs, loadFailed, error, reload } = useAppData();
  const location = useLocation();

  if (!ready) return <LoadingScreen />;
  if (loadFailed) return <LoadFailedScreen message={error} onRetry={reload} />;
  if (prefs.done !== true) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
