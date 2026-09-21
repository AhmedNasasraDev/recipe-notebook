// One production plan (stage-9 requirements 1-14).
//
// HOW THIS SCREEN IS PUT TOGETHER, and why it is one screen with sections
//
// Requirement 12 asks for products, quantities, materials, a purchase list, a
// cost and a timeline, and warns against overloading one screen. They are all
// views of ONE calculation — change "60 cookies" to "120" and every one of
// them moves — so they live together, each behind its own disclosure, with the
// product list always open. On a phone that reads as a short page with five
// headings rather than five screens to navigate between while planning.
//
// WHAT IS COMPUTED AND WHAT IS STORED (requirement 14)
//
// Stored: the date, the products, the quantities, the ready times, the notes,
// and what the user says is already in the store room. Nothing else.
// Computed, every time, from the recipes and the ingredient centre: the scale
// factors, the material requirements, the purchase list, the cost and the
// timeline. So a plan opened next week costs next week's prices.
//
// The exception is a plan marked DONE. Then it is a record of what happened,
// and a record whose costs move is not a record — `setPlanLocked` freezes the
// purchase list and this screen reads the frozen one. The banner says so.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import {
  compute,
  formatGrams,
  formatNis,
  type Computed,
  type Recipe,
} from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import {
  PLAN_QTY_UNITS,
  type PlanItem,
  type ProductionPlan,
} from '../features/planning/plan.js';
import { explode, scaleItems } from '../features/planning/explode.js';
import {
  purchaseList,
  readSnapshot,
  snapshotOf,
} from '../features/planning/purchase.js';
import {
  KIND_LABEL,
  buildTimeline,
  whenLabel,
} from '../features/planning/timeline.js';
import type { PlanQtyUnit } from '../lib/database.types.js';
import styles from './PlanScreen.module.css';

/** The on-hand fields are held as STRINGS: '' must stay "not entered". */
type StockDraft = Record<string, string>;

const num = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const qty = (v: number | null, digits = 2): string =>
  v === null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits);

const money = (v: number | null): string => (v === null ? '—' : formatNis(v));

let seq = 0;
const newItem = (): PlanItem => ({
  id: `new-${(seq += 1)}`,
  recipeId: '',
  qty: 1,
  qtyUnit: 'unit',
  readyAt: null,
  note: '',
});

export function PlanScreen() {
  const { planId } = useParams();
  const {
    recipes,
    catalog,
    prefs,
    getPlan,
    savePlan,
    setPlanLocked,
    capabilities,
  } = useAppData();

  const [plan, setPlan] = useState<ProductionPlan | null>(null);
  const [stock, setStock] = useState<StockDraft>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ products: true });

  const canWrite = capabilities.canWrite && plan !== null && !plan.locked;

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const found = await getPlan(planId);
      if (!found) {
        setLoadError('התוכנית לא נמצאה.');
        return;
      }
      setPlan(found);
      setStock(
        Object.fromEntries(Object.entries(found.onHand).map(([k, v]) => [k, String(v)])),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'טעינת התוכנית נכשלה.');
    }
  }, [planId, getPlan]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every recipe with its central prices resolved, exactly as the recipe screen
  // does it — so a plan's costs are the same numbers the recipe page shows.
  const priced = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );

  const computeAt = useCallback(
    (recipe: Recipe, factor: number): Computed =>
      compute(recipe, priced, { factor, prefs }),
    [priced, prefs],
  );

  const onHandNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(stock)) {
      const n = num(raw);
      // An empty field is NOT a key with 0: it is a key that is not here.
      if (n !== null) out[key] = n;
    }
    return out;
  }, [stock]);

  const scaled = useMemo(
    () => (plan ? scaleItems(plan.items, priced, prefs, computeAt) : []),
    [plan, priced, prefs, computeAt],
  );
  const exploded = useMemo(() => explode(scaled), [scaled]);
  const live = useMemo(
    () => purchaseList(exploded.lines, catalog, onHandNumbers, prefs),
    [exploded.lines, catalog, onHandNumbers, prefs],
  );
  const timeline = useMemo(
    () => (plan ? buildTimeline(scaled, priced, plan.planDate, prefs) : null),
    [plan, scaled, priced, prefs],
  );

  // A locked plan reads its frozen list. One rule, no middle ground.
  const frozen = useMemo(
    () => (plan?.locked ? readSnapshot(plan.snapshot) : null),
    [plan],
  );

  const patch = (fields: Partial<ProductionPlan>) =>
    setPlan((p) => (p ? { ...p, ...fields } : p));

  const patchItem = (id: string, fields: Partial<PlanItem>) =>
    setPlan((p) =>
      p
        ? { ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...fields } : i)) }
        : p,
    );

  const onSave = async () => {
    if (!plan) return;
    setProblem(null);
    const bad = plan.items.find((i) => !i.recipeId);
    if (bad) {
      setProblem('לכל שורה בתוכנית צריך לבחור מתכון.');
      return;
    }
    const nonPositive = plan.items.find((i) => !(i.qty > 0));
    if (nonPositive) {
      setProblem('כמות היעד של כל שורה חייבת להיות גדולה מאפס.');
      return;
    }
    setBusy(true);
    try {
      const saved = await savePlan({ ...plan, onHand: onHandNumbers });
      setPlan(saved);
      setStock(
        Object.fromEntries(Object.entries(saved.onHand).map(([k, v]) => [k, String(v)])),
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'השמירה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onLock = async (lock: boolean) => {
    if (!plan) return;
    setProblem(null);
    setBusy(true);
    try {
      await setPlanLocked(
        plan.id,
        lock,
        lock ? snapshotOf(live, new Date().toISOString()) : null,
      );
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שינוי מצב התוכנית נכשל.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  /*
    STAGE-11: both of these branches rendered without a heading, so a plan that
    could not be loaded produced the only page in the app with no <h1> — a
    screen reader landing on it had nothing to announce, and the crawl that
    walks every route found it by the empty heading. The message and the way
    out were already right; only the title was missing.
  */
  if (loadError) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>תוכנית ייצור</h1>
        </header>
        <p className={styles.error} role="alert">
          {loadError}
        </p>
        <BackControl>התוכניות</BackControl>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>תוכנית ייצור</h1>
        </header>
        <p className={styles.empty} role="status">
          טוען…
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <BackControl>התוכניות</BackControl>
        <h1 className={styles.title}>{plan.name || 'תוכנית ייצור'}</h1>
        <p className={styles.lede}>
          כל מה שמתחת מחושב מהמתכונים ומהמחירים שבמרכז חומרי הגלם. בתוכנית עצמה
          נשמרים רק התאריך, המוצרים, הכמויות ומה שכבר יש במחסן.
        </p>
      </header>

      {plan.locked && (
        <p className={styles.locked} role="status" aria-label="התוכנית סומנה כבוצעה">
          התוכנית סומנה כבוצעה, ולכן רשימת הרכש והעלות מוצגות כפי שהיו באותו רגע
          ולא לפי המחירים של היום. לעריכה יש לבטל את הסימון — הביטול מוחק את
          הצילום.
        </p>
      )}

      {!capabilities.canWrite && (
        <p className={styles.notice} role="status">
          אין כרגע חיבור לחשבון, ולכן אי אפשר לשנות את התוכנית.
        </p>
      )}

      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}

      {/* ── the plan's own fields ─────────────────────────────────────── */}
      <section className={styles.card} aria-label="פרטי התוכנית">
        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pl-name">
              שם התוכנית
            </label>
            <input
              id="pl-name"
              className={styles.input}
              value={plan.name}
              onChange={(e) => patch({ name: e.target.value })}
              disabled={!canWrite}
              aria-label="שם התוכנית"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pl-date">
              תאריך הייצור
            </label>
            <input
              id="pl-date"
              type="date"
              className={`${styles.input} ltr`}
              value={plan.planDate}
              onChange={(e) => patch({ planDate: e.target.value })}
              disabled={!canWrite}
              aria-label="תאריך הייצור"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pl-note">
              הערה
            </label>
            <input
              id="pl-note"
              className={styles.input}
              value={plan.note}
              onChange={(e) => patch({ note: e.target.value })}
              disabled={!canWrite}
              aria-label="הערה על התוכנית"
            />
          </div>
        </div>
      </section>

      {/* ── requirement 1: the products ───────────────────────────────── */}
      <section className={styles.card} aria-label="מוצרים לייצור">
        <h2 className={styles.cardTitle}>מה מייצרים</h2>

        {plan.items.length === 0 && (
          <p className={styles.empty}>
            אין עדיין מוצרים. מוסיפים מתכון וכמות יעד, והמערכת מחשבת פי כמה
            להגדיל אותו.
          </p>
        )}

        <ul className={styles.rows}>
          {plan.items.map((item, idx) => {
            const s = scaled[idx];
            return (
              <li key={item.id} className={styles.row}>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`pi-r-${item.id}`}>
                      מתכון
                    </label>
                    <select
                      id={`pi-r-${item.id}`}
                      className={styles.input}
                      value={item.recipeId}
                      onChange={(e) => patchItem(item.id, { recipeId: e.target.value })}
                      disabled={!canWrite}
                      aria-label={`מתכון לשורה ${idx + 1}`}
                    >
                      <option value="">— בחירת מתכון —</option>
                      {recipes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {String(r.name ?? '')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`pi-q-${item.id}`}>
                      כמות יעד
                    </label>
                    <input
                      id={`pi-q-${item.id}`}
                      className={`${styles.input} ltr`}
                      inputMode="decimal"
                      value={String(item.qty)}
                      onChange={(e) =>
                        patchItem(item.id, { qty: Number(e.target.value) || 0 })
                      }
                      disabled={!canWrite}
                      aria-label={`כמות יעד לשורה ${idx + 1}`}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`pi-u-${item.id}`}>
                      יחידת יעד
                    </label>
                    <select
                      id={`pi-u-${item.id}`}
                      className={styles.input}
                      value={item.qtyUnit}
                      onChange={(e) =>
                        patchItem(item.id, { qtyUnit: e.target.value as PlanQtyUnit })
                      }
                      disabled={!canWrite}
                      aria-label={`יחידת יעד לשורה ${idx + 1}`}
                    >
                      {PLAN_QTY_UNITS.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`pi-t-${item.id}`}>
                      שעת מוכנות
                    </label>
                    <input
                      id={`pi-t-${item.id}`}
                      type="time"
                      className={`${styles.input} ltr`}
                      value={item.readyAt ?? ''}
                      onChange={(e) =>
                        patchItem(item.id, { readyAt: e.target.value || null })
                      }
                      disabled={!canWrite}
                      aria-label={`שעת מוכנות לשורה ${idx + 1}`}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`pi-n-${item.id}`}>
                      הערה
                    </label>
                    <input
                      id={`pi-n-${item.id}`}
                      className={styles.input}
                      value={item.note}
                      onChange={(e) => patchItem(item.id, { note: e.target.value })}
                      disabled={!canWrite}
                      aria-label={`הערה לשורה ${idx + 1}`}
                    />
                  </div>
                </div>

                {/* The scale factor, and the recipe's own yield beside it. */}
                <p
                  className={styles.factor}
                  role="status"
                  aria-label={`חישוב הכמות לשורה ${idx + 1}`}
                >
                  {s && s.scaled.factor !== null ? (
                    <>
                      {`פי ${qty(s.scaled.factor, 3)} מהמתכון`}
                      {s.scaled.recipeUnits !== null && (
                        <span className={styles.factorNote}>
                          {` · המתכון מפיק ${qty(s.scaled.recipeUnits, 1)} יחידות`}
                        </span>
                      )}
                      {s.scaled.recipeGrams !== null && (
                        <span className={styles.factorNote}>
                          {` · ${formatGrams(s.scaled.recipeGrams)}`}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={styles.missing}>
                      {s?.scaled.why || 'אי אפשר לחשב את הכמות לשורה הזאת.'}
                    </span>
                  )}
                </p>

                {canWrite && (
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() =>
                      patch({ items: plan.items.filter((x) => x.id !== item.id) })
                    }
                    aria-label={`הסרת שורה ${idx + 1}`}
                  >
                    הסרה
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => patch({ items: [...plan.items, newItem()] })}
            disabled={!canWrite}
            aria-label="הוספת מוצר לתוכנית"
          >
            <span aria-hidden="true">+ </span>מוצר
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void onSave()}
            disabled={busy || !canWrite}
            aria-label="שמירת התוכנית"
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void onLock(!plan.locked)}
            disabled={busy || !capabilities.canWrite}
            aria-label={plan.locked ? 'ביטול סימון הביצוע' : 'סימון התוכנית כבוצעה'}
          >
            {plan.locked ? 'ביטול סימון הביצוע' : 'סימון כבוצעה'}
          </button>
        </div>
      </section>

      {/* ── requirement 3: the materials, down to the base ingredients ── */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => toggle('materials')}
          aria-expanded={open['materials'] === true}
        >
          {open['materials'] ? 'סגירת חומרי הגלם' : 'חומרי גלם נדרשים'}
        </button>

        {open['materials'] && (
          <div className={styles.block} aria-label="חומרי גלם נדרשים">
            <p className={styles.hint}>
              תת־מתכונים מפורקים עד לחומרי הגלם הבסיסיים: בצק אינו מופיע כאן,
              אלא הקמח, החמאה והסוכר שבתוכו. אותו חומר גלם שמופיע בכמה מוצרים
              מופיע פעם אחת, עם הסכום הכולל.
            </p>
            {exploded.lines.length === 0 ? (
              <p className={styles.empty}>אין עדיין חומרי גלם לחשב.</p>
            ) : (
              <ul className={styles.plainList}>
                {exploded.lines.map((l) => (
                  <li key={l.key} className={styles.needRow}>
                    <span className={styles.needName}>{l.name}</span>
                    <span className={`${styles.needQty} ltr`}>
                      {formatGrams(l.grams)}
                    </span>
                    <span className={styles.needWho}>{l.products.join(' · ')}</span>
                    {l.partial && (
                      <span className={styles.missing}>· חלקי</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(exploded.problems.length > 0 || exploded.unresolved.length > 0) && (
              <div className={styles.warnBox} aria-label="מה חסר בחישוב חומרי הגלם">
                {exploded.problems.map((p) => (
                  <p key={p.product}>
                    {p.product}: {p.why}
                  </p>
                ))}
                {exploded.unresolved.length > 0 && (
                  <p>
                    שורות שאי אפשר לשקול, ולכן אינן בסכום:{' '}
                    {exploded.unresolved.join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── requirements 4-7: the purchase list ───────────────────────── */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => toggle('purchase')}
          aria-expanded={open['purchase'] === true}
        >
          {open['purchase'] ? 'סגירת רשימת הרכש' : 'רשימת רכש ועלות צפויה'}
        </button>

        {open['purchase'] && (
          <div className={styles.block} aria-label="רשימת רכש">
            <p className={styles.hint}>
              &quot;כמה צריך לייצור&quot; ו&quot;כמה צריך לקנות&quot; הם שני
              מספרים שונים. כמות המתכון לא מעוגלת כדי להתאים לאריזה — האריזה
              מעוגלת כלפי מעלה, והעודף מוצג.
            </p>

            {frozen ? (
              <ul className={styles.plainList}>
                {frozen.lines.map((l) => (
                  <li key={l.key} className={styles.buyRow}>
                    <span className={styles.needName}>{l.name}</span>
                    <span className={`${styles.needQty} ltr`}>
                      {`${qty(l.required)} ${l.unit ?? ''}`}
                    </span>
                    <span className={`${styles.needWho} ltr`}>
                      {l.packages !== null
                        ? `${l.packages} × ${qty(l.buyQty !== null && l.packages ? l.buyQty / l.packages : null)}`
                        : qty(l.toBuy)}
                    </span>
                    <span className={`${styles.needQty} ltr`}>{money(l.cost)}</span>
                  </li>
                ))}
              </ul>
            ) : live.lines.length === 0 ? (
              <p className={styles.empty}>אין עדיין מה לקנות.</p>
            ) : (
              <ul className={styles.plainList}>
                {live.lines.map((l) => (
                  <li key={l.key} className={styles.buyLine}>
                    <div className={styles.buyHead}>
                      <span className={styles.needName}>{l.name}</span>
                      {!l.inCatalog && (
                        <Link to="/ingredients" className={styles.missing}>
                          אינו במרכז חומרי הגלם
                        </Link>
                      )}
                    </div>

                    <dl className={styles.buyGrid}>
                      <div className={styles.buyCell}>
                        <dt>נדרש לייצור</dt>
                        <dd className="ltr">
                          {l.required === null
                            ? formatGrams(l.grams)
                            : `${qty(l.required)} ${l.unit}`}
                        </dd>
                      </div>
                      {l.usablePct !== null && (
                        <div className={styles.buyCell}>
                          <dt>{`נדרש לקנייה (ניצולת ${l.usablePct}%)`}</dt>
                          <dd className="ltr">{`${qty(l.requiredPurchase)} ${l.unit}`}</dd>
                        </div>
                      )}
                      <div className={styles.buyCell}>
                        <dt>יש במחסן</dt>
                        <dd>
                          <input
                            className={`${styles.stockInput} ltr`}
                            inputMode="decimal"
                            value={stock[l.key] ?? ''}
                            onChange={(e) =>
                              setStock((st) => ({ ...st, [l.key]: e.target.value }))
                            }
                            disabled={!canWrite}
                            aria-label={`כמות שיש במחסן מ${l.name}`}
                          />
                        </dd>
                      </div>
                      <div className={styles.buyCell}>
                        <dt>צריך לקנות</dt>
                        <dd className="ltr" aria-label={`צריך לקנות ${l.name}`}>
                          {l.toBuy === null ? '—' : `${qty(l.toBuy)} ${l.unit}`}
                        </dd>
                      </div>
                      {l.packages !== null && l.packageQty !== null && (
                        <>
                          <div className={styles.buyCell}>
                            <dt>הצעת רכישה</dt>
                            <dd className="ltr" aria-label={`הצעת רכישה ל${l.name}`}>
                              {`${l.packages} × ${qty(l.packageQty)} ${l.unit} = ${qty(l.buyQty)} ${l.unit}`}
                            </dd>
                          </div>
                          <div className={styles.buyCell}>
                            <dt>עודף צפוי</dt>
                            <dd className="ltr">{`${qty(l.remainder)} ${l.unit}`}</dd>
                          </div>
                        </>
                      )}
                      <div className={styles.buyCell}>
                        <dt>עלות צפויה</dt>
                        <dd className="ltr" aria-label={`עלות צפויה ל${l.name}`}>
                          {money(l.cost)}
                        </dd>
                      </div>
                    </dl>

                    {l.onHand === null && (
                      <p className={styles.hint}>
                        לא הוזנה כמות במחסן, ולכן מוצגת הדרישה המלאה. שדה ריק
                        אינו אפס.
                      </p>
                    )}
                    {l.why && <p className={styles.missing}>{l.why}</p>}
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.totalRow} aria-label="עלות הרכש">
              <span>עלות רשימת הרכש</span>
              <span className="ltr" aria-label="סכום עלות הרכש">
                {money(frozen ? frozen.total : live.total)}
              </span>
            </div>
            {(frozen ? frozen.why : live.why) && (
              <p className={styles.warnBox} role="status" aria-label="למה העלות אינה מלאה">
                {frozen ? frozen.why : live.why}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── requirements 8-11: the timeline ───────────────────────────── */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => toggle('timeline')}
          aria-expanded={open['timeline'] === true}
        >
          {open['timeline'] ? 'סגירת סדר העבודה' : 'סדר עבודה ולוח זמנים'}
        </button>

        {open['timeline'] && timeline && (
          <div className={styles.block} aria-label="לוח זמנים">
            <p className={styles.hint}>
              החישוב נעשה לאחור משעת המוכנות, וממשיך אל היום שלפני כשצריך. אין
              כאן אופטימיזציה של כוח אדם או ציוד: פעילויות שחופפות מוצגות
              כחופפות ואינן מוזזות.
            </p>

            {timeline.products.map((p) => (
              <div key={p.recipeId} className={styles.product}>
                <h3 className={styles.productName}>
                  {p.product}
                  <span className={styles.factorNote}>
                    {p.readyAt
                      ? ` · מוכן ב-${whenLabel(p.readyAt)}`
                      : ' · לא הוגדרה שעת מוכנות'}
                  </span>
                </h3>
                {p.startsAt && (
                  <p className={styles.startNote}>
                    {`מתחילים ב-${whenLabel(p.startsAt)}`}
                  </p>
                )}
                {p.dependencies.length > 0 && (
                  <p className={styles.hint}>
                    {`תלוי בתת־מתכונים: ${p.dependencies
                      .map((d) => d.name)
                      .join(' · ')} — כל אחד מהם צריך להיות מוכן לפני השלב הראשון של ${p.product}.`}
                  </p>
                )}
                <ul className={styles.plainList}>
                  {p.steps.map((s) => (
                    <li key={`${s.recipeId}-${s.ord}-${s.forProduct ?? ''}`} className={styles.stepRow}>
                      <span className={`${styles.stepWhen} ltr`}>
                        {whenLabel(s.start)}
                      </span>
                      <span className={styles.stepText}>
                        {s.forProduct && (
                          <span className={styles.factorNote}>{`[${s.product}] `}</span>
                        )}
                        {s.text || '(שלב בלי תיאור)'}
                      </span>
                      <span className={styles.stepKind}>
                        {s.kind === null
                          ? 'לא מסווג'
                          : KIND_LABEL[s.kind] +
                            (s.kindSource === 'temperature' ? ' (לפי הטמפרטורה)' : '')}
                      </span>
                      <span className={`${styles.stepMin} ltr`}>
                        {s.minutes === null ? '—' : `${s.minutes} דק׳`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {timeline.problems.length > 0 && (
              <div className={styles.warnBox} aria-label="מה חסר בלוח הזמנים">
                <p className={styles.missing}>לוח הזמנים חלקי:</p>
                {[...new Set(timeline.problems)].map((w) => (
                  <p key={w}>· {w}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className={styles.actions}>
        <BackControl aria-label="חזרה לרשימת התוכניות">
          התוכניות
        </BackControl>
      </div>
    </div>
  );
}
