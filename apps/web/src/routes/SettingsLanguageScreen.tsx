// Personal Settings, stage 2 — /settings/language.
//
// Moved verbatim out of the old one-page הגדרות. §17 lists Arabic as
// "בהכנה", and a switcher that changes nothing is the shape of dishonesty
// AC #17 rules out — so the row states the fact instead of offering a
// control with nothing behind it.

import { BackControl } from '../components/BackLink.js';
import styles from './SettingsShared.module.css';

export function SettingsLanguageScreen() {
  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <BackControl>הגדרות</BackControl>
        <h1 className={styles.title}>שפה</h1>
      </header>

      <section className={styles.card} aria-label="שפה">
        <p className={styles.note}>
          הממשק בעברית, בכתיבה מימין לשמאל. ערבית מתוכננת לשלב הבא ועדיין
          אינה זמינה — ולכן אין כאן מתג שלא יעשה דבר.
        </p>
      </section>
    </div>
  );
}
