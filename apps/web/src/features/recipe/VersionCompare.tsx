// Comparing two arbitrary versions of one recipe (stage-6 requirements 7-13).
//
// The comparison itself is not here. `compareRecipes()` in versionDiff.ts does
// the work and is the single source of truth — the same function whose summary
// becomes §9's one-line description, so the line stored with a version and this
// screen can never disagree about the same two states. This file only decides
// how the result is read.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. `null` is not `0`, and "no price" is not "price 0" (requirements 11, 12).
//    `formatCell` is the only place a value becomes text, and it renders an
//    absent value as an em dash with an explicit accessible label rather than
//    as an empty cell — an empty cell next to a 0 reads as the same thing.
//
// 2. Two legitimately duplicated ingredients stay two rows (requirement 10).
//    That comes free from `compareRecipes`, which keys rows by identity AND
//    occurrence; what is added here is showing the occurrence number when there
//    is more than one row of the same name, so the reader can tell which is
//    which instead of seeing "מים" twice with no way to distinguish them.
//
// 3. It has to be readable on a phone (requirement 13). A side-by-side table
//    with two value columns does not fit 402px, so each change is one block
//    with the two values stacked and an arrow between them, and the block
//    becomes a row on a wider frame. No horizontal scrolling and no truncation
//    of a recipe name, because a name the reader cannot finish is not an
//    identification.

import { useMemo, useState } from 'react';
import { type MeasurementPrefs, type Recipe } from '@recipe-notebook/engine';
import type { StoredVersion } from '../../data/repository.js';
import { compareRecipes, type CellValue, type FieldChange } from './versionDiff.js';
import { versionLabel } from './versionLabel.js';
import styles from './recipe.module.css';

/**
 * One side of the comparison: the literal `CURRENT` for the live recipe, or a
 * version id.
 *
 * Written as `string` rather than `'current' | string`, which TypeScript
 * collapses to `string` anyway — the union looked like it documented the
 * special value while giving no checking at all. The constant below is the
 * documentation, and it is the one thing callers should compare against.
 */
export type CompareSide = string;

/** The live recipe, as a `CompareSide`. */
export const CURRENT: CompareSide = 'current';

export interface CompareChoice {
  value: CompareSide;
  label: string;
  /** what this state was, for the picker */
  when: string;
}

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * One value, as text.
 *
 * An absent value is an em dash and NOT an empty string: rendering it empty
 * would make "no price" and "price 0" look like the same cell, which is the one
 * thing this comparison must never do.
 */
export function formatCell(v: CellValue): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  return String(v);
}

/** The spoken version, because "—" is not read aloud usefully. */
function cellLabel(v: CellValue): string {
  if (v === null) return 'ריק';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  return String(v);
}

function ChangeRow({ change }: { change: FieldChange }) {
  return (
    <li
      className={styles.cmpChange}
      /*
        The whole row is ONE announcement. Split across three labelled spans it
        came out as "מחיר", "ריק", "0" — three fragments a listener has to
        reassemble, with an arrow that is decoration and a dash that is not a
        word. `cellLabel` spells an absent value as "ריק" so that the
        requirement-12 distinction (no price vs price 0) is audible and not only
        visible.
      */
      aria-label={`${change.label}, לפני ${cellLabel(change.before)}, אחרי ${cellLabel(change.after)}`}
    >
      <span className={styles.cmpLabel}>{change.label}</span>
      {/*
        Words, not an arrow. "4 ← —" in a right-to-left line does not say
        which side is earlier (QA 22.09.2026, acceptance finding 7); "לפני"
        and "אחרי" do, in any direction.
      */}
      <span className={styles.cmpValues}>
        <span className={styles.cmpBefore}>
          <span className={styles.cmpWord}>לפני</span> {formatCell(change.before)}
        </span>
        <span className={styles.cmpAfter}>
          <span className={styles.cmpWord}>אחרי</span> {formatCell(change.after)}
        </span>
      </span>
    </li>
  );
}

export interface VersionCompareProps {
  recipe: Recipe;
  versions: readonly StoredVersion[];
  recipes: readonly Recipe[];
  prefs: MeasurementPrefs;
  /** preselected left-hand side */
  initialFrom?: CompareSide;
  initialTo?: CompareSide;
  onClose(): void;
}

export function VersionCompare({
  recipe,
  versions,
  recipes,
  prefs,
  initialFrom,
  initialTo,
  onClose,
}: VersionCompareProps) {
  // Oldest to newest, then the live recipe last: a comparison reads naturally
  // as "what happened between the earlier one and the later one".
  const choices: CompareChoice[] = useMemo(
    () => [
      ...versions.map((v) => ({
        value: v.id as CompareSide,
        label: versionLabel(v.tag),
        when: when(v.createdAt),
      })),
      { value: 'current' as CompareSide, label: 'גרסה נוכחית', when: '' },
    ],
    [versions],
  );

  const oldest = versions[0]?.id ?? 'current';
  const [from, setFrom] = useState<CompareSide>(initialFrom ?? oldest);
  const [to, setTo] = useState<CompareSide>(initialTo ?? 'current');

  const stateOf = (side: CompareSide): Recipe | null => {
    if (side === 'current') return recipe;
    return versions.find((v) => v.id === side)?.snapshot ?? null;
  };
  const labelOf = (side: CompareSide): string =>
    choices.find((c) => c.value === side)?.label ?? '';

  const a = stateOf(from);
  const b = stateOf(to);

  const result = useMemo(
    () => (a && b ? compareRecipes({ before: a, after: b, recipes, prefs }) : null),
    [a, b, recipes, prefs],
  );

  // A snapshot with no content cannot be compared, and saying so is better
  // than rendering "everything was removed".
  const unusable =
    (a as { snapshotUnavailable?: boolean } | null)?.snapshotUnavailable === true ||
    (b as { snapshotUnavailable?: boolean } | null)?.snapshotUnavailable === true;

  const nothing =
    result !== null &&
    result.fields.length === 0 &&
    result.added.length === 0 &&
    result.removed.length === 0 &&
    result.changed.length === 0 &&
    result.steps.before === result.steps.after;

  /** Shows the occurrence number only when it disambiguates something. */
  const nameOf = (key: string, name: string, all: readonly { key: string; name: string }[]) => {
    const n = Number(key.split('#')[1] ?? '1');
    const siblings = all.filter((r) => r.name === name).length;
    return siblings > 1 || n > 1 ? `${name} (${n})` : name;
  };

  const allRows = result
    ? [...result.added, ...result.removed, ...result.changed]
    : [];

  return (
    <div
      className={styles.sheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="השוואת גרסאות"
    >
      <div className={styles.sheet}>
        <header className={styles.sheetHead}>
          <div>
            <h2 className={styles.sheetTitle}>השוואת גרסאות</h2>
            <p className={styles.sheetName}>{recipe.name || '(בלי שם)'}</p>
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

        <div className={styles.cmpPickers}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cmp-from">
              מגרסה
            </label>
            <select
              id="cmp-from"
              className={styles.select}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="הגרסה להשוואה מצד אחד"
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                  {c.when ? ` — ${c.when}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cmp-to">
              לגרסה
            </label>
            <select
              id="cmp-to"
              className={styles.select}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="הגרסה להשוואה מצד שני"
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                  {c.when ? ` — ${c.when}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className={styles.cmpHeading} role="status">
          מ{labelOf(from)} ל{labelOf(to)}
        </p>

        {from === to ? (
          <p className={styles.cmpEmpty}>
            אותה גרסה נבחרה בשני הצדדים. יש לבחור שתי גרסאות שונות.
          </p>
        ) : unusable ? (
          <p className={styles.cmpEmpty}>
            לאחת הגרסאות שנבחרו אין תוכן שמור, ולכן אי אפשר להשוות אותה.
          </p>
        ) : nothing ? (
          <p className={styles.cmpEmpty}>
            אין הבדל בין שתי הגרסאות האלה בשדות וברכיבים שנבדקים.
          </p>
        ) : (
          result && (
            <>
              <p className={styles.cmpSummary}>{result.summary}</p>

              {result.fields.length > 0 && (
                <section aria-label="שדות שהשתנו">
                  <h3 className={styles.sheetSub}>שדות המתכון</h3>
                  <ul className={styles.cmpList}>
                    {result.fields.map((f) => (
                      <ChangeRow key={f.key} change={f} />
                    ))}
                  </ul>
                </section>
              )}

              {result.added.length > 0 && (
                <section aria-label="רכיבים שנוספו">
                  <h3 className={styles.sheetSub}>רכיבים שנוספו</h3>
                  <ul className={styles.cmpList}>
                    {result.added.map((r) => (
                      <li key={r.key} className={styles.cmpAdded}>
                        <span className={styles.cmpLabel}>{nameOf(r.key, r.name, allRows)}</span>
                        <span className={`${styles.cmpValues} ltr`}>{r.written}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {result.removed.length > 0 && (
                <section aria-label="רכיבים שהוסרו">
                  <h3 className={styles.sheetSub}>רכיבים שהוסרו</h3>
                  <ul className={styles.cmpList}>
                    {result.removed.map((r) => (
                      <li key={r.key} className={styles.cmpRemoved}>
                        <span className={styles.cmpLabel}>{nameOf(r.key, r.name, allRows)}</span>
                        <span className={`${styles.cmpValues} ltr`}>{r.written}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {result.changed.length > 0 && (
                <section aria-label="רכיבים שהשתנו">
                  <h3 className={styles.sheetSub}>רכיבים שהשתנו</h3>
                  {result.changed.map((r) => (
                    <div key={r.key} className={styles.cmpIngBlock}>
                      <h4
                        className={styles.cmpIngName}
                        // Named per ingredient so a screen reader user can jump
                        // between them instead of hearing one long list.
                      >
                        {nameOf(r.key, r.name, allRows)}
                      </h4>
                      <ul
                        className={styles.cmpList}
                        aria-label={`שינויים ב${nameOf(r.key, r.name, allRows)}`}
                      >
                        {r.fields.map((f) => (
                          <ChangeRow key={f.key} change={f} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}

              {result.steps.before !== result.steps.after && (
                <section aria-label="שלבי ההכנה">
                  <h3 className={styles.sheetSub}>אופן ההכנה</h3>
                  <ul className={styles.cmpList}>
                    <ChangeRow
                      change={{
                        key: 'steps',
                        label: 'מספר השלבים',
                        before: result.steps.before,
                        after: result.steps.after,
                      }}
                    />
                  </ul>
                </section>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
