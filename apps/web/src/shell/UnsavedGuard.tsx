// An unsaved-changes guard that every way OUT of a screen consults.
//
// QA 22.09.2026, finding 6: the editor asked "יש שינויים שלא נשמרו. לצאת בלי
// לשמור?" on its own ביטול and on a reload, but a press on the tab bar left
// at once and the draft was gone. With `BrowserRouter` there is no router-level
// blocker, so the guard is a small context: a screen with unsaved work
// registers a question, and the shared navigation (the tab bar, the back
// control) asks it before moving. One guard at a time — the screens that
// have unsaved state are never nested.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

interface UnsavedGuardApi {
  /** true when leaving is allowed (nothing unsaved, or the person agreed) */
  allow(): boolean;
  /** registers the current screen's guard; returns the unregister function */
  register(guard: () => boolean): () => void;
}

const Ctx = createContext<UnsavedGuardApi>({
  allow: () => true,
  register: () => () => {},
});

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const current = useRef<(() => boolean) | null>(null);
  const api = useMemo<UnsavedGuardApi>(
    () => ({
      allow: () => (current.current ? current.current() : true),
      register: (guard) => {
        current.current = guard;
        return () => {
          if (current.current === guard) current.current = null;
        };
      },
    }),
    [],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** For the tab bar and other shared navigation: may we leave right now? */
export function useLeaveGuard(): () => boolean {
  return useContext(Ctx).allow;
}

export const UNSAVED_QUESTION = 'יש שינויים שלא נשמרו. לצאת בלי לשמור?';

/**
 * For a screen with a form: while `dirty`, every shared way out asks the
 * question, and a reload or a closed tab gets the browser's own warning.
 */
export function useUnsavedGuard(dirty: boolean, question: string = UNSAVED_QUESTION): void {
  const { register } = useContext(Ctx);
  const ask = useCallback(() => !dirty || window.confirm(question), [dirty, question]);

  useEffect(() => register(ask), [register, ask]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
