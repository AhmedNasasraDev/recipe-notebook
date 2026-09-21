// §2 screen 9 — "דף הזמנה": one sheet of paper that goes to the bench.
//
// WHY THE SCALE IS IN THE URL AND NOT IN COMPONENT STATE
//
// The order sheet has to show the quantities for THIS order, which means it
// has to know what "כמה להכין" was set to on the recipe page. In the prototype
// both were the same component and shared one state object. Here they are two
// routes, and there were three ways to bridge them:
//
//   router state    lost on reload, and this is a page people reload and
//                   re-print. A sheet that silently reverts to the recipe
//                   quantities after a refresh is the worst of the three.
//   a stored field  a scale factor is not a property of a recipe. Writing one
//                   would make "how many I happen to want today" part of the
//                   formula.
//   the URL         reproducible, printable, and it can be sent to whoever is
//                   doing the weighing.
//
// So the link carries `?mode=…&v=…&ing=…` and this screen rebuilds the factor
// with the SAME `scaleFactor()` from the engine that the recipe page uses. One
// scaling rule, two screens. An unreadable parameter falls back to the recipe
// quantities and the sheet says which it is showing, rather than guessing.
//
// THE ORDER DETAILS ARE NOT SAVED, AND THE SCREEN SAYS SO
//
// Client, order number, delivery date and note are typed here and live in
// component state. There is no `orders` table in the spec (§1.1) and §2 gives
// this screen one purpose: "הדפסה". Inventing an order record would be a new
// product area — customers, order history, statuses — decided by a screen that
// only needed to print a page. It is written up as a recommendation instead.
//
// What the screen does NOT do is fabricate an order number. The prototype
// filled the blank with `'#' + Date.now().slice(-5)`, which produces a
// different "order number" on every render: a number that looks like a record
// and is not one. An empty field prints as empty.

import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink.js';
import { compute, formatGrams, formatNis } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import { calcState } from '../features/recipe/completeness.js';
import { readScale, SCALE_MODE_TEXT } from '../features/recipe/scaleLink.js';
import styles from './OrderScreen.module.css';

interface OrderDetails {
  client: string;
  no: string;
  date: string;
  note: string;
}

const FIELDS: readonly { key: keyof OrderDetails; label: string; placeholder: string }[] = [
  { key: 'client', label: 'שם הלקוח', placeholder: 'למשל דנה לוי' },
  { key: 'no', label: 'מספר הזמנה', placeholder: 'אם יש' },
  { key: 'date', label: 'תאריך אספקה', placeholder: 'למשל 18.9' },
  { key: 'note', label: 'הערה ללקוח', placeholder: '' },
];

export function OrderScreen() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const [params] = useSearchParams();
  const { recipes, prefs, catalog } = useAppData();

  const [details, setDetails] = useState<OrderDetails>({
    client: '',
    no: '',
    date: '',
    note: '',
  });

  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  const pro = prefs.pro === true;

  const priced = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );
  const pricedRecipe = useMemo(
    () => (recipe ? resolveFromCatalog(recipe, catalog) : null),
    [recipe, catalog],
  );

  const baseline = useMemo(
    () => (pricedRecipe ? compute(pricedRecipe, priced, { prefs }) : null),
    [pricedRecipe, priced, prefs],
  );

  /* The scale the link asked for, or the recipe's own quantities. The reading
     moved to `features/recipe/scaleLink.ts` when Cook Mode became the third
     screen that needs it — the reasoning above is still why it is in the URL,
     and now there is one parser rather than one per screen. */
  const scale = useMemo(() => readScale(params, baseline), [params, baseline]);

  const computed = useMemo(
    () => (pricedRecipe ? compute(pricedRecipe, priced, { factor: scale.factor, prefs }) : null),
    [pricedRecipe, priced, scale.factor, prefs],
  );

  if (!recipe || !computed || !baseline) {
    return (
      <div className={styles.missing}>
        <p>המתכון הזה לא נמצא במחברת.</p>
        <BackLink to="/notebook">המחברת</BackLink>
      </div>
    );
  }

  const calc = calcState(computed);
  const bakerPct = computed.flour > 0 && pro;

  const set = (key: keyof OrderDetails, value: string) =>
    setDetails((d) => ({ ...d, [key]: value }));

  return (
    <div className={styles.wrap}>
      <div className={`${styles.topBar} noprint`}>
        <BackLink to={`/recipe/${recipe.id}`}>המתכון</BackLink>
        <span className={styles.topTitle}>דף הזמנה</span>
      </div>

      <div className={styles.body}>
        {/* ── the details, none of which is stored ─────────────────────── */}
        <section className={`${styles.form} noprint`} aria-label="פרטי ההזמנה">
          <h2 className={styles.formTitle}>פרטי ההזמנה</h2>
          {FIELDS.map((f) => (
            <div key={f.key} className={styles.field}>
              <label className={styles.label} htmlFor={`order-${f.key}`}>
                {f.label}
              </label>
              <input
                id={`order-${f.key}`}
                className={styles.input}
                value={details[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
          <p className={styles.formNote}>
            הפרטים האלה נכנסים לדף המודפס ואינם נשמרים במערכת — אין במחברת מסך
            הזמנות, ולכן אין מקום שבו הזמנה נשמרת. מי שצריך היסטוריית הזמנות
            צריך מסך הזמנות, לא שדה בדף הדפסה.
          </p>
          <p className={styles.formNote}>
            הכמויות בדף נלקחות מ&quot;כמה להכין&quot; שבמתכון:{' '}
            <strong>{SCALE_MODE_TEXT[scale.mode]}</strong>
            {scale.factor !== 1 && (
              <>
                {' · מקדם ×'}
                <span className="ltr">{scale.factor.toFixed(2)}</span>
              </>
            )}
          </p>
        </section>

        {/* Partial data is a problem on a sheet someone weighs from, so it is
            stated above the sheet and not only as a chip inside it. */}
        {calc.level !== 'full' && (
          <div className={`${styles.warn} noprint`} role="alert">
            <p className={styles.warnTitle}>
              {calc.level === 'none' ? 'לא ניתן לחשב' : 'הדף מבוסס על נתונים חלקיים'}
            </p>
            <p className={styles.warnBody}>{calc.summary}</p>
            {calc.missingNames.length > 0 && (
              <p className={styles.warnBody}>חסרים נתונים עבור: {calc.missingNames.join(' · ')}</p>
            )}
          </div>
        )}

        {/*
          A separate notice, because a missing PRICE is a different problem
          from a missing weight: the sheet is still correct to weigh from, and
          only the cost line on it is incomplete. Rolling the two together
          would make an order that is perfectly fine to produce look broken.
          Professional profile only — there is no cost line to qualify without
          one.
        */}
        {pro && calc.costLevel !== 'full' && calc.unpricedNames.length > 0 && (
          <p className={`${styles.note} noprint`} role="status">
            העלות בדף חלקית: אין מחיר ל{calc.unpricedNames.join(' · ')}. הכמויות
            והמשקלים מדויקים, והמחיר הוא סכום של הרכיבים שיש להם מחיר בלבד.{' '}
            <Link to="/ingredients">להזין מחיר במרכז חומרי הגלם</Link>
          </p>
        )}

        {/* ── the sheet ───────────────────────────────────────────────── */}
        <section className={styles.sheet} aria-label="דף ההזמנה">
          <header className={styles.sheetHead}>
            <div>
              <h1 className={styles.sheetTitle}>{recipe.name}</h1>
              <p className={styles.sheetSub}>דף הזמנה לייצור</p>
            </div>
            <div className={styles.sheetSide}>
              {details.no && (
                <p>
                  הזמנה <span className="ltr">{details.no}</span>
                </p>
              )}
              {details.client && <p>{details.client}</p>}
              {details.date && (
                <p>
                  לאספקה <span className="ltr">{details.date}</span>
                </p>
              )}
            </div>
          </header>

          <div className={styles.stats}>
            <Stat
              k="יחידות להפקה"
              v={computed.unitsActual > 0 ? String(Math.round(computed.unitsActual)) : '—'}
            />
            <Stat
              k="משקל לשקילה ליחידה"
              v={computed.scaleWeight > 0 ? formatGrams(computed.scaleWeight) : '—'}
            />
            <Stat k="תשואה" v={formatGrams(computed.actualYield)} />
            {pro && (
              <Stat
                k="פחת אפייה"
                // §1.1's null ≠ 0 rule: a loss of 0.0% is a measurement, and
                // an unmeasured loss is not zero. Both weights are needed.
                v={
                  Number(recipe.weightBefore) > 0 && recipe.weightAfter !== undefined &&
                  String(recipe.weightAfter).trim() !== ''
                    ? `${computed.bakeLoss.toFixed(1)}%`
                    : 'לא נמדד'
                }
              />
            )}
          </div>

          <h2 className={styles.sectionTitle}>רכיבים לשקילה</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.colTick}>
                  <span className="visuallyHidden">סימון שקילה</span>
                </th>
                <th scope="col">רכיב</th>
                <th scope="col" className={styles.colQty}>
                  כמות
                </th>
                {bakerPct && (
                  <th scope="col" className={styles.colPct}>
                    % אופה
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {computed.rows.map((row, i) => (
                <tr key={row.ing.id ?? i}>
                  <td className={styles.colTick} aria-hidden="true">
                    ☐
                  </td>
                  <td>
                    {row.ing.name}
                    {row.ing.note && <span className={styles.rowNote}> · {row.ing.note}</span>}
                  </td>
                  <td className={`${styles.colQty} ltr`}>
                    {/*
                      An ingredient whose weight could not be established gets
                      a blank to fill in by hand, never a 0: a printed "0 גר׳"
                      is an instruction to leave it out.
                    */}
                    {row.g === null ? (
                      <span className={styles.unknown}>______</span>
                    ) : (
                      formatGrams(row.g)
                    )}
                  </td>
                  {bakerPct && (
                    <td className={`${styles.colPct} ltr`}>
                      {row.g === null ? '' : `${row.bakerPct.toFixed(0)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.colTick} />
                <td>סך הכל בצק או תערובת</td>
                <td className={`${styles.colQty} ltr`}>{formatGrams(computed.totalG)}</td>
                {bakerPct && <td className={styles.colPct} />}
              </tr>
            </tfoot>
          </table>

          {(recipe.steps ?? []).length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>סדר עבודה</h2>
              <ol className={styles.steps}>
                {(recipe.steps ?? []).map((s, i) => (
                  <li key={s.id ?? i} className={styles.step}>
                    <span className={styles.stepNum}>{i + 1}</span>
                    <span>
                      {s.text}
                      {(s.temp || s.minutes) && (
                        <span className={styles.stepMeta}>
                          {' · '}
                          {s.temp && <span className="ltr">{s.temp}°C</span>}
                          {s.temp && s.minutes ? ' · ' : ''}
                          {s.minutes && <span className="ltr">{s.minutes} דק׳</span>}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {recipe.notes && <p className={styles.recipeNote}>{recipe.notes}</p>}
          {details.note && <p className={styles.clientNote}>לתשומת הלב: {details.note}</p>}

          {/* §3: costs exist on a professional profile only. */}
          {pro && computed.cost > 0 && (
            <p className={styles.costLine}>
              עלות חומרי גלם להזמנה <span className="ltr">{formatNis(computed.cost)}</span>
              {computed.costPerUnit > 0 && (
                <>
                  {' · '}
                  <span className="ltr">{formatNis(computed.costPerUnit)}</span> ליחידה
                </>
              )}
              {computed.price > 0 && (
                <>
                  {' · מחיר מכירה מוצע '}
                  <span className="ltr">{formatNis(computed.price)}</span> ליחידה לפני מע&quot;מ
                </>
              )}
              {/*
                `costLevel`, not `level`. They answer different questions and
                this line is about the second one: every weight can be known
                (level 'full') while only one ingredient in three has a price,
                and a cost total built from a third of the prices is exactly
                what someone would quote a customer from.
              */}
              {calc.costLevel !== 'full' && (
                <span className={styles.partialChip}>חלקי</span>
              )}
            </p>
          )}

          <p className={styles.allergens}>
            מכיל:{' '}
            {computed.allergens.length > 0
              ? computed.allergens.join(' · ')
              : 'לא זוהו אלרגנים לפי שמות הרכיבים'}
          </p>

          {/* The sheet's own record: who did what. Printed empty, filled by hand. */}
          <div className={styles.signRow}>
            <span className={styles.sign}>שקל</span>
            <span className={styles.sign}>אפה</span>
            <span className={styles.sign}>אישר</span>
          </div>
        </section>

        <div className={`${styles.actions} noprint`}>
          <button type="button" className={styles.printBtn} onClick={() => window.print()}>
            הדפסה או שמירה כ־PDF
          </button>
        </div>
        <p className={`${styles.note} noprint`}>
          הערות אישיות (§8) אינן נכנסות לדף ההזמנה. הערת המתכון הציבורית כן.
        </p>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statKey}>{k}</span>
      <span className={`${styles.statVal} ltr`}>{v}</span>
    </div>
  );
}
