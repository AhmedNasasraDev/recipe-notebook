// §2 screen 16 — קבוצה. Course → lesson → recipe, and the group's chat.
//
// WHAT A STUDENT SEES AND WHAT AN INSTRUCTOR SEES ARE DIFFERENT LISTS, AND NOT
// BECAUSE OF THIS FILE
//
// `items_read` is `(perm_view and lesson_rank >= 1) or lesson_rank >= 2`, so a
// recipe with view turned off is not in a student's result at all — §10.4's
// "בלי צפייה המתכון לא מופיע לתלמיד כלל" is the database's behaviour, not a
// filter applied here. This screen renders what it was given.
//
// The teaching controls are hidden below rank 2 in the same spirit: hiding
// them is a courtesy, `courses_write` / `lessons_write` / `items_write` are the
// enforcement, and every write goes through a repository that surfaces a
// refusal rather than swallowing it.
//
// THE JOIN CODE IS SHOWN TO STAFF ONLY
//
// A presentation choice, stated plainly because it is not a security boundary:
// `groups_read` lets every member read the row, code included. §10.2 has the
// code handed out in a lesson, so the screen puts it where the person who
// hands it out will look, and does not decorate a student's page with a string
// they have no use for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackControl } from '../components/BackLink.js';
import { ChatIcon, ChevronIcon, LessonsIcon } from '../shell/Icons.js';
import { useAppData } from '../app/AppDataProvider.js';
import { GroupChat } from '../features/groups/GroupChat.js';
import type { GroupDetail, GroupMember } from '../features/groups/types.js';
import { ROLE_LABEL, can } from '../features/groups/roles.js';
import { generateJoinCode } from '../features/groups/joinCode.js';
import styles from './GroupScreen.module.css';

const dateLabel = (iso: string | null): string => {
  if (iso === null) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}` : iso;
};

export function GroupScreen() {
  const { groupId = '' } = useParams();
  const { groups: api, recipes } = useAppData();

  const [group, setGroup] = useState<GroupDetail | null | 'missing'>(null);
  const [members, setMembers] = useState<readonly GroupMember[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Readonly<Record<string, string>>>({});
  const [tab, setTab] = useState<'lessons' | 'chat'>('lessons');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newCourse, setNewCourse] = useState('');
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [newLesson, setNewLesson] = useState({ name: '', date: '' });
  const [publishTo, setPublishTo] = useState<string | null>(null);
  const [publishRecipe, setPublishRecipe] = useState('');

  /** one repair per mount — React's development double-invoke must not write two codes */
  const healedCode = useRef(false);

  const load = useCallback(async () => {
    try {
      /*
        The roster does not depend on the group detail, so the two go out
        together (QA 22.09.2026, acceptance finding 15: the screen said
        "טוען…" for a chain of round trips that could have been one).
      */
      const [first, rosterEarly] = await Promise.all([
        api.getGroup(groupId),
        api.roster(groupId).catch(() => null),
      ]);
      let detail = first;
      /*
        A group made before codes were written at creation (QA finding 7) has
        none. Whoever may manage the group gives it one, once, on the way in;
        a student sees no code either way.
      */
      if (
        detail &&
        detail.code === null &&
        can(detail.myRole, 'perms') &&
        detail.joinBy.includes('code') &&
        !healedCode.current
      ) {
        healedCode.current = true;
        try {
          await api.updateGroup(groupId, { code: generateJoinCode() });
          detail = (await api.getGroup(groupId)) ?? detail;
        } catch {
          /* the screen still works without a code */
        }
      }
      if (!detail) {
        setGroup('missing');
        return;
      }
      setGroup(detail);
      const roster = rosterEarly ?? (await api.roster(groupId));
      setMembers(roster);
      const paths = roster.map((m) => m.avatarPath).filter((p): p is string => p !== null);
      setAvatarUrls(await api.avatarUrls(paths));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'טעינת הקבוצה נכשלה.');
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

  if (group === null) {
    return <p className={styles.state}>טוען…</p>;
  }

  if (group === 'missing') {
    return (
      <div className={styles.page}>
        {/*
          ONE message for "no such group" and for "not a member". A private
          group must not be discoverable by the difference between two errors.
        */}
        <p className={styles.notice}>
          הקבוצה אינה קיימת, או שאין לחשבון הזה גישה אליה.
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

  const teaches = can(group.myRole, 'teach');
  const ownRecipes = recipes.filter((r) => r.id !== '');

  return (
    /*
      ONE SCROLLER, A STICKY HEAD AND A STICKY COMPOSER

      The composer has to be where your thumb is and the group's details should
      not cost a third of the conversation. So this screen scrolls as one
      document — the title, the kind, the note and the join code scroll away —
      while the two tabs stick to the top and the chat's composer sticks to the
      bottom. Whatever you scroll to, the way between the two tabs and the way
      to write a message are both on screen.

      This replaced a bounded column that gave the message list the room left
      after a 184px header: the composer was reachable, which was the point of
      that fix, but the list was 321px of an 815px screen.
    */
    <div className={styles.page}>
      <header className={styles.head}>
        <BackControl>לכל הקבוצות</BackControl>
        <h1 className={styles.title}>{group.name}</h1>
        {group.kind !== '' && <p className={styles.kind}>{group.kind}</p>}
        <p className={styles.meta}>
          <span className={styles.role}>{ROLE_LABEL[group.myRole]}</span>
          <span>·</span>
          <span>{group.members === 1 ? 'חבר אחד' : `${group.members} חברים`}</span>
        </p>
        {group.note !== '' && <p className={styles.note}>{group.note}</p>}

        {can(group.myRole, 'invite') && group.code !== null && (
          <p className={styles.code}>
            קוד הקבוצה: <strong>{group.code}</strong> — מי שמקליד אותו שולח בקשה
            שצריך לאשר.
          </p>
        )}

        <div className={styles.headActions}>
          {can(group.myRole, 'perms') && (
            <Link to={`/group/${group.id}/perms`} className={styles.secondary}>
              חברים והרשאות
            </Link>
          )}

        </div>
      </header>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <div className={styles.tabs}>
        <div className={styles.segmented} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lessons'}
            className={[styles.tab, tab === 'lessons' ? styles.tabOn : ''].join(' ')}
            onClick={() => setTab('lessons')}
          >
            <LessonsIcon />
            שיעורים
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={[styles.tab, tab === 'chat' ? styles.tabOn : ''].join(' ')}
            onClick={() => setTab('chat')}
          >
            <ChatIcon />
            צ׳אט
            {group.unread > 0 && (
              <span className={styles.badge} aria-label={`${group.unread} הודעות שלא נקראו`}>
                {group.unread}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === 'chat' ? (
        <GroupChat
          groupId={group.id}
          role={group.myRole}
          members={members}
          avatarUrls={avatarUrls}
        />
      ) : (
        <div className={styles.courses}>
          {group.courses.length === 0 && (
            <p className={styles.notice}>
              {teaches
                ? 'אין עדיין קורסים בקבוצה. קורס מכיל שיעורים, ושיעור מכיל מתכונים.'
                : 'המדריך עוד לא פרסם קורסים בקבוצה הזאת.'}
            </p>
          )}

          {group.courses.map((course) => (
            <section key={course.id} className={styles.course}>
              <div className={styles.courseHead}>
                <h2 className={styles.h2}>{course.name}</h2>
                {teaches && (
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() =>
                        setOpenCourse(openCourse === course.id ? null : course.id)
                      }
                    >
                      שיעור חדש
                    </button>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => void act(() => api.removeCourse(course.id))}
                      disabled={busy}
                    >
                      מחיקת הקורס
                    </button>
                  </div>
                )}
              </div>

              {openCourse === course.id && (
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span>שם השיעור</span>
                    <input
                      className={styles.input}
                      value={newLesson.name}
                      onChange={(e) => setNewLesson({ ...newLesson, name: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>תאריך (לא חובה)</span>
                    <input
                      type="date"
                      className={styles.input}
                      value={newLesson.date}
                      onChange={(e) => setNewLesson({ ...newLesson, date: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy || newLesson.name.trim() === ''}
                    onClick={() =>
                      void act(async () => {
                        await api.addLesson(course.id, {
                          name: newLesson.name.trim(),
                          date: newLesson.date === '' ? null : newLesson.date,
                        });
                        setNewLesson({ name: '', date: '' });
                        setOpenCourse(null);
                      })
                    }
                  >
                    הוספת השיעור
                  </button>
                </div>
              )}

              {course.lessons.length === 0 ? (
                <p className={styles.meta}>אין שיעורים בקורס הזה.</p>
              ) : (
                <ul className={styles.lessons}>
                  {course.lessons.map((lesson) => (
                    <li key={lesson.id} className={styles.lesson}>
                      <div className={styles.lessonHead}>
                        <h3 className={styles.h3}>
                          {lesson.name}
                          {lesson.date !== null && (
                            <span className={styles.meta}> · {dateLabel(lesson.date)}</span>
                          )}
                        </h3>
                        <span className={lesson.done ? styles.done : styles.pendingTag}>
                          {lesson.done ? 'הועבר' : 'לפנינו'}
                        </span>
                      </div>

                      {lesson.summary !== '' && (
                        <p className={styles.summary}>{lesson.summary}</p>
                      )}

                      {lesson.items.length === 0 ? (
                        <p className={styles.meta}>
                          {teaches
                            ? 'אין מתכונים בשיעור הזה.'
                            : 'אין מתכונים שהמדריך שיתף בשיעור הזה.'}
                        </p>
                      ) : (
                        <ul className={styles.items}>
                          {lesson.items.map((item) => (
                            <li key={item.id} className={styles.item}>
                              <Link
                                to={`/group/${group.id}/item/${item.id}`}
                                className={styles.itemLink}
                              >
                                <span className={styles.itemName}>{item.name}</span>
                                <span className={styles.itemChevron} aria-hidden="true">
                                  <ChevronIcon />
                                </span>
                              </Link>
                              {teaches && (
                                <span className={styles.permsHint}>
                                  {item.perms.view ? 'צפייה' : 'מוסתר'}
                                  {item.perms.save ? ' · שמירה' : ''}
                                  {item.perms.print ? ' · הדפסה' : ''}
                                </span>
                              )}
                              {teaches && (
                                <button
                                  type="button"
                                  className={styles.link}
                                  onClick={() => void act(() => api.unpublishItem(item.id))}
                                  disabled={busy}
                                >
                                  הסרה
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {teaches && (
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() =>
                              setPublishTo(publishTo === lesson.id ? null : lesson.id)
                            }
                          >
                            הוספת מתכון מהמחברת
                          </button>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() =>
                              void act(() =>
                                api.updateLesson(lesson.id, { done: !lesson.done }),
                              )
                            }
                            disabled={busy}
                          >
                            {lesson.done ? 'סימון כלפנינו' : 'סימון כהועבר'}
                          </button>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() => void act(() => api.removeLesson(lesson.id))}
                            disabled={busy}
                          >
                            מחיקת השיעור
                          </button>
                        </div>
                      )}

                      {publishTo === lesson.id && (
                        <div className={styles.form}>
                          <label className={styles.field}>
                            <span>מתכון מהמחברת שלכם</span>
                            <select
                              className={styles.input}
                              value={publishRecipe}
                              onChange={(e) => setPublishRecipe(e.target.value)}
                            >
                              <option value="">בחרו מתכון</option>
                              {ownRecipes.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className={styles.hint}>
                            המתכון שלכם נשאר שלכם. הוא נעשה גלוי לקבוצה, ולתלמיד
                            מותר רק מה שתאשרו במסך ההרשאות — ברירת המחדל היא
                            צפייה בלבד.
                          </p>
                          <button
                            type="button"
                            className={styles.primary}
                            disabled={busy || publishRecipe === ''}
                            onClick={() =>
                              void act(async () => {
                                const chosen = ownRecipes.find((r) => r.id === publishRecipe);
                                await api.publishRecipe(
                                  lesson.id,
                                  publishRecipe,
                                  chosen?.name ?? '',
                                );
                                setPublishRecipe('');
                                setPublishTo(null);
                              })
                            }
                          >
                            הוספה לשיעור
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {teaches && (
            <div className={styles.form}>
              <label className={styles.field}>
                <span>קורס חדש</span>
                <input
                  className={styles.input}
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  placeholder="בצקים מועשרים"
                />
              </label>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || newCourse.trim() === ''}
                onClick={() =>
                  void act(async () => {
                    await api.addCourse(group.id, newCourse.trim());
                    setNewCourse('');
                  })
                }
              >
                הוספת קורס
              </button>
            </div>
          )}

          {/*
            §9: leaving the group is a SECONDARY action. It used to sit at the
            top of the screen, one line under the group's name and beside
            "חברים והרשאות" — the two most prominent controls on a page whose
            job is lessons and conversation, one of which cannot be undone
            without a new invitation. It lives at the end of the lessons now,
            where you arrive after everything the group is for.
          */}
          {group.myRole !== 'owner' && (
            <button
              type="button"
              className={styles.leave}
              onClick={() => void act(() => api.leaveGroup(group.id))}
              disabled={busy}
            >
              יציאה מהקבוצה
            </button>
          )}
        </div>
      )}
    </div>
  );
}
