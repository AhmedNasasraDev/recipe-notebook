// Personal Settings, stage 2 — /settings/backup.
//
// Moved verbatim out of the old one-page הגדרות (spec 5.1, stage 3ב, A-5).
// Ahmed's design-audit structure calls this "גיבוי ונתונים"; downloading my
// data and deleting the account, named there for later, are not built yet —
// only the JSON export that already exists is shown.

import { useState } from 'react';
import { BackControl } from '../components/BackLink.js';
import { useAppData } from '../app/AppDataProvider.js';
import { useAuth } from '../auth/AuthProvider.js';
import { backupFileName, buildNotebookBackup, downloadJson } from '../features/backup/exportNotebook.js';
import styles from './SettingsShared.module.css';

export function SettingsBackupScreen() {
  const { prefs, recipes, catalog, listPlans, getPlan, getPrivateNote } = useAppData();
  const { user } = useAuth();

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; text: string } | null>(null);

  /*
    Spec 5.1 backup. Everything but the plans and the private notes is already
    in memory; those two are read now, plan by plan and note by note, because
    neither is held by the provider (a plan is not an input to anyone else's
    figures, and a private note is loaded only on its own page). A single
    failure fails the whole export — a "backup" with a plan missing is worse
    than none — and says which part.
  */
  const onBackup = async () => {
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const summaries = await listPlans();
      const plans = [];
      for (const p of summaries) {
        const full = await getPlan(p.id);
        if (!full) throw new Error(`תוכנית הייצור "${p.name}" לא נטענה.`);
        plans.push(full);
      }
      const privateNotes: Record<string, string> = {};
      for (const r of recipes) {
        const note = await getPrivateNote(r.id);
        if (note) privateNotes[r.id] = note;
      }
      const backup = buildNotebookBackup({
        recipes,
        catalog,
        prefs,
        plans,
        privateNotes,
        email: user?.email ?? null,
      });
      downloadJson(backupFileName(), backup);
      setBackupStatus({
        ok: true,
        text: `הגיבוי הורד: ${recipes.length} מתכונים, ${catalog.length} חומרי גלם, ${plans.length} תוכניות ייצור.`,
      });
    } catch (e) {
      setBackupStatus({
        ok: false,
        text: `הכנת הגיבוי נכשלה: ${e instanceof Error ? e.message : 'שגיאה לא ידועה'}. אפשר לנסות שוב.`,
      });
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <BackControl>הגדרות</BackControl>
        <h1 className={styles.title}>גיבוי ונתונים</h1>
      </header>

      <section className={styles.card} aria-label="גיבוי וייצוא">
        <p className={styles.note}>
          הורדת קובץ JSON אחד עם כל המחברת: המתכונים על הרכיבים, השלבים, ההערות
          ויומן הניסויים, חומרי הגלם והמחירים, תוכניות הייצור וההעדפות. ההערות
          האישיות נכללות — הקובץ נשמר אצלכם בלבד ואינו נשלח לשום מקום. תמונות
          אינן נכללות. ייבוא חזרה מהקובץ עדיין אינו זמין.
        </p>
        <button
          type="button"
          className={styles.secondary}
          disabled={backupBusy}
          onClick={() => void onBackup()}
        >
          {backupBusy ? 'מכין את הגיבוי…' : 'הורדת גיבוי (JSON)'}
        </button>
        {backupStatus && (
          <p className={backupStatus.ok ? styles.ok : styles.error} role="status">
            {backupStatus.text}
          </p>
        )}
      </section>
    </div>
  );
}
