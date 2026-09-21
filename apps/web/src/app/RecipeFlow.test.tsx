// The whole stage-4 route, in one test file, through the real component tree.
//
//   sign in → onboarding → empty notebook → new recipe → fill in ingredients
//   → save → refresh → reopen → edit → save → duplicate → delete
//
// Everything below the network is real: the router, AuthProvider, AuthGate,
// AppDataProvider, the screens, the draft model, `mappers.ts` and
// `SupabaseRepository`. Only the HTTP hop is a double — and it is a double that
// enforces the row-level policies from the migrations, so "this account cannot
// see that row" still means what it means in production.
//
// "Refresh" here is `unmount()` followed by a fresh `render()`. That is what a
// browser reload actually does to a React app: every component is destroyed,
// all state is lost, and the session is restored from storage. So a value that
// survives it survived for the right reason — it came back from the database
// and not from a closure.
//
// What this does NOT cover, stated plainly: the browser-to-Supabase HTTP hop.
// This environment's egress policy blocks *.supabase.co. The real-database half
// of the proof is supabase/tests/mapper-roundtrip.sql and the digest check
// described in REVIEW_STEP4_REPORT.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  newProfileRow,
  recipeRow,
  resetFakeIds,
  USER_A,
  USER_B,
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
  // jsdom throws on window.confirm. The editor uses it only for the
  // discard-unsaved-changes prompt, and these tests answer "yes".
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ───────────────────────────────────────────────────────────────────────────
/*
  UX PASS: "שכפול" and "מחיקה" moved under the recipe page's "עוד פעולות"
  panel — occasional actions, off the first screenful, one tap away. Opening
  it is what a user now does, so the flows do it too.
*/
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('עוד פעולות'));
}

describe('the whole route, end to end', () => {
  it('signs in, onboards, creates, saves, reloads, edits, duplicates, deletes', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A)); // onboarding_done: false
    const p = project(db, USER_A);

    // ── 1. signed in, and sent to onboarding rather than into the notebook
    let view = render(<AppUnderTest client={p.client} />);
    expect(await screen.findByRole('button', { name: /מקצועי/ })).toBeInTheDocument();

    // ── 2. answer the onboarding
    await user.click(screen.getByRole('button', { name: /מקצועי/ }));
    let next = screen.queryByRole('button', { name: /המשך|סיום|למחברת/ });
    let guard = 0;
    while (next && guard++ < 8) {
      await user.click(next);
      next = screen.queryByRole('button', { name: /המשך|סיום|למחברת/ });
    }
    await waitFor(() => expect(db['profiles']![0]!['onboarding_done']).toBe(true));

    // ── 3. the notebook is empty, and says how to start
    expect(await screen.findByText('המחברת ריקה.')).toBeInTheDocument();
    expect(screen.queryByText('בריוש נאנטר')).not.toBeInTheDocument();

    // ── 4. into the editor
    await user.click(screen.getByRole('link', { name: 'יצירת המתכון הראשון' }));
    expect(await screen.findByRole('heading', { name: 'מתכון חדש' })).toBeInTheDocument();

    // ── 5. fill it in: two weighed rows and one in cups
    await user.type(screen.getByLabelText('שם המתכון'), 'לחם כוסמין');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח מלא');
    await user.type(screen.getByLabelText('כמות של קמח מלא'), '600');

    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 2'), 'מים');
    await user.type(screen.getByLabelText('כמות של מים'), '420');

    await toStage(user, 3);
    await user.type(screen.getByLabelText('תיאור שלב 1'), 'ללוש, להתפיח, לאפות.');
    await user.type(screen.getByLabelText('זמן בדקות בשלב 1'), '45');

    // ── 6. save
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));

    // landed on the recipe page, with the engine's figures
    expect(await screen.findByRole('heading', { name: 'לחם כוסמין' })).toBeInTheDocument();

    // the rows really are in the database, under this account
    expect(db['recipes']).toHaveLength(1);
    const savedId = db['recipes']![0]!['id'] as string;
    expect(db['recipes']![0]!['owner_id']).toBe(USER_A);
    expect(db['recipes']![0]!['name']).toBe('לחם כוסמין');
    expect(db['ingredients']!.map((i) => i['name'])).toEqual(['קמח מלא', 'מים']);
    expect(db['steps']!.map((s) => s['text'])).toEqual(['ללוש, להתפיח, לאפות.']);
    // and the untouched measured yield is NULL, not 0
    expect(db['recipes']![0]!['yield_actual']).toBeNull();

    // ── 7. refresh: everything is destroyed and rebuilt from the database
    view.unmount();
    view = render(<AppUnderTest client={p.client} />);

    // no second trip through the onboarding, and the recipe is there
    await waitFor(() => expect(screen.queryByRole('button', { name: /מקצועי/ })).toBeNull());
    expect(await screen.findByText('לחם כוסמין')).toBeInTheDocument();
    expect(screen.getByText(/^מתכון אחד$/)).toBeInTheDocument();

    // ── 8. reopen it
    await user.click(screen.getByText('לחם כוסמין'));
    expect(await screen.findByRole('heading', { name: 'לחם כוסמין' })).toBeInTheDocument();

    // ── 9. edit
    await user.click(screen.getByRole('link', { name: 'עריכת לחם כוסמין' }));
    expect(await screen.findByRole('heading', { name: 'עריכת מתכון' })).toBeInTheDocument();
    await toStage(user, 2);
    expect(screen.getByLabelText('כמות של קמח מלא')).toHaveValue('600');

    await user.clear(screen.getByLabelText('כמות של מים'));
    await user.type(screen.getByLabelText('כמות של מים'), '450');
    await user.click(screen.getByRole('button', { name: 'הוספת רכיב' }));
    await user.type(screen.getByLabelText('שם הרכיב בשורה 3'), 'מלח');
    await user.type(screen.getByLabelText('כמות של מלח'), '12');

    // ── 10. save the edit — same recipe, not a second one
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });

    expect(db['recipes']).toHaveLength(1);
    expect(db['recipes']![0]!['id']).toBe(savedId);
    expect(db['ingredients']!.map((i) => i['name'])).toEqual(['קמח מלא', 'מים', 'מלח']);
    // A NUMBER in the column, not the form's string: the draft holds strings so
    // that an empty field can stay NULL, and `ingredientsToRows` converts at the
    // boundary. Both halves of that are load-bearing.
    expect(db['ingredients']!.find((i) => i['name'] === 'מים')!['qty']).toBe(450);

    // the edit survives a refresh too
    view.unmount();
    view = render(<AppUnderTest client={p.client} />);
    await user.click(await screen.findByText('לחם כוסמין'));
    await screen.findByRole('heading', { name: 'לחם כוסמין' });
    expect(screen.getByText('מלח')).toBeInTheDocument();

    // ── 11. duplicate
    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'שכפול לחם כוסמין' }));
    expect(
      await screen.findByRole('heading', { name: 'לחם כוסמין (עותק)' }),
    ).toBeInTheDocument();

    expect(db['recipes']).toHaveLength(2);
    const names = db['recipes']!.map((r) => r['name']);
    expect(names).toContain('לחם כוסמין');
    expect(names).toContain('לחם כוסמין (עותק)');
    // the copy has its own ingredient rows, not the original's
    const copyId = db['recipes']!.find((r) => r['name'] === 'לחם כוסמין (עותק)')!['id'];
    expect(db['ingredients']!.filter((i) => i['recipe_id'] === copyId)).toHaveLength(3);
    expect(db['ingredients']!.filter((i) => i['recipe_id'] === savedId)).toHaveLength(3);

    // ── 12. delete the copy, with the confirmation
    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'מחיקת לחם כוסמין (עותק)' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'אישור מחיקת מתכון' });
    expect(confirm).toHaveTextContent('יימחקו גם הרכיבים');
    await user.click(
      within(confirm).getByRole('button', { name: 'אישור מחיקת לחם כוסמין (עותק)' }),
    );

    // back in the notebook, with the original intact
    expect(await screen.findByText(/^מתכון אחד$/)).toBeInTheDocument();
    expect(db['recipes']).toHaveLength(1);
    expect(db['recipes']![0]!['name']).toBe('לחם כוסמין');
    // ON DELETE CASCADE took the copy's children with it, and only those
    expect(db['ingredients']!.every((i) => i['recipe_id'] === savedId)).toBe(true);
    expect(db['ingredients']).toHaveLength(3);

    view.unmount();
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('the delete confirmation (requirement 7)', () => {
  const seeded = () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('r1', USER_A, { name: 'חלה של אחמד' }));
    return db;
  };

  it('does not delete anything until it is confirmed', async () => {
    const user = userEvent.setup();
    const db = seeded();
    const p = project(db, USER_A);
    render(<AppUnderTest client={p.client} route="/recipe/r1" />);
    await screen.findByRole('heading', { name: 'חלה של אחמד' });

    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'מחיקת חלה של אחמד' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(db['recipes']).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'ביטול המחיקה' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(db['recipes']).toHaveLength(1);
  });

  it('says what else goes with the recipe, which a native confirm cannot', async () => {
    const user = userEvent.setup();
    const p = project(seeded(), USER_A);
    render(<AppUnderTest client={p.client} route="/recipe/r1" />);
    await screen.findByRole('heading', { name: 'חלה של אחמד' });

    await openMore(user);
    await user.click(screen.getByRole('button', { name: 'מחיקת חלה של אחמד' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('חלה של אחמד');
    expect(dialog).toHaveTextContent(/יומן הניסיונות/);
    expect(dialog).toHaveTextContent(/אי אפשר לשחזר/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a recipe created by one account is invisible to the other', () => {
  it('keeps two notebooks apart across the whole create-and-read cycle', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(
      newProfileRow(USER_A, { onboarding_done: true }),
      newProfileRow(USER_B, { onboarding_done: true }),
    );

    // A creates a recipe through the UI.
    const a = project(db, USER_A, 'a@test.invalid');
    const viewA = render(<AppUnderTest client={a.client} route="/recipe/new" />);
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await user.type(screen.getByLabelText('שם המתכון'), 'הסוד של א');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קמח לבן');
    await user.type(screen.getByLabelText('כמות של קמח לבן'), '500');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));
    await screen.findByRole('heading', { name: 'הסוד של א' });
    const aId = db['recipes']![0]!['id'] as string;
    viewA.unmount();

    // B signs in against the same database.
    const b = project(db, USER_B, 'b@test.invalid');
    render(<AppUnderTest client={b.client} />);

    expect(await screen.findByText('המחברת ריקה.')).toBeInTheDocument();
    expect(screen.queryByText('הסוד של א')).not.toBeInTheDocument();

    // `aId` was captured and then never used, which lint found. Rather than
    // drop the line, it now carries the stronger assertion: B asking for A's
    // recipe BY ITS ID — the thing a screen cannot do but a client can — comes
    // back with nothing. The double models the RLS policy, and
    // supabase/tests/rls-isolation.sql proves the same thing against Postgres.
    const asB = await (
      b.client as unknown as {
        from(t: string): {
          select(c: string): { eq(col: string, v: string): Promise<{ data: unknown[] | null }> };
        };
      }
    )
      .from('recipes')
      .select('*')
      .eq('id', aId);
    expect(asB.data ?? []).toHaveLength(0);
  });

  it('refuses B a direct link to A\'s recipe', async () => {
    const db = emptyDb();
    db['profiles']!.push(
      newProfileRow(USER_A, { onboarding_done: true }),
      newProfileRow(USER_B, { onboarding_done: true }),
    );
    db['recipes']!.push(recipeRow('secret', USER_A, { name: 'הסוד של א' }));

    const b = project(db, USER_B, 'b@test.invalid');
    render(<AppUnderTest client={b.client} route="/recipe/secret" />);

    // The id is real. RLS is what makes it a 404, not a guess about the id.
    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
    expect(screen.queryByText('הסוד של א')).not.toBeInTheDocument();
  });

  it('refuses B the edit route for it too', async () => {
    const db = emptyDb();
    db['profiles']!.push(
      newProfileRow(USER_A, { onboarding_done: true }),
      newProfileRow(USER_B, { onboarding_done: true }),
    );
    db['recipes']!.push(recipeRow('secret', USER_A, { name: 'הסוד של א' }));

    const b = project(db, USER_B, 'b@test.invalid');
    render(<AppUnderTest client={b.client} route="/recipe/secret/edit" />);

    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('הסוד של א')).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a calibration taken in the app persists and closes the gap', () => {
  it('saves to the account and turns a partial recipe into a full one', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const p = project(db, USER_A);

    // A recipe with cocoa in cups: pending-verification, so unweighable.
    const view = render(<AppUnderTest client={p.client} route="/recipe/new" />);
    await screen.findByRole('heading', { name: 'מתכון חדש' });
    await user.type(screen.getByLabelText('שם המתכון'), 'עוגת שוקולד');
    await toStage(user, 2);
    await user.type(screen.getByLabelText('שם הרכיב בשורה 1'), 'קקאו');
    await user.type(screen.getByLabelText('כמות של קקאו'), '1');
    await user.selectOptions(screen.getByLabelText('יחידת המדידה של קקאו'), 'cup');

    expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('לא ניתן לחשב');

    // Calibrate from inside the editor.
    await user.click(screen.getByRole('button', { name: 'כיול אישי של קקאו' }));
    const sheet = await screen.findByRole('dialog', { name: 'כיול אישי' });
    await user.type(within(sheet).getByLabelText(/משקל כוס אחת/), '105');
    await user.click(within(sheet).getByRole('button', { name: 'שמירת הכיול' }));

    // It reached the database, under this account, with the volume frozen.
    await waitFor(() => expect(db['calibrations']).toHaveLength(1));
    expect(db['calibrations']![0]!['user_id']).toBe(USER_A);
    expect(db['calibrations']![0]!['ingredient_name']).toBe('קקאו');
    expect(db['calibrations']![0]!['tool_ml']).toBe(240);
    expect(db['calibrations']![0]!['grams']).toBe(105);

    // And the calculation is complete now, with no table value having changed.
    await waitFor(() =>
      expect(screen.getByLabelText('שלמות החישוב')).toHaveTextContent('חישוב מלא'),
    );

    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת המתכון' }));
    await screen.findByRole('heading', { name: 'עוגת שוקולד' });

    // ── the calibration survives a refresh, because it is on the server
    view.unmount();
    // STAGE-11: the calibration list moved from "עוד" to כלי המדידה שלי, which
    // is where §2 screen 21 puts it. The assertion is unchanged.
    render(<AppUnderTest client={p.client} route="/tools" />);
    expect(await screen.findByText('קקאו')).toBeInTheDocument();
    expect(screen.getByText(/כיול אישי אחד/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'הסרת הכיול של קקאו בכוס' }),
    ).toBeInTheDocument();
  }, 40_000);
});
