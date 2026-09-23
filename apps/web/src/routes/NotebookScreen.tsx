import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { compute, formatGrams, type Computed } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import { timeLabelOf } from '../features/recipe/recipeTime.js';
import { categoryPhoto } from '../features/categories/categoryImage.js';
import { CATEGORY_ICON, ChevronIcon, ICON_STROKE, SearchIcon } from '../shell/Icons.js';
import styles from './NotebookScreen.module.css';

/**
 * §2 screen 3 — the notebook: search, category filter, import/export.
 *
 * Search matches the prototype: name, tags and ingredient names.
 * Import/export are not rendered at all in this stage. The prototype's export
 * button announced "X מתכונים הועתקו לקובץ" without producing a file (B8), and
 * a button that lies is worse than a button that is absent.
 */
export function NotebookScreen() {
  const { recipes, categories, prefs, capabilities, catalog, recipeThumbs } = useAppData();

  /*
    ── THE CARD SHOWS THE RECIPE'S OWN PHOTOGRAPH ─────────────────────────

    Ahmed: "בכרטיס מתכון הצג את התמונה האישית שלו כשקיימת; תמונת הקטגוריה היא
    חלופה בלבד." So the first photograph of each recipe is fetched for the
    whole list in ONE round trip (`recipeThumbs` — one select over the image
    rows and one batch of signatures) rather than two requests per row, which
    is why the cards carried the category picture until now.

    Three states, in order: the recipe's own photograph; the category's
    photograph; the category's glyph on a cream tile. A recipe whose photo
    cannot be signed — one this account may not see — is simply missing from
    the map and falls back with the rest, instead of showing a broken image.

    The list re-reads when the set of recipe IDS changes, not on every render
    of `recipes`: editing a name must not re-sign fifty URLs.
  */
  const thumbIds = useMemo(
    () => recipes.map((r) => String(r.id ?? '')).filter((id) => id !== ''),
    [recipes],
  );
  const thumbKey = thumbIds.join(',');
  const [thumbs, setThumbs] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    if (thumbKey === '') return;
    let cancelled = false;
    void recipeThumbs(thumbKey.split(','))
      .then((map) => {
        if (!cancelled) setThumbs(map);
      })
      // Decoration on a list that has to render anyway.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [thumbKey, recipeThumbs]);

  /*
    The category filter is addressable: `/notebook?category=לחמים`.
    It was component state, which is why the home screen had nowhere to link a
    category tile TO. A filter in the URL is also the thing a user expects to
    survive a back button and a shared link.
  */
  const [params, setParams] = useSearchParams();

  /*
    UX PASS: THE SEARCH TERM IS IN THE URL TOO.

    It was component state, which made the home screen's new search box
    impossible — there was nowhere to send "חיפוש מתכון" to. It is also what a
    user expects of a search: the back button returns to the results, a reload
    keeps them, and the address can be handed to somebody else.

    The input keeps its own state so typing is never waiting on the router,
    and every keystroke writes the term to the address with `replace` — the
    results and the address always agree, and the back button does not have to
    walk back through one entry per letter. The effect below picks up a change
    that came from outside (a link from the home screen, or the back button).
  */
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);
  const commitQuery = (next: string) => {
    const p = new URLSearchParams(params);
    if (next.trim() === '') p.delete('q');
    else p.set('q', next);
    setParams(p, { replace: true });
  };

  const fromUrl = params.get('category');
  const category = fromUrl && categories.includes(fromUrl) ? fromUrl : 'הכל';
  const setCategory = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === 'הכל') p.delete('category');
    else p.set('category', next);
    // `replace`: choosing four categories in a row should not put four entries
    // in the history for the back button to walk through.
    setParams(p, { replace: true });
  };

  /*
    STAGE-10 AUDIT FIX, two defects in one place.

    1. THE CARDS IGNORED THE CENTRAL PRICES. This ran `compute(r, recipes)` on
       the RAW recipes, so a card's "₪ לק"ג" came from prices typed into the
       recipe's own rows. Since stage 7 the normal case is the opposite — the
       price lives in the ingredient centre and the row has none — so a
       properly priced recipe showed NO cost on its card and a full cost on its
       own page. One figure, two screens, two answers. The catalog is resolved
       here now, exactly as the recipe screen does it.

    2. IT RAN INSIDE THE RENDER LOOP. Measured: 120 recipes of 40 rows cost
       24.4 ms per render, so typing a ten-letter search term spent ~244 ms
       recomputing the whole notebook — on a phone, several times that. The
       computation is keyed on the notebook, the catalog and the preferences
       instead of on the filtered subset, so searching and switching category
       now cost nothing: only a real change to the data recomputes.
  */
  const computedById = useMemo(() => {
    const priced = recipes.map((r) => resolveFromCatalog(r, catalog));
    const out = new Map<string, Computed>();
    for (const r of priced) out.set(r.id, compute(r, priced, { prefs }));
    return out;
  }, [recipes, catalog, prefs]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return recipes.filter((r) => {
      if (category !== 'הכל' && r.category !== category) return false;
      if (!q) return true;
      const haystack = [
        r.name ?? '',
        ...(r.tags ?? []),
        ...(r.ingredients ?? []).map((i) => i.name ?? ''),
      ].join(' ');
      return haystack.includes(q);
    });
  }, [recipes, query, category]);

  const subCount = recipes.filter((r) => r.isSub).length;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div className={styles.headRow}>
          <div>
            <h1 className={styles.title}>מחברת מתכונים</h1>
            <p className={styles.count}>
              {recipes.length === 1 ? 'מתכון אחד' : `${recipes.length} מתכונים`}
              {subCount > 0 && ` · ${subCount === 1 ? 'בסיס אחד' : `${subCount} בסיסים`}`}
            </p>
          </div>
          {/*
            The entry point stage 4 was mainly about. It is rendered even when
            the repository cannot write, because hiding it would leave a
            read-only visitor with no explanation of where recipes come from —
            the editor itself says plainly that saving is unavailable.
          */}
          <span className={styles.newGroup}>
            <Link to="/recipe/new" className={styles.newBtn}>
              + מתכון חדש
            </Link>
            {/* §2 screen 6. Second, and quieter: typing a recipe is the normal
                path and pasting one is the shortcut. */}
            <Link to="/paste" className={styles.pasteBtn}>
              הדבקה
            </Link>
          </span>
        </div>
      </header>

      {/* A VISIBLE label, not a placeholder standing in for one: a placeholder
          disappears the moment there is text in the box, which is exactly when
          somebody looking away from the screen comes back to it. */}
      <div className={styles.searchRow}>
        <label className={styles.searchLabel} htmlFor="nb-search">
          <SearchIcon />
          חיפוש מתכון
        </label>
        <input
          id="nb-search"
          className={styles.search}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            commitQuery(e.target.value);
          }}
          placeholder="שם, תג או רכיב"
        />
      </div>

      <div className={`${styles.chips} hideScrollbar`} role="group" aria-label="סינון לפי קטגוריה">
        {['הכל', ...categories].map((c) => (
          <button
            key={c}
            type="button"
            className={category === c ? styles.chipOn : styles.chip}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        query.trim() || category !== 'הכל' ? (
          <p className={styles.empty}>אין מתכון שתואם לחיפוש.</p>
        ) : (
          /* A first-run notebook. Saying only "המחברת ריקה." was the dead end
             stage 3 ended on: correct, and no help at all. */
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>המחברת ריקה.</p>
            <p className={styles.emptyBody}>
              {capabilities.canWrite
                ? 'כאן יישמרו המתכונים שלכם — עם כמויות, תשואה, עלות ונוסחת אופה. אפשר להתחיל ממתכון אחד.'
                : 'אין חיבור לשרת בהתקנה הזאת, ולכן אי אפשר לשמור מתכונים כרגע.'}
            </p>
            <Link to="/recipe/new" className={styles.emptyCta}>
              יצירת המתכון הראשון
            </Link>{' '}
            {capabilities.canWrite && (
              <Link to="/paste" className={styles.emptyAlt}>
                או הדבקת מתכון מטקסט
              </Link>
            )}
          </div>
        )
      ) : (
        <ul className={styles.list}>
          {filtered.map((r) => {
            /*
              UX PASS: WHAT A CARD IS FOR.

              A card answers "is this the recipe I am looking for?" — name,
              category, how much it makes and how long it takes. It used to
              carry the cost per kilo and a density warning as well, which is
              production data: true, useful, and belonging to the recipe's own
              page, where there is room to say what it means. Neither figure is
              gone; both are on the recipe, priced by the same engine and the
              same central catalogue as before.

              The yield still comes from `compute()` rather than from the
              stored field, so a card and the recipe it opens cannot disagree.
            */
            const c = computedById.get(r.id) ?? compute(r, recipes, { prefs });
            const yieldLabel = r.yieldUnits
              ? `${r.yieldUnits} יח' · ${r.unitWeight} גר' ליחידה`
              : formatGrams(c.actualYield);
            const time = timeLabelOf(r);
            return (
              <li key={r.id}>
                <Link to={`/recipe/${r.id}`} className={styles.card}>
                  {/*
                    DESIGN HANDOFF: A PICTURE AT THE START OF THE ROW.

                    The recipe's OWN photograph when it has one; the category's
                    picture when it does not; the category's glyph on a cream
                    tile when the category has no picture either. See
                    `thumbs` above for how one round trip serves the whole
                    list.
                  */}
                  <span className={styles.thumb} aria-hidden="true">
                    {(() => {
                      const own = thumbs[String(r.id ?? '')];
                      if (own !== undefined) {
                        return (
                          <img
                            className={styles.thumbPhoto}
                            src={own}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={72}
                            height={72}
                          />
                        );
                      }
                      const photo = categoryPhoto(r.category);
                      if (photo) {
                        return (
                          <img
                            className={styles.thumbPhoto}
                            src={photo.small}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={72}
                            height={72}
                          />
                        );
                      }
                      const Glyph = CATEGORY_ICON[r.category ?? ''];
                      return (
                        <span className={styles.thumbGlyph}>
                          {Glyph ? <Glyph width={ICON_STROKE.menu} /> : null}
                        </span>
                      );
                    })()}
                  </span>
                  <span className={styles.cardBody}>
                    <span className={styles.cardName}>{r.name}</span>
                    <span className={styles.cardMeta}>
                      {r.category} · <span className="ltr">{yieldLabel}</span>
                      {time && (
                        <>
                          {' · '}
                          <span className="ltr">{time}</span>
                        </>
                      )}
                    </span>
                    <span className={styles.badges}>
                      {r.isSub && <span className={styles.badgeSub}>מתכון בסיס</span>}
                      {r.locked && <span className={styles.badgeLocked}>נוסחה מאושרת</span>}
                      {r.versionOf && <span className={styles.badgeVersion}>גרסה</span>}
                      {(r.tags ?? []).map((t) => (
                        <span key={t} className={styles.badgeTag}>
                          {t}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={styles.cardChevron} aria-hidden="true">
                    <ChevronIcon width={ICON_STROKE.menu} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
