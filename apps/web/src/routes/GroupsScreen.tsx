// §2 screen 15 — קבוצות.
//
// The list of groups the account belongs to, and the two honest ways in from
// here: create one, or ask to join with a code.
//
// WHAT THIS SCREEN DELIBERATELY DOES NOT HAVE
//
// A search box. §10.2: "קבוצה פרטית כברירת מחדל. אינה מופיעה בחיפוש ואי אפשר
// להיכנס אליה מעצמך." A field that searched groups would either return nothing
// — theatre — or return something, which would be the privacy model broken. So
// the four ways in are listed as text, and the only one a stranger can start
// is the code, which creates a REQUEST that an admin approves.
//
// A pending request has no group name, and this screen says so rather than
// inventing one: a non-member cannot read the group row, and the name arrives
// only in the reply to the request itself (`request_group_join` returns it).

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronIcon } from '../shell/Icons.js';
import { useAppData } from '../app/AppDataProvider.js';
import type { GroupSummary, JoinRequestView } from '../features/groups/types.js';
import { JOIN_METHOD_LABEL, JOIN_METHOD_NOTE, ROLE_LABEL } from '../features/groups/roles.js';
import styles from './GroupsScreen.module.css';

export function GroupsScreen() {
  const { groups: api, capabilities } = useAppData();
  /* The trial simulates groups locally and they work there; only the
     read-only demo has no groups at all. */
  const noBackend = capabilities.source === 'local-demo';

  const [list, setList] = useState<readonly GroupSummary[] | null>(null);
  const [requests, setRequests] = useState<readonly JoinRequestView[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<'none' | 'create' | 'join'>('none');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [groups, mine] = await Promise.all([api.listGroups(), api.myJoinRequests()]);
      setList(groups);
      setRequests(mine);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת הקבוצות נכשלה.');
      setList([]);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (): Promise<void> => {
    if (name.trim() === '') {
      setProblem('לקבוצה צריך שם.');
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await api.createGroup({ name: name.trim(), kind: kind.trim(), note: note.trim() });
      setName('');
      setKind('');
      setNote('');
      setForm('none');
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'יצירת הקבוצה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (): Promise<void> => {
    if (code.trim() === '') {
      setProblem('צריך להקליד קוד קבוצה.');
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const groupName = await api.requestJoin(code.trim(), note.trim());
      setSentTo(groupName);
      setCode('');
      setNote('');
      setForm('none');
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'הבקשה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async (groupId: string): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.withdrawJoin(groupId);
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'ביטול הבקשה נכשל.');
    } finally {
      setBusy(false);
    }
  };

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>קבוצות וקורסים</h1>
        <p className={styles.lede}>
          קבוצה היא מקום עבודה משותף: קורסים, שיעורים, מתכונים שהמדריך משתף
          וצ׳אט. כל קבוצה פרטית — היא אינה מופיעה בחיפוש, ואי אפשר להיכנס אליה
          בלי הזמנה או אישור.
        </p>
      </header>

      {noBackend && (
        <p className={styles.notice}>
          קבוצות עובדות מול חשבון ושרת. בהתקנה הזאת אין חיבור לשרת, ולכן אין כאן
          קבוצות — ולא נציג רשימה מומצאת במקום.
        </p>
      )}

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      {sentTo !== null && (
        <p className={styles.ok} role="status">
          הבקשה נשלחה ל״{sentTo}״. מנהל הקבוצה צריך לאשר אותה — הקוד לבדו אינו
          מכניס לקבוצה.
        </p>
      )}

      {list === null ? (
        <p className={styles.lede}>טוען…</p>
      ) : list.length === 0 ? (
        !noBackend && (
          <div className={styles.empty}>
            <p>אינכם חברים באף קבוצה.</p>
            <p className={styles.waysTitle}>ארבע הדרכים להיכנס לקבוצה:</p>
            <ul className={styles.ways}>
              {(['invite', 'link', 'code', 'request'] as const).map((m) => (
                <li key={m}>
                  <strong>{JOIN_METHOD_LABEL[m]}</strong> — {JOIN_METHOD_NOTE[m]}
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <ul className={styles.list}>
          {list.map((g) => (
            <li key={g.id} className={styles.card}>
              {/* §9: "רשימת קבוצות עם כניסה ברורה". The whole card was already
                  the link; what it lacked was the chevron that says so. */}
              <Link to={`/group/${g.id}`} className={styles.cardLink}>
                <span className={styles.cardBody}>
                  <span className={styles.cardTop}>
                    <span className={styles.name}>{g.name}</span>
                    {g.unread > 0 && (
                      <span className={styles.badge} aria-label={`${g.unread} הודעות שלא נקראו`}>
                        {g.unread}
                      </span>
                    )}
                  </span>
                  {g.kind !== '' && <span className={styles.kind}>{g.kind}</span>}
                  <span className={styles.meta}>
                    <span className={styles.role}>{ROLE_LABEL[g.myRole]}</span>
                    <span>·</span>
                    <span>{g.members === 1 ? 'חבר אחד' : `${g.members} חברים`}</span>
                  </span>
                </span>
                <span className={styles.cardChevron} aria-hidden="true">
                  <ChevronIcon />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>בקשות שממתינות לאישור</h2>
          <ul className={styles.list}>
            {pending.map((r) => (
              <li key={r.id} className={styles.card}>
                <p className={styles.name}>בקשת הצטרפות</p>
                <p className={styles.meta}>
                  ממתינה לאישור מנהל. שם הקבוצה יוצג כאן רק לאחר שהבקשה תאושר —
                  עד אז החשבון אינו חבר בה ואינו יכול לקרוא את פרטיה.
                </p>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => void onWithdraw(r.groupId)}
                  disabled={busy}
                >
                  ביטול הבקשה
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!noBackend && (
        <section className={styles.section}>
          {form === 'none' && (
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => setForm('create')}>
                קבוצה חדשה
              </button>
              <button type="button" className={styles.secondary} onClick={() => setForm('join')}>
                הצטרפות עם קוד
              </button>
            </div>
          )}

          {form === 'create' && (
            <div className={styles.form}>
              <h2 className={styles.h2}>קבוצה חדשה</h2>
              <label className={styles.field}>
                <span>שם הקבוצה</span>
                <input
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className={styles.field}>
                <span>סוג הקבוצה</span>
                <input
                  className={styles.input}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  placeholder="בית ספר לקונדיטוריה · צוות מטבח"
                />
              </label>
              <label className={styles.field}>
                <span>הערה לחברי הקבוצה</span>
                <textarea
                  className={styles.input}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className={styles.hint}>
                אתם תהיו בעלי הקבוצה. הקבוצה נוצרת פרטית, ואפשר להזמין אליה
                אנשים מהמסך שלה.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void onCreate()}
                  disabled={busy}
                >
                  יצירת הקבוצה
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setForm('none')}
                  disabled={busy}
                >
                  ביטול
                </button>
              </div>
            </div>
          )}

          {form === 'join' && (
            <div className={styles.form}>
              <h2 className={styles.h2}>הצטרפות עם קוד קבוצה</h2>
              <label className={styles.field}>
                <span>קוד הקבוצה</span>
                <input
                  className={styles.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </label>
              <label className={styles.field}>
                <span>הערה למנהל (לא חובה)</span>
                <input
                  className={styles.input}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="מי אתם, כדי שיזהו אתכם"
                />
              </label>
              <p className={styles.hint}>
                הקוד יוצר בקשה בלבד. מנהל הקבוצה מאשר אותה, ועד אז אין לחשבון
                גישה לשום דבר בקבוצה.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void onJoin()}
                  disabled={busy}
                >
                  שליחת בקשה
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setForm('none')}
                  disabled={busy}
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
