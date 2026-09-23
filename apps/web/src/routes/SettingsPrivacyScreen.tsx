// Personal Settings, stage 2 — /settings/privacy.
//
// Moved verbatim out of the old one-page הגדרות. §12's rules are enforced by
// the database itself, not preferences to toggle — so they are stated, at the
// place where the account lives, and there is nothing to switch.
//
// Ahmed's design-audit structure calls this "פרטיות ואבטחה"; the security
// controls it names for later (changing phone/email with verification,
// signing out of every device) are not built yet, so only the privacy rules
// that already exist are shown.

import { BackControl } from '../components/BackLink.js';
import styles from './SettingsShared.module.css';

export function SettingsPrivacyScreen() {
  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <BackControl>הגדרות</BackControl>
        <h1 className={styles.title}>פרטיות ואבטחה</h1>
      </header>

      <section className={styles.card} aria-label="פרטיות">
        <h2 className={styles.cardTitle}>פרטיות</h2>
        <ul className={styles.rules}>
          <li>המחברת שלכם פרטית. אין לאף חשבון אחר גישה אליה.</li>
          <li>ההערות האישיות והכיולים שייכים לחשבון ואינם נשלחים לאף מקום.</li>
          <li>
            שיתוף קורה רק ביוזמתכם — דרך קבוצה שפתחתם או הצטרפתם אליה. מה
            שלא שיתפתם נשאר פרטי.
          </li>
        </ul>
        <p className={styles.note}>
          אלה חוקים שהמערכת אוכפת במסד הנתונים עצמו, ולא הגדרות שניתן לכבות.
        </p>
      </section>
    </div>
  );
}
