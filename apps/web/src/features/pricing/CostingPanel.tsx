// The business side of a recipe: what it costs in full, and what it earns.
//
// Requirements E, F and G, in one panel, and every figure is either a number
// or a dash with a reason. The three things it is careful to say out loud:
//
//   · WHICH PARTS OF THE COST NOBODY ENTERED. A total that silently omits
//     packaging looks complete. This one names what is missing.
//   · MARGIN AND MARKUP ARE DIFFERENT NUMBERS. Both appear, each labelled,
//     never the one under the other's name.
//   · A TARGET PRICE IS A TARGET PRICE. It is labelled "מחיר מחושב לפי יעד",
//     never "the right price" — the market decides that, and this panel has
//     never met the market.

import { formatNis } from '@recipe-notebook/engine';
import type { CostBreakdown, Profitability, TargetPrice } from './profitability.js';
import styles from './CostingPanel.module.css';

const money = (v: number | null): string => (v === null ? '—' : formatNis(v));
const pct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`);

export interface CostingPanelProps {
  breakdown: CostBreakdown;
  profit: Profitability;
  target: TargetPrice;
}

export function CostingPanel({ breakdown, profit, target }: CostingPanelProps) {
  const unitFigures = profit.units !== null;

  return (
    <section className={styles.panel} aria-label="עלות ורווחיות">
      <h3 className={styles.title}>עלות מלאה ורווחיות</h3>

      {/* ── requirement E: the cost, in its parts ───────────────────────── */}
      <dl className={styles.grid} aria-label="פירוט העלות">
        <div className={styles.row}>
          <dt>חומרי גלם</dt>
          <dd className="ltr">{money(breakdown.ingredients)}</dd>
        </div>
        <div className={styles.row}>
          <dt>אריזה</dt>
          <dd className="ltr">{money(breakdown.packaging)}</dd>
        </div>
        <div className={styles.row}>
          <dt>עבודה</dt>
          <dd className="ltr">{money(breakdown.labor)}</dd>
        </div>
        <div className={styles.row}>
          <dt>עלויות נוספות</dt>
          <dd className="ltr">{money(breakdown.other)}</dd>
        </div>
        <div className={`${styles.row} ${styles.headline}`}>
          <dt>עלות כוללת</dt>
          <dd className="ltr" aria-label="עלות כוללת">
            {money(breakdown.total)}
          </dd>
        </div>
      </dl>

      {/*
        The total is a sum of what was ENTERED. Saying so is the difference
        between a cost and a guess dressed as a cost — and nothing here
        invents a rent, an electricity bill or an overhead rate, because
        there is no model for them.
      */}
      {breakdown.notEntered.length > 0 && (
        <p className={styles.note} aria-label="מה לא הוזן בעלות">
          {`לא הוזנו: ${breakdown.notEntered.join(' · ')}. העלות הכוללת מסכמת רק את מה שהוזן — ` +
            'שדה ריק אינו אפס.'}
        </p>
      )}

      {/* ── requirement F: the sale side ────────────────────────────────── */}
      <dl className={styles.grid} aria-label="רווחיות">
        <div className={styles.row}>
          <dt>{profit.basis === 'unit' ? 'מחיר מכירה ליחידה' : 'מחיר מכירה למתכון'}</dt>
          <dd className="ltr">{money(profit.salePrice)}</dd>
        </div>
        <div className={styles.row}>
          <dt>רווח</dt>
          <dd className="ltr" aria-label="רווח">
            {money(profit.profit)}
          </dd>
        </div>
        <div className={`${styles.row} ${styles.headline}`}>
          <dt>רווח גולמי %</dt>
          <dd className="ltr" aria-label="רווח גולמי אחוז">
            {pct(profit.grossMargin)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>פוד קוסט %</dt>
          <dd className="ltr" aria-label="פוד קוסט אחוז מהרווחיות">
            {pct(profit.foodCostPct)}
          </dd>
        </div>
        <div className={styles.row}>
          {/*
            Its own name, deliberately. A ₪100 item costing ₪40 has a 60%
            margin and a 150% markup; presenting either as the other is the
            most expensive arithmetic mistake in this whole screen.
          */}
          <dt>תוספת על העלות (רווח חלקי עלות)</dt>
          <dd className="ltr" aria-label="מארקאפ אחוז">
            {pct(profit.markup)}
          </dd>
        </div>
      </dl>

      {unitFigures && (
        <dl className={styles.grid} aria-label="לפי יחידה">
          <div className={styles.row}>
            <dt>עלות ליחידה</dt>
            <dd className="ltr">{money(profit.costPerUnit)}</dd>
          </div>
          <div className={styles.row}>
            <dt>מחיר מכירה ליחידה</dt>
            <dd className="ltr">{money(profit.unitSalePrice)}</dd>
          </div>
          <div className={styles.row}>
            <dt>רווח ליחידה</dt>
            <dd className="ltr" aria-label="רווח ליחידה">
              {money(profit.profitPerUnit)}
            </dd>
          </div>
        </dl>
      )}

      {profit.why && (
        <p className={styles.why} role="status" aria-label="למה אין רווחיות">
          {profit.why}
        </p>
      )}

      {/* ── requirement G: what a target implies ────────────────────────── */}
      {(target.fromFoodCost !== null || target.fromMargin !== null || target.why) && (
        <div className={styles.targets} aria-label="מחיר מחושב לפי יעד">
          <h4 className={styles.subTitle}>מחיר מחושב לפי יעד</h4>
          <dl className={styles.grid}>
            <div className={styles.row}>
              <dt>{target.targetFC !== null && target.targetFC > 0 ? `לפי יעד פוד קוסט ${target.targetFC}%` : 'לפי יעד פוד קוסט (לא הוגדר יעד)'}</dt>
              <dd className="ltr" aria-label="מחיר מחושב לפי יעד פוד קוסט">
                {money(target.fromFoodCost)}
              </dd>
            </div>
            {unitFigures && target.fromFoodCostPerUnit !== null && (
              <div className={styles.row}>
                <dt>לפי יעד פוד קוסט, ליחידה</dt>
                <dd className="ltr">{money(target.fromFoodCostPerUnit)}</dd>
              </div>
            )}
            <div className={styles.row}>
              <dt>{target.targetGM !== null && target.targetGM > 0 ? `לפי יעד רווח גולמי ${target.targetGM}%` : 'לפי יעד רווח גולמי (לא הוגדר יעד)'}</dt>
              <dd className="ltr" aria-label="מחיר מחושב לפי יעד רווח גולמי">
                {money(target.fromMargin)}
              </dd>
            </div>
            {unitFigures && target.fromMarginPerUnit !== null && (
              <div className={styles.row}>
                <dt>לפי יעד רווח גולמי, ליחידה</dt>
                <dd className="ltr">{money(target.fromMarginPerUnit)}</dd>
              </div>
            )}
          </dl>
          <p className={styles.note}>
            אלה מחירים שמתאימים ליעדים שהוגדרו, ולא &quot;המחיר הנכון&quot;. היעד
            לפוד קוסט מחושב מעלות חומרי הגלם, והיעד לרווח גולמי מהעלות הכוללת.
          </p>
          {target.why && (
            <p className={styles.why} role="status" aria-label="למה אין מחיר לפי יעד">
              {target.why}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
