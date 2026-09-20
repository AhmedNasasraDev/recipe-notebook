// §5 — the photographs on a recipe.
//
// WHY THIS LIVES ON THE RECIPE PAGE AND NOT IN THE EDIT FORM
//
// Everything in the edit form is a DRAFT: you change fields, you press save, and
// until you do the recipe is untouched — that is §6's rule and the whole
// reason "שינוי הכמויות כאן הוא חישוב בלבד" can be said honestly. An upload
// cannot work that way. The file goes to the server the moment it is chosen,
// because holding a 2 MB blob in a draft and uploading it on save would mean a
// save that can fail halfway through in a new way.
//
// So an upload is immediate, and putting an immediate action inside a form
// whose whole promise is "nothing happens until you save" produces the worst
// possible surprise: cancel the edit, and the photo is still there. The
// gallery therefore sits on the recipe page, where every control acts now.
//
// WHY EVERY PHOTO NEEDS A ROUND TRIP BEFORE IT CAN BE SHOWN
//
// The bucket is private (migration 0029), so there is no permanent URL. Each
// path is exchanged for a signed URL that expires, and the signing is itself
// the authorisation check. Three consequences the UI has to live with:
//
//   · a photo can be listed and still not be displayable — `signedImageUrl`
//     returning null is a real answer, not an error to swallow;
//   · the box has to be reserved from the stored width/height, or the page
//     reflows under the reader as each URL resolves;
//   · a URL that expires while the page is open leaves a broken image, so
//     `onError` re-signs once rather than showing a torn icon forever.

import { useCallback, useEffect, useState } from 'react';
import type { RecipeImage } from '../../data/repository.js';
import { MAX_EDGE } from './convert.js';
import styles from './RecipeImages.module.css';

interface Props {
  recipeId: string;
  canWrite: boolean;
  /** false on a recipe the account does not own — a group recipe, for instance */
  canEdit: boolean;
  list(recipeId: string): Promise<RecipeImage[]>;
  add(recipeId: string, file: File | Blob): Promise<RecipeImage>;
  remove(image: RecipeImage): Promise<void>;
  sign(storagePath: string): Promise<string | null>;
}

type Load = 'loading' | 'ready' | 'failed';

export function RecipeImages({
  recipeId,
  canWrite,
  canEdit,
  list,
  add,
  remove,
  sign,
}: Props) {
  const [images, setImages] = useState<readonly RecipeImage[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [urls, setUrls] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const onPick = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const added = await add(recipeId, file);
      setImages((prev) => [...prev, added]);
      await signAll([added]);
    } catch (e) {
      // The repository already turns a conversion failure into a sentence a
      // baker can act on (convertErrorText). Showing it beats a generic line.
      setError(e instanceof Error ? e.message : 'העלאת התמונה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (image: RecipeImage) => {
    setError(null);
    setBusy(true);
    try {
      await remove(image);
      setImages((prev) => prev.filter((i) => i.id !== image.id));
      setConfirmId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'מחיקת התמונה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  /** Re-sign once when a URL has expired mid-session. */
  const onBroken = (image: RecipeImage) => {
    void sign(image.storagePath).then((url) => {
      setUrls((prev) => (prev[image.id] === url ? prev : { ...prev, [image.id]: url }));
    });
  };

  if (load === 'loading') {
    return (
      <section className={styles.card} aria-label="תמונות">
        <h2 className={styles.title}>תמונות</h2>
        <p className={styles.note} role="status">
          טוען תמונות…
        </p>
      </section>
    );
  }

  if (load === 'failed') {
    return (
      <section className={styles.card} aria-label="תמונות">
        <h2 className={styles.title}>תמונות</h2>
        <p className={styles.error} role="alert">
          לא הצלחנו לטעון את התמונות. שאר המתכון תקין — אפשר לרענן ולנסות שוב.
        </p>
      </section>
    );
  }

  const showAdd = canEdit && canWrite;

  return (
    <section className={styles.card} aria-label="תמונות">
      <h2 className={styles.title}>תמונות</h2>

      {images.length === 0 ? (
        /*
          NO PHOTOGRAPH: AN EMPTY PLATE, NOT A PARAGRAPH.

          A recipe with no photograph used to explain, in two lines above the
          ingredients, that it has no photograph — on every such recipe, every
          time it was opened. The dashed frame below says the same thing in
          the place where the picture would be, and the action is inside it.
          A reader who cannot add one gets the sentence, because for them the
          frame would be a button they cannot press.
        */
        showAdd ? null : <p className={styles.note}>אין תמונות למתכון הזה.</p>
      ) : (
        <ul className={styles.grid}>
          {images.map((image) => {
            const url = urls[image.id];
            const ratio =
              image.width && image.height ? image.width / image.height : 4 / 3;
            return (
              <li key={image.id} className={styles.item}>
                <div
                  className={styles.frame}
                  /* The box is reserved from the stored dimensions so the page
                     does not reflow as each signed URL resolves. */
                  style={{ aspectRatio: String(ratio) }}
                >
                  {url === undefined ? (
                    <span className={styles.frameNote}>…</span>
                  ) : url === null ? (
                    <span className={styles.frameNote}>
                      התמונה אינה זמינה לצפייה מהחשבון הזה
                    </span>
                  ) : (
                    <img
                      className={styles.img}
                      src={url}
                      /* The caption is content, not a description of the
                         picture, so it cannot double as alt text. Without a
                         real description the honest alt is the subject. */
                      alt={image.caption || 'תמונה של המתכון'}
                      loading="lazy"
                      onError={() => onBroken(image)}
                    />
                  )}
                </div>
                {image.caption && <p className={styles.caption}>{image.caption}</p>}

                {showAdd &&
                  (confirmId === image.id ? (
                    <div className={styles.confirm} role="group" aria-label="אישור מחיקה">
                      <button
                        type="button"
                        className={styles.confirmYes}
                        onClick={() => void onRemove(image)}
                        disabled={busy}
                      >
                        {busy ? 'מוחק…' : 'למחוק'}
                      </button>
                      <button
                        type="button"
                        className={styles.confirmNo}
                        onClick={() => setConfirmId(null)}
                        disabled={busy}
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => setConfirmId(image.id)}
                      disabled={busy}
                      aria-label="מחיקת התמונה"
                    >
                      מחיקה
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {showAdd && (
        <>
          <label className={styles.addBtn}>
            {busy ? 'מעלה…' : 'הוספת תמונה'}
            <input
              className="visuallyHidden"
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // The value is cleared so choosing the SAME file again still
                // fires a change event — otherwise a failed upload cannot be
                // retried without picking a different photo.
                e.target.value = '';
                if (file) void onPick(file);
              }}
            />
          </label>
          {/*
            UX PASS: the same words, one tap in.

            This is real information — what happens to the file, and what
            happens to the location stored inside it — so it is not shortened
            and not removed. But it was four lines of small print sitting at
            the top of every recipe page, on the screen a cook opens to read
            quantities, and the summary below says plainly what it answers.
          */}
          <details className={styles.hintBox}>
            <summary className={styles.hintSummary}>מה קורה לתמונה שמעלים?</summary>
            <p className={styles.hint}>
              התמונה מומרת ל־WebP ומוקטנת ל־{MAX_EDGE} פיקסלים בצד הארוך לפני
              ההעלאה, ונתוני הצילום — כולל המקום שבו צולמה — נמחקים בתהליך. היא
              נשמרת באחסון פרטי ונגישה רק לחשבון שלכם, ולחברי קבוצה רק אם המתכון
              הזה שייך לקבוצה.
            </p>
          </details>
        </>
      )}

      {canEdit && !canWrite && (
        <p className={styles.note} role="status">
          בהתקנה הזאת אין חיבור לשרת, ולכן אפשר לראות תמונות אבל לא להוסיף.
        </p>
      )}
    </section>
  );
}
