// §7 — "התבנית שלי", on the recipe page.
//
// The pan geometry, the arithmetic and the 2% threshold all live in the engine
// (`pan.ts`); this file is the screen and nothing else. What it must get right
// is the sentence §7 dictates and the rule behind it: **adapting is a
// calculation, not an edit.** Pressing "התאמה" puts the page into weight
// scaling at the adapted yield. It does not touch the stored recipe, exactly
// like every other scaling control on this screen.
//
// The honest cases, which are most of them in practice:
//   · the recipe never recorded a pan          → say so, and offer nothing
//   · the recipe's pan has no dimensions       → say which is missing
//   · the user has not described their pan yet  → the picker, and no number
//   · the two pans are within 2%                → say they match; no suggestion
//
// A factor is never invented. `panFactor` returns null when either side is
// unknown, and null means no sentence, not "×1".

import { useState } from 'react';
import {
  GN_SIZES,
  PAN_KINDS,
  formatGrams,
  panFactor,
  panLabel,
  panWorthAdapting,
  type Pan,
} from '@recipe-notebook/engine';
import { emptyPan, panFromDraft, type PanDraft } from './draft.js';
import styles from './recipe.module.css';

export interface PanCardProps {
  /** the pan the recipe is written for, as stored */
  recipePan: Pan | null | undefined;
  /** the recipe's yield at factor 1, in grams, for the adapted target */
  baselineYield: number;
  /** puts the page into weight scaling at this many grams */
  onAdapt(targetGrams: number): void;
}

export function PanCard({ recipePan, baselineYield, onAdapt }: PanCardProps) {
  const [mine, setMine] = useState<PanDraft>(emptyPan);

  const myPan = panFromDraft(mine);
  const recipeLabel = panLabel(recipePan);
  const comparison = panFactor(recipePan, myPan);
  const fields: readonly string[] =
    PAN_KINDS.find((k) => k.id === mine.kind)?.fields ?? [];

  // A recipe with no pan at all has nothing to compare against, and a picker
  // for "my pan" would be a control with no purpose. §17: never render a
  // control that cannot do anything.
  if (!recipePan || recipePan.kind === 'none') {
    return (
      <section className={styles.card} aria-label="תבנית">
        <h2 className={styles.cardTitle}>תבנית</h2>
        <p className={styles.panNote}>
          {recipePan?.kind === 'none'
            ? 'המתכון מסומן כמתכון בלי תבנית.'
            : 'לא נרשמה תבנית למתכון הזה. אחרי שתירשם תבנית בעריכה, אפשר יהיה להשוות אותה לתבנית שלכם ולהתאים כמויות.'}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="תבנית">
      <h2 className={styles.cardTitle}>תבנית</h2>

      <p className={styles.panNote}>
        התבנית של המתכון:{' '}
        <strong className="ltr">
          {recipeLabel || 'נרשם סוג בלי מידות'}
        </strong>
      </p>

      {!recipeLabel && (
        <p className={styles.panWhy}>
          למתכון נרשם סוג תבנית בלי מידות, ולכן אי אפשר להשוות. אפשר להשלים את
          המידות בעריכת המתכון.
        </p>
      )}

      <div className={styles.panPicker}>
        <label className={styles.panLabel} htmlFor="pan-mine-kind">
          התבנית שלי
        </label>
        <select
          id="pan-mine-kind"
          className={styles.panSelect}
          value={mine.kind}
          onChange={(e) =>
            setMine({ ...emptyPan(), kind: e.target.value as PanDraft['kind'] })
          }
        >
          <option value="">— בחירה —</option>
          {PAN_KINDS.filter((k) => k.id !== 'none').map((k) => (
            <option key={k.id} value={k.id}>
              {k.he}
            </option>
          ))}
        </select>

        {fields.includes('diameter') && (
          <PanNum
            id="pan-mine-d"
            label='קוטר, ס"מ'
            value={mine.diameter}
            onChange={(v) => setMine({ ...mine, diameter: v })}
          />
        )}
        {fields.includes('width') && (
          <PanNum
            id="pan-mine-w"
            label='רוחב, ס"מ'
            value={mine.width}
            onChange={(v) => setMine({ ...mine, width: v })}
          />
        )}
        {fields.includes('length') && (
          <PanNum
            id="pan-mine-l"
            label='אורך, ס"מ'
            value={mine.length}
            onChange={(v) => setMine({ ...mine, length: v })}
          />
        )}
        {fields.includes('gn') && (
          <div className={styles.panField}>
            <label className={styles.panLabel} htmlFor="pan-mine-gn">
              מידת GN
            </label>
            <select
              id="pan-mine-gn"
              className={styles.panSelect}
              value={mine.gn}
              onChange={(e) => setMine({ ...mine, gn: e.target.value })}
            >
              <option value="">— בחירה —</option>
              {GN_SIZES.map((g) => (
                <option key={g} value={g}>
                  GN {g}
                </option>
              ))}
            </select>
          </div>
        )}
        {fields.includes('cavities') && (
          <PanNum
            id="pan-mine-cav"
            label="מספר שקעים"
            value={mine.cavities}
            onChange={(v) => setMine({ ...mine, cavities: v })}
          />
        )}
        {fields.includes('height') && (
          <PanNum
            id="pan-mine-h"
            label='גובה, ס"מ'
            value={mine.height}
            onChange={(v) => setMine({ ...mine, height: v })}
          />
        )}
      </div>

      {/* The one sentence §7 specifies, and only when there is a number. */}
      {comparison === null ? (
        <p className={styles.panWhy}>
          {mine.kind === ''
            ? 'אחרי בחירת התבנית שלכם והמידות שלה תופיע כאן ההמלצה.'
            : 'חסרות מידות לתבנית שלכם, ולכן אין עוד מה להשוות.'}
        </p>
      ) : panWorthAdapting(comparison) ? (
        <>
          <p className={styles.panSuggest}>
            התבנית שלכם{' '}
            {comparison.factor > 1 ? 'גדולה' : 'קטנה'} פי{' '}
            <span className="ltr">
              {(comparison.factor > 1
                ? comparison.factor
                : 1 / comparison.factor
              ).toFixed(2)}
            </span>{' '}
            {comparison.byVolume ? 'בנפח' : 'בשטח'}. מומלץ{' '}
            {comparison.factor > 1 ? 'להכפיל' : 'להקטין'} את כל הכמויות במקדם
            הזה.
          </p>
          <button
            type="button"
            className={styles.panAdapt}
            onClick={() => onAdapt(baselineYield * comparison.factor)}
          >
            התאמה
          </button>
          <p className={styles.panWhy}>
            ההתאמה היא חישוב בלבד: היא מעבירה את המסך לשינוי כמויות לפי משקל של{' '}
            <span className="ltr">{formatGrams(baselineYield * comparison.factor)}</span>.
            המתכון השמור אינו משתנה.
            {!comparison.byVolume &&
              ' ההשוואה לפי שטח בלבד, כי לא נרשם גובה לשתי התבניות.'}
          </p>
        </>
      ) : (
        <p className={styles.panNote}>
          התבניות זהות בפועל, בפחות משני אחוזים. אין צורך להתאים כמויות.
        </p>
      )}
    </section>
  );
}

function PanNum({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <div className={styles.panField}>
      <label className={styles.panLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`${styles.panInput} ltr`}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
