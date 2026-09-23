-- ─────────────────────────────────────────────────────────────────────────────
-- 0036 — putting a recipe into a lesson, taking it out, and the student's own
--        note on a group item
--
-- WHY PUBLISHING IS ONE RPC AND NOT TWO CLIENT CALLS
--
-- 0025 established the invariant: a lesson item may only point at a recipe
-- whose `group_id` is the lesson's group. So publishing an instructor's own
-- recipe is two writes — set `recipes.group_id`, then insert the item — and
-- PostgREST has no transaction spanning two calls.
--
-- Done from the browser, a failure between them leaves a recipe marked as
-- belonging to a group with no item pointing at it. Nobody else can read it
-- (`recipes_group_read` requires an item to exist), so it is not a leak; it is
-- a recipe that now refuses to have its group changed (0025's move guard) for
-- a reason the instructor cannot see. One transaction, one decision.
--
-- WHY THESE ARE SECURITY INVOKER
--
-- Every step is within the caller's own RLS: they own the recipe
-- (`recipes_own`), and they hold rank >= 2 on the lesson (`items_write`). A
-- definer function here would be privilege for nothing — see the note in
-- check-types-against-schema.mjs: if it can be INVOKER, it is.
--
-- WHAT `unpublish` CLEARS, AND WHAT IT DOES NOT
--
-- Removing the last item that points at a recipe also clears its `group_id`,
-- so the recipe goes back to being an ordinary personal recipe. With another
-- item still pointing at it, the group_id stays — clearing it would break that
-- other lesson. The student COPIES are untouched either way: §11 says the copy
-- is the student's own recipe, and taking the original out of the group has
-- nothing to do with it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.publish_recipe_to_lesson(
  p_lesson_id uuid,
  p_recipe_id uuid,
  p_name      text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_group  uuid;
  v_owner  uuid;
  v_name   text;
  v_item   uuid;
begin
  if v_uid is null then
    raise exception 'לא ניתן לפרסם מתכון בלי התחברות' using errcode = '42501';
  end if;

  if public.lesson_rank(p_lesson_id) < 2 then
    -- The same message for "no such lesson" and "not allowed": a different
    -- answer for each would tell a stranger which lesson ids exist.
    raise exception 'אין הרשאה להוסיף מתכון לשיעור הזה' using errcode = '42501';
  end if;

  select c.group_id into v_group
    from public.lessons l
    join public.courses c on c.id = l.course_id
   where l.id = p_lesson_id;
  if v_group is null then
    raise exception 'אין הרשאה להוסיף מתכון לשיעור הזה' using errcode = '42501';
  end if;

  /*
    RLS on `recipes` hides another account's recipe, so this is empty for one —
    and "not yours" and "does not exist" are deliberately the same answer.
  */
  select owner_id, name into v_owner, v_name
    from public.recipes where id = p_recipe_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'המתכון אינו של החשבון הזה' using errcode = '42501';
  end if;

  /*
    Marking the recipe as the group's. The move guard from 0025 refuses this
    when the recipe is already in ANOTHER group and an item points at it, which
    is the case this function must not paper over.
  */
  update public.recipes set group_id = v_group
   where id = p_recipe_id and owner_id = v_uid
     and coalesce(group_id::text, '') <> v_group::text;

  insert into public.group_recipe_items (lesson_id, recipe_id, name, ord)
  values (
    p_lesson_id,
    p_recipe_id,
    /* NULLIF and COALESCE are parser constructs, not functions, so they
       cannot be schema-qualified — `pg_catalog.nullif` is "function does not
       exist" (42883), which is how this was found. `search_path = ''` does
       not put them out of reach; only real functions need qualifying. */
    coalesce(nullif(pg_catalog.btrim(coalesce(p_name, '')), ''), v_name),
    coalesce(
      (select pg_catalog.max(i.ord) + 1
         from public.group_recipe_items i
        where i.lesson_id = p_lesson_id),
      0)
  )
  returning id into v_item;

  return v_item;
end;
$$;

comment on function public.publish_recipe_to_lesson(uuid, uuid, text) is
  'Marks the caller''s own recipe as the lesson''s group recipe and adds the '
  'lesson item, in one transaction. 0025''s invariant makes those two writes '
  'inseparable; split across two client calls a failure between them leaves a '
  'recipe that cannot change group for an invisible reason.';

-- ── taking it back out ───────────────────────────────────────────────────────
create or replace function public.unpublish_recipe_from_lesson(p_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_recipe uuid;
  v_left   integer;
begin
  select recipe_id into v_recipe
    from public.group_recipe_items where id = p_item_id;
  if v_recipe is null then
    raise exception 'הפריט אינו קיים' using errcode = '42501';
  end if;

  delete from public.group_recipe_items where id = p_item_id;
  if not found then
    -- `items_write` admitted no row. A DELETE that matches nothing raises
    -- nothing, so the refusal has to be made here or it would look like success.
    raise exception 'אין הרשאה להסיר את הפריט הזה' using errcode = '42501';
  end if;

  select pg_catalog.count(*) into v_left
    from public.group_recipe_items where recipe_id = v_recipe;

  if v_left = 0 then
    -- Back to an ordinary personal recipe. Only the owner can do this, and
    -- `recipes_own` is what decides whether the update matches a row.
    update public.recipes set group_id = null
     where id = v_recipe and owner_id = v_uid;
  end if;
end;
$$;

comment on function public.unpublish_recipe_from_lesson(uuid) is
  'Removes a lesson item and, when it was the last one pointing at the recipe, '
  'returns the recipe to the personal notebook by clearing group_id. Student '
  'copies made under §11 are their own recipes and are untouched.';

-- ── §8 on a group item ───────────────────────────────────────────────────────
/**
 * The student's private note on a GROUP recipe.
 *
 * `save_private_note` cannot serve this: it refuses a recipe the caller does
 * not own, which is exactly what a group recipe is. The note therefore hangs
 * off the ITEM — `private_notes.group_item_id` — and §12.3 still holds: the
 * row is the student's, `private_notes_own` is `user_id = auth.uid()`, and no
 * instructor can read it.
 *
 * An empty body removes the row, the same rule as 0022: for text, "empty" and
 * "absent" are the same statement.
 */
create or replace function public.save_item_note(
  p_item_id uuid,
  p_body    text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_body text := coalesce(p_body, '');
  v_seen uuid;
begin
  if v_uid is null then
    raise exception 'לא ניתן לשמור הערה בלי התחברות' using errcode = '42501';
  end if;

  -- `items_read` decides this: a member sees the item only when perm_view is
  -- on, and a non-member sees nothing at all.
  select id into v_seen from public.group_recipe_items where id = p_item_id;
  if v_seen is null then
    raise exception 'הפריט אינו קיים' using errcode = '42501';
  end if;

  if pg_catalog.btrim(v_body) = '' then
    delete from public.private_notes
     where user_id = v_uid and group_item_id = p_item_id;
    return;
  end if;

  insert into public.private_notes (user_id, group_item_id, body)
  values (v_uid, p_item_id, v_body)
  on conflict (user_id, group_item_id) where group_item_id is not null
  do update set body = excluded.body;
end;
$$;

comment on function public.save_item_note(uuid, text) is
  '§8 on a group item. Keyed on the item rather than the recipe because the '
  'recipe is not the caller''s; still private to the account, still invisible '
  'to an instructor (§12.3).';

-- ── grants ───────────────────────────────────────────────────────────────────
-- `create function` grants EXECUTE to PUBLIC, and Supabase adds `anon` on top.
-- Every one of these decides something about `auth.uid()`, which is null for
-- an unauthenticated caller — see migrations 0006 and 0010.
revoke all on function public.publish_recipe_to_lesson(uuid, uuid, text) from public, anon;
revoke all on function public.unpublish_recipe_from_lesson(uuid) from public, anon;
revoke all on function public.save_item_note(uuid, text) from public, anon;

grant execute on function public.publish_recipe_to_lesson(uuid, uuid, text) to authenticated;
grant execute on function public.unpublish_recipe_from_lesson(uuid) to authenticated;
grant execute on function public.save_item_note(uuid, text) to authenticated;
