// §5 — the photographs on a recipe.
//
// The bucket is private, so nothing here can be tested by "is there an <img>".
// A photo has to be LISTED and then SIGNED, and either half can legitimately
// fail: a listed photo whose signing returns null is a photo this account may
// not see. The tests that matter are the ones about those states.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    addRejects?: string;
    removeRejects?: string;
    onAdd?(file: File | Blob): void;
    onRemove?(image: RecipeImage): void;
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
  /*
    The fetching lives in `useRecipeImages` now — the recipe page needs the
    same list twice, once for the hero and once for this gallery — so the
    tests drive the pair together, which is exactly how the screen uses them.
  */
  function Harness() {
    const state = useRecipeImages({ recipeId: 'r1', list, add, remove, sign });
    return (
      <RecipeImages
        state={state}
        canEdit={opts.canEdit ?? true}
        canWrite={opts.canWrite ?? true}
      />
    );
  }
  render(<Harness />);
  return { list, add, remove, sign };
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

  it('says a listed photo cannot be shown when signing refuses', async () => {
    // A private object this account may not read: the row is visible through
    // the recipe, the object is not. That is a real state, not an error.
    show({ images: [image()], signReturnsNull: true });
    expect(
      await screen.findByText('התמונה אינה זמינה לצפייה מהחשבון הזה'),
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
