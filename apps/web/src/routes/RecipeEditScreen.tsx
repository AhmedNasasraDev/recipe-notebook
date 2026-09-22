// Create and edit a recipe.
//
// This screen closes the gap stage 3 left open: a signed-in account could
// sign in, answer the onboarding, and then had no way to put anything in its
// notebook.
//
// Three things shape it.
//
// 1. **Every numeric field is a string.** See the long note in draft.ts. It is
//    what keeps NULL and 0 distinguishable from the keyboard to the column.
//
// 2. **The live preview runs the real engine.** Not a simplified copy of it —
//    `compute()` and `calcState()`, the same two calls the recipe page makes,
//    against the draft as it stands. So the totals in the editor and the totals
//    after saving cannot disagree, and a row that will be unweighable says so
//    while the user is still typing and can fix it.
//
// 3. **Nothing is invented to make the preview look complete.** A row with no
//    reliable density shows a dash and the reason, and the partial notice names
//    it. The way out is offered — a personal calibration, or switching the row
//    to grams — and neither is a guessed number.
//
// Accessibility: every control has its own accessible name, and per-row
// controls carry the ingredient's name ("הסרת קמח לבן", not "הסרה"), because a
// screen-reader user navigating by name otherwise gets a list of identical
// buttons.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { SavedButNotReloadedError } from '../data/repository.js';
import { useUnsavedGuard } from '../shell/UnsavedGuard.js';
import { BackButton, BackControl } from '../components/BackLink.js';
import { RecipeImages } from '../features/images/RecipeImages.js';
import { useRecipeImages } from '../features/images/useRecipeImages.js';
import { useGoBack } from '../shell/navigation.js';
import {
  GN_SIZES,
  PAN_KINDS,
  UNITS,
  compute,
  formatGrams,
  formatNis,
  ingredientKeyOf,
  panLabel,
  type Recipe,
} from '@recipe-notebook/engine';
import type { StepKind } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { STEP_KINDS } from '../features/planning/timeline.js';
import { SourceBadge } from '../components/SourceBadge.js';
import { CalibrateSheet } from '../features/recipe/CalibrateSheet.js';
import { calcState } from '../features/recipe/completeness.js';
import { versionDiff } from '../features/recipe/versionDiff.js';
import { subRecipeOptions } from '../features/recipe/subRecipe.js';
import {
  catalogByKey,
  priceOriginOf,
  resolveFromCatalog,
} from '../features/pricing/catalog.js';
import {
  draftFromRecipe,
  draftToRecipe,
  emptyDraft,
  emptyIngredient,
  emptyStep,
  isDirty,
  moveRow,
  panFromDraft,
  patchIngredientRow,
  validateDraft,
  type ValidationMode,
  isBlankIngredient,
  type IngredientDraft,
  type RecipeDraft,
  type StepDraft,
} from '../features/recipe/draft.js';
import styles from './RecipeEditScreen.module.css';

const PRICE_UNITS = ['ק"ג', 'ליטר', "יח'"] as const;

/** The unit picker, grouped so weight units are the obvious default. */
const UNIT_GROUPS = [
  { label: 'משקל', ids: ['g', 'kg', 'mg', 'oz'] },
  { label: 'נפח', ids: ['ml', 'l', 'cup', 'tbsp', 'tsp', 'floz'] },
  { label: 'ספירה', ids: ['unit', 'egg', 'fruit', 'slice'] },
] as const;

/** §6's four stages, in the handoff's own words. */
const STAGES = ['פרטים', 'חומרי גלם', 'אופן ההכנה', 'סיכום'] as const;

/**
 * Which stage holds the field a problem is about.
 *
 * §6 asks for validation BESIDE THE FIELD, and in a wizard that is only true
 * if the refusal takes you to the stage the field is on: a missing name
 * reported while the summary is on screen is a message about something the
 * reader cannot see. So a refused save jumps to the first problem's stage.
 */
function stageOfField(field: string): number {
  if (field.startsWith('ingredient')) return 1;
  if (field.startsWith('step')) return 2;
  if (
    [
      'yieldUnits',
      'unitWeight',
      'yieldActual',
      'targetFC',
      'salePrice',
      'packagingCost',
      'laborCost',
      'otherCost',
      'targetGM',
      'weightBefore',
      'weightAfter',
    ].includes(field)
  ) {
    return 3;
  }
  // name, category, tags, isSub — the first stage.
  return 0;
}

export function RecipeEditScreen() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    recipes,
    categories,
    prefs,
    capabilities,
    saveRecipe,
    setCalibrations,
    ready,
    catalog,
    listRecipeImages,
    addRecipeImage,
    removeRecipeImage,
    replaceRecipeImage,
    setRecipeImageFocus,
    signedImageUrl,
  } = useAppData();

  /*
    ── THE PHOTOGRAPH, ON STAGE 1 ──────────────────────────────────────────

    Two states, because a recipe that exists and a recipe that does not are
    genuinely different problems:

      an EXISTING recipe   the same `RecipeImages` gallery the recipe page
                           uses, against the same repository. An upload is
                           immediate and real, and removing one removes one.
      a NEW recipe         there is no row to hang a file on and no storage
                           path to put it at, so the chosen file waits here
                           and `onSave` uploads it as soon as the save returns
                           an id. The card says so rather than pretending.

    `pendingPhoto` is a File and `pendingUrl` is the object URL used to show
    it — revoked when it is replaced or cleared, because an object URL that is
    never revoked is a leak that survives every navigation.
  */
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const holdPhoto = (file: File | null) => {
    setPhotoError(null);
    setPendingUrl((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return file === null ? null : URL.createObjectURL(file);
    });
    setPendingPhoto(file);
  };

  const editorImages = useRecipeImages({
    recipeId: recipeId ?? '',
    list: listRecipeImages,
    add: addRecipeImage,
    remove: removeRecipeImage,
    replace: replaceRecipeImage,
    sign: signedImageUrl,
    focus: setRecipeImageFocus,
  });

  const isNew = !recipeId;
  const existing = useMemo(
    () => (recipeId ? (recipes.find((r) => r.id === recipeId) ?? null) : null),
    [recipeId, recipes],
  );

  const [draft, setDraft] = useState<RecipeDraft>(() => emptyDraft());
  const [original, setOriginal] = useState<RecipeDraft>(() => emptyDraft());
  const [loaded, setLoaded] = useState(isNew);
  /*
    UX PASS: THE MESSAGES GO WHERE THE MISTAKE IS, AND THEY FOLLOW THE FIX.

    `validateDraft` has always returned a FIELD with every message and the
    screen threw it away, printing a list at the top of a form that can be
    1,500 lines long — so "צריך לפחות רכיב אחד" appeared a screen and a half
    from the ingredients.

    Now the list is still there (it is what a screen reader is sent to, and it
    is the one place that shows everything at once) AND each message is printed
    beside its own field. Validation runs live once a save has been attempted,
    so a message disappears the moment the field is right instead of waiting
    for the next press. Nothing the user typed is ever cleared by a failed
    validation.
  */
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calibrateFor, setCalibrateFor] = useState<string | null>(null);
  const [showProduction, setShowProduction] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Load once. Re-seeding the form from `recipes` on every change would discard
  // what the user is typing the moment anything else refreshes the list.
  useEffect(() => {
    if (isNew || loaded) return;
    if (!ready) return;
    if (existing) {
      const d = draftFromRecipe(existing);
      setDraft(d);
      setOriginal(d);
      setLoaded(true);
    }
  }, [isNew, loaded, ready, existing]);

  // §6 / §18.7: an approved production formula is not edited by accident.
  const lockedBlock = existing?.locked === true;

  const dirty = isDirty(draft, original);

  /** Live once a save has been attempted; silent before that. */
  const problems = submitted ? validateDraft(draft) : [];
  const problemFor = (field: string): string | null =>
    problems.find((p) => p.field === field)?.message ?? null;
  /*
    `validateDraft` numbers ingredient problems by their position among the
    NON-BLANK rows — the rows that will actually be saved — while the form is
    indexed by the rows on screen, blanks included. This maps one to the other,
    so a message lands on the row it is about.
  */
  const savedRowIndexes = draft.ingredients
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !isBlankIngredient(row))
    .map(({ i }) => i);
  const rowProblem = (index: number, key?: string): string | null => {
    const n = savedRowIndexes.indexOf(index);
    if (n < 0) return null;
    return problemFor(key ? `ingredient-${n}-${key}` : `ingredient-${n}`);
  };

  // Every way out asks first: the tab bar, the back control, a reload, a
  // closed tab (shell/UnsavedGuard.tsx). ביטול below asks the same question.
  useUnsavedGuard(dirty);

  // The preview. Built from the draft exactly as it will be saved, so what is
  // on screen is what the recipe page will show afterwards.
  const previewRecipe = useMemo<Recipe>(() => draftToRecipe(draft), [draft]);
  // Prices resolved from the ingredient centre, exactly as the recipe page
  // does it — otherwise the editor would show a cost of nothing for every
  // material whose price lives in the centre, and the two screens would
  // disagree about the same recipe.
  const pricedPreview = useMemo(
    () => resolveFromCatalog(previewRecipe, catalog),
    [previewRecipe, catalog],
  );
  const pricedNotebook = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );
  const byKey = useMemo(() => catalogByKey(catalog), [catalog]);
  const computed = useMemo(
    () => compute(pricedPreview, [...pricedNotebook, pricedPreview], { prefs }),
    [pricedPreview, pricedNotebook, prefs],
  );
  const calc = calcState(computed);
  const pro = prefs.pro === true;
  /** §7: which geometry fields the chosen pan kind asks for, and no others. */
  const panFields: readonly string[] =
    PAN_KINDS.find((k) => k.id === draft.pan.kind)?.fields ?? [];

  const patch = (p: Partial<RecipeDraft>) => setDraft((d) => ({ ...d, ...p }));

  const patchIngredient = (index: number, p: Partial<IngredientDraft>) =>
    setDraft((d) => ({
      ...d,
      // `patchIngredientRow`, not a spread: it keeps the row's stored identity
      // (`ingredientKey`) across a quantity or price edit and clears it only on
      // a real rename.
      ingredients: d.ingredients.map((row, i) => (i === index ? patchIngredientRow(row, p) : row)),
    }));

  /**
   * The sub-recipe choices for one row.
   *
   * `pendingLinks` carries the OTHER rows' links from this unsaved draft, so a
   * cycle the user is building right now is caught before the save rather than
   * by the database afterwards. The row being edited is excluded, or it would
   * be seen as conflicting with itself.
   */
  const subOptionsFor = (rowIndex: number) =>
    subRecipeOptions({
      parentId: recipeId ?? '',
      recipes,
      pendingLinks: draft.ingredients
        .map((row, i) => ({ row, i }))
        .filter(({ row, i }) => i !== rowIndex && row.subId !== '')
        .map(({ row }) => ({ parentId: recipeId ?? '', subId: row.subId })),
    });

  const patchStep = (index: number, p: Partial<StepDraft>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((row, i) => (i === index ? { ...row, ...p } : row)),
    }));

  /**
   * The one save path, for both kinds of save.
   *
   * `mode` decides what is REQUIRED and where you end up — a draft keeps you
   * in the editor on the stage you were on, a finished recipe goes to its
   * page. Everything else is what it always was: the same `saveRecipe`, the
   * same concurrency token, the same version note.
   */
  const onSave = async (mode: ValidationMode = 'final') => {
    setSaveError(null);
    setDraftSaved(false);
    setSubmitted(true);
    const found = validateDraft(draft, mode);
    if (found.length > 0) {
      // To the stage that holds the first problem — see `stageOfField`.
      const first = found[0];
      if (first) setStage(stageOfField(first.field));
      errorRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      // §9 + requirement 1: the previous state is snapshotted by the server,
      // and `versionDiff` describes the change. Both are computed here because
      // this is the only place that holds the recipe before AND after.
      const next = draftToRecipe(draft);
      const note = existing
        ? versionDiff({ before: existing, after: next, recipes, prefs })
        : '';

      const saved = await saveRecipe(next, {
        versionNote: note,
        // Optimistic concurrency: the token from the row this form loaded. If
        // somebody else saved in between, the server refuses rather than
        // overwriting their work.
        expectedUpdatedAt: (existing?.['updatedAt'] as string | undefined) ?? null,
      });
      // Replace the baseline before navigating, so the unsaved-changes guard
      // does not fire on a form that was just saved successfully.
      setOriginal(draftFromRecipe(saved));

      /*
        THE PHOTOGRAPH CHOSEN BEFORE THERE WAS A RECIPE TO PUT IT ON.

        A new recipe has no id and no storage path until this moment, so a
        file picked on stage 1 was held in memory. Now there is a row, so it
        goes up.

        Awaited, and its failure is reported without losing the save: the
        recipe IS saved by this point, and telling somebody their recipe
        failed because a photo did is worse than telling them the photo
        failed. The file stays in state on a failure, so pressing save again
        retries the upload rather than the recipe.
      */
      if (pendingPhoto !== null) {
        try {
          await addRecipeImage(saved.id, pendingPhoto);
          setPendingPhoto(null);
          setPhotoError(null);
        } catch (e: unknown) {
          setPhotoError(
            e instanceof Error
              ? `המתכון נשמר, אבל העלאת התמונה נכשלה: ${e.message}`
              : 'המתכון נשמר, אבל העלאת התמונה נכשלה.',
          );
          /* Stay in the editor so the message is read and the retry is one
             press away, instead of navigating away from the only place that
             still holds the file. */
          if (mode !== 'draft') {
            setDraftSaved(false);
            if (isNew) {
              navigate(`/recipe/${saved.id}/edit`, { replace: true, state: { stage } });
            }
            return;
          }
        }
      }

      if (mode === 'draft') {
        /*
          A draft keeps the editor open. For a recipe that did not exist yet
          the address has to become the one that edits THE SAVED ROW —
          otherwise the next save would create a second recipe — and the stage
          travels with it so the person is put back where they were rather
          than at the beginning.
        */
        setDraftSaved(true);
        setSubmitted(false);
        if (isNew) {
          navigate(`/recipe/${saved.id}/edit`, {
            replace: true,
            state: { stage, draftSaved: true },
          });
        }
        return;
      }
      /*
        UX PASS: say that it worked. The form used to navigate away in silence,
        which on a slow connection is indistinguishable from nothing having
        happened. The recipe page shows the line and then forgets it — it is in
        the navigation, not in storage, so a reload does not repeat it.
      */
      navigate(`/recipe/${saved.id}`, {
        replace: true,
        state: { saved: isNew ? 'created' : 'updated' },
      });
    } catch (e) {
      /*
        The write succeeded and only the read-back failed (data/repository.ts).
        Staying here with "the save failed" would invite a second press and a
        second recipe, so this leaves for the recipe's own page, which reads
        it afresh, and says what happened there.
      */
      if (e instanceof SavedButNotReloadedError) {
        setOriginal(draft);
        navigate(`/recipe/${e.recipeId}`, {
          replace: true,
          state: { saved: isNew ? 'created' : 'updated', reloadFailed: true },
        });
        return;
      }
      setSaveError(e instanceof Error ? e.message : 'השמירה נכשלה.');
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  /*
    ── §6: A REAL WIZARD, ONE STAGE AT A TIME ───────────────────────────

    פרטים · חומרי גלם · אופן ההכנה · סיכום. Only the stage you are on is on
    the screen; the stepper above shows where you are and takes you anywhere.

    WHAT MAKES THAT SAFE, WHICH IS THE WHOLE DESIGN:

      · ONE DRAFT, ALWAYS MOUNTED. `draft` holds the entire recipe and lives
        above the stages, so moving between them is a change of what is
        RENDERED and never of what is held. Nothing typed can be lost by
        going back, forward, or straight to the summary.
      · ONE SAVE PATH. `onSave` is the same function it was, with the same
        concurrency token and the same version note. The wizard decides WHEN
        it is offered, not how it works.
      · PARTIAL DRAFTS ARE ALLOWED, AND SAY SO. A draft needs a name and
        numbers that are numbers; a finished recipe still needs at least one
        ingredient (see `validateDraft(draft, 'draft' | 'final')`). Saving a
        draft keeps you in the editor, on the stage you were on.
      · PHOTOGRAPHS ARE IN HERE NOW, on the first stage, because Ahmed asked
        for them there: "ביצירת מתכון ובעריכתו אפשר להעלות תמונה, להחליף
        אותה… ולהסיר אותה." For a recipe that EXISTS this is the same
        component the recipe page uses, doing the same immediate upload — so
        there is still nothing for a stage change to lose. For a recipe that
        does not exist yet there is no row to attach a file to and no path to
        upload it under, so the file waits in `pendingPhoto` and is uploaded
        the moment the first save returns an id. That is the honest shape of
        it: the picture cannot be stored before the recipe is.
  */
  const stageRefs = useRef<(HTMLElement | null)[]>([null, null, null, null]);
  const startStage = (location.state as { stage?: number } | null)?.stage ?? 0;
  /*
    "הטיוטה נשמרה", shown after a real draft save and cleared on the next
    edit. It arrives through the navigation for a recipe that did not exist
    yet: saving its first draft changes the address from /recipe/new to the
    row's own edit URL, which remounts this screen — so the notice and the
    stage travel with it rather than being lost in the move.
  */
  const [draftSaved, setDraftSaved] = useState(
    (location.state as { draftSaved?: boolean } | null)?.draftSaved === true,
  );
  const [stage, setStage] = useState(
    Number.isInteger(startStage) && startStage >= 0 && startStage <= 3 ? startStage : 0,
  );

  const goToStage = (i: number) => {
    setStage(i);
    /*
      A stage change is a new screen, so it starts at the top — otherwise
      stage 3 opens halfway down because stage 2 was scrolled. Optional call:
      jsdom has neither `scrollTo` nor a layout.
    */
    window.scrollTo?.({ top: 0 });
    document.querySelector('[class*="content"]')?.scrollTo?.({ top: 0 });
  };

  /*
    Cancel is the editor's way back, and it keeps the guard it already had —
    Ahmed: "הגן על שינויים שלא נשמרו באמצעות המנגנון הקיים." What changed is
    only the DESTINATION: it used to be hard-coded, and now it is the same
    answer every other screen gets. `useGoBack`'s fallback is `parentOf`,
    which for `/recipe/:id/edit` is that recipe and for `/recipe/new` is the
    notebook — the two addresses this line used to name — so nothing moved
    except that arriving here from Home now returns to Home.
  */
  const goBack = useGoBack();
  const onCancel = () => {
    if (dirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return;
    if (goBack) goBack();
    else navigate(recipeId ? `/recipe/${recipeId}` : '/notebook');
  };

  if (!isNew && !loaded) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>
          {ready ? 'המתכון הזה לא נמצא במחברת.' : 'טוען…'}
        </p>
        <BackControl>המחברת</BackControl>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <BackButton onClick={onCancel}>ביטול</BackButton>
        <h1 className={styles.screenTitle}>{isNew ? 'מתכון חדש' : 'עריכת מתכון'}</h1>
      </div>

      <nav className={styles.stepper} aria-label="שלבי המתכון">
        {STAGES.map((label, i) => (
          <button
            key={label}
            type="button"
            className={[
              styles.stageBtn,
              i === stage ? styles.stageOn : '',
              i < stage ? styles.stagePast : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={i === stage ? 'step' : undefined}
            /* The visible text is the stage's name; the accessible name adds
               which stage of how many — and CONTAINS the visible words, which
               is what WCAG 2.5.3 asks of a label. */
            aria-label={`שלב ${i + 1} מתוך ${STAGES.length} — ${label}`}
            onClick={() => goToStage(i)}
          >
            <span className={styles.stageNum} aria-hidden="true">
              {i + 1}
            </span>
            <span className={styles.stageLabel}>{label}</span>
          </button>
        ))}
      </nav>

      {!capabilities.canWrite && (
        <p className={styles.blockedBox} role="status">
          {capabilities.source === 'local-demo'
            ? 'אין חיבור לשרת בהתקנה הזאת, ולכן אי אפשר לשמור. אפשר למלא ולראות את החישוב, אבל השמירה תסורב.'
            : 'אין כרגע חיבור לאינטרנט, ולכן אי אפשר לשמור.'}
        </p>
      )}

      {lockedBlock && (
        <p className={styles.blockedBox} role="status">
          המתכון הזה מסומן כנוסחה מאושרת לייצור. עריכה שלו משנה נוסחה שאושרה —
          כדאי לשכפל אותו ולערוך את העותק.
        </p>
      )}

      <div
        ref={errorRef}
        tabIndex={-1}
        className={styles.errorSlot}
        aria-live="polite"
      >
        {problems.length > 0 && (
          <div className={styles.errorBox} role="alert">
            <p className={styles.errorTitle}>לא ניתן לשמור עדיין:</p>
            <ul>
              {problems.map((p) => (
                <li key={p.field}>· {p.message}</li>
              ))}
            </ul>
          </div>
        )}
        {saveError && (
          <p className={styles.errorBox} role="alert">
            {saveError}
          </p>
        )}
      </div>

      {/* STAGE 1 — פרטים */}
      {stage === 0 && (
        <>
        {/* ── identity ───────────────────────────────────────────────────── */}
        <section
          className={styles.card}
          ref={(el) => {
            stageRefs.current[0] = el;
          }}
        >
          <h2 className={styles.cardTitle}>
            <span className={styles.stepNum} aria-hidden="true">1</span>
            פרטים בסיסיים
          </h2>

          <div className={styles.field}>
            {/* The chip is decoration and is hidden from assistive tech, which
                is told the same thing properly through `aria-required` — putting
                the word inside the label would rename the field to
                "שם המתכון חובה". The row keeps the two on one line: as a bare
                sibling in a flex column the chip stretched the width of the
                field and sat on top of it. */}
            <span className={styles.labelRow}>
              <label className={styles.label} htmlFor="r-name">
                שם המתכון
              </label>
              <span className={styles.required} aria-hidden="true">
                חובה
              </span>
            </span>
            <input
              id="r-name"
              className={styles.input}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="למשל: בריוש נאנטר"
              aria-required="true"
              aria-invalid={problemFor('name') !== null}
              {...(problemFor('name') ? { 'aria-describedby': 'r-name-error' } : {})}
            />
            {problemFor('name') && (
              <p id="r-name-error" className={styles.fieldError}>
                {problemFor('name')}
              </p>
            )}
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-category">
                קטגוריה
              </label>
              <select
                id="r-category"
                className={styles.select}
                value={draft.category}
                onChange={(e) => patch({ category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-tags">
                תגים
              </label>
              <input
                id="r-tags"
                className={styles.input}
                value={draft.tags}
                onChange={(e) => patch({ tags: e.target.value })}
                placeholder="מופרדים בפסיק"
              />
            </div>
          </div>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={draft.isSub}
              onChange={(e) => patch({ isSub: e.target.checked })}
            />
            <span>
              מתכון בסיס
              <span className={styles.hint}>
                נמדד במשקל בתוך מתכונים אחרים, ולא מומר לנפח (§18.6)
              </span>
            </span>
          </label>
        </section>

        {/*
          ── THE PHOTOGRAPH ─────────────────────────────────────────────────

          Ahmed: "ביצירת מתכון ובעריכתו אפשר להעלות תמונה, להחליף אותה,
          להתאים חיתוך או מיקום ולהסיר אותה."

          Three of the four are here. The fourth — the position — is on the
          recipe page, on the hero itself, because that is the box the crop
          actually happens in: adjusting it against a thumbnail in a form
          would be adjusting it against the wrong shape.
        */}
        <section className={styles.card} aria-label="תמונת המתכון">
          <h2 className={styles.cardTitle}>תמונה</h2>
          {isNew ? (
            <>
              <p className={styles.hint}>
                אפשר לבחור תמונה עכשיו — היא תועלה ברגע שהמתכון יישמר בפעם
                הראשונה, כי לפני זה אין עוד מתכון לשמור אותה עליו.
              </p>
              {pendingUrl !== null && (
                <img className={styles.photoPreview} src={pendingUrl} alt="" aria-hidden="true" />
              )}
              <div className={styles.photoRow}>
                <label className={styles.photoPick}>
                  {pendingPhoto === null ? 'בחירת תמונה' : 'החלפת התמונה'}
                  <input
                    type="file"
                    accept="image/*"
                    className="visuallyHidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      holdPhoto(file);
                      /* So picking the same file twice still fires a change. */
                      e.target.value = '';
                    }}
                  />
                </label>
                {pendingPhoto !== null && (
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => holdPhoto(null)}
                  >
                    הסרת הבחירה
                  </button>
                )}
              </div>
              {pendingPhoto !== null && (
                <p className={styles.hint}>
                  נבחר: <span className="ltr">{pendingPhoto.name}</span>
                </p>
              )}
            </>
          ) : (
            /*
              An existing recipe gets the real gallery, against the real
              repository — the same component and the same code path the
              recipe page uses, so an upload here is an upload, not a
              staging area. `canEdit` is ownership: a group recipe is not
              the reader's to re-photograph.
            */
            <RecipeImages
              state={editorImages}
              canWrite={capabilities.canWrite}
              canEdit={!existing?.['group_id']}
            />
          )}
          {photoError !== null && (
            <p className={styles.saveWhy} role="alert">
              {photoError}
            </p>
          )}
        </section>

        </>
      )}

      {/* STAGE 2 — חומרי גלם, with the live calculation beside them */}
      {stage === 1 && (
        <>
        {/* ── ingredients ────────────────────────────────────────────────── */}
        <section
          className={styles.card}
          ref={(el) => {
            stageRefs.current[1] = el;
          }}
        >
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>
              <span className={styles.stepNum} aria-hidden="true">2</span>
              רכיבים
              <span className={styles.required} aria-hidden="true">
                חובה
              </span>
            </h2>
            <span className={styles.countHint}>
              {draft.ingredients.length === 1 ? 'שורה אחת' : `${draft.ingredients.length} שורות`}
            </span>
          </div>

          <ul className={styles.rows}>
            {draft.ingredients.map((row, i) => {
              const label = row.name.trim() || `רכיב ${i + 1}`;
              const computedRow = computed.rows.find((r) => r.ing.id === row.key);
              const unresolved = computedRow ? computedRow.g === null : false;
              const needsDensity =
                unresolved && row.qty.trim() !== '' && row.name.trim() !== '';

              return (
                <li key={row.key} className={styles.ingCard}>
                  <div className={styles.ingHead}>
                    <span className={styles.ingIndex} aria-hidden="true">
                      {i + 1}
                    </span>
                    <input
                      className={`${styles.input} ${styles.ingName}`}
                      value={row.name}
                      onChange={(e) => patchIngredient(i, { name: e.target.value })}
                      placeholder="שם הרכיב"
                      aria-label={`שם הרכיב בשורה ${i + 1}`}
                      aria-invalid={rowProblem(i) !== null}
                    />
                    <div className={styles.rowTools}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`העלאת ${label} למעלה`}
                        disabled={i === 0}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            ingredients: moveRow(d.ingredients, i, i - 1),
                          }))
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`הורדת ${label} למטה`}
                        disabled={i === draft.ingredients.length - 1}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            ingredients: moveRow(d.ingredients, i, i + 1),
                          }))
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtnDanger}
                        aria-label={`הסרת ${label}`}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            ingredients: d.ingredients.filter((_, x) => x !== i),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {rowProblem(i) && <p className={styles.fieldError}>{rowProblem(i)}</p>}

                  <div className={styles.ingGrid}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`q-${row.key}`}>
                        כמות
                      </label>
                      <input
                        id={`q-${row.key}`}
                        className={`${styles.input} ltr`}
                        inputMode="decimal"
                        value={row.qty}
                        onChange={(e) => patchIngredient(i, { qty: e.target.value })}
                        aria-label={`כמות של ${label}`}
                        aria-invalid={rowProblem(i, 'qty') !== null}
                      />
                      {rowProblem(i, 'qty') && (
                        <p className={styles.fieldError}>{rowProblem(i, 'qty')}</p>
                      )}
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`u-${row.key}`}>
                        יחידה
                      </label>
                      <select
                        id={`u-${row.key}`}
                        className={styles.select}
                        value={row.unit}
                        onChange={(e) => patchIngredient(i, { unit: e.target.value })}
                        aria-label={`יחידת המדידה של ${label}`}
                      >
                        {UNIT_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.ids.map((id) => {
                              const u = UNITS.find((x) => x.id === id);
                              return u ? (
                                <option key={id} value={id}>
                                  {u.he}
                                </option>
                              ) : null;
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* What the engine makes of this row, right now. */}
                  <div
                    className={styles.ingResult}
                    aria-label={`המשקל המחושב של ${label}`}
                  >
                    {computedRow && !unresolved ? (
                      <>
                        <span className="ltr">{formatGrams(computedRow.g ?? 0)}</span>
                        {computedRow.provenance.source !== 'exact' && (
                          <SourceBadge provenance={computedRow.provenance} />
                        )}
                      </>
                    ) : (
                      <span className={styles.ingMissing}>
                        {row.name.trim() === '' || row.qty.trim() === ''
                          ? 'יש להשלים שם וכמות'
                          : (computedRow?.provenance.why ?? 'אין נתון אמין')}
                      </span>
                    )}
                  </div>

                  {needsDensity && (
                    <div className={styles.fixRow}>
                      <button
                        type="button"
                        className={styles.fixBtn}
                        onClick={() => setCalibrateFor(row.name.trim())}
                        aria-label={`כיול אישי של ${label}`}
                      >
                        לכייל אצלי במטבח
                      </button>
                      <button
                        type="button"
                        className={styles.fixBtnGhost}
                        onClick={() => patchIngredient(i, { unit: 'g' })}
                        aria-label={`מדידת ${label} בגרמים`}
                      >
                        לשקול בגרמים
                      </button>
                    </div>
                  )}

                  {/*
                    Open by default when the row IS linked to a base recipe.
                    The link changes how the row is measured and costed (§18.6:
                    weighed, never volume-converted, cost rolled up from the
                    base), and a collapsed row gave no sign of it at all — so the
                    most consequential field on the row was also the most hidden.
                    The summary names the base for the same reason.
                  */}
                  <details className={styles.more} open={row.subId !== ''}>
                    <summary className={styles.moreSummary}>
                      פרטים נוספים ל{label}
                      {row.subId !== '' && (
                        <span className={styles.moreSub}>
                          {' · מתכון בסיס: '}
                          {recipes.find((r) => r.id === row.subId)?.name ?? row.subId}
                        </span>
                      )}
                    </summary>
                    <div className={styles.ingGrid}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`p-${row.key}`}>
                          מחיר
                        </label>
                        <input
                          id={`p-${row.key}`}
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={row.price}
                          onChange={(e) => patchIngredient(i, { price: e.target.value })}
                          aria-label={`מחיר של ${label}`}
                        />
                        {/*
                          Where this row's price comes from (stage-7 requirement 2).
                          Without this the field is simply empty on a row that
                          HAS a price — from the centre — and the user cannot tell
                          that from a row nobody has priced at all.
                        */}
                        <p
                          className={styles.hint}
                          aria-label={`מקור המחיר של ${label}`}
                        >
                          {(() => {
                            const origin = priceOriginOf(
                              previewRecipe.ingredients?.[i] ?? {},
                              byKey,
                            );
                            if (origin === 'own') {
                              return 'מחיר שהוזן במתכון הזה. הוא גובר על המחיר שבמרכז חומרי הגלם.';
                            }
                            if (origin === 'catalog') {
                              const hit = byKey.get(
                                ingredientKeyOf(previewRecipe.ingredients?.[i] ?? {}),
                              );
                              return `מחיר מהמרכז: ${formatNis(hit?.price ?? 0)} ל${hit?.priceUnit}. שדה ריק כאן פירושו שהמחיר מתעדכן משם.`;
                            }
                            if (row.subId) {
                              return 'שורת תת־מתכון — העלות מתגלגלת מהמתכון המקושר ואין לה מחיר משלה.';
                            }
                            return 'אין מחיר לחומר הגלם הזה, לא כאן ולא במרכז חומרי הגלם.';
                          })()}
                        </p>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`pu-${row.key}`}>
                          ליחידת מחיר
                        </label>
                        <select
                          id={`pu-${row.key}`}
                          className={styles.select}
                          value={row.priceUnit}
                          onChange={(e) => patchIngredient(i, { priceUnit: e.target.value })}
                          aria-label={`יחידת המחיר של ${label}`}
                          aria-invalid={rowProblem(i, 'priceUnit') !== null}
                        >
                          <option value="">—</option>
                          {PRICE_UNITS.map((pu) => (
                            <option key={pu} value={pu}>
                              {pu}
                            </option>
                          ))}
                        </select>
                        {rowProblem(i, 'priceUnit') && (
                          <p className={styles.fieldError}>{rowProblem(i, 'priceUnit')}</p>
                        )}
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`d-${row.key}`}>
                          צפיפות, גרם ל-100 מ&quot;ל
                        </label>
                        <input
                          id={`d-${row.key}`}
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={row.gPer100}
                          onChange={(e) => patchIngredient(i, { gPer100: e.target.value })}
                          aria-label={`צפיפות של ${label}`}
                          placeholder="ריק = לפי הטבלה"
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`uw-${row.key}`}>
                          משקל ליחידה
                        </label>
                        <input
                          id={`uw-${row.key}`}
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={row.unitWeight}
                          onChange={(e) => patchIngredient(i, { unitWeight: e.target.value })}
                          aria-label={`משקל ליחידה של ${label}`}
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`w-${row.key}`}>
                          אחוז מים
                        </label>
                        <input
                          id={`w-${row.key}`}
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={row.waterPct}
                          onChange={(e) => patchIngredient(i, { waterPct: e.target.value })}
                          aria-label={`אחוז מים של ${label}`}
                          placeholder="ריק = לפי הטבלה"
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`n-${row.key}`}>
                          הערה
                        </label>
                        <input
                          id={`n-${row.key}`}
                          className={styles.input}
                          value={row.note}
                          onChange={(e) => patchIngredient(i, { note: e.target.value })}
                          aria-label={`הערה על ${label}`}
                        />
                      </div>
                    </div>

                    {/* ── sub-recipe link (requirements 11-15) ──────────── */}
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`sub-${row.key}`}>
                        מתכון בסיס
                      </label>
                      <select
                        id={`sub-${row.key}`}
                        className={styles.select}
                        value={row.subId}
                        onChange={(e) => patchIngredient(i, { subId: e.target.value })}
                        aria-label={`מתכון בסיס עבור ${label}`}
                      >
                        <option value="">לא מקושר למתכון אחר</option>
                        {subOptionsFor(i).map((o) => (
                          <option key={o.id} value={o.id} disabled={o.rejection !== null}>
                            {o.name}
                            {o.isSub ? ' (בסיס)' : ''}
                            {o.rejection !== null ? ` — ${o.reason}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className={styles.hint}>
                        {row.subId
                          ? 'הכמות נמדדת במשקל והעלות מתגלגלת מהמתכון המקושר (§18.6). שורה כזאת אינה מומרת לנפח.'
                          : 'רק מתכונים מהמחברת שלכם מוצעים כאן, והמסד חוסם קישור למתכון של חשבון אחר או קישור שיוצר מעגל.'}
                      </p>
                    </div>
                    <div className={styles.checkPair}>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={row.flour}
                          onChange={(e) => patchIngredient(i, { flour: e.target.checked })}
                          aria-label={`${label} נחשב קמח לנוסחת האופה`}
                        />
                        <span>קמח — נכנס לנוסחת האופה</span>
                      </label>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={row.liquid}
                          onChange={(e) => patchIngredient(i, { liquid: e.target.checked })}
                          aria-label={`${label} נחשב נוזל להידרציה`}
                        />
                        <span>נוזל — נכנס להידרציה</span>
                      </label>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>

          {problemFor('ingredients') && (
            <p className={styles.fieldError}>{problemFor('ingredients')}</p>
          )}

          {/* The `+` is decorative. Without an explicit label a screen reader
              announces "plus hosafat rakiv", and the two add buttons on this
              screen would differ only by that leading glyph. */}
          <button
            type="button"
            className={styles.addBtn}
            aria-label="הוספת רכיב"
            onClick={() =>
              setDraft((d) => ({ ...d, ingredients: [...d.ingredients, emptyIngredient()] }))
            }
          >
            <span aria-hidden="true">+ </span>הוספת רכיב
          </button>
        </section>

        {/* ── live calculation, requirement 11 ───────────────────────────── */}
        <section className={styles.card} aria-label="החישוב בזמן העריכה">
          <h2 className={styles.cardTitle}>מה יוצא מזה</h2>

          {calc.level === 'full' ? (
            <p className={styles.calcFull} role="status" aria-label="שלמות החישוב">
              חישוב מלא — לכל הרכיבים יש נתון אמין.
            </p>
          ) : (
            <div
              className={calc.level === 'none' ? styles.calcNoneBox : styles.calcPartialBox}
              role="status"
              aria-label="שלמות החישוב"
            >
              <p className={styles.calcNoticeTitle}>
                {calc.level === 'none' ? 'לא ניתן לחשב' : 'נתונים חלקיים'}
              </p>
              <p className={styles.calcNoticeBody}>{calc.summary}</p>
              {calc.missingNames.length > 0 && (
                <p className={styles.calcNoticeList}>
                  חסרים נתונים עבור: {calc.missingNames.join(' · ')}
                </p>
              )}
            </div>
          )}

          {pro && calc.costSummary && (
            <p className={styles.costNote} role="status" aria-label="שלמות התמחור">
              {calc.costSummary}
              {calc.costLevel === 'partial' && calc.unpricedNames.length > 0 && (
                <> חסר מחיר עבור: {calc.unpricedNames.join(' · ')}</>
              )}
            </p>
          )}

          <dl className={styles.previewRows}>
            <div className={styles.previewRow}>
              <dt>סך המשקל</dt>
              <dd className="ltr">
                {calc.level === 'none' ? '—' : formatGrams(computed.totalG)}
                {calc.partialFigures && calc.level !== 'none' && (
                  <span className={styles.partialChip}>חלקי</span>
                )}
              </dd>
            </div>
            {pro && (
              <div className={styles.previewRow}>
                <dt>עלות חומרי גלם</dt>
                <dd className="ltr">
                  {/* A fully weighed recipe with no prices has no cost — not a
                      cost of zero. The two axes are tracked separately. */}
                  {calc.level === 'none' || calc.costLevel === 'none'
                    ? '—'
                    : formatNis(computed.cost)}
                  {(calc.partialFigures || calc.costLevel === 'partial') &&
                    calc.level !== 'none' &&
                    calc.costLevel !== 'none' && (
                      <span className={styles.partialChip}>חלקי</span>
                    )}
                </dd>
              </div>
            )}
            {computed.flour > 0 && (
              <div className={styles.previewRow}>
                <dt>הידרציה</dt>
                <dd className="ltr">
                  {calc.level === 'none' ? '—' : `${computed.hydration.toFixed(1)}%`}
                  {calc.partialFigures && calc.level !== 'none' && (
                    <span className={styles.partialChip}>חלקי</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </section>

        </>
      )}

      {/* STAGE 3 — אופן ההכנה */}
      {stage === 2 && (
        <>
        {/* ── steps ──────────────────────────────────────────────────────── */}
        <section
          className={styles.card}
          ref={(el) => {
            stageRefs.current[2] = el;
          }}
        >
          <h2 className={styles.cardTitle}>
            <span className={styles.stepNum} aria-hidden="true">3</span>
            אופן ההכנה
          </h2>
          <ol className={styles.rows}>
            {draft.steps.map((step, i) => (
              <li key={step.key} className={styles.stepCard}>
                <div className={styles.ingHead}>
                  <span className={styles.ingIndex} aria-hidden="true">
                    {i + 1}
                  </span>
                  <textarea
                    className={styles.textarea}
                    value={step.text}
                    onChange={(e) => patchStep(i, { text: e.target.value })}
                    placeholder="מה עושים בשלב הזה"
                    aria-label={`תיאור שלב ${i + 1}`}
                    rows={2}
                  />
                  <div className={styles.rowTools}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`העלאת שלב ${i + 1} למעלה`}
                      disabled={i === 0}
                      onClick={() =>
                        setDraft((d) => ({ ...d, steps: moveRow(d.steps, i, i - 1) }))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`הורדת שלב ${i + 1} למטה`}
                      disabled={i === draft.steps.length - 1}
                      onClick={() =>
                        setDraft((d) => ({ ...d, steps: moveRow(d.steps, i, i + 1) }))
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtnDanger}
                      aria-label={`הסרת שלב ${i + 1}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          steps: d.steps.filter((_, x) => x !== i),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className={styles.ingGrid}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`t-${step.key}`}>
                      טמפרטורה, °C
                    </label>
                    <input
                      id={`t-${step.key}`}
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={step.temp}
                      onChange={(e) => patchStep(i, { temp: e.target.value })}
                      aria-label={`טמפרטורה בשלב ${i + 1}`}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`m-${step.key}`}>
                      דקות
                    </label>
                    <input
                      id={`m-${step.key}`}
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={step.minutes}
                      onChange={(e) => patchStep(i, { minutes: e.target.value })}
                      aria-label={`זמן בדקות בשלב ${i + 1}`}
                    />
                  </div>
                  {/*
                    Stage 9. A production timeline has to tell 90 minutes of work
                    from 90 minutes of proofing, and nothing else in the row says
                    which. Left empty it stays empty: the timeline reports the
                    step as unclassified rather than reading the description.
                  */}
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`k-${step.key}`}>
                      סוג השלב
                    </label>
                    <select
                      id={`k-${step.key}`}
                      className={styles.input}
                      value={step.kind}
                      onChange={(e) =>
                        patchStep(i, { kind: e.target.value as '' | StepKind })
                      }
                      aria-label={`סוג השלב ${i + 1}`}
                    >
                      <option value="">— לא מסווג —</option>
                      {STEP_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={styles.addBtn}
            aria-label="הוספת שלב"
            onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, emptyStep()] }))}
          >
            <span aria-hidden="true">+ </span>הוספת שלב
          </button>

        </section>
        </>
      )}

      {/* STAGE 4 — סיכום: the professional details, then the save */}
      {stage === 3 && (
        <>
        {/*
          ── 4 · "פרטים מקצועיים" ──────────────────────────────────────────

          UX PASS. The form asked for everything at once, in one column roughly
          1,500 lines long: the name, then the ingredients, then the yield and
          the pricing, then the pan, then the steps, then storage and notes. A
          person writing down a recipe had to scroll past the food-cost target to
          reach "אופן ההכנה".

          The order is the order the work happens in now — details, ingredients,
          method — and everything a professional adds afterwards is in this one
          panel: yield and loss, pricing, the pan, storage, shelf life and notes.
          Nothing was removed and nothing is gated by profile (§3 forbids that).
          It is collapsed because it is optional, and the summary says so.
        */}
        <details
          className={styles.proDetails}
          open={showProduction}
          ref={(el) => {
            stageRefs.current[3] = el;
          }}
          onToggle={(e) => setShowProduction(e.currentTarget.open)}
        >
          <summary className={styles.proSummary}>
            <span className={styles.stepNum} aria-hidden="true">4</span>
            פרטים מקצועיים
            <span className={styles.proHint}>אפשר גם למלא אחר כך</span>
          </summary>
          {showProduction && (
          <div className={styles.proBody}>
          {/* ── yield and pricing ───────────────────────────────────────────
              Inside "פרטים מקצועיים" now (step 4), without a second toggle of its
              own: the panel IS the disclosure §3 asks for. */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>תשואה ותמחור</h3>
              <div className={styles.prodFields}>
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-units">
                      מספר יחידות
                    </label>
                    <input
                      id="r-units"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.yieldUnits}
                      onChange={(e) => patch({ yieldUnits: e.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-unitweight">
                      משקל ליחידה, גרם
                    </label>
                    <input
                      id="r-unitweight"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.unitWeight}
                      onChange={(e) => patch({ unitWeight: e.target.value })}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="r-yieldactual">
                    תשואה שנמדדה בפועל, גרם
                  </label>
                  <input
                    id="r-yieldactual"
                    className={`${styles.input} ltr`}
                    inputMode="decimal"
                    value={draft.yieldActual}
                    onChange={(e) => patch({ yieldActual: e.target.value })}
                    placeholder="ריק = לפי החישוב התאורטי"
                  />
                  {/*
                    This hint is the user-facing face of the null-vs-zero rule, and
                    it is worth its space: leaving the field empty and typing 0 are
                    different answers, and without saying so nobody would guess it.
                  */}
                  <p className={styles.hint}>
                    שדה ריק פירושו &quot;לפי החישוב&quot;. אפס פירושו שנמדדה תשואה של
                    אפס — שני דברים שונים.
                  </p>
                </div>

                {/*
                  STAGE-11 COMPLETION (§1.1). These two weights are the only inputs
                  of `bakeLoss`, which the recipe page has been displaying since
                  stage 2 — as "פחת אפייה 0.0%" on every recipe in the notebook,
                  because the form never asked for them. A baker reading 0% loss on
                  a bread is being told something false. They are also the inputs of
                  "משקל לשקילה ליחידה", which is how much dough to weigh out so the
                  BAKED unit comes out at its target weight.
                */}
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-wbefore">
                      משקל לפני אפייה, גרם
                    </label>
                    <input
                      id="r-wbefore"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.weightBefore}
                      onChange={(e) => patch({ weightBefore: e.target.value })}
                      placeholder="ריק = לא נשקל"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-wafter">
                      משקל אחרי אפייה, גרם
                    </label>
                    <input
                      id="r-wafter"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.weightAfter}
                      onChange={(e) => patch({ weightAfter: e.target.value })}
                      placeholder="ריק = לא נשקל"
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  מהשניים האלה מחושב פחת האפייה, וממנו המשקל שצריך לשקול ליחידה כדי
                  שהיחידה האפויה תצא במשקל היעד. בלי שני המשקלים אין פחת — והמסך אומר
                  זאת ולא מציג אפס.
                </p>

                {/*
                  §13 — desired dough temperature. The four temperatures below are
                  the inputs of `waterTemp`, which `compute()` has always solved and
                  the recipe page has always been ready to show; with no form the
                  answer was permanently null and the row never appeared.

                  The toggle is not decoration: `compute()` returns null for the
                  water temperature unless `doughMode` is on, precisely so that a
                  recipe with three blank temperatures does not read as "use water
                  at 0°C".
                */}
                <div className={styles.field}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={draft.doughMode}
                      onChange={(e) => patch({ doughMode: e.target.checked })}
                    />
                    <span>מתכון בצק — חישוב טמפרטורת מים</span>
                  </label>
                  {/*
                    The explanation sits OUTSIDE the label on purpose. Nested in
                    it, it became part of the checkbox's accessible name — and that
                    name then contained the words "חימום המערבל", which is also the
                    label of one of the four inputs below, so two controls answered
                    to the same phrase.
                  */}
                  <p className={styles.hint}>
                    לפי טמפרטורת בצק מבוקשת, טמפ&apos; הקמח, טמפ&apos; החדר וחימום
                    המערבל (§13).
                  </p>
                </div>

                {draft.doughMode && (
                  <>
                    <div className={styles.row2}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="r-ddt">
                          טמפ&apos; בצק מבוקשת, °C
                        </label>
                        <input
                          id="r-ddt"
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={draft.ddt}
                          onChange={(e) => patch({ ddt: e.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="r-flourtemp">
                          טמפ&apos; הקמח, °C
                        </label>
                        <input
                          id="r-flourtemp"
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={draft.flourTemp}
                          onChange={(e) => patch({ flourTemp: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className={styles.row2}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="r-roomtemp">
                          טמפ&apos; החדר, °C
                        </label>
                        <input
                          id="r-roomtemp"
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={draft.roomTemp}
                          onChange={(e) => patch({ roomTemp: e.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="r-friction">
                          חימום המערבל, °C
                        </label>
                        <input
                          id="r-friction"
                          className={`${styles.input} ltr`}
                          inputMode="decimal"
                          value={draft.friction}
                          onChange={(e) => patch({ friction: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className={styles.hint}>
                      טמפרטורת המים המחושבת מופיעה בכרטיס &quot;נוסחה&quot; בדף
                      המתכון. שדה שנשאר ריק נספר כאפס בנוסחה הזאת, ולכן כדאי למלא את
                      ארבעתם.
                    </p>
                  </>
                )}

                {pro && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-fc">
                      יעד פוד קוסט, אחוזים
                    </label>
                    <input
                      id="r-fc"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.targetFC}
                      onChange={(e) => patch({ targetFC: e.target.value })}
                    />
                    <p className={styles.hint}>
                      היעד שממנו מחושב מחיר מכירה מוצע. אינו אחוז הפוד קוסט בפועל.
                    </p>
                  </div>
                )}

                {pro && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-sale">
                      מחיר מכירה ₪
                    </label>
                    <input
                      id="r-sale"
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={draft.salePrice}
                      onChange={(e) => patch({ salePrice: e.target.value })}
                      aria-label="מחיר מכירה"
                    />
                    <p className={styles.hint}>
                      המחיר שאתם גובים בפועל. ממנו מחושב אחוז הפוד קוסט האמיתי. שדה
                      ריק פירושו שלא הוגדר מחיר, ואפס פירושו שהמוצר נמסר בחינם — שני
                      דברים שונים.
                    </p>
                  </div>
                )}

                {/*
                  Stage 8. Is that price for the whole batch or for one unit? The
                  answer is stored, never guessed: reading a per-unit price as a
                  batch price turns a 30% food cost into a 300% one, and nothing on
                  the screen would reveal which happened.
                */}
                {pro && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="r-sale-basis">
                      מחיר המכירה הוא ל…
                    </label>
                    <select
                      id="r-sale-basis"
                      className={styles.input}
                      value={draft.salePriceBasis}
                      onChange={(e) =>
                        patch({ salePriceBasis: e.target.value === 'unit' ? 'unit' : 'batch' })
                      }
                      aria-label="בסיס מחיר המכירה"
                    >
                      <option value="batch">כל המתכון</option>
                      <option value="unit">יחידה אחת</option>
                    </select>
                  </div>
                )}

                {/* Requirement E: entered, never invented. */}
                {pro && (
                  <>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="r-packaging">
                        עלות אריזה ₪
                      </label>
                      <input
                        id="r-packaging"
                        className={`${styles.input} ltr`}
                        inputMode="decimal"
                        value={draft.packagingCost}
                        onChange={(e) => patch({ packagingCost: e.target.value })}
                        aria-label="עלות אריזה"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="r-labor">
                        עלות עבודה ₪
                      </label>
                      <input
                        id="r-labor"
                        className={`${styles.input} ltr`}
                        inputMode="decimal"
                        value={draft.laborCost}
                        onChange={(e) => patch({ laborCost: e.target.value })}
                        aria-label="עלות עבודה"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="r-other">
                        עלויות נוספות ₪
                      </label>
                      <input
                        id="r-other"
                        className={`${styles.input} ltr`}
                        inputMode="decimal"
                        value={draft.otherCost}
                        onChange={(e) => patch({ otherCost: e.target.value })}
                        aria-label="עלויות נוספות"
                      />
                      <p className={styles.hint}>
                        עלויות ישירות נוספות שהוזנו כאן בלבד. שכירות, חשמל ותקורה
                        אינם מחושבים אוטומטית, כי אין מודל שמגדיר איך לחלק אותם
                        למתכון אחד. שדה ריק פירושו שלא הוזן, ואפס פירושו שאין עלות
                        כזאת.
                      </p>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="r-gm">
                        יעד רווח גולמי, אחוזים
                      </label>
                      <input
                        id="r-gm"
                        className={`${styles.input} ltr`}
                        inputMode="decimal"
                        value={draft.targetGM}
                        onChange={(e) => patch({ targetGM: e.target.value })}
                        aria-label="יעד רווח גולמי"
                      />
                      <p className={styles.hint}>
                        ממנו מחושב מחיר שמתאים ליעד, לפי העלות הכוללת. אינו הרווח
                        הגולמי בפועל.
                      </p>
                    </div>
                  </>
                )}
              </div>
          </section>

          {/*
            ── §7 the pan ────────────────────────────────────────────────────
            The `pan` column, both mappers and `save_recipe` have carried this
            since stage 1; §7 specifies the arithmetic; the prototype implemented
            it. What was missing was anywhere to say which pan the recipe is
            written for — without which the recipe page cannot offer to adapt it to
            the pan the user actually owns.
          */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>תבנית</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-pan-kind">
                סוג התבנית של המתכון
              </label>
              <select
                id="r-pan-kind"
                className={styles.input}
                value={draft.pan.kind}
                onChange={(e) =>
                  patch({
                    pan: {
                      ...draft.pan,
                      kind: e.target.value as RecipeDraft['pan']['kind'],
                    },
                  })
                }
              >
                <option value="">— לא צוין —</option>
                {PAN_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.he}
                  </option>
                ))}
              </select>
            </div>

            {panFields.includes('diameter') && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-pan-d">
                  קוטר, ס&quot;מ
                </label>
                <input
                  id="r-pan-d"
                  className={`${styles.input} ltr`}
                  inputMode="decimal"
                  value={draft.pan.diameter}
                  onChange={(e) => patch({ pan: { ...draft.pan, diameter: e.target.value } })}
                />
              </div>
            )}

            {(panFields.includes('width') || panFields.includes('length')) && (
              <div className={styles.row2}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="r-pan-w">
                    רוחב, ס&quot;מ
                  </label>
                  <input
                    id="r-pan-w"
                    className={`${styles.input} ltr`}
                    inputMode="decimal"
                    value={draft.pan.width}
                    onChange={(e) => patch({ pan: { ...draft.pan, width: e.target.value } })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="r-pan-l">
                    אורך, ס&quot;מ
                  </label>
                  <input
                    id="r-pan-l"
                    className={`${styles.input} ltr`}
                    inputMode="decimal"
                    value={draft.pan.length}
                    onChange={(e) => patch({ pan: { ...draft.pan, length: e.target.value } })}
                  />
                </div>
              </div>
            )}

            {panFields.includes('gn') && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-pan-gn">
                  מידת GN
                </label>
                <select
                  id="r-pan-gn"
                  className={styles.input}
                  value={draft.pan.gn}
                  onChange={(e) => patch({ pan: { ...draft.pan, gn: e.target.value } })}
                >
                  <option value="">— לא צוין —</option>
                  {GN_SIZES.map((g) => (
                    <option key={g} value={g}>
                      GN {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {panFields.includes('cavities') && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-pan-cav">
                  מספר שקעים
                </label>
                <input
                  id="r-pan-cav"
                  className={`${styles.input} ltr`}
                  inputMode="decimal"
                  value={draft.pan.cavities}
                  onChange={(e) => patch({ pan: { ...draft.pan, cavities: e.target.value } })}
                />
              </div>
            )}

            {panFields.includes('height') && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-pan-h">
                  גובה, ס&quot;מ
                </label>
                <input
                  id="r-pan-h"
                  className={`${styles.input} ltr`}
                  inputMode="decimal"
                  value={draft.pan.height}
                  onChange={(e) => patch({ pan: { ...draft.pan, height: e.target.value } })}
                />
                <p className={styles.hint}>
                  עם גובה בשתי התבניות ההשוואה נעשית לפי נפח. בלעדיו — לפי שטח בלבד,
                  וההמלצה תאמר זאת במפורש.
                </p>
              </div>
            )}

            {draft.pan.kind !== '' && draft.pan.kind !== 'none' && panLabel(panFromDraft(draft.pan)) === '' && (
              <p className={styles.hint}>
                נבחר סוג תבנית בלי מידות, ולכן אי אפשר להשוות אותה לתבנית אחרת. אפשר
                להשלים את המידות או לבחור &quot;לא צוין&quot;.
              </p>
            )}
          </section>

          {/* ── texts ──────────────────────────────────────────────────────── */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>אחסון והערות</h2>
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-shelf">
                  חיי מדף
                </label>
                <input
                  id="r-shelf"
                  className={styles.input}
                  value={draft.shelfLife}
                  onChange={(e) => patch({ shelfLife: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-storage">
                  אחסון
                </label>
                <input
                  id="r-storage"
                  className={styles.input}
                  value={draft.storage}
                  onChange={(e) => patch({ storage: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-freezing">
                  הקפאה
                </label>
                <input
                  id="r-freezing"
                  className={styles.input}
                  value={draft.freezing}
                  onChange={(e) => patch({ freezing: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="r-thawing">
                  הפשרה
                </label>
                <input
                  id="r-thawing"
                  className={styles.input}
                  value={draft.thawing}
                  onChange={(e) => patch({ thawing: e.target.value })}
                />
              </div>
            </div>
            {/*
              §1.1 manualAllergens. The allergen list is derived from the
              ingredient names, and the table cannot know everything — a filling
              bought ready-made, a shared production line, a supplier's change.
              Without this field the user could see an allergen missing from the
              list and had no way to add it.
            */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-allergens">
                אלרגנים להוספה ידנית
              </label>
              <input
                id="r-allergens"
                className={styles.input}
                value={draft.manualAllergens}
                onChange={(e) => patch({ manualAllergens: e.target.value })}
                placeholder="מופרדים בפסיק"
              />
              <p className={styles.hint}>
                נוספים לאלרגנים שהמערכת מזהה מתוך שמות הרכיבים, ואינם מחליפים אותם.
              </p>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-equipment">
                ציוד נדרש
              </label>
              <input
                id="r-equipment"
                className={styles.input}
                value={draft.equipment}
                onChange={(e) => patch({ equipment: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="r-notes">
                הערות
              </label>
              <textarea
                id="r-notes"
                className={styles.textarea}
                value={draft.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                rows={3}
              />
              <p className={styles.hint}>
                ההערות האלה נוסעות עם המתכון בשיתוף ובדף ההזמנה (§8).
              </p>
            </div>
          </section>
          </div>
          )}
        </details>
        </>
      )}

      {/* ── the action bar ─────────────────────────────────────────────── */}
      {/*
        UX PASS: THE SAVE BUTTON TRAVELS WITH THE FORM.

        It was at the very bottom of a form that is four sections long, so on a
        phone "where is save?" meant scrolling past everything. It is pinned
        now, which is the same answer Cook Mode's gate and the chat's composer
        got. It stays a single primary button — "שמירת מתכון" — with ביטול
        beside it, and when it cannot be pressed the line underneath says why,
        rather than leaving a grey rectangle to be guessed at.
      */}
      <div className={styles.saveBar}>
        {/*
          ── THE WIZARD'S FOOT ────────────────────────────────────────────

          One primary control, and it changes with the stage: on the first
          three it carries you forward, on the summary it saves. "הקודם" is
          beside it from stage 2 on, and "שמירת טיוטה" sits with them — a
          partial recipe is savable at any point (§6), and it says so rather
          than hiding behind the last stage.
        */}
        <div className={styles.actions}>
          {stage < STAGES.length - 1 ? (
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => goToStage(stage + 1)}
            >
              {`המשך ל${STAGES[stage + 1]}`}
            </button>
          ) : (
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void onSave('final')}
              disabled={busy || !capabilities.canWrite}
            >
              {busy ? 'שומר…' : isNew ? 'שמירת המתכון' : 'שמירת השינויים'}
            </button>
          )}
          {stage > 0 && (
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => goToStage(stage - 1)}
            >
              הקודם
            </button>
          )}
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            ביטול
          </button>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.draftBtn}
            onClick={() => void onSave('draft')}
            disabled={busy || !capabilities.canWrite}
          >
            שמירת טיוטה
          </button>
          {draftSaved && (
            <p className={styles.saveOk} role="status">
              הטיוטה נשמרה. אפשר להמשיך לערוך.
            </p>
          )}
        </div>

        {!capabilities.canWrite && (
          <p className={styles.saveWhy}>
            {/* Short, and deliberately not a second copy of the banner at the
                top of the screen — it points at it. */}
            השמירה אינה זמינה כרגע — ההסבר בראש המסך.
          </p>
        )}
        {problems.length > 0 && (
          <p className={styles.saveWhy}>
            {problems.length === 1
              ? 'חסר פרט אחד כדי לשמור — ההסבר מופיע ליד השדה.'
              : `חסרים ${problems.length} פרטים כדי לשמור — ההסברים מופיעים ליד השדות.`}
          </p>
        )}
      </div>
      {calibrateFor !== null && (
        <CalibrateSheet
          ingredientName={calibrateFor}
          prefs={prefs}
          onClose={() => setCalibrateFor(null)}
          onSave={(next) => {
            void setCalibrations(next);
            setCalibrateFor(null);
          }}
        />
      )}
    </div>
  );
}
