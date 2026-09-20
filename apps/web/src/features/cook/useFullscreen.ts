// "מסך מלא" for the kitchen screen.
//
// WHAT IT PROMISES, AND WHAT IT CANNOT
//
// Ahmed asked for a real fullscreen when the environment allows one, a focused
// mode that fills whatever space there is when it does not, and no claim that
// the phone's own bars or the surrounding page chrome were hidden when they
// were not. So this hook reports THREE things and the screen shows exactly
// what is true:
//
//   · `supported`  — the Fullscreen API exists and the document allows it.
//                    Inside an iframe that is only true when the embedding page
//                    grants `allow="fullscreen"`, which an artifact page does
//                    not, so this is `false` there and nothing pretends
//                    otherwise.
//   · `real`       — the browser is actually in fullscreen right now.
//   · `focus`      — the app's own focused mode: the navigation and everything
//                    that is not the preparation step out of the way, and the
//                    screen takes all the room it has. This is what is left
//                    when a real fullscreen is refused, and it is honest about
//                    being that.
//
// One more rule, from the brief: leaving fullscreen is NOT leaving Cook Mode.
// This hook never navigates; it only turns a mode on and off. The way out of
// the preparation is the same "יציאה" link it always was.
//
// The browser can leave fullscreen without asking us (Escape, a system
// gesture, switching apps), so `real` is driven by the `fullscreenchange`
// event rather than by what we last requested — the button can never end up
// saying the opposite of the truth.

import { useCallback, useEffect, useState } from 'react';

interface Doc extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface El extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const doc = (): Doc | null => (typeof document === 'undefined' ? null : (document as Doc));

const currentElement = (): Element | null => {
  const d = doc();
  if (!d) return null;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
};

/** Is a real fullscreen available AND permitted here? */
function detectSupport(): boolean {
  const d = doc();
  if (!d) return false;
  const body = d.documentElement as El;
  const hasApi =
    typeof body.requestFullscreen === 'function' ||
    typeof body.webkitRequestFullscreen === 'function';
  if (!hasApi) return false;
  // `fullscreenEnabled` is false inside an iframe without the permission, which
  // is exactly the case that must not be offered as if it worked.
  return d.fullscreenEnabled !== false;
}

export interface Fullscreen {
  /** a real fullscreen is available here */
  supported: boolean;
  /** the browser is in fullscreen now */
  real: boolean;
  /** the app's own focused mode is on (true whenever `real` is) */
  focus: boolean;
  /** true when focus mode is on WITHOUT a real fullscreen behind it */
  fallback: boolean;
  enter: (el: HTMLElement | null) => void;
  exit: () => void;
  toggle: (el: HTMLElement | null) => void;
}

export function useFullscreen(): Fullscreen {
  const [supported] = useState(detectSupport);
  const [real, setReal] = useState(() => currentElement() !== null);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    const d = doc();
    if (!d) return;
    const sync = () => {
      const on = currentElement() !== null;
      setReal(on);
      // The browser left fullscreen on its own (Escape, a gesture). Focus mode
      // goes with it, so the screen cannot be left in a state the user did not
      // ask for and has no button for.
      if (!on) setFocus(false);
    };
    d.addEventListener('fullscreenchange', sync);
    d.addEventListener('webkitfullscreenchange', sync);
    return () => {
      d.removeEventListener('fullscreenchange', sync);
      d.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const enter = useCallback((el: HTMLElement | null) => {
    // Focus mode first: it is the part that always works, so the screen
    // responds to the press even if the request below is refused.
    setFocus(true);
    if (!el) return;
    const node = el as El;
    const req = node.requestFullscreen?.bind(node) ?? node.webkitRequestFullscreen?.bind(node);
    if (!req) return;
    try {
      // A refusal is not an error to report: focus mode is already on and the
      // screen says which of the two it got.
      void Promise.resolve(req()).catch(() => undefined);
    } catch {
      /* same */
    }
  }, []);

  const exit = useCallback(() => {
    setFocus(false);
    const d = doc();
    if (!d || currentElement() === null) return;
    const off = d.exitFullscreen?.bind(d) ?? d.webkitExitFullscreen?.bind(d);
    if (!off) return;
    try {
      void Promise.resolve(off()).catch(() => undefined);
    } catch {
      /* nothing to do */
    }
  }, []);

  const toggle = useCallback(
    (el: HTMLElement | null) => {
      if (focus || real) exit();
      else enter(el);
    },
    [focus, real, enter, exit],
  );

  return { supported, real, focus: focus || real, fallback: focus && !real, enter, exit, toggle };
}
