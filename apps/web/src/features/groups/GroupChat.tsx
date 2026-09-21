/*
  The group chat.

  ─────────────────────────────────────────────────────────────────────────────
  THE TABLE IS THE TRUTH; THE BROADCAST IS ONLY DELIVERY

  History is read with `chatPage` and live messages arrive over a private
  Realtime channel. The two overlap on purpose: a broadcast can arrive for a
  message the page request already returned, an edit arrives as a second copy
  of a message on screen, and a reconnect replays what was missed. So nothing
  here appends — every source goes through `mergeMessages`, which keys by id
  and takes the newer copy. A client that was offline catches up by asking
  again, not by hoping the stream survived.

  WHAT IS OPTIMISTIC AND WHAT IS NOT

  Nothing is optimistic. A message appears when the database has accepted it
  and returned the row — which is also where its `seq` comes from, and `seq`
  is what ordering, pagination and the unread marker all key on. An optimistic
  bubble would need an invented seq, and an invented seq is a message in the
  wrong place until the real one arrives.

  THE UNREAD LINE IS FROZEN WHEN THE CONVERSATION OPENS

  `lastReadSeq` is read once. If the divider followed the live marker it would
  vanish the instant the screen marked everything read, which is immediately —
  so the line is drawn against the position the reader arrived at, and stays
  where it was until they leave and come back.

  WHAT THE BUTTONS OFFER IS NOT WHAT DECIDES

  `canEdit`/`canDelete` mirror the trigger in migrations 0032/0035, including
  the asymmetry: a moderator may remove somebody else's message and may never
  rewrite it. If this were wrong in the permissive direction the database would
  refuse and the screen would show the refusal.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../app/AppDataProvider.js';
import { SendIcon } from '../../shell/Icons.js';
import type { GroupRole } from '../../lib/database.types.js';
import type { ChatMessage, GroupMember } from './types.js';
import {
  authorLabel,
  bodyOf,
  byDay,
  canDelete,
  canEdit,
  initials,
  isDeleted,
  mergeMessages,
  newestSeq,
  olderCursor,
  replyPreview,
  timeLabel,
  unreadDividerSeq,
} from './chat.js';
import { can } from './roles.js';
import styles from './GroupChat.module.css';

/** One screenful and a bit. Small enough to be quick, big enough to scroll. */
const PAGE = 30;

export interface GroupChatProps {
  groupId: string;
  role: GroupRole;
  members: readonly GroupMember[];
  /** signed avatar URLs by storage path; a missing one renders initials */
  avatarUrls: Readonly<Record<string, string>>;
}

export function GroupChat({ groupId, role, members, avatarUrls }: GroupChatProps) {
  const { groups: api, userId } = useAppData();
  const me = userId ?? '';

  const [messages, setMessages] = useState<readonly ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<'connecting' | 'subscribed' | 'error'>('connecting');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, GroupMember>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  /* The first page, the read marker and the subscription. */
  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setProblem(null);

    const subscription = api.subscribeGroupChat(groupId, {
      onMessage: (message) => {
        if (cancelled) return;
        setMessages((prev) => mergeMessages(prev ?? [], [message]));
      },
      onStatus: (s) => {
        if (!cancelled) setStatus(s);
      },
    });

    void (async () => {
      try {
        const [page, read] = await Promise.all([
          api.chatPage(groupId, null, PAGE),
          api.lastReadSeq(groupId),
        ]);
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setOpenedAt(read);
      } catch (e) {
        if (cancelled) return;
        setProblem(e instanceof Error ? e.message : 'טעינת ההודעות נכשלה.');
        setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [api, groupId]);

  /* Mark read whenever the newest message on screen moves. */
  const newest = messages === null ? null : newestSeq(messages);
  useEffect(() => {
    if (newest === null) return;
    void api.markGroupRead(groupId, newest);
  }, [api, groupId, newest]);

  /*
    THE COMPOSER GROWS WITH WHAT IS WRITTEN IN IT.

    §9 asks for one line by default and growth only when the text needs it,
    up to a sensible ceiling with the rest scrolling inside. A textarea cannot
    do that on its own — `rows` is a fixed number — so the height is set from
    the content: reset to `auto` to get an honest `scrollHeight`, then clamped
    to the token. `tall` switches the capsule's ends from half circles to a card
    radius once it is no longer one line high.
  */
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const el = draftRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const max = Number.parseInt(
      getComputedStyle(el).maxHeight.replace('px', ''),
      10,
    );
    const wanted = el.scrollHeight;
    const capped = Number.isFinite(max) && max > 0 ? Math.min(wanted, max) : wanted;
    el.style.height = `${capped}px`;
    setTall(capped > 48);
  }, [draft]);

  /* Keep the newest message in view as one arrives. */
  const bottom = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    /*
      Optional call, not for tidiness: `scrollIntoView` is not implemented in
      jsdom and is missing from some older mobile browsers. Unguarded it throws
      inside an effect, which takes the whole conversation down — a chat that
      fails to render because it could not scroll.
    */
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [newest]);

  const loadOlder = useCallback(async () => {
    if (messages === null) return;
    const cursor = olderCursor(messages);
    if (cursor === null) return;
    setBusy(true);
    try {
      const page = await api.chatPage(groupId, cursor, PAGE);
      setMessages((prev) => mergeMessages(prev ?? [], page.messages));
      setHasMore(page.hasMore);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת ההודעות הקודמות נכשלה.');
    } finally {
      setBusy(false);
    }
  }, [api, groupId, messages]);

  const onSend = async (): Promise<void> => {
    const body = draft.trim();
    if (body === '') return;
    setProblem(null);
    setBusy(true);
    try {
      const sent = await api.sendMessage({
        groupId,
        body,
        replyToId: replyTo?.id ?? null,
        kind: announcement ? 'announcement' : 'text',
      });
      setMessages((prev) => mergeMessages(prev ?? [], [sent]));
      setDraft('');
      setReplyTo(null);
      setAnnouncement(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'שליחת ההודעה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (): Promise<void> => {
    if (!editing) return;
    const body = editing.body.trim();
    if (body === '') {
      setProblem('הודעה ריקה אינה נשמרת. אפשר למחוק אותה במקום.');
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const updated = await api.editMessage(editing.id, body);
      setMessages((prev) => mergeMessages(prev ?? [], [updated]));
      setEditing(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'עריכת ההודעה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await api.deleteMessage(id);
      setConfirmDelete(null);
      // The row is re-read rather than patched locally: `deleted_at` and
      // `deleted_by` are stamped by the database, and 0035 empties the body.
      const page = await api.chatPage(groupId, null, PAGE);
      setMessages((prev) => mergeMessages(prev ?? [], page.messages));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'מחיקת ההודעה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const divider =
    messages === null || openedAt === null ? null : unreadDividerSeq(messages, openedAt, me);

  const days = messages === null ? [] : byDay(messages);

  return (
    <section className={styles.chat} aria-label="צ׳אט הקבוצה">
      {status === 'error' && (
        <p className={styles.offline} role="status">
          אין כרגע חיבור להודעות בזמן אמת. ההיסטוריה מוצגת, והודעה חדשה תופיע
          לאחר רענון.
        </p>
      )}

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <div className={styles.scroll}>
        {messages === null ? (
          <p className={styles.state}>טוען הודעות…</p>
        ) : messages.length === 0 ? (
          <p className={styles.state}>
            אין עדיין הודעות בקבוצה. ההודעה הראשונה יכולה להיות שלכם.
          </p>
        ) : (
          <>
            {hasMore && (
              <button
                type="button"
                className={styles.older}
                onClick={() => void loadOlder()}
                disabled={busy}
              >
                הודעות קודמות
              </button>
            )}

            {days.map((day) => (
              <div key={day.key} className={styles.day}>
                <p className={styles.dayLabel}>{day.label}</p>
                {day.messages.map((m) => {
                  const author = byId.get(m.authorId);
                  const mine = m.authorId === me;
                  const parent = m.replyToId
                    ? messages.find((x) => x.id === m.replyToId)
                    : undefined;
                  const quoted = replyPreview(
                    parent,
                    parent ? byId.get(parent.authorId)?.displayName : null,
                  );
                  const avatar = author?.avatarPath
                    ? avatarUrls[author.avatarPath]
                    : undefined;

                  return (
                    <div key={m.id}>
                      {divider === m.seq && (
                        <p className={styles.divider}>הודעות שלא נקראו</p>
                      )}
                      <article
                        className={[
                          styles.row,
                          mine ? styles.mine : '',
                          m.kind === 'announcement' ? styles.announcement : '',
                          isDeleted(m) ? styles.gone : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className={styles.avatar} aria-hidden="true">
                          {avatar !== undefined ? (
                            <img className={styles.avatarImg} src={avatar} alt="" />
                          ) : (
                            initials(author?.displayName)
                          )}
                        </span>

                        <div className={styles.bubble}>
                          <p className={styles.who}>
                            <span className={styles.name}>
                              {authorLabel(author?.displayName)}
                            </span>
                            {m.kind === 'announcement' && (
                              <span className={styles.tag}>הכרזה</span>
                            )}
                            <time className={styles.time}>{timeLabel(m.createdAt)}</time>
                            {m.editedAt !== null && !isDeleted(m) && (
                              <span className={styles.time}>· נערכה</span>
                            )}
                          </p>

                          {quoted !== null && (
                            <p className={styles.quote}>
                              <span className={styles.quoteName}>{quoted.name}</span>
                              <span>{quoted.text}</span>
                            </p>
                          )}

                          {editing?.id === m.id ? (
                            <div className={styles.editor}>
                              <label className={styles.srOnly} htmlFor={`edit-${m.id}`}>
                                עריכת ההודעה
                              </label>
                              <textarea
                                id={`edit-${m.id}`}
                                className={styles.input}
                                rows={2}
                                value={editing.body}
                                onChange={(e) =>
                                  setEditing({ id: m.id, body: e.target.value })
                                }
                              />
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  className={styles.small}
                                  onClick={() => void onSaveEdit()}
                                  disabled={busy}
                                >
                                  שמירה
                                </button>
                                <button
                                  type="button"
                                  className={styles.small}
                                  onClick={() => setEditing(null)}
                                  disabled={busy}
                                >
                                  ביטול
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className={styles.body}>{bodyOf(m)}</p>
                          )}

                          {editing?.id !== m.id && (
                            <div className={styles.rowActions}>
                              {!isDeleted(m) && (
                                <button
                                  type="button"
                                  className={styles.link}
                                  onClick={() => setReplyTo(m)}
                                >
                                  תשובה
                                </button>
                              )}
                              {canEdit(m, { userId: me, role }) && (
                                <button
                                  type="button"
                                  className={styles.link}
                                  onClick={() => setEditing({ id: m.id, body: m.body })}
                                >
                                  עריכה
                                </button>
                              )}
                              {canDelete(m, { userId: me, role }) && (
                                <button
                                  type="button"
                                  className={styles.link}
                                  onClick={() => setConfirmDelete(m.id)}
                                >
                                  מחיקה
                                </button>
                              )}
                            </div>
                          )}

                          {confirmDelete === m.id && (
                            <div className={styles.confirm}>
                              <p>
                                למחוק את ההודעה? היא לא תחזור, והטקסט שלה לא יוצג
                                יותר לחברי הקבוצה.
                              </p>
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  className={styles.small}
                                  onClick={() => void onDelete(m.id)}
                                  disabled={busy}
                                >
                                  מחיקה
                                </button>
                                <button
                                  type="button"
                                  className={styles.small}
                                  onClick={() => setConfirmDelete(null)}
                                  disabled={busy}
                                >
                                  ביטול
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Where the auto-scroll comes to rest; `.bottomAnchor` keeps the
                newest message clear of the sticky composer. */}
            <div ref={bottom} className={styles.bottomAnchor} />
          </>
        )}
      </div>

      <div className={styles.composer}>
        {replyTo !== null && (
          <p className={styles.replying}>
            <span>
              בתשובה ל{authorLabel(byId.get(replyTo.authorId)?.displayName)}:{' '}
              {bodyOf(replyTo).slice(0, 60)}
            </span>
            <button type="button" className={styles.link} onClick={() => setReplyTo(null)}>
              ביטול
            </button>
          </p>
        )}

        {can(role, 'announce') && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={announcement}
              onChange={(e) => setAnnouncement(e.target.checked)}
            />
            <span>הכרזה</span>
          </label>
        )}

        <label className={styles.srOnly} htmlFor="chat-draft">
          הודעה חדשה
        </label>
        <div className={tall ? `${styles.capsule} ${styles.capsuleTall}` : styles.capsule}>
          <textarea
            id="chat-draft"
            ref={draftRef}
            className={styles.input}
            rows={1}
            value={draft}
            placeholder="כתבו הודעה לקבוצה"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className={styles.sendBtn}
            onClick={() => void onSend()}
            disabled={busy || draft.trim() === ''}
            aria-label="שליחה"
            title="שליחה"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </section>
  );
}
