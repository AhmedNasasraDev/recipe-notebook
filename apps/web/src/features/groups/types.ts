/*
  The shapes the group screens work in.

  Separate from the row types in lib/database.types.ts on purpose: a row is
  what the table holds, and these are what a screen needs — a group summary
  carries the caller's own role and unread count, which live in three different
  places in the database, and an item carries `perms` as an object rather than
  as five columns because §10.4 talks about it as one thing.

  Nothing here is a permission decision. The role a `GroupSummary` carries is
  the role the DATABASE reported; the UI uses it to decide what to OFFER, and
  every offer is checked again by RLS when it is taken up.
*/

import type { GroupRole, JoinMethod, MessageKind } from '../../lib/database.types.js';
import type { ItemPerms } from './roles.js';

export interface GroupSummary {
  id: string;
  name: string;
  /** §10.2's free-text "what kind of group is this" — a school, a kitchen team */
  kind: string;
  note: string;
  /** The join code, for staff to read out. null = this group has none. */
  code: string | null;
  joinBy: JoinMethod[];
  /** the CALLER's role in this group */
  myRole: GroupRole;
  members: number;
  /** unread messages for the caller, from `group_unread_counts` */
  unread: number;
  /** the group's highest message seq, so "mark read" has something to send */
  lastSeq: number;
}

export interface GroupMember {
  userId: string;
  /**
   * Null when the person has no profile row yet, '' when they have one and
   * have not set a name. Both mean "show the neutral label" — and neither is
   * an email address, because §10.1 says a roster may not disclose one.
   */
  displayName: string | null;
  avatarPath: string | null;
  role: GroupRole;
  rank: number;
  joinedAt: string;
}

export interface GroupItem {
  id: string;
  lessonId: string;
  recipeId: string;
  name: string;
  ord: number;
  perms: ItemPerms;
  createdAt: string;
}

export interface GroupLesson {
  id: string;
  courseId: string;
  name: string;
  /** a calendar date — "the lesson on 18.9" is the same lesson in every zone */
  date: string | null;
  summary: string;
  done: boolean;
  ord: number;
  items: GroupItem[];
}

export interface GroupCourse {
  id: string;
  groupId: string;
  name: string;
  ord: number;
  lessons: GroupLesson[];
}

/** One group with its whole §10.3 structure: Group → Course → Lesson → Item. */
export interface GroupDetail extends GroupSummary {
  courses: GroupCourse[];
}

export interface JoinRequestView {
  id: string;
  groupId: string;
  userId: string;
  note: string;
  status: 'pending' | 'rejected' | 'withdrawn';
  createdAt: string;
  decidedAt: string | null;
}

export interface ChatMessage {
  id: string;
  /** the total order: pagination and the unread marker both key on it */
  seq: number;
  groupId: string;
  authorId: string;
  body: string;
  kind: MessageKind;
  replyToId: string | null;
  editedAt: string | null;
  /** non-null = a tombstone. The body arrives empty; see migration 0035. */
  deletedAt: string | null;
  createdAt: string;
}

/** One page of history, plus whether asking again would return more. */
export interface ChatPage {
  messages: ChatMessage[];
  /** false when the oldest message in the group is already in hand */
  hasMore: boolean;
}
