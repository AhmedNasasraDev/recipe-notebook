import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  compute,
  formatGrams,
  formatNis,
  scaleFactor,
  type ComputedRow,
  type IngredientLike,
} from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { SourceBadge } from '../components/SourceBadge.js';
import { ConvertSheet } from '../features/recipe/ConvertSheet.js';
import { CalibrateSheet } from '../features/recipe/CalibrateSheet.js';
import { calcState, type CalcState } from '../features/recipe/completeness.js';
import { rowLabel, type ViewMode } from '../features/recipe/rowLabel.js';
import { scaleQuery, type ScaleMode } from '../features/recipe/scaleLink.js';
import { resolveFromCatalog, unpricedKeys } from '../features/pricing/catalog.js';
import { foodCost } from '../features/pricing/foodCost.js';
import {
  costBreakdown,
  profitability,
  targetPrice,
} from '../features/pricing/profitability.js';
import { CostingPanel } from '../features/pricing/CostingPanel.js';
import { duplicateRecipe } from '../features/recipe/duplicate.js';
import { VersionHistory } from '../features/recipe/VersionHistory.js';
import { PanCard } from '../features/recipe/PanCard.js';
import { PrivateNote } from '../features/recipe/PrivateNote.js';
import { TrialLog } from '../features/recipe/TrialLog.js';
import { RecipeImages } from '../features/images/RecipeImages.js';
import { useRecipeImages } from '../features/images/useRecipeImages.js';
import {
  CopyIcon,
  DeleteIcon,
  EditIcon,
  ImageIcon,
  LabelIcon,
  OrderIcon,
  PrintIcon,
  ShareIcon,
  StarIcon,
} from '../shell/Icons.js';
import { RecipeMenu, type MenuAction } from '../features/recipe/RecipeMenu.js';
import { shareRecipe } from '../features/recipe/shareRecipe.js';
import { RecipePrintSheet } from '../features/print/RecipePrintSheet.js';
import { SCALE_MODE_TEXT } from '../features/recipe/scaleLink.js';
import { BackControl } from '../components/BackLink.js';
import {
  forgetRecipeLocally,
  noteRecipeOpened,
  readFavorites,
  toggleFavorite,
} from '../data/offlineMirror.js';
import { RecipeInUseError, type StoredVersion } from '../data/repository.js';
import styles from '../features/recipe/recipe.module.css';


/*
  `srLabel` exists for exactly one reason, found by the stage-10 §10 audit
  against Chromium's real accessibility tree: BOTH groups on this page had a
  button whose accessible name was "כמו במתכון", one meaning "do not scale" and
  one meaning "show the units as written". The group labels below disambiguate
  them for a screen reader that announces the group — but a voice-control user
  saying "כמו במתכון" has two targets and no way to choose, and a list of the
  page's controls reads the same name twice.

  The visible text is unchanged and the accessible name CONTAINS it, which is
  what WCAG 2.5.3 (Label in Name) requires: speaking what is on screen still
  matches. Only the two colliding buttons carry one.
*/
type Tab<T> = { id: T; label: string; srLabel?: string };

const SCALE_TABS: readonly Tab<ScaleMode>[] = [
  { id: 'recipe', label: 'כמו במתכון', srLabel: 'כמויות כמו במתכון' },
  { id: 'units', label: 'יחידות' },
  { id: 'batches', label: 'אצוות' },
  { id: 'weight', label: 'משקל' },
  { id: 'stock', label: 'לפי מלאי' },
];

const VIEW_TABS: readonly Tab<ViewMode>[] = [
  { id: 'orig', label: 'כמו במתכון', srLabel: 'תצוגה כמו במתכון' },
  { id: 'g', label: 'גרמים' },
  { id: 'home', label: 'ביתי' },
];

const PLACEHOLDER: Record<ScaleMode, string> = {
  recipe: '',
  units: 'מספר יחידות',
  batches: 'מספר אצוות (למשל 2 או 0.5)',
  weight: 'משקל סופי בגרם',
  stock: 'גרם במלאי',
};

/**
 * §2 screen 4 — the recipe page.
 *
 * The rule that governs this whole screen is §5.4 and §6: **calculation is not
 * editing.** Scaling, unit display and the conversion sheet all show a computed
 * result and never touch the stored recipe. The factor lives in component state.
 */
export function RecipeScreen() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    recipes,
    prefs,
    capabilities,
    saveRecipe,
    deleteRecipe,
    saveTrials,
    setCalibrations,
    listVersions,
    restoreVersion,
    recipesUsing,
    catalog,
    getPrivateNote,
    savePrivateNote,
    listRecipeImages,
    userId,
    raiseError,
    addRecipeImage,
    removeRecipeImage,
    replaceRecipeImage,
    copyRecipeImages,
    setRecipeImageFocus,
    signedImageUrl,
  } = useAppData();

  /** §8: null while it is being read, then '' or the text. */
  const [note, setNote] = useState<string | null>(null);

  const [scaleMode, setScaleMode] = useState<ScaleMode>('recipe');
  const [scaleValue, setScaleValue] = useState('');
  const [scaleIngredient, setScaleIngredient] = useState('');
  const [view, setView] = useState<ViewMode>('orig');

  /*
    "כמה להכין" BELONGS TO THE RECIPE ON SCREEN, AND ONLY TO IT

    This screen stays mounted when one recipe leads to another — the route
    pattern does not change, so React keeps the component and its state. The
    path in the product is "שכפול": duplicate, `navigate` to the copy, and the
    copy opened with the previous recipe's scale still in force (measured:
    croissant at "24 יחידות", ×0.71, on a recipe nobody had asked to scale).
    Nothing was saved wrongly and the screen did say which scale it was
    showing, but a recipe you have just opened should be the recipe as written.

    Adjusted DURING RENDER rather than in an effect, which is what React
    documents for "reset some state when a prop changes". An effect would
    paint one frame with the previous recipe's factor applied to this recipe's
    ingredients — a frame of wrong weights on the screen people weigh from.

    `view` is deliberately NOT reset: §5.4's grams/home/as-written choice is a
    preference about how to read a recipe, not a fact about which recipe it is.
  */
  /*
    The professional block is rendered only while it is open — the same
    guarantee the old toggle gave. A <details> keeps its content in the DOM
    when it is closed, which on a recipe page means ~200 elements of food cost,
    yield, formula and version history built on every view, on a phone, for a
    panel most openings never look at.
  */
  const [showPro, setShowPro] = useState(false);
  /* "שיתוף" from the ⋮ menu: what happened, said under the button. */
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  /* Where "התאמה" in the pan card sends the screen: the card it changes. */
  const scaleRef = useRef<HTMLElement | null>(null);

  /*
    §5's photographs, fetched ONCE for the whole page: the hero at the top
    shows the first one, the gallery below the steps manages all of them. See
    `useRecipeImages` for why the fetch was lifted out of the gallery.
  */
  const imageState = useRecipeImages({
    recipeId: recipeId ?? '',
    list: listRecipeImages,
    add: addRecipeImage,
    remove: removeRecipeImage,
    replace: replaceRecipeImage,
    sign: signedImageUrl,
    focus: setRecipeImageFocus,
  });

  /*
    ── ADJUSTING WHERE THE PHOTOGRAPH IS LOOKED AT ─────────────────────────

    Ahmed: "אפשר להעלות תמונה, להחליף אותה, להתאים חיתוך או מיקום ולהסיר
    אותה… הצג תצוגה מקדימה ואפשר לבטל את השינוי לפני השמירה."

    `draftFocus` is that preview: while the panel is open the hero renders
    THIS value, so dragging moves the real picture in the real band at the
    real size — not a thumbnail of it. `null` closes the panel and the stored
    value takes over again, which is what cancelling means.
  */
  const [draftFocus, setDraftFocus] = useState<{ x: number; y: number } | null>(null);
  const [focusSaved, setFocusSaved] = useState(false);

  const [scaleFor, setScaleFor] = useState(recipeId);
  if (scaleFor !== recipeId) {
    setScaleFor(recipeId);
    setScaleMode('recipe');
    setScaleValue('');
    setScaleIngredient('');
    // The two panels close with it, for the same reason and in the same
    // breath: arriving at a recipe should show that recipe as it is, not the
    // previous one's opened drawers. (This screen stays MOUNTED across
    // recipes — same route pattern — so nothing else would close them.)
    setShowPro(false);
    setShareStatus(null);
  }
  /*
    UX PASS: the favourite is device-local (see `offlineMirror.ts`). `null`
    until the mirror answers, so the star does not flash "not a favourite" over
    a recipe that is one.
  */
  const [favorite, setFavorite] = useState(false);
  /*
    "נשמר" — shown once, on arrival from the editor, and cleared from the
    history entry immediately so that a reload or a back-and-forward does not
    announce a save that happened ten minutes ago.
  */
  const navState = location.state as { saved?: 'created' | 'updated' } | null;
  const [savedNotice, setSavedNotice] = useState<'created' | 'updated' | null>(
    navState?.saved ?? null,
  );
  useEffect(() => {
    /*
      Per ARRIVAL, not per mount: this screen stays mounted when "שכפול"
      navigates from a recipe to its copy, so the notice the copy arrives
      with was never read (QA 22.09.2026, §4). `location.key` changes on
      every navigation, mount included.
    */
    if (navState?.saved) {
      setSavedNotice(navState.saved);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  useEffect(() => {
    if (savedNotice === null) return;
    const t = setTimeout(() => setSavedNotice(null), 6000);
    return () => clearTimeout(t);
  }, [savedNotice]);
  const [convertIngredient, setConvertIngredient] = useState<IngredientLike | null>(null);
  const [calibrateFor, setCalibrateFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState<'copy' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly StoredVersion[]>([]);
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [usedBy, setUsedBy] = useState<readonly { id: string; name: string }[]>([]);

  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  // Stage-6 requirements 1-3: held by another recipe, so the delete is refused.
  // This is the SCREEN's copy of that fact and it is only ever advisory — the
  // database decides, and `onDelete` adopts the answer it gives.
  const blocked = usedBy.length > 0;
  const pro = prefs.pro === true;

  const reloadVersions = useCallback(async () => {
    if (!recipeId) return;
    try {
      setVersions(await listVersions(recipeId));
    } catch (e) {
      // History is informative, not load-bearing: the page must still render.
      setVersionError(e instanceof Error ? e.message : 'טעינת ההיסטוריה נכשלה');
    }
  }, [recipeId, listVersions]);

  useEffect(() => {
    void reloadVersions();
  }, [reloadVersions]);

  // Which recipes would break if this one were deleted. `sub_recipe_id` is
  // ON DELETE SET NULL, so without this the delete silently turns their lines
  // into ingredients with no weight.
  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    void recipesUsing(recipeId).then((list) => {
      if (!cancelled) setUsedBy(list);
    });
    return () => {
      cancelled = true;
    };
  }, [recipeId, recipesUsing]);

  // §2 screen 2: the home screen's "המשך מאיפה שעצרת" reads this, and the UX
  // pass added the short "נפתחו לאחרונה" list beside it. Device storage, not
  // the account — see the comment on `noteRecipeOpened`.
  useEffect(() => {
    if (recipeId) void noteRecipeOpened(recipeId);
  }, [recipeId]);

  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    void readFavorites().then((list) => {
      if (!cancelled) setFavorite(list.includes(recipeId));
    });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const onToggleFavorite = async () => {
    if (!recipeId) return;
    // Optimistic, and then corrected by what the store actually holds — a
    // browser that refuses storage must not leave a star that lies.
    setFavorite((v) => !v);
    const list = await toggleFavorite(recipeId);
    setFavorite(list.includes(recipeId));
  };

  // §8: the account's own note for this recipe. `null` until it is known, so
  // the box does not flash empty over text that is on its way.
  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    setNote(null);
    void getPrivateNote(recipeId)
      .then((body) => {
        if (!cancelled) setNote(body ?? '');
      })
      // A note that cannot be read must not take the recipe page down with it.
      // An empty box is the right fallback: it is what the user sees anyway
      // when there is no note, and the save path reports its own failures.
      .catch(() => {
        if (!cancelled) setNote('');
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, getPrivateNote]);

  // Baseline at factor 1, then the scaled pass. Both come from the one engine.
  /**
   * The recipe and the notebook, with prices resolved from the ingredient
   * centre (stage-7 requirement 2).
   *
   * `recipes` is resolved too, not just this recipe: a sub-recipe's cost rolls
   * up from ITS OWN computation, so a base recipe whose prices come from the
   * centre would contribute nothing unless it is resolved as well. That was
   * worth thinking about once rather than debugging later.
   *
   * Resolution is idempotent, so a row with its own price keeps it.
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

  const factor = useMemo(() => {
    if (!baseline) return 1;
    return scaleFactor(scaleMode, Number(scaleValue), baseline, scaleIngredient || undefined);
  }, [baseline, scaleMode, scaleValue, scaleIngredient]);

  /*
    STAGE-11 FIX, found by turning on react-hooks/exhaustive-deps.

    The dependency list was `[recipe, recipes, factor, prefs]` while the
    callback reads `pricedRecipe` and `pricedNotebook` — both of which are
    derived from the CATALOG as well as from the recipe. So when a price moved
    in the ingredient centre, `baseline` (whose list is right) recomputed and
    `computed` did not: the ingredient table and every cost figure on the page
    kept the old price while the figures derived from the baseline had the new
    one. One recipe, one screen, two prices.
  */
  const computed = useMemo(
    () => (pricedRecipe ? compute(pricedRecipe, pricedNotebook, { factor, prefs }) : null),
    [pricedRecipe, pricedNotebook, factor, prefs],
  );

  /**
   * The scale, as something an order sheet can be linked to. `recipe` mode and
   * a value that produced no change both come out as an empty string, so the
   * plain URL means "as written" rather than "×1.00", which is the same thing
   * said less clearly.
   */
  const scaleSearch = scaleQuery(scaleMode, scaleValue, scaleIngredient, factor);

  if (!recipe || !computed || !baseline) {
    return (
      <div className={styles.missing}>
        <p>המתכון הזה לא נמצא במחברת.</p>
        <BackControl>המחברת</BackControl>
      </div>
    );
  }

  // Requirement 8: how much of this calculation is real, before any figure is
  // put on screen.
  const calc = calcState(computed);
  /**
   * Were BOTH weights entered? `bakeLoss` needs the pair, and `weightBefore`
   * alone gives a loss of 100% against a missing `weightAfter`. A blank field
   * is not a weight of zero.
   */
  const weighedForLoss =
    recipe.weightBefore !== null &&
    recipe.weightBefore !== undefined &&
    recipe.weightBefore !== '' &&
    recipe.weightAfter !== null &&
    recipe.weightAfter !== undefined &&
    recipe.weightAfter !== '';

  /**
   * A figure that is a sum over the ingredient rows.
   *
   * When nothing could be weighed there is no such figure, so this returns a
   * dash instead of the zero the sum would otherwise produce. When only some
   * rows were weighed the figure is genuine but incomplete, and `ProdBlock`
   * marks it — the notice above the page says by how much.
   */
  const derived = (value: string): string => (calc.level === 'none' ? '—' : value);

  /**
   * A figure that is a sum over the ingredients' PRICES.
   *
   * Separate from `derived` because the two can disagree: a recipe can be fully
   * weighed and completely unpriced, and then every weight figure is real while
   * every cost figure is meaningless. ₪0.00 reads as "this recipe is free".
   */
  const priced = (value: string): string =>
    calc.level === 'none' || calc.costLevel === 'none' ? '—' : value;

  const onDuplicate = async () => {
    setActionError(null);
    setActionBusy('copy');
    try {
      // §9 / §13a: a copy carries the formula and none of the history. See
      // features/recipe/duplicate.ts for why each field is or is not inherited.
      const copy = duplicateRecipe(recipe, {
        existingNames: recipes.map((r) => String(r.name ?? '')),
      });
      const saved = await saveRecipe(copy);
      /*
        THE COPY GETS ITS OWN PICTURES. New objects and new rows, so deleting
        or replacing a photo on either recipe leaves the other exactly as it
        was — a duplicate that pointed at the original's files would lose its
        pictures the day the original was cleaned up (QA 22.09.2026, §4).
        Best effort: the recipe is already saved, and a photo that did not
        copy is said, not hidden.
      */
      try {
        const { failed } = await copyRecipeImages(recipe.id, saved.id);
        if (failed > 0) {
          raiseError(
            failed === 1
              ? 'המתכון שוכפל, אבל תמונה אחת לא הועתקה. אפשר להעלות אותה מחדש בעותק.'
              : `המתכון שוכפל, אבל ${failed} תמונות לא הועתקו. אפשר להעלות אותן מחדש בעותק.`,
          );
        }
      } catch (e) {
        raiseError(
          e instanceof Error
            ? `המתכון שוכפל, אבל התמונות לא הועתקו: ${e.message}`
            : 'המתכון שוכפל, אבל התמונות לא הועתקו.',
        );
      }
      navigate(`/recipe/${saved.id}`, { state: { saved: 'created' } });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'השכפול נכשל.');
    } finally {
      setActionBusy(null);
    }
  };

  const onRestore = async (version: StoredVersion) => {
    setVersionError(null);
    setRestoreBusy(version.id);
    try {
      await restoreVersion(version.id);
      // The restore created a new version holding the pre-restore state, so the
      // list has to be re-read — otherwise the undo is invisible.
      await reloadVersions();
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : 'השחזור נכשל');
    } finally {
      setRestoreBusy(null);
    }
  };

  const onDelete = async () => {
    setActionError(null);
    setActionBusy('delete');
    try {
      await deleteRecipe(recipe.id);
      // A deleted recipe must not linger in the device's own short lists.
      await forgetRecipeLocally(recipe.id);
      navigate('/notebook', { replace: true });
    } catch (e) {
      if (e instanceof RecipeInUseError) {
        // The database refused (migration 0008). This is not a failure to
        // report and forget: the dependents list this screen was holding was
        // evidently stale — another tab, or another device, added a link. So
        // adopt the list the refusal came with and leave the dialog open,
        // now showing the real reason.
        setUsedBy(e.usedBy);
        setActionError(null);
      } else {
        setActionError(e instanceof Error ? e.message : 'המחיקה נכשלה.');
        setConfirmDelete(false);
      }
    } finally {
      setActionBusy(null);
    }
  };

  // Requirement 4. `calc` decides whether the cost figures mean anything;
  // `foodCost` decides which of them may be shown and computes the one ratio.
  const fc = foodCost(pricedRecipe ?? recipe, computed, calc);
  // Stage 8: the full cost and the sale side. Built from the SAME `fc`, so the
  // ingredient cost in the breakdown is the one the food-cost panel shows and
  // the two can never disagree.
  const breakdown = costBreakdown(fc, pricedRecipe ?? recipe);
  const profit = profitability(pricedRecipe ?? recipe, computed, breakdown, fc);
  const targets = targetPrice(pricedRecipe ?? recipe, computed, breakdown, fc);
  const toPrice = unpricedKeys(pricedRecipe ?? recipe, catalog);

  /**
   * A money figure, or a dash.
   *
   * `null` is "not known" and renders as an em dash; 0 is a real price and
   * renders as ₪0. Collapsing them is the mistake this whole stage is about.
   */
  const money = (v: number | null): string => (v === null ? '—' : formatNis(v));

  const totalMinutes = (recipe.steps ?? []).reduce((a, s) => a + Number(s.minutes ?? 0), 0);
  const timeLabel =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)} שע'${totalMinutes % 60 ? ` ${totalMinutes % 60} דק'` : ''}`
      : `${totalMinutes} דק'`;

  /* §5.4's three views. The function moved to `features/recipe/rowLabel.ts`
     when Cook Mode needed the same labels for Mise en place — one answer to
     "how much flour", printed by both screens. */
  const label = (row: ComputedRow) => rowLabel(row, view, factor, prefs);

  /*
    The hero is the FIRST photograph, and only once it has a signed URL:
    `undefined` is "not signed yet" and `null` is "this account may not see
    it" (§5). Neither is a picture, and neither is drawn as an empty frame.
  */
  const heroImage = imageState.load === 'ready' ? (imageState.images[0] ?? null) : null;
  const heroUrl = heroImage ? (imageState.urls[heroImage.id] ?? null) : null;
  /* The preview while adjusting, the stored point otherwise. */
  const focus = draftFocus ?? {
    x: heroImage?.focalX ?? 50,
    y: heroImage?.focalY ?? 50,
  };
  /*
    The same two conditions the gallery below uses, and for the same reason:
    ownership, not the profile. A group recipe a member is reading is not
    theirs to re-photograph, and a session with no write access cannot store
    anything anyway.
  */
  const canEditPhoto = capabilities.canWrite && !recipe.group_id;

  /*
    ── THE ⋮ MENU (spec §8.1) ─────────────────────────────────────────────
    Every action on the recipe, in one place, in the spec's order: edit,
    duplicate, share, photo, then the favourite and the three paper outputs
    (print/PDF as a small item, U-2), and delete last in red behind a line.
    "מצב הכנה" is not here: it is the page's one primary button.
  */
  const onShare = async () => {
    const outcome = await shareRecipe(recipe);
    setShareStatus(
      outcome === 'shared'
        ? 'המתכון שותף'
        : outcome === 'copied'
          ? 'המתכון הועתק כטקסט — אפשר להדביק בהודעה'
          : outcome === 'cancelled'
            ? null
            : 'השיתוף לא הצליח בדפדפן הזה',
    );
  };
  const onPhoto = () => {
    const target = document.getElementById('recipe-images');
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    target?.querySelector<HTMLElement>('button, input, a')?.focus?.({ preventScroll: true });
  };
  const menuActions: MenuAction[] = [
    { id: 'edit', label: 'עריכה', icon: <EditIcon />, to: `/recipe/${recipe.id}/edit` },
    {
      id: 'copy',
      label: actionBusy === 'copy' ? 'משכפל…' : 'שכפול',
      icon: <CopyIcon />,
      onSelect: () => void onDuplicate(),
      disabled: actionBusy !== null || !capabilities.canWrite,
    },
    { id: 'share', label: 'שיתוף', icon: <ShareIcon />, onSelect: () => void onShare() },
    { id: 'photo', label: 'תמונה', icon: <ImageIcon />, onSelect: onPhoto },
    {
      id: 'favorite',
      label: favorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים',
      icon: <StarIcon />,
      onSelect: () => void onToggleFavorite(),
      pressed: favorite,
    },
    { id: 'print', label: 'הדפסה / שמירה כ-PDF', icon: <PrintIcon />, onSelect: () => window.print() },
    { id: 'label', label: 'תווית מוצר', icon: <LabelIcon />, to: `/recipe/${recipe.id}/label` },
    {
      id: 'order',
      label: 'דף הזמנה',
      icon: <OrderIcon />,
      to: `/recipe/${recipe.id}/order${scaleSearch}`,
    },
    {
      id: 'delete',
      label: 'מחיקה',
      icon: <DeleteIcon />,
      onSelect: () => setConfirmDelete(true),
      disabled: actionBusy !== null || !capabilities.canWrite,
      danger: true,
    },
  ];

  return (
    <div className={styles.page}>
      {/*
        ── the hero ───────────────────────────────────────────────────────

        The handoff asks for a wide photograph at the top, about a quarter to
        a third of the screen, scrolling with the page, with the back and menu
        buttons on it on backgrounds you can actually read — and, when the
        recipe has no photograph, NO enormous empty rectangle.

        So the bar is always the same bar. Over a photograph it floats on it
        in opaque chips; with no photograph it is simply the row it has always
        been, and nothing is reserved for a picture that does not exist.

        While the list is still loading nothing is reserved either: a skeleton
        the height of a hero would flash on every recipe that has no
        photograph, which is most of them. The cost is one reflow on the
        recipes that do have one — see `useRecipeImages`.
      */}
      {/*
        ── THE TOP BAR: STICKY, ABOVE THE PICTURE ──────────────────────────

        It used to float on the photograph. It sits above it now and stays
        at the top while the page scrolls, because it carries the one action
        Ahmed asked to be reachable from anywhere on the recipe — "הדפסה /
        שמירה כ-PDF" — beside the way back and the menu (QA 22.09.2026, §2).
        The button is a word and a glyph, never the glyph alone.
      */}
      <div className={styles.topBar}>
        {/* RTL: back is on the RIGHT — first in the source — and its chevron
            points the way back, which in Hebrew is rightwards. The ⋮ is the
            ONE other control in the bar (spec §8.1): every action, print and
            PDF included, is inside it. */}
        <BackControl>המחברת</BackControl>
        <RecipeMenu actions={menuActions} status={shareStatus} />
      </div>

      {actionError && (
        <p className={styles.confirmBox} role="alert">
          {actionError}
        </p>
      )}


      {confirmDelete && (
        <div
          className={styles.confirmBox}
          role="alertdialog"
          aria-modal="false"
          aria-label="אישור מחיקת מתכון"
        >
          {/*
            Stage 6: a recipe in use as somebody's base CANNOT be deleted. The
            enforcement is the foreign key in migration 0008 and this cannot
            weaken it — what this branch adds is the one thing the database
            cannot say, which is WHICH recipes are holding it and therefore what
            the user has to do next.
          */}
          {blocked ? (
            <>
              <p className={styles.confirmTitle}>
                אי אפשר למחוק את &quot;{recipe.name}&quot;
              </p>
              <p className={styles.confirmBody}>
                {usedBy.length === 1
                  ? 'מתכון אחד משתמש בו כמתכון בסיס'
                  : `${usedBy.length} מתכונים משתמשים בו כמתכון בסיס`}
                , ומחיקה הייתה משאירה אצלם שורה בלי משקל ובלי עלות. כדי למחוק את
                המתכון הזה, יש להסיר קודם את הקישור בכל אחד מהם:
              </p>
              <ul className={styles.confirmDeps} aria-label="מתכונים שמשתמשים במתכון הזה">
                {usedBy.map((r) => (
                  <li key={r.id}>
                    <Link to={`/recipe/${r.id}/edit`}>{r.name}</Link>
                  </li>
                ))}
              </ul>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setConfirmDelete(false)}
                  aria-label="סגירת ההודעה"
                >
                  הבנתי
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.confirmTitle}>למחוק את &quot;{recipe.name}&quot;?</p>
              {/* §7 asks for a confirmation. A confirmation that does not say
                  what goes with it is not really one — the child rows are
                  ON DELETE CASCADE, so this is the only place the user learns
                  that. */}
              <p className={styles.confirmBody}>
                יימחקו גם הרכיבים, השלבים, התקלות, יומן הניסיונות, האצוות
                וההיסטוריה של המתכון. אי אפשר לשחזר.
              </p>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.actionBtnDanger}
                  onClick={() => void onDelete()}
                  disabled={actionBusy === 'delete'}
                  aria-label={`אישור מחיקת ${recipe.name}`}
                >
                  {actionBusy === 'delete' ? 'מוחק…' : 'כן, למחוק'}
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setConfirmDelete(false)}
                  aria-label="ביטול המחיקה"
                >
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* What the printer gets: the recipe as a document, outside the app
          frame. Nothing of it shows on screen. */}
      <RecipePrintSheet
        recipe={recipe}
        computed={computed}
        factor={factor}
        scaleText={
          factor === 1
            ? SCALE_MODE_TEXT.recipe
            : `${SCALE_MODE_TEXT[scaleMode]} · ×${factor.toFixed(2)}`
        }
        prefs={prefs}
        imageUrl={heroUrl}
      />

      {/*
        ── the hero ───────────────────────────────────────────────────────

        The handoff asks for a wide photograph at the top, about a quarter to
        a third of the screen, scrolling with the page — and, when the recipe
        has no photograph, NO enormous empty rectangle.

        While the list is still loading nothing is reserved either: a skeleton
        the height of a hero would flash on every recipe that has no
        photograph, which is most of them. The cost is one reflow on the
        recipes that do have one — see `useRecipeImages`.
      */}
      {/*
        ── THE HERO BAND (spec §8.3, stage 5) ─────────────────────────────

        Full content width, a FIXED height (220px on a phone, 320px on a wide
        frame — proposed values, in recipe.module.css), the photograph cropped
        with `cover` from its focal point. With no photograph — or a link that
        no longer resolves (`imageState.broken` clears the URL) — the same band
        is the notebook's paper with a rule under it and a quiet glyph: the
        page keeps its shape whether or not it has a picture.
      */}
      {heroUrl ? (
        <div className={styles.hero}>
          {/*
            DECORATIVE, DELIBERATELY. This is the SAME photograph the gallery
            below the steps lists, with its caption and its alt text. Naming it
            twice makes a screen reader read one picture twice on every recipe;
            the hero is the visual presentation of something already announced.
          */}
          <img
            className={styles.heroPhoto}
            src={heroUrl}
            alt=""
            aria-hidden="true"
            /*
              `cover` crops, and this is where it crops FROM — the stored
              focal point, or the one being dragged. With no adjustment it is
              50% 50%, which is exactly what `cover` does on its own, so a
              photograph nobody has touched looks the way it always did.
            */
            style={{ objectPosition: `${focus.x}% ${focus.y}%` }}
            onError={() => heroImage && imageState.broken(heroImage)}
          />
          {/*
            ── THE POSITION CONTROL, ON THE PICTURE ITSELF ──────────────────

            Only for somebody who may edit this recipe — Ahmed: "אפשר שינוי
            תמונה רק למי שמורשה לערוך את המתכון" — and only when there IS a
            picture, because there is nothing to position otherwise.

            Pressing anywhere on the band sets the focal point to that spot, and
            the picture moves under the finger immediately: the preview is the
            hero, at the size it really is, rather than a thumbnail that lies
            about the crop. Then "שמירה" writes it and "ביטול" throws the draft
            away and the stored point comes back.

            A press and not a drag: a drag over the band would fight the page's
            own vertical scroll on a phone, and on a photograph 170-300px tall a
            tap is precise enough — the whole adjustment is which THIRD of the
            picture you want.
          */}
          {canEditPhoto && draftFocus !== null && (
            <button
              type="button"
              className={styles.focusTarget}
              aria-label="בחירת מיקום התמונה — לחיצה על הנקודה שתישאר במרכז"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                setDraftFocus({
                  x: ((e.clientX - box.left) / box.width) * 100,
                  y: ((e.clientY - box.top) / box.height) * 100,
                });
              }}
            >
              <span
                className={styles.focusDot}
                style={{ insetInlineStart: `${focus.x}%`, insetBlockStart: `${focus.y}%` }}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      ) : (
        <div className={styles.heroFallback} aria-hidden="true">
          <ImageIcon width={1.5} />
          <span className={styles.heroFallbackText}>
            {imageState.load === 'ready' ? 'אין תמונה למתכון' : ''}
          </span>
        </div>
      )}

      {/*
        ── THE ROW THAT OPENS, SAVES AND CANCELS ──────────────────────────

        Under the picture rather than on it: three controls on a photograph
        would cover the photograph, which is the thing being judged.

        "נשמר" appears only after the write came back true — the same rule as
        the personal note, and for the same reason. A failure leaves the panel
        OPEN with the draft still in it, so nothing typed or chosen is thrown
        away by an error.
      */}
      {heroUrl && canEditPhoto && (
        <div className={styles.focusBar}>
          {draftFocus === null ? (
            <>
              <button
                type="button"
                className={styles.focusBtn}
                onClick={() => {
                  setFocusSaved(false);
                  setDraftFocus({
                    x: heroImage?.focalX ?? 50,
                    y: heroImage?.focalY ?? 50,
                  });
                }}
              >
                התאמת מיקום התמונה
              </button>
              {focusSaved && (
                <span className={styles.focusOk} role="status">
                  המיקום נשמר
                </span>
              )}
            </>
          ) : (
            <>
              <span className={styles.focusHint}>
                לחצו על הנקודה בתמונה שתישאר במרכז החיתוך.
              </span>
              <button
                type="button"
                className={styles.focusBtnPrimary}
                disabled={imageState.busy}
                onClick={() => {
                  if (!heroImage) return;
                  const at = draftFocus;
                  void imageState.refocus(heroImage, at).then((ok) => {
                    if (!ok) return;
                    setDraftFocus(null);
                    setFocusSaved(true);
                  });
                }}
              >
                {imageState.busy ? 'שומר…' : 'שמירת המיקום'}
              </button>
              <button
                type="button"
                className={styles.focusBtn}
                onClick={() => setDraftFocus(null)}
              >
                ביטול
              </button>
            </>
          )}
          {/*
            A failed save is said HERE, beside the button that was pressed,
            and the panel stays open with the chosen point still in it: the
            person picked a spot, and an error is no reason to throw that
            away. "נסה שוב" writes the same point again.
          */}
          {imageState.error && draftFocus !== null && (
            <span className={styles.focusError} role="alert">
              {imageState.error}
            </span>
          )}
        </div>
      )}

      {/*
        The identity block, as the handoff draws it: the name, the category it
        belongs to, and what the recipe makes — centred under the picture. The
        category is a link to the notebook filtered by it, because on paper it
        is a label and here it is the way back to its neighbours.
      */}
      <header className={styles.header}>
        <h1 className={styles.title}>{recipe.name}</h1>
        {recipe.category && (
          <Link
            to={`/notebook?category=${encodeURIComponent(String(recipe.category))}`}
            className={styles.categoryPill}
          >
            {recipe.category}
          </Link>
        )}
        <p className={styles.meta}>
          <span className="ltr">
            {computed.unitsActual
              ? `${Math.round(computed.unitsActual)} יחידות`
              : derived(formatGrams(computed.actualYield))}
          </span>
          {Number(recipe.unitWeight) > 0 && (
            <>
              {' · '}
              <span className="ltr">{recipe.unitWeight} גר' ליחידה</span>
            </>
          )}
          {totalMinutes > 0 && (
            <>
              {' · '}
              <span className="ltr">{timeLabel}</span> עבודה ואפייה
            </>
          )}
        </p>
        {recipe.locked && <p className={styles.lockedNote}>נוסחה מאושרת לייצור</p>}
      </header>

      {savedNotice && (
        <p className={styles.savedNotice} role="status">
          {savedNotice === 'created' ? 'המתכון נשמר במחברת.' : 'השינויים נשמרו.'}
        </p>
      )}

      <CalcNotice state={calc} />

      {/*
        §14 Cook Mode. Its own row above the edit actions and not inside them:
        this is the button you press to START WORKING, and it should not be one
        of four identical boxes next to "מחיקה". A recipe with no steps has
        nothing to cook, and the link is then not offered at all rather than
        leading to a screen that apologises.
      */}
      {(recipe.steps ?? []).some((st) => st.text || st.minutes) && (
        <Link
          to={`/recipe/${recipe.id}/cook${scaleSearch}`}
          className={styles.cookBtn}
        >
          מצב הכנה
        </Link>
      )}

      {/* ── §6 scaling ─────────────────────────────────────────────────── */}
      <section className={styles.card} ref={scaleRef}>
        <h2 className={styles.cardTitle}>כמה להכין?</h2>
        <div className={styles.tabs} role="group" aria-label="מצב שינוי כמויות">
          {SCALE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={scaleMode === t.id ? styles.tabOn : styles.tab}
              onClick={() => {
                setScaleMode(t.id);
                setScaleValue('');
              }}
              aria-pressed={scaleMode === t.id}
              {...(t.srLabel ? { 'aria-label': t.srLabel } : {})}
            >
              {t.label}
            </button>
          ))}
        </div>

        {scaleMode !== 'recipe' && (
          <div className={styles.scaleInputs}>
            <label className="visuallyHidden" htmlFor="scale-value">
              {PLACEHOLDER[scaleMode]}
            </label>
            <input
              id="scale-value"
              className={styles.input}
              inputMode="decimal"
              value={scaleValue}
              onChange={(e) => setScaleValue(e.target.value)}
              placeholder={PLACEHOLDER[scaleMode]}
            />
            {scaleMode === 'stock' && (
              <select
                className={styles.select}
                value={scaleIngredient}
                onChange={(e) => setScaleIngredient(e.target.value)}
                aria-label="לפי איזה רכיב"
              >
                <option value="">בחרו רכיב</option>
                {baseline.rows
                  .filter((r) => r.g !== null)
                  .map((r) => (
                    <option key={r.ing.id} value={r.ing.id}>
                      {r.ing.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}

        <p className={styles.scaleSummary}>
          {factor === 1 ? 'כמו במתכון' : <>מקדם ×<span className="ltr">{factor.toFixed(2)}</span></>}
          {' · '}
          <span className="ltr">{derived(formatGrams(computed.actualYield))}</span>
          {computed.unitsActual > 0 && (
            <>
              {' · '}
              <span className="ltr">{Math.round(computed.unitsActual)}</span> יחידות
            </>
          )}
        </p>
        {computed.unitsWarn && (
          <p className={styles.warn}>
            ⚠ לפי המשקלים האצווה מפיקה כ-
            <span className="ltr">{computed.unitsFromWeight.toFixed(1)}</span> יחידות, לא{' '}
            <span className="ltr">{Math.round(computed.unitsDeclared)}</span>. החישוב כאן
            הולך לפי המספר שנרשם במתכון.
          </p>
        )}
        {scaleMode !== 'recipe' && scaleValue.trim() !== '' && !(Number(scaleValue) > 0) && (
          <p className={styles.warn} role="alert">
            {Number.isFinite(Number(scaleValue))
              ? 'הכמות חייבת להיות מספר גדול מאפס. מוצגות הכמויות כמו במתכון.'
              : 'זה לא מספר. מוצגות הכמויות כמו במתכון.'}
          </p>
        )}
        {/* §6: the original is never overwritten. Say it, don't imply it. */}
        <p className={styles.calcNote}>
          שינוי הכמויות כאן הוא חישוב בלבד. המתכון המקורי לא משתנה.
        </p>
      </section>

      {/* ── §5.4 ingredient table ──────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeadRow}>
          <h2 className={styles.cardTitle}>רכיבים</h2>
          <div className={styles.tabsSmall} role="group" aria-label="תצוגת יחידות">
            {VIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={view === t.id ? styles.tabSmallOn : styles.tabSmall}
                onClick={() => setView(t.id)}
                aria-pressed={view === t.id}
                {...(t.srLabel ? { 'aria-label': t.srLabel } : {})}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {view !== 'orig' && (
          <p className={styles.viewNote}>
            {view === 'g'
              ? 'תצוגה בגרמים. המתכון המקורי לא השתנה.'
              : 'תצוגה בכלי המדידה שלכם. רכיב שאין לו נתון אמין נשאר בגרמים ומסומן ככזה.'}
          </p>
        )}

        <ul className={styles.ingredients}>
          {computed.rows.map((row) => {
            const { text, hint } = label(row);
            const unresolved = row.g === null;
            return (
              <li key={row.ing.id ?? row.ing.name}>
                <button
                  type="button"
                  className={styles.ingRow}
                  onClick={() => setConvertIngredient(row.ing)}
                >
                  <span className={unresolved ? styles.qtyMissing : styles.qty}>
                    <span className="ltr">{text}</span>
                    {hint && <span className={styles.qtyHint}>{hint}</span>}
                  </span>
                  <span className={styles.ingName}>
                    {row.ing.name}
                    {row.ing.note && <span className={styles.ingNote}>{row.ing.note}</span>}
                    {unresolved && (
                      <span className={styles.ingUnresolved}>{row.provenance.why}</span>
                    )}
                  </span>
                  {!unresolved && row.provenance.source !== 'exact' && (
                    <SourceBadge provenance={row.provenance} />
                  )}
                  <span className={styles.convertHint}>המרה</span>
                </button>
              </li>
            );
          })}
        </ul>

        {computed.unresolved.length > 0 && (
          <p className={styles.unresolvedSummary}>
            {computed.unresolved.length === 1
              ? 'רכיב אחד לא נכנס לסך המשקל ולעלות, כי אין לו נתון צפיפות אמין.'
              : `${computed.unresolved.length} רכיבים לא נכנסו לסך המשקל ולעלות, כי אין להם נתון צפיפות אמין.`}
          </p>
        )}
      </section>

      {/* ── steps ──────────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>אופן ההכנה</h2>
        <ol className={styles.steps}>
          {(recipe.steps ?? []).map((s, i) => (
            <li key={s.id ?? i} className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.stepBody}>
                <span className={styles.stepText}>{s.text}</span>
                {(s.temp || s.minutes) && (
                  <span className={styles.stepMeta}>
                    {s.temp && <span className="ltr">{s.temp}°C</span>}
                    {s.temp && s.minutes ? ' · ' : ''}
                    {s.minutes && <span className="ltr">{s.minutes} דקות</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/*
        ── §5 photographs ────────────────────────────────────────────────

        DESIGN PASS: BELOW THE WORK, NOT ABOVE IT.

        This card used to sit between the recipe's name and "מצב הכנה". On a
        phone that put an empty dashed placeholder across the first screen, so
        the button that starts the cooking, the quantities and the ingredients
        all began below the fold. A photograph is a reference you check, not
        the thing you came for — it reads after the steps. Nothing about the
        card changed: same component, same permissions, same upload.

        On the recipe page rather than in the edit form: an upload happens
        immediately, and an immediate action inside a form whose promise is
        "nothing happens until you save" means cancelling the edit leaves the
        photo behind. RecipeImages.tsx has the longer version.

        `canEdit` is ownership, not the profile: a member reading a group
        recipe may see its photos and may not add to them, which is what
        migration 0029's storage policies enforce anyway.
      */}
      <div id="recipe-images">
        <RecipeImages
          state={imageState}
          canWrite={capabilities.canWrite}
          canEdit={!recipe.group_id}
        />
      </div>

      {recipe.notes && <p className={styles.recipeNote}>{recipe.notes}</p>}

      {/* ── §8 the personal note ───────────────────────────────────────── */}
      <PrivateNote
        recipeId={recipe.id}
        initial={note}
        canWrite={capabilities.canWrite}
        onSave={(body) => savePrivateNote(recipe.id, body)}
        /* The draft is private text, so it is kept per account as well as per
           recipe; `raiseError` is how a failure from the unmount flush is
           still seen after this screen is gone. */
        userId={userId}
        onFlushError={raiseError}
      />

      {/*
        ── the actions, sorted by how often a kitchen needs them ──────────

        UX PASS. Six controls used to sit between the recipe's name and its
        ingredients: מצב הכנה, תווית מוצר, דף הזמנה, עריכה, שכפול, מחיקה. Two
        of them are daily (start cooking, fix a quantity), one is a star, and
        three are occasional — and a delete button does not belong at eye level
        next to the thing you press with flour on your hands.

        So: "מצב הכנה" is above, on its own. Here are the two that are pressed
        often, and everything else is one tap away under "עוד פעולות" —
        present, labelled, and not competing.
      */}
      {/*
        ── "נתוני ייצור ועלויות" ───────────────────────────────────────────────

        Everything a professional needs and a cook standing at a bowl does not:
        the food cost, the yield and the loss, the baker's formula, the
        allergens and the version history. Nothing was removed and nothing was
        gated by profile (§3 forbids that) — it is all one summary away, and
        the summary says what is inside it.
      */}
      <details
        className={styles.proDetails}
        open={showPro}
        onToggle={(e) => setShowPro(e.currentTarget.open)}
      >
        <summary className={styles.proSummary}>נתוני ייצור ועלויות</summary>
        {showPro && (
        <div className={styles.proBody}>
          {/*
            ── §7 the pan ──────────────────────────────────────────────

            It used to sit straight after the scale card, because that is what
            it drives: "התאמה" sets weight scaling at the adapted yield, which
            is §7's "ההתאמה קובעת מצב סקיילינג משקל — כלומר חישוב, לא דריסה".

            The UX pass moved it in here. Adapting a formula from the tin it
            was written for to the tin you own is a professional tool, and as
            a card of its own it stood between "כמה להכין?" and the
            ingredients — in the middle of the path a cook walks. The
            behaviour is unchanged, and because the scale card it drives is
            now above rather than below, "התאמה" scrolls it back into view so
            the effect of the press is seen and not just trusted.
          */}
          <PanCard
            recipePan={recipe.pan ?? null}
            baselineYield={baseline.actualYield}
            onAdapt={(grams) => {
              setScaleMode('weight');
              setScaleValue(String(Math.round(grams)));
              scaleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          />

        {/* ── §13 production data ─────────────────────────────────────────
            Inside "נתוני ייצור ועלויות" now, and no longer behind a second button of
            its own: a disclosure inside a disclosure made the user open two
            things to read one number. */}
        <section className={styles.card}>
            <div className={styles.prodBlocks}>
              {/* ── stage-7 requirement 4: food cost ─────────────────────── */}
              <section className={styles.fcBlock} aria-label="פוד קוסט">
                <h3 className={styles.fcTitle}>פוד קוסט</h3>
                <dl className={styles.fcGrid}>
                  <div className={styles.fcRow}>
                    <dt>עלות חומרי הגלם</dt>
                    <dd className="ltr">{money(fc.cost)}</dd>
                  </div>
                  <div className={styles.fcRow}>
                    <dt>עלות לק&quot;ג</dt>
                    <dd className="ltr">{money(fc.costPerKg)}</dd>
                  </div>
                  <div className={styles.fcRow}>
                    <dt>עלות ליחידה</dt>
                    <dd className="ltr">{money(fc.costPerUnit)}</dd>
                  </div>
                  <div className={styles.fcRow}>
                    <dt>מחיר מכירה</dt>
                    <dd className="ltr">{money(fc.salePrice)}</dd>
                  </div>
                  <div className={`${styles.fcRow} ${styles.fcHeadline}`}>
                    <dt>אחוז פוד קוסט</dt>
                    <dd className="ltr" aria-label="אחוז פוד קוסט">
                      {fc.percent === null ? '—' : `${fc.percent.toFixed(1)}%`}
                    </dd>
                  </div>
                </dl>

                {/*
                  A dash with no explanation reads as a bug. Requirement 4 says
                  not to show a food cost when an input is unknown, and this is
                  the other half of that: saying WHICH input.
                */}
                {fc.why && (
                  <p className={styles.fcWhy} role="status" aria-label="למה אין אחוז פוד קוסט">
                    {fc.why}
                  </p>
                )}

                {toPrice.length > 0 && (
                  <p className={styles.fcTodo}>
                    חסר מחיר ל: {toPrice.map((m) => m.name).join(' · ')}.{' '}
                    <Link to="/ingredients">להזין מחיר במרכז חומרי הגלם</Link>
                  </p>
                )}
              </section>

              {/* ── stage-8 requirements E, F, G ──────────────────────────── */}
              <section className={styles.fcBlock}>
                <CostingPanel breakdown={breakdown} profit={profit} target={targets} />
              </section>

              {/*
                Every figure in these three blocks is a sum over the ingredient
                rows, so `partial` marks all of them at once rather than each
                call site having to remember (requirement 8). The two rows that
                are not sums — the food-cost target and the water temperature —
                are excluded below.
              */}
              <ProdBlock
                title="תשואה ופחת"
                partial={calc.partialFigures}
                items={[
                  ['תשואה תאורטית', derived(formatGrams(computed.theoretical))],
                  ['תשואה מעשית', derived(formatGrams(computed.actualYield))],
                  /*
                    STAGE-11 FIX, the project's own null-vs-zero rule applied to
                    the two rows that broke it. `prodLoss` is 0 when nobody
                    measured the actual yield, and `bakeLoss` is 0 when nobody
                    weighed the batch before and after — and both were printed as
                    "0.0%", which tells a baker there was no loss. There is a
                    difference between "no loss" and "not measured", and the row
                    now says which, exactly as the two rows below it already did.
                  */
                  [
                    'פחת ייצור',
                    recipe.yieldActual === null ||
                    recipe.yieldActual === undefined ||
                    recipe.yieldActual === ''
                      ? '— לא נמדדה תשואה בפועל'
                      : derived(`${computed.prodLoss.toFixed(1)}%`),
                  ],
                  [
                    'פחת אפייה',
                    weighedForLoss
                      ? derived(`${computed.bakeLoss.toFixed(1)}%`)
                      : '— לא נשקל לפני ואחרי',
                  ],
                  [
                    'משקל לשקילה ליחידה',
                    computed.scaleWeight ? derived(formatGrams(computed.scaleWeight)) : '—',
                  ],
                  [
                    'יחידות בפועל',
                    computed.unitsActual ? derived(String(Math.round(computed.unitsActual * 10) / 10)) : '—',
                  ],
                ]}
              />
              {pro && (
                <>
                  {calc.costSummary && (
                    <p
                      className={
                        calc.costLevel === 'none' ? styles.calcNoneBox : styles.unresolvedSummary
                      }
                      role="status"
                      aria-label="שלמות התמחור"
                    >
                      {calc.costSummary}
                      {calc.costLevel === 'partial' && calc.unpricedNames.length > 0 && (
                        <> חסר מחיר עבור: {calc.unpricedNames.join(' · ')}</>
                      )}
                    </p>
                  )}
                  <ProdBlock
                    title="עלות ותמחור"
                    partial={calc.partialFigures || calc.costLevel === 'partial'}
                    exact={['יעד פוד קוסט']}
                    items={[
                      ['עלות חומרי גלם', priced(formatNis(computed.cost))],
                      [
                        'עלות ליחידה',
                        computed.costPerUnit ? priced(formatNis(computed.costPerUnit)) : '—',
                      ],
                      ['עלות לק"ג', priced(formatNis(computed.costPerKg))],
                      // 0 is how "no target" is stored (the column defaults to 0), and
                      // "0%" read as a target of zero (QA 22.09.2026, acceptance finding 10).
                      ['יעד פוד קוסט', Number(recipe.targetFC) > 0 ? `${recipe.targetFC}%` : 'לא הוגדר'],
                      [
                        'מחיר מכירה לפני מע"מ',
                        computed.price ? priced(formatNis(computed.price)) : '—',
                      ],
                    ]}
                  />
                </>
              )}
              {computed.flour > 0 && (
                <ProdBlock
                  title="נוסחה"
                  partial={calc.partialFigures}
                  exact={["טמפ' מים מחושבת"]}
                  items={[
                    ['סך קמח', derived(formatGrams(computed.flour))],
                    ['סך נוזלים', derived(formatGrams(computed.liquid))],
                    ['הידרציה', derived(`${computed.hydration.toFixed(1)}%`)],
                    ['הידרציה נטו, מים בפועל', derived(`${computed.trueHydration.toFixed(1)}%`)],
                    ...(computed.waterTemp !== null
                      ? ([['טמפ\' מים מחושבת', `${Math.round(computed.waterTemp)}°C`]] as [
                          string,
                          string,
                        ][])
                      : []),
                  ]}
                />
              )}
              {computed.warnings.length > 0 && (
                <div className={styles.warningsBox}>
                  <h3 className={styles.warningsTitle}>הנחות שנעשו בחישוב</h3>
                  <ul>
                    {computed.warnings.map((w) => (
                      <li key={w}>· {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
        </section>


        <p className={styles.allergens}>
          {computed.allergens.length ? `מכיל: ${computed.allergens.join(' · ')}` : 'לא זוהו אלרגנים'}
        </p>

        {/* ── §9 version history ─────────────────────────────────────────── */}
        <VersionHistory
          versions={versions}
          /*
            The PRICED recipe, not the raw one. A stored version is frozen with
            its catalogue prices filled in (migration 0011's snapshot), so
            comparing it against the raw live recipe — whose rows carry no
            price of their own — reported "מחיר 4 ← —" on every priced row for
            an edit that touched no price (QA 22.09.2026, acceptance finding
            7). Resolution is idempotent, so the frozen side passes through
            unchanged and both sides are compared on equal terms.
          */
          recipe={pricedRecipe ?? recipe}
          recipes={pricedNotebook}
          prefs={prefs}
          canRestore={capabilities.canWrite && recipe.locked !== true}
          lockedReason={
            recipe.locked === true
              ? 'המתכון מסומן כנוסחה מאושרת לייצור, ולכן שחזור חסום עד ביטול הנעילה.'
              : !capabilities.canWrite
                ? 'אין כרגע חיבור, ולכן אי אפשר לשחזר.'
                : null
          }
          busyId={restoreBusy}
          error={versionError}
          onRestore={(v) => void onRestore(v)}
        />

        {/* ── the trial log (spec 5.1; stage 3ב, A-6) ──────────────────────
            Last in the professional details: a record of bakes, read after
            the numbers and written after the oven. In stage 5 this whole
            block moves behind "נתוני ייצור ועלויות". */}
        <TrialLog
          trials={recipe.trials ?? []}
          canWrite={capabilities.canWrite}
          onSave={(next) => saveTrials(recipe.id, next)}
        />

        </div>
        )}
      </details>


      {convertIngredient && (
        <ConvertSheet
          ingredient={convertIngredient}
          factor={factor}
          displayGrams={
            computed.rows.find((r) => r.ing.id === convertIngredient.id)?.g ?? null
          }
          prefs={prefs}
          onClose={() => setConvertIngredient(null)}
          onCalibrate={(name) => {
            setConvertIngredient(null);
            setCalibrateFor(name);
          }}
        />
      )}

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

/**
 * Requirement 8, at the top of the page: the honest state of the calculation,
 * before any figure derived from it is read.
 */
function CalcNotice({ state }: { state: CalcState }) {
  if (state.level === 'full') return null;
  return (
    <div
      className={state.level === 'none' ? styles.calcNoneBox : styles.calcPartialBox}
      role="status"
      aria-label="שלמות החישוב"
    >
      <p className={styles.calcNoticeTitle}>
        {state.level === 'none' ? 'לא ניתן לחשב' : 'נתונים חלקיים'}
      </p>
      <p className={styles.calcNoticeBody}>{state.summary}</p>
      {state.missingNames.length > 0 && (
        <p className={styles.calcNoticeList}>
          חסרים נתונים עבור: {state.missingNames.join(' · ')}
        </p>
      )}
    </div>
  );
}

function ProdBlock({
  title,
  items,
  partial = false,
  /** rows that are an input, not a sum, so a partial calculation does not touch them */
  exact = [],
}: {
  title: string;
  items: [string, string][];
  partial?: boolean;
  exact?: readonly string[];
}) {
  return (
    <div className={styles.prodBlock}>
      <h3 className={styles.prodTitle}>{title}</h3>
      <dl className={styles.prodRows}>
        {items.map(([k, v]) => {
          const marked = partial && !exact.includes(k) && v !== '—';
          return (
            <div key={k} className={styles.prodRow}>
              <dt>{k}</dt>
              <dd className="ltr">
                {v}
                {marked && (
                  <span className={styles.partialChip} title="מחושב מחלק מהרכיבים בלבד">
                    חלקי
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
