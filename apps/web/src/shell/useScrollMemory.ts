import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/*
  ── COMING BACK TO A LIST LANDS WHERE YOU LEFT IT ───────────────────────────

  Ahmed: "בחזרה לרשימה שמור ככל האפשר את החיפוש, הסינון ומיקום הגלילה."

  Two of the three were already true and for a good reason: the notebook keeps
  its search in `?q=` and its filter in `?category=`, so those ride in the
  ADDRESS and the browser restores them on a back step with no code at all.
  That is worth saying out loud, because the temptation is to add a store for
  state that is already in the right place.

  The third is not free. The application scrolls inside `main.content`, not on
  the document, and a browser only restores the document's own scroll. So the
  scroller's offset is remembered here, keyed by the address it belonged to.

  WHY KEYED BY ADDRESS AND NOT BY HISTORY ENTRY

  `location.key` is unique per entry, which sounds more correct and is worse:
  going Home → notebook → recipe → back gives the notebook a NEW key on the
  way back, so its remembered offset would never be found. Keying on
  pathname + search means "the notebook, filtered to doughs, searched for
  brioche" is one place and comes back the way it was left, however you got
  there.

  A module-level Map, not storage: scroll position is worth remembering for
  the length of a session and is noise the next morning. Twenty entries is
  more screens than anybody visits before the oldest stops mattering.
*/

const remembered = new Map<string, number>();
const LIMIT = 20;

function remember(at: string, top: number): void {
  remembered.delete(at);
  remembered.set(at, top);
  /* Oldest first in a Map's iteration order, so this drops the stalest. */
  while (remembered.size > LIMIT) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** Only for tests, which must not inherit another case's scroll positions. */
export function clearScrollMemory(): void {
  remembered.clear();
}

export function useScrollMemory(ref: RefObject<HTMLElement | null>): void {
  const { pathname, search } = useLocation();
  const at = `${pathname}${search}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /*
      Restore on the frame after the screen has rendered, because a screen
      that is still fetching has no height yet and scrolling a 0px box does
      nothing. Two frames: one for React to commit, one for layout.
    */
    const top = remembered.get(at) ?? 0;
    let frame = 0;
    if (top > 0) {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (ref.current) ref.current.scrollTop = top;
        });
      });
    } else {
      /* A screen arrived at fresh starts at the top, which is also what a
         person expects when they open something new. */
      el.scrollTop = 0;
    }

    /*
      Record on the way out rather than on every scroll event: one write per
      navigation instead of one per frame of a flick, and the value that
      matters is the last one anyway.
    */
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      remember(at, el.scrollTop);
    };
  }, [at, ref]);
}
