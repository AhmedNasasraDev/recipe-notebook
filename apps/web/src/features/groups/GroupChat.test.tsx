import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from './GroupChat.js';
import { DELETED_TEXT } from './chat.js';
import { fakeRepository, renderRoute } from '../../test/render.js';
import type { FakeGroupOptions, FakeGroupSeed } from '../../test/fakeGroups.js';
import type { ChatMessage, GroupMember } from './types.js';
import type { GroupRole } from '../../lib/database.types.js';

const MEMBERS: GroupMember[] = [
  {
    userId: 'me',
    displayName: 'אחמד נסאסרה',
    avatarPath: null,
    role: 'member',
    rank: 1,
    joinedAt: '2026-09-01T00:00:00Z',
  },
  {
    userId: 'ins',
    displayName: 'רונן אלמוג',
    avatarPath: 'ins/a.webp',
    role: 'owner',
    rank: 4,
    joinedAt: '2026-09-01T00:00:00Z',
  },
  {
    userId: 'nameless',
    displayName: '',
    avatarPath: null,
    role: 'member',
    rank: 1,
    joinedAt: '2026-09-01T00:00:00Z',
  },
];

const msg = (over: Partial<ChatMessage> & { seq: number }): ChatMessage => ({
  id: `m${over.seq}`,
  groupId: 'g1',
  authorId: 'ins',
  body: `הודעה ${over.seq}`,
  kind: 'text',
  replyToId: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-09-17T10:00:00Z',
  ...over,
});

const seed: FakeGroupSeed = {
  id: 'g1',
  name: 'קבוצה',
  kind: '',
  note: '',
  code: null,
  joinBy: ['invite'],
  myRole: 'member',
  roster: MEMBERS,
  courses: [],
};

function render_(
  groups: FakeGroupOptions,
  role: GroupRole = 'member',
  avatarUrls: Record<string, string> = {},
) {
  return renderRoute(
    <GroupChat groupId="g1" role={role} members={MEMBERS} avatarUrls={avatarUrls} />,
    {
      repository: fakeRepository({
        canWrite: true,
        source: 'supabase',
        groups: { groups: [{ ...seed, myRole: role }], ...groups },
      }),
    },
  );
}

describe('the history', () => {
  it('shows messages oldest first, with the day named', async () => {
    render_({
      messages: [
        msg({ seq: 1, body: 'ראשונה', createdAt: '2026-09-16T10:00:00Z' }),
        msg({ seq: 2, body: 'שנייה', createdAt: '2026-09-17T10:00:00Z' }),
      ],
    });
    await screen.findByText('ראשונה');
    const bodies = screen.getAllByText(/ראשונה|שנייה/).map((n) => n.textContent);
    expect(bodies).toEqual(['ראשונה', 'שנייה']);
  });

  it('names the author, and never an identifier', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'ins' })] });
    expect(await screen.findByText('רונן אלמוג')).toBeInTheDocument();
    expect(screen.queryByText(/ins|@/)).not.toBeInTheDocument();
  });

  it('falls back to a neutral label for a member with no name set', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'nameless' })] });
    expect(await screen.findByText('חבר בקבוצה')).toBeInTheDocument();
  });

  it('shows a tombstone for a deleted message and not its body', async () => {
    render_({
      messages: [msg({ seq: 1, body: 'טקסט שהוסר', deletedAt: '2026-09-17T11:00:00Z' })],
    });
    expect(await screen.findByText(DELETED_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('טקסט שהוסר')).not.toBeInTheDocument();
  });

  it('says so when there are no messages at all', async () => {
    render_({ messages: [] });
    expect(await screen.findByText(/אין עדיין הודעות בקבוצה/)).toBeInTheDocument();
  });

  it('marks an edited message as edited', async () => {
    render_({ messages: [msg({ seq: 1, editedAt: '2026-09-17T12:00:00Z' })] });
    expect(await screen.findByText('· נערכה')).toBeInTheDocument();
  });

  it('draws an avatar when there is a signed URL, and initials when there is not', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'ins' }), msg({ seq: 2, authorId: 'me' })] }, 'member', {
      'ins/a.webp': 'blob:avatar',
    });
    await screen.findByText('הודעה 1');
    expect(document.querySelector('img[src="blob:avatar"]')).not.toBeNull();
    expect(screen.getByText('אנ')).toBeInTheDocument();
  });
});

describe('sending', () => {
  it('sends the draft and shows it', async () => {
    const onSendMessage = vi.fn();
    render_({ messages: [], onSendMessage });
    await screen.findByText(/אין עדיין הודעות/);
    await userEvent.type(screen.getByLabelText('הודעה חדשה'), 'מתי השיעור?');
    await userEvent.click(screen.getByRole('button', { name: 'שליחה' }));
    expect(await screen.findByText('מתי השיעור?')).toBeInTheDocument();
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps the send button disabled while the draft is empty', async () => {
    render_({ messages: [] });
    await screen.findByText(/אין עדיין הודעות/);
    expect(screen.getByRole('button', { name: 'שליחה' })).toBeDisabled();
  });

  it('offers הכרזה to an instructor and not to a member', async () => {
    render_({ messages: [] }, 'instructor');
    expect(await screen.findByLabelText('הכרזה')).toBeInTheDocument();
  });

  it('does not offer הכרזה to a member — the insert policy would refuse it', async () => {
    render_({ messages: [] }, 'member');
    await screen.findByText(/אין עדיין הודעות/);
    expect(screen.queryByLabelText('הכרזה')).not.toBeInTheDocument();
  });

  it('reports a refusal instead of leaving the message on screen', async () => {
    // The fake enforces the rank model, so this is the same refusal RLS gives.
    const repo = fakeRepository({ canWrite: true, source: 'supabase', groups: { groups: [seed] } });
    const broken = {
      ...repo,
      sendMessage: async () => {
        throw new Error('אין לכם הרשאה לפעולה הזאת.');
      },
    };
    renderRoute(
      <GroupChat groupId="g1" role="member" members={MEMBERS} avatarUrls={{}} />,
      { repository: broken },
    );
    await screen.findByText(/אין עדיין הודעות/);
    await userEvent.type(screen.getByLabelText('הודעה חדשה'), 'שלום');
    await userEvent.click(screen.getByRole('button', { name: 'שליחה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('אין לכם הרשאה');
  });
});

describe('editing and deleting — the asymmetry', () => {
  it('offers edit on my own message', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'me' })] });
    await screen.findByText('הודעה 1');
    expect(screen.getByRole('button', { name: 'עריכה' })).toBeInTheDocument();
  });

  it('does NOT offer edit on somebody else message, even to the owner', async () => {
    // Putting different words under another person's name is worse than
    // deleting the message, and the trigger refuses it too (0035).
    render_({ messages: [msg({ seq: 1, authorId: 'ins' })] }, 'owner');
    await screen.findByText('הודעה 1');
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מחיקה' })).toBeInTheDocument();
  });

  it('does not offer delete on somebody else message to a plain member', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'ins' })] }, 'member');
    await screen.findByText('הודעה 1');
    expect(screen.queryByRole('button', { name: 'מחיקה' })).not.toBeInTheDocument();
  });

  it('saves an edit', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'me', body: 'טעות' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'עריכה' }));
    const box = screen.getByLabelText('עריכת ההודעה');
    await userEvent.clear(box);
    await userEvent.type(box, 'תוקן');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('תוקן')).toBeInTheDocument();
    expect(screen.queryByText('טעות')).not.toBeInTheDocument();
  });

  it('refuses to save an empty edit, and says to delete instead', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'me', body: 'משהו' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'עריכה' }));
    await userEvent.clear(screen.getByLabelText('עריכת ההודעה'));
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('אפשר למחוק אותה במקום');
  });

  it('asks before deleting, and says the text will not come back', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'me' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'מחיקה' }));
    expect(screen.getByText(/היא לא תחזור/)).toBeInTheDocument();
  });

  it('deletes, and the message becomes a tombstone', async () => {
    render_({ messages: [msg({ seq: 1, authorId: 'me', body: 'למחוק אותי' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'מחיקה' }));
    const confirm = screen.getAllByRole('button', { name: 'מחיקה' }).at(-1);
    await userEvent.click(confirm!);
    expect(await screen.findByText(DELETED_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('למחוק אותי')).not.toBeInTheDocument();
  });

  it('offers neither edit nor delete on a message already deleted', async () => {
    render_({
      messages: [msg({ seq: 1, authorId: 'me', body: '', deletedAt: '2026-09-17T11:00:00Z' })],
    });
    await screen.findByText(DELETED_TEXT);
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'מחיקה' })).not.toBeInTheDocument();
  });
});

describe('replies', () => {
  it('quotes the message being answered while composing', async () => {
    render_({ messages: [msg({ seq: 1, body: 'מה הטמפרטורה?' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'תשובה' }));
    expect(screen.getByText(/בתשובה לרונן אלמוג/)).toBeInTheDocument();
  });

  it('shows the quoted parent on a reply that is already in the history', async () => {
    render_({
      messages: [
        msg({ seq: 1, body: 'מה הטמפרטורה?' }),
        msg({ seq: 2, body: '180', authorId: 'me', replyToId: 'm1' }),
      ],
    });
    await screen.findByText('180');
    // The parent appears twice: as itself, and quoted inside the reply.
    expect(screen.getAllByText('מה הטמפרטורה?')).toHaveLength(2);
  });

  it('can cancel the reply before sending', async () => {
    render_({ messages: [msg({ seq: 1 })] });
    await userEvent.click(await screen.findByRole('button', { name: 'תשובה' }));
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByText(/בתשובה ל/)).not.toBeInTheDocument();
  });
});

describe('pagination', () => {
  const many = Array.from({ length: 35 }, (_, i) => msg({ seq: i + 1, body: `שורה ${i + 1}` }));

  it('loads the newest page and offers the older ones', async () => {
    render_({ messages: many });
    expect(await screen.findByText('שורה 35')).toBeInTheDocument();
    // 35 messages, a page of 30: the oldest five are not on screen yet.
    expect(screen.queryByText('שורה 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הודעות קודמות' })).toBeInTheDocument();
  });

  it('pages back from the oldest message in hand, not by an offset', async () => {
    render_({ messages: many });
    await screen.findByText('שורה 35');
    await userEvent.click(screen.getByRole('button', { name: 'הודעות קודמות' }));
    expect(await screen.findByText('שורה 1')).toBeInTheDocument();
    // Nothing duplicated at the page boundary.
    expect(screen.getAllByText('שורה 6')).toHaveLength(1);
  });

  it('does not offer older messages when the whole history is on screen', async () => {
    render_({ messages: [msg({ seq: 1 })] });
    await screen.findByText('הודעה 1');
    expect(screen.queryByRole('button', { name: 'הודעות קודמות' })).not.toBeInTheDocument();
  });
});

describe('unread', () => {
  it('draws the divider above the first unread message that is not mine', async () => {
    render_({
      messages: [
        msg({ seq: 1, authorId: 'ins' }),
        msg({ seq: 2, authorId: 'me' }),
        msg({ seq: 3, authorId: 'ins' }),
      ],
      lastRead: { g1: 2 },
    });
    expect(await screen.findByText('הודעות שלא נקראו')).toBeInTheDocument();
  });

  it('draws no divider when everything was read', async () => {
    render_({ messages: [msg({ seq: 1 })], lastRead: { g1: 1 } });
    await screen.findByText('הודעה 1');
    expect(screen.queryByText('הודעות שלא נקראו')).not.toBeInTheDocument();
  });

  it('marks the conversation read at the newest seq on screen', async () => {
    const onMarkRead = vi.fn();
    render_({ messages: [msg({ seq: 1 }), msg({ seq: 9 })], onMarkRead });
    await screen.findByText('הודעה 9');
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith('g1', 9));
  });
});

describe('live delivery', () => {
  it('shows a message that arrived over the channel', async () => {
    // A holder object, not a `let`: TypeScript narrows a variable assigned
    // only inside a callback to `never` and then refuses the call.
    const box: { emit?: (m: ChatMessage) => void } = {};
    render_({
      messages: [msg({ seq: 1 })],
      onSubscribe: (fn) => {
        box.emit = fn;
      },
    });
    await screen.findByText('הודעה 1');
    box.emit?.(msg({ seq: 2, body: 'הגיעה בשידור' }));
    expect(await screen.findByText('הגיעה בשידור')).toBeInTheDocument();
  });

  it('does not duplicate a message that arrives twice', async () => {
    // The broadcast for a message the page request already returned.
    // A holder object, not a `let`: TypeScript narrows a variable assigned
    // only inside a callback to `never` and then refuses the call.
    const box: { emit?: (m: ChatMessage) => void } = {};
    render_({
      messages: [msg({ seq: 1, body: 'פעם אחת' })],
      onSubscribe: (fn) => {
        box.emit = fn;
      },
    });
    await screen.findByText('פעם אחת');
    box.emit?.(msg({ seq: 1, body: 'פעם אחת' }));
    await waitFor(() => expect(screen.getAllByText('פעם אחת')).toHaveLength(1));
  });

  it('replaces a message when its edit arrives', async () => {
    // A holder object, not a `let`: TypeScript narrows a variable assigned
    // only inside a callback to `never` and then refuses the call.
    const box: { emit?: (m: ChatMessage) => void } = {};
    render_({
      messages: [msg({ seq: 1, body: 'לפני' })],
      onSubscribe: (fn) => {
        box.emit = fn;
      },
    });
    await screen.findByText('לפני');
    box.emit?.(msg({ seq: 1, body: 'אחרי', editedAt: '2026-09-17T12:00:00Z' }));
    expect(await screen.findByText('אחרי')).toBeInTheDocument();
    expect(screen.queryByText('לפני')).not.toBeInTheDocument();
  });

  it('says the live channel is down rather than pretending it is up', async () => {
    render_({ messages: [msg({ seq: 1 })], chatStatus: 'error' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      /אין כרגע חיבור להודעות בזמן אמת/,
    );
  });
});

describe('when the history cannot be loaded', () => {
  it('says so instead of showing an empty conversation', async () => {
    const repo = fakeRepository({ canWrite: true, source: 'supabase', groups: { groups: [seed] } });
    const broken = {
      ...repo,
      chatPage: async () => {
        throw new Error('טעינת ההודעות נכשלה.');
      },
    };
    renderRoute(<GroupChat groupId="g1" role="member" members={MEMBERS} avatarUrls={{}} />, {
      repository: broken,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('טעינת ההודעות נכשלה');
  });
});
