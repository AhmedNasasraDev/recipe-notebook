// The "עוד" tab — §2 screen 19: "תפריט: יום ייצור, רכש, כלי מדידה, הגדרות".
//
// WHAT THIS SCREEN USED TO BE, AND WHY IT CHANGED
//
// It was a half-menu with the account block, the ingredient centre and the
// production plans on it, and then — at the bottom of the same screen — a
// placeholder announcing that "יום ייצור, רכש ומלאי, כלי המדידה שלי, הגדרות"
// were not built yet. Three of those four were linked immediately above it.
// The screen contradicted itself, which is worse than either being honest or
// being finished.
//
// It is now what §2 says it is: a menu, four entries, every one of them a
// screen that exists. The account block and the calibration list moved to the
// screens §2 assigns them to — הגדרות and כלי המדידה שלי — so each thing has
// one home instead of being wherever there was room.

import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { useAppData } from '../app/AppDataProvider.js';
import { ChevronIcon, ICON_STROKE, MENU_ICON } from '../shell/Icons.js';
import styles from './MoreScreen.module.css';

interface Entry {
  to: string;
  title: string;
  body: string;
  /** Which of §10's two groups the entry belongs to. */
  group: 'kitchen' | 'tools';
}

/*
  THE FOUR CARDS, AND WHY THE SENTENCES GOT SHORTER.

  Each entry used to carry a paragraph — the ingredient centre's ran to two
  lines about how a price change propagates. That is true and it belongs on the
  screen it describes, not on the menu that leads to it: a menu is read at a
  glance to choose, and four paragraphs make choosing slower. One line each,
  in Ahmed's own words from the design.
*/
const ENTRIES: readonly Entry[] = [
  {
    to: '/ingredients',
    title: 'חומרי גלם ומחירים',
    body: 'ניהול חומרי גלם ועדכון מחירים',
    group: 'kitchen',
  },
  {
    to: '/plans',
    title: 'תכנון ייצור ורכש',
    body: 'תכנון כמויות ורשימת קניות',
    group: 'kitchen',
  },
  {
    to: '/tools',
    title: 'כלי המדידה שלי',
    body: 'מידות והמרות לפי הכלים שלך',
    group: 'tools',
  },
  {
    to: '/settings',
    title: 'הגדרות',
    body: 'פרופיל, שפה והעדפות',
    group: 'tools',
  },
];

/*
  §10 groups the four entries in two: what you do to run the kitchen, and what
  you set up once. Four cards do not need finding, but the headings say what
  kind of thing each pair is — and the handoff draws them.
*/
const GROUPS: readonly { key: Entry['group']; title: string }[] = [
  { key: 'kitchen', title: 'ניהול המטבח' },
  { key: 'tools', title: 'כלים והעדפות' },
];

export function MoreScreen() {
  const { status, user } = useAuth();
  const { capabilities } = useAppData();

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>עוד</h1>
        <p className={styles.lede}>כל הכלים למחברת שלך</p>
      </header>

      {/*
        Four cards, and the whole card is the link — an <a> with the title
        inside it, so its accessible name is the destination and a tap
        anywhere on it works. The icon and the chevron are `aria-hidden`
        decoration; the chevron points left because the application is RTL and
        that is the way forward.
      */}
      <nav className={styles.menu} aria-label="תפריט עוד">
        {GROUPS.map((g) => (
          <section key={g.key} className={styles.group} aria-label={g.title}>
            <h2 className={styles.groupTitle}>{g.title}</h2>
            {ENTRIES.filter((e) => e.group === g.key).map((e) => {
              const Icon = MENU_ICON[e.to];
              return (
                <Link key={e.to} to={e.to} className={styles.entry}>
                  <span className={styles.entryIcon} aria-hidden="true">
                    {Icon?.({ width: ICON_STROKE.menu })}
                  </span>
                  <span className={styles.entryText}>
                    <span className={styles.entryTitle}>{e.title}</span>
                    <span className={styles.entryBody}>{e.body}</span>
                  </span>
                  <span className={styles.entryChevron} aria-hidden="true">
                    <ChevronIcon />
                  </span>
                </Link>
              );
            })}
          </section>
        ))}
      </nav>

      {/*
        THE ACCOUNT LINE STAYS.

        It is not in the design Ahmed sent, and it is the one thing on this
        screen that answers "is my work being saved, and where?" — so it is
        kept and made secondary rather than dropped for looking untidy.
      */}
      <footer className={styles.account}>
        {status === 'signed-in' && user ? (
          <p className={styles.note}>
            מחוברים כ־<span className="ltr">{user.email}</span>. ניהול החשבון
            והסיסמה נמצא ב<Link to="/settings" className={styles.inlineLink}>הגדרות</Link>.
          </p>
        ) : (
          <p className={styles.note}>
            {/* No 'simulated' branch: the line that started "סימולציה מקומית"
                was removed at Ahmed's request. This slot always held one
                sentence, so the trial falls through to the existing default —
                which is true (there is no account) and is not a new banner
                and not a claim that anything is saved to a server. */}
            {capabilities.source === 'local-demo'
              ? 'אין חיבור לשרת בהתקנה הזאת, ולכן אין חשבון. מוצגים מתכוני הדמו לקריאה בלבד.'
              : 'לא מחוברים לחשבון.'}
          </p>
        )}
      </footer>
    </div>
  );
}
