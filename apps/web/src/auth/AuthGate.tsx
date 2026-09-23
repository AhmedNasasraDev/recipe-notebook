// Decides what the app shows before any data is fetched.
//
// The order matters. `loading` comes first because a stored session is restored
// asynchronously: rendering the sign-in screen while that is in flight would
// flash it at an already-signed-in user on every page load, and would make
// "session survives a refresh" look broken even when it works.

import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider.js';
import { AuthScreen } from '../routes/AuthScreen.js';
import styles from './AuthGate.module.css';

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className={styles.loading} role="status" aria-label="טוען">
        <p className={styles.loadingText}>רגע…</p>
      </div>
    );
  }

  // No Supabase project configured in this checkout. The app runs on the
  // read-only demo repository and the shell banner says exactly that, so there
  // is no sign-in screen to show and nothing to pretend about.
  if (status === 'unconfigured') return <>{children}</>;

  if (status === 'signed-out') return <AuthScreen />;

  return <>{children}</>;
}
