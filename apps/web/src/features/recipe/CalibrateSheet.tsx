// Personal calibration (§5.1 rank 1, engine B4/B5).
//
// The whole engine side of this already existed and is untouched:
// `createCalibration` freezes the tool volume at the moment of measurement,
// `upsertCalibration` keeps one record per (ingredient, tool), and
// `findCalibration` matches on exact identity only. What was missing was any
// way for a user to reach it. This is that.
//
// Why it is the most useful screen in stage 4: a personal calibration is the
// only honest way out of a `partial` calculation. Five density rows are held at
// `pending-verification` and seven at `pending-form` on purpose — the legacy
// tables disagreed and no value was invented. For those ingredients the app
// cannot produce a weight from a cup. One measurement by the user can, and it
// is better than any table value, because it is their flour in their cup.
//
// Two rules it must not break:
//
//   • The tool volume is read from preferences AT SAVE TIME and frozen into the
//     record. That is B5. Changing the cup setting later must not rewrite a
//     past measurement, so this sheet shows which volume it is about to freeze.
//
//   • A near-miss is never applied automatically. That is B4 — a calibration
//     for "קמח" used to be applied to "קמח שקדים" and shown with a green
//     "exact" badge. `suggestCalibrations` surfaces related records, and
//     attaching one takes a deliberate click.

import { useMemo, useState } from 'react';
import {
  TOOL_OPTIONS,
  createCalibration,
  findCalibration,
  suggestCalibrations,
  toolLabel,
  toolMl,
  upsertCalibration,
  type Calibration,
  type MeasurementPrefs,
  type ToolId,
} from '@recipe-notebook/engine';
import styles from './recipe.module.css';

const TOOLS: readonly ToolId[] = ['cup', 'tbsp', 'tsp'];

export function CalibrateSheet({
  ingredientName,
  prefs,
  onClose,
  onSave,
}: {
  ingredientName: string;
  prefs: MeasurementPrefs;
  onClose(): void;
  /** the full replacement list — the caller persists it */
  onSave(next: Calibration[]): void;
}) {
  const [tool, setTool] = useState<ToolId>('cup');
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string | null>(null);

  const name = ingredientName.trim();
  const list = useMemo(() => prefs.calib ?? [], [prefs.calib]);

  // The volume that will be frozen into the record if it is saved now.
  const ml = toolMl(prefs, tool);

  const existing = useMemo(
    () => findCalibration({ name }, prefs, tool),
    [name, prefs, tool],
  );
  const related = useMemo(() => suggestCalibrations({ name }, prefs), [name, prefs]);

  const submit = () => {
    setError(null);
    const value = Number(grams.trim());
    if (!grams.trim() || !Number.isFinite(value) || value <= 0) {
      setError('יש להזין משקל בגרמים, גדול מאפס.');
      return;
    }
    try {
      // createCalibration reads prefs.tools and freezes the volume. It is the
      // engine's job, not this sheet's, and that is deliberate.
      const calib = createCalibration({ name, tool, grams: value }, prefs);
      onSave(upsertCalibration(list, calib));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הכיול נכשל.');
    }
  };

  const attach = (source: Calibration) => {
    // Re-created under THIS ingredient's identity rather than copied, so the
    // new record's key belongs to this ingredient and the original stays as it
    // is. Copying the object would have given two ingredients one record.
    const calib = createCalibration(
      { name, tool: source.tool, grams: source.grams },
      // The source's own frozen volume is the measurement that matters here,
      // not today's setting — so prefs are overridden for this one call.
      { ...prefs, tools: { ...(prefs.tools ?? {}), [source.tool]: source.toolMl } },
    );
    onSave(upsertCalibration(list, calib));
  };

  return (
    <div
      className={styles.sheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="כיול אישי"
    >
      <div className={styles.sheet}>
        <header className={styles.sheetHead}>
          <div>
            <h2 className={styles.sheetTitle}>כיול אישי</h2>
            <p className={styles.sheetName}>{name || 'רכיב חדש'}</p>
          </div>
          <button
            type="button"
            className={styles.sheetClose}
            onClick={onClose}
            aria-label="סגירה"
          >
            ×
          </button>
        </header>

        <p className={styles.calibIntro}>
          מלאו {toolLabel(tool)} אחת מהרכיב הזה כמו שאתם ממלאים אותה בפועל, שקלו,
          והזינו את המשקל. הערך הזה יקבל עדיפות על כל נתון בטבלה — הוא הקמח שלכם
          בכלי שלכם.
        </p>

        <h3 className={styles.sheetSub}>באיזה כלי</h3>
        <div className={styles.pills}>
          {TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              className={tool === t ? styles.pillOn : styles.pill}
              aria-pressed={tool === t}
              onClick={() => setTool(t)}
            >
              {toolLabel(t)}
            </button>
          ))}
        </div>

        <p className={styles.calibTool} aria-label="נפח הכלי שיישמר">
          {toolLabel(tool)} אחת אצלכם = <span className="ltr">{round(ml)}</span> מ&quot;ל.
          הנפח הזה נשמר יחד עם הכיול, כך ששינוי עתידי בהגדרות לא ישנה את המדידה
          הזאת.
          {TOOL_OPTIONS[tool].every((o) => o.ml !== ml) && (
            <span className={styles.calibCustom}> (גודל מותאם אישית)</span>
          )}
        </p>

        <div className={styles.calibField}>
          <label className={styles.calibLabel} htmlFor="calib-grams">
            משקל {toolLabel(tool)} אחת, בגרמים
          </label>
          <input
            id="calib-grams"
            className={`${styles.calibInput} ltr`}
            inputMode="decimal"
            placeholder="למשל 120"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            autoFocus
          />
        </div>

        {existing && (
          <p className={styles.calibExisting} role="status">
            כבר יש כיול לרכיב הזה: {existing.note}. שמירה תחליף אותו.
          </p>
        )}

        {error && (
          <p className={styles.calibError} role="alert">
            {error}
          </p>
        )}

        <button type="button" className={styles.calibrateBtn} onClick={submit}>
          שמירת הכיול
        </button>

        {related.length > 0 && (
          <div className={styles.calibRelated}>
            <h3 className={styles.sheetSub}>כיולים קרובים</h3>
            <p className={styles.calibRelatedNote}>
              אלה לא אותו חומר גלם, ולכן הם לא הוחלו אוטומטית. אפשר להחיל אותם
              במפורש אם זה נכון אצלכם.
            </p>
            <ul className={styles.calibRelatedList}>
              {related.map(({ calib, reason }) => (
                <li key={`${calib.id}-${calib.tool}`}>
                  <span className={styles.calibRelatedText}>{reason}</span>
                  <button
                    type="button"
                    className={styles.calibAttachBtn}
                    onClick={() => attach(calib)}
                    aria-label={`להחיל את הכיול של ${calib.name} על ${name}`}
                  >
                    להחיל
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}
