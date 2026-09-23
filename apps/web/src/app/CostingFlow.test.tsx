// Stage 8 through the real component tree: a purchase entered at the counter,
// the price it produces, the history behind it, and the profit at the end.
//
// Everything below the network is production code; the double models migration
// 0013's GENERATED columns and the `record_purchase` transaction, so the prices
// in these tests are computed the way the database computes them rather than
// echoed back from the form.
//
// What this does NOT cover: the HTTP hop. The database half is in
// supabase/tests/costing.sql, run against the live project.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ingredientRow,
  newProfileRow,
  recipeRow,
  resetFakeIds,
  USER_A,
  USER_B,
  type FakeDb,
  type Row,
} from '../test/fakeSupabase.js';
import { AppUnderTest, emptyDb, project } from '../test/appHarness.js';

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const purchaseRow = (owner: string, over: Row = {}): Row => ({
  id: `pur-${String(over['id'] ?? '1')}`,
  owner_id: owner,
  key: 'חמאה 82%',
  purchase_unit: 'kg',
  package_count: 1,
  package_qty: 1,
  purchase_total: 36,
  usable_pct: null,
  supplier: 'תנובה',
  purchased_at: '2026-06-01',
  note: '',
  created_at: '2026-06-01T00:00:00Z',
  purchase_price: 36,
  price: 36,
  ...over,
});

const catalogRow = (owner: string, over: Row = {}): Row => ({
  id: `cat-${owner.slice(0, 4)}`,
  owner_id: owner,
  group_id: null,
  key: 'חמאה 82%',
  name: 'חמאה 82%',
  purchase_unit: 'kg',
  package_qty: 1,
  package_count: 1,
  purchase_total: 36,
  usable_pct: null,
  supplier: 'תנובה',
  purchased_at: '2026-06-01',
  price_updated_at: '2026-06-01T00:00:00Z',
  note: '',
  purchase_price: 36,
  price: 36,
  price_unit: 'ק"ג',
  g_per_100: null,
  water_pct: null,
  allergens: ['חלב'],
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  ...over,
});

/** A's butter at ₪36/kg, and a recipe that uses 250 g of it. */
function seeded(): FakeDb {
  const db = emptyDb();
  db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true, pro: true }));
  db['ingredient_catalog'] = [catalogRow(USER_A)];
  db['ingredient_purchases'] = [purchaseRow(USER_A)];
  db['recipes']!.push(
    recipeRow('brioche', USER_A, {
      name: 'בריוש',
      sale_price: 40,
      sale_price_basis: 'batch',
      packaging_cost: 2,
      labor_cost: 10,
      other_cost: 0,
      // 250 g of butter is the whole batch, so two units of 125 g. The
      // per-unit figures come from the weight the batch really makes
      // (`unitsActual`), not from the declared count.
      yield_units: 2,
      unit_weight: 125,
    }),
  );
  db['ingredients']!.push(
    ingredientRow('brioche', {
      id: 'b1', name: 'חמאה 82%', ingredient_key: 'חמאה 82%', qty: 250, unit: 'g',
      price: null, price_unit: null, pos: 0,
    }),
  );
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
describe('requirement A — a purchase is entered as it was made', () => {
  it('turns 6 packs of 500 g for a total of 72 into a price of 24 per kilo', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true, pro: true }));
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'סוכר');
    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'g');
    await user.clear(screen.getByLabelText('מספר אריזות'));
    await user.type(screen.getByLabelText('מספר אריזות'), '6');
    await user.type(screen.getByLabelText('כמות באריזה'), '500');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '72');

    // Shown before anything is saved, because the user has to be able to see
    // they typed it right.
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('24');

    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    const list = await screen.findByLabelText('רשימת חומרי הגלם');
    await waitFor(() => expect(list).toHaveTextContent('סוכר'));
    expect(list).toHaveTextContent('₪24');
    // and the purchase went into the log, not just the price
    expect(db['ingredient_purchases']).toHaveLength(1);
    expect(Number(db['ingredient_purchases']![0]!['purchase_total'])).toBe(72);
    expect(Number(db['ingredient_purchases']![0]!['package_count'])).toBe(6);
  });

  it('shows both the purchase cost and the usable cost when there is waste', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true, pro: true }));
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'סלרי');
    await user.type(screen.getByLabelText('כמות באריזה'), '10');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '200');
    await user.type(screen.getByLabelText('אחוז ניצולת'), '80');

    // ₪20 to buy, ₪25 to use. The second is the one a recipe pays.
    const shown = screen.getByLabelText('מחיר מחושב מהרכישה');
    expect(shown).toHaveTextContent('₪25');
    expect(shown).toHaveTextContent('₪20');

    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));
    await waitFor(() => expect(db['ingredient_catalog']).toHaveLength(1));
    const row = db['ingredient_catalog']![0]!;
    expect(Number(row['price'])).toBeCloseTo(25, 6);
    expect(Number(row['purchase_price'])).toBeCloseTo(20, 6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement C — a new price does not erase the old one', () => {
  it('keeps the previous purchase, its supplier and the percentage change', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));

    // the purchase already on record
    const before = await screen.findByLabelText('היסטוריית רכישות');
    expect(before).toHaveTextContent('₪36');

    // butter goes up: ₪45 a kilo, from a different supplier
    await user.clear(screen.getByLabelText('סך הכול ששולם'));
    await user.type(screen.getByLabelText('סך הכול ששולם'), '45');
    await user.clear(screen.getByLabelText('ספק'));
    await user.type(screen.getByLabelText('ספק'), 'טרה');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    await waitFor(() => expect(db['ingredient_purchases']).toHaveLength(2));
    // The ACTIVE price is the catalog row, unambiguously.
    expect(Number(db['ingredient_catalog']![0]!['price'])).toBe(45);
    expect(db['ingredient_catalog']![0]!['supplier']).toBe('טרה');

    // …and the old one is still there, with the change between them
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));
    const after = await screen.findByLabelText('היסטוריית רכישות');
    await waitFor(() => expect(after).toHaveTextContent('₪45'));
    expect(after).toHaveTextContent('₪36');
    expect(after).toHaveTextContent('תנובה');
    expect(after).toHaveTextContent('טרה');
    // 36 → 45 is +25%
    expect(after).toHaveTextContent('+25%');
  });

  it('does not record a purchase for a change that is not one', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));

    // Only the allergens change. No money changed hands, so the history must
    // not gain a row claiming a price was paid again.
    await user.click(screen.getByRole('button', { name: 'הסרת האלרגן חלב' }));
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    await waitFor(() => expect(db['ingredient_catalog']![0]!['allergens']).toEqual([]));
    expect(db['ingredient_purchases']).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements E and F — the recipe reports its full cost and profit', () => {
  it('breaks the cost down and gives the margin, the food cost and the markup', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const panel = await screen.findByLabelText('עלות ורווחיות');
    // 250 g of butter at ₪36/kg = ₪9, plus ₪2 packaging and ₪10 labour = ₪21
    expect(within(panel).getByLabelText('עלות כוללת')).toHaveTextContent('₪21');
    // sold for ₪40: ₪19 profit, a 47.5% margin, a 22.5% food cost
    expect(within(panel).getByLabelText('רווח')).toHaveTextContent('₪19');
    expect(within(panel).getByLabelText('רווח גולמי אחוז')).toHaveTextContent('47.5%');
    expect(within(panel).getByLabelText('פוד קוסט אחוז מהרווחיות')).toHaveTextContent('22.5%');
    // markup is over the COST: 19/21 = 90.5%, and it is NOT the margin
    expect(within(panel).getByLabelText('מארקאפ אחוז')).toHaveTextContent('90.5%');
  });

  it('gives the per-unit figures when the recipe yields units', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const perUnit = await screen.findByLabelText('לפי יחידה');
    // two units: ₪10.5 cost, ₪20 price, ₪9.5 profit each
    expect(perUnit).toHaveTextContent('₪10.5');
    expect(perUnit).toHaveTextContent('₪20');
    expect(within(perUnit).getByLabelText('רווח ליחידה')).toHaveTextContent('₪9.5');
  });

  it('refuses a total and a profit while an ingredient has no price', async () => {
    const user = userEvent.setup();
    const db = seeded();
    // A second ingredient nobody has priced, one level deep in the same recipe.
    db['ingredients']!.push(
      ingredientRow('brioche', {
        id: 'b2', name: 'שוקולד', ingredient_key: 'שוקולד', qty: 100, unit: 'g',
        price: null, price_unit: null, pos: 1,
      }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const panel = await screen.findByLabelText('עלות ורווחיות');
    expect(within(panel).getByLabelText('עלות כוללת')).toHaveTextContent('—');
    expect(within(panel).getByLabelText('רווח')).toHaveTextContent('—');
    expect(within(panel).getByLabelText('רווח גולמי אחוז')).toHaveTextContent('—');
    expect(within(panel).getByLabelText('למה אין רווחיות')).toHaveTextContent('חלקית');
  });

  it('names the cost parts nobody entered', async () => {
    const user = userEvent.setup();
    const db = seeded();
    db['recipes']![0]!['labor_cost'] = null;
    db['recipes']![0]!['other_cost'] = null;
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const note = await screen.findByLabelText('מה לא הוזן בעלות');
    expect(note).toHaveTextContent('עבודה');
    expect(note).toHaveTextContent('עלויות נוספות');
    expect(note).toHaveTextContent('שדה ריק אינו אפס');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement G — a target price is labelled as one', () => {
  it('computes a price from the food cost target and does not call it correct', async () => {
    const user = userEvent.setup();
    const db = seeded();
    db['recipes']![0]!['target_fc'] = 30;
    db['recipes']![0]!['target_gm'] = 60;
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const block = await screen.findByLabelText('מחיר מחושב לפי יעד');
    // ₪9 of ingredients at a 30% target: ₪30
    expect(within(block).getByLabelText('מחיר מחושב לפי יעד פוד קוסט')).toHaveTextContent('₪30');
    // ₪21 total at a 60% margin target: ₪52.5
    expect(within(block).getByLabelText('מחיר מחושב לפי יעד רווח גולמי')).toHaveTextContent(
      '₪52.5',
    );
    expect(block).toHaveTextContent('ולא "המחיר הנכון"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement I — purchases, suppliers and costs are private', () => {
  it('shows B nothing of A’s purchases', async () => {
    const db = seeded();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true, pro: true }));
    const p = project(db, USER_B, 'b@test.invalid');

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    // Not "no purchases for this key" — no material at all, because A's
    // catalog row is invisible too.
    expect(await screen.findByText(/אין עדיין חומרי גלם/)).toBeInTheDocument();
    expect(screen.queryByText('תנובה')).not.toBeInTheDocument();
  });

  it('returns nothing when B asks for the history of A’s key by hand', async () => {
    const db = seeded();
    const p = project(db, USER_B, 'b@test.invalid');
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const b = createSupabaseRepository({
      client: p.client as never,
      userId: USER_B,
    });

    // The key is guessable — "חמאה 82%" is what anyone would call butter. The
    // isolation cannot rest on the key being secret.
    expect(await b.purchaseHistory('חמאה 82%')).toEqual([]);
    // and A's log is untouched
    expect(db['ingredient_purchases']).toHaveLength(1);
    expect(db['ingredient_purchases']![0]!['owner_id']).toBe(USER_A);
  });

  it('records B’s purchase of the same key against B, leaving A’s alone', async () => {
    const db = seeded();
    const p = project(db, USER_B, 'b@test.invalid');
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const b = createSupabaseRepository({
      client: p.client as never,
      userId: USER_B,
    });

    await b.recordPurchase({
      key: 'חמאה 82%',
      name: 'חמאה שלי',
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 1,
      purchaseTotal: 125,
      usablePct: null,
      supplier: 'סודי',
      purchasedAt: '2026-09-01',
      note: '',
    });

    const mine = db['ingredient_catalog']!.filter((c) => c['owner_id'] === USER_B);
    const theirs = db['ingredient_catalog']!.filter((c) => c['owner_id'] === USER_A);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!['price'])).toBe(125);
    // A's price and supplier are exactly as they were
    expect(Number(theirs[0]!['price'])).toBe(36);
    expect(theirs[0]!['supplier']).toBe('תנובה');
    expect(await b.purchaseHistory('חמאה 82%')).toHaveLength(1);
  });
});

describe('requirement G — a target that was never set is not "0%" (QA 22.09.2026, finding 10)', () => {
  it('labels the row as having no target instead of printing a 0% target', async () => {
    const user = userEvent.setup();
    const db = seeded();
    // The column defaults to 0, which is how "no target" is stored.
    db['recipes']![0]!['target_fc'] = 0;
    db['recipes']![0]!['target_gm'] = 0;
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const block = await screen.findByLabelText('מחיר מחושב לפי יעד');
    expect(block).toHaveTextContent('לפי יעד פוד קוסט (לא הוגדר יעד)');
    expect(block).toHaveTextContent('לפי יעד רווח גולמי (לא הוגדר יעד)');
    expect(block).not.toHaveTextContent('0%');
  });
});
