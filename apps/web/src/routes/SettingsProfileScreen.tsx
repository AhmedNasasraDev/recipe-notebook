// Personal Settings — /settings/profile ("פרטים אישיים").
//
// STAGE 2 MERGE (design pass, 23.09.2026)
//
// This screen used to hold the first/last name form, and a separate
// <IdentityCard/> below it held the group-facing name and picture — two
// cards, two save buttons, both editing what amounts to the same name. The
// design audit named this exact duplication, and the approved mockup merges
// them into one card ("השם והתמונה שלי") with one save action. The free-text
// "השם שיוצג" field IdentityCard used to offer is gone with it: migration
// 0041's trigger already derives the group-facing display name from first
// and last name once both are filled in, so a second, separate way to set
// it was two sources of truth for one fact. IdentityCard itself is deleted —
// this was its only caller.
//
// The email row (which used to also appear a second time, under the old
// "החשבון שלי" card on the settings hub) and the password-change and
// sign-out controls (moved verbatim from that same old card) now live here
// too, per Ahmed's settings-structure decision: "פרטים אישיים: name, photo,
// email, phone, password, logout."
//
// Phone editing is still stage 3 of this same plan — until it exists, no
// account has a phone number, so the row says that with a plain "בקרוב" tag
// rather than an empty field that invites a tap nothing will answer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BackControl } from '../components/BackLink.js';
import { useAppData } from '../app/AppDataProvider.js';
import { useAuth } from '../auth/AuthProvider.js';
import { initials } from '../features/groups/chat.js';
import shared from './SettingsShared.module.css';
import styles from './SettingsProfileScreen.module.css';

export function SettingsProfileScreen() {
  const { groups: api, capabilities } = useAppData();
  const { status, user, signOut, changePassword } = useAuth();
  const canWrite = capabilities.canWrite && capabilities.source !== 'local-demo';

  /* ── name, photo ──────────────────────────────────────────────────────── */
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [storedFirst, setStoredFirst] = useState('');
  const [storedLast, setStoredLast] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarProblem, setAvatarProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const identity = await api.getIdentity();
      setFirstName(identity.firstName ?? '');
      setLastName(identity.lastName ?? '');
      setStoredFirst(identity.firstName ?? '');
      setStoredLast(identity.lastName ?? '');
      setDisplayName(identity.displayName);
      setAvatarPath(identity.avatarPath);
      setAvatarUrl(await api.avatarUrl(identity.avatarPath));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת הפרופיל נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const valid = trimmedFirst !== '' && trimmedLast !== '';
  const unchanged = trimmedFirst === storedFirst.trim() && trimmedLast === storedLast.trim();
  const needsNames = !loading && storedFirst.trim() === '' && storedLast.trim() === '';
  const initialsSource = trimmedFirst || trimmedLast ? `${trimmedFirst} ${trimmedLast}` : displayName;

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
      setProblem(e instanceof Error ? e.message : 'שמירת הפרטים נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onPickAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setAvatarProblem(null);
    setAvatarBusy(true);
    try {
      await api.setAvatar(file);
      await load();
    } catch (e) {
      setAvatarProblem(e instanceof Error ? e.message : 'העלאת התמונה נכשלה.');
    } finally {
      setAvatarBusy(false);
      // Cleared so the same file can be chosen again after a failure — an
      // input that still holds it fires no change event the second time.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onRemoveAvatar = async (): Promise<void> => {
    setAvatarProblem(null);
    setAvatarBusy(true);
    try {
      await api.removeAvatar();
      await load();
    } catch (e) {
      setAvatarProblem(e instanceof Error ? e.message : 'הסרת התמונה נכשלה.');
    } finally {
      setAvatarBusy(false);
    }
  };

  /* ── password, sign-out (moved from the old settings hub) ───────────────── */
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  const onSignOut = async () => {
    setAccountError(null);
    setAccountBusy(true);
    try {
      await signOut();
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : 'ההתנתקות נכשלה.');
    } finally {
      setAccountBusy(false);
    }
  };

  const onChangePassword = async () => {
    setPwError(null);
    setPwDone(false);
    if (next !== again) {
      setPwError('שתי הסיסמאות החדשות אינן זהות.');
      return;
    }
    setAccountBusy(true);
    try {
      await changePassword(current, next);
      setPwDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
      setPwOpen(false);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'שינוי הסיסמה נכשל.');
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <div className={shared.wrap}>
      <header className={shared.head}>
        <BackControl>הגדרות</BackControl>
        <h1 className={shared.title}>פרטים אישיים</h1>
      </header>

      {/* ── השם והתמונה שלי — הכרטיס המאוחד ──────────────────────────────── */}
      <section className={shared.card} aria-label="השם והתמונה שלי">
        <h2 className={shared.cardTitle}>השם והתמונה שלי</h2>
        <p className={shared.note}>
          השם והתמונה מוצגים לחברי הקבוצות שלכם — ברשימת החברים ובצ׳אט. כתובת
          המייל שלכם אינה מוצגת לאף אחד בקבוצה, בשום מקום.
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
        {avatarProblem !== null && (
          <p className={styles.problem} role="alert">
            {avatarProblem}
          </p>
        )}

        <div className={styles.avatarRow}>
          <span className={styles.avatar} aria-hidden="true">
            {avatarUrl !== null ? (
              <img className={styles.avatarImg} src={avatarUrl} alt="" />
            ) : (
              initials(initialsSource)
            )}
          </span>
          <div className={styles.avatarActions}>
            <label className={styles.linkBtn}>
              {avatarPath === null ? 'העלאת תמונה' : 'החלפת התמונה'}
              <input
                ref={fileInput}
                className={styles.file}
                type="file"
                accept="image/*"
                disabled={!canWrite || avatarBusy}
                onChange={(e) => void onPickAvatar(e.target.files?.[0])}
              />
            </label>
            {avatarPath !== null && (
              <button
                type="button"
                className={styles.linkBtnMuted}
                disabled={!canWrite || avatarBusy}
                onClick={() => void onRemoveAvatar()}
              >
                הסרה
              </button>
            )}
          </div>
        </div>
        <p className={styles.note}>
          התמונה נשמרת מוקטנת וללא נתוני המקור — כולל מיקום, אם היה בקובץ.
        </p>

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
          <button
            type="button"
            className={styles.primary}
            disabled={!canWrite || busy || loading || !valid || unchanged}
            onClick={() => void onSave()}
          >
            {busy ? 'שומר…' : 'שמירת הפרטים'}
          </button>
          {saved && <span className={shared.note}>נשמר</span>}
        </div>

        {!canWrite && (
          <p className={shared.note}>בהתקנה הזאת אין חיבור לשרת, ולכן אי אפשר לשמור כאן.</p>
        )}
      </section>

      {/* ── פרטי התחברות ───────────────────────────────────────────────── */}
      <section className={shared.card} aria-label="פרטי התחברות">
        <h2 className={shared.cardTitle}>פרטי התחברות</h2>

        <div className={styles.row}>
          <span className={styles.rowLabel}>אימייל</span>
          <span className={styles.rowValue}>
            <span className="ltr">{user?.email ?? '—'}</span>
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>טלפון</span>
          <span className={styles.tag}>בקרוב</span>
        </div>
        <p className={shared.note}>
          כניסה עם מספר טלפון עדיין אינה זמינה באפליקציה. שינוי אימייל וטלפון,
          עם אימות, יתווספו כאן בשלב הבא של ההגדרות.
        </p>
      </section>

      {/* ── סיסמה וחשבון (הועבר מהרשימה הראשית של ההגדרות) ─────────────── */}
      <section className={shared.card} aria-label="סיסמה וחשבון">
        <h2 className={shared.cardTitle}>סיסמה וחשבון</h2>

        {status === 'signed-in' && user ? (
          <>
            <p className={shared.note}>
              המתכונים, ההערות הפרטיות והכיולים שמורים לחשבון הזה. ההתנתקות
              גם מוחקת את ההעתק המקומי מהמכשיר.
            </p>

            {pwDone && (
              <p className={shared.ok} role="status">
                הסיסמה הוחלפה.
              </p>
            )}

            {!pwOpen ? (
              <button
                type="button"
                className={shared.secondary}
                onClick={() => {
                  setPwOpen(true);
                  setPwDone(false);
                }}
              >
                שינוי סיסמה
              </button>
            ) : (
              <div className={styles.pwForm}>
                <div className={styles.field}>
                  <label className={styles.pwLabel} htmlFor="pw-current">
                    הסיסמה הנוכחית
                  </label>
                  <input
                    id="pw-current"
                    className={styles.input}
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.pwLabel} htmlFor="pw-next">
                    סיסמה חדשה
                  </label>
                  <input
                    id="pw-next"
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.pwLabel} htmlFor="pw-again">
                    הסיסמה החדשה שוב
                  </label>
                  <input
                    id="pw-again"
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </div>

                {pwError && (
                  <p className={shared.error} role="alert">
                    {pwError}
                  </p>
                )}

                <div className={styles.pwActions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={accountBusy || current === '' || next === ''}
                    onClick={() => void onChangePassword()}
                  >
                    {accountBusy ? 'רגע…' : 'עדכון הסיסמה'}
                  </button>
                  <button
                    type="button"
                    className={shared.secondary}
                    onClick={() => {
                      setPwOpen(false);
                      setPwError(null);
                      setCurrent('');
                      setNext('');
                      setAgain('');
                    }}
                  >
                    ביטול
                  </button>
                </div>
                <p className={shared.note}>
                  נדרשת גם הסיסמה הנוכחית. חלון פתוח לבדו אינו מספיק כדי
                  להחליף סיסמה של חשבון.
                </p>
              </div>
            )}

            <button
              type="button"
              className={styles.signOut}
              onClick={() => void onSignOut()}
              disabled={accountBusy}
            >
              {accountBusy ? 'רגע…' : 'התנתקות'}
            </button>
          </>
        ) : (
          <p className={shared.note}>
            {capabilities.source === 'local-demo'
              ? 'אין חיבור לשרת בהתקנה הזאת, ולכן אין חשבון. ההעדפות כאן נשמרות על המכשיר הזה בלבד.'
              : 'לא מחוברים לחשבון.'}
          </p>
        )}

        {accountError && (
          <p className={shared.error} role="alert">
            {accountError}
          </p>
        )}
      </section>
    </div>
  );
}
