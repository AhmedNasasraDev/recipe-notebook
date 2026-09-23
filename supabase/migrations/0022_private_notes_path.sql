-- ─────────────────────────────────────────────────────────────────────────────
-- 0022 — the write path for personal notes (§8)
--
-- WHAT WAS MISSING
--
-- `private_notes` has existed since 0003 with its RLS policy, its two partial
-- unique indexes and its `updated_at` trigger, and `rls-isolation.sql` has been
-- proving since stage 3 that one account cannot read another's notes. Nothing
-- ever wrote to it. The table was a tested, empty room: §8 is in the spec, the
-- column is in the model, and the feature did not exist.
--
-- WHY AN RPC AND NOT AN UPSERT FROM THE CLIENT
--
-- The uniqueness that makes "one note per recipe per user" true is a PARTIAL
-- index:
--
--     unique (user_id, recipe_id) where recipe_id is not null
--
-- and it has to be partial, because a plain unique constraint over a nullable
-- column would either allow duplicates (NULLS DISTINCT) or collide every
-- group-item note of one user against every other (NULLS NOT DISTINCT). SQL
-- can name that index in `on conflict (user_id, recipe_id) where recipe_id is
-- not null`, but PostgREST's `upsert` cannot express the predicate — so a
-- client-side upsert would fail with "no unique or exclusion constraint
-- matching the ON CONFLICT specification", which is exactly the defect stage 8
-- found in `record_purchase`. One RPC, one round trip, one statement.
--
-- WHY AN EMPTY NOTE DELETES THE ROW
--
-- A note is text, and for text "empty" and "absent" are the same statement —
-- unlike a price or a weight, where 0 and blank differ and the whole data model
-- turns on keeping them apart. Clearing the box therefore removes the row
-- rather than storing an empty one, so `private_notes` holds notes and nothing
-- else.
--
-- SECURITY INVOKER, deliberately: the function needs no authority the caller
-- does not have. RLS decides, and the owner check below is belt to its braces
-- so that a recipe id belonging to someone else is refused with a message
-- rather than silently writing a row RLS would then hide.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.save_private_note(
  p_recipe_id uuid,
  p_body      text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
  v_body  text := coalesce(p_body, '');
begin
  if v_uid is null then
    raise exception 'לא ניתן לשמור הערה בלי התחברות' using errcode = 'insufficient_privilege';
  end if;

  -- RLS on `recipes` already hides another account's recipe, so this select
  -- comes back empty for one — and "not found" is the same answer as "not
  -- yours", which is the only answer that leaks nothing.
  select owner_id into v_owner from public.recipes where id = p_recipe_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'המתכון אינו של החשבון הזה' using errcode = 'insufficient_privilege';
  end if;

  if pg_catalog.btrim(v_body) = '' then
    delete from public.private_notes
     where user_id = v_uid and recipe_id = p_recipe_id;
    return;
  end if;

  insert into public.private_notes (user_id, recipe_id, body)
  values (v_uid, p_recipe_id, v_body)
  on conflict (user_id, recipe_id) where recipe_id is not null
  do update set body = excluded.body;
end;
$$;

revoke execute on function public.save_private_note(uuid, text) from public, anon;
grant  execute on function public.save_private_note(uuid, text) to authenticated;
