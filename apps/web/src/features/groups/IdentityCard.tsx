/*
  The name and picture other people see (migration 0031).

  WHY THIS IS NOT A "PREFERENCE"

  Everything else in הגדרות changes what THIS account sees. These two change
  what OTHER PEOPLE see, and they exist for one reason: §10.1 will not let a
  roster or a chat disclose an email address, so a group needs something else
  to call a person. Until they are set, the chat says "חבר בקבוצה" — which is
  honest, and which is why the card says what happens if you leave it empty.

  WHY THE PICTURE IS CONVERTED IN THE BROWSER

  The `avatars` bucket takes WebP only, at 512 KB (0031). The conversion strips
  EXIF on the way through, which matters more here than for a recipe
  photograph: a selfie usually carries GPS, and a group picture is seen by
  everybody in the group. It is the same `convertToWebp` as §5's photographs,
  given the smaller budget — one conversion path, so there is one EXIF
  behaviour rather than two.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppData } from '../../app/AppDataProvider.js';
import { ANONYMOUS_MEMBER, initials } from './chat.js';
import styles from './IdentityCard.module.css';

export function IdentityCard() {
  const { groups: api, capabilities } = useAppData();
  /*
    `!== 'local-demo'` rather than `=== 'supabase'`: the trial (`simulated`)
    keeps a display name in the browser and can edit it, and only the
    read-only demo has nowhere to put one. Written this way so a new source
    kind does not silently disable a control that works.
  */
  const canWrite = capabilities.canWrite && capabilities.source !== 'local-demo';

  const [name, setName] = useState('');
  const [stored, setStored] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const identity = await api.getIdentity();
      setName(identity.displayName);
      setStored(identity.displayName);
      setAvatarPath(identity.avatarPath);
      setAvatarUrl(await api.avatarUrl(identity.avatarPath));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת הפרופיל נכשלה.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveName = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.saveDisplayName(name);
      setStored(name.trim());
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שמירת השם נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setProblem(null);
    setSaved(false);
    setBusy(true);
    try {
      await api.setAvatar(file);
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'העלאת התמונה נכשלה.');
    } finally {
      setBusy(false);
      // Cleared so the same file can be chosen again after a failure — an
      // input that still holds it fires no change event the second time.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onRemove = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.removeAvatar();
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'הסרת התמונה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-label="איך אני מוצג בקבוצות">
      <h2 className={styles.cardTitle}>איך אני מוצג בקבוצות</h2>
      <p className={styles.note}>
        השם והתמונה מוצגים לחברי הקבוצות שלכם — ברשימת החברים ובצ׳אט. כתובת
        המייל שלכם אינה מוצגת לאף אחד בקבוצה, בשום מקום.
      </p>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <div className={styles.row}>
        <span className={styles.avatar} aria-hidden="true">
          {avatarUrl !== null ? (
            <img className={styles.avatarImg} src={avatarUrl} alt="" />
          ) : (
            initials(stored)
          )}
        </span>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span>השם שיוצג</span>
            <input
              className={styles.input}
              value={name}
              disabled={!canWrite || busy}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder={ANONYMOUS_MEMBER}
            />
          </label>
          {stored.trim() === '' && (
            <p className={styles.note}>
              בלי שם, חברי הקבוצה יראו ״{ANONYMOUS_MEMBER}״ במקום.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={!canWrite || busy || name.trim() === stored.trim()}
              onClick={() => void onSaveName()}
            >
              שמירת השם
            </button>
            {saved && <span className={styles.note}>נשמר</span>}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <label className={styles.secondary}>
          {avatarPath === null ? 'העלאת תמונה' : 'החלפת התמונה'}
          <input
            ref={fileInput}
            className={styles.file}
            type="file"
            accept="image/*"
            disabled={!canWrite || busy}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </label>
        {avatarPath !== null && (
          <button
            type="button"
            className={styles.link}
            disabled={!canWrite || busy}
            onClick={() => void onRemove()}
          >
            הסרת התמונה
          </button>
        )}
      </div>

      <p className={styles.note}>
        התמונה נשמרת מוקטנת וללא נתוני המקור — כולל מיקום, אם היה בקובץ.
      </p>

      {!canWrite && (
        <p className={styles.note}>
          שם ותמונה נשמרים לחשבון. בהתקנה הזאת אין חיבור לשרת, ולכן אי אפשר
          לשנות אותם כאן.
        </p>
      )}
    </section>
  );
}
