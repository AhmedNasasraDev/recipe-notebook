// §2 screen 6 — "הדבקה": a recipe pasted as text becomes a recipe in the
// notebook.
//
// WHY THIS SCREEN IS ALL UI AND ALMOST NO LOGIC
//
// `parseLocal` has been in the engine since stage 1 — 192 lines, ported from
// the prototype's parser.js, exported, and covered by the acceptance tests.
// Nothing ever called it. This screen is the missing half: it does not parse
// anything itself, it shows what the engine made of the text and lets the user
// correct it before it becomes a recipe.
//
// THE PART THAT MATTERS MORE THAN THE PARSING
//
// An importer that quietly invents a weight is worse than no importer. When a
// line says "1 כוס אבקת מאצ'ה" and no reliable density exists for it,
// `parseLocal` KEEPS the cup — it does not guess 150 g — and returns the line
// in `keptAsWritten` with the reason. This screen puts those lines on the
// screen, by name, before anything is saved. The user then decides: leave it
// in cups, weigh it and type grams, or calibrate it later from the recipe page.
//
// SMART PASTE IS NOT HERE, AND THAT IS DELIBERATE
//
// §17 lists it as `REQUIRES BACKEND IMPLEMENTATION` and §6 says the API key
// must never reach the browser — it needs a server proxy with a per-user rate
// limit, which this project does not have. So the screen SAYS that, in one
// sentence, instead of showing a button that cannot work (AC #17).

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import {
  formatGrams,
  parseLocal,
  unitId,
  unitLabel,
  type IngredientLike,
  type Recipe,
} from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import styles from './PasteScreen.module.css';

export function PasteScreen() {
  const { prefs, categories, capabilities, saveRecipe } = useAppData();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'אחר');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parsing is pure and cheap, so it runs on the text rather than on a button
  // press — but nothing is SHOWN until the user asks, because a half-typed
  // paste rearranging itself under the cursor is unpleasant.
  const result = useMemo(() => parseLocal(text, prefs), [text, prefs]);

  const onParse = () => {
    setError(null);
    setParsed(true);
    // A first guess at the name: the first line, if it did not become a
    // quantity or a step. The user can change it, and must if it is wrong.
    if (!name.trim()) {
      /* The parser now reads a leading title line as the name (`meta.name`),
         so it is neither an ingredient nor a step. The older guess is kept as
         a fallback for a paste whose first line is something else. */
      const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      const looksLikeIngredient = result.ingredients.some((i) => i.name === first);
      const looksLikeStep = result.steps.some((s) => s.text === first);
      if (result.meta.name) setName(result.meta.name);
      else if (first && !looksLikeIngredient && !looksLikeStep && first.length <= 60) {
        setName(first);
      }
    }
  };

  const onSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('למתכון חייב להיות שם.');
      return;
    }
    if (result.ingredients.length === 0) {
      setError('לא זוהה אף רכיב, ולכן אין מה לשמור. אפשר לתקן את הטקסט ולפענח שוב.');
      return;
    }
    setBusy(true);
    try {
      const recipe: Recipe = {
        id: `new-${Date.now().toString(36)}`,
        name: name.trim(),
        category,
        /*
          The unit is normalised HERE, at the boundary where imported data
          enters the notebook. `parseLocal` is a port of the prototype's parser
          and writes the Hebrew names ("גרם"); everything the app creates itself
          stores the engine's canonical ids ("g"). Both are understood by the
          engine — `unitId` is what understands them — but a recipe that arrives
          spelled differently from every other one is the shape of the defect
          the editor's unit dropdown had. An unrecognised unit is KEPT rather
          than replaced, for the same reason the parser kept it.
        */
        ingredients: result.ingredients.map((ing) => ({
          ...ing,
          unit: unitId(ing.unit) ?? ing.unit,
        })),
        steps: result.steps.map((s) => ({
          id: s.id,
          text: s.text,
          ...(s.temp ? { temp: s.temp } : {}),
          ...(s.minutes === '' ? {} : { minutes: s.minutes }),
        })),
        /* The batch facts the text stated — weights before and after the
           oven, the count — go into the recipe's own fields, never into the
           ingredient list (see `parseLocal`). */
        ...(result.meta.weightBefore ? { weightBefore: result.meta.weightBefore } : {}),
        ...(result.meta.weightAfter ? { weightAfter: result.meta.weightAfter } : {}),
        ...(result.meta.unitWeight ? { unitWeight: result.meta.unitWeight } : {}),
        ...(result.meta.yieldUnits ? { yieldUnits: result.meta.yieldUnits } : {}),
      } as unknown as Recipe;
      const saved = await saveRecipe(recipe, { versionNote: 'יובא מהדבקת טקסט' });
      navigate(`/recipe/${saved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שמירת המתכון נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const nothingFound =
    parsed && result.ingredients.length === 0 && result.steps.length === 0;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>הדבקת מתכון</h1>
        <p className={styles.lead}>
          מדביקים מתכון מכל מקום — הודעה, אתר, צילום שהומר לטקסט — והמערכת מזהה
          את הרכיבים, הכמויות, היחידות, הזמנים והטמפרטורות. הפענוח נעשה על המכשיר
          שלכם ולא נשלח לשום מקום.
        </p>
      </header>

      {!capabilities.canWrite && (
        <p className={styles.notice} role="status">
          בהתקנה הזאת אין חיבור לשרת, ולכן אפשר לפענח ולראות את התוצאה אבל לא
          לשמור אותה.
        </p>
      )}

      <section className={styles.card}>
        <label className={styles.label} htmlFor="paste-text">
          הטקסט של המתכון
        </label>
        <textarea
          id="paste-text"
          className={styles.textarea}
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'בריוש\n500 גרם קמח לחם\n5 יח\' ביצים\n60 מ"ל חלב\n\nללוש 12 דקות\nלאפות 20 דקות ב-180 מעלות'}
        />
        <button
          type="button"
          className={styles.parseBtn}
          onClick={onParse}
          disabled={text.trim() === ''}
        >
          פענוח
        </button>
        <p className={styles.hint}>
          פענוח חכם דרך מודל שפה אינו זמין: הוא מחייב שרת מתווך עם מגבלת קצב, כדי
          שמפתח ה-API לא יהיה בדפדפן. הפענוח המקומי כאן עובד בלי שרת ובלי לשלוח
          את המתכון שלכם לאף אחד.
        </p>
      </section>

      {nothingFound && (
        <p className={styles.empty} role="status">
          לא זוהו רכיבים ולא שלבים. הפענוח מחפש שורות שיש בהן מספר ויחידת מדידה —
          למשל &quot;500 גרם קמח&quot;. שורה בלי כמות נחשבת לשלב הכנה אם היא ארוכה
          דיה.
        </p>
      )}

      {parsed && !nothingFound && (
        <>
          {/* What could not be converted, FIRST — before anything is saved. */}
          {result.keptAsWritten.length > 0 && (
            <section className={styles.warnBox} aria-label="שורות שנשמרו כפי שנכתבו">
              <h2 className={styles.warnTitle}>
                {result.keptAsWritten.length === 1
                  ? 'רכיב אחד נשאר ביחידה שנכתבה'
                  : `${result.keptAsWritten.length} רכיבים נשארו ביחידה שנכתבה`}
              </h2>
              <ul className={styles.warnList}>
                {result.keptAsWritten.map((k, i) => (
                  <li key={`${k.name}-${i}`}>
                    <strong>{k.name}</strong> — {k.reason}
                  </li>
                ))}
              </ul>
              <p className={styles.warnNote}>
                המערכת לא המציאה להם משקל. אפשר להשאיר כך, להזין גרמים במקום, או
                לכייל את הרכיב מדף המתכון אחרי השמירה.
              </p>
            </section>
          )}

          <section className={styles.card} aria-label="רכיבים שזוהו">
            <h2 className={styles.cardTitle}>
              {result.ingredients.length === 1
                ? 'רכיב אחד זוהה'
                : `${result.ingredients.length} רכיבים זוהו`}
            </h2>
            <ul className={styles.list}>
              {result.ingredients.map((ing, i) => (
                <li key={ing.id ?? i} className={styles.row}>
                  <span className={styles.rowName}>{ing.name}</span>
                  <span className={`${styles.rowQty} ltr`}>{amount(ing)}</span>
                </li>
              ))}
            </ul>
          </section>

          {result.steps.length > 0 && (
            <section className={styles.card} aria-label="שלבים שזוהו">
              <h2 className={styles.cardTitle}>
                {result.steps.length === 1 ? 'שלב אחד זוהה' : `${result.steps.length} שלבים זוהו`}
              </h2>
              <ol className={styles.steps}>
                {result.steps.map((s, i) => (
                  <li key={s.id ?? i} className={styles.step}>
                    <span>{s.text}</span>
                    {(s.minutes !== '' || s.temp) && (
                      <span className={`${styles.stepMeta} ltr`}>
                        {s.minutes !== '' && `${s.minutes} דק'`}
                        {s.minutes !== '' && s.temp ? ' · ' : ''}
                        {s.temp && `${s.temp}°${s.tempUnit === 'F' ? 'F' : 'C'}`}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>שמירה למחברת</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="paste-name">
                שם המתכון
              </label>
              <input
                id="paste-name"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="paste-category">
                קטגוריה
              </label>
              <select
                id="paste-category"
                className={styles.input}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void onSave()}
              disabled={busy || !capabilities.canWrite}
            >
              {busy ? 'שומר…' : 'שמירה למחברת'}
            </button>
            <p className={styles.hint}>
              אחרי השמירה אפשר לתקן הכול בעריכת המתכון — הפענוח הוא נקודת התחלה,
              לא תוצאה סופית.
            </p>
          </section>
        </>
      )}

      <BackControl>המחברת</BackControl>
    </div>
  );
}

/** What the row will be measured in, as the parser left it. */
function amount(ing: IngredientLike): string {
  const qty = ing.qty ?? '';
  const unit = unitLabel(ing.unit);
  if (qty === '' || qty === null) return unit;
  // A gram amount is shown the way the rest of the app shows grams, so the
  // preview and the recipe page do not disagree about the same number.
  if (ing.unit === 'g') return formatGrams(Number(qty));
  return `${qty} ${unit}`.trim();
}
