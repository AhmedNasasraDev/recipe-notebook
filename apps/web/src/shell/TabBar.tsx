import { NavLink, useLocation } from 'react-router-dom';
import { ICON_STROKE, TAB_ICON } from './TabIcons.js';
import styles from './TabBar.module.css';

/**
 * §2: four tabs — בית · מחברת · קבוצות · עוד — and `tabOf()`, which maps a deep
 * screen back to the tab it belongs to.
 *
 * Only מחברת is implemented in this stage. The other three are shown as
 * explicitly pending rather than as working links: a tab that silently does
 * nothing is the shape of dishonesty that AC #17 rules out.
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
            THE NAME LIVES HERE NOW.

            The label came off the bar and moved onto the link: `aria-label`
            is the accessible name, `title` is the browser's own tooltip on a
            pointer, and `.tip` below is the one that also appears on keyboard
            focus — which `title` never does. A tab that is not built says so
            in the name rather than in a caption nobody can see.
          */
          aria-label={tab.ready ? tab.label : `${tab.label} — בהכנה`}
          title={tab.ready ? tab.label : `${tab.label} — בהכנה`}
          aria-current={current === tab.to ? 'page' : undefined}
        >
          <span className={styles.glyph}>
            {TAB_ICON[tab.to]?.({
              width: current === tab.to ? ICON_STROKE.active : ICON_STROKE.rest,
            })}
          </span>
          {/* Desktop only, and hidden from assistive tech: the accessible name
              above already says this, and saying it twice is worse than not
              showing it at all. */}
          <span className={styles.tip} aria-hidden="true">
            {tab.label}
          </span>
          {!tab.ready && <span className={styles.pendingDot} aria-hidden="true" />}
        </NavLink>
      ))}
    </nav>
  );
}

export { TABS as TAB_DEFS };
