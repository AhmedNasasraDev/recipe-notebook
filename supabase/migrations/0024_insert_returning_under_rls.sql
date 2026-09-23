-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 — making INSERT work under the group policies
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE RULE, WHICH APPLIES TO EVERY RLS POLICY IN THIS SCHEMA FROM NOW ON
-- ══════════════════════════════════════════════════════════════════════════
--
--   A SELECT policy must reach whatever it depends on through a column the
--   ROW ITSELF CARRIES — never by looking the row up by its own id.
--
-- WHY, AND HOW IT WAS FOUND
--
-- `supabase/tests/groups.sql` refused to run. Its first call to `create_group`
-- failed with `42501 new row violates row-level security policy for table
-- "groups"`, while a bare `insert into groups` by the same account in the same
-- transaction succeeded. The only difference between the two statements was
-- `RETURNING`.
--
-- Postgres applies the SELECT policy to a RETURNING clause — you are reading
-- the row back, so you must be allowed to read it. And the policy's helper
-- functions are declared STABLE, which means they execute against the
-- SNAPSHOT OF THE STATEMENT THAT CALLED THEM. The row being inserted by that
-- very statement is not in that snapshot. So:
--
--   `groups_read` asks `is_group_member(id)`  → the group row is invisible,
--                                               the membership row does not
--                                               exist yet → false.
--   `lessons_read` asks `is_group_member(lesson_group(id))`
--                                             → `lesson_group` looks the
--                                               lesson up by its own id, finds
--                                               nothing, returns NULL →
--                                               `is_group_member(NULL)` →
--                                               false.
--
-- while `courses_read` asks `is_group_member(group_id)` — a column of the new
-- row, no lookup — and works. Measured, all four, before writing this:
--
--   groups   plain insert ok · insert returning 42501
--   courses  plain insert ok · insert returning ok
--   lessons  plain insert ok · insert returning 42501
--
-- THIS IS NOT AN ACADEMIC CASE. PostgREST returns the created row by default
-- (`Prefer: return=representation`), so every insert the app makes is an
-- INSERT ... RETURNING. A policy written the other way does not fail in a test
-- and pass in production; it fails in production and passes in a test that
-- inserts as `postgres`.
--
-- Note also what is NOT the fix: 0023's owner branch on `is_group_member`
-- reads `groups.owner_id`, and cannot help, because that row is exactly the
-- one the snapshot cannot see. It is kept for the different reason documented
-- there (an owner must never be locked out of their own group).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── lessons: reach the group through `course_id`, which the row carries ──────
-- The course already exists whenever a lesson is written, so this resolves for
-- a row being inserted as readily as for one already there.
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons
  for select
  using (public.is_group_member(public.course_group(course_id)));

drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons
  for all
  using (public.group_rank(public.course_group(course_id)) >= 2)
  with check (public.group_rank(public.course_group(course_id)) >= 2);

/*
  `group_recipe_items` already follows the rule — `items_read` and
  `items_write` reach the group through `lesson_id` — so they are left alone.
  They are covered by the re-run of supabase/tests/groups.sql, which now
  inserts an item through PostgREST-shaped SQL rather than as the table owner.
*/

/*
  ── groups: there is no parent column to reach through ─────────────────────

  A group is the root of the tree. Its readability depends on a membership row
  that cannot exist before the group does, so no policy can make
  `insert into groups ... returning id` work — the fix has to be to stop
  needing RETURNING.

  `gen_random_uuid()` is called first and the id is passed IN. Nothing is read
  back, so no SELECT policy is consulted, and the function still returns the id
  to its caller. `pgcrypto`'s generator is the same one the column default
  uses, so this changes nothing about the ids themselves.
*/
create or replace function public.create_group(
  p_name text,
  p_kind text default '',
  p_note text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if pg_catalog.btrim(coalesce(p_name, '')) = '' then
    raise exception 'a group needs a name' using errcode = '22023';
  end if;

  -- No RETURNING. See the block comment above.
  insert into public.groups (id, name, kind, note, owner_id)
  values (v_id, pg_catalog.btrim(p_name), coalesce(p_kind, ''),
          coalesce(p_note, ''), v_uid);

  insert into public.group_members (group_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

comment on function public.create_group(text, text, text) is
  'Creates a group and its owner membership in one transaction, without '
  'INSERT ... RETURNING (see migration 0024). SECURITY INVOKER: adds '
  'atomicity, not authority.';

revoke all on function public.create_group(text, text, text) from public, anon;
grant execute on function public.create_group(text, text, text) to authenticated;
