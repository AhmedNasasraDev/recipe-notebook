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
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import {
  clearCookProgress,
  readCookProgress,
  writeCookProgress,
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
          setStartedSaved(saved.started === true);
        } else {
          setDone(new Set());
          setAt(0);
          setTicks({});
          setStartedSaved(false);
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
    });
  }, [recipeId, restored, done, at, ticks, signature, startedHere, startedSaved]);

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
  const started = startedHere || startedFrom(startedSaved, mise);
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
        <Link to="/notebook" className={styles.exit}>
          ← המחברת
        </Link>
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
        <Link to={`/recipe/${recipe.id}`} className={styles.exit}>
          ← חזרה למתכון
        </Link>
      </div>
    );
  }

  /* ── Mise en place: the first stage, and the only way to the steps ────── */

  /* The gate's own condition, named once: the list is real and not finished. */
  const gateShut = !mise.complete && mise.total > 0;
  const gateWhyId = 'mise-gate-why';
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
      <Link to={`/recipe/${recipe.id}`} className={`${styles.exit} nowrap`}>
        ← יציאה
      </Link>
      <button
        type="button"
        className={styles.fsBtn}
        onClick={() => fs.toggle(screenRef.current)}
        aria-pressed={fs.focus}
      >
        {fs.focus ? 'יציאה ממסך מלא' : 'מסך מלא'}
      </button>
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
              WHY THE BUTTON IS SHUT.
              Ahmed: "אם כפתור ההמשך מושבת, הצג סיבה קצרה וברורה." The count
              above states the fact; this states the rule, and `aria-describedby`
              carries it to anyone who reaches the disabled button by keyboard
              or screen reader instead of seeing the line under it.
            */}
            {gateShut && (
              <p className={styles.gateWhy} id={gateWhyId}>
                כדי להתחיל, סמנו את כל חומרי הגלם. נשארו{' '}
                <span className="ltr">{mise.total - mise.ready}</span>.
              </p>
            )}
            <button
              type="button"
              className={styles.start}
              aria-describedby={gateShut ? gateWhyId : undefined}
              /*
                The gate. Not a link to somewhere else, not a confirmation that
                can be dismissed: while this is disabled the steps are not on
                the page at all, and this is the only thing that puts them
                there.
              */
              disabled={gateShut}
              onClick={() => setStartedHere(true)}
            >
              הכול מוכן — מתחילים בהכנה
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

        <p className={styles.stepMeta}>
          {step.temp ? (
            <>
              <span className="ltr">
                {step.temp}°{step.tempUnit === 'F' ? 'F' : 'C'}
              </span>
              {minutes > 0 && ' · '}
            </>
          ) : null}
          {minutes > 0 && (
            <>
              <span className="ltr">{minutes}</span> דק&apos;
            </>
          )}
          {step.kind && <> · {KIND_HE[step.kind] ?? ''}</>}
        </p>

        <button
          type="button"
          className={done.has(index) ? styles.markOn : styles.mark}
          aria-pressed={done.has(index)}
          onClick={() => toggleDone(index)}
        >
          {done.has(index) ? 'השלב מסומן כהושלם · ביטול' : 'סימון השלב כהושלם'}
        </button>

        {minutes > 0 && !timers.has(index) && (
          <button
            type="button"
            className={styles.timerStart}
            onClick={() => {
              const t = Date.now();
              // `now` is set from the SAME instant the timer starts. Without
              // this it still holds the mount time until the first tick, which
              // is earlier — so `endsAt - now` exceeded the full duration and a
              // fresh 8-minute timer could read 08:01.
              setNow(t);
              setTimers((prev) => new Map(prev).set(index, startTimer(minutes, t)));
            }}
          >
            הפעלת טיימר ל<span className="ltr">{minutes}</span> דק&apos;
          </button>
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
              // The bake is over: the checklist should not greet the next one
              // half-ticked. Navigation does not wait on the write — losing a
              // delete is harmless, and blocking the way out of Cook Mode on
              // device storage is not.
              void clearCookProgress(recipe.id);
              navigate(`/recipe/${recipe.id}`);
            }}
          >
            סיום ההכנה
          </button>
        ) : (
          <button
            type="button"
            /* The step you are most likely to want is the filled one: the
               way forward reads as the action, the way back as an option. */
            className={`${styles.navBtn} ${styles.navNext}`}
            onClick={() => jump(index + 1)}
          >
            הבא
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
