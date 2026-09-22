// §2 screen 17 — מתכון קבוצתי.
//
// A recipe somebody else owns, read-only, with three things next to it: what
// this account is allowed to do here, a private note, and §11's copy.
//
// WHY IT IS NOT `RecipeScreen`
//
// RecipeScreen is the owner's page. It offers editing, deletion, versions,
// costing, batches and trials — all of which are the OWNER's, and several of
// which §12.3 says a student must never see of somebody else's notebook. A
// "read-only mode" flag on a thousand-line screen would be one forgotten
// branch away from showing an instructor's cost margins to their class. So
// this screen renders the recipe itself and nothing around it.
//
// WHAT "מה מותר לי כאן" IS, AND WHAT IT IS NOT
//
// It is the five per-recipe permissions as the server reported them (§10.4's
// card, ✓/—). It is not the enforcement: `perm_save` is checked again by
// `save_group_recipe_copy`, `perm_view` is why the item is in the result at
// all, and the print and download buttons are hidden by the same values the
// server sent. A student who forges a request gets a 42501, not a copy.
//
// WHAT IS MISSING FROM THE PAGE, AND WHY THAT IS CORRECT
//
// No cost, no margin, no trials, no batches, no version history: all of those
// are the owner's, and the database refuses them to a student anyway
// (`owns_recipe` on trials, batches and recipe_versions). The page shows what
// a person needs in order to bake: quantities, grams, steps.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { compute } from '@recipe-notebook/engine';
import type { Recipe } from '@recipe-notebook/engine';
import { useAppData } from '../app/AppDataProvider.js';
import type { GroupDetail, GroupItem } from '../features/groups/types.js';
import { PERM_LABELS } from '../features/groups/roles.js';
import styles from './GroupRecipeScreen.module.css';

/** The item, its lesson and its course, found in the loaded tree. */
function locate(
  group: GroupDetail,
  itemId: string,
): { item: GroupItem; lesson: string; course: string } | null {
  for (const course of group.courses) {
    for (const lesson of course.lessons) {
      const item = lesson.items.find((i) => i.id === itemId);
      if (item) return { item, lesson: lesson.name, course: course.name };
    }
  }
  return null;
}

export function GroupRecipeScreen() {
  const { groupId = '', itemId = '' } = useParams();
  const navigate = useNavigate();
  const { groups: api, fetchRecipe, prefs, recipes } = useAppData();

  const [group, setGroup] = useState<GroupDetail | null | 'missing'>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getGroup(groupId);
      if (!detail) {
        setGroup('missing');
        return;
      }
      setGroup(detail);
      const found = locate(detail, itemId);
      if (!found) {
        setGroup('missing');
        return;
      }
      /*
        `fetchRecipe` and not the provider's in-memory `getRecipe`: that list
        is the ACCOUNT's own recipes, and this one belongs to the instructor.
        `recipes_group_read` is what makes the read succeed — and it succeeds
        only while an item the reader may see points at the recipe, which is
        §10.4 doing its job one layer down.
      */
      const [r, existing] = await Promise.all([
        fetchRecipe(found.item.recipeId),
        api.getItemNote(itemId),
      ]);
      setRecipe(r);
      setNote(existing ?? '');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת המתכון נכשלה.');
      setGroup('missing');
    }
  }, [api, fetchRecipe, groupId, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Computed with the READER's measurement preferences, which is the point of
    §5's engine: the instructor wrote cups and the student who works in grams
    sees grams, from the same row. Prices are deliberately not resolved — see
    the header.
  */
  const computed = useMemo(
    () => (recipe ? compute(recipe, recipes, { factor: 1, prefs }) : null),
    [recipe, recipes, prefs],
  );

  const found = group !== null && group !== 'missing' ? locate(group, itemId) : null;

  /** A row that names a base recipe this account cannot read. See below. */
  const unresolvedSub =
    computed !== null &&
    computed.rows.some((row) => (row.ing.subId ?? null) !== null && row.sub === null);

  const onSaveNote = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.saveItemNote(itemId, note);
      setNoteSaved(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שמירת ההערה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      const id = await api.saveGroupCopy(itemId);
      setCopied(id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שמירת העותק נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  if (group === null) return <p className={styles.state}>טוען…</p>;

  if (group === 'missing' || found === null) {
    return (
      <div className={styles.page}>
        {/* One message for every reason: no such item, not a member, or the
            instructor has turned viewing off. Telling them apart would say
            something about a group this account may not see. */}
        <p className={styles.notice}>
          המתכון הזה אינו זמין לחשבון הזה. ייתכן שהמדריך לא שיתף אותו, או שאין
          לכם גישה לקבוצה.
        </p>
        <BackControl>לכל הקבוצות</BackControl>
        {problem !== null && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
      </div>
    );
  }

  const { item, lesson, course } = found;
  const perms = item.perms;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <BackControl>{group.name}</BackControl>
        <h1 className={styles.title}>{item.name}</h1>
        <p className={styles.meta}>
          {course} · {lesson}
        </p>
      </header>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <section className={styles.permsCard} aria-label="מה מותר לי כאן">
        <h2 className={styles.h2}>מה מותר לי כאן</h2>
        <ul className={styles.permsList}>
          {PERM_LABELS.map(([key, label, note_]) => (
            <li key={key} className={styles.permRow}>
              <span className={perms[key] ? styles.yes : styles.no} aria-hidden="true">
                {perms[key] ? '✓' : '—'}
              </span>
              <span className={styles.permText}>
                <span className={styles.permLabel}>{label}</span>
                <span className={styles.permNote}>{note_}</span>
              </span>
              <span className={styles.srOnly}>{perms[key] ? 'מותר' : 'חסום'}</span>
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          ההרשאות נקבעות על ידי המדריך ונאכפות בשרת. ההערה האישית שלכם פרטית —
          המדריך אינו רואה אותה.
        </p>
      </section>

      {copied !== null ? (
        <section className={styles.ok} role="status">
          <p>נוצר עותק אישי במחברת שלכם. המתכון של הקבוצה לא השתנה.</p>
          <button
            type="button"
            className={styles.primary}
            onClick={() => navigate(`/recipe/${copied}`)}
          >
            פתיחת העותק שלי
          </button>
        </section>
      ) : perms.save ? (
        <button
          type="button"
          className={styles.primary}
          onClick={() => void onCopy()}
          disabled={busy}
        >
          שמירת עותק למחברת שלי
        </button>
      ) : (
        <p className={styles.notice}>
          המדריך לא אישר שמירה של המתכון הזה למחברת אישית. אפשר לצפות ולכתוב
          הערה אישית.
        </p>
      )}

      {recipe === null || computed === null ? (
        <p className={styles.notice}>
          המתכון עצמו אינו נטען כרגע. ייתכן שההרשאות שונו בזמן שהמסך היה פתוח.
        </p>
      ) : (
        <>
          <section className={styles.card}>
            <h2 className={styles.h2}>רכיבים</h2>
            <ul className={styles.rows}>
              {computed.rows.map((row, i) => (
                <li key={`${row.ing.name}-${i}`} className={styles.row}>
                  <span className={styles.rowName}>{row.ing.name}</span>
                  <span className={styles.rowQty}>
                    {row.ing.qty} {row.ing.unit}
                    {row.g !== null && (
                      <span className={styles.rowGrams}> · {Math.round(row.g)} גר׳</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {computed.allergens.length > 0 && (
              <p className={styles.meta}>אלרגנים: {computed.allergens.join(', ')}</p>
            )}
            {unresolvedSub && (
              /*
                A base recipe the instructor did not share.

                `recipes_group_read` only admits a recipe an item points at, so
                a sub-recipe that was never added to a lesson is invisible to
                the class — and the engine correctly leaves the row
                unresolved. Saying so is the honest answer; printing the parent
                as if the figures were complete would not be.
              */
              <p className={styles.notice}>
                בשיעור הזה יש רכיב שהוא מתכון בסיס שהמדריך לא שיתף, ולכן
                הפירוט והמשקלים שלו אינם מוצגים. הכמות של השורה עצמה נכונה.
              </p>
            )}
          </section>

          {recipe.steps !== undefined && recipe.steps.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.h2}>אופן ההכנה</h2>
              <ol className={styles.steps}>
                {recipe.steps.map((s, i) => (
                  <li key={i} className={styles.step}>
                    {s.text}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {perms.print && (
            <button type="button" className={styles.secondary} onClick={() => window.print()}>
              הדפסה
            </button>
          )}
        </>
      )}

      <section className={styles.card}>
        <h2 className={styles.h2}>הערה אישית</h2>
        <p className={styles.hint}>
          ההערה שייכת לחשבון שלכם. היא אינה נשלחת לקבוצה, אינה מופיעה בדף
          הזמנה או בתווית, ואף מדריך אינו יכול לקרוא אותה.
        </p>
        <label className={styles.srOnly} htmlFor="item-note">
          הערה אישית על המתכון
        </label>
        <textarea
          id="item-note"
          className={styles.input}
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteSaved(false);
          }}
        />
        <div className={styles.noteRow}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void onSaveNote()}
            disabled={busy || noteSaved}
          >
            שמירת ההערה
          </button>
          {noteSaved && note !== '' && <span className={styles.meta}>נשמרה</span>}
        </div>
      </section>
    </div>
  );
}
