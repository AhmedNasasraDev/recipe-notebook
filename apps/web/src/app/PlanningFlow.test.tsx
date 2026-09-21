// Production planning through the real component tree (requirements 1-14).
//
// Everything below the network is production code; the double models the 0018
// RPCs — including the owner guard on a plan line and the rule that a locked
// plan cannot be edited — so a test cannot pass on a write the database would
// refuse.
//
// What this does NOT cover: the HTTP hop. The database half is in
// supabase/tests/planning.sql, run against the live project.

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
  stepRow,
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

const catalogRow = (owner: string, over: Row = {}): Row => ({
  id: `cat-${String(over['key'] ?? 'x')}`,
  owner_id: owner,
  group_id: null,
  key: 'קמח לבן',
  name: 'קמח לבן',
  purchase_unit: 'kg',
  package_qty: 5,
  package_count: 1,
  purchase_total: 20,
  usable_pct: null,
  supplier: '',
  purchased_at: '2026-09-01',
  price_updated_at: '2026-09-01T00:00:00Z',
  note: '',
  purchase_price: 4,
  price: 4,
  price_unit: 'ק"ג',
  g_per_100: null,
  water_pct: null,
  allergens: [],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

/**
 * A's notebook: cookies that yield 20 units of 50 g from 1 kg of flour, and a
 * priced flour in the centre. 5 kg sacks at ₪4/kg.
 */
function seeded(): FakeDb {
  const db = emptyDb();
  db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true, pro: true }));
  db['ingredient_catalog'] = [catalogRow(USER_A)];
  db['recipes']!.push(
    recipeRow('cookies', USER_A, {
      name: 'עוגיות ריבה',
      yield_units: 20,
      unit_weight: 50,
    }),
  );
  db['ingredients']!.push(
    ingredientRow('cookies', {
      id: 'ck1', name: 'קמח לבן', ingredient_key: 'קמח לבן', qty: 1000, unit: 'g',
      price: null, price_unit: null, pos: 0,
    }),
  );
  db['steps']!.push(
    stepRow('cookies', { id: 'cs1', ord: 0, text: 'קירור', minutes: 480, kind: 'chill' }),
    stepRow('cookies', { id: 'cs2', ord: 1, text: 'אפייה', minutes: 20, temp: 180, kind: 'bake' }),
  );
  return db;
}

/** Opens a saved plan for one product, and returns the db it lives in. */
function withPlan(over: Row = {}, stock: Row[] = []): FakeDb {
  const db = seeded();
  db['production_plans'] = [
    {
      id: 'p1',
      owner_id: USER_A,
      name: 'שישי',
      plan_date: '2026-10-02',
      note: '',
      locked: false,
      locked_at: null,
      snapshot: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      ...over,
    },
  ];
  db['production_plan_items'] = [
    {
      id: 'pi1',
      plan_id: 'p1',
      recipe_id: 'cookies',
      ord: 0,
      qty: 100,
      qty_unit: 'unit',
      ready_at: '08:00:00',
      note: '',
    },
  ];
  db['production_plan_stock'] = stock;
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 1, 13 — a plan is created, saved and reopened', () => {
  it('creates a plan from the list and lands on it', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plans" />);
    await user.click(await screen.findByRole('button', { name: 'תוכנית ייצור חדשה' }));

    await screen.findByRole('heading', { name: 'תוכנית ייצור' });
    expect(db['production_plans']).toHaveLength(1);
    expect(db['production_plans']![0]!['owner_id']).toBe(USER_A);
  });

  it('adds a product, saves it, and the line survives a reload', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });

    // the saved line came back, with its quantity and its ready time
    expect(screen.getByLabelText('כמות יעד לשורה 1')).toHaveValue('100');
    expect(screen.getByLabelText('שעת מוכנות לשורה 1')).toHaveValue('08:00');

    await user.clear(screen.getByLabelText('כמות יעד לשורה 1'));
    await user.type(screen.getByLabelText('כמות יעד לשורה 1'), '60');
    await user.click(screen.getByRole('button', { name: 'שמירת התוכנית' }));

    await waitFor(() =>
      expect(Number(db['production_plan_items']![0]!['qty'])).toBe(60),
    );
  });

  it('shows the scale factor against the recipe the line points at', async () => {
    const p = project(withPlan(), USER_A);
    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    // 20 units becoming 100 is a factor of 5
    const factor = screen.getByLabelText('חישוב הכמות לשורה 1');
    expect(factor).toHaveTextContent('פי 5');
    expect(factor).toHaveTextContent('20 יחידות');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 3-7 — the materials and the purchase list', () => {
  it('lists the material the plan needs, in the sack it is sold in', async () => {
    const user = userEvent.setup();
    const p = project(withPlan(), USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));

    const list = await screen.findByLabelText('רשימת רכש');
    // 100 cookies = factor 5 → 5 kg of flour → one 5 kg sack at ₪4/kg
    expect(within(list).getByLabelText('צריך לקנות קמח לבן')).toHaveTextContent('5');
    expect(within(list).getByLabelText('הצעת רכישה לקמח לבן')).toHaveTextContent(
      '1 × 5',
    );
    expect(within(list).getByLabelText('עלות צפויה לקמח לבן')).toHaveTextContent('₪20');
    expect(within(list).getByLabelText('סכום עלות הרכש')).toHaveTextContent('₪20');
  });

  it('shows the full requirement when nobody said what is in the store room', async () => {
    const user = userEvent.setup();
    const p = project(withPlan(), USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));

    const list = await screen.findByLabelText('רשימת רכש');
    expect(within(list).getByLabelText('כמות שיש במחסן מקמח לבן')).toHaveValue('');
    expect(list).toHaveTextContent('שדה ריק אינו אפס');
  });

  it('subtracts an on-hand quantity, and saves it with the plan', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));

    await user.type(await screen.findByLabelText('כמות שיש במחסן מקמח לבן'), '2');
    const list = screen.getByLabelText('רשימת רכש');
    await waitFor(() =>
      expect(within(list).getByLabelText('צריך לקנות קמח לבן')).toHaveTextContent('3'),
    );

    await user.click(screen.getByRole('button', { name: 'שמירת התוכנית' }));
    await waitFor(() => expect(db['production_plan_stock']).toHaveLength(1));
    expect(Number(db['production_plan_stock']![0]!['on_hand'])).toBe(2);
    expect(db['production_plan_stock']![0]!['key']).toBe('קמח לבן');
  });

  it('reads a saved 0 as an empty shelf rather than as "not entered"', async () => {
    const user = userEvent.setup();
    const db = withPlan({}, [{ id: 'ps1', plan_id: 'p1', key: 'קמח לבן', on_hand: 0 }]);
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));

    const list = await screen.findByLabelText('רשימת רכש');
    expect(within(list).getByLabelText('כמות שיש במחסן מקמח לבן')).toHaveValue('0');
    // the whole requirement still has to be bought, and no "blank" note
    expect(within(list).getByLabelText('צריך לקנות קמח לבן')).toHaveTextContent('5');
    expect(list).not.toHaveTextContent('שדה ריק אינו אפס');
  });

  it('withholds the purchase total when a material has no price', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    db['ingredient_catalog'] = [];
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));

    const list = await screen.findByLabelText('רשימת רכש');
    expect(within(list).getByLabelText('סכום עלות הרכש')).toHaveTextContent('—');
    expect(within(list).getByLabelText('למה העלות אינה מלאה')).toHaveTextContent(
      'אין מחיר',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 8-9 — the timeline, and the night before', () => {
  it('schedules backwards from 08:00 into the previous evening', async () => {
    const user = userEvent.setup();
    const p = project(withPlan(), USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'סדר עבודה ולוח זמנים' }));

    const tl = await screen.findByLabelText('לוח זמנים');
    // baking 07:40-08:00, then an 8-hour chill back to 23:40 on the 1st
    expect(tl).toHaveTextContent('07:40');
    expect(tl).toHaveTextContent('23:40');
    expect(tl).toHaveTextContent('01.10');
    expect(tl).toHaveTextContent('קירור');
    expect(tl).toHaveTextContent('אפייה');
  });

  it('says the schedule is partial when a step has no duration', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    db['steps']!.push(
      stepRow('cookies', { id: 'cs3', ord: 2, text: 'קישוט', minutes: null }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'סדר עבודה ולוח זמנים' }));

    const missing = await screen.findByLabelText('מה חסר בלוח הזמנים');
    expect(missing).toHaveTextContent('קישוט');
    expect(missing).toHaveTextContent('אין משך זמן');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 14 — live by default, frozen once it is done', () => {
  it('marks the plan done, freezes the cost, and refuses an edit', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'סימון התוכנית כבוצעה' }));

    await waitFor(() => expect(db['production_plans']![0]!['locked']).toBe(true));
    expect(db['production_plans']![0]!['snapshot']).not.toBeNull();

    // The banner says which figures are frozen, and the fields are read-only.
    expect(await screen.findByLabelText('התוכנית סומנה כבוצעה')).toHaveTextContent(
      'לא לפי המחירים של היום',
    );
    expect(screen.getByLabelText('כמות יעד לשורה 1')).toBeDisabled();
  });

  it('a price change does NOT move a plan that was marked done', async () => {
    const user = userEvent.setup();
    const db = withPlan();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'רשימת רכש ועלות צפויה' }));
    await waitFor(() =>
      expect(screen.getByLabelText('סכום עלות הרכש')).toHaveTextContent('₪20'),
    );
    await user.click(screen.getByRole('button', { name: 'סימון התוכנית כבוצעה' }));
    await waitFor(() => expect(db['production_plans']![0]!['locked']).toBe(true));

    // Flour doubles in the centre.
    db['ingredient_catalog']![0]!['purchase_price'] = 8;
    db['ingredient_catalog']![0]!['price'] = 8;

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    const heads = await screen.findAllByRole('heading', { name: 'שישי' });
    expect(heads.length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: 'רשימת רכש ועלות צפויה' });
    await user.click(buttons[buttons.length - 1]!);
    const totals = await screen.findAllByLabelText('סכום עלות הרכש');
    // The frozen ₪20, not today's ₪40.
    expect(totals[totals.length - 1]!).toHaveTextContent('₪20');
  });

  it('unlocking clears the freeze, so the plan is live again', async () => {
    const user = userEvent.setup();
    const db = withPlan({ locked: true, snapshot: { at: '2026-10-01', lines: [], total: 7, level: 'full', why: '' } });
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    await screen.findByRole('heading', { name: 'שישי' });
    await user.click(screen.getByRole('button', { name: 'ביטול סימון הביצוע' }));

    await waitFor(() => expect(db['production_plans']![0]!['locked']).toBe(false));
    expect(db['production_plans']![0]!['snapshot']).toBeNull();
    expect(screen.getByLabelText('כמות יעד לשורה 1')).toBeEnabled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 13 — one account cannot see or touch another’s plans', () => {
  it('shows B an empty list while A has a plan', async () => {
    const db = withPlan();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true, pro: true }));
    const p = project(db, USER_B, 'b@test.invalid');

    render(<AppUnderTest client={p.client} route="/plans" />);
    expect(await screen.findByText(/אין עדיין תוכניות ייצור/)).toBeInTheDocument();
  });

  it('will not open A’s plan for B, even with the id in hand', async () => {
    const db = withPlan();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true, pro: true }));
    const p = project(db, USER_B, 'b@test.invalid');

    render(<AppUnderTest client={p.client} route="/plan/p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('לא נמצאה');
  });

  it('refuses a plan line pointing at another account’s recipe', async () => {
    const db = withPlan();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true, pro: true }));
    db['recipes']!.push(recipeRow('secret', USER_B, { name: 'הסוד של ב' }));
    const p = project(db, USER_A);

    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const a = createSupabaseRepository({ client: p.client as never, userId: USER_A });

    // The id is guessable; the guard is what stops it, not the id being secret.
    await expect(
      a.savePlan({
        id: 'p1',
        name: 'שישי',
        planDate: '2026-10-02',
        note: '',
        locked: false,
        lockedAt: null,
        snapshot: null,
        updatedAt: '2026-10-01T00:00:00Z',
        items: [
          { id: 'x', recipeId: 'secret', qty: 1, qtyUnit: 'unit', readyAt: null, note: '' },
        ],
        onHand: {},
      }),
    ).rejects.toThrow();
  });

  it('B deleting A’s plan by id is a silent no-op', async () => {
    const db = withPlan();
    const p = project(db, USER_B, 'b@test.invalid');
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const b = createSupabaseRepository({ client: p.client as never, userId: USER_B });

    await b.deletePlan('p1');
    expect(db['production_plans']).toHaveLength(1);
    expect(db['production_plans']![0]!['owner_id']).toBe(USER_A);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage-11 — a plan id that is not there.
//
// Found by walking every route in a browser: this was the one page in the app
// that rendered no <h1>, so a screen reader landing on it from a stale
// bookmark had nothing to announce. The message and the way back were already
// correct; the heading was not there.
describe('stage-11: a plan that cannot be loaded is still a page', () => {
  it('says the plan was not found, under a heading, with a way back', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/plan/no-such-plan" />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'תוכנית ייצור' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('התוכנית לא נמצאה.');
    // §4's shared back control: the destination's name, with the chevron that
    // points back in an RTL layout.
    /*
      A BUTTON, NOT A LINK, AND THAT IS THE FIX RATHER THAN A REGRESSION.

      Back used to be `<BackLink to="/plans">` — an address, hard-coded on
      every screen, which is why arriving here from anywhere landed you in the
      plan list. It is `BackControl` now: a history step when there is
      history, the parent screen when there is not. You cannot link to "the
      screen I was on", so it is a button, and the name still says where it
      goes.
    */
    expect(screen.getByRole('button', { name: 'התוכניות' })).toBeInTheDocument();
  });
});
