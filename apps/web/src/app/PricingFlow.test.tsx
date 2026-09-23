// The pricing route, through the real component tree (stage-7 requirements
// 2, 4, 5, 6, 8).
//
// Same harness as the other flow tests: everything below the network is
// production code, and the double models migration 0011's GENERATED columns —
// so the per-base-unit price in these tests is computed the way the database
// computes it, not echoed back from the form.
//
// What this does NOT cover: the HTTP hop. The database half is in
// supabase/tests/pricing.sql, run against the live project.

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

/*
  The editor is a wizard since §6: one stage on screen at a time (פרטים ·
  חומרי גלם · אופן ההכנה · סיכום), with the draft held above the stages so
  nothing typed is lost between them. `toStage` is how a person moves —
  the stepper at the top of the form, by its accessible name.
*/
const toStage = (u: ReturnType<typeof userEvent.setup>, n: 1 | 2 | 3 | 4) =>
  u.click(screen.getByRole('button', { name: new RegExp(`^שלב ${n} `) }));

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const catalogRow = (owner: string, over: Row = {}): Row => ({
  id: `cat-${String(over['key'] ?? 'x')}-${owner.slice(0, 4)}`,
  owner_id: owner,
  group_id: null,
  key: 'חמאה 82%',
  name: 'חמאה 82%',
  purchase_unit: 'g',
  package_qty: 200,
  package_count: 1,
  purchase_total: 8.9,
  usable_pct: null,
  supplier: 'תנובה',
  purchased_at: '2026-09-01',
  price_updated_at: '2026-09-01T00:00:00Z',
  note: '',
  // What the generated columns hold for a 200 g pack at ₪8.90.
  purchase_price: 44.5,
  price: 44.5,
  price_unit: 'ק"ג',
  g_per_100: null,
  water_pct: null,
  allergens: ['חלב'],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

/** Two of A's recipes, both using butter with no price of their own. */
function seeded(): FakeDb {
  const db = emptyDb();
  db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true, pro: true }));
  db['ingredient_catalog'] = [catalogRow(USER_A)];
  db['recipes']!.push(
    recipeRow('brioche', USER_A, { name: 'בריוש', sale_price: 40, yield_units: 2, unit_weight: 500 }),
    recipeRow('cookies', USER_A, { name: 'עוגיות', sale_price: null }),
  );
  db['ingredients']!.push(
    ingredientRow('brioche', {
      id: 'b1', name: 'חמאה 82%', ingredient_key: 'חמאה 82%', qty: 250, unit: 'g',
      price: null, price_unit: null, pos: 0,
    }),
    ingredientRow('cookies', {
      id: 'c1', name: 'חמאה 82%', ingredient_key: 'חמאה 82%', qty: 100, unit: 'g',
      price: null, price_unit: null, pos: 0,
    }),
  );
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 2 — the central price reaches the recipe', () => {
  it('costs a recipe from a price that is only in the centre', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    // 250 g of butter at ₪44.50/kg = ₪11.125, which the app-wide money
    // formatter shows as ₪11.1. The recipe row itself carries no price.
    const fcPanel = await screen.findByLabelText('פוד קוסט');
    expect(fcPanel).toHaveTextContent('₪11.1');
    expect(fcPanel).toHaveTextContent('עלות לק"ג');
  });

  it('a change in the centre changes the cost, with no edit to the recipe', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    const view = render(<AppUnderTest client={p.client} route="/ingredients" />);
    await screen.findByRole('heading', { name: 'חומרי גלם' });
    await user.click(screen.getByRole('button', { name: 'עריכת חמאה 82%' }));

    // A kilo pack at ₪36 — the instructions' own example.
    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'kg');
    await user.clear(screen.getByLabelText('כמות באריזה'));
    await user.type(screen.getByLabelText('כמות באריזה'), '1');
    await user.clear(screen.getByLabelText('סך הכול ששולם'));
    await user.type(screen.getByLabelText('סך הכול ששולם'), '36');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    // The DATABASE derived the unit price, not the form.
    await waitFor(() => {
      const row = db['ingredient_catalog']!.find((c) => c['key'] === 'חמאה 82%')!;
      expect(Number(row['price'])).toBeCloseTo(36, 6);
    });
    // and no recipe row was rewritten — that is the point of a central price
    expect(db['ingredients']!.every((i) => i['price'] === null)).toBe(true);
    view.unmount();

    // 250 g at ₪36/kg = ₪9
    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));
    expect(await screen.findByLabelText('פוד קוסט')).toHaveTextContent('₪9');
  }, 40_000);

  it('requirement 5: the centre names the recipes a price change moves', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await screen.findByRole('heading', { name: 'חומרי גלם' });
    await user.click(screen.getByRole('button', { name: 'עריכת חמאה 82%' }));

    const box = await screen.findByLabelText('מתכונים שהמחיר הזה משפיע עליהם');
    expect(box).toHaveTextContent('2 מתכונים מושפעים');
    expect(within(box).getByRole('link', { name: 'בריוש' })).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'עוגיות' })).toBeInTheDocument();
  }, 30_000);

  it('a recipe line with its own price is NOT moved, and is not claimed to be', async () => {
    const user = userEvent.setup();
    const db = seeded();
    // The cookies override the central price with an explicit 0 — free butter.
    db['ingredients']!.find((i) => i['recipe_id'] === 'cookies')!['price'] = 0;
    db['ingredients']!.find((i) => i['recipe_id'] === 'cookies')!['price_unit'] = 'ק"ג';
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/ingredients" />);
    await screen.findByRole('heading', { name: 'חומרי גלם' });
    await user.click(screen.getByRole('button', { name: 'עריכת חמאה 82%' }));

    const box = await screen.findByLabelText('מתכונים שהמחיר הזה משפיע עליהם');
    // only the brioche inherits; the cookies are listed nowhere
    expect(box).toHaveTextContent('מתכון אחד מושפע');
    expect(within(box).queryByRole('link', { name: 'עוגיות' })).not.toBeInTheDocument();
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 4 — food cost on the recipe page', () => {
  it('shows the cost, the per-unit cost, the sale price and the percentage', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const panel = await screen.findByLabelText('פוד קוסט');
    expect(panel).toHaveTextContent('עלות חומרי הגלם');
    expect(panel).toHaveTextContent('מחיר מכירה');
    // ₪11.125 against a ₪40 sale price is 27.8%
    expect(within(panel).getByLabelText('אחוז פוד קוסט')).toHaveTextContent('27.8%');
  }, 30_000);

  it('withholds the percentage when no sale price is set, and says why', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/cookies" />);
    await screen.findByRole('heading', { name: 'עוגיות' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const panel = await screen.findByLabelText('פוד קוסט');
    expect(within(panel).getByLabelText('אחוז פוד קוסט')).toHaveTextContent('—');
    // A dash with no reason reads as a bug.
    expect(within(panel).getByLabelText('למה אין אחוז פוד קוסט')).toHaveTextContent(
      'לא הוגדר מחיר מכירה',
    );
  }, 30_000);

  it('withholds it when a material has no price, and says what to go and price', async () => {
    const user = userEvent.setup();
    const db = seeded();
    // A second material that is in no catalog at all.
    db['ingredients']!.push(
      ingredientRow('brioche', {
        id: 'b2', name: 'שמרים טריים', ingredient_key: 'שמרים טריים', qty: 15, unit: 'g',
        price: null, price_unit: null, pos: 1,
      }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    const panel = await screen.findByLabelText('פוד קוסט');
    expect(within(panel).getByLabelText('אחוז פוד קוסט')).toHaveTextContent('—');
    expect(within(panel).getByLabelText('למה אין אחוז פוד קוסט')).toHaveTextContent('חלקית');
    // and it points at the centre, which is where the fix is
    expect(panel).toHaveTextContent('שמרים טריים');
    expect(within(panel).getByRole('link', { name: /מרכז חומרי הגלם/ })).toBeInTheDocument();
  }, 30_000);

  it('sets a sale price through the editor and the percentage appears', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    const view = render(<AppUnderTest client={p.client} route="/recipe/cookies/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    // The sale price lives on the summary stage, behind the editor's
    // "תשואה ותמחור" disclosure.
    await toStage(user, 4);
    // The editor's own step-4 heading is unchanged (RecipeEditScreen, not
    // the recipe page — spec §3.3 is about "עמוד המתכון").
    await user.click(screen.getByText('פרטים מקצועיים'));
    await user.type(screen.getByLabelText('מחיר מכירה'), '20');
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'עוגיות' });

    // stored as a number, and NULL-preserving elsewhere
    expect(Number(db['recipes']!.find((r) => r['id'] === 'cookies')!['sale_price'])).toBe(20);
    view.unmount();

    render(<AppUnderTest client={p.client} route="/recipe/cookies" />);
    await screen.findByRole('heading', { name: 'עוגיות' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));
    // 100 g at ₪44.50/kg = ₪4.45 against ₪20 = 22.3%
    expect(
      within(await screen.findByLabelText('פוד קוסט')).getByLabelText('אחוז פוד קוסט'),
    ).toHaveTextContent('22.3%');
  }, 40_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 6 — one account cannot see or infer another\'s prices', () => {
  const twoAccounts = (): FakeDb => {
    const db = seeded();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    // B has their own butter, at a very different price.
    db['ingredient_catalog']!.push(
      catalogRow(USER_B, { key: 'חמאה 82%', package_price: 25, price: 125 }),
    );
    return db;
  };

  it('B\'s centre shows B\'s price, never A\'s', async () => {
    const db = twoAccounts();
    const b = project(db, USER_B, 'b@test.invalid');

    render(<AppUnderTest client={b.client} route="/ingredients" />);
    await screen.findByRole('heading', { name: 'חומרי גלם' });
    const list = await screen.findByLabelText('רשימת חומרי הגלם');
    // ₪125/kg is B's. ₪44.5/kg is A's and must not be here.
    expect(list).toHaveTextContent('125');
    expect(list).not.toHaveTextContent('44.5');
  }, 30_000);

  it('the repository returns only the caller\'s own materials', async () => {
    const db = twoAccounts();
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');

    const a = createSupabaseRepository({
      client: project(db, USER_A).client as never,
      userId: USER_A,
    });
    const b = createSupabaseRepository({
      client: project(db, USER_B, 'b@test.invalid').client as never,
      userId: USER_B,
    });
    expect((await a.listCatalog()).map((c) => c.price)).toEqual([44.5]);
    expect((await b.listCatalog()).map((c) => c.price)).toEqual([125]);
  });

  it('B cannot overwrite A\'s material by writing A\'s key', async () => {
    // The same key in both accounts, which is the case that would collide if
    // the uniqueness were on `key` alone rather than on (owner, key).
    const db = twoAccounts();
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const b = createSupabaseRepository({
      client: project(db, USER_B, 'b@test.invalid').client as never,
      userId: USER_B,
    });

    await b.saveCatalogItem({
      id: '', key: 'חמאה 82%', name: 'חמאה שלי', purchaseUnit: 'kg',
      packageQty: 1, packageCount: 1, purchaseTotal: 99, usablePct: null,
      supplier: '', purchasedAt: null, priceUpdatedAt: null,
      note: '', purchasePrice: null, price: null, priceUnit: null, allergens: [],
    });

    const mine = db['ingredient_catalog']!.filter((c) => c['owner_id'] === USER_B);
    const theirs = db['ingredient_catalog']!.filter((c) => c['owner_id'] === USER_A);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!['price'])).toBe(99);
    // A's row is untouched, price and all
    expect(theirs).toHaveLength(1);
    expect(Number(theirs[0]!['price'])).toBe(44.5);
  });

  it('A\'s recipe never inherits B\'s price', async () => {
    const user = userEvent.setup();
    const db = twoAccounts();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));

    // A's ₪44.50/kg on 250 g = ₪11.1. B's ₪125/kg would have been ₪31.3.
    const panel = await screen.findByLabelText('פוד קוסט');
    expect(panel).toHaveTextContent('₪11.1');
    expect(panel).not.toHaveTextContent('₪31');
  }, 30_000);

  it('recipesPricingOn tells B nothing about A\'s recipes', async () => {
    const db = twoAccounts();
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const b = createSupabaseRepository({
      client: project(db, USER_B, 'b@test.invalid').client as never,
      userId: USER_B,
    });
    // A has two recipes using this key. B must learn of neither — otherwise
    // the count alone would disclose how much of somebody else's notebook
    // uses a material.
    expect(await b.recipesPricingOn('חמאה 82%')).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a version keeps its historical meaning after a price change', () => {
  it('freezes the price it used, so an old cost does not drift', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    // 1. an edit, so V1 holds today's state — and, per migration 0011, the
    //    price that was in force when it was taken.
    let view = render(<AppUnderTest client={p.client} route="/recipe/brioche/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של חמאה 82%'));
    await user.type(screen.getByLabelText('כמות של חמאה 82%'), '260');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'בריוש' });

    const version = db['recipe_versions']!.find((v) => v['recipe_id'] === 'brioche')!;
    const snapIng = ((version['snapshot'] as Record<string, unknown>)['ingredients'] as Row[])[0]!;
    // The snapshot carries the resolved price, not a null to be filled in later
    // from whatever the centre says at the time it is read.
    expect(Number(snapIng['price'])).toBeCloseTo(44.5, 6);
    view.unmount();

    // 2. the price doubles in the centre
    db['ingredient_catalog']![0]!['package_price'] = 17.8;
    db['ingredient_catalog']![0]!['price'] = 89;

    // 3. the LIVE recipe follows the new price...
    view = render(<AppUnderTest client={p.client} route="/recipe/brioche" />);
    await screen.findByRole('heading', { name: 'בריוש' });
    await user.click(screen.getByText('נתוני ייצור ועלויות'));
    // 260 g at ₪89/kg = ₪23.14
    expect(await screen.findByLabelText('פוד קוסט')).toHaveTextContent('₪23.1');

    // 4. ...and the VERSION does not. Its snapshot still holds ₪44.50, which is
    //    what makes "this cost ₪11.13 in September" still true.
    const stillFrozen = ((db['recipe_versions']![0]!['snapshot'] as Record<string, unknown>)[
      'ingredients'
    ] as Row[])[0]!;
    expect(Number(stillFrozen['price'])).toBeCloseTo(44.5, 6);
    view.unmount();
  }, 40_000);
});
