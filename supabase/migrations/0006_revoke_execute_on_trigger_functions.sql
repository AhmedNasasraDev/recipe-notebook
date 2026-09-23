-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 — take EXECUTE away from the trigger functions
--
-- Not planned. Supabase's security advisor flagged it right after 0001-0005
-- went in, and it was a fair catch:
--
--   "Function public.handle_new_user() can be executed by the anon role as a
--    SECURITY DEFINER function via /rest/v1/rpc/handle_new_user."
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. That is harmless for an
-- ordinary function and not harmless for a SECURITY DEFINER one, which runs as
-- its owner. Calling a trigger function directly errors out ("trigger functions
-- can only be called as triggers"), so there is no known exploit here — but
-- "there is no route in" is a much better property than "the route in happens
-- to fail", and it costs one migration.
--
-- Postgres invokes a trigger function as the table owner regardless of the
-- caller's EXECUTE privilege, so nothing that depends on these breaks.
--
-- After this, get_advisors(security) returns an empty list.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- owns_recipe IS called by name — from inside the RLS policies on the six child
-- tables — so signed-in users must keep EXECUTE on it. It is SECURITY INVOKER
-- and answers only "do I own this recipe", so it discloses nothing that the
-- recipes policy does not already allow.
revoke execute on function public.owns_recipe(uuid) from public, anon;
grant  execute on function public.owns_recipe(uuid) to authenticated;
