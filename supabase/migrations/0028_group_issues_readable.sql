-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 — a group recipe's troubleshooting list travels with it
--
-- WHAT THE TEST CAUGHT
--
-- `save_group_recipe_copy` copied a group recipe's ingredients and steps but
-- copied ZERO of its `issues`, silently. The copy step is a
-- `insert ... select`, so a source the caller cannot read produces no rows and
-- no error — the least helpful possible failure.
--
-- The cause was a classification mistake in 0023. That migration gave
-- `ingredients` and `steps` a group read policy and deliberately withheld one
-- from `trials`, `issues` and `batches`, with a comment about production
-- records belonging to whoever produced them. That reasoning is right for two
-- of those three and wrong for `issues`:
--
--   trials   §13  — a dated log of what was actually baked. A record.
--   batches  §13a — HACCP production records. A record, and the most serious
--                   one: copying it would fabricate food-safety documentation.
--   issues   §1.1 — `תקלה → פתרון`. Knowledge ABOUT the formula: what goes
--                   wrong and what to do. Not a record of anything.
--
-- The app had already drawn this line correctly and I contradicted it in SQL.
-- `apps/web/src/features/recipe/duplicate.ts` says, of duplicating a recipe:
-- "the `issues` list — the troubleshooting notes are knowledge about the
-- formula, not a record of a production run, so they travel with it." A
-- troubleshooting list is also, for a course, one of the most useful things
-- the instructor wrote.
--
-- So `issues` gets the same read policy `ingredients` and `steps` have, and
-- `trials` and `batches` still get none.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists issues_readable on public.issues;
create policy issues_readable on public.issues
  for select
  using (public.can_read_recipe(recipe_id));

/*
  `can_read_recipe` is SECURITY INVOKER (0023), so this grants nothing beyond
  what the caller can already see of the parent recipe: a group recipe whose
  item has `perm_view` false is unreadable, and so are its issues.
*/
