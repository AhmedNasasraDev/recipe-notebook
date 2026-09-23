// "A recipe in use as a sub-recipe cannot be deleted" — through the real
// component tree (stage-6 requirements 1-6).
//
// Same harness as the other flow tests: the router, AuthProvider, AppDataProvider,
// the screens and `SupabaseRepository` are all production code, and only the
// network is a double. The double models migration 0008's guard on BOTH routes —
// the `delete_recipe` RPC and a raw DELETE against the table — because in
// Postgres the guard is a foreign key and applies to every route in.
//
// What it does NOT prove: the HTTP hop, and the constraint itself. The database
// half is `supabase/tests/delete-guard.sql`, which runs the same cases against
// the live project as `authenticated` and as `anon` (17 checks). This file
// proves the SCREEN does the right thing with the refusal — which is the half
// SQL cannot check, since a foreign-key violation cannot name the recipes that
// are holding the thing.

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

/** A's notebook: `base` (a ganache) used by `top` (a cake), plus a loner. */
function linked(): FakeDb {
  const db = emptyDb();
  db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
  db['recipes']!.push(
    recipeRow('base', USER_A, { name: 'גנאש בסיס', is_sub: true }),
    recipeRow('top', USER_A, { name: 'עוגת שוקולד' }),
    recipeRow('lonely', USER_A, { name: 'לחם פשוט' }),
  );
  db['ingredients']!.push(
    ingredientRow('base', { id: 'b1', name: 'שוקולד מריר', qty: 200, unit: 'g', pos: 0 }),
    ingredientRow('top', { id: 't1', name: 'קמח לבן', qty: 300, unit: 'g', pos: 0 }),
    ingredientRow('top', {
      id: 't2', name: 'גנאש', qty: 150, unit: 'g', sub_recipe_id: 'base', pos: 1,
    }),
    ingredientRow('lonely', { id: 'l1', name: 'קמח לבן', qty: 500, unit: 'g', pos: 0 }),
  );
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
/*
  UX PASS: "שכפול" and "מחיקה" moved under the recipe page's "עוד פעולות"
  panel — occasional actions, off the first screenful, one tap away. Opening
  it is what a user now does, so the flows do it too.
*/
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'פעולות למתכון' }));
}

describe('requirements 1-3 — the delete is refused, and the screen says why', () => {
  it('refuses, and names the recipe that is holding it', async () => {
    const user = userEvent.setup();
    const db = linked();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    const dialog = await screen.findByRole('alertdialog');

    // Not "are you sure" — the delete is not on offer at all.
    expect(dialog).toHaveTextContent('אי אפשר למחוק');
    expect(dialog).toHaveTextContent('מתכון אחד משתמש בו כמתכון בסיס');
    // requirement 3: WHICH recipe. A foreign-key violation cannot say this.
    const deps = within(dialog).getByLabelText('מתכונים שמשתמשים במתכון הזה');
    expect(within(deps).getByRole('link', { name: 'עוגת שוקולד' })).toBeInTheDocument();

    // and there is no way to proceed from here
    expect(
      within(dialog).queryByRole('button', { name: /אישור מחיקת/ }),
    ).not.toBeInTheDocument();
    expect(db['recipes']!.some((r) => r['id'] === 'base')).toBe(true);
  }, 30_000);

  it('offers the dependent as a link, because unlinking it is the way out', async () => {
    const user = userEvent.setup();
    const p = project(linked(), USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByRole('link', { name: 'עוגת שוקולד' }),
    ).toHaveAttribute('href', '/recipe/top/edit');
  }, 30_000);

  it('counts them when more than one recipe uses it', async () => {
    const user = userEvent.setup();
    const db = linked();
    db['recipes']!.push(recipeRow('third', USER_A, { name: 'טארט' }));
    db['ingredients']!.push(
      ingredientRow('third', {
        id: 'x1', name: 'גנאש', qty: 80, unit: 'g', sub_recipe_id: 'base', pos: 0,
      }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('2 מתכונים משתמשים בו כמתכון בסיס');
    const deps = within(dialog).getByLabelText('מתכונים שמשתמשים במתכון הזה');
    expect(within(deps).getAllByRole('link')).toHaveLength(2);
  }, 30_000);

  it('still deletes a recipe nobody uses, with the ordinary confirmation', async () => {
    const user = userEvent.setup();
    const db = linked();
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/lonely" />);
    await screen.findByRole('heading', { name: 'לחם פשוט' });
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('למחוק את');
    expect(dialog).toHaveTextContent('יומן הניסיונות');
    await user.click(within(dialog).getByRole('button', { name: 'אישור מחיקת לחם פשוט' }));

    await waitFor(() => expect(db['recipes']!.some((r) => r['id'] === 'lonely')).toBe(false));
    // and the other two are untouched
    expect(db['recipes']!.map((r) => r['id']).sort()).toEqual(['base', 'top']);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 4 — once the dependency is gone, the delete works', () => {
  it('unlink through the editor, then delete the base recipe', async () => {
    const user = userEvent.setup();
    const db = linked();
    const p = project(db, USER_A);

    // ── blocked to begin with
    let view = render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    expect(await screen.findByText(/אי אפשר למחוק/)).toBeInTheDocument();
    view.unmount();

    // ── remove the link in the dependent recipe, the way a user would
    view = render(<AppUnderTest client={p.client} route="/recipe/top/edit" />);
    await screen.findByRole('heading', { name: 'עריכת מתכון' });
    await toStage(user, 2);
    await user.selectOptions(screen.getByLabelText('מתכון בסיס עבור גנאש'), '');
    await toStage(user, 4);
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await screen.findByRole('heading', { name: 'עוגת שוקולד' });
    expect(db['ingredients']!.find((i) => i['name'] === 'גנאש')!['sub_recipe_id']).toBeNull();
    view.unmount();

    // ── and now it deletes
    view = render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('למחוק את');
    await user.click(within(dialog).getByRole('button', { name: 'אישור מחיקת גנאש בסיס' }));

    await waitFor(() => expect(db['recipes']!.some((r) => r['id'] === 'base')).toBe(false));
    view.unmount();
  }, 40_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 5 — going around the UI does not help', () => {
  it('the repository refuses, not just the screen', async () => {
    const db = linked();
    const p = project(db, USER_A);
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');
    const { RecipeInUseError } = await import('../data/repository.js');

    const repo = createSupabaseRepository({
      client: p.client as never,
      userId: USER_A,
    });
    await expect(repo.deleteRecipe('base')).rejects.toThrow(RecipeInUseError);
    expect(db['recipes']!.some((r) => r['id'] === 'base')).toBe(true);
  });

  it('and a raw DELETE straight at the table refuses too', async () => {
    // Which is what the anon key can send to PostgREST with no function and no
    // repository involved. In Postgres this is the foreign key from 0008.
    const db = linked();
    const p = project(db, USER_A);

    const res = await (p.client as unknown as {
      from(t: string): {
        delete(): { eq(c: string, v: string): Promise<{ error: { code?: string } | null }> };
      };
    })
      .from('recipes')
      .delete()
      .eq('id', 'base');

    expect(res.error?.code).toBe('23503');
    expect(db['recipes']!.some((r) => r['id'] === 'base')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 6 — the refusal says nothing about another account', () => {
  it('B is not told that A holds a recipe of theirs', async () => {
    const db = linked();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    const b = project(db, USER_B, 'b@test.invalid');

    render(<AppUnderTest client={b.client} route="/recipe/base" />);

    // A 404, exactly as for any id B does not own. Not "in use", which would
    // confirm the id exists and that something refers to it.
    expect(await screen.findByText(/לא נמצא במחברת/)).toBeInTheDocument();
    expect(screen.queryByText(/אי אפשר למחוק/)).not.toBeInTheDocument();
    expect(screen.queryByText('עוגת שוקולד')).not.toBeInTheDocument();
  }, 30_000);

  it('recipesUsing tells B nothing about A\'s recipe', async () => {
    const db = linked();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    const b = project(db, USER_B, 'b@test.invalid');
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');

    const repo = createSupabaseRepository({ client: b.client as never, userId: USER_B });
    expect(await repo.recipesUsing('base')).toEqual([]);
  });

  it('B deleting A\'s recipe is a no-op, not a refusal', async () => {
    // The distinction matters: a REFUSAL would say "this exists and is held".
    // A no-op says nothing at all, which is the same answer B gets for an id
    // that was never real.
    const db = linked();
    db['profiles']!.push(newProfileRow(USER_B, { onboarding_done: true }));
    const b = project(db, USER_B, 'b@test.invalid');
    const { createSupabaseRepository } = await import('../data/supabaseRepository.js');

    const repo = createSupabaseRepository({ client: b.client as never, userId: USER_B });
    // `lonely` has no dependents, so any error here would be about ownership.
    await expect(repo.deleteRecipe('lonely')).resolves.toBeUndefined();
    // and A's recipe is untouched
    expect(db['recipes']!.some((r) => r['id'] === 'lonely')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a dependency added by another tab between the check and the delete', () => {
  it('is caught by the database and the screen adopts its answer', async () => {
    const user = userEvent.setup();
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    db['recipes']!.push(
      recipeRow('base', USER_A, { name: 'גנאש בסיס' }),
      recipeRow('top', USER_A, { name: 'עוגת שוקולד' }),
    );
    db['ingredients']!.push(
      ingredientRow('base', { id: 'b1', name: 'שוקולד', qty: 200, unit: 'g', pos: 0 }),
      ingredientRow('top', { id: 't1', name: 'קמח', qty: 300, unit: 'g', pos: 0 }),
    );
    const p = project(db, USER_A);

    render(<AppUnderTest client={p.client} route="/recipe/base" />);
    await screen.findByRole('heading', { name: 'גנאש בסיס' });

    // The screen loaded with NO dependents, so it offers the ordinary confirm.
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('למחוק את');

    // Another tab links it while the dialog is open.
    db['ingredients']!.push(
      ingredientRow('top', {
        id: 't2', name: 'גנאש', qty: 150, unit: 'g', sub_recipe_id: 'base', pos: 1,
      }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'אישור מחיקת גנאש בסיס' }));

    // The delete is refused and the dialog turns into the explanation, with the
    // dependents the refusal came with — not a generic "failed" message.
    dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent('אי אפשר למחוק'));
    expect(
      within(dialog).getByRole('link', { name: 'עוגת שוקולד' }),
    ).toBeInTheDocument();
    expect(db['recipes']!.some((r) => r['id'] === 'base')).toBe(true);
  }, 30_000);
});
