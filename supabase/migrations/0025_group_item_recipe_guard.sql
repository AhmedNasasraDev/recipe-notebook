-- ─────────────────────────────────────────────────────────────────────────────
-- 0025 — a group item may only point at that group's own recipe
--
-- WHAT WAS MEASURED
--
-- As a group owner, with a student's private recipe id in hand:
--
--   insert into group_recipe_items (lesson_id, recipe_id, ...) → INSERTED
--   the row landed                                             → 1
--   the student's recipe readable by the instructor            → 0
--
-- So there is no leak today: `recipes_group_read` (0023) requires
-- `group_id is not null`, and a student's own recipe has it null. The read is
-- refused by that predicate and by nothing else.
--
-- WHY THAT IS NOT GOOD ENOUGH
--
-- A referential invariant is being held up by a single predicate in an
-- unrelated policy. The row itself is a lie — a lesson in a course claiming to
-- contain a recipe that belongs to a student's private notebook — and it sits
-- in the table waiting for someone to write the obvious-looking policy
-- "members may read any recipe a visible item points at". That policy would be
-- a §12.3 breach, and it would look correct to whoever wrote it, because the
-- data would look correct.
--
-- This is the same class of defect as `ingredients.sub_recipe_id` in 0007, and
-- for exactly the same reason: FOREIGN KEY VALIDATION RUNS WITH RLS BYPASSED,
-- so a uuid column happily accepts an id its owner could never have read. 0007
-- closed that with a trigger. This closes this one the same way.
--
-- WHY SECURITY DEFINER HERE
--
-- The check is "does the referenced recipe's group_id equal this item's
-- group". A SECURITY INVOKER trigger would answer it by reading `recipes`
-- under the caller's RLS, which gets the right answer in the common case and
-- the wrong one in a legitimate edge case: a group owner adding an item for a
-- recipe another instructor in the same group owns, which the owner cannot yet
-- read because no item points at it. That would refuse a valid write.
--
-- So the comparison is made directly, with RLS out of the way. It returns
-- nothing: the trigger either allows the write or raises. Nothing about the
-- referenced recipe can be read through it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_group_item_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_group   uuid;
  v_recipe_group uuid;
begin
  select c.group_id into v_item_group
    from public.lessons l
    join public.courses c on c.id = l.course_id
   where l.id = new.lesson_id;

  select r.group_id into v_recipe_group
    from public.recipes r
   where r.id = new.recipe_id;

  if v_item_group is null then
    -- No lesson, so no group. The FK should have caught this; refusing is the
    -- only safe answer if it somehow did not.
    raise exception 'the lesson does not exist' using errcode = '23503';
  end if;

  /*
    `v_recipe_group is null` is the case that matters: a recipe with no group
    is somebody's personal recipe. The message says which of the two problems
    it is, because "not allowed" sends an instructor looking at permissions
    when the real answer is "that recipe is not in this group".
  */
  if v_recipe_group is null then
    raise exception
      'a lesson item must point at a recipe that belongs to the group; this recipe belongs to a personal notebook'
      using errcode = '42501';
  end if;

  if v_recipe_group <> v_item_group then
    raise exception
      'a lesson item must point at a recipe that belongs to the same group'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_group_item_recipe() is
  'Enforces that group_recipe_items.recipe_id references a recipe of the same '
  'group. FK validation bypasses RLS, so without this the column accepts a '
  'personal recipe id (measured — see migration 0025).';

drop trigger if exists group_items_recipe_guard on public.group_recipe_items;
create trigger group_items_recipe_guard
  before insert or update of recipe_id, lesson_id on public.group_recipe_items
  for each row execute function public.guard_group_item_recipe();

/*
  The mirror image: a recipe must not be moved OUT of a group while items
  still point at it, and must not be moved BETWEEN groups, because either one
  recreates the same broken row from the other direction.

  `recipes_own` already stops another account touching the row, so this guards
  the group's own instructor against doing it by accident.
*/
create or replace function public.guard_recipe_group_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.group_id::text, '') = coalesce(old.group_id::text, '') then
    return new;
  end if;

  if exists (
    select 1 from public.group_recipe_items i
    where i.recipe_id = new.id
  ) then
    raise exception
      'this recipe is used by a lesson; remove it from the lesson before changing its group'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists recipes_group_move_guard on public.recipes;
create trigger recipes_group_move_guard
  before update of group_id on public.recipes
  for each row execute function public.guard_recipe_group_move();

revoke all on function public.guard_group_item_recipe() from public, anon, authenticated;
revoke all on function public.guard_recipe_group_move() from public, anon, authenticated;
