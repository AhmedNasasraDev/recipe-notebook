// The list of production plans (stage-9 requirement 13).
//
// Deliberately thin: a date, a name, how many products, and whether the plan
// has been marked done. Everything interesting about a plan is DERIVED, and
// deriving it for every plan in the list would mean computing every recipe in
// the notebook to draw a menu.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackLink } from '../components/BackLink.js';
import { useAppData } from '../app/AppDataProvider.js';
import type { PlanSummary } from '../data/repository.js';
import { DeleteIcon } from '../shell/Icons.js';
import styles from './PlansScreen.module.css';

const today = (): string => new Date().toISOString().slice(0, 10);

const when = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

export function PlansScreen() {
  const { listPlans, savePlan, deletePlan, capabilities } = useAppData();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<readonly PlanSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const canWrite = capabilities.canWrite;

  const load = useCallback(async () => {
    try {
      setPlans(await listPlans());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת התוכניות נכשלה.');
      setPlans([]);
    }
  }, [listPlans]);

  useEffect(() => {
    void load();
  }, [load]);

  const onNew = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const saved = await savePlan({
        id: '',
        name: '',
        planDate: today(),
        note: '',
        locked: false,
        lockedAt: null,
        snapshot: null,
        updatedAt: '',
        items: [],
        onHand: {},
      });
      navigate(`/plan/${saved.id}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'יצירת התוכנית נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setProblem(null);
    setBusy(true);
    try {
      await deletePlan(id);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'המחיקה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {/* §4: an inner screen, so it carries the way back. It is reached from
            "עוד", which is where it returns to. */}
        <BackLink to="/more">עוד</BackLink>
        <h1 className={styles.title}>תכנון ייצור</h1>
        <p className={styles.lede}>
          מגדירים מה מייצרים ובאיזו כמות, והמערכת מחשבת מהמתכונים כמה חומר גלם
          צריך, מה לקנות, כמה זה צפוי לעלות ומתי להתחיל.
        </p>
      </header>

      {!canWrite && (
        <p className={styles.notice} role="status">
          אין כרגע חיבור לחשבון, ולכן אי אפשר ליצור או לשנות תוכניות ייצור.
        </p>
      )}

      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}

      <button
        type="button"
        className={styles.addBtn}
        onClick={() => void onNew()}
        disabled={busy || !canWrite}
        aria-label="תוכנית ייצור חדשה"
      >
        <span aria-hidden="true">+ </span>תוכנית חדשה
      </button>

      {plans === null ? (
        <p className={styles.empty} role="status">
          טוען…
        </p>
      ) : plans.length === 0 ? (
        <p className={styles.empty}>
          אין עדיין תוכניות ייצור. תוכנית מורכבת מתאריך ומרשימת מוצרים עם
          כמויות, וכל השאר מחושב מהמתכונים.
        </p>
      ) : (
        <ul className={styles.list} aria-label="רשימת תוכניות הייצור">
          {plans.map((p) => (
            <li key={p.id} className={styles.item}>
              <div className={styles.itemHead}>
                <Link to={`/plan/${p.id}`} className={styles.itemName}>
                  {p.name || `תוכנית ${when(p.planDate)}`}
                </Link>
                <span className={styles.itemWhen}>{when(p.planDate)}</span>
              </div>
              <p className={styles.itemMeta}>
                {p.items === 0
                  ? 'אין עדיין מוצרים בתוכנית'
                  : p.items === 1
                    ? 'מוצר אחד'
                    : `${p.items} מוצרים`}
                {p.locked && (
                  <span className={styles.lockedTag}> · סומנה כבוצעה</span>
                )}
              </p>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => setConfirmDelete(p.id)}
                  disabled={!canWrite}
                  aria-label={`מחיקת ${p.name || `תוכנית ${when(p.planDate)}`}`}
                >
                  <DeleteIcon />
                  מחיקה
                </button>
              </div>

              {confirmDelete === p.id && (
                <div
                  className={styles.confirm}
                  role="alertdialog"
                  aria-label={`אישור מחיקת ${p.name || `תוכנית ${when(p.planDate)}`}`}
                >
                  <p>
                    למחוק את התוכנית? המתכונים, המחירים והיסטוריית הרכישות לא
                    ייפגעו — נמחקת רק התוכנית עצמה.
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => void onDelete(p.id)}
                      disabled={busy}
                      aria-label="אישור מחיקת התוכנית"
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
