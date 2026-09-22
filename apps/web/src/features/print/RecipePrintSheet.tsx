// The recipe on paper — what "הדפסה / שמירה כ-PDF" prints.
//
// WHY A SEPARATE SHEET AND NOT THE SCREEN WITH BITS HIDDEN
//
// The recipe screen is a working surface: a scale card, view tabs, a focal
// point control, a details panel that is not even built until it is opened,
// and a gallery with delete buttons. Printing that page with `.noprint`
// sprinkled over it gave a first page of controls and a cut-off second one,
// because the application scrolls inside a fixed-height frame and a browser
// prints only what the frame shows (QA 22.09.2026, §2). So the sheet is its
// own document: the name, the picture, what the recipe makes, the
// ingredients for THIS batch, the steps with their times and temperatures,
// the public note — and nothing else. It says nothing it does not know: a
// recipe with no temperature prints no temperature line, rather than
// "לא מצוין".
//
// WHERE IT RENDERS
//
// Into `#print-root`, a sibling of the application's root and OUTSIDE its
// scroll frame, through a portal. On screen that element is `display: none`;
// on paper the application is hidden and the sheet is the page. The body
// carries a class while a sheet is mounted, which is what the print rules in
// styles/global.css key on — so a screen with no sheet (the label, the order
// sheet, which are already paper) prints exactly as it did.
//
// WHEN IT RENDERS
//
// Only while printing. The browser fires `beforeprint` before it renders the
// pages — for a button that calls `window.print()` and for Ctrl+P / "share →
// print" alike — and the sheet is committed SYNCHRONOUSLY in that handler
// (`flushSync`), so the print engine finds it in the document. `afterprint`
// takes it down again. On screen there is therefore never a second copy of
// the recipe in the DOM: nothing for a screen reader to stumble on, nothing
// for a text search to find twice.

import { useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { formatGrams, type Computed, type MeasurementPrefs, type Recipe } from '@recipe-notebook/engine';
import { rowLabel } from '../recipe/rowLabel.js';
import { formatMinutes, totalMinutes } from '../recipe/recipeTime.js';
import styles from './RecipePrintSheet.module.css';

const KIND_HE: Record<string, string> = {
  active: 'עבודה',
  passive: 'המתנה',
  chill: 'קירור',
  proof: 'התפחה',
  bake: 'אפייה/בישול',
};

export const PRINT_ROOT_ID = 'print-root';
export const PRINT_BODY_CLASS = 'has-print-sheet';

function printRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(PRINT_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PRINT_ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

interface Props {
  recipe: Recipe;
  computed: Computed;
  /** the scale in force, so the sheet prints the batch on screen */
  factor: number;
  /** one line about the batch: "כמויות כמו במתכון" or "לפי מספר יחידות · ×2.00" */
  scaleText: string;
  prefs: MeasurementPrefs;
  /** the hero, when there is one and it could be signed */
  imageUrl: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Is the document being printed right now? Driven by the browser's events. */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return printing;
}

export function RecipePrintSheet({ recipe, computed, factor, scaleText, prefs, imageUrl }: Props) {
  const root = useMemo(printRoot, []);
  const printing = usePrinting();

  /* The body class the print rules key on, and the document title — which is
     what the browser offers as the PDF's file name. Both put back afterwards. */
  useEffect(() => {
    if (typeof document === 'undefined' || !printing) return;
    document.body.classList.add(PRINT_BODY_CLASS);
    const before = document.title;
    document.title = `${String(recipe.name ?? 'מתכון')} — מחברת מתכונים`;
    return () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
      document.title = before;
    };
  }, [recipe.name, printing]);

  if (!root || !printing) return null;

  const minutes = totalMinutes(recipe);
  const unitWeight = num(recipe.unitWeight);
  const weightBefore = num(recipe.weightBefore);
  const weightAfter = num(recipe.weightAfter);
  const units = computed.unitsActual > 0 ? Math.round(computed.unitsActual) : null;
  const steps = (recipe.steps ?? []).filter((s) => s.text || s.minutes);
  const temps = steps
    .map((s) => (s.temp ? `${s.temp}°${s.tempUnit === 'F' ? 'F' : 'C'}` : ''))
    .filter(Boolean);

  return createPortal(
    <article className={styles.sheet} dir="rtl" lang="he" aria-hidden="true">
      <header className={styles.head}>
        <h1 className={styles.title}>{recipe.name}</h1>
        {recipe.category && <p className={styles.category}>{recipe.category}</p>}
      </header>

      {imageUrl && (
        <img className={styles.photo} src={imageUrl} alt="" />
      )}

      <dl className={styles.facts}>
        {units !== null && (
          <div className={styles.fact}>
            <dt>תפוקה</dt>
            <dd>
              <span className="ltr">{units}</span> יחידות
            </dd>
          </div>
        )}
        {computed.actualYield > 0 && (
          <div className={styles.fact}>
            <dt>משקל האצווה</dt>
            <dd className="ltr">{formatGrams(computed.actualYield)}</dd>
          </div>
        )}
        {unitWeight !== null && (
          <div className={styles.fact}>
            <dt>משקל ליחידה</dt>
            <dd className="ltr">{formatGrams(unitWeight * 1)}</dd>
          </div>
        )}
        {weightBefore !== null && (
          <div className={styles.fact}>
            <dt>משקל לפני אפייה</dt>
            <dd className="ltr">{formatGrams(weightBefore * factor)}</dd>
          </div>
        )}
        {weightAfter !== null && (
          <div className={styles.fact}>
            <dt>משקל אחרי אפייה</dt>
            <dd className="ltr">{formatGrams(weightAfter * factor)}</dd>
          </div>
        )}
        {minutes > 0 && (
          <div className={styles.fact}>
            <dt>זמן כולל</dt>
            <dd className="ltr">{formatMinutes(minutes)}</dd>
          </div>
        )}
        {temps.length > 0 && (
          <div className={styles.fact}>
            <dt>טמפרטורות</dt>
            <dd className="ltr">{[...new Set(temps)].join(' · ')}</dd>
          </div>
        )}
      </dl>
      <p className={styles.scaleLine}>
        {factor === 1 ? scaleText : <>{scaleText}</>}
      </p>

      <section>
        <h2 className={styles.h2}>רכיבים</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">רכיב</th>
              <th scope="col" className={styles.qtyCol}>כמות</th>
              <th scope="col" className={styles.qtyCol}>בגרמים</th>
            </tr>
          </thead>
          <tbody>
            {computed.rows.map((row, i) => {
              const asWritten = rowLabel(row, 'orig', factor, prefs);
              const grams = row.g === null ? '______' : formatGrams(row.g);
              return (
                <tr key={row.ing.id ?? i}>
                  <td>
                    {row.ing.name}
                    {row.ing.note && <span className={styles.note}> · {row.ing.note}</span>}
                  </td>
                  <td className={`${styles.qtyCol} ltr`}>
                    {asWritten.text}
                    {asWritten.hint && <span className={styles.note}> {asWritten.hint}</span>}
                  </td>
                  <td className={`${styles.qtyCol} ltr`}>{grams}</td>
                </tr>
              );
            })}
          </tbody>
          {computed.totalG > 0 && (
            <tfoot>
              <tr>
                <td>סך הכל</td>
                <td />
                <td className={`${styles.qtyCol} ltr`}>{formatGrams(computed.totalG)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      {steps.length > 0 && (
        <section>
          <h2 className={styles.h2}>אופן ההכנה</h2>
          <ol className={styles.steps}>
            {steps.map((s, i) => {
              const m = Number(s.minutes) || 0;
              const bits = [
                s.kind ? KIND_HE[s.kind] : '',
                s.temp ? `${s.temp}°${s.tempUnit === 'F' ? 'F' : 'C'}` : '',
                m > 0 ? formatMinutes(m) : '',
              ].filter(Boolean);
              return (
                <li key={s.id ?? i} className={styles.step}>
                  <span className={styles.stepText}>{s.text}</span>
                  {bits.length > 0 && (
                    <span className={`${styles.stepMeta} ltr`}>{bits.join(' · ')}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recipe.notes && (
        <section>
          <h2 className={styles.h2}>הערות</h2>
          <p className={styles.notes}>{recipe.notes}</p>
        </section>
      )}
    </article>,
    root,
  );
}
