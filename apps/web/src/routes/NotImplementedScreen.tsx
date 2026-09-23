import { BackControl } from '../components/BackLink.js';
import styles from './NotImplementedScreen.module.css';

/**
 * An honest placeholder. §17 and AC #17: a screen must never look connected or
 * finished when it is not. Saying "this is not built yet, and here is what it
 * will hold" is better than an empty screen that reads like a bug.
 */
export function NotImplementedScreen({ screen }: { screen: string }) {
  const planned: Record<string, string[]> = {
    קבוצות: [
      'קבוצות פרטיות, קורסים ושיעורים',
      'הרשאות פר־מתכון ואכיפה בשרת',
      'דורש טבלאות חברות, הזמנות ואכיפה בשרת — ולכן שלב נפרד',
    ],
  };

  return (
    <div className={styles.wrap}>
      {/* Being unbuilt is no reason to be a dead end. */}
      <BackControl />
      <h1 className={styles.title}>{screen}</h1>
      {/*
        STAGE-11: the body text used to say "בשלב הזה מומשו שאלות הפתיחה,
        המחברת ודף המתכון", which stopped being true five stages ago. A
        placeholder that misreports what the app can do is not honest just
        because it admits to being a placeholder.
      */}
      <p className={styles.body}>
        המסך הזה עוד לא נבנה. מה שכן עובד: המחברת ודף המתכון, עריכה וגרסאות,
        מרכז חומרי הגלם והמחירים, עלויות ורווחיות, תכנון ייצור ורכש, כלי המדידה
        וההגדרות.
      </p>
      <ul className={styles.list}>
        {(planned[screen] ?? []).map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}
