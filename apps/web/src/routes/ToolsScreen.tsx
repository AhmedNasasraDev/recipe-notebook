// §2 screen 21 — "כלי המדידה שלי".
//
// WHY THIS SCREEN HAD TO EXIST
//
// The onboarding tells the user twice, in fixed copy, "אפשר לשנות בכל רגע
// בהגדרות". Until now there was no such screen: the three tool sizes were
// asked for once, on the third onboarding step, and then frozen for the life
// of the account. Everything downstream depends on them — every cup, spoon and
// teaspoon in every recipe is converted through `prefs.tools` (§5.1), so a
// user who answered 240 ml and then bought a 250 ml cup had no way to correct
// a number that silently moves every volume measurement in the notebook.
//
// The pickers are deliberately the same ones the onboarding uses, reading and
// writing the same `prefs`: this is one setting with two doors, not two
// settings that can disagree.

import { BackLink } from '../components/BackLink.js';
import {
  TOOL_OPTIONS,
  toolLabel,
  toolMl,
  type ToolId,
} from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { ICON_STROKE, TOOL_ICON } from '../shell/Icons.js';
import styles from './ToolsScreen.module.css';

const TOOLS: readonly ToolId[] = ['cup', 'tbsp', 'tsp'];

export function ToolsScreen() {
  const { prefs, setPrefs, setCalibrations, capabilities } = useAppData();
  const calibrations = prefs.calib ?? [];

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        {/* §4: the way back is at the TOP of an inner screen, not at the end
            of it — it used to be the last thing on the page. */}
        <BackLink to="/more">עוד</BackLink>
        <h1 className={styles.title}>כלי המדידה שלי</h1>
        <p className={styles.lead}>
          כל המרה בין נפח למשקל באפליקציה נעשית לפי הכלים האלה. שינוי כאן מעדכן
          מיד כל מספר בכל מתכון.
        </p>
      </header>

      {!capabilities.canWrite && (
        <p className={styles.notice} role="status">
          בהתקנה הזאת אין חיבור לשרת, ולכן ההעדפות נשמרות על המכשיר הזה בלבד.
        </p>
      )}

      {TOOLS.map((tool) => {
        const currentMl = toolMl(prefs, tool);
        return (
          <section key={tool} className={styles.card} aria-label={toolLabel(tool)}>
            {/*
              §10: the tool's OWN VOLUME is the fact this card is about, so it
              is the figure at the top rather than a clause in the heading —
              "נפח הכלי", in millilitres, which is what a jug holds. What it
              weighs depends on the ingredient, and the note below the cards
              says so; nothing here converts anything.
            */}
            <div className={styles.toolHead}>
              <span className={styles.toolIcon} aria-hidden="true">
                {TOOL_ICON[tool]?.({ width: ICON_STROKE.menu })}
              </span>
              <span className={styles.toolNames}>
                <h2 className={styles.cardTitle}>{toolLabel(tool)}</h2>
                <span className={styles.toolMlLabel}>נפח הכלי</span>
                <span className={styles.toolMl}>
                  <span className="ltr">{Math.round(currentMl)}</span> מ&quot;ל
                </span>
              </span>
            </div>
            <div className={styles.options} role="group" aria-label={`גודל ${toolLabel(tool)}`}>
              {TOOL_OPTIONS[tool].map((o) => {
                // The same tolerance the onboarding uses: the stored value is a
                // number and the options are numbers, but a value that came back
                // through JSON can be 239.99999.
                const on = Math.abs(currentMl - o.ml) < 0.06;
                return (
                  <button
                    key={o.ml}
                    type="button"
                    className={on ? styles.optionOn : styles.option}
                    aria-pressed={on}
                    onClick={() => void setPrefs({ tools: { ...(prefs.tools ?? {}), [tool]: o.ml } })}
                  >
                    <span className="ltr">{o.ml}</span> מ&quot;ל — {o.he}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* §4 and §21, fixed copy rather than a hint: this is the one conversion
          the app refuses to make, and the reason has to be stated. */}
      <p className={styles.sysNote}>
        oz הוא משקל. fl oz הוא נפח. הם לא אותו דבר, ולא מומרים זה לזה בלי לדעת מה
        חומר הגלם.
      </p>

      {/*
        The calibration list. It used to live on the "עוד" screen, which was the
        only place it could go before this screen existed; §2 puts it here. A
        wrong calibration is worse than none — it takes precedence over every
        table value (§5.1 rank 1) — so it has to be visible and removable.
      */}
      <section className={styles.card} aria-label="הכיולים שלי">
        <h2 className={styles.cardTitle}>
          {calibrations.length === 0
            ? 'אין כיולים אישיים'
            : calibrations.length === 1
              ? 'כיול אישי אחד'
              : `${calibrations.length} כיולים אישיים`}
        </h2>

        {calibrations.length === 0 ? (
          <p className={styles.note}>
            כיול אישי נמדד מתוך דף המתכון, על רכיב שאין לו נתון צפיפות אמין. הוא
            מקבל עדיפות על כל נתון בטבלה, ולכן הוא מופיע כאן כדי שתמיד יהיה אפשר
            לבדוק אותו ולהסיר אותו.
          </p>
        ) : (
          <ul className={styles.calibList}>
            {calibrations.map((c) => (
              <li key={`${c.id}-${c.tool}`} className={styles.calibItem}>
                <span className={styles.calibText}>
                  <span className={styles.calibName}>{c.name}</span>
                  <span className={styles.calibDetail}>
                    {toolLabel(c.tool)} אחת = <span className="ltr">{c.grams}</span> גרם,
                    נמדד בכלי של <span className="ltr">{c.toolMl}</span> מ&quot;ל
                    {c.at ? ` · ${c.at}` : ''}
                    {c.toolMlAssumed && ' · גודל הכלי הונח, כדאי לאמת'}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`הסרת הכיול של ${c.name} ב${toolLabel(c.tool)}`}
                  onClick={() =>
                    void setCalibrations(
                      calibrations.filter((x) => !(x.id === c.id && x.tool === c.tool)),
                    )
                  }
                >
                  הסרה
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
