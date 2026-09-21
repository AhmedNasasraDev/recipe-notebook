// §2 screen 18 — הרשאות. Instructors, admins and the owner only.
//
// WHY MEMBERS, INVITATIONS AND REQUESTS ARE ON THIS SCREEN TOO
//
// §2 gives screen 18 to "הרשאות — מנהל/מדריך בלבד" and §10.4 describes its
// per-recipe half: every recipe in the group, five toggles. Managing members,
// roles and invitations is required — the stage brief asks for pending /
// accepted / rejected / revoked, cancel and resend, approve and remove — and
// the spec gives it no screen of its own. Inventing "screen 22" would be
// inventing a product requirement; putting it here, as sections of the one
// screen that already means "who may do what", is the smaller invention. It is
// recorded as a decision rather than left as a surprise.
//
// EVERY CONTROL ON THIS SCREEN IS A REQUEST
//
// The buttons follow the rank model in features/groups/roles.ts, which mirrors
// the policies. What actually decides is `members_role` (rank >= 3 AND the
// target's rank strictly below the caller's — on both sides of the policy),
// `invites_staff` (rank >= 2), `items_write` (rank >= 2) and the guards in
// 0030. When a refusal comes back it is shown; it is never hidden by having
// asked politely.
//
// AND WHAT IT NEVER SHOWS
//
// An email address of an existing member. `group_roster` does not return one,
// on purpose (§10.1), so this screen cannot show what it does not have. The
// addresses visible here are the ones the staff typed into an invitation
// themselves.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { useAppData } from '../app/AppDataProvider.js';
import type { GroupRole } from '../lib/database.types.js';
import type { InviteView } from '../features/groups/invites.js';
import {
  INVITE_STATE_LABEL,
  canResend,
  canRevoke,
  daysLeft,
  inviteLink,
  inviteState,
  looksLikeEmail,
} from '../features/groups/invites.js';
import type { GroupDetail, GroupMember, JoinRequestView } from '../features/groups/types.js';
import {
  PERM_LABELS,
  ROLE_LABEL,
  ROLE_NOTE,
  assignableRoles,
  can,
  canActOnMember,
} from '../features/groups/roles.js';
import { authorLabel } from '../features/groups/chat.js';
import styles from './PermsScreen.module.css';

export function PermsScreen() {
  const { groupId = '' } = useParams();
  const { groups: api } = useAppData();

  const [group, setGroup] = useState<GroupDetail | null | 'missing'>(null);
  const [members, setMembers] = useState<readonly GroupMember[]>([]);
  const [invites, setInvites] = useState<readonly InviteView[]>([]);
  const [requests, setRequests] = useState<readonly JoinRequestView[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [newLink, setNewLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getGroup(groupId);
      if (!detail) {
        setGroup('missing');
        return;
      }
      setGroup(detail);
      setMembers(await api.roster(groupId));
      if (can(detail.myRole, 'invite')) {
        const [i, r] = await Promise.all([
          api.listInvites(groupId),
          api.listJoinRequests(groupId),
        ]);
        setInvites(i);
        setRequests(r);
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת המסך נכשלה.');
      setGroup('missing');
    }
  }, [api, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await what();
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'הפעולה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  if (group === null) return <p className={styles.state}>טוען…</p>;

  if (group === 'missing') {
    return (
      <div className={styles.page}>
        <p className={styles.notice}>הקבוצה אינה קיימת, או שאין לחשבון גישה אליה.</p>
        <BackControl>לכל הקבוצות</BackControl>
      </div>
    );
  }

  if (!can(group.myRole, 'perms')) {
    return (
      <div className={styles.page}>
        <p className={styles.notice}>
          המסך הזה פתוח למדריכים ולמנהלים בלבד. אלה גם ההרשאות שהשרת אוכף, ולא
          רק מה שמוצג כאן.
        </p>
        <BackControl>{group.name}</BackControl>
      </div>
    );
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const canRoles = can(group.myRole, 'roles');
  const pending = requests.filter((r) => r.status === 'pending');
  const items = group.courses.flatMap((c) =>
    c.lessons.flatMap((l) => l.items.map((i) => ({ item: i, lesson: l.name, course: c.name }))),
  );

  const onInvite = async (): Promise<void> => {
    const address = email.trim();
    if (address !== '' && !looksLikeEmail(address)) {
      setProblem('כתובת המייל אינה נראית תקינה.');
      return;
    }
    setProblem(null);
    setSaid(null);
    setBusy(true);
    try {
      const token = await api.createInvite(
        groupId,
        address === '' ? null : address,
        label.trim(),
      );
      setNewLink(inviteLink(token, origin));
      if (address !== '') {
        const mail = await api.sendInviteEmail(
          (await api.listInvites(groupId)).find((i) => i.token === token)?.id ?? '',
        );
        setSaid(
          mail.sent
            ? `הזמנה נשלחה ל${address}.`
            : (mail.reason ??
              'ההזמנה נוצרה, אבל המייל לא נשלח. אפשר להעתיק את הקישור ולשלוח אותו.'),
        );
      } else {
        setSaid('נוצר קישור הזמנה. אפשר להעתיק אותו ולשלוח בכל דרך.');
      }
      setEmail('');
      setLabel('');
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'יצירת ההזמנה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <BackControl>{group.name}</BackControl>
        <h1 className={styles.title}>חברים והרשאות</h1>
        <p className={styles.lede}>
          מי בקבוצה, מה התפקיד של כל אחד, ומה מותר לתלמיד לעשות בכל מתכון. כל
          פעולה כאן נאכפת גם בשרת — אם לחשבון אין הרשאה, הפעולה תידחה גם אם
          הכפתור נלחץ.
        </p>
      </header>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {said !== null && (
        <p className={styles.ok} role="status">
          {said}
        </p>
      )}

      {/* ── members ────────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.h2}>חברים ותפקידים</h2>
        {!canRoles && (
          <p className={styles.hint}>
            שינוי תפקיד והסרת חבר הם למנהל ולבעל הקבוצה. כמדריך אפשר להזמין
            ולאשר בקשות.
          </p>
        )}
        <ul className={styles.list}>
          {members.map((m) => (
            <li key={m.userId} className={styles.row}>
              <span className={styles.who}>
                <span className={styles.name}>{authorLabel(m.displayName)}</span>
                <span className={styles.meta}>{ROLE_LABEL[m.role]}</span>
              </span>

              {canRoles && canActOnMember(group.myRole, m.role) ? (
                <span className={styles.rowActions}>
                  <label className={styles.inline}>
                    <span className={styles.srOnly}>
                      תפקיד של {authorLabel(m.displayName)}
                    </span>
                    <select
                      className={styles.select}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        void act(() =>
                          api.setMemberRole(groupId, m.userId, e.target.value as GroupRole),
                        )
                      }
                    >
                      {[m.role, ...assignableRoles(group.myRole)]
                        .filter((r, i, all) => all.indexOf(r) === i)
                        .map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() => void act(() => api.removeMember(groupId, m.userId))}
                  >
                    הסרה
                  </button>
                </span>
              ) : (
                <span className={styles.meta}>
                  {m.role === 'owner' ? 'בעל הקבוצה — אין מה לשנות' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
        {canRoles && (
          <ul className={styles.roleNotes}>
            {(['admin', 'instructor', 'member'] as const).map((r) => (
              <li key={r} className={styles.meta}>
                <strong>{ROLE_LABEL[r]}</strong> — {ROLE_NOTE[r]}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── join requests ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.h2}>בקשות הצטרפות</h2>
        {pending.length === 0 ? (
          <p className={styles.meta}>אין בקשות שממתינות לאישור.</p>
        ) : (
          <ul className={styles.list}>
            {pending.map((r) => (
              <li key={r.id} className={styles.row}>
                <span className={styles.who}>
                  <span className={styles.name}>בקשה להצטרף</span>
                  {r.note !== '' && <span className={styles.meta}>{r.note}</span>}
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.small}
                    disabled={busy}
                    onClick={() => void act(() => api.approveJoin(groupId, r.userId))}
                  >
                    אישור
                  </button>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() => void act(() => api.rejectJoin(groupId, r.userId))}
                  >
                    דחייה
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── invitations ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.h2}>הזמנות</h2>
        <p className={styles.hint}>
          הזמנה לכתובת מייל תקפה רק לאותה כתובת — מי שמקבל את הקישור בטעות אינו
          יכול להצטרף באמצעותו. הזמנה בלי כתובת היא קישור פתוח, חד־פעמי, שתקף
          שבעה ימים.
        </p>

        <div className={styles.form}>
          <label className={styles.field}>
            <span>כתובת מייל (לא חובה)</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
            />
          </label>
          <label className={styles.field}>
            <span>הערה לעצמכם</span>
            <input
              className={styles.input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="מחזור י״ד"
            />
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void onInvite()}
          >
            יצירת הזמנה
          </button>
        </div>

        {newLink !== null && (
          <p className={styles.linkBox}>
            <code className={styles.code}>{newLink}</code>
          </p>
        )}

        {invites.length === 0 ? (
          <p className={styles.meta}>לא נשלחו הזמנות.</p>
        ) : (
          <ul className={styles.list}>
            {invites.map((i) => {
              const state = inviteState(i);
              return (
                <li key={i.id} className={styles.row}>
                  <span className={styles.who}>
                    <span className={styles.name}>{i.email ?? 'קישור פתוח'}</span>
                    <span className={styles.meta}>
                      {INVITE_STATE_LABEL[state]}
                      {state === 'pending' && ` · פגה בתוך ${daysLeft(i.expiresAt)} ימים`}
                      {i.label !== '' && ` · ${i.label}`}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    {state === 'pending' && (
                      <code className={styles.codeSmall}>{inviteLink(i.token, origin)}</code>
                    )}
                    {canRevoke(state) && (
                      <button
                        type="button"
                        className={styles.link}
                        disabled={busy}
                        onClick={() => void act(() => api.revokeInvite(i.id))}
                      >
                        ביטול
                      </button>
                    )}
                    {canResend(state) && (
                      <button
                        type="button"
                        className={styles.link}
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api.resendInvite(i.id);
                            setSaid(
                              'נוצרה הזמנה חדשה והקודמת בוטלה. הקישור הישן הפסיק לעבוד.',
                            );
                          })
                        }
                      >
                        שליחה מחדש
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── §10.4 per-recipe permissions ───────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.h2}>הרשאות לכל מתכון</h2>
        <p className={styles.hint}>
          ברירת המחדל היא המגבילה ביותר: צפייה בלבד. בלי צפייה המתכון לא מופיע
          לתלמיד כלל — לא הפריט ולא המתכון עצמו.
        </p>
        {items.length === 0 ? (
          <p className={styles.meta}>אין מתכונים בקבוצה.</p>
        ) : (
          <ul className={styles.list}>
            {items.map(({ item, lesson, course }) => (
              <li key={item.id} className={styles.itemBlock}>
                <p className={styles.name}>{item.name}</p>
                <p className={styles.meta}>
                  {course} · {lesson}
                </p>
                <ul className={styles.toggles}>
                  {PERM_LABELS.map(([key, text]) => (
                    <li key={key}>
                      <label className={styles.inline}>
                        <input
                          type="checkbox"
                          checked={item.perms[key]}
                          disabled={busy}
                          onChange={(e) =>
                            void act(() =>
                              api.setItemPerms(item.id, {
                                ...item.perms,
                                [key]: e.target.checked,
                              }),
                            )
                          }
                        />
                        <span>{text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
