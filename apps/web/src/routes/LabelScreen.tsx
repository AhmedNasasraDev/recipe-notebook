// §2 screen 8 — "תווית": the product label, to print and stick on a box.
//
// THIS IS THE ONE SCREEN IN THE APP THAT LEAVES THE BUILDING
//
// Every other screen shows figures to the person who typed them, who knows how
// solid they are and has a "חלקי" chip to tell them. A label is read by someone
// who has no idea what was behind it, cannot ask, and may have an allergy. So
// the rules are stricter here than anywhere else in the app:
//
//   1. No percentage unless every ingredient weight is established. One unknown
//      weight makes the total wrong, so all the shares are wrong — see
//      features/recipe/labelComposition.ts. The screen then prints the names
//      without shares and says which weights are missing.
//   2. The allergen line says "לא זוהו אלרגנים" and never nothing at all. A
//      blank space where allergens belong reads as "there are none", which is
//      a claim the app is in no position to make.
//   3. Private notes (§8) are not here. Neither is cost. A label carries what
//      is in the product, not what it cost to make.
//
// WHAT THIS SCREEN DELIBERATELY DOES NOT DO
//
// It does not check the label against the marking regulations of any country,
// and it says so on screen. Nutrition values, country of origin, the
// manufacturer's details and the exact wording of an allergen declaration are
// legal requirements that change by market — inventing them here would be
// worse than leaving them out, because a printed label looks official.
//
// THE HACCP LINE (§13a)
//
// It is informative and never a block. §13a is explicit about why: refusing to
// print a label because a control point is unticked produces an override in a
// real kitchen, not a record. Real enforcement would have to be per-kitchen and
// server-side at label creation — `REQUIRES BACKEND`, and noted as such.

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink.js';
import { compute, formatGrams } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import { resolveFromCatalog } from '../features/pricing/catalog.js';
import { composition } from '../features/recipe/labelComposition.js';
import { haccpOf, labelHaccpNote, lastBatch } from '../features/batch/haccp.js';
import styles from './LabelScreen.module.css';

export function LabelScreen() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const { recipes, prefs, catalog } = useAppData();

  const recipe = recipes.find((r) => r.id === recipeId) ?? null;

  /*
    The catalog is resolved even though no price is printed: a sub-recipe's
    computation is what the roll-up walks, and resolving the notebook keeps
    this screen's numbers identical to the recipe page's. A label that
    disagreed with the recipe page about a percentage would be the worse of
    two bugs to find.
  */
  const priced = useMemo(
    () => recipes.map((r) => resolveFromCatalog(r, catalog)),
    [recipes, catalog],
  );

  /*
    At factor 1, always. A label describes the PRODUCT, and scaling the batch
    does not change what is in it: the percentages are identical at any factor
    and the net weight below is per unit. Carrying a scale factor into a label
    would let the same product print two different labels.
  */
  const computed = useMemo(
    () => (recipe ? compute(resolveFromCatalog(recipe, catalog), priced, { prefs }) : null),
    [recipe, catalog, priced, prefs],
  );

  const comp = useMemo(() => (computed ? composition(computed) : null), [computed]);

  const batch = recipe ? lastBatch(recipe) : null;
  const haccp = batch ? haccpOf(batch) : null;

  if (!recipe || !computed || !comp) {
    return (
      <div className={styles.missing}>
        <p>המתכון הזה לא נמצא במחברת.</p>
        <BackLink to="/notebook">המחברת</BackLink>
      </div>
    );
  }

  /*
    Net weight. `unitWeight` is a weight per unit that someone entered, so it
    is what a package holds. Without it the only weight the app knows is the
    yield of a whole batch — a true number, but about something else, so it is
    labelled as what it is rather than printed as if it were a package weight.
  */
  const unitWeight = Number(recipe.unitWeight);
  const netWeight =
    unitWeight > 0
      ? { text: `משקל נטו ${String(unitWeight)} גר׳`, perUnit: true }
      : { text: `תשואת האצווה ${formatGrams(computed.actualYield)}`, perUnit: false };

  return (
    <div className={styles.wrap}>
      <div className={`${styles.topBar} noprint`}>
        <BackLink to={`/recipe/${recipe.id}`}>המתכון</BackLink>
        <span className={styles.topTitle}>תווית מוצר</span>
      </div>

      <div className={styles.body}>
        {/* ── the label itself: everything inside this box is what prints ── */}
        <section className={styles.label} aria-label="תווית המוצר">
          <h1 className={styles.name}>{recipe.name}</h1>

          <p className={styles.declaration}>
            <span className={styles.declKey}>רכיבים: </span>
            {comp.lines.length === 0 ? (
              <span className={styles.declEmpty}>אין רכיבים במתכון</span>
            ) : (
              /*
                The share is in PARENTHESES, which is the convention on real
                food labels and here it is not cosmetic. Ingredient names
                routinely end in a percentage of their own — "שוקולד מריר 64%",
                "שמנת מתוקה 38%", "קמח לחם 13% חלבון" — and the first render of
                this screen produced "שוקולד מריר 64% 17.9%", two percentages
                in a row meaning entirely different things. On the one screen
                in the app that has to be unambiguous to a stranger, that is
                not acceptable.
              */
              comp.lines.map((l, i) => (
                <span key={l.name}>
                  {i > 0 && ', '}
                  {l.name}
                  {l.pct !== null && (
                    <>
                      {' '}
                      <span className="ltr">({l.pct.toFixed(1)}%)</span>
                    </>
                  )}
                </span>
              ))
            )}
          </p>

          <p className={styles.declaration}>
            <span className={styles.declKey}>מכיל: </span>
            {computed.allergens.length > 0
              ? computed.allergens.join(' · ')
              : /* Never a blank space here — see rule 2 at the top of the file. */
                'לא זוהו אלרגנים לפי שמות הרכיבים'}
          </p>

          <div className={styles.footRow}>
            <span className="ltr">{netWeight.text}</span>
            <span>{recipe.shelfLife ? `חיי מדף ${recipe.shelfLife}` : ''}</span>
          </div>
          {recipe.storage && <p className={styles.storage}>{recipe.storage}</p>}

          {batch && (
            <p className={styles.batchLine}>
              אצווה <span className="ltr">{batch.code}</span>
              {batch.date && (
                <>
                  {' · יוצר ב־'}
                  <span className="ltr">{batch.date}</span>
                </>
              )}
            </p>
          )}

          {haccp && (
            <p className={styles.haccpRow}>
              <span className={`${styles.chip} ${styles[`chip_${haccp.level}`] ?? ''}`}>
                {haccp.label}
              </span>
              <span className={styles.haccpNote}>{labelHaccpNote(haccp)}</span>
            </p>
          )}
        </section>

        {/* ── everything below is guidance and does not print ──────────── */}
        {!comp.certain && comp.lines.length > 0 && (
          <div className={`${styles.warn} noprint`} role="alert" aria-label="ההרכב אינו מלא">
            <p className={styles.warnTitle}>האחוזים אינם מוצגים, וזה לא תקלה</p>
            <p className={styles.warnBody}>
              אחוז הוא חלק מסך המשקל. כל עוד משקל של רכיב אחד אינו ידוע, סך המשקל
              שגוי ולכן כל האחוזים שגויים — וגם סדר הרכיבים אינו ודאי, כי הרכיב
              החסר עלול להיות הגדול מכולם. תווית מודפסת נקראת כהצהרה, ולכן
              המערכת מדפיסה שמות בלי אחוזים עד שהנתונים שלמים.
            </p>
            {comp.missing.length > 0 && (
              <p className={styles.warnList}>
                חסר משקל עבור: {comp.missing.join(' · ')}
              </p>
            )}
            <Link to={`/recipe/${recipe.id}/edit`} className={styles.warnLink}>
              להשלמת הנתונים בעריכת המתכון
            </Link>
          </div>
        )}

        {!batch && (
          <p className={`${styles.note} noprint`}>
            למתכון הזה לא נרשמה אצווה, ולכן התווית אינה מציגה מספר אצווה ואינה
            מציגה סטטוס HACCP. היעדר סטטוס אינו &quot;לא תועד&quot; — הוא היעדר
            אצווה.
          </p>
        )}

        {haccp && haccp.breach && (
          <p className={`${styles.breach} noprint`} role="status">
            {haccp.breach}
          </p>
        )}

        <p className={`${styles.note} noprint`}>
          ההרכב יורד בסדר משקל ומגולגל גם מתוך מתכוני בסיס: מתכון בסיס מוצהר לפי
          מה שיש בתוכו, ולא בשמו. הערות אישיות ועלויות אינן נכנסות לתווית.
        </p>

        <p className={`${styles.legal} noprint`}>
          זו אינה תווית מאושרת לרגולציה. סימון תזונתי, פרטי יצרן, ארץ מקור ונוסח
          הצהרת האלרגנים נדרשים בחוק ומשתנים בין שווקים — המערכת אינה ממציאה
          אותם. ההתאמה לדרישות הסימון היא באחריות היצרן.
        </p>

        <div className={`${styles.actions} noprint`}>
          <button type="button" className={styles.printBtn} onClick={() => window.print()}>
            הדפסה או שמירה כ־PDF
          </button>
        </div>
      </div>
    </div>
  );
}
