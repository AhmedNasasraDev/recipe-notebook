-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 — groups, courses, lessons and group recipe items
--
-- HANDOFF §7 step 5. Spec §10: `Group → Course → Lesson → GroupRecipeItem`.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE RULE THIS MIGRATION EXISTS TO MAKE UNBREAKABLE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Spec §12.3 and HANDOFF §8: an instructor or a group owner must NEVER be able
-- to read a student's personal notebook — not the recipes, not the private
-- notes, not the calibrations, not the trials — and no policy, view, RPC or
-- report may provide it. That is a product requirement, not optional
-- hardening.
--
-- Everything below is shaped by it. In particular the group branch added to
-- `recipes` keeps `group_id is not null` in its condition, because a student's
-- own recipe has `group_id is null` and that single predicate is what keeps the
-- two worlds apart. 0002 left the comment saying so; this migration is the
-- "later" it referred to.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY MEMBERSHIP IS ANSWERED BY A SECURITY DEFINER FUNCTION
-- ══════════════════════════════════════════════════════════════════════════
--
-- Almost every policy here needs "is the caller a member of this group". Write
-- that as a subquery on `group_members` and the policy ON `group_members`
-- becomes self-referential: Postgres evaluates the policy to answer the
-- subquery that the policy is made of, and raises
-- `infinite recursion detected in policy for relation "group_members"`.
--
-- The standard way out is a SECURITY DEFINER function, which reads the table
-- with RLS bypassed. That is a real grant of authority, so it is kept as narrow
-- as it can possibly be:
--
--   · Both functions take a group id and answer ONLY about `auth.uid()`. There
--     is no parameter for "which user", so neither can be turned into a way to
--     ask about somebody else.
--   · They return a boolean and a role name. Not a row, not a set, nothing
--     that could carry another member's data out.
--   · `search_path = ''` and every reference schema-qualified, so a function
--     running as the owner cannot be redirected to an attacker's table.
--
-- A member list is NOT read through them. `group_members` has its own SELECT
-- policy built on `is_group_member()`, so the recursion is broken at the one
-- place it occurs and the visible data still goes through RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── groups ───────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  /* §2 screen 15: a group is a course cohort, a team or a class. Free text
     rather than an enum: the spec names no fixed list, and an enum that has to
     be migrated to add "סדנה" would be a worse guess than a label. */
  kind        text not null default '',
  /*
    PRIVATE BY DEFAULT — §10.2. The column exists because the spec names it,
    and it is CHECKed to 'private' only, because nothing in this migration
    implements a public group: no policy admits a non-member, and there is no
    discovery path. A column that could hold 'public' while every policy
    ignored it would be a false promise in the schema. Widening it is a
    deliberate future migration, with the policies it needs.
  */
  privacy     text not null default 'private' check (privacy = 'private'),
  /*
    The join code. NOT a credential: §6 — "קוד קבוצה אינו מעניק חברות — הוא
    יוצר בקשה שדורשת אישור". Nullable, because a group that does not accept a
    code should not be forced to carry one that works.
  */
  code        text unique,
  /* Which of §10.2's four ways in this group accepts. */
  join_by     text[] not null default array['invite','link','code','request']::text[],
  owner_id    uuid not null references auth.users (id) on delete cascade,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists groups_owner_idx on public.groups (owner_id);

-- ── members ──────────────────────────────────────────────────────────────────
/*
  §10.1: owner 3, instructor 2, member 1. The rank is what a permission check
  compares, and it lives in the database rather than in the client so that a
  server-side check and the UI cannot disagree about what an instructor is.
*/
create table if not exists public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member'
               check (role in ('owner', 'instructor', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

-- ── courses → lessons → items ────────────────────────────────────────────────
create table if not exists public.courses (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups (id) on delete cascade,
  name      text not null,
  ord       integer not null default 0
);

create index if not exists courses_group_idx on public.courses (group_id, ord);

create table if not exists public.lessons (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  name       text not null,
  /* A lesson date is a calendar date, not an instant: "the lesson on 18.9" is
     the same lesson in every timezone. */
  date       date,
  summary    text not null default '',
  done       boolean not null default false,
  ord        integer not null default 0
);

create index if not exists lessons_course_idx on public.lessons (course_id, ord);

/*
  §10.4 — the five per-recipe permissions, and their defaults are the SPEC'S
  defaults: view true, everything else false. "ברירת המחדל היא המגבילה ביותר".

  They are five booleans rather than one jsonb because a default belongs in the
  column: a jsonb `perms` that arrives without a key would have to be
  interpreted by every reader, and the first reader to interpret a missing
  `perm_save` as "true" would hand out a recipe the instructor never released.
*/
create table if not exists public.group_recipe_items (
  id              uuid primary key default gen_random_uuid(),
  lesson_id       uuid not null references public.lessons (id) on delete cascade,
  /*
    The group's copy of the recipe. ON DELETE CASCADE: if the group recipe is
    deleted the item has nothing to point at. Note this is a GROUP-OWNED
    recipe (`recipes.group_id` set), never a student's own.
  */
  recipe_id       uuid not null references public.recipes (id) on delete cascade,
  /* What the lesson calls it, if that differs from the recipe's own name. */
  name            text not null default '',
  ord             integer not null default 0,
  perm_view       boolean not null default true,
  perm_save       boolean not null default false,
  perm_print      boolean not null default false,
  perm_download   boolean not null default false,
  perm_share_out  boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists group_items_lesson_idx
  on public.group_recipe_items (lesson_id, ord);
create index if not exists group_items_recipe_idx
  on public.group_recipe_items (recipe_id);

-- `recipes.saved_from_item_id` has been a bare nullable uuid since 0002. Now
-- that the table it refers to exists, it becomes a real reference. ON DELETE
-- SET NULL: a student's personal copy must SURVIVE the group item being
-- removed — it is their recipe, in their notebook, and §11 says the group can
-- never change it. Losing it because a course was tidied up would be the worst
-- possible reading of "עותק אישי".
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'recipes_saved_from_item_fk'
  ) then
    alter table public.recipes
      add constraint recipes_saved_from_item_fk
      foreign key (saved_from_item_id)
      references public.group_recipe_items (id) on delete set null;
  end if;
end $$;

-- Same for `recipes.group_id`: group recipes belong to the group, and deleting
-- the group deletes them. A student's own recipe has group_id null and is
-- untouched by this.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'recipes_group_fk'
  ) then
    alter table public.recipes
      add constraint recipes_group_fk
      foreign key (group_id) references public.groups (id) on delete cascade;
  end if;
end $$;

drop trigger if exists groups_touch on public.groups;
create trigger groups_touch
  before update on public.groups
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- The two membership functions. See the header for why they are the shape they
-- are: a group id in, a fact about auth.uid() out, and nothing else.
-- ─────────────────────────────────────────────────────────────────────────────

/*
  ── WHY THE OWNER IS CHECKED HERE AND NOT ONLY IN `group_members` ──────────

  So that an owner can never be locked out of their own group. If the
  membership row is missing for any reason — a partial write, a manual delete,
  a future bug — the owner would otherwise own a group they cannot SELECT
  (`groups_read` requires membership), cannot update and cannot delete: an
  invisible, unfixable group.

  It grants nothing new. `groups.owner_id = auth.uid()` is the caller's own
  row, and the function still answers only about `auth.uid()`.

  WHAT THIS DOES *NOT* FIX, because I first thought it did:

  It does not make `insert into groups ... returning id` work. That case is
  explained in 0024 — the short version is that this function is STABLE, so it
  runs against the statement's snapshot, and the row being inserted by that
  very statement is not in it. Measured, not reasoned about: after the
  statement, `is_group_member` returns true and `group_rank` returns 3; during
  it, both are false. 0024 is what actually fixes the insert path.
*/
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
  ) or exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.owner_id = (select auth.uid())
  );
$$;

comment on function public.is_group_member(uuid) is
  'Is the CALLER a member of this group? SECURITY DEFINER to break RLS '
  'recursion on group_members. Takes no user parameter by design: it cannot '
  'be asked about anybody else.';

/**
 * The caller's rank in this group — §10.1's 3 / 2 / 1, and 0 for a non-member.
 *
 * A number rather than the role name so a check reads `>= 2` and cannot get
 * the ordering wrong, and so adding a role between two existing ones does not
 * require finding every `in ('owner','instructor')` in the schema.
 */
create or replace function public.group_rank(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    -- the rank the membership row gives
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
    -- and the rank owning the group row gives, for the reason documented on
    -- `is_group_member` above: an owner is never locked out of their own group
    -- by a missing membership row.
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
  'The CALLER''s §10.1 rank in this group: owner 3, instructor 2, member 1, '
  'non-member 0. SECURITY DEFINER for the same reason as is_group_member, and '
  'likewise answers only about auth.uid().';

-- Everything below reaches a group through its parent, so these two save every
-- policy from repeating a join and getting it subtly different.
create or replace function public.course_group(p_course_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.group_id from public.courses c where c.id = p_course_id;
$$;

create or replace function public.lesson_group(p_lesson_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.group_id
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where l.id = p_lesson_id;
$$;

create or replace function public.item_group(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.group_id
  from public.group_recipe_items i
  join public.lessons l on l.id = i.lesson_id
  join public.courses c on c.id = l.course_id
  where i.id = p_item_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — HANDOFF §3, with the write side spelled out (the handoff lists reads).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.courses            enable row level security;
alter table public.lessons            enable row level security;
alter table public.group_recipe_items enable row level security;

-- groups: SELECT where the caller is a member. No public browsing (§10.2).
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select
  using (public.is_group_member(id));

-- Anyone signed in may create a group, and becomes its owner. The `with check`
-- forces owner_id to be the caller: a group cannot be created in someone
-- else's name.
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups
  for insert
  with check (owner_id = (select auth.uid()));

-- Editing and deleting a group is the owner's alone (§10.1: `manage`).
drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for update
  using (public.group_rank(id) = 3)
  with check (public.group_rank(id) = 3);

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete
  using (public.group_rank(id) = 3);

/*
  group_members: a member sees the roster of their own groups. This is the one
  place group membership is visible, and it is deliberate — a student in a
  course can see who is teaching it. It exposes user IDs and nothing else: no
  recipe, no note, no email. §12.2 ("a student does not see other students'
  notebooks") is about notebooks, and nothing here reaches one.
*/
drop policy if exists members_read on public.group_members;
create policy members_read on public.group_members
  for select
  using (public.is_group_member(group_id));

/*
  The first row: whoever created the group makes themselves its owner. Narrow
  on purpose — `user_id` must be the caller AND the role must be 'owner' AND
  the caller must already own the group row. So this cannot be used to add
  anybody, nor to promote oneself in a group one merely belongs to.

  Every OTHER way in — invitation, link, code, approval — goes through the
  server-side functions in the next migration, not through this policy.
*/
drop policy if exists members_bootstrap on public.group_members;
create policy members_bootstrap on public.group_members
  for insert
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (
      select 1 from public.groups g
      where g.id = group_id and g.owner_id = (select auth.uid())
    )
  );

-- Changing someone's role: owner only (§10.1 gives `perms` to owner and
-- instructor, but promoting a person is `manage`, which is the owner's).
drop policy if exists members_role on public.group_members;
create policy members_role on public.group_members
  for update
  using (public.group_rank(group_id) = 3)
  with check (public.group_rank(group_id) = 3);

/*
  Removal. Two cases, and the second matters: a member can always remove
  THEMSELVES. A private group nobody can leave is a trap, and §12.4 —
  "שיתוף קורה רק ביוזמת המשתמש" — cuts both ways.
*/
drop policy if exists members_remove on public.group_members;
create policy members_remove on public.group_members
  for delete
  using (
    public.group_rank(group_id) = 3
    or user_id = (select auth.uid())
  );

-- courses and lessons: members read; instructors and owners write.
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses
  for select
  using (public.is_group_member(group_id));

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses
  for all
  using (public.group_rank(group_id) >= 2)
  with check (public.group_rank(group_id) >= 2);

drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons
  for select
  using (public.is_group_member(public.lesson_group(id)));

/*
  Note the two different lookups, which is not an inconsistency.

  `using` filters rows that EXIST, so the lesson's own id resolves. `with
  check` validates a row being written — and on INSERT that row is not in
  `lessons` yet, so `lesson_group(id)` would return null and the check would
  fail every insert. The group of the row being written is reached through its
  `course_id`, which the row does carry. The first draft of this policy had
  `lesson_group(course_id)`: a lesson-id function handed a course id, which
  returns null and refuses every write.
*/
drop policy if exists lessons_write on public.lessons;
create policy lessons_write on public.lessons
  for all
  using (public.group_rank(public.lesson_group(id)) >= 2)
  with check (public.group_rank(public.course_group(course_id)) >= 2);

/*
  group_recipe_items — §3: "SELECT WHERE user is member AND perm_view".

  `perm_view` is enforced HERE, in the row filter, not in the app. §10.4 says
  "בלי צפייה המתכון לא מופיע לתלמיד כלל", and a client-side filter would mean
  the row still travelled to the browser. An instructor keeps seeing the item
  whatever the flag says — otherwise turning `view` off would hide the item
  from the person who turned it off, with no way back.
*/
drop policy if exists items_read on public.group_recipe_items;
create policy items_read on public.group_recipe_items
  for select
  using (
    (perm_view and public.is_group_member(public.lesson_group(lesson_id)))
    or public.group_rank(public.lesson_group(lesson_id)) >= 2
  );

drop policy if exists items_write on public.group_recipe_items;
create policy items_write on public.group_recipe_items
  for all
  using (public.group_rank(public.lesson_group(lesson_id)) >= 2)
  with check (public.group_rank(public.lesson_group(lesson_id)) >= 2);

/*
  ── the group branch on `recipes`, which 0002 deferred ──────────────────────

  A member may read a recipe that BELONGS TO A GROUP they are in, and only if
  some visible item points at it. Three things about this policy are load
  bearing:

    1. `group_id is not null` — the predicate 0002's comment insisted on. A
       student's own recipe has group_id null and is unreachable through this
       policy no matter who asks.
    2. SELECT only. A member never writes a group recipe through RLS; an
       instructor edits it as its owner through `recipes_own`.
    3. The `exists` goes through `group_recipe_items`, whose own policy already
       applies `perm_view` — so a recipe whose item is hidden is not readable
       here either, and the permission is enforced once rather than twice with
       a chance of disagreeing.

  RLS policies for the same command are OR'd, so this ADDS to `recipes_own`
  rather than narrowing it.
*/
drop policy if exists recipes_group_read on public.recipes;
create policy recipes_group_read on public.recipes
  for select
  using (
    group_id is not null
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_recipe_items i
      where i.recipe_id = recipes.id
    )
  );

/*
  A group recipe's ingredients and steps have to travel with it. `owns_recipe`
  (0002) answers "is the caller the recipe's owner", which is false for a
  student reading the group's copy — so without this the recipe would arrive
  with no ingredients, which is worse than not arriving.

  It is SELECT-only, and it reuses the recipe policy above by asking the same
  question of the parent row: `exists (select 1 from recipes where id = ...)`
  is itself filtered by RLS, so a recipe the caller cannot see yields nothing.
  One rule, one place.
*/
create or replace function public.can_read_recipe(p_recipe_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (select 1 from public.recipes r where r.id = p_recipe_id);
$$;

comment on function public.can_read_recipe(uuid) is
  'Can the caller SELECT this recipe? SECURITY INVOKER on purpose: it is the '
  'RLS on `recipes` that answers, so this cannot grant more than the caller '
  'already has.';

drop policy if exists ingredients_readable on public.ingredients;
create policy ingredients_readable on public.ingredients
  for select
  using (public.can_read_recipe(recipe_id));

drop policy if exists steps_readable on public.steps;
create policy steps_readable on public.steps
  for select
  using (public.can_read_recipe(recipe_id));

/*
  `trials` and `batches` get NO group policy. A group recipe's trial log and
  its HACCP batch records belong to whoever produced them, and §12.3 puts them
  out of reach. `duplicateRecipe` in the app refuses to copy them for the same
  reason.

  CORRECTION, made in 0028: `issues` was listed here too, and that was wrong.
  A `תקלה → פתרון` list is knowledge about the formula, not a record of a
  production run, and for a course it is one of the most useful things the
  instructor wrote. Withholding it also made `save_group_recipe_copy` drop the
  list silently, because the copy is an `insert ... select` and an unreadable
  source yields no rows. 0028 gives it the same read policy as `ingredients`
  and `steps`.
*/

/*
  ── creating a group is ONE call, because it is two rows ────────────────────

  A group needs its `groups` row AND its owner's `group_members` row. Done as
  two requests from the browser, a failure between them leaves the worst
  possible state: the creator owns a group row, is not a member of it, and
  therefore cannot SELECT it (`groups_read` requires membership), cannot update
  it and cannot delete it (`group_rank` is 0). An invisible, unfixable group.

  SECURITY INVOKER, so both inserts still go through the policies above — this
  adds atomicity and not one bit of authority. The `members_bootstrap` policy
  is what lets the second insert through, and it is narrow enough that this
  function is the only realistic way to satisfy it.
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
  v_id uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if pg_catalog.btrim(coalesce(p_name, '')) = '' then
    raise exception 'a group needs a name' using errcode = '22023';
  end if;

  insert into public.groups (name, kind, note, owner_id)
  values (pg_catalog.btrim(p_name), coalesce(p_kind, ''), coalesce(p_note, ''), v_uid)
  returning id into v_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

comment on function public.create_group(text, text, text) is
  'Creates a group and its owner membership in one transaction. SECURITY '
  'INVOKER: adds atomicity, not authority.';

-- ── grants, matching 0020's least privilege ──────────────────────────────────
grant select on public.groups, public.group_members, public.courses,
  public.lessons, public.group_recipe_items to anon, authenticated;
grant insert, update, delete on public.groups, public.group_members,
  public.courses, public.lessons, public.group_recipe_items to authenticated;

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.group_rank(uuid) from public, anon;
revoke all on function public.course_group(uuid) from public, anon;
revoke all on function public.lesson_group(uuid) from public, anon;
revoke all on function public.item_group(uuid) from public, anon;
revoke all on function public.can_read_recipe(uuid) from public, anon;
revoke all on function public.create_group(text, text, text) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.group_rank(uuid) to authenticated;
grant execute on function public.course_group(uuid) to authenticated;
grant execute on function public.lesson_group(uuid) to authenticated;
grant execute on function public.item_group(uuid) to authenticated;
grant execute on function public.can_read_recipe(uuid) to authenticated;
grant execute on function public.create_group(text, text, text) to authenticated;
