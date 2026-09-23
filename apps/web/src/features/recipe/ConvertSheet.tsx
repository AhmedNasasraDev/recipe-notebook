import { useState } from 'react';
import {
  convertScaled,
  toolLabel,
  toolMl,
  unit,
  unitLabel,
  type IngredientLike,
  type MeasurementPrefs,
} from '@recipe-notebook/engine';
import { SourceBadge } from '../../components/SourceBadge.js';
import styles from './recipe.module.css';

/**
 * §5.3 — the per-ingredient conversion sheet.
 *
 * This is where B3 was. The prototype handed this sheet a gram figure and threw
 * the recipe's own unit away, so "2 כוס קמח" converted to grams came back
 * labelled "המרה מדויקת" — an estimate wearing a green badge.
 *
 * Here the sheet receives the ingredient AS THE RECIPE STORES IT plus the
 * current scaling factor, and calls `convertScaled`, which starts from the
 * original unit and reports the weakest link of the whole chain.
 *
 * §5.3 requires the sheet to show: the recipe's own quantity and unit, the
 * quantity currently displayed, the size of the user's measuring tool, the
 * target units, the result, and the source badge with its explanation.
 */
const TARGETS = ['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'oz', 'floz', 'unit'] as const;

export function ConvertSheet({
  ingredient,
  factor,
  displayGrams,
  prefs,
  onClose,
  onCalibrate,
}: {
  ingredient: IngredientLike;
  factor: number;
  /** grams currently on screen, or null when the engine could not establish it */
  displayGrams: number | null;
  prefs: MeasurementPrefs;
  onClose(): void;
  onCalibrate(name: string): void;
}) {
  const [target, setTarget] = useState<string | null>(null);

  const fromUnit = unit(ingredient.unit);
  const fromTool = fromUnit?.tool ?? null;
  const result = target ? convertScaled(ingredient, factor, target, prefs) : null;

  // §18.6: a sub-recipe line is weighed, never volume-converted
  const isSub = Boolean(ingredient.subId);

  return (
    <div className={styles.sheetBackdrop} role="dialog" aria-modal="true" aria-label="המרת יחידה">
      <div className={styles.sheet}>
        <header className={styles.sheetHead}>
          <div>
            <h2 className={styles.sheetTitle}>המרת יחידה</h2>
            <p className={styles.sheetName}>{ingredient.name}</p>
          </div>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </header>

        <dl className={styles.factRows}>
          <div className={styles.factRow}>
            <dt>כפי שכתוב במתכון</dt>
            <dd className="ltr">
              {ingredient.qty} {unitLabel(ingredient.unit)}
            </dd>
          </div>
          <div className={styles.factRow}>
            <dt>בכמות המוצגת כרגע</dt>
            <dd className="ltr">
              {displayGrams === null ? '—' : `${Math.round(displayGrams)} גר'`}
            </dd>
          </div>
          <div className={styles.factRow}>
            <dt>כלי המדידה</dt>
            <dd aria-label="גודל כלי המדידה">
              {fromTool ? (
                <>
                  {toolLabel(fromTool)} אחת ={' '}
                  <span className="ltr">{Math.round(toolMl(prefs, fromTool))}</span> מ&quot;ל לפי
                  ההגדרות שלכם
                </>
              ) : (
                'הרכיב נמדד במשקל, בלי תלות בכלי'
              )}
            </dd>
          </div>
        </dl>

        <h3 className={styles.sheetSub}>להמיר אל</h3>
        <div className={styles.pills}>
          {TARGETS.map((t) => {
            const u = unit(t);
            if (!u) return null;
            const disabled = isSub && u.group !== 'weight';
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                className={target === t ? styles.pillOn : styles.pill}
                onClick={() => setTarget(t)}
                aria-pressed={target === t}
              >
                {u.he}
              </button>
            );
          })}
        </div>

        {result && (
          <div className={styles.resultBox}>
            {result.ok ? (
              <>
                <p className={styles.resultValue} role="status" aria-label="תוצאת ההמרה">
                  {result.text}
                </p>
                <div className={styles.resultBadgeRow}>
                  <SourceBadge provenance={result.provenance} />
                </div>
                <p className={styles.resultWhy}>{result.provenance.why}</p>
                {result.provenance.toolNote && (
                  <p className={styles.resultNote}>{result.provenance.toolNote}</p>
                )}
                {result.provenance.needsReview && (
                  <p className={styles.resultReview}>
                    הנתון שמאחורי ההמרה הזאת ממתין לאימות מקצועי. כיול אישי יהפוך אותו
                    למדויק אצלכם.
                  </p>
                )}
              </>
            ) : (
              <p className={styles.resultFail}>{result.why}</p>
            )}
          </div>
        )}

        <button
          type="button"
          className={styles.calibrateBtn}
          onClick={() => onCalibrate(ingredient.name ?? '')}
        >
          לכייל את הרכיב הזה אצלי במטבח
        </button>
      </div>
    </div>
  );
}
