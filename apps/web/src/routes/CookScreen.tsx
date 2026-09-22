// §2 screen 7 / §14 — Cook Mode.
//
// One step on the screen, big type on a light surface, a progress bar of
// segments you can jump with, a completion count, and a timer per step that
// has a duration — all running in parallel, because a bake and a proof do not
// take turns.
//
// WHAT THIS SCREEN IS FOR, WHICH DECIDES EVERY CHOICE IN IT
//
// It is used with flour on your hands, at arm's length, in a room that is too
// warm. So: nothing here scrolls sideways, every control is a big target, the
// step text is 25px and the step number is 54px (§14, and both are already
// tokens in the design system), and the one thing that must never happen is a
// tap that loses your place. Marking a step advances; marking it again undoes
// it. Nothing is saved to the server — §14 holds completion in state, keyed by
// step, and a cooking session is not a document.
//
// MISE EN PLACE COMES FIRST, AND THERE IS NO WAY ROUND IT
//
// A preparation starts by weighing everything out. So Cook Mode opens on the
// ingredient list — the quantities for THIS batch, at the scale the recipe
// page was set to — and the steps do not exist on screen until every line is
// ticked. There is no "skip", no "start anyway", no alternative route: the
// steps are not behind a disabled link, they are not rendered at all, and the
// only thing that renders them is `started`, which only the button sets.
//
// The quantities are not computed here. `compute()` is the engine, called once
// with the factor the link carries, and `rowLabel` is the one function in the
// project that turns a computed row into words — the same one the recipe page
// uses. A sub-recipe stays ONE line ("קרם פטיסייר — 500 גרם") because that is
// how `compute()` returns it; nothing here expands it into milk and yolks, and
// nothing here can list an ingredient twice.
//
// WHERE THE SCALE COMES FROM, AND WHY IT IS IN THE URL
//
// Cook Mode had no scale at all: it printed `ing.qty` as written, so a ×2 bake
// was weighed from ×1 numbers. The project already answered this question for
// the order sheet — the scale travels in the query string and is rebuilt with
// the engine's own `scaleFactor()` (see `OrderScreen`'s header for why router
// state and a stored field are both worse) — so the cook link now carries the
// same three parameters through the same `scaleLink.ts`. One scaling rule,
// three screens.
//
// WHERE THE PROGRESS LIVES
//
// `offlineMirror` has carried `CookProgress` — a per-step done map, the step
// you were on, keyed by recipe — since stage 3, and nothing ever called it.
// This screen does. It matters in the one situation the screen is for: a
// 90-minute proof means the phone is put down and the app is backgrounded or
// closed, and coming back to a reset checklist is the difference between a
// tool and a toy. It is DEVICE storage, not the account: what you have done so
// far tonight is not a document, and `clearMirror()` on sign-out takes it with
// everything else. "סיום ההכנה" clears it, because the next bake starts fresh.
//
// THE TIMERS ARE THE REASON THIS SCREEN HAS A CLOCK AT ALL
//
// `timers.ts` stores a deadline rather than a countdown, so a phone that went
// to sleep comes back with the right time left. This file only repaints. The
// strip of running timers is visible from EVERY step, not just the one that
// started it, because the whole point of a parallel timer is that you have
// walked away from that step.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClockIcon, ThermometerIcon } from '../shell/Icons.js';
import { BackControl } from '../components/BackLink.js';
import { compute } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import { readScale, SCALE_MODE_TEXT } from '../features/recipe/scaleLink.js';
import { rowLabel } from '../features/recipe/rowLabel.js';
import { useFullscreen } from '../features/cook/useFullscreen.js';
import {
  miseKeyOf,
  miseSignature,
  miseState,
  restoreMise,
  startedFrom,
  toggleMise,
  type MiseTicks,
} from '../features/cook/mise.js';
import {
  formatClock,
  startTimer,
  toggleTimer,
  viewTimer,
  type TimerState,
} from '../features/cook/timers.js';
import { markTitle, ringAlarm, unlockAlarm } from '../features/cook/alarm.js';
import {
  clearCookProgress,
  readCookProgress,
  readCookTextSize,
  writeCookProgress,
  type CookTextSize,
} from '../data/offlineMirror.js';
import styles from './CookScreen.module.css';

/** How often the clock is repainted. The arithmetic does not depend on it. */
const TICK_MS = 250;

export function CookScreen() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { recipes, prefs, catalog, ready } = useAppData();
  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  const steps = useMemo(() => (recipe?.steps ?? []).filter((s) => s.text || s.minutes), [recipe]);

  const [at, setAt] = useState(0);
  /** §14 `kDone`, keyed by step index for this recipe. */
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set());
  const [timers, setTimers] = useState<ReadonlyMap<number, TimerState>>(() => new Map());

  /*
    "מסך מלא" — see `useFullscreen`. The ref is the element that is made
    fullscreen: the screen's own wrapper, so the preparation fills the display
    and nothing of the application around it is left showing. Neither entering
    nor leaving it touches the step, the ticks, the chosen quantity or the
    timers — they are state on THIS component, and this only adds a class.
  */
  const screenRef = useRef<HTMLDivElement | null>(null);
  const fs = useFullscreen();
  const [now, setNow] = useState(() => Date.now());
  /** false until the stored progress has been read, so the first write cannot
      overwrite it with an empty set. */
  const [restored, setRestored] = useState(false);
  /** Mise en place: the ticks, and whether the preparation has been started. */
  const [ticks, setTicks] = useState<MiseTicks>({});
  /*
    §7's reset. Two taps, not one: the first turns the control into the
    question, the second clears the ticks. Nothing else is touched — not the
    step, not the timers, not the chosen quantity — and the effect goes
    through the same `setTicks` the checkboxes use, so it is saved by the same
    effect that saves a tick.
  */
  const [askReset, setAskReset] = useState(false);

  /*
    §8: "טיימר מזמן המתכון או טיימר אישי שניתן לערוך; אל תמציא זמנים."

    The recipe's own time starts a timer with one press and has done since
    §14. What was missing is the other half: a step that carries no time —
    most steps of most recipes — had no way to time anything at all, and the
    kitchen answer to "cover and rest until it doubles" is a phone timer you
    set yourself. So the minutes are ASKED FOR rather than guessed, and the
    timer that comes out is the same object, on the same clock, saved by the
    same effect as the recipe's.
  */
  /*
    §10's text size, applied where it was asked for: the screen people read
    from across a bench. It is a device choice (see `readCookTextSize`), so it
    is read once on mount and needs no server round trip — and until it
    answers the screen is at its normal size, which is what it has always
    been, rather than jumping a size once the answer arrives.
  */
  const [textSize, setTextSize] = useState<CookTextSize>('normal');
  useEffect(() => {
    let cancelled = false;
    void readCookTextSize().then((size) => {
      if (!cancelled) setTextSize(size);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const textScale = textSize === 'xlarge' ? 1.34 : textSize === 'large' ? 1.16 : 1;

  const [askOwnTimer, setAskOwnTimer] = useState(false);
  const [ownMinutes, setOwnMinutes] = useState('');
  /*
    "Started" is two facts, and keeping them apart is what fixed a real bug.

    `startedHere` is the button being pressed in this session. `startedSaved`
    is the flag that came back from the device. The EFFECTIVE answer (below,
    during render) is `startedHere || (startedSaved && the list is complete
    now)` — and it has to be decided during render, because the stored record
    arrives before the recipes do on a cold start. Deciding it when storage
    resolved meant asking "is the list complete?" against a row list that had
    not loaded yet, and the cook was sent back to weigh a bake that was already
    in the oven.
  */
  const [startedSaved, setStartedSaved] = useState(false);
  const [savedAtThisScale, setSavedAtThisScale] = useState(false);
  const [startedHere, setStartedHere] = useState(false);

  /*
    The quantities for THIS batch, from the one engine.

    Priced from the ingredient centre for the same reason the recipe page does
    it — a row with no price of its own resolves one from there, and the
    resolution is what makes a sub-recipe's figures whole. Cook Mode shows no
    money at all (§14, and this screen is for working), but `compute()` takes
    the priced recipe and it is cheaper to hand it the same input than to
    maintain a second notion of what the recipe is.
  */
  const pricedNotebook = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );
  const pricedRecipe = useMemo(
    () => (recipe ? resolveFromCatalog(recipe, catalog) : null),
    [recipe, catalog],
  );
  const baseline = useMemo(
    () => (pricedRecipe ? compute(pricedRecipe, pricedNotebook, { prefs }) : null),
    [pricedRecipe, pricedNotebook, prefs],
  );
  /** The scale the link carries, rebuilt with the engine's own rule. */
  const scale = useMemo(() => readScale(params, baseline), [params, baseline]);
  const computed = useMemo(
    () =>
      pricedRecipe
        ? compute(pricedRecipe, pricedNotebook, { factor: scale.factor, prefs })
        : null,
    [pricedRecipe, pricedNotebook, scale.factor, prefs],
  );
  const rows = useMemo(() => computed?.rows ?? [], [computed]);
  /** The ticks are only meaningful at the factor they were taken at. */
  const signature = miseSignature(scale.factor);

  // Read the progress for this recipe, once — and again if the scale changes,
  // because ticks taken at another factor are not this preparation's.
  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    setRestored(false);
    /*
      THE TIMERS AND THE TWO SMALL DIALOGS BELONG TO THE RECIPE TOO.

      Everything else here is re-read per recipe; the running timers, the
      personal-timer prompt and the reset question were the only cook state
      that was not, because they live in component state keyed by STEP INDEX
      and this screen stays mounted when the recipe under it changes. A timer
      started on step 2 of one recipe would still be counting on step 2 of the
      next — the same class of leak as the scale that used to follow a
      duplicate to its copy (see RecipeScreen).

      Reachable today only by editing the address bar, since nothing links
      from one recipe's Cook Mode to another's. Closed anyway: it costs three
      lines, and the next link that gets added would inherit the bug.
    */
    setTimers(new Map());
    setAskOwnTimer(false);
    setAskReset(false);
    void readCookProgress(recipeId)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          const marked = Object.entries(saved.done)
            .filter(([, v]) => v)
            .map(([k]) => Number(k));
          setDone(new Set(marked));
          setAt(Number.isFinite(saved.step) ? saved.step : 0);
          setTicks(restoreMise(saved, signature));
          /*
            The saved start counts only when the record was taken at THIS
            scale — see `startedFrom`. Recorded here, where the record is,
            rather than inferred later from how many lines are ticked.
          */
          setStartedSaved(saved.started === true);
          setSavedAtThisScale(saved.miseScale === signature);
          // Timers come back exactly as they were: a deadline is a deadline.
          setTimers(
            new Map(
              Object.entries(saved.timers ?? {}).map(([k, v]) => [Number(k), v] as const),
            ),
          );
        } else {
          setDone(new Set());
          setAt(0);
          setTicks({});
          setStartedSaved(false);
          setSavedAtThisScale(false);
        }
        setStartedHere(false);
        setRestored(true);
      })
      // Device storage can be blocked (a private window, cleared site data).
      // Cook Mode still works; it just starts from the beginning — which for
      // Mise en place means weighing again, never skipping it.
      .catch(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, signature]);

  // Write it back on a real change — not on a timer tick, which happens four
  // times a second and has nothing to do with progress.
  useEffect(() => {
    if (!recipeId || !restored) return;
    const map: Record<number, boolean> = {};
    for (const i of done) map[i] = true;
    void writeCookProgress({
      recipeId,
      done: map,
      step: at,
      updatedAt: Date.now(),
      mise: { ...ticks },
      miseScale: signature,
      /*
        The stored INTENT, not the effective value: while the recipes are still
        loading the effective one is false, and writing that would erase a start
        that really happened.
      */
      started: startedHere || startedSaved,
      timers: Object.fromEntries(timers),
    });
  }, [recipeId, restored, done, at, ticks, signature, startedHere, startedSaved, timers]);

  /*
    THE ALARM. `now` advances four times a second while a timer runs; the
    first tick that finds a timer at zero rings once for it (the id is
    remembered so it does not ring again on the next tick), and the tab title
    carries a bell until the timer is dismissed.
  */
  const rung = useRef<Set<string>>(new Set());
  useEffect(() => {
    let anyDone = false;
    for (const [i, t] of timers) {
      const v = viewTimer(t, now);
      if (!v.done) continue;
      anyDone = true;
      const key = `${i}:${t.totalMs}:${t.kind === 'running' ? t.endsAt : 'p'}`;
      if (rung.current.has(key)) continue;
      rung.current.add(key);
      ringAlarm();
    }
    if (!anyDone) return;
    const undo = markTitle();
    return undo;
  }, [timers, now]);

  // One interval for the whole screen, and only while something is running.
  const hasTimers = timers.size > 0;
  useEffect(() => {
    if (!hasTimers) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [hasTimers]);

  // Keep the focus where a keyboard user expects it after a jump: on the step
  // itself, not back at the top of the page.
  const stepRef = useRef<HTMLDivElement>(null);

  /*
    EVERY STEP STARTS AT ITS OWN TOP.

    Cook Mode is outside the AppShell (§14: a full screen without tabs), so it
    is the DOCUMENT that scrolls it. On a phone held sideways the gate is
    pressed at the end of a scrolled page — and React keeps that scroll — so
    the steps used to open with the way out and the fullscreen control already
    above the fold (measured: the header at -71..-27 in a 402px-tall viewport).
    Moving between steps had the same effect. This resets the scroll only: the
    step, the ticks, the chosen quantity and the running timers are state and
    are not touched. `scrollTop` rather than `window.scrollTo`, because it is
    the same one line in the browser and silent under jsdom.
  */
  /* Which stage the screen is on — computed here, above the early returns,
     because the effect below needs it and hooks cannot follow a `return`. */
  const mise = miseState(rows, ticks);
  const started = startedHere || startedFrom(startedSaved, savedAtThisScale);
  useEffect(() => {
    if (!started) return;
    const root = document.scrollingElement ?? document.documentElement;
    root.scrollTop = 0;
  }, [at, started]);

  if (!ready) return null;

  if (!recipe) {
    return (
      <div className={styles.missing}>
        <h1 className={styles.missingTitle}>מצב הכנה</h1>
        <p>המתכון הזה לא נמצא במחברת.</p>
        <BackControl>המחברת</BackControl>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className={styles.missing}>
        <h1 className={styles.missingTitle}>{recipe.name}</h1>
        <p>
          למתכון הזה לא נרשמו שלבי הכנה, ולכן אין מה להציג במצב הכנה. אפשר להוסיף
          שלבים בעריכת המתכון.
        </p>
        <Link to={`/recipe/${recipe.id}/edit`} className={styles.exit}>
          עריכת המתכון
        </Link>
        <BackControl>חזרה למתכון</BackControl>
      </div>
    );
  }

  /* ── Mise en place: the first stage, and the only way to the steps ────── */

  /*
    ── §7: THE WEIGHING IS A CHECKLIST, NOT A LOCK ──────────────────────────

    It used to be a lock: the steps were not on the page until every line was
    ticked, and the button that put them there was disabled until then. That
    was this project's own §14 rule and four browser checks enforced it.

    Ahmed changed it explicitly (stage 3, item 4): a cook may go through to
    the preparation with lines still unticked, as long as the screen says how
    many are left — a baker who has the butter in front of them does not
    always tick it, and a kitchen that cannot get past a checklist stops using
    the checklist. Nothing is ticked on their behalf: `startedHere` moves the
    stage on and touches no tick, so coming back shows exactly what was
    marked.

    `pending` is what the screen has to say out loud.
  */
  const pending = Math.max(0, mise.total - mise.ready);
  const gateNoteId = 'mise-gate-note';
  const scaleLine =
    scale.factor === 1
      ? SCALE_MODE_TEXT.recipe
      : `${SCALE_MODE_TEXT[scale.mode]} · ×${scale.factor.toFixed(2)}`;


  /*
    THE SAME HEAD ON BOTH STAGES.

    Weighing and the steps are two returns from one component, and both need
    the same three things at the top: the way out of Cook Mode (which is NOT
    the way out of fullscreen), the recipe's name, and "מסך מלא". Written once
    so the two cannot drift.
  */
  const head = (
    <header className={styles.head}>
      {/* §4/§8: the way out of Cook Mode — the right-hand end of the bar, the
          chevron pointing back, and always reachable, in fullscreen too. */}
      <BackControl className={styles.exitPill}>
        יציאה
      </BackControl>
      <button
        type="button"
        className={styles.fsBtn}
        onClick={() => fs.toggle(screenRef.current)}
        aria-pressed={fs.focus}
      >
        {fs.focus ? 'יציאה ממסך מלא' : 'מסך מלא'}
      </button>
      {/*
        THE WAY BACK TO THE SCALES.

        §7 lets a cook through with lines unticked — which only works if they
        can come back and tick them. There was no way back at all while the
        stage was a lock, because there was nothing to come back for. It
        leaves the step, the ticks and the timers exactly as they are; it is
        not "start again".
      */}
      {started && (
        <button
          type="button"
          className={styles.fsBtn}
          onClick={() => {
            setStartedHere(false);
            setStartedSaved(false);
          }}
        >
          חזרה לשקילה
        </button>
      )}
      <span className={styles.recipeName}>{recipe.name}</span>
    </header>
  );

  /* Shown once, and only when the environment refused a real fullscreen —
     the screen says what it actually did rather than claiming the phone's own
     bars went away. */
  const fsNote = fs.fallback ? (
    <p className={styles.fsNote} role="status">
      מסך מלא אינו זמין בתצוגה הזאת, ולכן ההכנה ממלאת את כל השטח שיש. סרגלי
      המכשיר והמסגרת שסביב אינם בשליטת האפליקציה.
    </p>
  ) : null;

  if (!started) {
    return (
      <div
        className={fs.focus ? `${styles.wrap} ${styles.focus}` : styles.wrap}
        dir="rtl"
        ref={screenRef}
        style={{ '--cook-text-scale': textScale } as CSSProperties}
      >
        {head}
        {fsNote}

        <section className={styles.mise} aria-label="הכנת חומרי גלם">
          <h1 className={styles.miseTitle}>הכנת חומרי גלם</h1>
          <p className={styles.miseHelp}>
            הכינו ושקלו את כל חומרי הגלם לפני שמתחילים בהכנה.
          </p>
          <p className={styles.miseScale}>
            הכמויות כאן הן של ההכנה הזאת: {scaleLine}
          </p>

          {mise.total === 0 ? (
            /*
              A recipe with steps and no ingredients. There is nothing to
              weigh, so there is no stage to complete — and a disabled button
              with an empty list above it would be a dead end rather than a
              rule. It says what it is instead.
            */
            <p className={styles.miseEmpty}>
              למתכון הזה לא נרשמו חומרי גלם, ולכן אין מה לשקול לפני ההכנה. אפשר
              להוסיף אותם בעריכת המתכון.
            </p>
          ) : (
            <>
              <ul className={styles.miseList}>
                {rows.map((row, i) => {
                  const key = miseKeyOf(row, i);
                  const on = ticks[key] === true;
                  /*
                    The SAME `rowLabel` the recipe page prints, in grams —
                    which is what a mise en place is. A sub-recipe row comes
                    back as one weight of the base recipe, because that is how
                    `compute()` returned it.
                  */
                  const label = rowLabel(row, 'g', scale.factor, prefs);
                  return (
                    <li key={key}>
                      <label className={on ? styles.miseRowOn : styles.miseRow}>
                        <input
                          type="checkbox"
                          className={styles.miseBox}
                          checked={on}
                          onChange={() => setTicks((prev) => toggleMise(prev, key))}
                        />
                        <span className={styles.miseName}>
                          {row.ing.name || 'רכיב בלי שם'}
                        </span>
                        <span className={`${styles.miseQty} ltr`}>{label.text}</span>
                        {label.hint !== '' && (
                          <span className={styles.miseHint}>{label.hint}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* §7: clearing the list is a secondary action, under it. */}
          {mise.ready > 0 && (
            <div className={styles.resetRow}>
              {askReset ? (
                <>
                  <span className={styles.resetAsk}>
                    לנקות את כל הסימונים?
                  </span>
                  <button
                    type="button"
                    className={`${styles.reset} ${styles.resetConfirm}`}
                    onClick={() => {
                      setTicks({});
                      setAskReset(false);
                    }}
                  >
                    כן, לנקות
                  </button>
                  <button
                    type="button"
                    className={styles.reset}
                    onClick={() => setAskReset(false)}
                  >
                    ביטול
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() => setAskReset(true)}
                >
                  איפוס הסימונים
                </button>
              )}
            </div>
          )}

          {/*
            THE PROGRESS AND THE GATE RIDE ALONG AT THE BOTTOM.

            This screen is outside the AppShell (§14: a full screen without
            tabs), so it is the DOCUMENT that scrolls it — and with eight or
            ten ingredients the gate sat below the fold, where a cook had to
            scroll to find out whether the stage was finished. The two things
            that answer "can I start?" are pinned instead: the count, which is
            the live region, and the gate itself.
          */}
          <div className={styles.gateBar}>
            {mise.total > 0 && (
              <p className={styles.count} role="status">
                <span className="ltr">{mise.ready}</span> מתוך{' '}
                <span className="ltr">{mise.total}</span> חומרי גלם מוכנים
              </p>
            )}
            {/* No second `role="status"`: the count above is the live region,
                and two of them announce over each other. This line is the
                same fact said in the words §14's request asked for. */}
            {mise.complete && (
              <p className={styles.miseDone}>
                <span className="ltr">100%</span> — Mise en place הושלם
              </p>
            )}
            {/*
              WHAT IS STILL UNTICKED, AND THAT IT DOES NOT BLOCK ANYONE.
              The button is not shut any more — Ahmed approved the change
              explicitly: "אפשר לעבור להכנה גם בלי לסמן את כל הרכיבים, עם
              חיווי ברור כמה נותרו. אין לסמן אותם אוטומטית." The count above
              states the fact, this line states how many are left and that
              nothing is ticked for you, and `aria-describedby` carries it to
              anyone who reaches the button by keyboard or screen reader
              instead of seeing the line under it.
            */}
            {pending > 0 && (
              <p className={styles.gateNote} id={gateNoteId}>
                נותרו <span className="ltr">{pending}</span>{' '}
                {pending === 1 ? 'רכיב לסימון' : 'רכיבים לסימון'}. אפשר לעבור
                להכנה גם עכשיו — הם לא יסומנו אוטומטית, והסימון ממתין כאן.
              </p>
            )}
            <button
              type="button"
              className={styles.start}
              /* The note above is the description, so a keyboard or screen
                 reader user hears what is still unticked before they press. */
              aria-describedby={pending > 0 ? gateNoteId : undefined}
              onClick={() => setStartedHere(true)}
            >
              {pending === 0 ? 'הכול מוכן — מתחילים בהכנה' : 'מעבר להכנה'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const index = Math.min(at, steps.length - 1);
  const step = steps[index]!;
  const isLast = index === steps.length - 1;
  const minutes = Number(step.minutes) || 0;

  const toggleDone = (i: number) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
        return next;
      }
      next.add(i);
      // §14: marking advances, except on the last step — where advancing would
      // leave the screen with nowhere to go.
      if (i === index && i < steps.length - 1) setAt(i + 1);
      return next;
    });
  };

  const jump = (i: number) => {
    setAt(i);
    stepRef.current?.focus();
  };

  const running = [...timers.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div
      className={fs.focus ? `${styles.wrap} ${styles.focus}` : styles.wrap}
      dir="rtl"
      ref={screenRef}
      style={{ '--cook-text-scale': textScale } as CSSProperties}
    >
      {head}
      {fsNote}

      {/* §14 the progress bar: a segment per step, clickable, green when done */}
      <nav className={styles.bar} aria-label="שלבי ההכנה">
        {steps.map((s, i) => (
          <button
            key={s.id ?? i}
            type="button"
            className={[
              styles.seg,
              done.has(i) ? styles.segDone : '',
              i === index ? styles.segNow : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`שלב ${i + 1}${done.has(i) ? ', הושלם' : ''}`}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => jump(i)}
          />
        ))}
      </nav>

      <p className={styles.count} role="status">
        <span className="ltr">{done.size}</span> מתוך{' '}
        <span className="ltr">{steps.length}</span>{' '}
        {steps.length === 1 ? 'שלבים' : 'שלבים'} הושלמו
      </p>

      {/* The step. tabIndex so a jump can put the focus on it. */}
      <div className={styles.stepBox} ref={stepRef} tabIndex={-1}>
        <span className={styles.stepNum} aria-hidden="true">
          {index + 1}
        </span>
        <p className={styles.stepText}>{step.text || 'שלב בלי תיאור'}</p>

        {/*
          §8: the temperature and the time are the two things read from across
          a bench, so they are chips rather than a line of small print — one
          for each fact the step actually carries. Nothing is invented: a step
          with no temperature gets no temperature chip.
        */}
        {(step.temp || minutes > 0 || step.kind) && (
          <p className={styles.stepMeta}>
            {step.temp ? (
              <span className={styles.chip}>
                <ThermometerIcon />
                <span className="ltr">
                  {step.temp}°{step.tempUnit === 'F' ? 'F' : 'C'}
                </span>
              </span>
            ) : null}
            {minutes > 0 && (
              <span className={styles.chip}>
                <ClockIcon />
                <span>
                  <span className="ltr">{minutes}</span> דק&apos;
                </span>
              </span>
            )}
            {step.kind && <span className={styles.chipQuiet}>{KIND_HE[step.kind] ?? ''}</span>}
          </p>
        )}

        {/*
          §8 asks for ONE primary action on this screen — "סיימתי — לשלב הבא",
          at the foot, where the thumb is. So what is left here is its
          opposite: the line that says the step is already marked, and the way
          to take that back. On an unmarked step this is the same button it
          always was, kept because a cook may want to tick a step off without
          moving on from it (checking a slow bake, or working two steps at
          once) — and because "עיון או חזרה אינם מסמנים שלב כהושלם" means
          marking has to have a control of its own.
        */}
        <button
          type="button"
          className={done.has(index) ? styles.markOn : styles.mark}
          aria-pressed={done.has(index)}
          onClick={() => toggleDone(index)}
        >
          {done.has(index) ? 'השלב מסומן כהושלם · ביטול' : 'סימון השלב כהושלם'}
        </button>

        {/*
          One timer per step — the map is keyed by the step's index and that is
          also what is saved — so both controls are offered only while this
          step has none running.
        */}
        {!timers.has(index) && (
          <div className={styles.timerRow}>
            {minutes > 0 && (
              <button
                type="button"
                className={styles.timerStart}
                onClick={() => {
                  const t = Date.now();
                  // `now` is set from the SAME instant the timer starts.
                  // Without this it still holds the mount time until the first
                  // tick, which is earlier — so `endsAt - now` exceeded the
                  // full duration and a fresh 8-minute timer could read 08:01.
                  setNow(t);
                  unlockAlarm();
                  setTimers((prev) => new Map(prev).set(index, startTimer(minutes, t)));
                }}
              >
                <ClockIcon />
                הפעלת טיימר ל<span className="ltr">{minutes}</span> דק&apos;
              </button>
            )}

            {askOwnTimer ? (
              <form
                className={styles.ownTimer}
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = Number(ownMinutes);
                  if (!Number.isFinite(m) || m <= 0) return;
                  const t = Date.now();
                  setNow(t);
                  unlockAlarm();
                  setTimers((prev) => new Map(prev).set(index, startTimer(m, t)));
                  setOwnMinutes('');
                  setAskOwnTimer(false);
                }}
              >
                <label className={styles.ownLabel} htmlFor="own-timer">
                  דקות
                </label>
                <input
                  id="own-timer"
                  className={styles.ownInput}
                  inputMode="numeric"
                  autoComplete="off"
                  value={ownMinutes}
                  onChange={(e) => setOwnMinutes(e.target.value.replace(/[^\d]/g, ''))}
                />
                <button
                  type="submit"
                  className={styles.timerStart}
                  disabled={Number(ownMinutes) <= 0}
                >
                  הפעלה
                </button>
                <button
                  type="button"
                  className={styles.timerGhost}
                  onClick={() => {
                    setAskOwnTimer(false);
                    setOwnMinutes('');
                  }}
                >
                  ביטול
                </button>
              </form>
            ) : (
              <button
                type="button"
                className={styles.timerGhost}
                onClick={() => setAskOwnTimer(true)}
              >
                <ClockIcon />
                טיימר אישי
              </button>
            )}
          </div>
        )}
      </div>

      {/* §14 the parallel timers, visible from every step */}
      {running.length > 0 && (
        <section className={styles.timers} aria-label="טיימרים">
          {running.map(([i, t]) => {
            const v = viewTimer(t, now);
            return (
              <div
                key={i}
                className={v.done ? styles.timerDone : styles.timer}
                role={v.done ? 'alert' : 'status'}
              >
                <span className={styles.timerStep}>
                  שלב <span className="ltr">{i + 1}</span>
                </span>
                <span className={`${styles.timerClock} ltr`}>{formatClock(v.leftSec)}</span>
                <span className={styles.timerActions}>
                  {!v.done && (
                    <button
                      type="button"
                      className={styles.timerBtn}
                      onClick={() =>
                        setTimers((prev) => new Map(prev).set(i, toggleTimer(t, Date.now())))
                      }
                      aria-label={`${v.running ? 'עצירת' : 'המשך'} הטיימר של שלב ${i + 1}`}
                    >
                      {v.running ? 'עצירה' : 'המשך'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.timerBtn}
                    onClick={() =>
                      setTimers((prev) => {
                        const next = new Map(prev);
                        next.delete(i);
                        return next;
                      })
                    }
                    aria-label={`מחיקת הטיימר של שלב ${i + 1}`}
                  >
                    מחיקה
                  </button>
                </span>
              </div>
            );
          })}
        </section>
      )}

      {/* The ingredients, because a step that says "add the butter" is not
          enough on its own and leaving the screen to check loses your place.

          The SAME rows and the same labels as the Mise en place list above it,
          which is why this list changed: it printed `ing.qty` as written, so
          on a ×2 bake this panel and the weighing list would have shown two
          different numbers for the same ingredient on the same screen. */}
      {rows.length > 0 && (
        <details className={styles.ings}>
          <summary className={styles.ingsSummary}>הרכיבים</summary>
          <ul className={styles.ingsList}>
            {rows.map((row, i) => (
              <li key={miseKeyOf(row, i)} className={styles.ingRow}>
                <span>{row.ing.name || 'רכיב בלי שם'}</span>
                <span className="ltr">{rowLabel(row, 'g', scale.factor, prefs).text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        ── §8: ONE PRIMARY ACTION ──────────────────────────────────────────

        "פעולה ראשית אחת: סיימתי — לשלב הבא. עיון או חזרה אינם מסמנים שלב
        כהושלם."

        The filled button now says what it does and does both halves of it:
        it marks THIS step and moves to the next one. "הבא" used to sit there
        and only browse, which is the confusion the handoff is pointing at —
        pressing the loud button at the bottom of a step you have just
        finished should not leave it unmarked behind you.

        Browsing did not go anywhere: "הקודם" is still there, and the segments
        at the top still jump to any step. Neither marks anything, which is
        the other half of the same rule.
      */}
      <nav className={styles.foot} aria-label="ניווט בין שלבים">
        <button
          type="button"
          className={styles.navBtn}
          disabled={index === 0}
          onClick={() => jump(index - 1)}
        >
          הקודם
        </button>
        {isLast ? (
          <button
            type="button"
            className={styles.finish}
            onClick={() => {
              if (!done.has(index)) toggleDone(index);
              // The bake is over: the checklist should not greet the next one
              // half-ticked. Navigation does not wait on the write — losing a
              // delete is harmless, and blocking the way out of Cook Mode on
              // device storage is not.
              void clearCookProgress(recipe.id);
              navigate(`/recipe/${recipe.id}`);
            }}
          >
            סיימתי — סיום ההכנה
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navNext}`}
            onClick={() => {
              /* Marking already advances (see `toggleDone`), so a step that is
                 not yet marked needs one call and not two — otherwise the
                 screen would move on twice. */
              if (done.has(index)) jump(index + 1);
              else toggleDone(index);
            }}
          >
            סיימתי — לשלב הבא
          </button>
        )}
      </nav>
    </div>
  );
}

const KIND_HE: Record<string, string> = {
  active: 'עבודה',
  passive: 'המתנה',
  chill: 'קירור',
  proof: 'התפחה',
  bake: 'אפייה/בישול',
};
