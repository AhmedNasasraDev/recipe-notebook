// The trial log (spec 5.1 "יומן ניסויים"; stage 3ב, A-6).
//
// A trial is a RECORD of a bake — the date and what happened — and that is why
// it lives here on the recipe page and not in the editor: it is not part of
// the formula, it is not versioned (versionDiff.ts) and it is not copied when
// the recipe is duplicated (duplicate.ts). The types, the table and its RLS
// have existed since migration 0002; until this card nothing could write them.
//
// Each change is saved the moment it is made, through `onSave`, and the card
// says what happened: "נשמר" only after the promise resolved, and a failure
// with the text still in the box, so nothing typed is lost to a dropped
// connection. Removal asks first, inline, naming the entry.

import { useState, type FormEvent } from 'react';
import type { RecipeTrial } from '@recipe-notebook/engine';
import styles from './recipe.module.css';

export interface TrialLogProps {
  trials: readonly RecipeTrial[];
  /** false offline and in the demo: the form is shown disabled and says why */
  canWrite: boolean;
  onSave(next: readonly RecipeTrial[]): Promise<readonly RecipeTrial[]>;
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

const HE_DATE = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

/** 'YYYY-MM-DD' as a Hebrew date, or the raw text if it is not one. */
export function trialDateLabel(date: string | undefined): string {
  if (!date) return 'ללא תאריך';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return HE_DATE.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Today, in the local calendar, as the value an <input type="date"> takes. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function TrialLog({ trials, canWrite, onSave }: TrialLogProps) {
  const [date, setDate] = useState(() => todayIso());
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const save = async (next: readonly RecipeTrial[], after: () => void) => {
    setStatus({ kind: 'saving' });
    try {
      await onSave(next);
      after();
      setStatus({ kind: 'saved' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'השמירה נכשלה.' });
    }
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (note.trim() === '') {
      setStatus({ kind: 'error', message: 'כדי לרשום ניסוי צריך לכתוב מה קרה.' });
      return;
    }
    const entry: RecipeTrial = { ...(date ? { date } : {}), note: note.trim() };
    void save([...trials, entry], () => {
      setNote('');
    });
  };

  const onRemove = (id: string) => {
    void save(
      trials.filter((t) => t.id !== id),
      () => setConfirmRemove(null),
    );
  };

  const busy = status.kind === 'saving';

  return (
    <section className={styles.trialCard} aria-label="יומן ניסויים">
      <h3 className={styles.fcTitle}>יומן ניסויים</h3>
      <p className={styles.trialHelp}>
        רישום של מה שנאפה בפועל: תאריך ומה קרה. היומן נשמר עם המתכון ולא משתנה
        בעריכה שלו, ואינו מועתק בשכפול.
      </p>

      {trials.length === 0 ? (
        <p className={styles.trialEmpty}>עדיין אין רשומות ביומן.</p>
      ) : (
        <ul className={styles.trialList}>
          {trials.map((t, i) => {
            const id = t.id;
            const key = id ?? `t-${i}`;
            const asking = confirmRemove === key;
            return (
              <li key={key} className={styles.trialRow}>
                <div className={styles.trialText}>
                  <span className={styles.trialDate}>{trialDateLabel(t.date)}</span>
                  <span className={styles.trialNote}>{t.note}</span>
                </div>
                {canWrite && id && (
                  asking ? (
                    <div className={styles.trialConfirm} role="group" aria-label="אישור הסרה">
                      <span>להסיר את הרשומה מ{trialDateLabel(t.date)}?</span>
                      <button
                        type="button"
                        className={styles.trialDangerBtn}
                        disabled={busy}
                        onClick={() => onRemove(id)}
                      >
                        כן, להסיר
                      </button>
                      <button
                        type="button"
                        className={styles.trialGhostBtn}
                        disabled={busy}
                        onClick={() => setConfirmRemove(null)}
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.trialGhostBtn}
                      aria-label={`הסרת הרשומה מ${trialDateLabel(t.date)}`}
                      disabled={busy}
                      onClick={() => setConfirmRemove(key)}
                    >
                      הסרה
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className={styles.trialForm} onSubmit={onAdd} aria-label="רישום ניסוי חדש">
        <div className={styles.trialFields}>
          <label className={styles.trialLabel}>
            <span>תאריך</span>
            <input
              type="date"
              className={styles.trialInput}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canWrite || busy}
            />
          </label>
          <label className={styles.trialLabel}>
            <span>מה קרה</span>
            <textarea
              className={styles.trialArea}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canWrite || busy}
              placeholder="למשל: קרום כהה מדי — לקצר בשתי דקות"
            />
          </label>
        </div>
        <div className={styles.trialActions}>
          <button type="submit" className={styles.trialAddBtn} disabled={!canWrite || busy}>
            {busy ? 'שומר…' : 'הוספה ליומן'}
          </button>
          <p className={styles.noteStatus} role="status" aria-live="polite">
            {!canWrite
              ? 'אין כרגע חיבור, ולכן אי אפשר לרשום ביומן.'
              : status.kind === 'saved'
                ? 'נשמר'
                : status.kind === 'error'
                  ? status.message
                  : ''}
          </p>
        </div>
      </form>
    </section>
  );
}
