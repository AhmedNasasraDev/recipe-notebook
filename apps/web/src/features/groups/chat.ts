/*
  The chat's pure logic: what to show, what to offer, and how pages join up.

  ─────────────────────────────────────────────────────────────────────────────
  WHY THE MERGE IS A FUNCTION AND NOT A `setState(prev => [...prev, msg])`

  Three sources write into the same list — the first page, an older page
  fetched by scrolling up, and a realtime broadcast — and they overlap. A
  broadcast can arrive for a message that the page request already returned,
  an edit arrives as a second copy of a message already on screen, and a
  reconnect replays what was missed. Appending would show duplicates; keying by
  id and taking the NEWER copy is the whole of the correctness here.

  WHY `seq` AND NOT `created_at`

  Two messages in the same millisecond tie on a timestamp, and a tie at a page
  boundary means a duplicate or a skipped row. `seq` is a single monotonic
  bigint (migration 0032), so ordering and cursors are exact.

  WHAT THIS FILE DOES NOT DECIDE

  Whether an edit or a delete is ALLOWED. It mirrors the rule so the UI offers
  the right buttons, and the database's trigger is what enforces it — including
  the asymmetry that a moderator may delete somebody else's message and may
  never edit it.
*/

import type { GroupRole } from '../../lib/database.types.js';
import type { ChatMessage } from './types.js';
import { can } from './roles.js';

/** What a tombstone says in place of the words that were removed. */
export const DELETED_TEXT = 'ההודעה נמחקה';

export function isDeleted(message: ChatMessage): boolean {
  return message.deletedAt !== null;
}

/** What to render. A deleted message arrives with an empty body (0035). */
export function bodyOf(message: ChatMessage): string {
  return isDeleted(message) ? DELETED_TEXT : message.body;
}

export interface Viewer {
  userId: string;
  role: GroupRole;
}

/**
 * May the viewer edit this message?
 *
 * Only its author, and only while it stands. Mirrors `guard_message_update`:
 * a non-author edit raises 42501, and so does an edit of a deleted message.
 */
export function canEdit(message: ChatMessage, viewer: Viewer): boolean {
  return message.authorId === viewer.userId && !isDeleted(message);
}

/**
 * May the viewer delete it?
 *
 * The author, or anybody the group ranks at 2 or more — `messages_update`'s
 * `author_id = auth.uid() or group_rank(group_id) >= 2`. Already-deleted is
 * refused by the trigger ("a deletion cannot be undone" works in both
 * directions: there is nothing left to delete).
 */
export function canDelete(message: ChatMessage, viewer: Viewer): boolean {
  if (isDeleted(message)) return false;
  return message.authorId === viewer.userId || can(viewer.role, 'moderate');
}

/**
 * Merges pages and broadcasts into one ordered list.
 *
 * Keyed by id, newest copy wins, sorted ascending by `seq` — oldest at the
 * top, which is the reading order of a conversation.
 */
export function mergeMessages(
  ...lists: ReadonlyArray<readonly ChatMessage[]>
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const list of lists) {
    for (const m of list) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The cursor for "load older".
 *
 * The LOWEST seq in hand, because the next page is `seq < cursor`. Null for an
 * empty list — there is nothing to page back from, and sending 0 would ask for
 * everything before the beginning.
 */
export function olderCursor(messages: readonly ChatMessage[]): number | null {
  if (messages.length === 0) return null;
  return messages.reduce((min, m) => (m.seq < min ? m.seq : min), messages[0]!.seq);
}

/** The highest seq in hand — what `mark_group_read` should be told. */
export function newestSeq(messages: readonly ChatMessage[]): number | null {
  if (messages.length === 0) return null;
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), messages[0]!.seq);
}

/**
 * Where the "unread from here" line goes: the seq of the first message the
 * viewer has not read that is not their own.
 *
 * Their own messages are excluded because a line above your own sentence reads
 * as an accusation rather than a bookmark — and `group_unread_counts` excludes
 * them too, so including them here would put a divider above a conversation
 * the counter calls fully read.
 *
 * Null = nothing to mark.
 */
export function unreadDividerSeq(
  messages: readonly ChatMessage[],
  lastReadSeq: number,
  viewerId: string,
): number | null {
  const first = messages
    .filter((m) => m.seq > lastReadSeq && m.authorId !== viewerId && !isDeleted(m))
    .sort((a, b) => a.seq - b.seq)[0];
  return first?.seq ?? null;
}

/**
 * Counts what the viewer has not read, the same way `group_unread_counts`
 * does: above the marker, not mine, not deleted.
 *
 * The server's number is the one shown on the groups list; this one exists for
 * the open conversation, where a broadcast has already arrived and asking the
 * server again would be a round trip to learn what is on screen.
 */
export function unreadCount(
  messages: readonly ChatMessage[],
  lastReadSeq: number,
  viewerId: string,
): number {
  return messages.filter(
    (m) => m.seq > lastReadSeq && m.authorId !== viewerId && !isDeleted(m),
  ).length;
}

/* ── time, in Hebrew and in the reader's own zone ────────────────────────── */

const HE_DATE = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' });
const HE_DATE_YEAR = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const HE_TIME = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

/** A stable key for "the same day", in LOCAL time — grouping is per reader. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** היום · אתמול · 12 בספטמבר · 12 בספטמבר 2025 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(iso) === dayKey(now.toISOString())) return 'היום';
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'אתמול';
  return d.getFullYear() === now.getFullYear() ? HE_DATE.format(d) : HE_DATE_YEAR.format(d);
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : HE_TIME.format(d);
}

/** Messages in reading order, split into days, each day labelled once. */
export function byDay(
  messages: readonly ChatMessage[],
  now: Date = new Date(),
): Array<{ key: string; label: string; messages: ChatMessage[] }> {
  const days: Array<{ key: string; label: string; messages: ChatMessage[] }> = [];
  for (const m of messages) {
    const key = dayKey(m.createdAt);
    const last = days[days.length - 1];
    if (last && last.key === key) last.messages.push(m);
    else days.push({ key, label: dayLabel(m.createdAt, now), messages: [m] });
  }
  return days;
}

/* ── the author, as the chat may name them ───────────────────────────────── */

/** What to call somebody with no display name. Never an email address. */
export const ANONYMOUS_MEMBER = 'חבר בקבוצה';

export function authorLabel(displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim();
  return name === '' ? ANONYMOUS_MEMBER : name;
}

/** One or two letters for an avatar with no picture. */
export function initials(displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim();
  // No name, no letter: an empty circle reads as "no picture yet", where a
  // bullet read as a stray character (QA 22.09.2026, acceptance finding 35).
  if (name === '') return '';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return [...words[0]!][0] ?? '';
  return `${[...words[0]!][0] ?? ''}${[...words[words.length - 1]!][0] ?? ''}`;
}

/**
 * A one-line preview of the message a reply points at.
 *
 * The parent may be missing from the loaded page — it can be hundreds of
 * messages up — and that is a state to render, not an error: the reply still
 * happened.
 */
export function replyPreview(
  parent: ChatMessage | undefined,
  authorName: string | null | undefined,
): { name: string; text: string } | null {
  if (!parent) return null;
  const text = bodyOf(parent);
  return {
    name: authorLabel(authorName),
    text: text.length > 90 ? `${text.slice(0, 90)}…` : text,
  };
}
