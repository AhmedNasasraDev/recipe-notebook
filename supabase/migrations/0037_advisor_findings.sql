-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 — the two advisor findings worth acting on, and a note on the rest
--
-- Supabase's own database linter was run after 0036. Three kinds of finding
-- came back, and only some of them are defects.
--
-- 1. `can_read_recipe` HAS A MUTABLE search_path — FIXED HERE.
--
--    It is the only function left in `public` without `set search_path = ''`.
--    Every reference in its body is already schema-qualified, so this changes
--    no behaviour; what it removes is the shape of the problem: a policy helper
--    whose `public.recipes` could be resolved against a caller-controlled
--    search_path if somebody later wrote an unqualified name into it.
--
-- 2. TWO FOREIGN KEYS WITHOUT A COVERING INDEX THAT REAL QUERIES USE — ADDED.
--
--    The linter lists seventeen. Most are audit columns — `created_by`,
--    `revoked_by`, `deleted_by`, `used_by` — that nothing filters on, and an
--    index there would cost every write and buy nothing.
--
--    These two are different, because code in this repository filters by them:
--      · `group_join_requests(user_id)` — `myJoinRequests()` reads the
--        caller's own requests across every group, with no group_id to lead an
--        index on.
--      · `group_message_reads(user_id)` — `group_unread_counts()` starts from
--        `user_id = auth.uid()`. The primary key is (group_id, user_id), which
--        a user-leading query cannot use.
--
--    Both also make deleting an account cheaper, since an unindexed foreign
--    key turns a parent delete into a scan of the child.
--
-- 3. "MULTIPLE PERMISSIVE POLICIES" — NOT ACTED ON, DELIBERATELY.
--
--    Fifty findings, all the same shape: a table with a `_read` policy FOR
--    SELECT and a `_write` policy FOR ALL has two permissive policies for
--    SELECT, and Postgres evaluates both. It is a real cost and it is a
--    performance WARN, not a correctness one.
--
--    Collapsing them means rewriting `FOR ALL` policies as separate
--    INSERT/UPDATE/DELETE policies across a dozen tables — the exact kind of
--    change that turns a `using` clause into a `with check` by accident. The
--    pattern predates §10 (`ingredients`, `steps`, `issues` have it too), the
--    tables are small, and the tests that would catch a mistake are the ones
--    that took the longest to write. It is recorded here as a known,
--    measured, accepted cost rather than quietly ignored.
--
-- 4. "UNUSED INDEX" on `group_invites_email_idx` — expected. No real
--    invitation has been created yet; the index exists for the lookup that
--    checks whether an address already has a pending invitation.
--
-- 5. LEAKED PASSWORD PROTECTION is disabled on the project. That is an Auth
--    SETTING rather than schema, it changes what a sign-up accepts, and it is
--    the owner's call — so it is reported to them rather than switched on from
--    a migration.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_read_recipe(p_recipe_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.recipes r where r.id = p_recipe_id);
$$;

comment on function public.can_read_recipe(uuid) is
  'Can the caller read this recipe? SECURITY INVOKER on purpose: it asks '
  '`recipes` under the caller''s own RLS, so it answers "may I see it" and '
  'never widens anything. search_path pinned in 0037.';

create index if not exists group_join_requests_user_idx
  on public.group_join_requests (user_id, created_at desc);

create index if not exists group_message_reads_user_idx
  on public.group_message_reads (user_id);
