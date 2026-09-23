-- ─────────────────────────────────────────────────────────────────────────────
-- 0034 — take DELETE off `group_messages`, which nobody granted
--
-- WHAT WAS FOUND
--
-- 0032 granted `insert, update` on `group_messages` and deliberately not
-- DELETE, because removal is a SOFT delete. The grants say otherwise:
--
--   group_messages | authenticated | DELETE,INSERT,SELECT,UPDATE
--
-- DELETE arrived from Supabase's default privileges for new tables in
-- `public`. Migration 0020 narrowed those defaults for `anon` and deliberately
-- kept INSERT/UPDATE/DELETE for `authenticated`, which is right for `recipes`
-- and wrong here.
--
-- IS IT REACHABLE TODAY? No. There is no DELETE policy on the table, so RLS
-- matches zero rows — measured, in the chat suite: the delete returns
-- `rows: 0` rather than an error. (That measurement is also why the assertion
-- has to be the row count: a DELETE that matches nothing raises nothing, and a
-- test that treated "no exception" as "deleted" would report a hole that is
-- not there. Mine did, on the first run.)
--
-- WHY REVOKE IT ANYWAY
--
-- Because the protection is currently "no policy exists", and that is one
-- careless `create policy ... for delete` away from disappearing — added for
-- some unrelated reason, by someone who does not know that `reply_to_id`
-- depends on messages never being hard-deleted. With the privilege gone, such
-- a policy would still refuse, and the reason would be in the schema instead
-- of in an absence.
--
-- This is 0020's own argument, applied to a table 0020 could not know about.
-- ─────────────────────────────────────────────────────────────────────────────

revoke delete on public.group_messages from authenticated, anon;

/*
  `group_message_reads` KEEPS delete: a read marker is a per-user convenience
  row and removing your own is harmless. `recipe_images`, `group_invites` and
  `group_join_requests` keep it too — each has a real DELETE path in the app,
  bounded by its own policy.
*/
