import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PROFILES,
  TOOL_OPTIONS,
  UNIT_GROUPS,
  toolMl,
  unit,
  type ToolId,
} from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { LoadingScreen } from '../app/LoadState.js';
import { useOptionalAuth } from '../auth/AuthProvider.js';
import styles from './OnboardingScreen.module.css';

/**
 * §4 — three steps, shown once, resettable from settings.
 *
 * Copy, order and the fixed oz/fl oz note are taken from §4 and from the
 * prototype's own strings, not rewritten.
 *
 * §4 Validation: the user may continue without choosing anything — the
 * profile's defaults take effect. Finishing sets prefs.done = true.
 */
const TITLES = [
  'איך נוח לכם לעבוד?',
  'איך נוח לכם למדוד במתכונים?',
  'מה גודל כלי המדידה שלכם?',
] as const;

const SUBTITLES = [
  'שלוש שאלות קצרות, ואז המחברת מותאמת לדרך העבודה שלכם.',
  'אפשר לבחור יותר מיחידה אחת. זו ברירת מחדל, לא הגבלה — בכל מתכון אפשר להזין כל יחידה.',
  'כוס אינה מידה אחת בעולם. בחרו את הכלים שבאמת נמצאים אצלכם, וכל ההמרות יחושבו לפיהם.',
] as const;

const TOOL_LABELS: readonly { tool: ToolId; label: string }[] = [
  { tool: 'cup', label: 'כוס' },
  { tool: 'tbsp', label: 'כף' },
  { tool: 'tsp', label: 'כפית' },
];

export function OnboardingScreen() {
  const { prefs, setPrefs, ready } = useAppData();
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  if (!ready) return <LoadingScreen />;

  const units = prefs.units ?? [];

  // §3: switching profile overwrites `units` ONLY while touchedUnits is false.
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
    const next = units.includes(id) ? units.filter((u) => u !== id) : [...units, id];
    void setPrefs({ units: next, touchedUnits: true });
  };

  const setTool = (tool: ToolId, ml: number) => {
    void setPrefs({ tools: { ...(prefs.tools ?? {}), [tool]: ml } });
  };

  const finish = () => {
    void setPrefs({ done: true });
    navigate('/notebook', { replace: true });
  };

  return (
    <div className={styles.outer}>
      <div className={styles.frame}>
        <header className={styles.head}>
          <div className={styles.dots} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i <= step ? styles.dotOn : styles.dotOff} />
            ))}
          </div>
          {auth?.justVerified && step === 0 && (
            <p className={styles.verified} role="status">
              כתובת האימייל אומתה. ברוכים הבאים!
            </p>
          )}
          <h1 className={styles.title}>{TITLES[step]}</h1>
          <p className={styles.sub}>{SUBTITLES[step]}</p>
        </header>

        <div className={`${styles.body} hideScrollbar`}>
          {step === 0 && (
            <div className={styles.cards}>
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={prefs.profile === p.id ? styles.cardOn : styles.card}
                  onClick={() => pickProfile(p.id)}
                  aria-pressed={prefs.profile === p.id}
                >
                  <span className={styles.cardTitle}>{p.he}</span>
                  <span className={styles.cardDesc}>{p.desc}</span>
                </button>
              ))}
              <p className={styles.note}>
                הבחירה קובעת רק מה נחשף לכם קודם וברירות מחדל. שום כלי לא נחסם, ואפשר
                לשנות בכל רגע בהגדרות.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className={styles.groups}>
              {UNIT_GROUPS.map((g) => (
                <section key={g.id}>
                  <h2 className={styles.groupTitle}>{g.he}</h2>
                  <div className={styles.pills}>
                    {g.ids.map((id) => {
                      const u = unit(id);
                      const on = units.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={on ? styles.pillOn : styles.pill}
                          onClick={() => toggleUnit(id)}
                          aria-pressed={on}
                        >
                          {u?.he ?? id}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {/* §4: this note is fixed copy, not a hint */}
              <p className={styles.sysNote}>
                oz הוא משקל. fl oz הוא נפח. הם לא אותו דבר ולא מומרים זה לזה בלי לדעת מה
                חומר הגלם.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className={styles.groups}>
              {TOOL_LABELS.map(({ tool, label }) => {
                const currentMl = toolMl(prefs, tool);
                return (
                  <section key={tool}>
                    <h2 className={styles.groupTitle}>
                      {label} — כרגע <span className="ltr">{Math.round(currentMl)}</span> מ&quot;ל
                    </h2>
                    <div className={styles.cards}>
                      {TOOL_OPTIONS[tool].map((o) => {
                        const on = Math.abs(currentMl - o.ml) < 0.06;
                        return (
                          <button
                            key={o.ml}
                            type="button"
                            className={on ? styles.toolOn : styles.tool}
                            onClick={() => setTool(tool, o.ml)}
                            aria-pressed={on}
                          >
                            <span className="ltr">{o.ml}</span> מ&quot;ל — {o.he}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              <p className={styles.note}>
                כל המרה בין נפח למשקל תחושב לפי הכלים האלה. אפשר לשנות בכל רגע בהגדרות,
                וכל המספרים באפליקציה יתעדכנו מיד.
              </p>
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          {step > 0 && (
            <button
              type="button"
              className={`${styles.back} nowrap`}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              הקודם
            </button>
          )}
          <button
            type="button"
            className={styles.next}
            onClick={() => (step < 2 ? setStep(step + 1) : finish())}
          >
            {step < 2 ? 'המשך' : 'סיום, לפתוח את המחברת'}
          </button>
        </footer>
      </div>
    </div>
  );
}
