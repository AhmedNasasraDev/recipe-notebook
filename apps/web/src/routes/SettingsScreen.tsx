// §2 screen 20 — "הגדרות": a menu of categories, one screen per category.
//
// Personal Settings, stage 2 (design pass, 23.09.2026). This screen used to be
// one long page with every setting on it — profile, units, text size, language,
// privacy, backup, resetting onboarding and the account, all as stacked cards.
// Ahmed's design audit found that shape confusing on its own screen before it
// even looked at the rest of the app, so it is now a plain list of categories,
// the same card-row language "עוד" already uses — each row leads to its own
// screen, and nothing but the list itself lives here.
//
// Categories not built yet (notifications, course preferences) are not listed —
// a card that leads nowhere real is worse than no card.

import { Link } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import {
  BackupIcon,
  ChevronIcon,
  ICON_STROKE,
  LanguageIcon,
  PrivacyIcon,
  ProfileIcon,
  RecipePrefsIcon,
} from '../shell/Icons.js';
import styles from './SettingsScreen.module.css';

const CATEGORIES = [
  {
    to: '/settings/profile',
    Icon: ProfileIcon,
    title: 'פרטים אישיים',
    body: 'שם, תמונה, טלפון, מייל וסיסמה',
  },
  {
    to: '/settings/language',
    Icon: LanguageIcon,
    title: 'שפה',
    body: 'עברית. ערבית בהכנה',
  },
  {
    to: '/settings/recipe-preferences',
    Icon: RecipePrefsIcon,
    title: 'העדפות מתכונים',
    body: 'רמת פירוט, יחידות מידה וגודל טקסט במצב הכנה',
  },
  {
    to: '/settings/privacy',
    Icon: PrivacyIcon,
    title: 'פרטיות ואבטחה',
    body: 'איך המחברת שלכם מוגנת',
  },
  {
    to: '/settings/backup',
    Icon: BackupIcon,
    title: 'גיבוי ונתונים',
    body: 'הורדת כל המחברת כקובץ',
  },
] as const;

export function SettingsScreen() {
  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        {/* §4: the way back is at the TOP of an inner screen, not at the end
            of it — it used to be the last thing on the page. */}
        <BackControl>עוד</BackControl>
        <h1 className={styles.title}>הגדרות</h1>
      </header>

      <nav className={styles.menu} aria-label="קטגוריות הגדרות">
        {CATEGORIES.map(({ to, Icon, title, body }) => (
          <Link key={to} to={to} className={styles.entry}>
            <span className={styles.entryIcon} aria-hidden="true">
              <Icon width={ICON_STROKE.menu} />
            </span>
            <span className={styles.entryText}>
              <span className={styles.entryTitle}>{title}</span>
              <span className={styles.entryBody}>{body}</span>
            </span>
            <span className={styles.entryChevron} aria-hidden="true">
              <ChevronIcon />
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
