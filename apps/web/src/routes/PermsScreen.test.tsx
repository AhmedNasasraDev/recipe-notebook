import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermsScreen } from './PermsScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { FakeGroupOptions, FakeGroupSeed } from '../test/fakeGroups.js';
import type { GroupRole } from '../lib/database.types.js';
import { PERM_DEFAULT } from '../features/groups/roles.js';

const member = (userId: string, name: string, role: GroupRole, rank: number) => ({
  userId,
  displayName: name,
  avatarPath: null,
  role,
  rank,
  joinedAt: '2026-09-01T00:00:00Z',
});

const seed = (role: GroupRole, over: Partial<FakeGroupSeed> = {}): FakeGroupSeed => ({
  id: 'g1',
  name: 'קונדיטוריה',
  kind: '',
  note: '',
  code: 'PT-4K9Q',
  joinBy: ['invite', 'code'],
  myRole: role,
  roster: [
    member('me', 'אחמד', role, 4),
    member('stu', 'נועה בר־אור', 'member', 1),
    member('ins', 'רונן', 'instructor', 2),
  ],
  courses: [
    {
      id: 'c1',
      groupId: 'g1',
      name: 'בצקים',
      ord: 0,
      lessons: [
        {
          id: 'l1',
          courseId: 'c1',
          name: 'שיעור 1',
          date: null,
          summary: '',
          done: false,
          ord: 0,
          items: [
            {
              id: 'i1',
              lessonId: 'l1',
              recipeId: 'r1',
              name: 'בריוש נאנט',
              ord: 0,
              perms: { ...PERM_DEFAULT },
              createdAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
    },
  ],
  ...over,
});

const render_ = (groups: FakeGroupOptions) =>
  renderRoute(<PermsScreen />, {
    path: '/group/:groupId/perms',
    route: '/group/g1/perms',
    repository: fakeRepository({ canWrite: true, source: 'supabase', groups }),
  });

describe('who may open this screen', () => {
  it('turns a student away, and says the server is what enforces it', async () => {
    render_({ groups: [seed('member')] });
    expect(
      await screen.findByText(/המסך הזה פתוח למדריכים ולמנהלים בלבד/),
    ).toBeInTheDocument();
    expect(screen.queryByText('חברים ותפקידים')).not.toBeInTheDocument();
  });

  it('opens for an instructor', async () => {
    render_({ groups: [seed('instructor')] });
    expect(await screen.findByText('חברים ותפקידים')).toBeInTheDocument();
  });
});

describe('members and roles', () => {
  it('lists the members by name, never by an address', async () => {
    render_({ groups: [seed('owner')] });
    expect(await screen.findByText('נועה בר־אור')).toBeInTheDocument();
    // `group_roster` does not return an email, on purpose (§10.1).
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('lets the owner change a member role', async () => {
    const onSetMemberRole = vi.fn();
    render_({ groups: [seed('owner')], onSetMemberRole });
    const picker = await screen.findByLabelText('תפקיד של נועה בר־אור');
    await userEvent.selectOptions(picker, 'instructor');
    await waitFor(() => expect(onSetMemberRole).toHaveBeenCalledWith('stu', 'instructor'));
  });

  it('offers only roles BELOW the caller own, so nobody can promote a peer', async () => {
    // `members_role` requires `role_rank(role) < group_rank(group_id)` on both
    // sides of the policy. An admin may not create another admin.
    render_({ groups: [seed('admin', { roster: [member('me', 'אחמד', 'admin', 3), member('stu', 'נועה בר־אור', 'member', 1)] })] });
    const picker = await screen.findByLabelText('תפקיד של נועה בר־אור');
    const options = [...picker.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['תלמיד', 'מדריך']);
    expect(options).not.toContain('מנהל');
    expect(options).not.toContain('בעל הקבוצה');
  });

  it('gives an instructor no role controls at all', async () => {
    render_({ groups: [seed('instructor')] });
    await screen.findByText('חברים ותפקידים');
    expect(screen.queryByLabelText('תפקיד של נועה בר־אור')).not.toBeInTheDocument();
    expect(screen.getByText(/שינוי תפקיד והסרת חבר הם למנהל ולבעל הקבוצה/)).toBeInTheDocument();
  });

  it('removes a member', async () => {
    const onRemoveMember = vi.fn();
    render_({ groups: [seed('owner')], onRemoveMember });
    await screen.findByText('נועה בר־אור');
    await userEvent.click(screen.getAllByRole('button', { name: 'הסרה' })[0]!);
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalled());
  });

  it('offers nothing against the owner', async () => {
    render_({
      groups: [
        seed('admin', {
          roster: [member('me', 'אחמד', 'admin', 3), member('own', 'רונן', 'owner', 4)],
        }),
      ],
    });
    await screen.findByText('רונן');
    expect(screen.getByText('בעל הקבוצה — אין מה לשנות')).toBeInTheDocument();
    expect(screen.queryByLabelText('תפקיד של רונן')).not.toBeInTheDocument();
  });

  it('shows the refusal when the server declines a promotion', async () => {
    const repo = fakeRepository({
      canWrite: true,
      source: 'supabase',
      groups: { groups: [seed('owner')] },
    });
    const broken = {
      ...repo,
      setMemberRole: async () => {
        throw new Error('אין לכם הרשאה לפעולה הזאת.');
      },
    };
    renderRoute(<PermsScreen />, {
      path: '/group/:groupId/perms',
      route: '/group/g1/perms',
      repository: broken,
    });
    await userEvent.selectOptions(
      await screen.findByLabelText('תפקיד של נועה בר־אור'),
      'instructor',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('אין לכם הרשאה');
  });
});

describe('join requests', () => {
  const request = {
    id: 'r1',
    groupId: 'g1',
    userId: 'asker',
    note: 'נועה מהמחזור הקודם',
    status: 'pending' as const,
    createdAt: '2026-09-17T08:00:00Z',
    decidedAt: null,
  };

  it('says when there are none', async () => {
    render_({ groups: [seed('instructor')] });
    expect(await screen.findByText('אין בקשות שממתינות לאישור.')).toBeInTheDocument();
  });

  it('approves a request, which creates the membership', async () => {
    const onApproveJoin = vi.fn();
    render_({ groups: [seed('instructor')], requests: [request], onApproveJoin });
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(onApproveJoin).toHaveBeenCalledWith('g1', 'asker'));
    // The request row is gone, because approval deletes it — there is no
    // 'accepted' status (0031).
    await waitFor(() =>
      expect(screen.getByText('אין בקשות שממתינות לאישור.')).toBeInTheDocument(),
    );
  });

  it('declines a request, and it stops waiting', async () => {
    render_({ groups: [seed('instructor')], requests: [request] });
    await userEvent.click(await screen.findByRole('button', { name: 'דחייה' }));
    await waitFor(() =>
      expect(screen.getByText('אין בקשות שממתינות לאישור.')).toBeInTheDocument(),
    );
  });
});

describe('invitations', () => {
  it('creates an open link when no address is given', async () => {
    render_({ groups: [seed('instructor')] });
    await userEvent.click(await screen.findByRole('button', { name: 'יצירת הזמנה' }));
    expect(await screen.findByRole('status')).toHaveTextContent('נוצר קישור הזמנה');
    // Twice on screen on purpose: once for the link just created, and once on
    // the invitation's own row in the list below. As a COPY action, not as
    // sixty-four characters to select by hand (QA 22.09.2026, acceptance
    // finding 9).
    expect(screen.getAllByRole('button', { name: 'העתקת הקישור' })).toHaveLength(2);
    expect(screen.queryByText(/\/join\/token-1$/)).not.toBeInTheDocument();
  });

  it('copies the link to the clipboard, and shows the link itself only when it cannot', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render_({ groups: [seed('instructor')] });
    await userEvent.click(await screen.findByRole('button', { name: 'יצירת הזמנה' }));
    const [copy] = await screen.findAllByRole('button', { name: 'העתקת הקישור' });
    await userEvent.click(copy!);
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/token-1$/));
    expect(await screen.findByRole('button', { name: 'הקישור הועתק ✓' })).toBeInTheDocument();

    // No clipboard at all: the characters come back, as the only way left.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new Error('denied'); } },
      configurable: true,
    });
    const [second] = screen.getAllByRole('button', { name: 'העתקת הקישור' });
    await userEvent.click(second!);
    expect(await screen.findByLabelText('קישור ההזמנה')).toHaveTextContent(/\/join\/token-1$/);
  });

  it('refuses an address that is obviously not one, without asking the server', async () => {
    const onCreateInvite = vi.fn();
    render_({ groups: [seed('instructor')], onCreateInvite });
    await userEvent.type(
      await screen.findByLabelText('כתובת מייל (לא חובה)'),
      'לא-כתובת',
    );
    await userEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('אינה נראית תקינה');
    expect(onCreateInvite).not.toHaveBeenCalled();
  });

  it('says the mail was sent when it was', async () => {
    render_({ groups: [seed('instructor')], inviteEmail: { sent: true } });
    await userEvent.type(
      await screen.findByLabelText('כתובת מייל (לא חובה)'),
      'student@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'הזמנה נשלחה לstudent@example.com',
    );
  });

  it('SAYS THE MAIL DID NOT GO OUT when the service is not connected', async () => {
    // The one failure mode that must never be silent: an instructor who
    // believes a student was emailed will wait for somebody who was not told.
    render_({
      groups: [seed('instructor')],
      inviteEmail: {
        sent: false,
        reason: 'שירות המייל אינו מחובר בפרויקט הזה. ההזמנה נוצרה — אפשר להעתיק את הקישור.',
      },
    });
    await userEvent.type(
      await screen.findByLabelText('כתובת מייל (לא חובה)'),
      'student@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('שירות המייל אינו מחובר');
    expect(status).not.toHaveTextContent('נשלחה');
    // ...and the link is on screen, so the invitation is still usable.
    expect(screen.getAllByRole('button', { name: 'העתקת הקישור' }).length).toBeGreaterThan(0);
  });

  it('lists an invitation with its state and how long it has left', async () => {
    render_({
      groups: [seed('instructor')],
      invites: [
        {
          id: 'inv1',
          email: 'a@example.com',
          label: 'מחזור י״ד',
          token: 'tok',
          status: 'pending',
          expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          createdAt: '2026-09-17T08:00:00Z',
          usedAt: null,
          revokedAt: null,
          replacesId: null,
        },
      ],
    });
    expect(await screen.findByText(/ממתינה · פגה בתוך 3 ימים · מחזור י״ד/)).toBeInTheDocument();
  });

  it('calls an expired invitation expired, though no column says so', async () => {
    render_({
      groups: [seed('instructor')],
      invites: [
        {
          id: 'inv1',
          email: 'a@example.com',
          label: '',
          token: 'tok',
          status: 'pending',
          expiresAt: '2020-01-01T00:00:00Z',
          createdAt: '2019-12-25T00:00:00Z',
          usedAt: null,
          revokedAt: null,
          replacesId: null,
        },
      ],
    });
    expect(await screen.findByText('פג תוקף')).toBeInTheDocument();
    // An expired invitation is not offered for cancelling — there is nothing
    // left to cancel — but it can be sent again.
    expect(screen.queryByRole('button', { name: 'ביטול' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שליחה מחדש' })).toBeInTheDocument();
  });

  it('does not offer to resend an invitation that was already used', async () => {
    render_({
      groups: [seed('instructor')],
      invites: [
        {
          id: 'inv1',
          email: 'a@example.com',
          label: '',
          token: 'tok',
          status: 'accepted',
          expiresAt: '2026-09-24T00:00:00Z',
          createdAt: '2026-09-17T08:00:00Z',
          usedAt: '2026-09-18T08:00:00Z',
          revokedAt: null,
          replacesId: null,
        },
      ],
    });
    expect(await screen.findByText('נוצלה')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שליחה מחדש' })).not.toBeInTheDocument();
  });

  it('says that resending kills the old link', async () => {
    render_({
      groups: [seed('instructor')],
      invites: [
        {
          id: 'inv1',
          email: 'a@example.com',
          label: '',
          token: 'tok',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: '2026-09-17T08:00:00Z',
          usedAt: null,
          revokedAt: null,
          replacesId: null,
        },
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'שליחה מחדש' }));
    expect(await screen.findByRole('status')).toHaveTextContent('הקישור הישן הפסיק לעבוד');
  });

  it('revokes an invitation', async () => {
    render_({
      groups: [seed('instructor')],
      invites: [
        {
          id: 'inv1',
          email: 'a@example.com',
          label: '',
          token: 'tok',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: '2026-09-17T08:00:00Z',
          usedAt: null,
          revokedAt: null,
          replacesId: null,
        },
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'ביטול' }));
    expect(await screen.findByText('בוטלה')).toBeInTheDocument();
  });

  it('explains that an addressed invitation only works for that address', async () => {
    render_({ groups: [seed('instructor')] });
    expect(
      await screen.findByText(/מי שמקבל את הקישור בטעות אינו\s*יכול להצטרף באמצעותו/),
    ).toBeInTheDocument();
  });
});

describe('§10.4 — the five toggles', () => {
  it('shows every item in the group with its five permissions', async () => {
    render_({ groups: [seed('instructor')] });
    await screen.findByText('הרשאות לכל מתכון');
    expect(screen.getByText('בריוש נאנט')).toBeInTheDocument();
    expect(screen.getByLabelText('צפייה במתכון')).toBeChecked();
    expect(screen.getByLabelText('שמירה למחברת האישית')).not.toBeChecked();
    expect(screen.getByLabelText('הדפסה')).not.toBeChecked();
    expect(screen.getByLabelText('הורדת קובץ')).not.toBeChecked();
    expect(screen.getByLabelText('שיתוף מחוץ לקבוצה')).not.toBeChecked();
  });

  it('turns one on, sending all five so the others are not lost', async () => {
    const onSetItemPerms = vi.fn();
    render_({ groups: [seed('instructor')], onSetItemPerms });
    await userEvent.click(await screen.findByLabelText('שמירה למחברת האישית'));
    await waitFor(() =>
      expect(onSetItemPerms).toHaveBeenCalledWith('i1', {
        view: true,
        save: true,
        print: false,
        download: false,
        shareOut: false,
      }),
    );
  });

  it('states the default and what turning view off does', async () => {
    render_({ groups: [seed('instructor')] });
    expect(
      await screen.findByText(/בלי צפייה המתכון לא מופיע\s*לתלמיד כלל/),
    ).toBeInTheDocument();
  });
});
