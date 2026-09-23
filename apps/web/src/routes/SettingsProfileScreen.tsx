// Personal Settings, stage 1 (23.09.2026) — /settings/profile.
//
// WHAT LIVES HERE AND WHY
//
// First name + last name (new, migration 0041), the existing IdentityCard
// (moved here verbatim from the old single-page הגדרות — it already did
// exactly what a "photo, with a default of initials" requirement asks for,
// so it is imported, not rebuilt), and phone + email for VIEWING only.
//
// Phone and email are not editable from here yet. Editing either with the
// verification Ahmed asked for (an SMS code for a new phone, a confirmation
// link for a new email) is stage 3 of this same plan. Phone login itself is
// a separate, larger, still-frozen project (see the saved plan doc) — until
// it exists, no account has a phone number, so the row says that plainly
// rather than showing an empty field that invites a tap nothing will answer.
//
// WHY FIRST/LAST NAME DOES NOT TOUCH display_name DIRECTLY
//
// The database derives display_name from the two once both are filled in
// (migration 0041's trigger) — this screen only ever writes first_name and
// last_name. See IdentityCard for the one screen that still edits
// display_name directly (for a group), unaffected by this.

import { useEffect, useState } from 'react';
import { BackControl } from '../components/BackLink.js';
import { useAppData } from '../app/AppDataProvider.js';
import { useAuth } from '../auth/AuthProvider.js';
import { IdentityCard } from '../features/groups/IdentityCard.js';
import styles from './SettingsProfileScreen.module.css';

export function SettingsProfileScreen() {
  const { groups: api, capabilities } = useAppData();
  const { user } = useAuth();
  const canWrite = capabilities.canWrite && capabilities.source !== 'local-demo';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [storedFirst, setStoredFirst] = useState('');
  const [storedLast, setStoredLast] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getIdentity()
      .then((identity) => {
        if (cancelled) return;
        setFirstName(identity.firstName ?? '');
        setLastName(identity.lastName ?? '');
        setStoredFirst(identity.firstName ?? '');
        setStoredLast(identity.lastName ?? '');
        setDisplayName(identity.displayName);
      })
      .catch((e: unknown) => {
        if (!cancelled) setProblem(e instanceof Error ? e.message : 'טעינת הפרופיל נכשלה.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const valid = trimmedFirst !== '' && trimmedLast !== '';
  const unchanged = trimmedFirst === storedFirst.trim() && trimmedLast === storedLast.trim();
  const needsNames = !loading && storedFirst.trim() === '' && storedLast.trim() === '';

  const onSave = async (): Promise<void> => {
    if (!valid) return;
    setProblem(null);
    setBusy(true);
    try {
      await api.saveProfileNames(trimmedFirst, trimmedLast);
      setStoredFirst(trimmedFirst);
      setStoredLast(trimmedLast);
      setDisplayName(`${trimmedFirst} ${trimmedLast}`);
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שמירת הפרופיל נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <BackControl />
        <h1 className={styles.title}>פרופיל</h1>
      </header>

      <section className={styles.card} aria-label="שם">
        <h2 className={styles.cardTitle}>שם פרטי ושם משפחה</h2>
        <p className={styles.note}>
          זה השם שיוצג עבורכם ברחבי האפליקציה. הוא נדרש ומחליף את השם שהוגדר
          כאן בעבר, ברגע שנשמר.
        </p>

        {needsNames && displayName !== '' && (
          <p className={styles.hint} role="status">
            השם המוצג היום הוא ״{displayName}״. אפשר למלא שם פרטי ומשפחה
            למטה — זה לא ישבור כלום, וישמש מעכשיו במקום.
          </p>
        )}

        {problem !== null && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}

        <div className={styles.fields}>
          <label className={styles.field}>
            <span>
              שם פרטי <span aria-hidden="true">*</span>
            </span>
            <input
              className={styles.input}
              value={firstName}
              disabled={!canWrite || loading || busy}
              required
              onChange={(e) => {
                setFirstName(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className={styles.field}>
            <span>
              שם משפחה <span aria-hidden="true">*</span>
            </span>
            <input
              className={styles.input}
              value={lastName}
              disabled={!canWrite || loading || busy}
              required
              onChange={(e) => {
                setLastName(e.target.value);
                setSaved(false);
              }}
            />
          </label>
        </div>

        {!valid && (firstName !== '' || lastName !== '') && (
          <p className={styles.warn} role="status">
            שם פרטי ושם משפחה הם שדות חובה — שניהם נדרשים לשמירה.
          </p>
        )}

        <div className={styles.actions}>
          {/*
            Not "שמירת השם" — IdentityCard right below this card already uses
            that label for its own, separate save button (§10.1's group
            display name), and the same label twice on one screen is
            confusing for a person and ambiguous for a screen reader.
          */}
          <button
            type="button"
            className={styles.primary}
            disabled={!canWrite || busy || loading || !valid || unchanged}
            onClick={() => void onSave()}
          >
            {busy ? 'שומר…' : 'שמירת שם פרטי ומשפחה'}
          </button>
          {saved && <span className={styles.note}>נשמר</span>}
        </div>

        {!canWrite && (
          <p className={styles.note}>בהתקנה הזאת אין חיבור לשרת, ולכן אי אפשר לשמור כאן.</p>
        )}
      </section>

      {/* §10.1 — the name and picture a GROUP sees, unchanged from before. */}
      <IdentityCard />

      <section className={styles.card} aria-label="פרטי התחברות">
        <h2 className={styles.cardTitle}>פרטי התחברות</h2>

        <div className={styles.row}>
          <span className={styles.rowLabel}>אימייל</span>
          <span className={styles.rowValue}>
            <span className="ltr">{user?.email ?? '—'}</span>
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>טלפון</span>
          <span className={styles.rowValueMuted}>לא הוגדר</span>
        </div>
        <p className={styles.note}>
          כניסה עם מספר טלפון עדיין אינה זמינה באפליקציה. שינוי אימייל וטלפון,
          עם אימות, יתווספו כאן בשלב הבא של ההגדרות.
        </p>
      </section>
    </div>
  );
}
