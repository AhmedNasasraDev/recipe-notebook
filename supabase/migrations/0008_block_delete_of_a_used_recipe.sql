-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 — a recipe that is in use as a sub-recipe cannot be deleted
--
-- Stage-6 product decision, in the user's words: "אין למחוק מתכון שמשמש כרגע
-- כתת-מתכון של מתכון אחר", with two constraints attached — do not snapshot the
-- base recipe and do not create a second source of truth, and enforce it at the
-- database level rather than in the UI.
--
-- This replaces the behaviour stage 5 had to live with. Until now
-- `ingredients.sub_recipe_id` was ON DELETE SET NULL: deleting a base recipe
-- silently turned every line that used it into an ingredient with no weight and
-- no cost, and made older versions of the dependent recipes unrestorable. The
-- delete confirmation warned about it, which is the best a UI can do and not
-- good enough — a warning is not an invariant.
--
-- WHY THE CONSTRAINT IS `NO ACTION DEFERRABLE INITIALLY DEFERRED`
--
-- This was settled by probing the live database, not by reading the manual,
-- and the first two answers were wrong:
--
--   ON DELETE RESTRICT     blocks the single delete, and ALSO blocks deleting
--                          the account. `recipes.owner_id` cascades from
--                          `auth.users`, so removing a user deletes their
--                          recipes; RESTRICT is checked row by row and fires on
--                          the base recipe even though the referencing row is
--                          about to disappear in the same statement. A user who
--                          had ever linked a sub-recipe could not be deleted.
--   ON DELETE NO ACTION    same outcome. Verified, not assumed: NO ACTION is
--   (not deferrable)       checked at the end of the *triggering statement*,
--                          and the cascade into `ingredients` happens inside a
--                          nested statement, so the referencing row is still
--                          there when the check runs. Probe result: the account
--                          delete failed with 23503.
--   NO ACTION DEFERRABLE   correct. The check moves to the end of the
--   INITIALLY DEFERRED     transaction, by which time a cascade has removed
--                          every referencing row. Probe result: the plain
--                          delete of a referenced base is blocked with 23503,
--                          and the account delete succeeds leaving 0 recipes.
--
-- So the deferral is not a loosening. It is what separates "delete this one
-- recipe" (refused) from "this account is going away" (allowed), which is the
-- distinction the product decision actually needs.
--
-- WHY THERE IS NO NEW RPC, AND NO NEW COLUMN
--
-- The foreign key IS the enforcement. It applies to `DELETE /recipes?id=eq.x`
-- straight off the anon key, to a call from the repository, and to a call from
-- inside any of the 0007 functions — there is no path around it, which is what
-- requirement 5 asks for. A function would only add a nicer message, and a
-- nicer message is the UI's job.
--
-- WHY THIS CANNOT BECOME AN ORACLE ABOUT ANOTHER ACCOUNT (requirement 6)
--
-- A foreign key is enforced by the system and is NOT subject to RLS, so in
-- principle "your delete was refused" could mean "a recipe you cannot see
-- refers to this one". It cannot, because of an invariant, not because of a
-- policy: `check_sub_recipe_link` (0007) refuses any link whose parent and sub
-- have different owners. Every possible blocker is therefore a recipe of the
-- same account, and `recipes_using()` — SECURITY INVOKER, so RLS-filtered —
-- shows the user every one of them. The migration ASSERTS the invariant below
-- rather than trusting it: if a cross-owner link had survived from before
-- 0007, this migration fails loudly instead of quietly installing a leak.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the invariant requirement 6 rests on ────────────────────────────────────
do $$
declare
  n int;
begin
  select count(*) into n
    from public.ingredients i
    join public.recipes parent on parent.id = i.recipe_id
    join public.recipes sub    on sub.id    = i.sub_recipe_id
   where i.sub_recipe_id is not null
     and parent.owner_id is distinct from sub.owner_id;

  if n > 0 then
    raise exception
      'refusing to install the delete guard: % cross-account sub-recipe link(s) exist, so a refused delete could disclose another account''s recipe. Clean these up first.', n;
  end if;
end $$;

-- ── the guard ───────────────────────────────────────────────────────────────
alter table public.ingredients
  drop constraint if exists ingredients_sub_recipe_id_fkey;

alter table public.ingredients
  add constraint ingredients_sub_recipe_id_fkey
  foreign key (sub_recipe_id) references public.recipes (id)
  on delete no action
  deferrable initially deferred;

comment on constraint ingredients_sub_recipe_id_fkey on public.ingredients is
  'Stage 6: a recipe in use as a sub-recipe cannot be deleted. DEFERRABLE INITIALLY DEFERRED so that deleting an account still cascades — see migration 0008.';
