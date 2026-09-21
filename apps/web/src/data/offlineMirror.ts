// The offline mirror — the local half of the approved hybrid model.
//
// Holds only what has to survive a dead zone in the kitchen:
//   • measurement preferences and calibrations — every conversion needs them
//   • the active recipe — so the recipe page and Cook Mode keep working
//   • Cook Mode progress — the Mise en place ticks, step marks and the step you
//     were on, which the prototype lost on every reload (a real annoyance
//     mid-bake, and worse when it is the weighing that is lost)
//
// It is a CACHE, never the source of truth. Nothing here is authoritative and
// nothing here is synced upward; writes go to the repository.
//
// Every accessor is failure-tolerant: IndexedDB throws in private windows, with
// site data blocked, and in some embedded webviews. A cache miss must degrade to
// "we have nothing local", never to a crash.

import { clear, del, get, set } from 'idb-keyval';
import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';

const KEY = {
  prefs: 'rn.prefs.v1',
  calibrations: 'rn.calibrations.v1',
  recipe: (id: string) => `rn.recipe.v1.${id}`,
  recipeIndex: 'rn.recipeIndex.v1',
  cookProgress: (recipeId: string) => `rn.cook.v1.${recipeId}`,
  lastOpened: 'rn.lastOpened.v1',
  recents: 'rn.recents.v1',
  favorites: 'rn.favorites.v1',
  cookTextSize: 'rn.cookTextSize.v1',
} as const;

async function safeGet<T>(key: string): Promise<T | null> {
  try {
    return (await get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: unknown): Promise<boolean> {
  try {
    await set(key, value);
    return true;
  } catch {
    return false;
  }
}

async function safeDel(key: string): Promise<void> {
  try {
    await del(key);
  } catch {
    /* nothing to do — the mirror is best effort */
  }
}

// ── measurement preferences ────────────────────────────────────────────────

export const readPrefs = (): Promise<MeasurementPrefs | null> =>
  safeGet<MeasurementPrefs>(KEY.prefs);

export const writePrefs = (prefs: MeasurementPrefs): Promise<boolean> =>
  safeSet(KEY.prefs, prefs);

export const readCalibrations = async (): Promise<Calibration[]> =>
  (await safeGet<Calibration[]>(KEY.calibrations)) ?? [];

export const writeCalibrations = (list: readonly Calibration[]): Promise<boolean> =>
  safeSet(KEY.calibrations, list);

// ── recipes ────────────────────────────────────────────────────────────────

/** A trimmed row for the notebook list, so the list renders with no network. */
export interface RecipeIndexRow {
  id: string;
  name: string;
  category: string;
  isSub: boolean;
  locked: boolean;
  tags: string[];
}

export const readRecipeIndex = async (): Promise<RecipeIndexRow[]> =>
  (await safeGet<RecipeIndexRow[]>(KEY.recipeIndex)) ?? [];

export const writeRecipeIndex = (rows: readonly RecipeIndexRow[]): Promise<boolean> =>
  safeSet(KEY.recipeIndex, rows);

export const readRecipe = (id: string): Promise<Recipe | null> =>
  safeGet<Recipe>(KEY.recipe(id));

/** Mirrors the recipe the user just opened — this is what "active recipe" means. */
export const writeRecipe = (recipe: Recipe): Promise<boolean> =>
  safeSet(KEY.recipe(recipe.id), recipe);

export const forgetRecipe = (id: string): Promise<void> => safeDel(KEY.recipe(id));

// ── Cook Mode progress (§14) ───────────────────────────────────────────────

export interface CookProgress {
  recipeId: string;
  /** step index → completed */
  done: Record<number, boolean>;
  step: number;
  updatedAt: number;
  /*
    §14 Mise en place. Three OPTIONAL fields on the record that already
    existed, rather than a second store: this is the same fact as the step
    marks — how far this preparation has got on this device — and it belongs in
    the same row, cleared by the same "סיום ההכנה" and by the same
    `clearMirror()` on sign-out. A record written before these existed reads
    back with them undefined, which is "nothing was weighed yet".
  */
  /** tick key → weighed and on the bench. Keys come from `features/cook/mise.ts`. */
  mise?: Record<string, boolean>;
  /**
   * The scale those ticks were taken at.
   *
   * A tick says "500 grams of this is ready", so it is only true at the factor
   * it was made at. Stored beside the ticks so a run at another scale does not
   * inherit them; `restoreMise` is what compares them.
   */
  miseScale?: string;
  /** the person pressed "הכול מוכן — מתחילים בהכנה" for this preparation */
  started?: boolean;
}

export const readCookProgress = (recipeId: string): Promise<CookProgress | null> =>
  safeGet<CookProgress>(KEY.cookProgress(recipeId));

export const writeCookProgress = (progress: CookProgress): Promise<boolean> =>
  safeSet(KEY.cookProgress(progress.recipeId), {
    ...progress,
    updatedAt: Date.now(),
  });

export const clearCookProgress = (recipeId: string): Promise<void> =>
  safeDel(KEY.cookProgress(recipeId));

// ── the last recipe opened on this device (§2 screen 2) ────────────────────
//
// DEVICE state, deliberately, and the home screen says so in those words. The
// alternative is a `last_opened` column on `recipes`, which would mean an
// account-wide write on every recipe view — a write whose only purpose is to
// decorate one card, and which would make "where you stopped" follow you onto
// a shared kitchen tablet. `clearMirror()` on sign-out takes this with
// everything else, which is the behaviour a shared device needs.

export const readLastOpened = (): Promise<string | null> =>
  safeGet<string>(KEY.lastOpened);

export const writeLastOpened = (recipeId: string): Promise<boolean> =>
  safeSet(KEY.lastOpened, recipeId);

// ── recently opened, and favourites (UX pass) ──────────────────────────────
//
// WHY THESE LIVE HERE AND NOT IN THE DATABASE
//
// The home screen asks for two lists: the recipes opened lately, and the ones
// marked as favourites. Neither needs a column, and adding one would be the
// expensive answer: a `last_opened` write on every view (see the note above),
// and a `favorite` column plus a migration and an RLS review for a star that
// only decorates a list. Both are decisions about THIS DEVICE — the kitchen
// tablet's recents are not the pastry chef's phone's — and both ride on the
// mirror that already exists, are already wiped on sign-out, and already
// tolerate a browser that refuses storage.
//
// The cost is stated where the user sees it: the home screen says these are
// this device's. If they ever have to follow an account, that is a schema
// change to ask for, not one to make quietly.

/** How many recently-opened recipes are kept. Enough for one morning's work. */
const RECENTS_MAX = 8;

export const readRecents = async (): Promise<string[]> =>
  (await safeGet<string[]>(KEY.recents)) ?? [];

/**
 * Records that a recipe was opened: it goes to the front, any earlier visit to
 * the same recipe is removed rather than repeated, and the list is capped.
 * Also keeps `lastOpened` — the two answer different questions and the home
 * screen shows both.
 */
export async function noteRecipeOpened(recipeId: string): Promise<void> {
  await safeSet(KEY.lastOpened, recipeId);
  const list = await readRecents();
  const next = [recipeId, ...list.filter((id) => id !== recipeId)].slice(0, RECENTS_MAX);
  await safeSet(KEY.recents, next);
}

/**
 * Drops a deleted recipe from this device's short lists.
 *
 * Without it the home screen keeps offering a recipe that is gone — it would
 * be filtered out (the lists are resolved against the notebook) but the id
 * would sit in storage for ever, and the "recents" list would be shorter than
 * it looks. Also takes the cached copy and any cooking progress: there is
 * nothing left to cook.
 */
export async function forgetRecipeLocally(recipeId: string): Promise<void> {
  const [recents, favorites] = await Promise.all([readRecents(), readFavorites()]);
  await Promise.all([
    safeSet(KEY.recents, recents.filter((id) => id !== recipeId)),
    safeSet(KEY.favorites, favorites.filter((id) => id !== recipeId)),
    safeDel(KEY.recipe(recipeId)),
    safeDel(KEY.cookProgress(recipeId)),
  ]);
}

export const readFavorites = async (): Promise<string[]> =>
  (await safeGet<string[]>(KEY.favorites)) ?? [];

/** Adds or removes a favourite and returns the list as it now stands. */
export async function toggleFavorite(recipeId: string): Promise<string[]> {
  const list = await readFavorites();
  const next = list.includes(recipeId)
    ? list.filter((id) => id !== recipeId)
    : [recipeId, ...list];
  await safeSet(KEY.favorites, next);
  return next;
}

/**
 * Wipes the whole mirror.
 *
 * Called on sign-out. The mirror is a plaintext copy of ONE account's recipes,
 * preferences and calibrations, sitting on a device that may be shared — a
 * kitchen tablet, most likely. Leaving it in place would mean the next person
 * to sign in could read the previous account's notebook straight out of the
 * cache before the first network response arrives, which is exactly the
 * isolation RLS exists to provide.
 *
 * `clear()` empties the default idb-keyval store, and this module is the only
 * writer to it, so nothing else is affected. Failure is tolerated the same way
 * every other accessor here tolerates it, and each key is then removed
 * individually as a fallback.
 */
// ── the size of the text in Cook Mode ─────────────────────────────────────
//
// §10 of the handoff asks for a text-size setting that really takes effect.
// It lives HERE, on the device, and not in the account — and that is not a
// shortcut around the profiles table, it is the right place for it: how large
// the instructions have to be depends on the screen you are reading them
// from and how far away it is propped up. The same baker wants one size on
// the phone clipped to a shelf and another on the tablet on the bench.
//
// Consequences, stated rather than hidden: it does not follow the account to
// another device, and a browser that refuses storage keeps the default. Both
// are the same properties the favourites and the recents have.

export type CookTextSize = 'normal' | 'large' | 'xlarge';

const TEXT_SIZES: readonly CookTextSize[] = ['normal', 'large', 'xlarge'];

const isTextSize = (v: unknown): v is CookTextSize =>
  typeof v === 'string' && (TEXT_SIZES as readonly string[]).includes(v);

export async function readCookTextSize(): Promise<CookTextSize> {
  const stored = await safeGet<CookTextSize>(KEY.cookTextSize);
  return isTextSize(stored) ? stored : 'normal';
}

/**
 * Writes the choice and returns what is now stored — which is the DEFAULT
 * when the write failed, so a settings screen can say "this device is not
 * keeping it" instead of showing a choice that will be gone on reload.
 */
export async function writeCookTextSize(size: CookTextSize): Promise<CookTextSize> {
  const ok = await safeSet(KEY.cookTextSize, size);
  return ok ? size : await readCookTextSize();
}

export async function clearMirror(): Promise<void> {
  try {
    await clear();
    return;
  } catch {
    /* fall through to the per-key path below */
  }
  const index = await readRecipeIndex();
  await Promise.all([
    safeDel(KEY.prefs),
    safeDel(KEY.calibrations),
    safeDel(KEY.recipeIndex),
    safeDel(KEY.lastOpened),
    safeDel(KEY.recents),
    safeDel(KEY.favorites),
    ...index.flatMap((r) => [safeDel(KEY.recipe(r.id)), safeDel(KEY.cookProgress(r.id))]),
  ]);
}

/** Exposed for tests and for a future "clear local data" control in settings. */
export const MIRROR_KEYS = KEY;
