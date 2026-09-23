-- ─────────────────────────────────────────────────────────────────────────────
-- 0026 — the group policies get THREE helpers, and each answers only about me
--
-- WHAT FORCED THIS, AND THE MEASUREMENT BEHIND IT
--
-- `npm run schema:check` refused 0023: five SECURITY DEFINER functions were
-- directly callable by `authenticated`. The rule it enforces (written in an
-- earlier stage) is that a definer function runs as its owner, so it must only
-- be reachable through the trigger or function that owns the decision.
--
-- My first instinct was that the check was too strict here, because a policy
-- needs its helper. So I tested it: revoked EXECUTE from `authenticated` on all
-- five and ran the group flow again. It broke immediately —
--
--   create_group → insert into group_members → `members_bootstrap` policy
--   → `exists (select 1 from groups ...)` → `groups_read` → is_group_member()
--   → permission denied for function is_group_member
--
-- So the grant is NOT optional: a policy expression is evaluated with the
-- querying role's privileges, and a function it calls must be executable by
-- that role. The check and the requirement are both right, which means the
-- answer is not to pick one — it is to make the exposed surface small enough
-- that the grant costs nothing.
--
-- WHAT WAS ACTUALLY WRONG WITH THE OLD SURFACE
--
-- Two of the five shapes were fine and three were not:
--
--   is_group_member(group_id) → boolean   a fact about ME. Safe.
--   group_rank(group_id) → integer        a fact about ME. Safe.
--   course_group(course_id) → uuid        NOT a fact about me. It maps
--   lesson_group(lesson_id) → uuid        somebody else's row id to the group
--   item_group(item_id) → uuid            that owns it, and it was granted to
--                                         every signed-in account. Nothing in
--                                         it names a person or a recipe, but a
--                                         caller could enumerate ids and learn
--                                         which group each belongs to, which is
--                                         information about groups they are not
--                                         in.
--
-- So the three id-mapping functions are GONE, and the membership question is
-- asked directly about the parent that the row carries:
--
--   group_rank(group_id)    the caller's rank in this group
--   course_rank(course_id)  the caller's rank in the group that owns the course
--   lesson_rank(lesson_id)  the caller's rank in the group that owns the lesson
--
-- Every one returns an integer about `auth.uid()` and takes no user parameter,
-- so none of them can be asked about anyone else, and none returns an id.
-- `is_group_member` goes too: "rank >= 1" says the same thing with one concept
-- instead of two, and two concepts drift.
--
-- Each policy still reaches its parent through a column the ROW CARRIES, which
-- is 0024's rule and the reason INSERT ... RETURNING works.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the three helpers ────────────────────────────────────────────────────────

/**
 * The caller's rank in this group — §10.1: owner 3, instructor 2, member 1,
 * non-member 0.
 *
 * SECURITY DEFINER for the reason 0023 documents: a policy on `group_members`
 * that read `group_members` in a subquery would recurse. The owner branch is
 * there so an owner is never locked out of their own group by a missing
 * membership row.
 */
create or replace function public.group_rank(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce(
      (
        select case m.role
                 when 'owner' then 3
                 when 'instructor' then 2
                 when 'member' then 1
                 else 0
               end
        from public.group_members m
        where m.group_id = p_group_id
          and m.user_id = (select auth.uid())
      ),
      0
    ),
    case
      when exists (
        select 1 from public.groups g
        where g.id = p_group_id and g.owner_id = (select auth.uid())
      ) then 3
      else 0
    end
  );
$$;

comment on function public.group_rank(uuid) is
  'The CALLER''s rank in this group: owner 3, instructor 2, member 1, '
  'non-member 0. Takes no user parameter, so it cannot be asked about anybody '
  'else. Granted to `authenticated` because RLS policies call it — see 0026.';

/** The caller's rank in the group that owns this course. */
create or replace function public.course_rank(p_course_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.group_rank(c.group_id)
      from public.courses c
      where c.id = p_course_id
    ),
    0
  );
$$;

comment on function public.course_rank(uuid) is
  'The CALLER''s rank in the group that owns this course. Returns a rank, '
  'never the group id — see 0026.';

/** The caller's rank in the group that owns this lesson. */
create or replace function public.lesson_rank(p_lesson_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.group_rank(c.group_id)
      from public.lessons l
      join public.courses c on c.id = l.course_id
      where l.id = p_lesson_id
    ),
    0
  );
$$;

comment on function public.lesson_rank(uuid) is
  'The CALLER''s rank in the group that owns this lesson. Returns a rank, '
  'never the group id — see 0026.';

-- ── every policy, rewritten onto the three ───────────────────────────────────

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (public.group_rank(id) >= 1);

drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for update
  using (public.group_rank(id) = 3)
  with check (public.group_rank(id) = 3);

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete using (public.group_rank(id) = 3);

drop policy if exists members_read on public.group_members;
create policy members_read on public.group_members
  for select using (public.group_rank(group_id) >= 1);

drop policy if exists members_role on public.group_members;
create policy members_role on public.group_members
  for update
  using (public.group_rank(group_id) = 3)
  with check (public.group_rank(group_id) = 3);

drop policy if exists members_remove on public.group_members;
create policy members_remove on public.group_members
  for delete
  using (public.group_rank(group_id) = 3 or user_id = (select auth.uid()));

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses
  for select using (public.group_rank(group_id) >= 1);

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses
  for all
  using (public.group_rank(group_id) >= 2)
  with check (public.group_rank(group_id) >= 2);

-- Through `course_id`, which the row carries — 0024's rule.
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons
  for select using (public.course_rank(course_id) >= 1);

drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons
  for all
  using (public.course_rank(course_id) >= 2)
  with check (public.course_rank(course_id) >= 2);

-- Through `lesson_id`, likewise. `perm_view` stays in the row filter so a
-- recipe the instructor has not released never reaches the browser (§10.4),
-- and an instructor keeps seeing the item whatever the flag says — otherwise
-- turning `view` off would hide it from the person who turned it off.
drop policy if exists items_read on public.group_recipe_items;
create policy items_read on public.group_recipe_items
  for select
  using (
    (perm_view and public.lesson_rank(lesson_id) >= 1)
    or public.lesson_rank(lesson_id) >= 2
  );

drop policy if exists items_write on public.group_recipe_items;
create policy items_write on public.group_recipe_items
  for all
  using (public.lesson_rank(lesson_id) >= 2)
  with check (public.lesson_rank(lesson_id) >= 2);

-- `group_id is not null` is the predicate that keeps a student's own notebook
-- out of reach (§12.3). It is not an optimisation; it is the rule.
drop policy if exists recipes_group_read on public.recipes;
create policy recipes_group_read on public.recipes
  for select
  using (
    group_id is not null
    and public.group_rank(group_id) >= 1
    and exists (
      select 1 from public.group_recipe_items i where i.recipe_id = recipes.id
    )
  );

-- ── the three id-mapping functions are withdrawn ─────────────────────────────
-- Nothing references them any more. `is_group_member` goes with them: "rank
-- >= 1" is the same question, and one concept cannot disagree with itself.
drop function if exists public.item_group(uuid);
drop function if exists public.lesson_group(uuid);
drop function if exists public.course_group(uuid);
drop function if exists public.is_group_member(uuid);

-- ── grants ───────────────────────────────────────────────────────────────────
-- `authenticated` MUST have EXECUTE on all three: a policy expression is
-- evaluated with the querying role's privileges. Measured — see the header.
-- `anon` never gets it; every policy needs auth.uid() anyway.
revoke all on function public.group_rank(uuid) from public, anon;
revoke all on function public.course_rank(uuid) from public, anon;
revoke all on function public.lesson_rank(uuid) from public, anon;
grant execute on function public.group_rank(uuid) to authenticated;
grant execute on function public.course_rank(uuid) to authenticated;
grant execute on function public.lesson_rank(uuid) to authenticated;
