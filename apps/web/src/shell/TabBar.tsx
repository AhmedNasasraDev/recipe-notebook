import { NavLink, useLocation } from 'react-router-dom';
import { ICON_STROKE, TAB_ICON } from './Icons.js';
import styles from './TabBar.module.css';

/**
 * §2: four tabs — בית · מחברת · קבוצות · עוד — and `tabOf()`, which maps a deep
 * screen back to the tab it belongs to.
 *
 * Each tab carries its glyph AND its name, at every width. A tab that is not
 * built says so in its name rather than leading somewhere that apologises.
 */
interface TabDef {
  to: string;
  label: string;
  /** which screens count as inside this tab (§2 tabOf) */
  owns: string[];
  ready: boolean;
}

const TABS: readonly TabDef[] = [
  { to: '/home', label: 'בית', owns: ['/home'], ready: true },
  { to: '/notebook', label: 'מחברת', owns: ['/notebook', '/recipe', '/paste'], ready: true },
  {
    to: '/groups',
    label: 'קבוצות',
    owns: ['/groups', '/group', '/perms'],
    // STAGE-12: was `false`. §10 is now built — the list, the group, the group
    // recipe and the permissions screen — so the tab stops saying "בהכנה" in
    // the same commit that gave it somewhere to go. A tab marked pending that
    // leads to four working screens is the same dishonesty as the reverse.
    ready: true,
  },
  {
    to: '/more',
    label: 'עוד',
    // `/ingredients` is owned here because the centre is reached from "עוד",
    // so the tab must stay lit while the user is in it.
    //
    // STAGE-10 AUDIT FIX: `/plans` was missing. `tabOf` matches a path exactly
    // or as a `${p}/` prefix, so `/plan/:id` matched `/plan` but the LIST at
    // `/plans` matched nothing and fell through to the notebook — the bottom
    // bar told a user standing in their production plans that they were in the
    // notebook. Found by comparing the screenshots of the two routes.
    owns: ['/more', '/settings', '/tools', '/plan', '/plans', '/stock', '/ingredients'],
    // STAGE-11: was `false` — and had been since stage 2, while the tab had
    // grown the ingredient centre, the production plans, the settings and the
    // measuring tools underneath it. A tab marked "בהכנה" that leads to four
    // working screens is the same dishonesty as the reverse, pointing the
    // other way.
    ready: true,
  },
];

/** §2 tabOf(): a deep screen highlights the tab that owns it. */
export function tabOf(pathname: string): string {
  const hit = TABS.find((t) => t.owns.some((p) => pathname === p || pathname.startsWith(`${p}/`)));
  return hit?.to ?? '/notebook';
}

export function TabBar() {
  const { pathname } = useLocation();
  const current = tabOf(pathname);

  return (
    <nav className={styles.bar} aria-label="ניווט ראשי">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={[
            styles.tab,
            current === tab.to ? styles.active : '',
            tab.ready ? '' : styles.pending,
          ]
            .filter(Boolean)
            .join(' ')}
          /*
            THE NAME IS ON SCREEN, AND IT IS ALSO THE ACCESSIBLE NAME.

            The bar was glyphs with the word moved into `aria-label` and a
            desktop-only tooltip. Ahmed asked for both together — icon AND
            word, on every size — so the word is real text inside the link
            now, which makes it the link's accessible name by itself. There is
            no `aria-label` and no `title`: either one would be a second copy
            of a name that is already visible, and a mismatch between what is
            written and what is announced is the bug WCAG 2.5.3 is about.

            A tab that is not built keeps saying so in its name, in text only
            a screen reader reads — the sighted cue is the dot below.
          */
          aria-current={current === tab.to ? 'page' : undefined}
        >
          <span className={styles.glyph}>
            {TAB_ICON[tab.to]?.({
              width: current === tab.to ? ICON_STROKE.active : ICON_STROKE.rest,
            })}
          </span>
          <span className={styles.label}>
            {tab.label}
            {!tab.ready && <span className="visuallyHidden"> — בהכנה</span>}
          </span>
          {!tab.ready && <span className={styles.pendingDot} aria-hidden="true" />}
        </NavLink>
      ))}
    </nav>
  );
}

export { TABS as TAB_DEFS };
