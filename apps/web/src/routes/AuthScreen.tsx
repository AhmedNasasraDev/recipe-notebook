// Sign up / sign in (HANDOFF §2).
//
// One screen, two modes, because they share every field and almost every error
// path. Deliberately plain: email and password, no social providers, no magic
// links — §2 asks for email + password and nothing in the spec depends on more.
//
// What this screen will not do:
//   • claim an account is ready when Supabase says a confirmation email is
//     required. That is a project setting, and the honest message differs.
//   • swallow an error. Every failure is shown, in Hebrew where it is a known
//     one and verbatim where it is not.

import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import styles from './AuthScreen.module.css';

type Mode = 'in' | 'up';

export function AuthScreen() {
  const { signIn, signUp, unconfiguredReason, redirectError } = useAuth();
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError('יש למלא אימייל וסיסמה.');
      return;
    }
    // The form is `noValidate` (its own messages, in Hebrew), so the address
    // is checked here before a round trip is spent on it (QA 22.09.2026,
    // acceptance finding 16). The shape only: whether the address EXISTS is
    // the server's answer, never this screen's.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('כתובת האימייל אינה תקינה. יש להזין כתובת בצורה name@example.com.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'up') {
        const { needsEmailConfirmation } = await signUp(email, password);
        if (needsEmailConfirmation) {
          // Not signed in. Saying otherwise would send the user to a notebook
          // that will refuse every read.
          setNotice(
            'החשבון נוצר. שלחנו אליכם אימייל לאישור הכתובת — יש לאשר אותו ואז להתחבר.',
          );
          setMode('in');
          setPassword('');
        }
        // When confirmation is off, onAuthStateChange takes over from here and
        // the gate above this screen swaps it for the notebook.
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הפעולה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>מחברת מתכונים</h1>
        <p className={styles.subtitle}>
          {mode === 'in'
            ? 'התחברו כדי לפתוח את המחברת שלכם.'
            : 'חשבון חדש. המתכונים, ההעדפות והכיולים יישמרו לחשבון הזה בלבד.'}
        </p>

        <div className={styles.modes} role="group" aria-label="התחברות או הרשמה">
          <button
            type="button"
            className={mode === 'in' ? styles.modeOn : styles.mode}
            aria-pressed={mode === 'in'}
            onClick={() => {
              setMode('in');
              setError(null);
            }}
          >
            התחברות
          </button>
          <button
            type="button"
            className={mode === 'up' ? styles.modeOn : styles.mode}
            aria-pressed={mode === 'up'}
            onClick={() => {
              setMode('up');
              setError(null);
            }}
          >
            הרשמה
          </button>
        </div>

        {/*
          `void submit(e)` rather than `onSubmit={submit}`: React ignores the
          returned promise, so a rejection inside an async handler becomes an
          unhandled rejection with nothing on screen. `submit` catches its own
          failures, and this says that is deliberate.
        */}
        <form
          className={styles.form}
          onSubmit={(e) => {
            void submit(e);
          }}
          noValidate
        >
          <label className={styles.label} htmlFor="auth-email">
            אימייל
          </label>
          <input
            id="auth-email"
            className={`${styles.input} ltr`}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className={styles.label} htmlFor="auth-password">
            סיסמה
          </label>
          <input
            id="auth-password"
            className={`${styles.input} ltr`}
            type="password"
            dir="ltr"
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'up' && (
            <p className={styles.hint}>לפחות 6 תווים.</p>
          )}

          {/*
            Not "התחברות": that is the name of the mode tab above, and two
            controls with the same accessible name doing different things is a
            problem for anyone navigating by name — a screen reader reads both
            as the same button.
          */}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'רגע…' : mode === 'in' ? 'כניסה למחברת' : 'יצירת חשבון'}
          </button>
        </form>

        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {redirectError && !notice && !error && (
          <p className={styles.error} role="alert">
            {redirectError}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {unconfiguredReason === 'service-role-key-in-browser' && (
          <p className={styles.error} role="alert">
            המפתח שהוגדר הוא מפתח מנהל (service_role) ולכן לא נעשה בו שימוש. בדפדפן
            מותר רק מפתח publishable או anon.
          </p>
        )}

        <p className={styles.privacy}>
          המתכונים, ההערות הפרטיות והכיולים שלכם נגישים לחשבון שלכם בלבד. ההפרדה
          נאכפת בשרת עצמו, לא רק במסך.
        </p>
      </div>
    </main>
  );
}
