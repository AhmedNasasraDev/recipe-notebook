// §5 — the photographs on a recipe: the part that TALKS TO THE SERVER.
//
// WHY THIS IS A HOOK AND NOT STATE INSIDE `RecipeImages`
//
// The design pass gave the recipe page a hero photograph at the very top —
// the first picture, wide, with the back and menu buttons on it — while the
// gallery that MANAGES the photographs (add, delete, captions, the small print
// about what an upload does) stays where it belongs, below the steps. That is
// two places on one page showing one list.
//
// Listing is a round trip and signing is another, so the list is fetched ONCE,
// here, by the screen that owns the page, and both places read the same state.
// Rendering it twice from two components would mean two `list()` calls and two
// sets of signed URLs for the same photographs — a real extra request on a
// phone in a kitchen, to show the same picture twice.
//
// Nothing about the behaviour moved: the effect, the error handling, the
// re-signing of an expired URL and the immediate upload are the code that was
// in `RecipeImages`, unchanged.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecipeImage } from '../../data/repository.js';

export type ImagesLoad = 'loading' | 'ready' | 'failed';

export interface RecipeImagesApi {
  recipeId: string;
  list(recipeId: string): Promise<RecipeImage[]>;
  add(recipeId: string, file: File | Blob): Promise<RecipeImage>;
  remove(image: RecipeImage): Promise<void>;
  sign(storagePath: string): Promise<string | null>;
  focus(image: RecipeImage, focal: { x: number; y: number }): Promise<RecipeImage>;
  /** Optional: a repository that cannot swap pictures simply offers no "החלפה". */
  replace?(image: RecipeImage, file: File | Blob): Promise<RecipeImage>;
}

/**
 * The last thing that failed, kept so "נסה שוב" can do it again with the
 * SAME input — the file that was picked, the picture that was to go — rather
 * than sending the person back to the file chooser.
 */
export type FailedAction =
  | { kind: 'add'; file: File }
  | { kind: 'replace'; image: RecipeImage; file: File }
  | { kind: 'remove'; image: RecipeImage }
  | { kind: 'focus'; image: RecipeImage; focal: { x: number; y: number } };

export interface RecipeImagesState {
  images: readonly RecipeImage[];
  load: ImagesLoad;
  /** `undefined` = not signed yet, `null` = this account may not see it. */
  urls: Readonly<Record<string, string | null>>;
  busy: boolean;
  error: string | null;
  /** A sentence about the last thing that landed ("התמונה נשמרה"), or null. */
  notice: string | null;
  /** Whether "נסה שוב" has something to retry. */
  canRetry: boolean;
  /** Whether this repository can swap the picture behind a photo. */
  canReplace: boolean;
  pick(file: File): void;
  /** Swap the picture behind an existing photo. Absent when the api cannot. */
  replace(image: RecipeImage, file: File): void;
  drop(image: RecipeImage): void;
  /** Re-sign once when a URL has expired mid-session. */
  broken(image: RecipeImage): void;
  /**
   * Stores a new focal point and returns whether it landed.
   *
   * The caller gets the boolean because the UI has a confirmation to show and
   * a panel to close, and neither should happen on a failed write — which is
   * the whole of the "נשמר" lesson from the personal note.
   */
  refocus(image: RecipeImage, focal: { x: number; y: number }): Promise<boolean>;
  /** Runs the last failed action again with the same input. */
  retry(): void;
}

/** A recipe that has not been saved yet: no row, no path, nothing to hang a file on. */
export function isUnsavedRecipeId(recipeId: string): boolean {
  return !recipeId || recipeId.startsWith('new-');
}

export function useRecipeImages({
  recipeId,
  list,
  add,
  remove,
  sign,
  focus,
  replace: replaceApi,
}: RecipeImagesApi): RecipeImagesState {
  const [images, setImages] = useState<readonly RecipeImage[]>([]);
  const [load, setLoad] = useState<ImagesLoad>('loading');
  const [urls, setUrls] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedAction | null>(null);
  /*
    `busy` in a ref as well as in state: a second tap that lands before React
    has re-rendered with `busy = true` would otherwise start a second upload
    of the same file — two objects in the bucket, two rows, one photo (QA
    22.09.2026, "לחיצה כפולה"). The ref is read synchronously.
  */
  const inFlight = useRef(false);

  const signAll = useCallback(
    async (list_: readonly RecipeImage[]) => {
      const pairs = await Promise.all(
        list_.map(async (i) => [i.id, await sign(i.storagePath)] as const),
      );
      setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    },
    [sign],
  );

  useEffect(() => {
    let cancelled = false;
    // A recipe that has not been saved yet has no id and no pictures to list;
    // asking the server with an empty id was a 400 in the console on every
    // visit to /recipe/new (QA 22.09.2026, finding 15).
    if (isUnsavedRecipeId(recipeId)) {
      setImages([]);
      setLoad('ready');
      return;
    }
    setLoad('loading');
    void list(recipeId)
      .then(async (found) => {
        if (cancelled) return;
        setImages(found);
        setLoad('ready');
        await signAll(found);
      })
      .catch(() => {
        if (!cancelled) setLoad('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, list, signAll]);

  /** One gate for every write: refuses a second action while one is running. */
  const begin = useCallback((): boolean => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    return true;
  }, []);
  const end = useCallback(() => {
    inFlight.current = false;
    setBusy(false);
  }, []);

  const runAdd = useCallback(
    (file: File) => {
      if (isUnsavedRecipeId(recipeId)) {
        // Said rather than attempted: an upload to a recipe that does not
        // exist would fail on the server with a message about a path.
        setError('המתכון עדיין לא נשמר, ולכן אי אפשר לשמור עליו תמונה. שמרו את המתכון קודם.');
        return;
      }
      if (!begin()) return;
      void add(recipeId, file)
        .then(async (added) => {
          setImages((prev) => [...prev, added]);
          setFailed(null);
          setNotice('התמונה נשמרה למתכון.');
          await signAll([added]);
        })
        // The repository already turns a conversion failure into a sentence a
        // baker can act on (convertErrorText). Showing it beats a generic line.
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'העלאת התמונה נכשלה.');
          setFailed({ kind: 'add', file });
        })
        .finally(end);
    },
    [add, recipeId, signAll, begin, end],
  );

  const runReplace = useCallback(
    (image: RecipeImage, file: File) => {
      if (!replaceApi) return;
      if (!begin()) return;
      void replaceApi(image, file)
        .then(async (next) => {
          setImages((prev) => prev.map((i) => (i.id === image.id ? next : i)));
          setFailed(null);
          setNotice('התמונה הוחלפה.');
          await signAll([next]);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'החלפת התמונה נכשלה.');
          setFailed({ kind: 'replace', image, file });
        })
        .finally(end);
    },
    [replaceApi, signAll, begin, end],
  );

  const runRemove = useCallback(
    (image: RecipeImage) => {
      if (!begin()) return;
      void remove(image)
        .then(() => {
          setImages((prev) => prev.filter((i) => i.id !== image.id));
          setFailed(null);
          setNotice('התמונה נמחקה.');
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'מחיקת התמונה נכשלה.');
          setFailed({ kind: 'remove', image });
        })
        .finally(end);
    },
    [remove, begin, end],
  );

  const broken = useCallback(
    (image: RecipeImage) => {
      void sign(image.storagePath).then((url) => {
        setUrls((prev) => (prev[image.id] === url ? prev : { ...prev, [image.id]: url }));
      });
    },
    [sign],
  );

  /*
    THE FOCAL POINT, AND WHY IT REPLACES THE ROW RATHER THAN PATCHING IT.

    `focus` returns the row as the store now holds it, and that row is what
    goes into state — not the numbers this function was handed. If the
    database clamped 101 to 100, or rounded, the screen shows what was
    actually stored. The alternative is a position that reads back differently
    after a reload, which is the same class of defect as saying "נשמר" before
    a save confirmed.
  */
  const refocus = useCallback(
    async (image: RecipeImage, focal: { x: number; y: number }): Promise<boolean> => {
      if (!begin()) return false;
      try {
        const stored = await focus(image, focal);
        setImages((prev) => prev.map((i) => (i.id === stored.id ? stored : i)));
        setFailed(null);
        setNotice('מיקום התמונה נשמר.');
        return true;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'שמירת מיקום התמונה נכשלה.');
        setFailed({ kind: 'focus', image, focal });
        return false;
      } finally {
        end();
      }
    },
    [focus, begin, end],
  );

  const retry = useCallback(() => {
    const f = failed;
    if (!f) return;
    if (f.kind === 'add') runAdd(f.file);
    else if (f.kind === 'replace') runReplace(f.image, f.file);
    else if (f.kind === 'remove') runRemove(f.image);
    else void refocus(f.image, f.focal);
  }, [failed, runAdd, runReplace, runRemove, refocus]);

  return {
    images,
    load,
    urls,
    busy,
    error,
    notice,
    canRetry: failed !== null,
    canReplace: replaceApi !== undefined,
    pick: runAdd,
    replace: runReplace,
    drop: runRemove,
    broken,
    refocus,
    retry,
  };
}
