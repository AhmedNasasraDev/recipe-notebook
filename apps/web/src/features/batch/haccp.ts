/**
 * §13a — the HACCP status of a production batch.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * The status is DERIVED and never stored. There is no field anywhere that says
 * "this batch was fine": the answer is recomputed from the control points that
 * were actually ticked and from the chill temperature that was actually
 * measured. So a batch cannot be marked compliant without the record behind
 * it — not through the UI, not through the database, not by an import.
 *
 * WHAT AN EMPTY FIELD MEANS HERE
 *
 * A blank chill temperature is NOT a breach. It is a measurement that was not
 * taken, which is a different and less alarming thing, and calling it a breach
 * would teach people to type a number to clear a red chip. 0°C, on the other
 * hand, IS a measurement — and a good one. This is the project's null ≠ 0 rule
 * in the place where getting it wrong costs the most.
 *
 * A batch recorded before the control points existed has no `ccp` at all. It
 * reads as zero ticks and shows "לא תועד" — not as compliant.
 */

import type { Batch, Recipe } from '@recipe-notebook/engine';

export interface ControlPoint {
  id: string;
  label: string;
  /** the limit the tick is a claim about — shown next to it, never abbreviated away */
  limit: string;
}

/** §13a, verbatim from the spec's four control points. */
export const CONTROL_POINTS: readonly ControlPoint[] = [
  {
    id: 'core',
    label: 'טמפ׳ ליבה נמדדה ותועדה',
    limit: 'מעל 75°C באפייה, או לפי הנוהל של המוצר',
  },
  {
    id: 'chill',
    label: 'קירור מהיר הושלם',
    limit: 'מתחת ל־5°C בתוך 4 שעות מסוף האפייה',
  },
  {
    id: 'clean',
    label: 'משטחים וכלים נוקו לפני העבודה',
    limit: 'לפי נוהל הניקיון של המטבח',
  },
  {
    id: 'alrg',
    label: 'הפרדת אלרגנים נשמרה',
    limit: 'כלים נפרדים או ניקוי מלא בין מוצרים',
  },
];

/** The chill limit, in °C. Above this is a cold-chain breach. */
export const CHILL_LIMIT_C = 5;

export type HaccpLevel = 'ok' | 'breach' | 'partial' | 'none';

export interface HaccpStatus {
  level: HaccpLevel;
  /** how many of the control points were ticked */
  done: number;
  total: number;
  label: string;
  /** set only for a breach: what exactly was out of limits */
  breach: string | null;
}

/**
 * Was a chill temperature actually measured? An empty string, null, undefined
 * and a non-number are all "not measured". `0` is measured.
 */
function measured(v: number | string | undefined | null): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function haccpOf(batch: Batch): HaccpStatus {
  const ticks = batch.ccp ?? {};
  const done = CONTROL_POINTS.filter((c) => ticks[c.id] === true).length;
  const total = CONTROL_POINTS.length;

  const chill = measured(batch.chillTemp);
  const chillBreach = chill !== null && chill > CHILL_LIMIT_C;

  if (chillBreach) {
    return {
      level: 'breach',
      done,
      total,
      label: 'חריגה',
      // Named rather than hinted at: "חריגה" on its own sends someone looking
      // through four control points for a problem that is in none of them.
      breach: `טמפרטורת הקירור ${String(chill)}°C — מעל ${String(CHILL_LIMIT_C)}°C. לבדוק את שרשרת הקור.`,
    };
  }
  if (done === total) {
    return { level: 'ok', done, total, label: 'HACCP תקין', breach: null };
  }
  if (done === 0) {
    return { level: 'none', done, total, label: 'לא תועד', breach: null };
  }
  return { level: 'partial', done, total, label: 'חלקי', breach: null };
}

/**
 * The batch a label should speak for: the LAST one recorded.
 *
 * §13a's edge case — "אצווה נמחקת והיא הייתה האחרונה → התווית חוזרת לאצווה
 * שלפניה, או לשום סטטוס" — is satisfied by deriving this on every render
 * instead of remembering which batch the label was printed from.
 */
export function lastBatch(recipe: Recipe): Batch | null {
  const list = recipe.batches ?? [];
  return list.length > 0 ? (list[list.length - 1] ?? null) : null;
}

/** §13a: what the label says next to the status. Informative, never a block. */
export function labelHaccpNote(status: HaccpStatus): string {
  return status.level === 'ok'
    ? 'כל נקודות הבקרה תועדו לאצווה הזאת'
    : 'לפני הדפסה יש להשלים את התיעוד במעקב האצווה';
}
