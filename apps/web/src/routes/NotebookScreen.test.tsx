import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs } from '@recipe-notebook/engine';
import { NotebookScreen } from './NotebookScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';

const render = (pro = true) =>
  renderRoute(<NotebookScreen />, {
    repository: fakeRepository({
      prefs: { ...defaultPrefs(pro ? 'pro' : 'home'), done: true },
    }),
  });

describe('§2 the notebook', () => {
  it('lists the five demo recipes with a real count', async () => {
    render();
    expect(await screen.findByText('5 מתכונים · 2 בסיסים')).toBeInTheDocument();
    expect(screen.getByText('בריוש נאנטר')).toBeInTheDocument();
    expect(screen.getByText('גנאש שוקולד מריר 64%')).toBeInTheDocument();
  });

  it('marks a base recipe and an approved formula', async () => {
    render();
    await screen.findByText('בריוש נאנטר');
    expect(screen.getAllByText('מתכון בסיס')).toHaveLength(2);
    expect(screen.getByText('נוסחה מאושרת')).toBeInTheDocument();
  });

  /*
    UX PASS: A CARD CARRIES NO PRODUCTION DATA — IN EITHER PROFILE.

    These two tests used to pin the opposite for `pro`: the card showed ₪45.6
    per kilo. A card answers "is this the recipe I want?", and cost is an
    answer to a different question, on the recipe's own page where there is
    room to say what it includes. The cost itself did not move — the recipe
    screen's own tests still pin it — only its place in the list.
  */
  it('keeps production data off the cards, in either profile', async () => {
    render(true);
    await screen.findByText('גנאש שוקולד מריר 64%');
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
    expect(screen.queryByText(/לק"ג/)).not.toBeInTheDocument();
  });

  it('hides cost for a home profile (§3)', async () => {
    render(false);
    await screen.findByText('גנאש שוקולד מריר 64%');
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
  });

  it('shows what the card is for: name, category, yield and the time it takes', async () => {
    render();
    const card = (await screen.findByText('בריוש נאנטר')).closest('a')!;
    expect(card).toHaveTextContent('בצקים');
    // The yield still comes from the engine, not from the stored field.
    expect(card.textContent).toMatch(/גר'|ק"ג|יח'/);
    // The demo brioche's steps add up, so the card says how long it takes.
    expect(card.textContent).toMatch(/דק'|שע'/);
  });

  it('searches name, tag and ingredient', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('בריוש נאנטר');
    const box = screen.getByLabelText('חיפוש מתכון');

    await user.type(box, 'בריוש');
    expect(screen.getByText('בריוש נאנטר')).toBeInTheDocument();
    expect(screen.queryByText('קרואסון חמאה')).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'למינציה'); // a tag on the croissant
    expect(screen.getByText('קרואסון חמאה')).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'גלוקוז'); // an ingredient of the ganache
    expect(screen.getByText('גנאש שוקולד מריר 64%')).toBeInTheDocument();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('בריוש נאנטר');
    await user.click(screen.getByRole('button', { name: 'גנאשים ורטבים' }));
    expect(screen.getByText('גנאש שוקולד מריר 64%')).toBeInTheDocument();
    expect(screen.queryByText('בריוש נאנטר')).not.toBeInTheDocument();
  });

  it('explains an empty result instead of showing a blank list', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('בריוש נאנטר');
    await user.type(screen.getByLabelText('חיפוש מתכון'), 'שקשוקה');
    expect(screen.getByText('אין מתכון שתואם לחיפוש.')).toBeInTheDocument();
  });

  it('does not render an export button, because there is nothing to export to', async () => {
    render();
    await screen.findByText('בריוש נאנטר');
    // B8: the prototype announced "X מתכונים הועתקו לקובץ" without a file
    expect(screen.queryByText(/ייצוא/)).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('stage-10 audit: the card costs what the recipe page costs', () => {
  /** One recipe with NO price of its own — the normal case since stage 7. */
  const inherited = [
    {
      id: 'inh',
      name: 'לחם לבן',
      category: 'לחמים',
      yieldUnits: 2,
      unitWeight: 500,
      ingredients: [
        { id: 'i1', name: 'קמח לבן', ingredientKey: 'קמח לבן', qty: 1000, unit: 'g', flour: true },
      ],
      steps: [],
    },
  ] as unknown as NonNullable<Parameters<typeof fakeRepository>[0]>['recipes'];

  const priced = [
    {
      id: 'cat-flour',
      key: 'קמח לבן',
      name: 'קמח לבן',
      purchaseUnit: 'kg' as const,
      packageQty: 1,
      packageCount: 1,
      purchaseTotal: 6,
      usablePct: null,
      supplier: '',
      purchasedAt: null,
      priceUpdatedAt: null,
      note: '',
      purchasePrice: 6,
      price: 6,
      priceUnit: 'ק"ג' as const,
      allergens: [],
    },
  ];

  /*
    The stage-10 defect was that the list computed from the recipe's OWN row
    prices only, so a recipe priced centrally — the documented normal case —
    showed no cost on its card while its page showed ₪6/kg. The UX pass took
    cost off the card entirely, which is a stronger guarantee than the one
    these tests made: two numbers that are never both printed cannot disagree.

    What is still worth pinning is that the card prints NO money at all, with a
    catalogue and without one, so cost cannot creep back into the list by
    accident; and that the yield — which the card does print, and which the
    same computation produces — is the recipe's own.
  */
  it('prints no money on a card, whether the material is priced or not', async () => {
    for (const catalog of [priced, []]) {
      const view = renderRoute(<NotebookScreen />, {
        repository: fakeRepository({
          prefs: { ...defaultPrefs('pro'), done: true },
          recipes: inherited,
          catalog,
        }),
      });
      const card = await screen.findByText('לחם לבן');
      expect(card.closest('a')!).not.toHaveTextContent('₪');
      view.unmount();
    }
  });

  it('still shows the yield the engine computes', async () => {
    renderRoute(<NotebookScreen />, {
      repository: fakeRepository({
        prefs: { ...defaultPrefs('pro'), done: true },
        recipes: inherited,
        catalog: priced,
      }),
    });
    const card = await screen.findByText('לחם לבן');
    // 2 units × 500 g — the stored yield, printed as the engine returns it.
    expect(card.closest('a')!).toHaveTextContent("2 יח'");
  });
});
