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
    /*
      WHAT IS REMEMBERED IS THE LAST OFFSET THE PERSON SCROLLED TO — not what
      the element reports on the way out.

      QA 22.09.2026, §7, measured: the notebook's 300px came back as 0 and
      the recipe's 900px came back as 0. The cleanup runs AFTER React has
      committed the next screen, and by then the element is either showing a
      shorter page (a scroll offset a short page cannot hold is clamped to
      0) or, when the whole shell unmounted for the order sheet, detached
      from the document (a detached element reports 0). So the offset is
      tracked as it happens, from the scroll event, and that is what the
      cleanup records.

      `applied`: until the remembered offset has been put back, the element
      sits wherever the previous screen left it, and recording that would
      overwrite the memory. Development StrictMode runs effect → cleanup →
      effect on mount, with the cleanup landing before the animation frame.
    */
    let last = top;
    let applied = top === 0;
    const onScroll = () => {
      last = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    if (top > 0) {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (ref.current) ref.current.scrollTop = top;
          applied = true;
        });
      });
    } else {
      /* A screen arrived at fresh starts at the top, which is also what a
         person expects when they open something new. */
      el.scrollTop = 0;
      last = 0;
    }

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      if (applied) remember(at, last);
    };
  }, [at, ref]);
}
