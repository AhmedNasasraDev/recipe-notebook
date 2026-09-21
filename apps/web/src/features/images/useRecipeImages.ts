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

import { useCallback, useEffect, useState } from 'react';
import type { RecipeImage } from '../../data/repository.js';

export type ImagesLoad = 'loading' | 'ready' | 'failed';

export interface RecipeImagesApi {
  recipeId: string;
  list(recipeId: string): Promise<RecipeImage[]>;
  add(recipeId: string, file: File | Blob): Promise<RecipeImage>;
  remove(image: RecipeImage): Promise<void>;
  sign(storagePath: string): Promise<string | null>;
  focus(image: RecipeImage, focal: { x: number; y: number }): Promise<RecipeImage>;
}

export interface RecipeImagesState {
  images: readonly RecipeImage[];
  load: ImagesLoad;
  /** `undefined` = not signed yet, `null` = this account may not see it. */
  urls: Readonly<Record<string, string | null>>;
  busy: boolean;
  error: string | null;
  pick(file: File): void;
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
}

export function useRecipeImages({
  recipeId,
  list,
  add,
  remove,
  sign,
  focus,
}: RecipeImagesApi): RecipeImagesState {
  const [images, setImages] = useState<readonly RecipeImage[]>([]);
  const [load, setLoad] = useState<ImagesLoad>('loading');
  const [urls, setUrls] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const pick = useCallback(
    (file: File) => {
      setError(null);
      setBusy(true);
      void add(recipeId, file)
        .then(async (added) => {
          setImages((prev) => [...prev, added]);
          await signAll([added]);
        })
        // The repository already turns a conversion failure into a sentence a
        // baker can act on (convertErrorText). Showing it beats a generic line.
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'העלאת התמונה נכשלה.');
        })
        .finally(() => setBusy(false));
    },
    [add, recipeId, signAll],
  );

  const drop = useCallback(
    (image: RecipeImage) => {
      setError(null);
      setBusy(true);
      void remove(image)
        .then(() => {
          setImages((prev) => prev.filter((i) => i.id !== image.id));
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'מחיקת התמונה נכשלה.');
        })
        .finally(() => setBusy(false));
    },
    [remove],
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
      setError(null);
      setBusy(true);
      try {
        const stored = await focus(image, focal);
        setImages((prev) => prev.map((i) => (i.id === stored.id ? stored : i)));
        return true;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'שמירת מיקום התמונה נכשלה.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [focus],
  );

  return { images, load, urls, busy, error, pick, drop, broken, refocus };
}
