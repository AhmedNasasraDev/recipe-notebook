// §8 — the personal note.
//
// WHAT MAKES THIS DIFFERENT FROM `recipe.notes`, AND WHY IT IS ITS OWN TABLE
//
// `notes` belongs to the recipe and travels with it — into a shared copy, an
// order sheet, a label. A personal note belongs to the ACCOUNT and travels
// nowhere: HANDOFF §3 says no policy, view, RPC or report may let anyone else
// read it, "ללא יוצא מן הכלל", an instructor included. That is why it lives in
// `private_notes` with its own RLS rather than in a column on `recipes`, and
// why the card below says so where the typing happens instead of in a settings
// page nobody opens (§12: "כל מסך שנוגע בפרטיות נושא הסבר קצר במקום שבו
// הפעולה קורית").
//
// ── THE SAVE, AND WHAT STAGE 3 CHANGED ────────────────────────────────────
//
// §8 asks for a 400 ms debounce, and almost everything below exists because a
// debounce can lose a keystroke. Three rules were already held: the status
// goes to "נשמר" only after the promise resolves, the pending text is flushed
// on unmount, and a failure is shown with the text left in the box.
//
// The audit found the hole in the fourth case — the flush itself. Typing a
// line and pressing back inside the 400 ms attempted the save from a
// component that was already gone, and `.catch(() => undefined)` swallowed
// the failure: the keystrokes were lost, nothing said so, and coming back to
// the recipe showed the server's older text under the word "נשמר".
//
// Ahmed's stage-3 item 2, and how each part is met:
//
//   · NO "נשמר" BEFORE A REAL SAVE. The word is shown only when the text on
//     screen is the text the server is known to hold — `confirmed` below.
//     A note just read from the server counts; anything typed since does not.
//   · THE UNSAVED TEXT SURVIVES THE SCREEN. A failed save — including a
//     failed flush from the cleanup — writes a DRAFT to device storage
//     (`writeNoteDraft`), keyed by account and recipe. Coming back loads it,
//     shows it in the box and offers "ניסיון חוזר".
//   · THE FAILURE IS VISIBLE EVEN WHEN THIS CARD IS GONE. The flush reports
//     through `raiseError`, which draws on the shell's banner above every
//     screen (see AppDataProvider).
//   · NO SILENT OVERWRITE OF A NEWER VERSION. The draft remembers the server
//     text it was written against (`base`). If the server now holds something
//     else — another device, another session — the card says so and offers
//     both texts instead of posting the draft over it.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearNoteDraft,
  readNoteDraft,
  writeNoteDraft,
  type NoteDraft,
} from '../../data/offlineMirror.js';
import styles from './recipe.module.css';

export const NOTE_DEBOUNCE_MS = 400;

type Status = 'idle' | 'typing' | 'saving' | 'saved' | 'error';

export interface PrivateNoteProps {
  recipeId: string;
  /** null while loading, '' or the text once known */
  initial: string | null;
  canWrite: boolean;
  onSave(body: string): Promise<void>;
  /**
   * The account the draft belongs to. A draft is private text, so it is keyed
   * by account as well as by recipe; with no account (the read-only demo)
   * there is nothing to save and nothing to draft.
   */
  userId: string | null;
  /** Raises a failure on the shell's banner — for the flush, which outlives
      this component. */
  onFlushError?(message: string): void;
}

const failureText = (e: unknown): string =>
  e instanceof Error && e.message !== '' ? e.message : 'שמירת ההערה נכשלה.';

export function PrivateNote({
  recipeId,
  initial,
  canWrite,
  onSave,
  userId,
  onFlushError,
}: PrivateNoteProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  /** A draft found in storage whose `base` no longer matches the server. */
  const [conflict, setConflict] = useState<NoteDraft | null>(null);
  /** true when this browser refused to keep the draft — said out loud. */
  const [draftLost, setDraftLost] = useState(false);

  // What is on screen but not yet written. The ref is what makes the unmount
  // flush possible: an effect cleanup cannot read state from a later render.
  const pending = useRef<string | null>(null);
  /** The text the SERVER is known to hold. Only this may be called "נשמר". */
  const confirmed = useRef<string | null>(null);
  /** The server text a draft would be written against. */
  const base = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const flushErrorRef = useRef(onFlushError);
  flushErrorRef.current = onFlushError;
  const idsRef = useRef({ userId, recipeId });
  idsRef.current = { userId, recipeId };

  /** Keeps the draft in storage, and says so if it could not be kept. */
  const keepDraft = useCallback(async (body: string) => {
    const { userId: uid, recipeId: rid } = idsRef.current;
    if (uid === null) return;
    const ok = await writeNoteDraft(uid, rid, {
      body,
      base: base.current,
      at: Date.now(),
    });
    setDraftLost(!ok);
  }, []);

  /*
    A note arriving from the server replaces the box only when the user has
    not typed since — otherwise a slow read would overwrite live typing. It
    also becomes the confirmed text and the base for any future draft.
  */
  useEffect(() => {
    if (initial === null || pending.current !== null) return;
    confirmed.current = initial;
    base.current = initial;
    setText(initial);
  }, [initial, recipeId]);

  /*
    A draft from a previous visit, once the server's own text is known — the
    order matters, because "is this draft stale?" is a comparison against the
    server text and cannot be asked before it has arrived.
  */
  useEffect(() => {
    if (initial === null || userId === null) return;
    let cancelled = false;
    void readNoteDraft(userId, recipeId).then((draft) => {
      if (cancelled || draft === null) return;
      if (draft.body === initial) {
        // It did land after all (another tab, a retry) — nothing to recover.
        void clearNoteDraft(userId, recipeId);
        return;
      }
      if (draft.base !== initial) {
        // The server moved since the draft was typed. Both texts are real and
        // neither may be thrown away silently.
        setConflict(draft);
        setStatus('error');
        setError(
          'ההערה שהוקלדה כאן לא נשמרה, ובינתיים נשמרה גרסה אחרת בחשבון. אפשר לבחור איזו לשמור.',
        );
        return;
      }
      pending.current = draft.body;
      setText(draft.body);
      setStatus('error');
      setError('ההערה לא נשמרה בפעם הקודמת. הטקסט נשמר כאן — אפשר לנסות שוב.');
    });
    return () => {
      cancelled = true;
    };
  }, [initial, recipeId, userId]);

  const write = useCallback(
    async (body: string) => {
      pending.current = null;
      setStatus('saving');
      setError(null);
      try {
        await saveRef.current(body);
        confirmed.current = body;
        base.current = body;
        setStatus('saved');
        setConflict(null);
        setDraftLost(false);
        const { userId: uid, recipeId: rid } = idsRef.current;
        if (uid !== null) await clearNoteDraft(uid, rid);
      } catch (e) {
        // The text stays in the box AND goes to storage, so it survives both
        // a retry here and leaving the screen.
        pending.current = body;
        setStatus('error');
        setError(failureText(e));
        await keepDraft(body);
      }
    },
    [keepDraft],
  );

  useEffect(
    () => () => {
      /*
        Unmounting with a timer still running is the normal way to leave this
        screen: type, then press back. Flush rather than lose it — and, since
        this component is going away, report a failure where it can still be
        seen and keep the text where it can still be recovered.
      */
      if (timer.current) clearTimeout(timer.current);
      const last = pending.current;
      if (last === null) return;
      const { userId: uid, recipeId: rid } = idsRef.current;
      const at = Date.now();
      const baseAtFlush = base.current;
      void saveRef.current(last)
        .then(() => {
          if (uid !== null) void clearNoteDraft(uid, rid);
        })
        .catch((e: unknown) => {
          if (uid !== null) {
            void writeNoteDraft(uid, rid, { body: last, base: baseAtFlush, at });
          }
          flushErrorRef.current?.(
            `${failureText(e)} הטקסט שהוקלד בהערה האישית נשמר על המכשיר, ואפשר לנסות שוב בדף המתכון.`,
          );
        });
    },
    [],
  );

  const onChange = (next: string) => {
    setText(next);
    setStatus('typing');
    setConflict(null);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void write(next), NOTE_DEBOUNCE_MS);
  };

  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    void write(text);
  };

  /* "נשמר" is only ever the truth about the text ON SCREEN. */
  const savedNow = status === 'idle' && text !== '' && confirmed.current === text;

  return (
    <section className={styles.card} aria-label="הערה אישית">
      <h2 className={styles.cardTitle}>ההערה האישית שלי</h2>
      <p className={styles.panNote}>
        ההערה הזאת שמורה לחשבון שלכם בלבד. היא אינה חלק מהמתכון, אינה נוסעת איתו
        בשיתוף, ואינה מופיעה בדף הזמנה או בתווית.
      </p>

      {canWrite ? (
        <>
          <label className="visuallyHidden" htmlFor={`note-${recipeId}`}>
            ההערה האישית שלי
          </label>
          <textarea
            id={`note-${recipeId}`}
            className={styles.noteArea}
            value={text}
            rows={3}
            onChange={(e) => onChange(e.target.value)}
            placeholder="מה למדתם על המתכון הזה"
          />
          {/*
            `role="status"` and not `role="alert"`: this is a quiet
            confirmation, and an alert would interrupt a screen reader on every
            pause in typing.
          */}
          <p className={styles.noteStatus} role="status">
            {status === 'typing' && 'מקליד…'}
            {status === 'saving' && 'שומר…'}
            {status === 'saved' && 'נשמר'}
            {status === 'error' && (error ?? 'שמירת ההערה נכשלה.')}
            {savedNow && 'נשמר'}
          </p>

          {status === 'error' && (
            <div className={styles.noteRetry}>
              <button type="button" className={styles.noteRetryBtn} onClick={retry}>
                ניסיון חוזר
              </button>
              {draftLost && (
                <span className={styles.panWhy}>
                  הדפדפן הזה אינו שומר את הטקסט מקומית, ולכן כדאי לא לעזוב את
                  המסך עד שהשמירה תצליח.
                </span>
              )}
            </div>
          )}

          {conflict !== null && (
            /*
              Two real versions, and the person decides. The draft is not
              posted over the account's text and the account's text does not
              erase the draft: both are on screen, each with the button that
              keeps it.
            */
            <div className={styles.noteConflict} role="group" aria-label="שתי גרסאות של ההערה">
              <p className={styles.panWhy}>הטקסט שלא נשמר:</p>
              <p className={styles.noteVersion}>{conflict.body}</p>
              <p className={styles.panWhy}>מה ששמור כרגע בחשבון:</p>
              <p className={styles.noteVersion}>{initial === '' ? '(ריק)' : initial}</p>
              <div className={styles.noteRetry}>
                <button
                  type="button"
                  className={styles.noteRetryBtn}
                  onClick={() => {
                    setText(conflict.body);
                    pending.current = conflict.body;
                    void write(conflict.body);
                  }}
                >
                  לשמור את הטקסט שהוקלד
                </button>
                <button
                  type="button"
                  className={styles.noteRetryBtn}
                  onClick={() => {
                    const keep = initial ?? '';
                    setText(keep);
                    pending.current = null;
                    confirmed.current = keep;
                    base.current = keep;
                    setConflict(null);
                    setStatus('idle');
                    setError(null);
                    if (userId !== null) void clearNoteDraft(userId, recipeId);
                  }}
                >
                  להשאיר את מה ששמור בחשבון
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className={styles.panWhy}>
          הערה אישית נשמרת לחשבון. בהתקנה הזאת אין חיבור לשרת, ולכן אי אפשר
          לשמור אותה.
        </p>
      )}
    </section>
  );
}
