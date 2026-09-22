import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_MEMBER,
  DELETED_TEXT,
  authorLabel,
  bodyOf,
  byDay,
  canDelete,
  canEdit,
  dayLabel,
  initials,
  mergeMessages,
  newestSeq,
  olderCursor,
  replyPreview,
  unreadCount,
  unreadDividerSeq,
} from './chat.js';
import type { ChatMessage } from './types.js';

const ME = 'user-me';
const THEM = 'user-them';

function msg(over: Partial<ChatMessage> & { seq: number }): ChatMessage {
  return {
    id: `m${over.seq}`,
    groupId: 'g1',
    authorId: THEM,
    body: `הודעה ${over.seq}`,
    kind: 'text',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-09-17T10:00:00Z',
    ...over,
  };
}

describe('what a deleted message shows', () => {
  it('renders the tombstone, never the body', () => {
    const gone = msg({ seq: 1, body: '', deletedAt: '2026-09-17T11:00:00Z' });
    expect(bodyOf(gone)).toBe(DELETED_TEXT);
  });

  it('renders the tombstone even if a body somehow arrived with it', () => {
    // 0035 empties the column, but a client must not depend on that to avoid
    // showing removed text: the rule is the flag, not the emptiness.
    const gone = msg({ seq: 1, body: 'טקסט שהוסר', deletedAt: '2026-09-17T11:00:00Z' });
    expect(bodyOf(gone)).toBe(DELETED_TEXT);
  });

  it('leaves a live message alone', () => {
    expect(bodyOf(msg({ seq: 1, body: 'שלום' }))).toBe('שלום');
  });
});

describe('canEdit / canDelete mirror the trigger', () => {
  const mine = msg({ seq: 1, authorId: ME });
  const theirs = msg({ seq: 2, authorId: THEM });
  const deleted = msg({ seq: 3, authorId: ME, deletedAt: '2026-09-17T11:00:00Z' });

  it('lets the author edit their own, and nobody else edit it', () => {
    expect(canEdit(mine, { userId: ME, role: 'member' })).toBe(true);
    expect(canEdit(theirs, { userId: ME, role: 'member' })).toBe(false);
  });

  it('does NOT let a moderator edit somebody else message — the asymmetry', () => {
    expect(canEdit(theirs, { userId: ME, role: 'owner' })).toBe(false);
    expect(canEdit(theirs, { userId: ME, role: 'instructor' })).toBe(false);
    // ...and the trigger is what actually refuses it.
    const sql = readFileSync(
      join(import.meta.dirname, '../../../../../supabase/migrations/0035_removed_message_body.sql'),
      'utf8',
    );
    expect(sql).toMatch(/if not v_is_author then[\s\S]{0,400}raise exception/);
  });

  it('lets a moderator delete somebody else message', () => {
    expect(canDelete(theirs, { userId: ME, role: 'instructor' })).toBe(true);
    expect(canDelete(theirs, { userId: ME, role: 'member' })).toBe(false);
    expect(canDelete(mine, { userId: ME, role: 'member' })).toBe(true);
  });

  it('offers neither on a message already deleted', () => {
    expect(canEdit(deleted, { userId: ME, role: 'owner' })).toBe(false);
    expect(canDelete(deleted, { userId: ME, role: 'owner' })).toBe(false);
  });
});

describe('mergeMessages', () => {
  it('orders by seq ascending, whatever order the pages arrived in', () => {
    const merged = mergeMessages([msg({ seq: 9 })], [msg({ seq: 2 }), msg({ seq: 5 })]);
    expect(merged.map((m) => m.seq)).toEqual([2, 5, 9]);
  });

  it('does not duplicate a message that arrived twice', () => {
    // The broadcast for a message the page request already returned.
    const merged = mergeMessages([msg({ seq: 3 })], [msg({ seq: 3 })]);
    expect(merged).toHaveLength(1);
  });

  it('takes the LATER copy, so an edit replaces what is on screen', () => {
    const before = msg({ seq: 3, body: 'טעות' });
    const after = msg({ seq: 3, body: 'תוקן', editedAt: '2026-09-17T12:00:00Z' });
    expect(mergeMessages([before], [after])[0]?.body).toBe('תוקן');
  });

  it('takes the later copy for a delete too', () => {
    const live = msg({ seq: 4, body: 'משהו' });
    const gone = msg({ seq: 4, body: '', deletedAt: '2026-09-17T12:00:00Z' });
    expect(bodyOf(mergeMessages([live], [gone])[0]!)).toBe(DELETED_TEXT);
  });

  it('survives an empty merge', () => {
    expect(mergeMessages()).toEqual([]);
    expect(mergeMessages([], [])).toEqual([]);
  });
});

describe('cursors', () => {
  const page = [msg({ seq: 12 }), msg({ seq: 4 }), msg({ seq: 7 })];

  it('pages back from the LOWEST seq in hand', () => {
    expect(olderCursor(page)).toBe(4);
  });

  it('marks read at the HIGHEST seq in hand', () => {
    expect(newestSeq(page)).toBe(12);
  });

  it('answers null on an empty list rather than 0', () => {
    // 0 would ask for "everything before the beginning" and mark a group read
    // at a position no message has.
    expect(olderCursor([])).toBeNull();
    expect(newestSeq([])).toBeNull();
  });
});

describe('the unread divider', () => {
  const list = [
    msg({ seq: 1, authorId: THEM }),
    msg({ seq: 2, authorId: ME }),
    msg({ seq: 3, authorId: THEM }),
    msg({ seq: 4, authorId: THEM }),
  ];

  it('sits at the first message above the marker', () => {
    expect(unreadDividerSeq(list, 2, ME)).toBe(3);
  });

  it('skips my own messages — a divider above my own sentence is noise', () => {
    expect(unreadDividerSeq(list, 1, ME)).toBe(3);
  });

  it('skips a deleted message, so the line does not land on a tombstone', () => {
    const withGone = [
      msg({ seq: 5, authorId: THEM, deletedAt: '2026-09-17T11:00:00Z' }),
      msg({ seq: 6, authorId: THEM }),
    ];
    expect(unreadDividerSeq(withGone, 4, ME)).toBe(6);
  });

  it('is null when everything is read', () => {
    expect(unreadDividerSeq(list, 4, ME)).toBeNull();
  });

  it('counts the same messages it would draw a line above', () => {
    // The local count must agree with group_unread_counts: above the marker,
    // not mine, not deleted. A UI that counted differently would show a badge
    // of 3 on a conversation the server calls fully read.
    expect(unreadCount(list, 2, ME)).toBe(2);
    expect(unreadCount(list, 4, ME)).toBe(0);
    const sql = readFileSync(
      join(import.meta.dirname, '../../../../../supabase/migrations/0032_group_chat.sql'),
      'utf8',
    );
    const fn = sql.slice(sql.indexOf('function public.group_unread_counts'));
    expect(fn).toMatch(/deleted_at is null/);
    expect(fn).toMatch(/author_id <>/);
  });
});

describe('day grouping', () => {
  const now = new Date('2026-09-17T20:00:00Z');

  it('labels today and yesterday by name', () => {
    expect(dayLabel('2026-09-17T09:00:00Z', now)).toBe('היום');
    expect(dayLabel('2026-09-16T09:00:00Z', now)).toBe('אתמול');
  });

  it('labels an older day by its date', () => {
    expect(dayLabel('2026-09-10T09:00:00Z', now)).toMatch(/ספטמבר/);
  });

  it('adds the year once the day is in another one', () => {
    expect(dayLabel('2025-09-10T09:00:00Z', now)).toMatch(/2025/);
  });

  it('splits a list into consecutive days, each labelled once', () => {
    const days = byDay(
      [
        msg({ seq: 1, createdAt: '2026-09-16T08:00:00Z' }),
        msg({ seq: 2, createdAt: '2026-09-16T09:00:00Z' }),
        msg({ seq: 3, createdAt: '2026-09-17T08:00:00Z' }),
      ],
      now,
    );
    expect(days).toHaveLength(2);
    expect(days[0]?.messages).toHaveLength(2);
    expect(days[1]?.label).toBe('היום');
  });

  it('does not crash on an unparseable date', () => {
    expect(dayLabel('not-a-date', now)).toBe('');
  });
});

describe('naming an author without disclosing anything', () => {
  it('falls back to a neutral label rather than an identifier', () => {
    expect(authorLabel(null)).toBe(ANONYMOUS_MEMBER);
    expect(authorLabel('')).toBe(ANONYMOUS_MEMBER);
    expect(authorLabel('   ')).toBe(ANONYMOUS_MEMBER);
    // Not an email address and not a uuid — §10.1.
    expect(ANONYMOUS_MEMBER).not.toMatch(/@/);
  });

  it('uses the display name when there is one', () => {
    expect(authorLabel('  אחמד נסאסרה ')).toBe('אחמד נסאסרה');
  });

  it('builds initials from the first and last word', () => {
    expect(initials('אחמד נסאסרה')).toBe('אנ');
    expect(initials('רונן')).toBe('ר');
    expect(initials(null)).toBe('');
  });
});

describe('replyPreview', () => {
  it('names the parent author and quotes one line', () => {
    const parent = msg({ seq: 1, body: 'מה הטמפרטורה?' });
    expect(replyPreview(parent, 'רונן')).toEqual({ name: 'רונן', text: 'מה הטמפרטורה?' });
  });

  it('truncates a long parent', () => {
    const parent = msg({ seq: 1, body: 'א'.repeat(200) });
    expect(replyPreview(parent, 'רונן')?.text).toHaveLength(91);
  });

  it('shows the tombstone when the parent was deleted', () => {
    const parent = msg({ seq: 1, body: '', deletedAt: '2026-09-17T11:00:00Z' });
    expect(replyPreview(parent, 'רונן')?.text).toBe(DELETED_TEXT);
  });

  it('answers null when the parent is not in the loaded page', () => {
    // It can be hundreds of messages up. The reply still happened.
    expect(replyPreview(undefined, 'רונן')).toBeNull();
  });
});
