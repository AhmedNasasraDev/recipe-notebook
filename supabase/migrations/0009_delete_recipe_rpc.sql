-- ─────────────────────────────────────────────────────────────────────────────
-- 0009 — delete_recipe(): one call, a clear refusal, and no reliance on how
--        PostgREST reports a commit-time error
--
-- Migration 0008 is the enforcement: `ingredients_sub_recipe_id_fkey` is
-- NO ACTION DEFERRABLE INITIALLY DEFERRED, so a recipe in use as a sub-recipe
-- cannot be deleted by any route. This function does not add a guarantee. It
-- fixes two things about the experience of hitting that guarantee.
--
-- 1. DEFERRED means the violation is raised at COMMIT, not at the DELETE. For
--    a PostgREST request the commit happens after the statement, at the end of
--    the request, and this environment's egress policy blocks *.supabase.co —
--    so I cannot verify over HTTP how that surfaces. `SET CONSTRAINTS ...
--    IMMEDIATE` at the end of this function forces the check to run inside the
--    call, which turns a commit-time failure into an ordinary function error
--    with a known code. The deferral still applies to everything else,
--    including the account cascade 0008 exists to protect.
--
-- 2. A foreign-key violation reads as `update or delete on table "recipes"
--    violates foreign key constraint ...`. That is the right thing to raise and
--    the wrong thing to show a baker.
--
-- WHY THE COUNT IN THE MESSAGE CANNOT LEAK (stage-6 requirement 6)
--
-- It comes from `recipes_using()`, which is SECURITY INVOKER and therefore
-- RLS-filtered: it can only ever count recipes the caller is already allowed to
-- see. So the number in the message is leak-proof by construction rather than
-- by relying on the owner-equality invariant that 0007's trigger maintains. The
-- names are not in the message at all — naming the dependents is the UI's job,
-- from the same RLS-filtered function.
--
-- Deleting a recipe that does not exist, or belongs to another account, stays a
-- silent no-op. RLS makes the DELETE match zero rows, and reporting "not found"
-- would answer a question about somebody else's data.
--
-- ONE SHARP EDGE, WORTH KNOWING ABOUT
--
-- `SET CONSTRAINTS ... IMMEDIATE` applies to the rest of the TRANSACTION, not
-- just to this function. So a transaction that calls delete_recipe() and then
-- deletes an account will find the account cascade blocked, because the guard
-- is no longer deferred. PostgREST gives each request its own transaction, so
-- nothing in the app can hit this — but a migration or a test script that does
-- both in one transaction must issue `set constraints all deferred` in
-- between. Found the hard way: it is why supabase/tests/sub-recipe-hardening.sql
-- re-defers before its cleanup.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_recipe(p_recipe_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_visible int;
begin
  select count(*) into v_visible from public.recipes_using(p_recipe_id);

  if v_visible > 0 then
    raise exception
      'המתכון הזה משמש כמתכון בסיס ב-%, ולכן אי אפשר למחוק אותו. יש להסיר קודם את הקישור מהמתכונים שמשתמשים בו.',
      case when v_visible = 1 then 'מתכון אחד' else v_visible || ' מתכונים' end
      using errcode = 'foreign_key_violation';
  end if;

  -- RLS applies: another account's id matches no row, exactly as before.
  delete from public.recipes where id = p_recipe_id;

  -- Run the deferred guard now, so any dependency the count above could not
  -- see still fails here rather than at commit.
  set constraints public.ingredients_sub_recipe_id_fkey immediate;
end;
$$;

-- Same posture as the 0007 functions: callable by a signed-in user, and doing
-- nothing a signed-in user could not already do.
revoke execute on function public.delete_recipe(uuid) from public, anon;
grant  execute on function public.delete_recipe(uuid) to authenticated;
