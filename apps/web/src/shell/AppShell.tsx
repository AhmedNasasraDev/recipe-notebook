import { Outlet } from 'react-router-dom';
import { useAppData } from '../app/AppDataProvider.js';
import { TabBar } from './TabBar.js';
import styles from './AppShell.module.css';

/**
 * The frame every tab screen lives in: scroll region, the honesty banner, and
 * the bottom tab bar from §2.
 */
export function AppShell() {
  const { error, clearError, capabilities, backendNote } = useAppData();

  // §17 / AC #17: the app states plainly where its data comes from. It never
  // presents a local-only session as if it were connected.
  //
  // Connected-and-online is the only state with nothing to disclose. A demo
  // session, a dropped connection and data served from the offline mirror are
  // each a different promise about whether a save will stick, so each one says
  // so — describeBackend() in AppDataProvider writes the sentence.
  const showBackendNote =
    capabilities.source === 'local-demo' ||
    capabilities.servingFromCache ||
    !capabilities.online;

  return (
    <div className={styles.outer}>
      <div className={styles.frame}>
        {error && (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            <span className={styles.bannerText}>{error}</span>
            <button
              type="button"
              className={styles.bannerClose}
              onClick={clearError}
              aria-label="סגירת ההודעה"
            >
              ×
            </button>
          </div>
        )}
        {!error && showBackendNote && (
          <p className={styles.banner} role="status">
            <span className={styles.bannerText}>{backendNote}</span>
          </p>
        )}
        {/*
          THE READING COLUMN.

          On a phone the frame is the column. On a tablet and a desktop the
          frame grows to 760 and every row inside it stretches with it: a menu
          card's chevron ends up a hand's width from the name it belongs to,
          and an ingredient's "המר" sits at the far edge of the screen from the
          ingredient. The column caps the content and centres it — which is
          also a sane measure for a line of Hebrew — while the scroller, the
          banner and the tab bar keep the full width of the frame.
        */}
        <main className={`${styles.content} hideScrollbar`}>
          <div className={styles.column}>
            <Outlet />
          </div>
        </main>
        <TabBar />
      </div>
    </div>
  );
}
