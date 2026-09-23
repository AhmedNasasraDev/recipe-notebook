import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupsScreen } from './GroupsScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { FakeGroupSeed } from '../test/fakeGroups.js';
import type { GroupSummary } from '../features/groups/types.js';

const seed = (over: Partial<FakeGroupSeed> = {}): FakeGroupSeed => ({
  id: 'g1',
  name: 'קונדיטוריה מקצועית',
  kind: 'בית ספר לקונדיטוריה',
  note: '',
  code: 'PT-4K9Q',
  joinBy: ['invite', 'code'],
  myRole: 'member',
  roster: [
    {
      userId: 'me',
      displayName: 'אחמד',
      avatarPath: null,
      role: 'member',
      rank: 1,
      joinedAt: '2026-09-01T00:00:00Z',
    },
    {
      userId: 'ins',
      displayName: 'רונן',
      avatarPath: null,
      role: 'owner',
      rank: 4,
      joinedAt: '2026-09-01T00:00:00Z',
    },
  ],
  courses: [],
  ...over,
});

const render_ = (opts: Parameters<typeof fakeRepository>[0] = {}) =>
  renderRoute(<GroupsScreen />, {
    path: '/groups',
    route: '/groups',
    repository: fakeRepository({ canWrite: true, source: 'supabase', ...opts }),
  });

describe('the groups list', () => {
  it('lists the account groups with the role and the member count', async () => {
    render_({ groups: { groups: [seed()] } });
    expect(await screen.findByText('קונדיטוריה מקצועית')).toBeInTheDocument();
    expect(screen.getByText('תלמיד')).toBeInTheDocument();
    expect(screen.getByText('2 חברים')).toBeInTheDocument();
  });

  it('says "חבר אחד" rather than "1 חברים"', async () => {
    render_({ groups: { groups: [seed({ roster: [] })] } });
    // An empty roster still means the caller is in it — the fake models the
    // real query's floor of one.
    expect(await screen.findByText('חבר אחד')).toBeInTheDocument();
  });

  it('shows the unread count as a number', async () => {
    render_({
      groups: {
        groups: [seed()],
        messages: [
          {
            id: 'm1',
            seq: 1,
            groupId: 'g1',
            authorId: 'ins',
            body: 'שיעור נדחה',
            kind: 'text',
            replyToId: null,
            editedAt: null,
            deletedAt: null,
            createdAt: '2026-09-17T09:00:00Z',
          },
          {
            id: 'm2',
            seq: 2,
            groupId: 'g1',
            authorId: 'ins',
            body: 'להביא סינר',
            kind: 'text',
            replyToId: null,
            editedAt: null,
            deletedAt: null,
            createdAt: '2026-09-17T09:05:00Z',
          },
        ],
      },
    });
    expect(await screen.findByLabelText('2 הודעות שלא נקראו')).toBeInTheDocument();
  });

  it('does not show a badge when there is nothing unread', async () => {
    render_({ groups: { groups: [seed()] } });
    await screen.findByText('קונדיטוריה מקצועית');
    expect(screen.queryByLabelText(/הודעות שלא נקראו/)).not.toBeInTheDocument();
  });

  it('links each group to its own screen', async () => {
    render_({ groups: { groups: [seed()] } });
    const link = await screen.findByRole('link', { name: /קונדיטוריה מקצועית/ });
    expect(link).toHaveAttribute('href', '/group/g1');
  });
});

describe('the empty state', () => {
  it('names the four ways in instead of offering a search box', async () => {
    // §10.2: a private group does not appear in search, so a search field
    // would either be theatre or a hole in the privacy model.
    render_({ groups: { groups: [] } });
    expect(await screen.findByText('אינכם חברים באף קבוצה.')).toBeInTheDocument();
    expect(screen.getByText('הזמנה אישית')).toBeInTheDocument();
    expect(screen.getByText('קישור פרטי')).toBeInTheDocument();
    expect(screen.getByText('קוד קבוצה')).toBeInTheDocument();
    expect(screen.getByText('בקשה לאישור מנהל')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('creating a group', () => {
  it('refuses a group with no name, and says so before asking the server', async () => {
    const onCreate = vi.fn();
    render_({ groups: { groups: [] } });
    await screen.findByText('אינכם חברים באף קבוצה.');
    await userEvent.click(screen.getByRole('button', { name: 'קבוצה חדשה' }));
    await userEvent.click(screen.getByRole('button', { name: 'יצירת הקבוצה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לקבוצה צריך שם');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates the group and shows it in the list', async () => {
    render_({ groups: { groups: [] } });
    await screen.findByText('אינכם חברים באף קבוצה.');
    await userEvent.click(screen.getByRole('button', { name: 'קבוצה חדשה' }));
    await userEvent.type(screen.getByLabelText('שם הקבוצה'), 'צוות מטבח');
    await userEvent.click(screen.getByRole('button', { name: 'יצירת הקבוצה' }));
    expect(await screen.findByText('צוות מטבח')).toBeInTheDocument();
    // The creator is the owner — that is what `create_group` writes.
    expect(screen.getByText('בעל הקבוצה')).toBeInTheDocument();
  });
});

describe('joining with a code', () => {
  it('says the request is waiting for approval, naming the group', async () => {
    // §6: the code creates a REQUEST. Saying "you joined" would be a lie the
    // database would then contradict.
    render_({ groups: { groups: [seed({ myRole: 'member' })] } });
    await screen.findByText('קונדיטוריה מקצועית');
    await userEvent.click(screen.getByRole('button', { name: 'הצטרפות עם קוד' }));
    await userEvent.type(screen.getByLabelText('קוד הקבוצה'), 'PT-4K9Q');
    await userEvent.click(screen.getByRole('button', { name: 'שליחת בקשה' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('קונדיטוריה מקצועית');
    expect(status).toHaveTextContent('הקוד לבדו אינו מכניס לקבוצה');
  });

  it('reports a code that matches nothing, without saying which codes exist', async () => {
    render_({ groups: { groups: [seed()] } });
    await screen.findByText('קונדיטוריה מקצועית');
    await userEvent.click(screen.getByRole('button', { name: 'הצטרפות עם קוד' }));
    await userEvent.type(screen.getByLabelText('קוד הקבוצה'), 'NOPE');
    await userEvent.click(screen.getByRole('button', { name: 'שליחת בקשה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הקוד אינו מתאים');
  });

  it('lists a waiting request WITHOUT inventing a group name', async () => {
    render_({
      groups: {
        groups: [],
        requests: [
          {
            id: 'r1',
            groupId: 'g9',
            userId: 'me',
            note: '',
            status: 'pending',
            createdAt: '2026-09-17T08:00:00Z',
            decidedAt: null,
          },
        ],
      },
    });
    expect(await screen.findByText('בקשת הצטרפות')).toBeInTheDocument();
    expect(
      screen.getByText(/שם הקבוצה יוצג כאן רק לאחר שהבקשה תאושר/),
    ).toBeInTheDocument();
  });

  it('withdraws a waiting request', async () => {
    render_({
      groups: {
        groups: [],
        requests: [
          {
            id: 'r1',
            groupId: 'g9',
            userId: 'me',
            note: '',
            status: 'pending',
            createdAt: '2026-09-17T08:00:00Z',
            decidedAt: null,
          },
        ],
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'ביטול הבקשה' }));
    await waitFor(() =>
      expect(screen.queryByText('בקשת הצטרפות')).not.toBeInTheDocument(),
    );
  });
});

describe('a session with no server', () => {
  it('explains it once and offers no group actions at all', async () => {
    // The local demo repository refuses every group write. A button that
    // always fails is worse than no button.
    renderRoute(<GroupsScreen />, {
      path: '/groups',
      route: '/groups',
      repository: fakeRepository(),
    });
    expect(
      await screen.findByText(/בהתקנה הזאת אין חיבור לשרת, ולכן אין כאן קבוצות/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'קבוצה חדשה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הצטרפות עם קוד' })).not.toBeInTheDocument();
  });
});

describe('when the list cannot be loaded', () => {
  it('says so rather than showing an empty notebook of groups', async () => {
    const repo = fakeRepository({ canWrite: true });
    const broken = {
      ...repo,
      listGroups: async (): Promise<GroupSummary[]> => {
        throw new Error('טעינת הקבוצות נכשלה.');
      },
    };
    renderRoute(<GroupsScreen />, { path: '/groups', route: '/groups', repository: broken });
    expect(await screen.findByRole('alert')).toHaveTextContent('טעינת הקבוצות נכשלה');
  });
});
