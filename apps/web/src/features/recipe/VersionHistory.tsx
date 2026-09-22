// Version history (§9, stage-5 requirements 3-7).
//
// Three states, and the middle one is the point:
//
//   list    the versions, newest first, each with when it was taken, what
//           changed, and what the recipe was at that moment
//   viewing a previous version, in full, BEFORE any restore. Requirement 5.
//           §9 also asks for a diff screen between two arbitrary recipes; that
//           is not built, and the report says so.
//   restoring with a confirmation that states what happens to the present.
//
// The restore confirmation says "הגרסה הנוכחית תישמר בהיסטוריה" because that is
// the part people do not expect: §9 makes a restore non-destructive, so a
// mistaken restore is itself undoable. Saying so is what makes the button safe
// to press.

import { useState } from 'react';
import {
  compute,
  formatGrams,
  formatNis,
  unitLabel,
  type MeasurementPrefs,
  type Recipe,
} from '@recipe-notebook/engine';
import type { StoredVersion } from '../../data/repository.js';
import { calcState } from './completeness.js';
import { versionSummary } from './versionDiff.js';
import { VersionCompare, type CompareSide } from './VersionCompare.js';
import { versionLabel } from './versionLabel.js';
import styles from './recipe.module.css';

/** A timestamp as "12.03.2026, 14:20" — LTR, because it is a number. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function VersionHistory({
  versions,
  recipe,
  recipes,
  prefs,
  canRestore,
  lockedReason,
  busyId,
  error,
  onRestore,
}: {
  versions: readonly StoredVersion[];
  /** the live recipe, shown as "נוכחית" at the top of the timeline */
  recipe: Recipe;
  recipes: readonly Recipe[];
  prefs: MeasurementPrefs;
  canRestore: boolean;
  /** why restore is unavailable, when it is */
  lockedReason: string | null;
  busyId: string | null;
  error: string | null;
  onRestore(version: StoredVersion): void;
}) {
  const [viewing, setViewing] = useState<StoredVersion | null>(null);
  const [confirming, setConfirming] = useState<StoredVersion | null>(null);
  // Stage-6 requirement 7: any two versions of this recipe, not just a version
  // against the live one. `null` = the comparison is closed; the two sides are
  // remembered so reopening lands where the reader left off.
  const [comparing, setComparing] = useState<{ from: CompareSide; to: CompareSide } | null>(
    null,
  );

  // §9: the timeline reads V1…Vn plus "נוכחית". The live recipe's own label is
  // one past the highest stored tag.
  const currentTag = `V${versions.length + 1}`;

  return (
    <section className={styles.card} aria-label="היסטוריית גרסאות">
      <h2 className={styles.cardTitle}>גרסאות</h2>

      {error && (
        <p className={styles.versionError} role="alert">
          {error}
        </p>
      )}

      {lockedReason && (
        <p className={styles.versionLocked} role="status">
          {lockedReason}
        </p>
      )}

      <ol className={styles.versionList}>
        <li className={styles.versionCurrent}>
          <div className={styles.versionHead}>
            <span className={styles.versionTag}>{versionLabel(currentTag)}</span>
            <span className={styles.versionNow}>נוכחית</span>
          </div>
          <p className={styles.versionMeta}>
            {versionSummary(recipe, recipes, prefs)}
          </p>
        </li>

        {versions.map((v) => (
          <li key={v.id} className={styles.versionItem}>
            <div className={styles.versionHead}>
              <span className={styles.versionTag}>{versionLabel(v.tag)}</span>
              <span className={`${styles.versionWhen} ltr`}>{when(v.createdAt)}</span>
            </div>
            {/* requirement 4: enough to identify the version. `what` says what
                changed; the summary says what the recipe WAS, which is what
                tells you whether this is the one you want back. */}
            <p className={styles.versionWhat}>{v.what || 'שינויים קלים'}</p>
            <p className={styles.versionMeta}>
              {v.snapshot['snapshotUnavailable'] === true
                ? 'ל-snapshot הזה אין תוכן, ולכן אי אפשר לצפות בו או לשחזר אותו.'
                : versionSummary(v.snapshot, recipes, prefs)}
            </p>
            <div className={styles.versionActions}>
              <button
                type="button"
                className={styles.versionBtn}
                onClick={() => setViewing(v)}
                disabled={v.snapshot['snapshotUnavailable'] === true}
                aria-label={`צפייה ב${versionLabel(v.tag)}`}
              >
                צפייה
              </button>
              <button
                type="button"
                className={styles.versionBtn}
                onClick={() => setComparing({ from: v.id, to: 'current' })}
                disabled={v.snapshot['snapshotUnavailable'] === true}
                aria-label={`השוואת ${versionLabel(v.tag)} לגרסה הנוכחית`}
              >
                השוואה
              </button>
              <button
                type="button"
                className={styles.versionBtn}
                onClick={() => setConfirming(v)}
                disabled={
                  !canRestore ||
                  busyId !== null ||
                  v.snapshot['snapshotUnavailable'] === true
                }
                aria-label={`שחזור ${versionLabel(v.tag)}`}
              >
                {busyId === v.id ? 'משחזר…' : 'שחזור'}
              </button>
            </div>

            {confirming?.id === v.id && (
              <div
                className={styles.versionConfirm}
                role="alertdialog"
                aria-label={`אישור שחזור ${versionLabel(v.tag)}`}
              >
                <p className={styles.versionConfirmTitle}>לשחזר את {versionLabel(v.tag)}?</p>
                <p className={styles.versionConfirmBody}>
                  הגרסה הנוכחית תישמר בהיסטוריה לפני השחזור, כך שאפשר יהיה לבטל
                  גם את השחזור הזה. שום גרסה לא נמחקת.
                </p>
                <div className={styles.versionConfirmActions}>
                  <button
                    type="button"
                    className={styles.versionBtnPrimary}
                    onClick={() => {
                      setConfirming(null);
                      onRestore(v);
                    }}
                    aria-label={`אישור שחזור ${versionLabel(v.tag)}`}
                  >
                    כן, לשחזר
                  </button>
                  <button
                    type="button"
                    className={styles.versionBtn}
                    onClick={() => setConfirming(null)}
                    aria-label="ביטול השחזור"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      {versions.length === 0 && (
        <p className={styles.versionEmpty}>
          אין עוד היסטוריה. כל שמירה של המתכון הזה תשמור קודם את המצב שלפניה,
          כך שתמיד אפשר לחזור אחורה.
        </p>
      )}

      {/*
        Requirement 7 asks for ANY two versions, which the per-version
        "compare with current" button above does not give: comparing V2 with V4
        is a different question, and the one a baker asks when a formula drifted
        over several saves. This opens the same screen with both sides free.
        It needs two versions to be worth offering — with one, the only
        comparison available is the one the row already offers.
      */}
      {versions.length >= 2 && (
        <button
          type="button"
          className={styles.versionCompareAll}
          onClick={() =>
            setComparing({ from: versions[0]!.id, to: 'current' })
          }
          aria-label="השוואה בין שתי גרסאות"
        >
          השוואה בין שתי גרסאות
        </button>
      )}

      {comparing && (
        <VersionCompare
          recipe={recipe}
          versions={versions}
          recipes={recipes}
          prefs={prefs}
          initialFrom={comparing.from}
          initialTo={comparing.to}
          onClose={() => setComparing(null)}
        />
      )}

      {viewing && (
        <VersionViewer
          version={viewing}
          recipes={recipes}
          prefs={prefs}
          canRestore={canRestore}
          onClose={() => setViewing(null)}
          onRestore={() => {
            setViewing(null);
            setConfirming(viewing);
          }}
        />
      )}
    </section>
  );
}

/**
 * A previous version, in full, before any decision (requirement 5).
 *
 * It runs the SAME `compute()` and `calcState()` the live recipe page runs, on
 * the snapshot. So the figures here are what the recipe really produced then —
 * including a partial or non-computable state, which is worth seeing: a version
 * may be the one where a density was still missing.
 */
function VersionViewer({
  version,
  recipes,
  prefs,
  canRestore,
  onClose,
  onRestore,
}: {
  version: StoredVersion;
  recipes: readonly Recipe[];
  prefs: MeasurementPrefs;
  canRestore: boolean;
  onClose(): void;
  onRestore(): void;
}) {
  const snapshot = version.snapshot;
  // The snapshot is computed against the CURRENT notebook, because a
  // sub-recipe it references may itself have changed since. That is the honest
  // answer to "what would this version produce if I restored it now", which is
  // the question being asked.
  const computed = compute(snapshot, recipes, { prefs });
  const calc = calcState(computed);
  const pro = prefs.pro === true;

  return (
    <div
      className={styles.sheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={versionLabel(version.tag)}
    >
      <div className={styles.sheet}>
        <header className={styles.sheetHead}>
          <div>
            <h2 className={styles.sheetTitle}>{versionLabel(version.tag)}</h2>
            <p className={styles.sheetName}>{snapshot.name || '(בלי שם)'}</p>
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

        <p className={styles.versionViewerNote}>
          <span className="ltr">{when(version.createdAt)}</span> ·{' '}
          {version.what || 'שינויים קלים'}
        </p>

        <h3 className={styles.sheetSub}>רכיבים</h3>
        <ul className={styles.versionIngList} aria-label={`רכיבי ${versionLabel(version.tag)}`}>
          {(snapshot.ingredients ?? []).map((ing, i) => {
            const row = computed.rows.find((r) => r.ing.id === ing.id);
            const written = `${ing.qty ?? ''} ${unitLabel(ing.unit)}`.trim();
            const grams = row && row.g !== null ? formatGrams(row.g) : null;
            // Same rule as the recipe page: the resolved-grams hint is only
            // worth showing when it adds something. For a row already written
            // in grams it would just repeat the line.
            const hint = grams !== null && grams !== written ? grams : null;
            return (
              <li key={ing.id ?? i} className={styles.versionIngRow}>
                <span className={styles.versionIngName}>{ing.name}</span>
                <span className={`${styles.versionIngQty} ltr`}>
                  {written}
                  {hint !== null && (
                    <span className={styles.versionIngGrams}>{hint}</span>
                  )}
                  {row && row.g === null && (
                    <span className={styles.versionIngMissing}>—</span>
                  )}
                </span>
              </li>
            );
          })}
          {(snapshot.ingredients ?? []).length === 0 && (
            <li className={styles.versionEmpty}>לגרסה הזאת אין רכיבים.</li>
          )}
        </ul>

        {(snapshot.steps ?? []).length > 0 && (
          <>
            <h3 className={styles.sheetSub}>אופן ההכנה</h3>
            <ol className={styles.versionSteps}>
              {(snapshot.steps ?? []).map((s, i) => (
                <li key={s.id ?? i}>
                  {i + 1}. {s.text}
                </li>
              ))}
            </ol>
          </>
        )}

        <h3 className={styles.sheetSub}>מה זה היה מייצר</h3>
        {calc.level !== 'full' && (
          <p
            className={
              calc.level === 'none' ? styles.calcNoneBox : styles.calcPartialBox
            }
            role="status"
            aria-label={`שלמות החישוב של ${versionLabel(version.tag)}`}
          >
            {calc.summary}
          </p>
        )}
        <dl className={styles.factRows}>
          <div className={styles.factRow}>
            <dt>סך המשקל</dt>
            <dd className="ltr">
              {calc.level === 'none' ? '—' : formatGrams(computed.totalG)}
            </dd>
          </div>
          {pro && (
            <div className={styles.factRow}>
              <dt>עלות חומרי גלם</dt>
              <dd className="ltr">
                {calc.level === 'none' || calc.costLevel === 'none'
                  ? '—'
                  : formatNis(computed.cost)}
              </dd>
            </div>
          )}
        </dl>

        <button
          type="button"
          className={styles.calibrateBtn}
          onClick={onRestore}
          disabled={!canRestore}
          aria-label={`שחזור ${versionLabel(version.tag)}`}
        >
          שחזור הגרסה הזאת
        </button>
      </div>
    </div>
  );
}
