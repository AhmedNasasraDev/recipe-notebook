// §2 screen 2 — "בית": "המשך מאיפה שעצרת, קטגוריות, בסיסים".
//
// WHAT A HOME SCREEN IS ALLOWED TO BE HERE
//
// Every number on this screen is computed from the notebook that is already
// loaded, through the same engine and the same central prices as the recipe
// page. Nothing is stored for it, nothing is counted twice, and there is no
// new table behind it — a home screen that needed its own data would be a
// second source of truth about the notebook.
//
// "המשך מאיפה שעצרת" IS THE ONE THING THAT NEEDED A DECISION
//
// "Where you stopped" means the last recipe you OPENED, which nothing recorded.
// Two honest options: the last recipe SAVED (already in the data, but that is a
// different sentence), or the last one opened on this device. This takes the
// second and says so in those words — "הפתיחה האחרונה במכשיר הזה" — because it
// is per-device, not per-account: the mirror already holds Cook Mode progress
// the same way, and `clearMirror()` on sign-out takes both. The alternative,
// a `last_opened` column, would be an account-wide write on every recipe view.
//
// A notebook with a bake in progress gets that first instead: an unfinished
// Cook Mode session is more "where you stopped" than a page you looked at.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { compute, formatGrams, formatNis, type Recipe } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import {
  readLastOpened,
  readCookProgress,
  readRecents,
  readFavorites,
} from '../data/offlineMirror.js';
import { categoryIcon } from '../features/recipe/categoryIcon.js';
import { timeLabelOf } from '../features/recipe/recipeTime.js';
import styles from './HomeScreen.module.css';

interface Resume {
  recipe: Recipe;
  /** how far into a cooking session, when there is one */
  cooking: { done: number; total: number } | null;
}

export function HomeScreen() {
  const { recipes, categories, prefs, catalog, capabilities, ready } = useAppData();
  const navigate = useNavigate();
  const [resume, setResume] = useState<Resume | null>(null);
  /*
    UX PASS: THE TWO SHORT LISTS A KITCHEN ACTUALLY OPENS.

    Both are ids from the device mirror (see `offlineMirror.ts` for why they
    are not columns), resolved against the notebook that is already loaded —
    so an id that no longer exists, or belongs to another account, simply
    disappears from the list instead of showing a broken row.
  */
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [term, setTerm] = useState('');

  const pro = prefs.pro === true;

  // Priced once, and reused by both the base-recipe list and the resume card,
  // so a cost here is the same number the recipe page shows.
  const priced = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const id = await readLastOpened();
        const recipe = id ? (recipes.find((r) => r.id === id) ?? null) : null;
        if (!recipe) {
          if (!cancelled) setResume(null);
          return;
        }
        const progress = await readCookProgress(recipe.id);
        const total = (recipe.steps ?? []).filter((s) => s.text || s.minutes).length;
        const done = progress
          ? Object.values(progress.done).filter(Boolean).length
          : 0;
        if (!cancelled) {
          setResume({
            recipe,
            cooking: progress && done > 0 && done < total ? { done, total } : null,
          });
        }
      } catch {
        // Device storage can be blocked. The rest of the screen is unaffected.
        if (!cancelled) setResume(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipes]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [r, f] = await Promise.all([readRecents(), readFavorites()]);
      if (cancelled) return;
      setRecentIds(r);
      setFavoriteIds(f);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const pick = useCallback(
    (ids: readonly string[], limit: number): Recipe[] =>
      ids
        .map((id) => byId.get(id))
        .filter((r): r is Recipe => r !== undefined)
        .slice(0, limit),
    [byId],
  );

  const favorites = useMemo(() => pick(favoriteIds, 6), [favoriteIds, pick]);
  /* The recipe already offered as "המשך מאיפה שעצרת" is not repeated here. */
  const recents = useMemo(
    () => pick(recentIds.filter((id) => id !== resume?.recipe.id), 5),
    [recentIds, pick, resume],
  );

  /** How many recipes each category holds. Empty ones are not offered. */
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of recipes) {
      const c = r.category ?? 'אחר';
      out.set(c, (out.get(c) ?? 0) + 1);
    }
    return out;
  }, [recipes]);

  /**
   * §2: "מתכוני בסיס לפי עלות לק"ג". The sub-recipes, cheapest first, because
   * the reason to look at this list is to see what a filling actually costs.
   * A base recipe whose cost cannot be established has NO cost here — it is
   * not sorted to the top as if it were free.
   */
  const bases = useMemo(() => {
    const out = priced
      .filter((r) => r.isSub)
      .map((r) => {
        const c = compute(r, priced, { prefs });
        return {
          recipe: r,
          costPerKg: c.costPerKg > 0 ? c.costPerKg : null,
          yieldG: c.actualYield,
          partial: c.unresolved.length > 0,
        };
      });
    out.sort((a, b) => {
      if (a.costPerKg === null && b.costPerKg === null) return 0;
      if (a.costPerKg === null) return 1;
      if (b.costPerKg === null) return -1;
      return a.costPerKg - b.costPerKg;
    });
    return out;
  }, [priced, prefs]);

  if (!ready) return null;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>בית</h1>
        <p className={styles.count}>
          {recipes.length === 0
            ? 'המחברת ריקה'
            : recipes.length === 1
              ? 'מתכון אחד במחברת'
              : `${recipes.length} מתכונים במחברת`}
        </p>
      </header>

      {/*
        ── the two things a person comes to this screen to do ──────────────

        UX PASS. The home screen had neither: to find a recipe you first went
        to the notebook tab and then found the search box there, and to start a
        new one you did the same. Both are here now, above everything else and
        in that order — finding is the common case, writing is the loud one.

        The search does not re-implement searching: it hands the term to the
        notebook, which already searches names, tags and ingredients, and which
        now keeps the term in its address (`/notebook?q=…`). One search, one
        result list, and the browser's own back button behaves.
      */}
      <section className={styles.start} aria-label="התחלה">
        <form
          className={styles.searchForm}
          onSubmit={(e) => {
            e.preventDefault();
            const q = term.trim();
            navigate(q === '' ? '/notebook' : `/notebook?q=${encodeURIComponent(q)}`);
          }}
        >
          <label className={styles.searchLabel} htmlFor="home-search">
            חיפוש מתכון
          </label>
          <div className={styles.searchRow}>
            <input
              id="home-search"
              className={styles.search}
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="שם, תג או רכיב"
            />
            <button type="submit" className={styles.searchBtn}>
              חיפוש
            </button>
          </div>
        </form>

        <Link to="/recipe/new" className={styles.newBtn}>
          + מתכון חדש
        </Link>
      </section>

      {/* ── המשך מאיפה שעצרת ─────────────────────────────────────────────── */}
      {resume ? (
        <section className={styles.resume} aria-label="המשך מאיפה שעצרת">
          <h2 className={styles.sectionTitle}>
            {resume.cooking ? 'הכנה באמצע' : 'הפתיחה האחרונה במכשיר הזה'}
          </h2>
          <Link to={`/recipe/${resume.recipe.id}`} className={styles.resumeCard}>
            <span className={styles.resumeName}>{resume.recipe.name}</span>
            <span className={styles.resumeMeta}>
              {resume.cooking ? (
                <>
                  <span className="ltr">{resume.cooking.done}</span> מתוך{' '}
                  <span className="ltr">{resume.cooking.total}</span> שלבים הושלמו
                </>
              ) : (
                resume.recipe.category
              )}
            </span>
          </Link>
          {resume.cooking && (
            <Link to={`/recipe/${resume.recipe.id}/cook`} className={styles.resumeCook}>
              חזרה למצב הכנה
            </Link>
          )}
        </section>
      ) : (
        recipes.length > 0 && (
          <section className={styles.resume} aria-label="המשך מאיפה שעצרת">
            <h2 className={styles.sectionTitle}>המשך מאיפה שעצרת</h2>
            <p className={styles.note}>
              כאן יופיע המתכון האחרון שנפתח במכשיר הזה, וגם הכנה שנשארה באמצע.
            </p>
          </section>
        )
      )}

      {/* ── favourites and recents (device-local, and it says so) ───────── */}
      {favorites.length > 0 && (
        <section className={styles.section} aria-label="מועדפים">
          <h2 className={styles.sectionTitle}>מועדפים</h2>
          <ul className={styles.quickList}>
            {favorites.map((r) => (
              <li key={r.id}>
                <Link to={`/recipe/${r.id}`} className={styles.quickRow}>
                  <span className={styles.quickName}>{r.name}</span>
                  <span className={styles.quickMeta}>
                    {r.category}
                    {timeLabelOf(r) && (
                      <>
                        {' · '}
                        <span className="ltr">{timeLabelOf(r)}</span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recents.length > 0 && (
        <section className={styles.section} aria-label="נפתחו לאחרונה">
          <h2 className={styles.sectionTitle}>נפתחו לאחרונה</h2>
          <ul className={styles.quickList}>
            {recents.map((r) => (
              <li key={r.id}>
                <Link to={`/recipe/${r.id}`} className={styles.quickRow}>
                  <span className={styles.quickName}>{r.name}</span>
                  <span className={styles.quickMeta}>{r.category}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.note}>הרשימות האלה נשמרות במכשיר הזה בלבד.</p>
        </section>
      )}

      {/* ── categories ──────────────────────────────────────────────────── */}
      <section className={styles.section} aria-label="קטגוריות">
        <h2 className={styles.sectionTitle}>קטגוריות</h2>
        {counts.size === 0 ? (
          <p className={styles.note}>
            {capabilities.canWrite
              ? 'אחרי שיישמר מתכון ראשון, הקטגוריות יופיעו כאן.'
              : 'אין מתכונים בהתקנה הזאת.'}
          </p>
        ) : (
          <div className={styles.tiles}>
            {categories
              .filter((c) => (counts.get(c) ?? 0) > 0)
              .map((c) => (
                <Link
                  key={c}
                  to={`/notebook?category=${encodeURIComponent(c)}`}
                  className={styles.tile}
                >
                  <span className={styles.tileName}>
                    {/* Decoration beside the name, never instead of it, and
                        hidden from a screen reader that already reads it. */}
                    {categoryIcon(c) && (
                      <span className={styles.tileIcon} aria-hidden="true">
                        {categoryIcon(c)}
                      </span>
                    )}
                    {c}
                  </span>
                  <span className={styles.tileCount}>
                    <span className="ltr">{counts.get(c)}</span>{' '}
                    {counts.get(c) === 1 ? 'מתכון' : 'מתכונים'}
                  </span>
                </Link>
              ))}
          </div>
        )}
      </section>

      {/* ── base recipes ────────────────────────────────────────────────── */}
      <section className={styles.section} aria-label="מתכוני בסיס">
        <h2 className={styles.sectionTitle}>מתכוני בסיס</h2>
        {bases.length === 0 ? (
          <p className={styles.note}>
            מתכון בסיס הוא מתכון שמשמש כרכיב במתכונים אחרים — גנאש, קרם, בצק. אפשר
            לסמן מתכון כבסיס בעריכה שלו, ואז הוא יופיע כאן עם העלות שלו לק&quot;ג.
          </p>
        ) : (
          <ul className={styles.bases}>
            {bases.map((b) => (
              <li key={b.recipe.id}>
                <Link to={`/recipe/${b.recipe.id}`} className={styles.baseRow}>
                  <span className={styles.baseName}>{b.recipe.name}</span>
                  <span className={styles.baseMeta}>
                    <span className="ltr">{formatGrams(b.yieldG)}</span>
                    {pro && (
                      <>
                        {' · '}
                        {b.costPerKg === null ? (
                          // No cost is not a cost of zero, and it must not sort
                          // to the front of a list about cost.
                          <span className={styles.baseNoCost}>אין עלות</span>
                        ) : (
                          <>
                            <span className="ltr">{formatNis(b.costPerKg)}</span> לק&quot;ג
                            {b.partial && <span className={styles.basePartial}> · חלקי</span>}
                          </>
                        )}
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
