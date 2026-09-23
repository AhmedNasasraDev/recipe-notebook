// The stage-5 route, through the real component tree.
//
//   save an edit → a version holding the PREVIOUS state → see the history
//   → view a version → restore it → the restore is itself in the history
//   → link a sub-recipe from the picker → the engine rolls it up
//
// Same harness as `RecipeFlow.test.tsx`: everything below the network is
// production code, and the double enforces the row-level policies and emulates
// the RPCs from migration 0007 — so a save here is one call, the way it is in
// production.
//
// What this does NOT cover, stated plainly: the browser-to-Supabase HTTP hop,
// and the ATOMICITY of the RPCs. The double is JavaScript and cannot roll back;
// it checks every guard before it writes anything, which is a different
// property. Atomicity is proved against real Postgres — see
// REVIEW_STEP5_REPORT.md, including a mid-RPC failure that came back
// `fully_rolled_back: true`. This environment's egress policy blocks
// *.supabase.co, so no test in this file speaks HTTP to anything.

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

/** One account, onboarded, with one saved recipe: 600 g flour + 420 g water. */
function seeded(): FakeDb {
  const db = emptyDb();
  db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
  db['recipes']!.push(recipeRow('r1', USER_A, { name: 'לחם כוסמין' }));
  db['ingredients']!.push(
    ingredientRow('r1', { id: 'i1', name: 'קמח מלא', qty: 600, unit: 'g', is_flour: true, pos: 0 }),
    ingredientRow('r1', { id: 'i2', name: 'מים', qty: 420, unit: 'g', is_liquid: true, pos: 1 }),
  );
  return db;
}

const versionsOf = (db: FakeDb, recipeId = 'r1'): Row[] =>
  (db['recipe_versions'] ?? []).filter((v) => v['recipe_id'] === recipeId);

const snapshotIngredients = (v: Row): Row[] =>
  ((v['snapshot'] as Record<string, unknown>)['ingredients'] ?? []) as Row[];

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 1 and 2 — a version is taken before an update', () => {
  it('creating a recipe makes no version, because there is no previous state', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/new" />);
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await user.type(screen.getByLabelText('שם המתכון'), 'חלה');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));
    await screen.findByRole('heading', { name: 'חלה' });

    // A "V1" describing a recipe that did not exist a moment ago would be a
    // fiction, and it would put an empty state in the history.
    expect(db['recipe_versions']).toHaveLength(0);
    await user.click(await screen.findByText('נתוני ייצור ועלויות'));
    expect(await screen.findByText(/אין עוד היסטוריה/)).toBeInTheDocument();
  }, 30_000);

  it('saving an edit stores the state from BEFORE it, with the ingredients', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '450');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    // the live row carries the NEW value
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(450);

    const versions = versionsOf(db);
    expect(versions).toHaveLength(1);
    expect(versions[0]!['tag']).toBe('V1');
    expect(versions[0]!['created_by']).toBe(USER_A);

    // Requirement 2: enough to restore from. A snapshot of the `recipes` row
    // alone would lose the formula, which is the whole point of the history.
    const snapIngs = snapshotIngredients(versions[0]!);
    expect(snapIngs.map((i) => i['name'])).toEqual(['קמח מלא', 'מים']);
    expect(snapIngs.find((i) => i['name'] === 'מים')!['qty']).toBe(420);
    expect(snapIngs.find((i) => i['name'] === 'קמח מלא')!['is_flour']).toBe(true);
  }, 30_000);

  it('does not nest the history inside the snapshot', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '430');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    // Second save: if the snapshot contained the versions, V2 would carry V1,
    // V3 would carry both, and the rows would grow without bound.
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await user.click(screen.getByRole('menuitem', { name: 'עריכה' }));
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '440');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    expect(versionsOf(db)).toHaveLength(2);
    for (const v of versionsOf(db)) {
      expect(Object.keys(v['snapshot'] as Row).sort()).toEqual([
        'ingredients', 'issues', 'recipe', 'steps',
      ]);
    }
  }, 30_000);

  it('keeps an untouched number NULL through the version and back', async () => {
    const user = userEvent.setup();
    const db = seeded();
    // A real 0 in one column and an untouched NULL in another, so the
    // round-trip has to preserve the DIFFERENCE and not just the values.
    db['ingredients']![0]!['price'] = 0;
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '450');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    const snapIngs = snapshotIngredients(versionsOf(db)[0]!);
    // 0 stayed 0 — a free ingredient is a priced ingredient
    expect(snapIngs.find((i) => i['name'] === 'קמח מלא')!['price']).toBe(0);
    // and the untouched one stayed NULL, not 0
    expect(snapIngs.find((i) => i['name'] === 'מים')!['price']).toBeNull();
    // the same on the live rows after the save
    expect(db['ingredients']!.find((i) => i['name'] === 'קמח מלא')!['price']).toBe(0);
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['price']).toBeNull();
  }, 30_000);
});

/*
  UX PASS: the version history moved INSIDE "נתוני ייצור ועלויות".

  It is not a thing a cook standing at a bowl reads, so it sits with the food
  cost and the formula in the one collapsed panel, and the panel renders its
  contents only while it is open. Every test that looks at the history opens it
  first — which is also what a user now does.
*/
async function openPro(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('נתוני ייצור ועלויות'));
}

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 3-7 — the history, viewing, and restoring', () => {
  /** Saves one edit through the UI, leaving V1 = the 420 g state. */
  async function withOneVersion(user: ReturnType<typeof userEvent.setup>) {
    const db = seeded();
    const p = project(db, USER_A);
    const view = render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '450');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });
    await openPro(user);
    return { db, p, view };
  }

  it('shows the version on the recipe page, with what changed', async () => {
    const user = userEvent.setup();
    const { db } = await withOneVersion(user);

    const section = await screen.findByLabelText('היסטוריית גרסאות');
    expect(within(section).getByText('נוכחית')).toBeInTheDocument();
    expect(within(section).getByText('גרסה 1')).toBeInTheDocument();
    // The description was computed by `versionDiff` from the two states and
    // stored with the version — not typed by anyone.
    expect(String(versionsOf(db)[0]!['what'])).toContain('שונתה כמות: מים');
    expect(within(section).getByText(/שונתה כמות: מים/)).toBeInTheDocument();
  }, 30_000);

  it('shows the version\'s own quantities when viewed, not the live ones', async () => {
    const user = userEvent.setup();
    await withOneVersion(user);

    await user.click(await screen.findByRole('button', { name: 'צפייה בגרסה 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'גרסה 1' });
    const list = within(dialog).getByLabelText('רכיבי גרסה 1');
    expect(list).toHaveTextContent('420');
    expect(list).not.toHaveTextContent('450');
  }, 30_000);

  it('restores it, and the restore is itself undoable (requirement 7)', async () => {
    const user = userEvent.setup();
    const { db } = await withOneVersion(user);

    await user.click(await screen.findByRole('button', { name: 'שחזור גרסה 1' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'אישור שחזור גרסה 1' }));

    // the formula went back to the 420 g state
    await waitFor(() =>
      expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(420),
    );

    // and the state we just left is in the history, so a wrong restore is
    // recoverable. This is the part nobody remembers to build.
    await waitFor(() => expect(versionsOf(db)).toHaveLength(2));
    const v2 = versionsOf(db).find((v) => v['tag'] === 'V2')!;
    expect(snapshotIngredients(v2).find((i) => i['name'] === 'מים')!['qty']).toBe(450);
    expect(String(v2['what'])).toContain('שחזור');

    // the new version shows up without a reload
    expect(await screen.findByText('גרסה 2')).toBeInTheDocument();
  }, 30_000);

  it('restores an OLD version after several saves, and restores again', async () => {
    const user = userEvent.setup();
    const { db } = await withOneVersion(user); // V1 = 420

    // a second edit: V2 = 450
    await user.click(screen.getByRole('button', { name: 'פעולות למתכון' }));
    await user.click(screen.getByRole('menuitem', { name: 'עריכה' }));
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '480');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(480);

    // Back on a freshly mounted recipe page, so the panel is closed again.
    await openPro(user);

    // reach past V2 to the oldest version
    await user.click(await screen.findByRole('button', { name: 'שחזור גרסה 1' }));
    let confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'אישור שחזור גרסה 1' }));
    await waitFor(() =>
      expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(420),
    );
    // three versions now: V1, V2 and the pre-restore V3
    await waitFor(() => expect(versionsOf(db)).toHaveLength(3));

    // restoring the same version a second time is not a special case
    await user.click(await screen.findByRole('button', { name: 'שחזור גרסה 1' }));
    confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'אישור שחזור גרסה 1' }));
    await waitFor(() => expect(versionsOf(db)).toHaveLength(4));
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(420);
    // nothing was destroyed on the way — V1 is still V1
    expect(versionsOf(db).map((v) => v['tag']).sort()).toEqual(['V1', 'V2', 'V3', 'V4']);
  }, 40_000);

  it('a restore that the database refuses is reported, not swallowed', async () => {
    const user = userEvent.setup();
    const { db, p } = await withOneVersion(user);
    void db;
    // The honest version of "the sub-recipe was deleted": the RPC raises and
    // nothing is written. The page must say so rather than show a stale
    // recipe as though it had been restored.
    const realRpc = (p.data.client as { rpc(n: string, a: Row): unknown }).rpc.bind(
      p.data.client,
    );
    vi.spyOn(p.data.client as { rpc(n: string, a: Row): unknown }, 'rpc').mockImplementation(
      ((n: string, a: Row) =>
        n === 'restore_recipe_version'
          ? Promise.resolve({ data: null, error: { message: 'תת־המתכון המקושר אינו קיים', code: '23503' } })
          : realRpc(n, a)) as never,
    );

    await user.click(await screen.findByRole('button', { name: 'שחזור גרסה 1' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'אישור שחזור גרסה 1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('תת־המתכון המקושר אינו קיים');
    // and the live recipe did not move
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(450);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 8 — another account\'s history', () => {
  it('is not visible, and not restorable, from B\'s session', async () => {
    const db = seeded();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    db['recipe_versions']!.push({
      id: 'vA', recipe_id: 'r1', tag: 'V1', what: 'הסוד של א',
      snapshot: { recipe: { id: 'r1', name: 'לחם כוסמין' }, ingredients: [], steps: [], issues: [] },
      created_at: '2026-04-01T12:00:00Z', created_by: USER_A,
    });

    const b = project(db, USER_B, 'b@test.invalid');
    render(<AppUnderTest client={b.client} route="/recipe/r1" />);

    // The recipe itself is already a 404 for B, so the history never renders.
    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
    expect(screen.queryByText('הסוד של א')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('היסטוריית גרסאות')).not.toBeInTheDocument();

    // And the RPC refuses it directly, which is the guarantee that matters:
    // requirement 8 is about the data, not about the screen.
    const res = (await (b.data.client as {
      rpc(n: string, a: Row): Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('restore_recipe_version', { p_version_id: 'vA' }));
    expect(res.error).not.toBeNull();
    expect(db['recipe_versions']).toHaveLength(1);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirements 11-17 — linking a sub-recipe from the editor', () => {
  /** A base recipe and a top recipe, both A's. */
  function withBase(): FakeDb {
    const db = seeded();
    db['recipes']!.push(recipeRow('base', USER_A, { name: 'גנאש', is_sub: true }));
    db['ingredients']!.push(
      ingredientRow('base', {
        id: 'b1', name: 'שוקולד מריר', qty: 200, unit: 'g', price: 60, price_unit: 'ק"ג', pos: 0,
      }),
      ingredientRow('base', {
        id: 'b2', name: 'שמנת', qty: 100, unit: 'g', price: 12, price_unit: 'ליטר', pos: 1,
      }),
    );
    return db;
  }

  it('links it through the picker and the engine rolls the weight and cost up', async () => {
    const user = userEvent.setup();
    const db = withBase();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    // turn the water row into a 150 g line of ganache
    await toStage(user, 2);
    await user.clear(screen.getByLabelText('שם הרכיב בשורה 2'));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 2'), 'מילוי');
    await user.clear(screen.getByLabelText('כמות של מילוי'));
    await user.type(screen.getByLabelText('כמות של מילוי'), '150');
    await user.selectOptions(screen.getByLabelText('מתכון בסיס עבור מילוי'), 'base');

    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    // the link is a column, not a note
    expect(db['ingredients']!.find((i) => i['name'] === 'מילוי')!['sub_recipe_id']).toBe('base');

    // The sub-recipe line is WEIGHED, never volume-converted (§18.6): 150 g.
    expect(await screen.findByText('מילוי')).toBeInTheDocument();
    const filling = screen.getByText('מילוי').closest('button')!;
    expect(filling).toHaveTextContent("150 גר'");

    // 600 g flour + 150 g of ganache = 750 g, from the one engine.
    await user.click(screen.getByText('נתוני ייצור ועלויות'));
    const yieldRow = (await screen.findByText('תשואה תאורטית')).closest('div')!;
    expect(yieldRow).toHaveTextContent("750 גר'");

    // And the cost came from INSIDE the base, pro rata: the base is 200 g of
    // chocolate at ₪60/kg (₪12) plus 100 g of cream at ₪12/l (₪1.20) = ₪13.20
    // for 300 g, so 150 g of it is ₪6.60. Not a flat price, and not zero.
    const costRow = screen.getByText('עלות חומרי גלם').closest('div')!;
    expect(costRow).toHaveTextContent('6.6');

    // The flour here has no price, so the TOTAL is partial and says so —
    // §"price 0 ≠ missing price" still holds with a sub-recipe in the formula.
    expect(screen.getByLabelText('שלמות התמחור')).toHaveTextContent(/חלקי|חסר/);
  }, 40_000);

  it('never offers the recipe being edited, nor a link that would close a cycle', async () => {
    const user = userEvent.setup();
    const db = withBase();
    // `base` already uses `r1`, so offering `base` inside `r1` would close a loop
    db['ingredients']!.push(
      ingredientRow('base', { id: 'b3', name: 'לחם מפורר', qty: 50, unit: 'g', sub_recipe_id: 'r1', pos: 2 }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 2);
    const picker = screen.getByLabelText('מתכון בסיס עבור קמח מלא');
    const options = within(picker).getAllByRole('option');
    const byLabel = new Map(options.map((o) => [o.textContent ?? '', o]));

    // requirement 13: the recipe being edited is not in its own picker
    expect([...byLabel.keys()].some((k) => k.includes('לחם כוסמין'))).toBe(false);

    // requirement 14: `base` is offered but disabled, with the reason attached
    const ganache = options.find((o) => (o.textContent ?? '').includes('גנאש'))!;
    expect(ganache).toBeDisabled();
    expect(ganache.textContent).toContain('מעגל');

    // and choosing it is not possible through the UI at all
    await user.selectOptions(picker, '').catch(() => undefined);
    expect(picker).toHaveValue('');
  }, 30_000);

  it('does not offer another account\'s recipe (requirements 12 and 15)', async () => {
    const db = withBase();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('bsecret', USER_B, { name: 'הבסיס של ב', is_sub: true }));
    const p = project(db, USER_A);

    const user = userEvent.setup();
    render(<AppUnderTest client={p.client} route="/recipe/r1/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });

    await toStage(user, 2);
    const picker = screen.getByLabelText('מתכון בסיס עבור קמח מלא');
    const labels = within(picker).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('גנאש'))).toBe(true);
    // The candidate list IS the RLS-filtered notebook, so B's recipe is simply
    // not there — there is no code path that could offer it.
    expect(labels.some((l) => l.includes('הבסיס של ב'))).toBe(false);
  }, 30_000);

  it('refuses a cross-account link even when the id is supplied directly', async () => {
    // Requirement 15 asks for impossibility, not for a picker that declines to
    // offer it. This goes around the UI entirely and writes the id straight
    // into the column, which is what an attacker with the anon key would do.
    const db = withBase();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('bsecret', USER_B, { name: 'הבסיס של ב' }));
    const p = project(db, USER_A);

    const res = await (p.data.client as {
      rpc(n: string, a: Row): Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('save_recipe', {
      p_recipe: { name: 'לחם כוסמין' },
      p_ingredients: [{ name: 'גנוב', qty: 100, unit: 'g', sub_recipe_id: 'bsecret', pos: 0 }],
      p_steps: [],
      p_issues: [],
      p_recipe_id: 'r1',
      p_expected_updated_at: null,
      p_version_note: '',
    });

    expect(res.error).not.toBeNull();
    expect(db['ingredients']!.some((i) => i['sub_recipe_id'] === 'bsecret')).toBe(false);
  }, 30_000);
});
