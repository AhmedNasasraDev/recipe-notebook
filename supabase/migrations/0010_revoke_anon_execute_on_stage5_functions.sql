-- ─────────────────────────────────────────────────────────────────────────────
-- 0010 — take EXECUTE away from `anon` on the stage-5 functions
--
-- Found while snapshotting the function signatures for `schema:check`, not by a
-- failing test. `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, and
-- Supabase additionally grants it to `anon` through the schema's default
-- privileges. Migration 0006 established the rule for exactly this reason — and
-- then 0007 (stage 5) added six functions without following it. So
-- /rest/v1/rpc/save_recipe, /rpc/restore_recipe_version, /rpc/recipe_snapshot,
-- /rpc/next_version_tag, /rpc/recipes_using and /rpc/replace_recipe_children
-- were all callable without signing in.
--
-- IS IT EXPLOITABLE? No, and this was checked rather than assumed. Every one of
-- the six was called as `anon` against the live database and every one was
-- refused with 42501. They are all SECURITY INVOKER, so an anonymous caller
-- gets anonymous privileges: the writes fail the RLS WITH CHECK (`owner_id =
-- auth.uid()` is never true when `auth.uid()` is null), and the reads bottom out
-- in the child tables' policies, which call `owns_recipe` — and 0006 already
-- took THAT away from anon.
--
-- So this changes no outcome. It is still worth a migration, in 0006's own
-- words: "there is no route in" is a much better property than "the route in
-- happens to fail". Six POST endpoints that answer an unauthenticated caller at
-- all are six places where a future change to a policy, a grant or a function
-- body turns a refusal into a hole.
--
-- `delete_recipe` (0009) was written with the revoke in place and is not
-- repeated here.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.save_recipe(jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, text)
  from public, anon;
grant  execute on function public.save_recipe(jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, text)
  to authenticated;

revoke execute on function public.restore_recipe_version(uuid)  from public, anon;
grant  execute on function public.restore_recipe_version(uuid)   to authenticated;

revoke execute on function public.recipes_using(uuid)           from public, anon;
grant  execute on function public.recipes_using(uuid)            to authenticated;

revoke execute on function public.recipe_snapshot(uuid)         from public, anon;
grant  execute on function public.recipe_snapshot(uuid)          to authenticated;

revoke execute on function public.next_version_tag(uuid)        from public, anon;
grant  execute on function public.next_version_tag(uuid)         to authenticated;

-- An internal helper of save_recipe and restore_recipe_version. Nothing calls
-- it from the client, so it does not need `authenticated` either — but it is
-- SECURITY INVOKER and called from SECURITY INVOKER functions, so the signed-in
-- caller must keep EXECUTE for those to work.
revoke execute on function public.replace_recipe_children(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant  execute on function public.replace_recipe_children(uuid, jsonb, jsonb, jsonb)
  to authenticated;
