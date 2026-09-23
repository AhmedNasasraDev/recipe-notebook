import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupScreen } from './GroupScreen.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { FakeGroupOptions, FakeGroupSeed } from '../test/fakeGroups.js';
import type { GroupRole } from '../lib/database.types.js';
import { PERM_DEFAULT } from '../features/groups/roles.js';
import { DEMO_RECIPES } from '../data/demoRecipes.js';

const item = (id: string, name: string, perms = PERM_DEFAULT) => ({
  id,
  lessonId: 'l1',
  recipeId: 'r1',
  name,
  ord: 0,
  perms,
  createdAt: '2026-09-01T00:00:00Z',
});

const seed = (role: GroupRole, over: Partial<FakeGroupSeed> = {}): FakeGroupSeed => ({
  id: 'g1',
  name: 'קונדיטוריה מקצועית',
  kind: 'בית ספר לקונדיטוריה',
  note: 'הקבוצה פרטית.',
  code: 'PT-4K9Q',
  joinBy: ['invite', 'code'],
  myRole: role,
  roster: [
    {
      userId: 'me',
      displayName: 'אחמד',
      avatarPath: null,
      role,
      rank: 1,
      joinedAt: '2026-09-01T00:00:00Z',
    },
  ],
  courses: [
    {
      id: 'c1',
      groupId: 'g1',
      name: 'בצקים מועשרים',
      ord: 0,
      lessons: [
        {
          id: 'l1',
          courseId: 'c1',
          name: 'שיעור 1 — בצק שמרים',
          date: '2026-09-18',
          summary: 'לישה ופיתוח גלוטן.',
          done: false,
          ord: 0,
          items: [item('i1', 'בריוש נאנט')],
        },
      ],
    },
  ],
  ...over,
});

const render_ = (groups: FakeGroupOptions, extra: Parameters<typeof fakeRepository>[0] = {}) =>
  renderRoute(<GroupScreen />, {
    path: '/group/:groupId',
    route: '/group/g1',
    repository: fakeRepository({ canWrite: true, source: 'supabase', groups, ...extra }),
  });

describe('the group page', () => {
  it('shows the group, the role and the structure', async () => {
    render_({ groups: [seed('member')] });
    expect(await screen.findByRole('heading', { name: 'קונדיטוריה מקצועית' })).toBeInTheDocument();
    expect(screen.getByText('תלמיד')).toBeInTheDocument();
    expect(screen.getByText('בצקים מועשרים')).toBeInTheDocument();
    expect(screen.getByText(/שיעור 1 — בצק שמרים/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'בריוש נאנט' })).toHaveAttribute(
      'href',
      '/group/g1/item/i1',
    );
  });

  it('says one thing for a group that does not exist and for one that is not mine', async () => {
    // A private group must not be discoverable by the difference between two
    // error messages.
    renderRoute(<GroupScreen />, {
      path: '/group/:groupId',
      route: '/group/nope',
      repository: fakeRepository({ source: 'supabase', groups: { groups: [seed('member')] } }),
    });
    expect(
      await screen.findByText('הקבוצה אינה קיימת, או שאין לחשבון הזה גישה אליה.'),
    ).toBeInTheDocument();
  });

  it('shows the join code to staff and not to a student', async () => {
    render_({ groups: [seed('instructor')] });
    expect(await screen.findByText(/קוד הקבוצה/)).toBeInTheDocument();
  });

  it('does not show the code to a student, who has no use for it', async () => {
    render_({ groups: [seed('member')] });
    await screen.findByRole('heading', { name: 'קונדיטוריה מקצועית' });
    expect(screen.queryByText(/קוד הקבוצה/)).not.toBeInTheDocument();
  });

  it('links staff to the permissions screen, and not a student', async () => {
    render_({ groups: [seed('instructor')] });
    expect(await screen.findByRole('link', { name: 'חברים והרשאות' })).toHaveAttribute(
      'href',
      '/group/g1/perms',
    );
  });

  it('hides the permissions link from a student', async () => {
    render_({ groups: [seed('member')] });
    await screen.findByRole('heading', { name: 'קונדיטוריה מקצועית' });
    expect(screen.queryByRole('link', { name: 'חברים והרשאות' })).not.toBeInTheDocument();
  });

  it('offers a student the way out, and never offers it to the owner', async () => {
    // `guard_owner_membership` refuses an owner leaving; a button that always
    // fails is worse than no button.
    render_({ groups: [seed('member')] });
    expect(await screen.findByRole('button', { name: 'יציאה מהקבוצה' })).toBeInTheDocument();
  });

  it('does not offer the owner a way out of their own group', async () => {
    render_({ groups: [seed('owner')] });
    await screen.findByRole('heading', { name: 'קונדיטוריה מקצועית' });
    expect(screen.queryByRole('button', { name: 'יציאה מהקבוצה' })).not.toBeInTheDocument();
  });
});

describe('what a student is not offered', () => {
  it('has no teaching controls at all', async () => {
    render_({ groups: [seed('member')] });
    await screen.findByText('בצקים מועשרים');
    for (const label of [
      'שיעור חדש',
      'מחיקת הקורס',
      'הוספת מתכון מהמחברת',
      'סימון כהועבר',
      'מחיקת השיעור',
      'הסרה',
    ]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByPlaceholderText('בצקים מועשרים')).not.toBeInTheDocument();
  });

  it('is told the truth about an empty lesson, in the student wording', async () => {
    const empty = seed('member');
    empty.courses![0]!.lessons[0]!.items = [];
    render_({ groups: [empty] });
    expect(
      await screen.findByText('אין מתכונים שהמדריך שיתף בשיעור הזה.'),
    ).toBeInTheDocument();
  });
});

describe('teaching', () => {
  it('adds a course', async () => {
    render_({ groups: [seed('instructor', { courses: [] })] });
    await screen.findByText(/אין עדיין קורסים בקבוצה/);
    await userEvent.type(screen.getByLabelText('קורס חדש'), 'קרמים בסיסיים');
    await userEvent.click(screen.getByRole('button', { name: 'הוספת קורס' }));
    expect(await screen.findByText('קרמים בסיסיים')).toBeInTheDocument();
  });

  it('adds a lesson to a course', async () => {
    render_({ groups: [seed('instructor')] });
    await userEvent.click(await screen.findByRole('button', { name: 'שיעור חדש' }));
    await userEvent.type(screen.getByLabelText('שם השיעור'), 'שיעור 2 — מליות');
    await userEvent.click(screen.getByRole('button', { name: 'הוספת השיעור' }));
    expect(await screen.findByText(/שיעור 2 — מליות/)).toBeInTheDocument();
  });

  it('publishes one of the instructor own recipes into a lesson', async () => {
    const onPublishRecipe = vi.fn();
    const recipe = DEMO_RECIPES[0]!;
    render_({ groups: [seed('instructor')], onPublishRecipe });
    await userEvent.click(
      await screen.findByRole('button', { name: 'הוספת מתכון מהמחברת' }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText('מתכון מהמחברת שלכם'),
      recipe.id,
    );
    await userEvent.click(screen.getByRole('button', { name: 'הוספה לשיעור' }));
    await waitFor(() =>
      expect(onPublishRecipe).toHaveBeenCalledWith('l1', recipe.id, recipe.name),
    );
  });

  it('says what publishing does before it happens', async () => {
    render_({ groups: [seed('instructor')] });
    await userEvent.click(
      await screen.findByRole('button', { name: 'הוספת מתכון מהמחברת' }),
    );
    expect(screen.getByText(/ברירת המחדל היא\s*צפייה בלבד/)).toBeInTheDocument();
  });

  it('marks a lesson as taught and back', async () => {
    render_({ groups: [seed('instructor')] });
    expect(await screen.findByText('לפנינו')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'סימון כהועבר' }));
    expect(await screen.findByText('הועבר')).toBeInTheDocument();
  });

  it('removes an item from a lesson', async () => {
    render_({ groups: [seed('instructor')] });
    await userEvent.click(await screen.findByRole('button', { name: 'הסרה' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'בריוש נאנט' })).not.toBeInTheDocument(),
    );
  });

  it('shows staff which permissions each item carries', async () => {
    render_({
      groups: [
        seed('instructor', {
          courses: [
            {
              id: 'c1',
              groupId: 'g1',
              name: 'קורס',
              ord: 0,
              lessons: [
                {
                  id: 'l1',
                  courseId: 'c1',
                  name: 'שיעור',
                  date: null,
                  summary: '',
                  done: false,
                  ord: 0,
                  items: [
                    item('i1', 'עם שמירה', { ...PERM_DEFAULT, save: true }),
                    item('i2', 'בלי צפייה', { ...PERM_DEFAULT, view: false }),
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });
    await screen.findByRole('link', { name: 'עם שמירה' });
    expect(screen.getByText('צפייה · שמירה')).toBeInTheDocument();
    // The hint for an item whose view is off, so staff can see WHY a student
    // is not seeing it — the student has no such row at all.
    expect(screen.getByText('מוסתר')).toBeInTheDocument();
  });
});

describe('a refusal from the server', () => {
  it('is shown rather than swallowed', async () => {
    const repo = fakeRepository({
      canWrite: true,
      source: 'supabase',
      groups: { groups: [seed('instructor')] },
    });
    const broken = {
      ...repo,
      removeLesson: async () => {
        throw new Error('אין לכם הרשאה לפעולה הזאת.');
      },
    };
    renderRoute(<GroupScreen />, {
      path: '/group/:groupId',
      route: '/group/g1',
      repository: broken,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'מחיקת השיעור' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('אין לכם הרשאה');
  });
});

describe('the chat tab', () => {
  it('opens the conversation', async () => {
    render_({ groups: [seed('member')] });
    await userEvent.click(await screen.findByRole('tab', { name: 'צ׳אט' }));
    expect(await screen.findByLabelText('הודעה חדשה')).toBeInTheDocument();
  });

  /*
    F27, AND THE SHAPE THAT REPLACED ITS FIRST FIX

    The composer used to sit below the fold on a phone: the screen scrolled as
    a document and the message list was bounded by a fraction of the VIEWPORT,
    so the sum was taller than the frame. The first fix made the chat tab a
    column exactly as tall as the frame — the composer was safe, and a 184px
    group header ate a third of the conversation. The shape now is one scroller
    with both edges pinned: the header scrolls away, the tabs stick to the top
    and the composer sticks to the bottom.

    jsdom has no layout, so this asserts the three CSS rules that shape holds —
    the same way `styles/tokens.test.ts` pins the design tokens. What it cannot
    do is measure; that is `artifact/scripts/responsive.mjs`, which checks in a
    real browser at five widths that the composer and the tabs are inside the
    viewport both when the chat opens and after scrolling up through the
    history, and that the newest message is not behind the composer.
  */
  it('pins the tabs and the composer to the edges of one scroller (F27)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const groupCss = readFileSync(path.join(here, 'GroupScreen.module.css'), 'utf8');
    const chatCss = readFileSync(
      path.join(here, '..', 'features', 'groups', 'GroupChat.module.css'),
      'utf8',
    );

    // The tabs stay at the top of the scroller, opaque so the messages do not
    // show through them.
    expect(groupCss).toMatch(/\.tabs\s*\{[^}]*position:\s*sticky/s);
    expect(groupCss).toMatch(/\.tabs\s*\{[^}]*inset-block-start:\s*0/s);
    expect(groupCss).toMatch(/\.tabs\s*\{[^}]*background:\s*var\(--c-app-bg\)/s);

    // The composer stays at the bottom of it.
    expect(chatCss).toMatch(/\.composer\s*\{[^}]*position:\s*sticky/s);
    expect(chatCss).toMatch(/\.composer\s*\{[^}]*inset-block-end:\s*0/s);

    // And the history is not a scroller of its own any more — that is what put
    // the composer below the fold in the first place.
    expect(chatCss).not.toMatch(/\.scroll\s*\{[^}]*max-height/s);
    expect(chatCss).not.toMatch(/\.scroll\s*\{[^}]*overflow-y/s);

    // The auto-scroll leaves the newest message clear of the sticky bar.
    expect(chatCss).toMatch(/\.bottomAnchor\s*\{[^}]*scroll-margin-block-end/s);
  });

  it('carries the unread count on the tab', async () => {
    render_({
      groups: [seed('member')],
      messages: [
        {
          id: 'm1',
          seq: 1,
          groupId: 'g1',
          authorId: 'ins',
          body: 'שלום',
          kind: 'text',
          replyToId: null,
          editedAt: null,
          deletedAt: null,
          createdAt: '2026-09-17T09:00:00Z',
        },
      ],
    });
    expect(await screen.findByLabelText('1 הודעות שלא נקראו')).toBeInTheDocument();
  });
});
