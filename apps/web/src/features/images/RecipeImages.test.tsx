// §5 — the photographs on a recipe.
//
// The bucket is private, so nothing here can be tested by "is there an <img>".
// A photo has to be LISTED and then SIGNED, and either half can legitimately
// fail: a listed photo whose signing returns null is a photo this account may
// not see. The tests that matter are the ones about those states.

import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeImages } from './RecipeImages.js';
import { useRecipeImages } from './useRecipeImages.js';
import type { RecipeImage } from '../../data/repository.js';

const image = (over: Partial<RecipeImage> = {}): RecipeImage => ({
  id: 'i1',
  recipeId: 'r1',
  storagePath: 'r1/i1.webp',
  ord: 0,
  width: 1600,
  height: 1200,
  bytes: 120000,
  caption: '',
  focalX: 50,
  focalY: 50,
  createdAt: '2026-09-17T10:00:00Z',
  ...over,
});

function show(
  opts: {
    images?: RecipeImage[];
    canEdit?: boolean;
    canWrite?: boolean;
    listRejects?: boolean;
    signReturnsNull?: boolean;
  focusFails?: boolean;
    addRejects?: string;
    removeRejects?: string;
    onAdd?(file: File | Blob): void;
    onRemove?(image: RecipeImage): void;
    /** hand a replace api to the hook, so "החלפת התמונה" is offered */
    withReplace?: boolean;
  } = {},
) {
  const list = vi.fn(async () => {
    if (opts.listRejects) throw new Error('nope');
    return opts.images ?? [];
  });
  const add = vi.fn(async (_id: string, file: File | Blob) => {
    if (opts.addRejects) throw new Error(opts.addRejects);
    opts.onAdd?.(file);
    return image({ id: 'new', storagePath: 'r1/new.webp' });
  });
  const remove = vi.fn(async (img: RecipeImage) => {
    if (opts.removeRejects) throw new Error(opts.removeRejects);
    opts.onRemove?.(img);
  });
  const sign = vi.fn(async (path: string) =>
    opts.signReturnsNull ? null : `blob:signed/${path}`,
  );
  /* The focal point writer. Stores, so a test can assert the value that came
     BACK rather than the one that went in — the clamp lives in the store. */
  const focus = vi.fn(async (img: RecipeImage, at: { x: number; y: number }) => {
    if (opts.focusFails) throw new Error('שמירת מיקום התמונה נכשלה');
    const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
    return { ...img, focalX: clamp(at.x), focalY: clamp(at.y) };
  });
  /*
    The fetching lives in `useRecipeImages` now — the recipe page needs the
    same list twice, once for the hero and once for this gallery — so the
    tests drive the pair together, which is exactly how the screen uses them.
  */
  const replace = vi.fn(async (img: RecipeImage, file: File | Blob) => {
    opts.onAdd?.(file);
    return image({ id: 'swapped', storagePath: 'r1/swapped.webp', ord: img.ord });
  });
  function Harness() {
    const state = useRecipeImages({
      recipeId: 'r1',
      list,
      add,
      remove,
      sign,
      focus,
      ...(opts.withReplace ? { replace } : {}),
    });
    return (
      <RecipeImages
        state={state}
        canEdit={opts.canEdit ?? true}
        canWrite={opts.canWrite ?? true}
      />
    );
  }
  render(<Harness />);
  return { list, add, remove, sign, replace };
}

const pick = () => new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });

describe('the three states before a photo can be shown', () => {
  it('says it is loading rather than showing an empty gallery', () => {
    show({ images: [image()] });
    expect(screen.getByRole('status')).toHaveTextContent('טוען תמונות…');
  });

  it('shows the photo once it is listed AND signed', async () => {
    show({ images: [image()] });
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'blob:signed/r1/i1.webp');
  });

  it('says a listed photo is missing from the server when signing refuses', async () => {
    // The row is there and the object is not — a delete that failed halfway,
    // or a file removed elsewhere. QA 22.09.2026 (acceptance, finding 2): the
    // sentence used to blame the account ("מהחשבון הזה"), which is wrong for
    // the owner looking at their own recipe. It now says what is true and
    // what to do about it.
    show({ images: [image()], signReturnsNull: true });
    expect(
      await screen.findByText('התמונה לא נמצאה בשרת. אפשר להסיר אותה או להעלות תמונה אחרת.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the rest of the recipe usable when the list itself fails', async () => {
    show({ listRejects: true });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/לא הצלחנו לטעון את התמונות/);
    expect(alert).toHaveTextContent(/שאר המתכון תקין/);
  });
});

describe('the empty state', () => {
  /*
    THE DESIGN PASS CHANGED WHAT "EMPTY" LOOKS LIKE.

    It used to be a sentence above the ingredients saying the recipe has no
    photograph, on every such recipe, every time. It is the frame itself now —
    the invitation is where the picture would be — so what is pinned is that
    the invitation is there and the sentence is not.
  */
  it('invites a photo when the recipe is the account’s own', async () => {
    show({ images: [] });
    expect(await screen.findByText('הוספת תמונה')).toBeInTheDocument();
    expect(screen.queryByText(/אין עוד תמונות/)).not.toBeInTheDocument();
  });

  it('just states the fact on a recipe the account cannot edit', async () => {
    show({ images: [], canEdit: false });
    expect(await screen.findByText('אין תמונות למתכון הזה.')).toBeInTheDocument();
    expect(screen.queryByText('הוספת תמונה')).not.toBeInTheDocument();
  });
});

describe('adding', () => {
  it('uploads the file and shows the new photo', async () => {
    const user = userEvent.setup();
    const seen: (File | Blob)[] = [];
    const { add } = show({ images: [], onAdd: (f) => seen.push(f) });
    await screen.findByText('הוספת תמונה');

    await user.upload(screen.getByLabelText<HTMLInputElement>(/הוספת תמונה/), pick());
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(seen).toHaveLength(1);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:signed/r1/new.webp');
  });

  it('shows the repository’s own message when the file cannot be used', async () => {
    const user = userEvent.setup();
    // The repository turns a conversion failure into a sentence a baker can
    // act on; the gallery must show THAT, not a generic line.
    show({ images: [], addRejects: 'גם אחרי דחיסה התמונה נשארה גדולה מהמותר.' });
    await screen.findByText('הוספת תמונה');

    await user.upload(screen.getByLabelText<HTMLInputElement>(/הוספת תמונה/), pick());
    expect(await screen.findByRole('alert')).toHaveTextContent(/גם אחרי דחיסה/);
  });

  it('lets the SAME file be retried after a failure', async () => {
    const user = userEvent.setup();
    // The input's value is cleared after each pick, so choosing the same photo
    // again still fires a change event. Without that, a failed upload can only
    // be retried with a different file.
    const { add } = show({ images: [], addRejects: 'נכשל' });
    await screen.findByText('הוספת תמונה');
    const input = screen.getByLabelText<HTMLInputElement>(/הוספת תמונה/);

    await user.upload(input, pick());
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await user.upload(input, pick());
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  });

  it('says why it cannot upload with no server, instead of a dead button', async () => {
    show({ images: [], canWrite: false });
    await screen.findByText(/אין תמונות למתכון הזה/);
    expect(screen.queryByText('הוספת תמונה')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/אין חיבור לשרת/);
  });
});

describe('removing', () => {
  it('asks before deleting', async () => {
    const user = userEvent.setup();
    const { remove } = show({ images: [image()] });
    await screen.findByRole('img');

    await user.click(screen.getByRole('button', { name: 'מחיקת התמונה' }));
    expect(screen.getByRole('group', { name: 'אישור מחיקה' })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes it once confirmed', async () => {
    const user = userEvent.setup();
    const { remove } = show({ images: [image()] });
    await screen.findByRole('img');

    await user.click(screen.getByRole('button', { name: 'מחיקת התמונה' }));
    await user.click(screen.getByRole('button', { name: 'למחוק' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
  });

  it('can be cancelled', async () => {
    const user = userEvent.setup();
    const { remove } = show({ images: [image()] });
    await screen.findByRole('img');

    await user.click(screen.getByRole('button', { name: 'מחיקת התמונה' }));
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('keeps the photo on screen when the delete fails', async () => {
    const user = userEvent.setup();
    show({ images: [image()], removeRejects: 'מחיקת התמונה נכשלה' });
    await screen.findByRole('img');

    await user.click(screen.getByRole('button', { name: 'מחיקת התמונה' }));
    await user.click(screen.getByRole('button', { name: 'למחוק' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/מחיקת התמונה נכשלה/);
    // Still there: the file was not removed, so pretending otherwise would
    // make the gallery disagree with the bucket.
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('offers no delete on a recipe the account cannot edit', async () => {
    show({ images: [image()], canEdit: false });
    await screen.findByRole('img');
    expect(screen.queryByRole('button', { name: 'מחיקת התמונה' })).not.toBeInTheDocument();
  });
});

describe('what the screen tells the user about the upload', () => {
  it('says the location data is stripped, because that is the surprising part', async () => {
    show({ images: [] });
    await screen.findByText('הוספת תמונה');
    expect(screen.getByText(/המקום שבו צולמה — נמחקים/)).toBeInTheDocument();
  });

  it('says where the photo is stored and who can see it', async () => {
    show({ images: [] });
    await screen.findByText('הוספת תמונה');
    expect(screen.getByText(/אחסון פרטי/)).toBeInTheDocument();
  });

  it('reserves the box from the stored dimensions, so the page does not reflow', async () => {
    show({ images: [image({ width: 1600, height: 1200 })] });
    const img = await screen.findByRole('img');
    const frame = img.parentElement!;
    // 1600/1200 — set before the URL resolves.
    expect(frame.style.aspectRatio).toBe(String(1600 / 1200));
  });

  it('describes a photo with no caption as a photo, not as an empty string', async () => {
    show({ images: [image({ caption: '' })] });
    expect(await screen.findByAltText('תמונה של המתכון')).toBeInTheDocument();
  });

  it('uses the caption as the description when there is one', async () => {
    show({ images: [image({ caption: 'הפרוסה אחרי 24 שעות' })] });
    expect(await screen.findByAltText('הפרוסה אחרי 24 שעות')).toBeInTheDocument();
  });
});

describe('an expired signed URL', () => {
  it('re-signs once when the browser reports a broken image', async () => {
    // A signed URL lasts ten minutes; a recipe page stays open longer than
    // that while someone bakes. A torn-image icon forever is not acceptable.
    const { sign } = show({ images: [image()] });
    const img = await screen.findByRole('img');
    await waitFor(() => expect(sign).toHaveBeenCalledTimes(1));

    img.dispatchEvent(new Event('error'));
    await waitFor(() => expect(sign).toHaveBeenCalledTimes(2));
  });
});

/*
  ── QA 22.09.2026: the save chain must not lose what the person gave it ────

  Ahmed's list for the photograph: a clear sentence when it lands, the input
  kept on screen when it fails, a "נסה שוב" that does not send anyone back to
  the file chooser, no second upload from a double tap, and no upload at all
  to a recipe that has no id yet.
*/
describe('the outcome of an upload is said, and a failure can be retried', () => {
  it('says the photo was saved once it lands', async () => {
    const user = userEvent.setup();
    show({ images: [] });
    await screen.findByText('הוספת תמונה');
    await user.upload(screen.getByLabelText<HTMLInputElement>(/הוספת תמונה/), pick());
    expect(await screen.findByRole('status')).toHaveTextContent('התמונה נשמרה למתכון.');
  });

  it('offers "נסה שוב" after a failure and retries with the SAME file', async () => {
    const user = userEvent.setup();
    const seen: (File | Blob)[] = [];
    const { add } = show({ images: [], onAdd: (f) => seen.push(f) });
    add.mockRejectedValueOnce(new Error('אין חיבור לשרת.'));
    await screen.findByText('הוספת תמונה');

    const file = pick();
    await user.upload(screen.getByLabelText<HTMLInputElement>(/הוספת תמונה/), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(/אין חיבור לשרת/);

    await user.click(screen.getByRole('button', { name: 'נסה שוב' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    // The second call carries the file that was picked the first time.
    expect(add.mock.calls[1]?.[1]).toBe(file);
    expect(await screen.findByRole('status')).toHaveTextContent('התמונה נשמרה למתכון.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts ONE upload for two taps that land before the first returns', async () => {
    let release: (() => void) | null = null;
    const add = vi.fn(
      (_id: string, _file: File | Blob) =>
        new Promise<RecipeImage>((resolve) => {
          release = () => resolve(image({ id: 'new' }));
        }),
    );
    const api = {
      recipeId: 'r1',
      list: async () => [],
      add,
      remove: async () => {},
      sign: async (p: string) => `blob:signed/${p}`,
      focus: async (i: RecipeImage) => i,
    };
    const { result } = renderHook(() => useRecipeImages(api));
    await waitFor(() => expect(result.current.load).toBe('ready'));
    act(() => {
      result.current.pick(pick());
      result.current.pick(pick());
    });
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.images).toHaveLength(1));
  });

  it('refuses to upload to a recipe that has no id yet, and says so', async () => {
    const add = vi.fn(async () => image());
    const api = {
      recipeId: 'new-copy-abc',
      list: async () => [],
      add,
      remove: async () => {},
      sign: async (p: string) => `blob:signed/${p}`,
      focus: async (i: RecipeImage) => i,
    };
    const { result } = renderHook(() => useRecipeImages(api));
    await waitFor(() => expect(result.current.load).toBe('ready'));
    act(() => result.current.pick(pick()));
    expect(add).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/המתכון עדיין לא נשמר/);
  });

  it('retries a failed focal-point save with the same point', async () => {
    const focus = vi
      .fn(async (img: RecipeImage, at: { x: number; y: number }) => ({ ...img, focalX: at.x, focalY: at.y }))
      .mockRejectedValueOnce(new Error('שמירת מיקום התמונה נכשלה'));
    const api = {
      recipeId: 'r1',
      list: async () => [image()],
      add: async () => image(),
      remove: async () => {},
      sign: async (p: string) => `blob:signed/${p}`,
      focus,
    };
    const { result } = renderHook(() => useRecipeImages(api));
    await waitFor(() => expect(result.current.load).toBe('ready'));
    let ok = true;
    await act(async () => {
      ok = await result.current.refocus(image(), { x: 20, y: 80 });
    });
    expect(ok).toBe(false);
    expect(result.current.canRetry).toBe(true);
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.images[0]?.focalX).toBe(20));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(result.current.notice).toBe('מיקום התמונה נשמר.');
  });
});

describe('replacing a photo', () => {
  it('swaps the file behind the photo and keeps its place', async () => {
    const user = userEvent.setup();
    const { replace } = show({ images: [image()], withReplace: true });
    await screen.findByRole('img');
    await user.upload(screen.getByLabelText<HTMLInputElement>('החלפת התמונה בקובץ אחר'), pick());
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:signed/r1/swapped.webp');
    expect(screen.getByRole('status')).toHaveTextContent('התמונה הוחלפה.');
  });

  it('is not offered when the repository cannot do it', async () => {
    show({ images: [image()] });
    await screen.findByRole('img');
    expect(screen.queryByLabelText('החלפת התמונה בקובץ אחר')).not.toBeInTheDocument();
  });
});
