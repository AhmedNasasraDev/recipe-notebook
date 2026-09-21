import { useEffect, useState } from 'react';

/*
  IS THE SOFTWARE KEYBOARD OPEN?

  ─────────────────────────────────────────────────────────────────────────────
  THE BUG THIS EXISTS FOR

  Ahmed: "כשאני נכנס לשדה כתיבה והמקלדת נפתחת, הוא עולה למעלה" — the bottom
  navigation rides up and sits on top of the keyboard.

  The cause is in the frame, not in the bar. `AppShell.module.css` sizes the
  frame with `100dvh`, and `dvh` is the DYNAMIC viewport: on Chrome for
  Android the software keyboard shrinks it, so the frame shrinks with it and
  the bar — the last child in a column — is carried up to rest on the
  keyboard. On iOS Safari the layout viewport does not shrink; the page is
  scrolled instead, with the same result on screen.

  There is no CSS length that means "the height of the screen, ignoring the
  keyboard" on both. `svh` comes close and breaks something else: it is the
  height with the browser's UI EXPANDED, so on a scrolled page — where the UI
  has collapsed — the frame would end short of the bottom and leave exactly
  the pale strip Ahmed also asked to remove. So the frame keeps `dvh`, and
  the bar is taken out of the way while the keyboard is up, which is the
  fallback he approved in the same breath: "אם אין אפשרות לשמור אותו במקומו
  בצורה תקינה, הסתר אותו בזמן שהמקלדת פתוחה והחזר אותו למקומו לאחר סגירתה."

  ─────────────────────────────────────────────────────────────────────────────
  HOW IT IS DETECTED, AND WHY NOT "AN INPUT HAS FOCUS"

  `window.visualViewport.height` is the part of the page the person can
  actually see. A software keyboard is the one thing that takes a large bite
  out of it without changing `window.innerHeight`, so the signal is the
  DIFFERENCE between the two — not focus, which would also fire for a desktop
  user typing with a hardware keyboard and no keyboard on screen at all.

  Two guards keep it honest:

    · THRESHOLD, not "any difference". A collapsing browser toolbar moves the
      visual viewport too, by a few dozen pixels. 140px is comfortably more
      than any toolbar and comfortably less than any phone keyboard (~260px
      and up on the smallest phones in portrait).

    · A TEXT ENTRY MUST HAVE FOCUS. On its own the threshold can be tripped by
      a pinch-zoom, which also shrinks the visual viewport. Requiring both
      means the two false positives cancel: a zoom with nothing focused is not
      a keyboard, and a focused field with a full-height viewport is a desktop.

  The API is not everywhere (jsdom has none, and neither did Safari before
  13). Absent, this returns false forever, which is the state that renders the
  bar — the behaviour the application had before this file existed.
*/

/** Anything a software keyboard would open for. */
function isTextEntry(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  /* A checkbox, a radio or a range opens no keyboard. */
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(
    type,
  );
}

/** More than a collapsing toolbar, less than the smallest phone keyboard. */
const MIN_KEYBOARD = 140;

export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const hidden = window.innerHeight - vv.height;
      setOpen(hidden >= MIN_KEYBOARD && isTextEntry(document.activeElement));
    };
    /*
      The resize fires many times as the keyboard animates in. One read per
      frame is enough, and it keeps React out of a layout loop.
    */
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read);
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    /*
      Focus and blur matter on their own: moving from a text field to a button
      inside a form can close the keyboard without resizing anything, and
      tapping from one field to another can open it without a resize either.
      `true` because neither event bubbles.
    */
    window.addEventListener('focusin', schedule, true);
    window.addEventListener('focusout', schedule, true);
    schedule();

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('focusin', schedule, true);
      window.removeEventListener('focusout', schedule, true);
    };
  }, []);

  return open;
}
