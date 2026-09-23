// Personal Settings, stage 2 — /settings/recipe-preferences.
//
// Everything that decides how a recipe is shown and measured, together on one
// screen: what used to be called "פרופיל" (renamed "רמת פירוט" so the word
// "פרופיל" is free for the personal-details screen alone), the unit list, and
// the Cook Mode text size. "שאלות הפתיחה" lives at the bottom of this same
// screen rather than as its own category — the three onboarding questions
// (§4) ask for exactly these three things, so a separate category would only
// duplicate what is already here.

import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { PROFILES, UNIT_GROUPS, unit } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import {
  readCookTextSize,
  writeCookTextSize,
  type CookTextSize,
} from '../data/offlineMirror.js';
import shared from './SettingsShared.module.css';
import styles from './SettingsRecipePreferencesScreen.module.css';

/** §10's three sizes, in the words the handoff uses for them. */
const TEXT_SIZES: readonly { id: CookTextSize; he: string }[] = [
  { id: 'normal', he: 'רגיל' },
  { id: 'large', he: 'גדול' },
  { id: 'xlarge', he: 'גדול מאוד' },
];

export function SettingsRecipePreferencesScreen() {
  const { prefs, setPrefs } = useAppData();
  const navigate = useNavigate();

  const [textSize, setTextSize] = useState<CookTextSize | null>(null);
  const [textSizeKept, setTextSizeKept] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void readCookTextSize().then((size) => {
      if (!cancelled) setTextSize(size);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const units = prefs.units ?? [];

  // switching the level overwrites the unit list ONLY while the user has not
  // touched it. Identical to the onboarding, and for the same reason — a
  // chosen unit list is a decision, and a level change must not quietly undo
  // it.
  const pickProfile = (id: 'home' | 'pro' | 'study') => {
    const p = PROFILES.find((x) => x.id === id);
    if (!p) return;
    void setPrefs({
      profile: p.id,
      pro: p.pro,
      ...(prefs.touchedUnits ? {} : { units: [...p.units] }),
    });
  };

  const toggleUnit = (id: string) => {
    const nextUnits = units.includes(id) ? units.filter((u) => u !== id) : [...units, id];
    void setPrefs({ units: nextUnits, touchedUnits: true });
  };

  return (
    <div className={shared.wrap}>
      <header className={shared.head}>
        <BackControl>הגדרות</BackControl>
        <h1 className={shared.title}>העדפות מתכונים</h1>
      </header>

      {/* ── רמת פירוט (היה "פרופיל") ────────────────────────────────────── */}
      <section className={shared.card} aria-label="רמת פירוט">
        <h2 className={shared.cardTitle}>רמת פירוט</h2>
        <p className={shared.note}>
          הרמה קובעת מה מוצג כברירת מחדל. היא אינה נועלת שום יכולת — כל מה
          שמקצועי נשאר זמין בכל רמה.
        </p>
        <div className={styles.options} role="group" aria-label="בחירת רמת פירוט">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={prefs.profile === p.id ? styles.optionOn : styles.option}
              aria-pressed={prefs.profile === p.id}
              onClick={() => pickProfile(p.id)}
            >
              <span className={styles.optionName}>{p.he}</span>
              <span className={styles.optionDesc}>{p.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── יחידות מדידה ─────────────────────────────────────────────────── */}
      <section className={shared.card} aria-label="יחידות מדידה">
        <h2 className={shared.cardTitle}>יחידות מדידה</h2>
        <p className={shared.note}>
          היחידות שיוצעו בעריכת מתכון ובהמרות. אפשר לבחור כמה שרוצים.
        </p>
        {UNIT_GROUPS.map((g) => (
          <div key={g.id} className={styles.unitGroup}>
            <h3 className={styles.groupTitle}>{g.he}</h3>
            <div className={styles.pills} role="group" aria-label={g.he}>
              {g.ids.map((id) => {
                const u = unit(id);
                const on = units.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={on ? styles.pillOn : styles.pill}
                    aria-pressed={on}
                    onClick={() => toggleUnit(id)}
                  >
                    {u?.he ?? id}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {units.length === 0 && (
          <p className={styles.warn} role="status">
            לא נבחרה אף יחידה. בלי יחידה אחת לפחות אין במה להציג כמויות, וכדאי
            לבחור גרם.
          </p>
        )}
        <Link to="/tools" className={styles.linkBtn}>
          כלי המדידה שלי — גודל כוס, כף וכפית
        </Link>
      </section>

      {/* ── גודל הטקסט במצב הכנה ────────────────────────────────────────── */}
      <section className={shared.card} aria-label="גודל הטקסט במצב הכנה">
        <h2 className={shared.cardTitle}>גודל הטקסט במצב הכנה</h2>
        <p className={shared.note}>
          ההוראות והמשקלים במצב הכנה נקראים מרחוק, ולכן הגודל שלהם נקבע כאן.
          ההגדרה נשמרת על המכשיר הזה — טלפון על מדף וטאבלט על השיש יכולים
          להיות בגדלים שונים.
        </p>
        <div className={styles.pills} role="group" aria-label="גודל הטקסט">
          {TEXT_SIZES.map((o) => {
            const on = textSize === o.id;
            return (
              <button
                key={o.id}
                type="button"
                className={on ? styles.pillOn : styles.pill}
                aria-pressed={on}
                onClick={() => {
                  void writeCookTextSize(o.id).then((stored) => {
                    setTextSize(stored);
                    setTextSizeKept(stored === o.id);
                  });
                }}
              >
                {o.he}
              </button>
            );
          })}
        </div>
        <div
          className={styles.preview}
          style={
            {
              '--cook-text-scale':
                textSize === 'xlarge' ? 1.34 : textSize === 'large' ? 1.16 : 1,
            } as CSSProperties
          }
        >
          <span className={styles.previewLabel}>תצוגה מקדימה</span>
          <p className={styles.previewText}>מוסיפים את החמאה בהדרגה</p>
        </div>
        {!textSizeKept && (
          <p className={styles.warn} role="status">
            הדפדפן הזה לא שמר את הבחירה — ייתכן שחסימת נתוני אתר מונעת זאת.
            מצב ההכנה יישאר בגודל הרגיל.
          </p>
        )}
      </section>

      {/* ── שאלות הפתיחה ─────────────────────────────────────────────────── */}
      <section className={shared.card} aria-label="שאלות הפתיחה">
        <p className={shared.note}>
          אפשר לעבור שוב על שלוש שאלות הפתיחה — הן שואלות בדיוק את שלוש
          ההעדפות שמעל. ההעדפות הקיימות נשמרות עד שיוחלפו, והמתכונים אינם
          נוגעים בכלל.
        </p>
        <button
          type="button"
          className={shared.secondary}
          onClick={() => {
            void setPrefs({ done: false });
            navigate('/onboarding');
          }}
        >
          לעבור שוב על שאלות הפתיחה
        </button>
      </section>
    </div>
  );
}
