// The ingredient centre (stage-7 requirements 1-5, stage-8 requirements A-D).
//
// One place where a material is managed, and the only place its ACTIVE price
// exists. What this screen is careful about:
//
// 1. IT ASKS WHAT WAS BOUGHT, IN THE SHAPE IT WAS BOUGHT. Not "price per kilo"
//    — a total paid, a number of packages, and what is in one package. Six
//    packs of 500 g for ₪72 is entered as 6, 500, 72, and the ₪24/kg is
//    DERIVED and shown back. Nobody does that division at the counter, and a
//    user who has to do it will do it wrong.
//
// 2. AN UNPRICED MATERIAL IS NOT A FREE ONE. An empty price field stays empty
//    and the material reports "no price"; a typed 0 is a real price of zero.
//    The numeric fields are held as STRINGS for exactly that reason — the same
//    device the recipe form uses, because '' → null and '0' → 0 is a
//    distinction that a `number | undefined` field cannot keep.
//
// 3. A PRICE CHANGE IS AN EVENT, NOT AN OVERWRITE (requirement C). Changing
//    what was bought records a PURCHASE: the history keeps the old price, the
//    date and the supplier, and the active price moves in the same
//    transaction. Editing only a name or an allergen is not a purchase and
//    does not pretend to be one.
//
// 4. PURCHASE COST IS NOT USABLE COST (requirement D). A 10 kg box of celery
//    for ₪200 that yields 8 kg usable costs ₪25 per usable kilo, not ₪20. The
//    yield is OPTIONAL — an empty field means nobody has declared one, and
//    then the two costs are the same number rather than zero.
//
// 5. CHANGING A PRICE SAYS WHAT IT MOVES. Requirement 5 of stage 7: the user
//    sees which recipes are affected, from `recipes_pricing_on` — which counts
//    only the lines that INHERIT the price, because a line with its own price
//    does not move and claiming it does would be wrong.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatNis, ingredientKeyOf } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import {
  PURCHASE_UNITS,
  basePriceOf,
  conversionsOf,
  purchaseUnitLabel,
  suggestedAllergens,
  type CatalogItem,
} from '../features/pricing/catalog.js';
import {
  changeWord,
  formatPct,
  type PurchaseRecord,
} from '../features/pricing/purchases.js';
import type { PurchaseUnit } from '../lib/database.types.js';
import { DeleteIcon, EditIcon, SearchIcon } from '../shell/Icons.js';
import styles from './IngredientsScreen.module.css';

/** The form, held as strings so an empty field can stay empty. */
interface Draft {
  key: string;
  name: string;
  purchaseUnit: PurchaseUnit;
  packageCount: string;
  packageQty: string;
  purchaseTotal: string;
  usablePct: string;
  supplier: string;
  purchasedAt: string;
  note: string;
  allergens: string[];
}

const today = (): string => new Date().toISOString().slice(0, 10);

const emptyDraft = (): Draft => ({
  key: '',
  name: '',
  purchaseUnit: 'kg',
  // One package is the common case and is a fact, not a guess: "5 kg for ₪200"
  // is one package of 5 kg. The user changes it when they bought several.
  packageCount: '1',
  packageQty: '',
  purchaseTotal: '',
  usablePct: '',
  supplier: '',
  purchasedAt: today(),
  note: '',
  allergens: [],
});

const draftOf = (item: CatalogItem): Draft => ({
  key: item.key,
  name: item.name,
  purchaseUnit: item.purchaseUnit,
  packageCount: String(item.packageCount ?? 1),
  // null becomes '', which is what keeps "unknown" out of the numbers.
  packageQty: item.packageQty === null ? '' : String(item.packageQty),
  purchaseTotal: item.purchaseTotal === null ? '' : String(item.purchaseTotal),
  usablePct: item.usablePct === null ? '' : String(item.usablePct),
  supplier: item.supplier,
  purchasedAt: item.purchasedAt ?? today(),
  note: item.note,
  allergens: [...item.allergens],
});

/** '' → null, '0' → 0. The whole reason the draft holds strings. */
const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const when = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

/** How old a price is, in words. A three-month-old cost basis is a risk. */
const ageNote = (iso: string | null): string => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return '';
  if (days === 0) return 'עודכן היום';
  if (days === 1) return 'עודכן אתמול';
  if (days < 30) return `עודכן לפני ${days} ימים`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'עודכן לפני חודש' : `עודכן לפני ${months} חודשים`;
};

/** How a purchase reads back: "6 × 500 גרם ב-₪72". */
const packWords = (
  count: number,
  qty: number | null,
  unit: PurchaseUnit,
  total: number | null,
): string => {
  if (qty === null || total === null) return '';
  const amount = count > 1 ? `${count} × ${qty}` : String(qty);
  return `${amount} ${purchaseUnitLabel(unit)} ב-${formatNis(total)}`;
};

/**
 * Did the PURCHASE change, as opposed to the name or an allergen?
 *
 * Requirement C hangs on this answer. A changed purchase is an event that must
 * be recorded with its date and supplier; a corrected spelling is not, and
 * appending a purchase for it would fill the history with prices that were
 * never paid.
 */
function purchaseChanged(draft: Draft, item: CatalogItem | undefined): boolean {
  if (!item) return true;
  return (
    draft.purchaseUnit !== item.purchaseUnit ||
    numOrNull(draft.packageCount) !== item.packageCount ||
    numOrNull(draft.packageQty) !== item.packageQty ||
    numOrNull(draft.purchaseTotal) !== item.purchaseTotal ||
    numOrNull(draft.usablePct) !== item.usablePct ||
    draft.supplier.trim() !== item.supplier ||
    // The date counts only for a material that already HAS one. A row created
    // before purchases were recorded has none, and the form shows today's
    // date by default — treating that as a change would append a purchase
    // that never happened every time someone fixed a spelling.
    (item.purchasedAt !== null && (draft.purchasedAt || null) !== item.purchasedAt)
  );
}

export function IngredientsScreen() {
  const {
    catalog,
    saveCatalogItem,
    deleteCatalogItem,
    recipesPricingOn,
    recordPurchase,
    purchaseHistory,
    capabilities,
  } = useAppData();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [affected, setAffected] = useState<
    Array<{ id: string; name: string; rows: number; overridden: number }>
  >([]);
  const [history, setHistory] = useState<readonly PurchaseRecord[]>([]);

  const canWrite = capabilities.canWrite;
  /*
    §10 asks for a search on this screen, and it had none: the list is every
    material the kitchen has ever priced, sorted by name, and on a real
    catalogue finding "חמאה 82%" meant scrolling past forty rows.

    It filters the LIST and nothing else — no request, no reordering by
    relevance, no hiding of anything that matches. An empty box is the whole
    catalogue, which is what the screen was before.
  */
  const [query, setQuery] = useState('');

  const sorted = useMemo(
    () => {
      const q = query.trim().toLowerCase();
      const rows = q === ''
        ? [...catalog]
        : catalog.filter((c) => c.name.toLowerCase().includes(q));
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    },
    [catalog, query],
  );

  const current = useMemo(
    () => catalog.find((c) => c.key === editing),
    [catalog, editing],
  );

  // What the price WILL be, from what is typed. Shown live, so the user sees
  // ₪40 לק"ג while typing "5" and "200" and can tell they got it right.
  const derived = useMemo(
    () =>
      basePriceOf({
        purchaseUnit: draft.purchaseUnit,
        packageQty: numOrNull(draft.packageQty),
        packageCount: numOrNull(draft.packageCount),
        purchaseTotal: numOrNull(draft.purchaseTotal),
        usablePct: numOrNull(draft.usablePct),
      }),
    [
      draft.purchaseUnit,
      draft.packageQty,
      draft.packageCount,
      draft.purchaseTotal,
      draft.usablePct,
    ],
  );

  const loadAffected = useCallback(
    async (key: string) => {
      setAffected(key ? await recipesPricingOn(key) : []);
    },
    [recipesPricingOn],
  );

  const loadHistory = useCallback(
    async (key: string) => {
      setHistory(key ? await purchaseHistory(key) : []);
    },
    [purchaseHistory],
  );

  useEffect(() => {
    if (editing) {
      void loadAffected(editing);
      void loadHistory(editing);
    } else {
      setAffected([]);
      setHistory([]);
    }
  }, [editing, loadAffected, loadHistory]);

  const startNew = () => {
    setEditing('');
    setDraft(emptyDraft());
    setProblem(null);
  };

  const startEdit = (item: CatalogItem) => {
    setEditing(item.key);
    setDraft(draftOf(item));
    setProblem(null);
  };

  const onSave = async () => {
    setProblem(null);
    const name = draft.name.trim();
    if (!name) {
      setProblem('לחומר גלם חייב להיות שם.');
      return;
    }
    const count = numOrNull(draft.packageCount);
    if (count === null || count <= 0) {
      setProblem('מספר האריזות חייב להיות גדול מאפס.');
      return;
    }
    const qty = numOrNull(draft.packageQty);
    if (qty !== null && qty <= 0) {
      setProblem('הכמות באריזה חייבת להיות גדולה מאפס. אריזה של כלום אינה מחיר.');
      return;
    }
    const total = numOrNull(draft.purchaseTotal);
    if (total !== null && total < 0) {
      setProblem('סכום הרכישה אינו יכול להיות שלילי.');
      return;
    }
    const usable = numOrNull(draft.usablePct);
    if (usable !== null && (usable <= 0 || usable > 100)) {
      setProblem(
        'אחוז הניצולת צריך להיות גדול מאפס ועד 100. ניצולת של 0 פירושה שלא נשאר כלום, ואין לה עלות לחשב.',
      );
      return;
    }

    const key = draft.key.trim() || ingredientKeyOf({ name });
    setBusy(true);
    try {
      if (purchaseChanged(draft, current)) {
        // A purchase. Appended to the history and applied to the active price
        // in ONE transaction, so the two can never disagree.
        await recordPurchase({
          key,
          name,
          purchaseUnit: draft.purchaseUnit,
          packageCount: count,
          packageQty: qty,
          purchaseTotal: total,
          usablePct: usable,
          supplier: draft.supplier.trim(),
          purchasedAt: draft.purchasedAt || null,
          note: draft.note.trim(),
        });
      } else {
        // Not a purchase — a correction. No history row, because no money
        // changed hands.
        await saveCatalogItem({
          id: current?.id ?? '',
          // The identity is the engine's own, so a recipe row written as
          // "חמאה 82% " matches the material "חמאה 82%" — the same key
          // calibration matching uses (B4).
          key,
          name,
          purchaseUnit: draft.purchaseUnit,
          packageQty: qty,
          packageCount: count,
          purchaseTotal: total,
          usablePct: usable,
          supplier: draft.supplier.trim(),
          purchasedAt: draft.purchasedAt || null,
          priceUpdatedAt: null,
          note: draft.note.trim(),
          // Ignored by the repository: the database derives them.
          purchasePrice: null,
          price: null,
          priceUnit: null,
          allergens: draft.allergens,
        });
      }
      setEditing(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'השמירה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (key: string) => {
    setProblem(null);
    setBusy(true);
    try {
      await deleteCatalogItem(key);
      setConfirmDelete(null);
      if (editing === key) setEditing(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'המחיקה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const suggestions = useMemo(
    () => suggestedAllergens(draft.name).filter((a) => !draft.allergens.includes(a)),
    [draft.name, draft.allergens],
  );

  const unitDef = PURCHASE_UNITS.find((u) => u.id === draft.purchaseUnit)!;
  const hasYield = derived !== null && numOrNull(draft.usablePct) !== null;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>חומרי גלם</h1>
        <p className={styles.lede}>
          המחיר של כל חומר גלם נמצא כאן, במקום אחד. שינוי מחיר כאן משנה את העלות
          בכל המתכונים שמשתמשים בו ולא הוזן בהם מחיר אחר.
        </p>
      </header>

      {!canWrite && (
        <p className={styles.notice} role="status">
          אין כרגע חיבור לחשבון, ולכן אי אפשר להוסיף או לשנות חומרי גלם.
        </p>
      )}

      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}

      {editing === null ? (
        <button
          type="button"
          className={styles.addBtn}
          onClick={startNew}
          disabled={!canWrite}
          aria-label="הוספת חומר גלם"
        >
          <span aria-hidden="true">+ </span>חומר גלם חדש
        </button>
      ) : (
        <section
          className={styles.form}
          /*
            Named for what it IS, not for the material. `עריכת חמאה 82%` is
            already the list button's name, and two different things with one
            accessible name is a dead end for anyone navigating by name.
          */
          aria-label={editing ? `טופס חומר גלם: ${draft.name || 'ללא שם'}` : 'טופס חומר גלם חדש'}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ic-name">
              שם חומר הגלם
            </label>
            <input
              id="ic-name"
              className={styles.input}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              aria-label="שם חומר הגלם"
            />
          </div>

          <p className={styles.hint}>
            מזינים את הרכישה כפי שהיא נעשתה: כמה שולם בסך הכול, כמה אריזות, ומה
            יש בכל אריזה. המחיר ליחידה מחושב כאן ואין צורך לחשב אותו.
          </p>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-unit">
                יחידת רכישה
              </label>
              <select
                id="ic-unit"
                className={styles.select}
                value={draft.purchaseUnit}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, purchaseUnit: e.target.value as PurchaseUnit }))
                }
                aria-label="יחידת רכישה"
              >
                {PURCHASE_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {purchaseUnitLabel(u.id)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-count">
                מספר אריזות
              </label>
              <input
                id="ic-count"
                className={`${styles.input} ltr`}
                inputMode="decimal"
                value={draft.packageCount}
                onChange={(e) => setDraft((d) => ({ ...d, packageCount: e.target.value }))}
                aria-label="מספר אריזות"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-qty">
                {unitDef.qtyLabel}
              </label>
              <input
                id="ic-qty"
                className={`${styles.input} ltr`}
                inputMode="decimal"
                value={draft.packageQty}
                onChange={(e) => setDraft((d) => ({ ...d, packageQty: e.target.value }))}
                aria-label="כמות באריזה"
              />
            </div>
          </div>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-total">
                סה&quot;כ ששולם ₪
              </label>
              <input
                id="ic-total"
                className={`${styles.input} ltr`}
                inputMode="decimal"
                value={draft.purchaseTotal}
                onChange={(e) => setDraft((d) => ({ ...d, purchaseTotal: e.target.value }))}
                aria-label="סך הכול ששולם"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-usable">
                ניצולת %, אם יש פחת
              </label>
              <input
                id="ic-usable"
                className={`${styles.input} ltr`}
                inputMode="decimal"
                value={draft.usablePct}
                onChange={(e) => setDraft((d) => ({ ...d, usablePct: e.target.value }))}
                aria-label="אחוז ניצולת"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-date">
                תאריך הרכישה
              </label>
              <input
                id="ic-date"
                type="date"
                className={`${styles.input} ltr`}
                value={draft.purchasedAt}
                onChange={(e) => setDraft((d) => ({ ...d, purchasedAt: e.target.value }))}
                aria-label="תאריך הרכישה"
              />
            </div>
          </div>

          {/* The derived figures, live. Never typed, never stored by the client. */}
          <div className={styles.derived} role="status" aria-label="מחיר מחושב מהרכישה">
            {derived ? (
              <>
                <p className={styles.derivedMain}>
                  {`${formatNis(derived.price)} ל${derived.unit}`}
                  {hasYield && <span className={styles.derivedTag}> (לפי הניצולת)</span>}
                </p>
                <ul className={styles.conversions} aria-label="המחיר בקנה מידה אחר">
                  {conversionsOf(derived.price, derived.unit).map((c) => (
                    <li key={c.label} className="ltr">
                      {`${formatNis(c.value)} / ${c.label}`}
                    </li>
                  ))}
                </ul>
                {hasYield && (
                  <p className={styles.yieldNote}>
                    {`עלות הקנייה ${formatNis(derived.purchase)} ל${derived.unit}, ` +
                      `אבל אחרי הפחת העלות האמיתית של מה שנכנס למתכון היא ` +
                      `${formatNis(derived.price)} ל${derived.unit}.`}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.derivedMain}>
                אין עדיין מחיר — צריך גם כמות באריזה וגם סכום ששולם. שדה ריק אינו
                אפס.
              </p>
            )}
          </div>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-supplier">
                ספק
              </label>
              <input
                id="ic-supplier"
                className={styles.input}
                value={draft.supplier}
                onChange={(e) => setDraft((d) => ({ ...d, supplier: e.target.value }))}
                aria-label="ספק"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ic-note">
                הערה
              </label>
              <input
                id="ic-note"
                className={styles.input}
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                aria-label="הערה על חומר הגלם"
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>אלרגנים</span>
            <div className={styles.chips} aria-label="אלרגנים של חומר הגלם">
              {draft.allergens.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={styles.chipOn}
                  onClick={() =>
                    setDraft((d) => ({ ...d, allergens: d.allergens.filter((x) => x !== a) }))
                  }
                  aria-label={`הסרת האלרגן ${a}`}
                >
                  {a} <span aria-hidden="true">×</span>
                </button>
              ))}
              {suggestions.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={styles.chipOff}
                  onClick={() => setDraft((d) => ({ ...d, allergens: [...d.allergens, a] }))}
                  aria-label={`הוספת האלרגן ${a}`}
                >
                  <span aria-hidden="true">+ </span>
                  {a}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              אלרגן שמסומן כאן נספר בכל מתכון שמשתמש בחומר הגלם הזה, בנוסף לזיהוי
              לפי השם.
            </p>
          </div>

          {/* Requirement C: the previous prices, and what changed. */}
          {history.length > 0 && (
            <div className={styles.affected} aria-label="היסטוריית רכישות">
              <p className={styles.affectedTitle}>
                {history.length === 1 ? 'רכישה אחת רשומה' : `${history.length} רכישות רשומות`}:
              </p>
              <ul className={styles.historyList}>
                {history.map((h) => (
                  <li key={h.id} className={styles.historyRow}>
                    <span className={styles.historyWhen}>{when(h.purchasedAt)}</span>
                    <span className={`${styles.historyPrice} ltr`}>
                      {h.price === null
                        ? 'בלי מחיר'
                        : `${formatNis(h.price)} / ${purchaseUnitLabel(h.purchaseUnit)}`}
                    </span>
                    {h.supplier && <span className={styles.historyWho}>{h.supplier}</span>}
                    <span className={styles.historyPack}>
                      {packWords(h.packageCount, h.packageQty, h.purchaseUnit, h.purchaseTotal)}
                    </span>
                    {h.pctChange !== null && h.prevPrice !== null && (
                      <span
                        className={styles.historyChange}
                        aria-label={`${changeWord(h.pctChange)} ב-${formatPct(Math.abs(h.pctChange))} לעומת ${formatNis(h.prevPrice)}`}
                      >
                        <span aria-hidden="true" className="ltr">
                          {formatPct(h.pctChange)}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>
                המחיר הפעיל הוא המחיר של הרכישה האחרונה. גרסאות היסטוריות של
                מתכונים ממשיכות להשתמש במחיר שהיה בזמן הגרסה.
              </p>
            </div>
          )}

          {/* Requirement 5 of stage 7: what this price change will move. */}
          {affected.length > 0 && (
            <div className={styles.affected} aria-label="מתכונים שהמחיר הזה משפיע עליהם">
              <p className={styles.affectedTitle}>
                {affected.length === 1
                  ? 'מתכון אחד מושפע מהמחיר הזה'
                  : `${affected.length} מתכונים מושפעים מהמחיר הזה`}
                :
              </p>
              <ul className={styles.affectedList}>
                {affected.map((r) => (
                  <li key={r.id}>
                    <Link to={`/recipe/${r.id}`}>{r.name}</Link>
                    {r.overridden > 0 && (
                      <span className={styles.affectedNote}>
                        {' '}
                        ({r.overridden === 1
                          ? 'שורה אחת שם עם מחיר משלה, שלא תשתנה'
                          : `${r.overridden} שורות שם עם מחיר משלהן, שלא ישתנו`})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void onSave()}
              disabled={busy || !canWrite}
              aria-label="שמירת חומר הגלם"
            >
              {busy ? 'שומר…' : 'שמירה'}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setEditing(null)}
              aria-label="ביטול העריכה"
            >
              ביטול
            </button>
          </div>
        </section>
      )}

      {catalog.length > 0 && (
        <div className={styles.searchRow}>
          <label className={styles.searchLabel} htmlFor="ing-search">
            <SearchIcon />
            חיפוש חומר גלם
          </label>
          <input
            id="ing-search"
            className={styles.search}
            type="search"
            autoComplete="off"
            value={query}
            placeholder="שם חומר הגלם"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {sorted.length === 0 ? (
        <p className={styles.empty}>
          {catalog.length === 0
            ? 'אין עדיין חומרי גלם. אחרי שיוזן חומר גלם עם רכישה ומחיר, כל מתכון שמשתמש בו יקבל את המחיר אוטומטית.'
            : `אין חומר גלם שהשם שלו מכיל "${query.trim()}". אפשר לנקות את החיפוש ולראות את כל הרשימה.`}
        </p>
      ) : (
        <ul className={styles.list} aria-label="רשימת חומרי הגלם">
          {sorted.map((item) => (
            <li key={item.key} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.itemName}>{item.name}</span>
                <span className={`${styles.itemPrice} ltr`}>
                  {item.price === null ? (
                    /* Not ₪0. A material nobody has priced has no price, and
                       showing 0 would put it into every cost as free. */
                    <span className={styles.noPrice} aria-label={`אין מחיר ל${item.name}`}>
                      אין מחיר
                    </span>
                  ) : (
                    `${formatNis(item.price)} ל${item.priceUnit}`
                  )}
                </span>
              </div>

              <p className={styles.itemMeta}>
                {item.packageQty !== null && item.purchaseTotal !== null && (
                  <span className={styles.itemPack}>
                    {packWords(
                      item.packageCount,
                      item.packageQty,
                      item.purchaseUnit,
                      item.purchaseTotal,
                    )}
                  </span>
                )}
                {item.usablePct !== null && item.purchasePrice !== null && (
                  <span>
                    {` · ניצולת ${item.usablePct}% — עלות קנייה ${formatNis(item.purchasePrice)} ל${item.priceUnit}`}
                  </span>
                )}
                {item.supplier && <span> · {item.supplier}</span>}
                {item.priceUpdatedAt && (
                  <span title={when(item.priceUpdatedAt)}> · {ageNote(item.priceUpdatedAt)}</span>
                )}
              </p>

              {item.allergens.length > 0 && (
                <p className={styles.itemAllergens}>אלרגנים: {item.allergens.join(' · ')}</p>
              )}

              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => startEdit(item)}
                  disabled={!canWrite}
                  aria-label={`עריכת ${item.name}`}
                >
                  <EditIcon />
                  עריכה
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => setConfirmDelete(item.key)}
                  disabled={!canWrite}
                  aria-label={`מחיקת ${item.name}`}
                >
                  <DeleteIcon />
                  מחיקה
                </button>
              </div>

              {confirmDelete === item.key && (
                <div
                  className={styles.confirm}
                  role="alertdialog"
                  aria-label={`אישור מחיקת ${item.name}`}
                >
                  <p>
                    למחוק את &quot;{item.name}&quot; מחומרי הגלם? מתכונים שהשתמשו
                    במחיר שלו יחזרו להיות בלי מחיר לשורה הזאת — לא למחיר אפס.
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => void onDelete(item.key)}
                      disabled={busy}
                      aria-label={`אישור מחיקת ${item.name}`}
                    >
                      {busy ? 'מוחק…' : 'כן, למחוק'}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => setConfirmDelete(null)}
                      aria-label="ביטול המחיקה"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
