/*
  What the person sees BEFORE the notebook is on screen, and when it cannot be.

  QA 22.09.2026 (acceptance, finding 1): while the recipes were still loading
  the app rendered nothing at all — no text, no tab bar — and when the load
  failed it rendered nothing either. `OnboardingGate` returned null for both.
  A blank page for three seconds reads as a crash, and a blank page after a
  failure gives nobody a way out.

  Two screens, one file, because they are the two halves of the same moment:
  the load is in flight, or the load is over and there is nothing to show. The
  failure screen carries the retry, because retrying is the only sensible
  action on it and a person on a phone should not have to know that "רענון"
  is what fixes a dropped connection.
*/

import styles from './LoadState.module.css';

export function LoadingScreen({ text = 'טוען את המחברת…' }: { text?: string }) {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <p className={styles.text}>{text}</p>
    </div>
  );
}

export function LoadFailedScreen({
  message,
  onRetry,
  busy = false,
}: {
  /** the repository's own sentence, already in Hebrew */
  message: string | null;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <div className={styles.screen} role="alert">
      <div className={styles.card}>
        <h1 className={styles.title}>המחברת לא נטענה</h1>
        <p className={styles.text}>
          {message || 'לא הצלחנו להביא את הנתונים מהשרת.'}
        </p>
        <p className={styles.text}>בדקו את החיבור לאינטרנט ונסו שוב.</p>
        <button
          type="button"
          className={styles.retry}
          onClick={onRetry}
          disabled={busy}
        >
          {busy ? 'רגע…' : 'ניסיון חוזר'}
        </button>
      </div>
    </div>
  );
}
