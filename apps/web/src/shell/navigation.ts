import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/*
  ── GOING BACK, ONCE, FOR THE WHOLE APPLICATION ─────────────────────────────

  Ahmed reported it from the ingredient centre, and said plainly that the
  screen was only an example: "בדוק את כל מסכי המערכת ותתי־המסכים, ולא רק את
  המסך הזה." Two separate defects came out of that audit.

  1. SCREENS WITH NO WAY BACK AT ALL. `/ingredients`, `/plans`, `/tools`,
     `/settings`, `/plan/:id`, `/group/:id/perms` and `/group/:id/item/:itemId`
     had none. Every one of them is reached from a parent screen, and the only
     way out was the tab bar — which is a different thing: it moves you to
     another SECTION, it does not return you.

  2. THE SCREENS THAT DID HAVE ONE WENT TO THE WRONG PLACE. Every back control
     in the project was `<BackLink to="/notebook">`, hard-coded. So Home →
     recipe → back landed in the notebook, a screen the person had not been
     on. A group's recipe → back landed in the notebook too.

  ── WHAT "BACK" MEANS HERE ──────────────────────────────────────────────────

  Ahmed's rules, in his order:

    · "כשיש מסך קודם בתוך האפליקציה, חזור אליו"  → history, when there is any
    · "כשאין היסטוריית ניווט פנימית, חזור למסך האב המתאים"  → `parentOf`
    · "לחיצה על חזרה פנימית לא תוציא את המשתמש מהאפליקציה"  → never `-1` at
      the first entry

  `location.key` is how the first condition is answered, and it is the right
  signal rather than a convenient one: React Router gives the FIRST entry of a
  session the literal key `'default'` and every entry after it a generated
  one. So `key === 'default'` means "nothing of ours is behind this" — whether
  the person arrived from a shared link, a bookmark, or a cold start — and in
  that state `navigate(-1)` would step out of the application into whatever
  page was there before. That is the one thing this must never do.

  It also works in both routers the project runs: `BrowserRouter` in the app
  and `MemoryRouter` in the Artifact and the trial file. `window.history.state.idx`
  would have been the other candidate and it exists only in the first.
*/

/**
 * The screen a given screen belongs under — where "back" goes when there is
 * no history to go back through.
 *
 * `null` for the four tabs: they ARE the top, and a back control on them is
 * the mistake the handoff's own mockup makes. Ahmed: "במסך הבית אין צורך
 * בכפתור חזרה."
 */
export function parentOf(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';

  /* The four roots have nothing above them. */
  if (['/home', '/notebook', '/groups', '/more', '/'].includes(p)) return null;

  /* A recipe's own deep screens go back to the recipe, not to the notebook:
     cook mode, the label and the order sheet are all opened FROM it. */
  const recipe = /^\/recipe\/([^/]+)\/(edit|cook|label|order)$/.exec(p);
  if (recipe) return `/recipe/${recipe[1]}`;

  /* A new recipe, a pasted one, and an existing one all belong to the
     notebook — that is the screen that lists them. */
  if (p === '/recipe/new' || p === '/paste') return '/notebook';
  if (/^\/recipe\/[^/]+$/.test(p)) return '/notebook';

  /* Inside a group. */
  const inGroup = /^\/group\/([^/]+)\/(perms|item\/[^/]+)$/.exec(p);
  if (inGroup) return `/group/${inGroup[1]}`;
  if (/^\/group\/[^/]+$/.test(p)) return '/groups';

  /* One production plan belongs to the list of them. */
  if (/^\/plan\/[^/]+$/.test(p)) return '/plans';

  /* Everything reached from "עוד". */
  if (['/ingredients', '/plans', '/tools', '/settings', '/stock'].includes(p)) return '/more';

  /*
    An invitation is opened from outside the application — an email, a message
    — so there is nothing of ours behind it and no parent it came from. Home is
    where somebody who declines an invitation should end up, because it is the
    screen that says what this application is.
  */
  if (/^\/join\//.test(p)) return '/home';

  /* Onboarding has no back: it is a gate, and leaving it half-done is what
     the gate exists to prevent. */
  if (p === '/onboarding') return null;

  return '/home';
}

/**
 * The one back action. Returns null on a screen that has no way back, so a
 * caller can render nothing rather than render a control that does nothing.
 */
export function useGoBack(): (() => void) | null {
  const navigate = useNavigate();
  const location = useLocation();
  const parent = parentOf(location.pathname);

  const back = useCallback(() => {
    /*
      `'default'` is the first entry of the session. Stepping back from it
      leaves the application, so the parent screen is used instead — and the
      parent is pushed rather than replaced, so a person who then presses back
      again is still inside the app.
    */
    if (location.key === 'default') {
      if (parent !== null) navigate(parent);
      return;
    }
    navigate(-1);
  }, [location.key, navigate, parent]);

  return parent === null ? null : back;
}

/**
 * What the back control should be CALLED.
 *
 * The label names where you are going, which is the only honest thing it can
 * say — and on a history step it is a guess, so it names the parent, which is
 * where you end up in every case except a sideways arrival. A label that said
 * "חזרה" alone would be correct and tell nobody anything.
 */
export const SCREEN_NAME: Readonly<Record<string, string>> = {
  '/home': 'בית',
  '/notebook': 'המחברת',
  '/groups': 'הקבוצות',
  '/more': 'עוד',
  '/plans': 'תוכניות הייצור',
  '/ingredients': 'חומרי גלם',
  '/tools': 'כלי המדידה',
  '/settings': 'הגדרות',
};

/** The parent's name, for the control's label. */
export function parentName(pathname: string, fallback = 'חזרה'): string {
  const parent = parentOf(pathname);
  if (parent === null) return fallback;
  if (SCREEN_NAME[parent]) return SCREEN_NAME[parent]!;
  if (/^\/recipe\//.test(parent)) return 'המתכון';
  if (/^\/group\//.test(parent)) return 'הקבוצה';
  return fallback;
}
