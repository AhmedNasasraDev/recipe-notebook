// §2 screen 9 — the order sheet.
//
// The sheet is a piece of paper someone weighs from, so the tests are about
// what goes wrong at the bench: a quantity that is not the quantity for this
// order, a printed "0 גר׳" that reads as "leave it out", and a cost figure
// that looks whole when it was built from half the prices.
//
// The scale arriving through the URL is the design decision worth testing
// directly — it is what makes the printed sheet reproducible.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

// The order details are kept in the device mirror, which is idb-keyval.
vi.mock('idb-keyval', () => memoryIdb());

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import { OrderScreen } from './OrderScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { CatalogItem } from '../features/pricing/catalog.js';

const BREAD: Recipe = {
  id: 'bread',
  name: 'לחם כפרי',
  category: 'לחמים',
  yieldUnits: 2,
  unitWeight: 700,
  notes: 'להוציא מהמקרר שעה לפני',
  privateNotes: 'הסוד שלי',
  ingredients: [
    { id: 'b1', name: 'קמח לחם', ingredientKey: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
    { id: 'b2', name: 'מים', qty: 700, unit: 'g', liquid: true, waterPct: 100 },
    { id: 'b3', name: 'מלח', qty: 20, unit: 'g', note: 'ים אטלנטי' },
  ],
  steps: [
    { id: 's1', text: 'לישה', minutes: 10 },
    { id: 's2', text: 'אפייה', minutes: 40, temp: 240 },
  ],
};

const priceOf = (key: string, total: number): CatalogItem => ({
  id: `cat-${key}`,
  key,
  name: key,
  purchaseUnit: 'kg',
  packageQty: 1,
  packageCount: 1,
  purchaseTotal: total,
  usablePct: null,
  supplier: '',
  purchasedAt: null,
  priceUpdatedAt: null,
  note: '',
  purchasePrice: total,
  price: total,
  priceUnit: 'ק"ג',
  allergens: [],
});

function show(
  opts: {
    recipes?: Recipe[];
    id?: string;
    query?: string;
    pro?: boolean;
    catalog?: CatalogItem[];
  } = {},
) {
  return renderRoute(<OrderScreen />, {
    path: '/recipe/:recipeId/order',
    route: `/recipe/${opts.id ?? 'bread'}/order${opts.query ?? ''}`,
    repository: fakeRepository({
      prefs: { ...defaultPrefs(opts.pro === false ? 'home' : 'pro'), done: true },
      recipes: opts.recipes ?? [BREAD],
      catalog: opts.catalog ?? [],
    }),
  });
}

beforeEach(() => {
  resetMemoryIdb();
});

describe('the quantities are the ones for THIS order', () => {
  it('uses the recipe quantities when the link carries no scale', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('1 ק"ג');
    expect(screen.getByText(/כמויות כמו במתכון/)).toBeInTheDocument();
  });

  it('scales by units when the link says so, and says by how much', async () => {
    /*
      The factor comes off the DECLARED yield (QA 22.09.2026, finding 3): the
      recipe says it makes 2 loaves, so six loaves is exactly ×3 and the flour
      is 3 kg. What the weights say the dough makes (1720 g at 700 g a loaf is
      2.46 loaves) is reported on the recipe page as a warning, and it takes
      over only when the finished batch was actually weighed (`yieldActual`).
    */
    show({ query: '?mode=units&v=6' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('3 ק"ג');
    expect(screen.getByLabelText('כמות לייצור')).toHaveTextContent(/לפי מספר יחידות/);
    expect(screen.getByLabelText('כמות לייצור')).toHaveTextContent(/×3/);
  });

  it('scales by final weight', async () => {
    // A batch yields 1720 g; asking for 3440 g doubles it.
    show({ query: '?mode=weight&v=3440' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('2 ק"ג');
  });

  it('falls back to the recipe quantities on a scale it cannot read, and says which', async () => {
    // Not a silent ×1: the sheet has to state which quantities it is showing.
    show({ query: '?mode=units&v=לא-מספר' });
    await screen.findByLabelText('דף ההזמנה');
    expect(screen.getByText(/כמויות כמו במתכון/)).toBeInTheDocument();
  });

  it('ignores a mode that is not one of the four', async () => {
    show({ query: '?mode=everything&v=9' });
    await screen.findByLabelText('דף ההזמנה');
    expect(screen.getByText(/כמויות כמו במתכון/)).toBeInTheDocument();
  });
});

describe('the weighing list', () => {
  it('has a line per ingredient with its weight, and a total', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('קמח לחם');
    expect(sheet).toHaveTextContent('מלח');
    expect(sheet).toHaveTextContent('סך הכל בצק או תערובת');
    // 1000 + 700 + 20
    expect(sheet).toHaveTextContent('1.72 ק"ג');
  });

  it('carries an ingredient note, because it is an instruction to whoever weighs', async () => {
    show();
    expect(await screen.findByLabelText('דף ההזמנה')).toHaveTextContent('ים אטלנטי');
  });

  it('shows the baker percentages on a professional profile when there is flour', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('% אופה');
    expect(sheet).toHaveTextContent('70%');
  });

  it('leaves a BLANK, never a zero, where a weight could not be established', async () => {
    // A printed "0 גר׳" is an instruction to leave the ingredient out.
    const odd: Recipe = {
      ...BREAD,
      id: 'odd',
      ingredients: [
        { id: 'o1', name: 'קמח לחם', qty: 1000, unit: 'g', flour: true },
        { id: 'o2', name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' },
      ],
    };
    show({ recipes: [odd], id: 'odd' });
    await screen.findByLabelText('דף ההזמנה');
    // Scoped to the row: "0 גר" as a bare substring also matches "700 גר׳"
    // elsewhere on the sheet, which would make this pass for the wrong reason.
    const row = screen.getByText('אבקת מאצ׳ה').closest('tr')!;
    expect(row).toHaveTextContent('______');
    expect(row.textContent).not.toMatch(/\b0\s*גר/);
    // And it is stated above the sheet, not only inside it.
    expect(screen.getByRole('alert')).toHaveTextContent(/נתונים חלקיים|לא ניתן לחשב/);
  });
});

describe('the order details', () => {
  it('appear on the sheet only once they are typed', async () => {
    const user = userEvent.setup();
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    /*
      No fabricated order number before anything is typed — the prototype put
      a fresh `'#' + Date.now().slice(-5)` here on every render. The assertion
      is about a NUMBER after the word, not about the word: the sheet's own
      subtitle is "דף הזמנה לייצור" and a bare check on "הזמנה" would fail for
      a reason that has nothing to do with order numbers.
    */
    expect(sheet.textContent ?? '').not.toMatch(/הזמנה\s*[#\d]/);

    await user.type(screen.getByLabelText('שם הלקוח'), 'דנה לוי');
    await user.type(screen.getByLabelText('מספר הזמנה'), '1042');
    expect(sheet).toHaveTextContent('דנה לוי');
    expect(sheet).toHaveTextContent('1042');
  });

  it('says plainly where they are kept, and that the account does not hold them', async () => {
    show();
    expect(await screen.findByText(/נשמרים במכשיר הזה בלבד/)).toBeInTheDocument();
    expect(screen.getByText(/אינם נשמרים בחשבון/)).toBeInTheDocument();
  });

  it('keeps the details on this device across a reload of the sheet', async () => {
    const user = userEvent.setup();
    const first = show();
    await screen.findByLabelText('דף ההזמנה');
    await user.type(screen.getByLabelText('שם הלקוח'), 'דנה לוי');
    await user.type(screen.getByLabelText('מספר הזמנה'), '1042');
    first.unmount();

    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    await waitFor(() => expect(sheet).toHaveTextContent('דנה לוי'));
    expect(screen.getByLabelText('מספר הזמנה')).toHaveValue('1042');
  });

  it('puts the note to the client on the sheet', async () => {
    const user = userEvent.setup();
    show();
    // The notebook loads asynchronously, so the form does not exist on the
    // first render. Without this await the test reads the "not found" screen.
    const sheet = await screen.findByLabelText('דף ההזמנה');
    await user.type(screen.getByLabelText('הערה ללקוח'), 'ללא שומשום');
    expect(sheet).toHaveTextContent('ללא שומשום');
  });
});

describe('§3 what the profile controls', () => {
  it('shows the cost line on a professional profile', async () => {
    show({ catalog: [priceOf('קמח לחם', 5)] });
    expect(await screen.findByLabelText('דף ההזמנה')).toHaveTextContent(/עלות חומרי גלם להזמנה/);
  });

  it('marks the cost as partial when only some ingredients are priced', async () => {
    /*
      Flour is priced, water and salt are not. This is a different kind of
      incompleteness from an unweighable ingredient — every weight here is
      known, so `calcState().level` is 'full' — and the sheet has to use
      `costLevel` for it. A cost total built from one price out of three,
      printed with no qualification, is the "עלות כוללת ₪0" family of bug and
      the one that costs money.
    */
    show({ catalog: [priceOf('קמח לחם', 5)] });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('חלקי');
    // And it names which prices are missing, off the sheet.
    expect(screen.getByRole('status')).toHaveTextContent(/מים|מלח/);
  });

  it('shows no cost and no baker percentages on a home profile', async () => {
    show({ pro: false, catalog: [priceOf('קמח לחם', 5)] });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).not.toHaveTextContent('₪');
    expect(sheet).not.toHaveTextContent('% אופה');
  });
});

describe('what the sheet carries and what it does not', () => {
  it('carries the public recipe note', async () => {
    show();
    expect(await screen.findByLabelText('דף ההזמנה')).toHaveTextContent(
      'להוציא מהמקרר שעה לפני',
    );
  });

  it('does NOT carry the private note (§8)', async () => {
    show();
    await screen.findByLabelText('דף ההזמנה');
    expect(screen.queryByText('הסוד שלי')).not.toBeInTheDocument();
  });

  it('has the work order with times and temperatures', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('לישה');
    expect(sheet).toHaveTextContent('240°C');
    expect(sheet).toHaveTextContent(/40 דק/);
  });

  it('has the allergen line, and never leaves it blank', async () => {
    show();
    expect(await screen.findByLabelText('דף ההזמנה')).toHaveTextContent(/מכיל:/);
  });

  it('has somewhere to sign', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('שקל');
    expect(sheet).toHaveTextContent('אישר');
  });

  it('says "לא נמדד" for a baking loss nobody measured, rather than 0.0%', async () => {
    // §1.1's null ≠ 0 rule, in the place a baker acts on it.
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('לא נמדד');
    expect(sheet).not.toHaveTextContent('0.0%');
  });

  it('shows a real measured loss when both weights are in', async () => {
    const weighed: Recipe = { ...BREAD, id: 'weighed', weightBefore: 1720, weightAfter: 1550 };
    show({ recipes: [weighed], id: 'weighed' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('9.9%');
  });

  it('says so when the recipe is not in the notebook', async () => {
    show({ id: 'nope' });
    expect(await screen.findByText('המתכון הזה לא נמצא במחברת.')).toBeInTheDocument();
  });
});

/*
  ── QA 22.09.2026, §6: the base recipe and the order are two different things ──
*/
describe('the base recipe and the order are kept apart', () => {
  it('with no quantity chosen, says so and shows nothing as if it were ordered', async () => {
    show();
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(screen.getByLabelText('כמות לייצור')).toHaveTextContent(
      'לא הוגדרה כמות לייצור. יש לבחור כמה יחידות או אצוות להכין כדי לחשב את ההזמנה.',
    );
    expect(sheet).toHaveTextContent('המתכון הבסיסי — אצווה אחת');
    expect(sheet).toHaveTextContent('תפוקה בסיסית');
    expect(sheet).toHaveTextContent('2 יחידות');
    expect(sheet).toHaveTextContent('משקל ליחידה');
    expect(sheet).toHaveTextContent('700 גר');
    expect(sheet).not.toHaveTextContent('יחידות להזמנה');
    expect(sheet).not.toHaveTextContent('מספר אצוות');
    expect(sheet).toHaveTextContent('אצווה אחת (כמו במתכון)');
  });

  it('20 units: ten batches, the total weight, and the ingredients ×10', async () => {
    show({ query: '?mode=units&v=20' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('יחידות להזמנה');
    expect(sheet).toHaveTextContent('20 יחידות');
    expect(sheet).toHaveTextContent('10 אצוות');
    expect(sheet).toHaveTextContent('משקל כולל לייצור');
    expect(sheet).toHaveTextContent('17.2 ק"ג'); // 1720 g × 10
    expect(sheet).toHaveTextContent('10 ק"ג'); // flour 1000 g × 10
  });

  it('half a batch', async () => {
    show({ query: '?mode=batches&v=0.5' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('0.5 אצוות');
    expect(sheet).toHaveTextContent('500 גר'); // flour
    expect(sheet).toHaveTextContent('1 יחידות');
  });

  it('a double batch', async () => {
    show({ query: '?mode=batches&v=2' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('2 אצוות');
    expect(sheet).toHaveTextContent('2 ק"ג');
    expect(sheet).toHaveTextContent('4 יחידות');
  });

  it('a recipe with no yield can still be ordered in batches, and never in units', async () => {
    const noYield = { ...BREAD, id: 'plain', name: 'בלי תפוקה', yieldUnits: '', unitWeight: '' } as Recipe;
    show({ id: 'plain', recipes: [noYield], query: '?mode=batches&v=2' });
    const sheet = await screen.findByLabelText('דף ההזמנה');
    expect(sheet).toHaveTextContent('2 אצוות');
    expect(sheet).toHaveTextContent('2 ק"ג');
    expect(sheet).not.toHaveTextContent('יחידות להזמנה');
    // The base block states the batch weight, since there is no unit count.
    expect(sheet).toHaveTextContent('תפוקה בסיסית');
    expect(sheet).toHaveTextContent('1.72 ק"ג');
  });

  it('the quantity control writes the link, so the sheet and the URL agree', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByLabelText('דף ההזמנה');
    await user.click(screen.getByRole('button', { name: 'אצוות' }));
    await user.type(screen.getByLabelText('אצוות'), '3');
    const sheet = screen.getByLabelText('דף ההזמנה');
    await waitFor(() => expect(sheet).toHaveTextContent('3 אצוות'));
    expect(sheet).toHaveTextContent('3 ק"ג');
    expect(screen.getByLabelText('כמות לייצור')).not.toHaveTextContent(/לא הוגדרה כמות/);
  });

  it('refuses a quantity that is not a positive number, and says which sheet it shows', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByLabelText('דף ההזמנה');
    await user.type(screen.getByLabelText('יחידות'), '0');
    expect(await screen.findByRole('alert')).toHaveTextContent(/מספר גדול מאפס/);
    expect(screen.getByLabelText('דף ההזמנה')).toHaveTextContent('אצווה אחת (כמו במתכון)');
  });
});
