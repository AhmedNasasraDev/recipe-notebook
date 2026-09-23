-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 — least privilege on the table grants (stage-10 audit)
--
-- WHAT THE AUDIT FOUND
--
-- Every table in `public` granted the full set — SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER — to BOTH `anon` and `authenticated`.
-- That is Supabase's default (`grant all on all tables in schema public to
-- anon, authenticated` runs when a project is created), and RLS is what has
-- been doing the real work all along: every policy on every table requires
-- `auth.uid()`, so an anonymous caller matches no row and a signed-in caller
-- matches only their own.
--
-- Two of those privileges are not covered by that reasoning:
--
--   · TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY. A policy cannot filter a
--     TRUNCATE; the privilege alone decides. So `anon` held a privilege that,
--     if it were ever reachable, empties a table outright — no WHERE clause, no
--     policy check, nothing to fall back on.
--   · REFERENCES and TRIGGER are DDL-adjacent and no client needs either.
--
-- HOW REACHABLE WAS IT, honestly: PostgREST speaks SELECT/INSERT/UPDATE/DELETE
-- and RPC, and issues no TRUNCATE; the `anon` and `authenticated` roles are
-- NOLOGIN, so they cannot be connected to directly; and no function in this
-- schema contains a TRUNCATE. I found no path from the published key to a
-- TRUNCATE. It is removed because a privilege that bypasses RLS should not be
-- held by an untrusted role whether or not today's API surface exposes it —
-- defence in depth is the whole argument for keeping it narrow.
--
-- WHAT ELSE CHANGES, AND WHAT DELIBERATELY DOES NOT
--
-- `anon` loses INSERT, UPDATE and DELETE as well. No policy admits them, so
-- nothing that works today stops working — the refusal simply moves one layer
-- out, from "RLS matched no row" to "no privilege". `anon` KEEPS SELECT: the
-- documented, tested behaviour of an unauthenticated read is an EMPTY RESULT
-- (see supabase/tests/rls-isolation.sql), and turning that into a 403 would
-- change the app's error surface for no security gain — the rows are already
-- unreachable.
--
-- `authenticated` keeps SELECT, INSERT, UPDATE and DELETE, which is exactly
-- what the app performs, and keeps being filtered to its own rows by RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- Postgres has no "revoke on all tables except" — it is per privilege.
revoke truncate, references, trigger on all tables in schema public
  from anon, authenticated;

revoke insert, update, delete on all tables in schema public from anon;

-- The default privileges Supabase installs would hand the same set to the next
-- table created in this schema, so the default itself is narrowed too.
-- Otherwise migration 0021 would quietly re-open what this one closed.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;
