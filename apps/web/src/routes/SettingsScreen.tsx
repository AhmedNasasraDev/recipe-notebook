// §2 screen 20 — "הגדרות": profile, units, language, privacy, reset onboarding,
// and the account.
//
// WHY IT EXISTS NOW
//
// Two of the three onboarding steps end with the sentence "אפשר לשנות בכל רגע
// בהגדרות", and there was no such screen. So the profile and the unit list —
// which decide what the whole app shows (§3) and which units every recipe is
// offered in — were answered once, before the user had seen a single recipe,
// and then frozen. The pickers below are the onboarding's own, reading and
// writing the same `prefs`, because this is one setting with two doors.
//
// WHAT IS DELIBERATELY NOT HERE
//
// Language: §17 lists Arabic as "בהכנה", and a switcher that changes nothing is
// the shape of dishonesty AC #17 rules out. The row states the fact instead.
// Privacy: §12 is a set of rules the system enforces, not preferences to
// toggle — so it is stated, at the place where the account lives, and there is
// nothing to switch.

import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { PROFILES, UNIT_GROUPS, unit } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { useAuth } from '../auth/AuthProvider.js';
import { ChevronIcon, ICON_STROKE, ProfileIcon } from '../shell/Icons.js';
import {
  readCookTextSize,
  writeCookTextSize,
  type CookTextSize,
} from '../data/offlineMirror.js';
import {
  backupFileName,
  buildNotebookBackup,
  downloadJson,
} from '../features/backup/exportNotebook.js';
import styles from './SettingsScreen.module.css';

/** §10's three sizes, in the words the handoff uses for them. */
const TEXT_SIZES: readonly { id: CookTextSize; he: string }[] = [
  { id: 'normal', he: 'רגיל' },
  { id: 'large', he: 'גדול' },
  { id: 'xlarge', he: 'גדול מאוד' },
];

export function SettingsScreen() {
  const { prefs, setPrefs, capabilities, recipes, catalog, listPlans, getPlan, getPrivateNote } =
    useAppData();
  const { status, user, signOut, changePassword } = useAuth();
  const navigate = useNavigate();

  /*
    §10: "גודל טקסט, עם שמירה והשפעה אמיתיות."

    The size of the instructions in Cook Mode, stored on the DEVICE — see
    `readCookTextSize` for why it belongs there and not in the account. The
    control below writes it and then shows what is actually stored, so a
    browser that refuses storage cannot leave a choice on screen that will be
    gone after a reload.
  */
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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  const units = prefs.units ?? [];

  // §3: switching profile overwrites the unit list ONLY while the user has not
  // touched it. Identical to the onboarding, and for the same reason — a chosen
  // unit list is a decision, and a profile change must not quietly undo it.
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

  const onSignOut = async () => {
    setError(null);
    setBusy(true);
    try {
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ההתנתקות נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = async () => {
    setPwError(null);
    setPwDone(false);
    if (next !== again) {
      setPwError('שתי הסיסמאות החדשות אינן זהות.');
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  };

  /*
    Spec 5.1 backup (stage 3ב, A-5). Everything but the plans and the private
    notes is already in memory; those two are read now, plan by plan and note
    by note, because neither is held by the provider (a plan is not an input to
    anyone else's figures, and a private note is loaded only on its own page).
    A single failure fails the whole export — a "backup" with a plan missing
    is worse than none — and says which part.
  */
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; text: string } | null>(null);
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
        {/* §4: the way back is at the TOP of an inner screen, not at the end
            of it — it used to be the last thing on the page. */}
        <BackControl>עוד</BackControl>
        <h1 className={styles.title}>הגדרות</h1>
      </header>

      {/*
        Personal Settings, stage 1 (23.09.2026). The first of what will become
        several category screens (שפה, אבטחה, התראות, ...), added one stage at
        a time — see the saved plan. Named "פרטים אישיים" rather than "פרופיל"
        on purpose: the section right below it is ALREADY called "פרופיל" (the
        home/pro/study cooking level), and the two must not be confused on the
        same page.
      */}
      <nav className={styles.menu} aria-label="קטגוריות הגדרות">
        <Link to="/settings/profile" className={styles.entry}>
          <span className={styles.entryIcon} aria-hidden="true">
            <ProfileIcon width={ICON_STROKE.menu} />
          </span>
          <span className={styles.entryText}>
            <span className={styles.entryTitle}>פרטים אישיים</span>
            <span className={styles.entryBody}>שם, תמונה, טלפון ומייל</span>
          </span>
          <span className={styles.entryChevron} aria-hidden="true">
            <ChevronIcon />
          </span>
        </Link>
      </nav>

      {/* ── §3 profile ─────────────────────────────────────────────────── */}
      <section className={styles.card} aria-label="פרופיל">
        <h2 className={styles.cardTitle}>פרופיל</h2>
        <p className={styles.note}>
          הפרופיל קובע מה מוצג כברירת מחדל. הוא אינו נועל שום יכולת — כל מה
          שמקצועי נשאר זמין בכל פרופיל.
        </p>
        <div className={styles.options} role="group" aria-label="בחירת פרופיל">
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

      {/* ── §4 step 2: the unit list ───────────────────────────────────── */}
      {/*
        §10.1's name-and-picture card moved to /settings/profile (Personal
        Settings stage 1) — it belongs beside first/last name now, not here.
      */}

      <section className={styles.card} aria-label="יחידות מדידה">
        <h2 className={styles.cardTitle}>יחידות מדידה</h2>
        <p className={styles.note}>
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

      {/* ── §10 the size of the text in Cook Mode ──────────────────────── */}
      <section className={styles.card} aria-label="גודל הטקסט במצב הכנה">
        <h2 className={styles.cardTitle}>גודל הטקסט במצב הכנה</h2>
        <p className={styles.note}>
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
        {/* A preview at the real size, so the choice is made by looking rather
            than by imagining. The scale is the one Cook Mode uses. */}
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

      {/* ── §15 / §17 language ─────────────────────────────────────────── */}
      <section className={styles.card} aria-label="שפה">
        <h2 className={styles.cardTitle}>שפה</h2>
        <p className={styles.note}>
          הממשק בעברית, בכתיבה מימין לשמאל. ערבית מתוכננת לשלב הבא ועדיין אינה זמינה — ולכן
          אין כאן מתג שלא יעשה דבר.
        </p>
      </section>

      {/* ── §12 privacy, stated where the account lives ────────────────── */}
      <section className={styles.card} aria-label="פרטיות">
        <h2 className={styles.cardTitle}>פרטיות</h2>
        <ul className={styles.rules}>
          <li>המחברת שלכם פרטית. אין לאף חשבון אחר גישה אליה.</li>
          <li>ההערות האישיות והכיולים שייכים לחשבון ואינם נשלחים לאף מקום.</li>
          <li>שיתוף קורה רק ביוזמתכם — דרך קבוצה שפתחתם או הצטרפתם אליה. מה שלא שיתפתם נשאר פרטי.</li>
        </ul>
        <p className={styles.note}>
          אלה חוקים שהמערכת אוכפת במסד הנתונים עצמו, ולא הגדרות שניתן לכבות.
        </p>
      </section>

      {/* ── spec 5.1 backup and export (stage 3ב, A-5) ─────────────────── */}
      <section className={styles.card} aria-label="גיבוי וייצוא">
        <h2 className={styles.cardTitle}>גיבוי וייצוא</h2>
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

      {/* ── §4 reset onboarding ────────────────────────────────────────── */}
      <section className={styles.card} aria-label="שאלות הפתיחה">
        <h2 className={styles.cardTitle}>שאלות הפתיחה</h2>
        <p className={styles.note}>
          אפשר לעבור שוב על שלוש שאלות הפתיחה. ההעדפות הקיימות נשמרות עד שיוחלפו,
          והמתכונים אינם נוגעים בכלל.
        </p>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            void setPrefs({ done: false });
            navigate('/onboarding');
          }}
        >
          לעבור שוב על שאלות הפתיחה
        </button>
      </section>

      {/* ── the account ────────────────────────────────────────────────── */}
      <section className={styles.card} aria-label="החשבון שלי">
        <h2 className={styles.cardTitle}>החשבון שלי</h2>

        {status === 'signed-in' && user ? (
          <>
            <p className={styles.email}>
              <span className="ltr">{user.email}</span>
            </p>
            <p className={styles.note}>
              המתכונים, ההערות הפרטיות והכיולים שמורים לחשבון הזה. ההתנתקות גם
              מוחקת את ההעתק המקומי מהמכשיר.
            </p>

            {pwDone && (
              <p className={styles.ok} role="status">
                הסיסמה הוחלפה.
              </p>
            )}

            {!pwOpen ? (
              <button
                type="button"
                className={styles.secondary}
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
                  <label className={styles.label} htmlFor="pw-current">
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
                  <label className={styles.label} htmlFor="pw-next">
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
                  <label className={styles.label} htmlFor="pw-again">
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
                  <p className={styles.error} role="alert">
                    {pwError}
                  </p>
                )}

                <div className={styles.pwActions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy || current === '' || next === ''}
                    onClick={() => void onChangePassword()}
                  >
                    {busy ? 'רגע…' : 'עדכון הסיסמה'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
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
                <p className={styles.note}>
                  נדרשת גם הסיסמה הנוכחית. חלון פתוח לבדו אינו מספיק כדי להחליף
                  סיסמה של חשבון.
                </p>
              </div>
            )}

            <button
              type="button"
              className={styles.signOut}
              onClick={() => void onSignOut()}
              disabled={busy}
            >
              {busy ? 'רגע…' : 'התנתקות'}
            </button>
          </>
        ) : (
          <p className={styles.note}>
            {/* No 'simulated' branch: the line that started "סימולציה מקומית"
                was removed at Ahmed's request. This slot always held one
                sentence, so the trial falls through to the existing default —
                which is true (there is no account) and is not a new banner
                and not a claim that anything is saved to a server. */}
            {capabilities.source === 'local-demo'
              ? 'אין חיבור לשרת בהתקנה הזאת, ולכן אין חשבון. ההעדפות כאן נשמרות על המכשיר הזה בלבד.'
              : 'לא מחוברים לחשבון.'}
          </p>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

    </div>
  );
}
