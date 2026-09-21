/*
  WHAT THE PERSON IS TOLD, BEFORE THEY TOUCH ANYTHING.

  A file that is passed around has to say what it is on its own: this is a
  trial version with sample data, the saving is local to this browser, and
  there is no account and no sync. So the notice opens on the first visit, and
  a small "גרסת ניסוי · סימולציה מקומית" strip keeps it one press away
  afterwards.

  THE SAVING LINE IS MEASURED, NOT PROMISED.

  `probeStorage()` writes and reads back a key, so the sheet says what this
  browser actually does — "נשמר במכשיר הזה" or "הדפדפן הזה חוסם שמירה מקומית".
  Nothing here claims a save that did not happen.
*/

import { useEffect, useState } from 'react';
import styles from './DemoNotice.module.css';
import { forgetSnapshot, type StorageState } from './demoStore.js';

const SEEN_KEY = 'rn.demo.seen.v1';

const seenBefore = (): boolean => {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // No storage means no memory of the visit, so the notice opens every time —
    // which is itself the honest signal that nothing is being kept here.
    return false;
  }
};

const rememberSeen = (): void => {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* then it opens again next time */
  }
};

export function DemoNotice({ storage }: { storage: StorageState }) {
  const [open, setOpen] = useState(() => !seenBefore());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = (): void => {
    rememberSeen();
    setConfirming(false);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={styles.pill}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="גרסת ניסוי — סימולציה מקומית. מה זה?"
      >
        {/*
          THE STRIP SAYS WHICH KIND OF THING THIS IS, IN THE WORDS ASKED FOR.
          Ahmed: "הצג בגרסת הניסוי חיווי ברור ״סימולציה מקומית״ שאינו מכסה
          פקדים. אל תציג אותה כחיבור לשרת אמיתי." "גרסת ניסוי" alone says it
          is a trial without saying that nothing behind it is real, so the
          strip carries both — it is the one marker that is on every screen,
          and the sheet it opens says precisely what is saved and what is not.
        */}
        גרסת ניסוי · סימולציה מקומית
      </button>

      {open && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label="על גרסת הניסוי"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className={styles.sheet} dir="rtl">
            <h2 className={styles.title}>מחברת מתכונים — גרסת ניסוי</h2>
            <p className={styles.lead}>
              זו גרסת התנסות שרצה כולה בדפדפן שלכם. כל המתכונים שכאן הם נתוני
              דוגמה, אין חשבון, אין סנכרון בין מכשירים ושום דבר אינו נשלח לשרת.
            </p>

            <p className={`${styles.state} ${storage === 'ready' ? styles.stateOn : styles.stateOff}`}>
              {storage === 'ready'
                ? 'שינויים שתעשו נשמרים בדפדפן הזה, במכשיר הזה בלבד. פתיחה במכשיר אחר, בדפדפן אחר או בגלישה פרטית מתחילה מנתוני הדוגמה מחדש.'
                : 'הדפדפן הזה חוסם שמירה מקומית לקובץ הזה, ולכן השינויים יישמרו עד לרענון הדף בלבד. אפשר לפתוח את הקובץ בדפדפן אחר, או להגיש אותו מכתובת אינטרנט, כדי שהשמירה תעבוד.'}
            </p>

            <ul className={styles.list}>
              <li>אפשר לנסות: ניווט, יצירה ועריכה של מתכוני דוגמה, חישוב כמויות והמרות, מיז־אן־פלאס ומצב הכנה — גם לרוחב וגם במסך מלא.</li>
              <li>הקבוצות, הצ׳אט וההזמנות הם הדמיה מקומית: אין שליחת הזמנות אמיתיות, אין משתמשים אחרים ואין התראות.</li>
              <li>תמונות שתעלו נשמרות עד לרענון הדף בלבד.</li>
              <li>מסך מלא עובד היכן שהדפדפן מרשה. אם הוא נחסם, מצב ההכנה עובר למצב ממוקד והמסך אומר זאת — סרגלי המכשיר אינם בשליטת האפליקציה.</li>
            </ul>

            {confirming ? (
              <p className={styles.confirm}>
                לאפס את הדמו? כל מה שנוצר או נערך כאן יימחק, והקובץ יחזור לנתוני
                הדוגמה.
              </p>
            ) : null}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => (confirming ? setConfirming(false) : close())}
              >
                {confirming ? 'ביטול' : 'התחלה'}
              </button>
              {confirming ? (
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => {
                    forgetSnapshot();
                    window.location.reload();
                  }}
                >
                  כן, לאפס
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setConfirming(true)}
                >
                  איפוס נתוני הדמו
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
