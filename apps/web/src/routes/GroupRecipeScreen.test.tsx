import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupRecipeScreen } from './GroupRecipeScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { FakeGroupOptions, FakeGroupSeed } from '../test/fakeGroups.js';
import { PERM_DEFAULT, type ItemPerms } from '../features/groups/roles.js';
import type { Recipe } from '@recipe-notebook/engine';

const RECIPE: Recipe = {
  id: 'r1',
  name: 'בריוש נאנט',
  category: 'בצקים',
  ingredients: [
    { name: 'קמח לחם', qty: 500, unit: 'גרם', flour: true },
    { name: 'חמאה', qty: 250, unit: 'גרם' },
  ],
  steps: [{ text: 'ללוש עשר דקות' }, { text: 'לקפל כל שעה' }],
} as unknown as Recipe;

const seed = (perms: ItemPerms): FakeGroupSeed => ({
  id: 'g1',
  name: 'קונדיטוריה',
  kind: '',
  note: '',
  code: null,
  joinBy: ['invite'],
  myRole: 'member',
  roster: [],
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
              perms,
              createdAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
    },
  ],
});

const render_ = (perms: ItemPerms, groups: Partial<FakeGroupOptions> = {}) =>
  renderRoute(<GroupRecipeScreen />, {
    path: '/group/:groupId/item/:itemId',
    route: '/group/g1/item/i1',
    repository: fakeRepository({
      canWrite: true,
      source: 'supabase',
      recipes: [RECIPE],
      groups: { groups: [seed(perms)], ...groups },
    }),
  });

describe('the recipe itself', () => {
  it('shows the ingredients and the steps', async () => {
    render_({ ...PERM_DEFAULT });
    expect(await screen.findByText('קמח לחם')).toBeInTheDocument();
    expect(screen.getByText('ללוש עשר דקות')).toBeInTheDocument();
  });

  it('shows nothing that belongs to the owner', async () => {
    // §12.3 — no cost, no margin, no trials, no batches, no versions. The
    // database refuses those rows to a student anyway (`owns_recipe`); the
    // screen does not ask for them either.
    render_({ ...PERM_DEFAULT });
    await screen.findByText('קמח לחם');
    for (const forbidden of ['עלות', 'רווח', 'ניסויים', 'אצוות', 'גרסאות', 'מחיר']) {
      expect(screen.queryByText(new RegExp(forbidden))).not.toBeInTheDocument();
    }
  });

  it('names the lesson and the course it came from', async () => {
    render_({ ...PERM_DEFAULT });
    expect(await screen.findByText('בצקים · שיעור 1')).toBeInTheDocument();
  });
});

describe('§10.4 — "מה מותר לי כאן"', () => {
  it('lists all five permissions with a tick or a dash', async () => {
    render_({ view: true, save: true, print: false, download: false, shareOut: false });
    const card = await screen.findByLabelText('מה מותר לי כאן');
    expect(card).toHaveTextContent('צפייה במתכון');
    expect(card).toHaveTextContent('שמירה למחברת האישית');
    expect(card).toHaveTextContent('הדפסה');
    expect(card).toHaveTextContent('הורדת קובץ');
    expect(card).toHaveTextContent('שיתוף מחוץ לקבוצה');
    // Two allowed, three blocked — and the words are there for a screen reader
    // rather than only the symbols.
    expect(screen.getAllByText('מותר')).toHaveLength(2);
    expect(screen.getAllByText('חסום')).toHaveLength(3);
  });

  it('says the instructor cannot read the private note', async () => {
    render_({ ...PERM_DEFAULT });
    expect(
      await screen.findByText(/המדריך אינו רואה אותה/),
    ).toBeInTheDocument();
  });

  it('hides the print button when printing is not permitted', async () => {
    render_({ ...PERM_DEFAULT });
    await screen.findByText('קמח לחם');
    expect(screen.queryByRole('button', { name: 'הדפסה' })).not.toBeInTheDocument();
  });

  it('offers printing when it is', async () => {
    render_({ ...PERM_DEFAULT, print: true });
    expect(await screen.findByRole('button', { name: 'הדפסה' })).toBeInTheDocument();
  });
});

describe('§11 — saving a copy', () => {
  it('uses the spec wording when saving is not permitted, and offers no button', async () => {
    render_({ ...PERM_DEFAULT });
    expect(
      await screen.findByText(
        'המדריך לא אישר שמירה של המתכון הזה למחברת אישית. אפשר לצפות ולכתוב הערה אישית.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'שמירת עותק למחברת שלי' }),
    ).not.toBeInTheDocument();
  });

  it('copies when it is permitted, and says the group recipe did not change', async () => {
    const onSaveGroupCopy = vi.fn();
    render_({ ...PERM_DEFAULT, save: true }, { onSaveGroupCopy });
    await userEvent.click(
      await screen.findByRole('button', { name: 'שמירת עותק למחברת שלי' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'נוצר עותק אישי במחברת שלכם. המתכון של הקבוצה לא השתנה.',
    );
    expect(onSaveGroupCopy).toHaveBeenCalledWith('i1');
  });

  it('shows the server refusal if the permission changed since the page loaded', async () => {
    // The screen was rendered with save on; the server says no. HANDOFF §4:
    // the client-side check is UX only.
    const repo = fakeRepository({
      canWrite: true,
      source: 'supabase',
      recipes: [RECIPE],
      groups: { groups: [seed({ ...PERM_DEFAULT, save: true })] },
    });
    const broken = {
      ...repo,
      saveGroupCopy: async () => {
        throw new Error('המדריך לא אישר שמירה של המתכון הזה למחברת אישית.');
      },
    };
    renderRoute(<GroupRecipeScreen />, {
      path: '/group/:groupId/item/:itemId',
      route: '/group/g1/item/i1',
      repository: broken,
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'שמירת עותק למחברת שלי' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('לא אישר שמירה');
  });
});

describe('§8 — the private note', () => {
  it('loads the note the account already has', async () => {
    render_({ ...PERM_DEFAULT }, { itemNotes: { i1: 'להוסיף קיפול' } });
    await waitFor(() =>
      expect(screen.getByLabelText('הערה אישית על המתכון')).toHaveValue('להוסיף קיפול'),
    );
  });

  it('saves it, and only enables the button once something changed', async () => {
    const onSaveItemNote = vi.fn();
    render_({ ...PERM_DEFAULT }, { onSaveItemNote });
    const box = await screen.findByLabelText('הערה אישית על המתכון');
    expect(screen.getByRole('button', { name: 'שמירת ההערה' })).toBeDisabled();
    await userEvent.type(box, 'התנור שלי חם יותר');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת ההערה' }));
    await waitFor(() =>
      expect(onSaveItemNote).toHaveBeenCalledWith('i1', 'התנור שלי חם יותר'),
    );
  });
});

describe('a base recipe the instructor did not share', () => {
  it('says the sub-recipe is missing instead of printing a complete-looking figure', async () => {
    // `recipes_group_read` only admits a recipe an item points at, so a base
    // recipe that was never added to a lesson is invisible to the class and
    // the engine leaves the row unresolved.
    const withSub = {
      ...RECIPE,
      ingredients: [
        { name: 'גנאש', qty: 200, unit: 'גרם', subId: 'not-shared' },
      ],
    } as unknown as Recipe;
    renderRoute(<GroupRecipeScreen />, {
      path: '/group/:groupId/item/:itemId',
      route: '/group/g1/item/i1',
      repository: fakeRepository({
        canWrite: true,
        source: 'supabase',
        recipes: [withSub],
        groups: { groups: [seed({ ...PERM_DEFAULT })] },
      }),
    });
    expect(
      await screen.findByText(/מתכון בסיס שהמדריך לא שיתף/),
    ).toBeInTheDocument();
  });
});

describe('an item this account may not see', () => {
  it('says one thing, whatever the reason', async () => {
    // No such item, not a member, or view turned off: one message. Telling
    // them apart would say something about a group this account cannot see.
    renderRoute(<GroupRecipeScreen />, {
      path: '/group/:groupId/item/:itemId',
      route: '/group/g1/item/nope',
      repository: fakeRepository({
        source: 'supabase',
        recipes: [RECIPE],
        groups: { groups: [seed({ ...PERM_DEFAULT })] },
      }),
    });
    expect(
      await screen.findByText(/המתכון הזה אינו זמין לחשבון הזה/),
    ).toBeInTheDocument();
  });
});

describe('the quantities read as they do on the recipe page (QA 22.09.2026, finding 6)', () => {
  it('prints Hebrew units and never the storage codes', async () => {
    render_({ ...PERM_DEFAULT });
    const flour = (await screen.findByText('קמח לחם')).closest('li')!;
    expect(flour).toHaveTextContent("500 גר'");
    expect(flour.textContent).not.toMatch(/\b(g|ml|tsp|unit)\b/);
    expect(flour.textContent).not.toContain('גר׳');
  });
});
