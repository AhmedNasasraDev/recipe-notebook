-- ─────────────────────────────────────────────────────────────────────────────
-- 0007 — atomic recipe saves with versioning, and sub-recipe link guards
--
-- Two problems, both found by probing the live database rather than by reading
-- the code.
--
-- ── PROBLEM 1: the save was never atomic ───────────────────────────────────
--
-- `SupabaseRepository.saveRecipe` did four or more separate round trips:
-- UPDATE the parent, then DELETE and INSERT ingredients, steps and issues. A
-- failure between any two of them left a recipe whose parent row and child rows
-- disagreed. That was already true before versioning; §9 makes it worse, because
-- "snapshot the previous state, then overwrite it" across two client calls can
-- leave history that is either missing or a lie:
--
--   • snapshot succeeds, update fails  → a version claiming to be "the previous
--     state" of a change that never happened
--   • update succeeds, snapshot fails  → the previous state is gone for good
--
-- PostgREST has no multi-statement transaction, so no arrangement of client
-- calls fixes this. `save_recipe()` below does the whole thing in one function,
-- which is one transaction.
--
-- ── PROBLEM 2: a sub-recipe could point at another account's recipe ────────
--
-- Probed before writing any of this, as user A against user B's recipe:
--
--   A links B's recipe as a sub-recipe  → ACCEPTED
--   A links A's recipe to itself        → ACCEPTED
--   A can read B's recipe               → 0 rows
--
-- RLS on `ingredients` checks `owns_recipe(recipe_id)` — the PARENT. Nothing
-- looked at `sub_recipe_id`, and a foreign key is verified by the system, not
-- by RLS, so the reference stored cleanly. Nothing leaked today, because the
-- engine resolves a sub-recipe out of the recipe list the client already
-- loaded and that list is RLS-filtered. But "useless" is not "impossible", and
-- a stored cross-account reference is a leak waiting for the first server-side
-- computation or export.
--
-- A CHECK constraint cannot run a subquery, so this is a trigger.
--
-- ── SECURITY POSTURE ───────────────────────────────────────────────────────
--
-- Both RPCs are SECURITY INVOKER. That is deliberate and it is the whole
-- safety argument: every statement inside them is subject to the same RLS
-- policies as the equivalent client call, so there is no privileged path to
-- audit and no way for a caller to reach another account's rows. The functions
-- add atomicity, not authority. They also re-check ownership explicitly, so a
-- misconfigured policy fails closed rather than open.
--
-- The link-guard trigger IS SECURITY DEFINER, for one narrow reason: it must
-- resolve the owner of BOTH recipes to compare them, and under RLS the sub
-- recipe's row would simply be invisible when it belongs to someone else —
-- indistinguishable from "does not exist". It reads two owner_id values and
-- either raises or allows; it returns nothing to the caller.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. sub-recipe link guards (stage-5 requirements 13, 14, 15)
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.check_sub_recipe_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_owner uuid;
  v_sub_owner    uuid;
begin
  if new.sub_recipe_id is null then
    return new;
  end if;

  -- requirement 13: a recipe cannot contain itself.
  if new.sub_recipe_id = new.recipe_id then
    raise exception 'מתכון אינו יכול להכיל את עצמו כתת־מתכון'
      using errcode = 'check_violation';
  end if;

  select owner_id into v_parent_owner from public.recipes where id = new.recipe_id;
  select owner_id into v_sub_owner    from public.recipes where id = new.sub_recipe_id;

  if v_sub_owner is null then
    raise exception 'תת־המתכון המקושר אינו קיים'
      using errcode = 'foreign_key_violation';
  end if;

  -- requirement 15: same account, whatever id was typed in.
  if v_parent_owner is distinct from v_sub_owner then
    raise exception 'תת־מתכון חייב להיות מתכון של אותו חשבון'
      using errcode = 'insufficient_privilege';
  end if;

  -- requirement 14: would this link close a loop? Walk forward from the sub
  -- recipe and see whether the parent is reachable. `union` (not `union all`)
  -- dedupes, which is what makes the walk terminate on an existing cycle
  -- rather than recursing forever.
  if exists (
    with recursive reachable(id) as (
      select new.sub_recipe_id
      union
      select i.sub_recipe_id
        from public.ingredients i
        join reachable r on i.recipe_id = r.id
       where i.sub_recipe_id is not null
    )
    select 1 from reachable where id = new.recipe_id
  ) then
    raise exception 'הקישור הזה יוצר מעגל בין מתכונים'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_sub_recipe_link() from public, anon, authenticated;

drop trigger if exists ingredients_sub_recipe_guard on public.ingredients;
create trigger ingredients_sub_recipe_guard
  before insert or update of sub_recipe_id, recipe_id on public.ingredients
  for each row execute function public.check_sub_recipe_link();

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. the snapshot
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Shape: exactly the `RecipeBundle` that apps/web/src/data/mappers.ts already
-- reads. That is the point — ONE mapper turns both a live row set and a stored
-- snapshot into a Recipe, so a restored version cannot be interpreted
-- differently from a live one.
--
-- What it holds: the recipes row, ingredients, steps, issues. Enough to rebuild
-- the formula completely (requirement 2).
--
-- What it deliberately does NOT hold:
--   versions  — a snapshot inside a snapshot, growing by a factor each save.
--               The prototype dropped it too (`versions: undefined`).
--   trials    — §13, a record of what was actually baked.
--   batches   — §13a, production records with HACCP fields.
-- Those last two are records of events, not the formula. Rewinding the formula
-- must not rewind the log of what happened, and a restore that deleted batch
-- records would destroy food-safety evidence.

create or replace function public.recipe_snapshot(p_recipe_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'recipe', to_jsonb(r.*),
    'ingredients', coalesce((
      select jsonb_agg(to_jsonb(i.*) order by i.ord)
        from public.ingredients i where i.recipe_id = r.id), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(to_jsonb(s.*) order by s.ord)
        from public.steps s where s.recipe_id = r.id), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(to_jsonb(x.*) order by x.ord)
        from public.issues x where x.recipe_id = r.id), '[]'::jsonb)
  )
  from public.recipes r
  where r.id = p_recipe_id;
$$;

grant execute on function public.recipe_snapshot(uuid) to authenticated;

-- The next `V<n>` for a recipe. The unique index on (recipe_id, tag) is the
-- backstop if two transactions pick the same number; save_recipe turns that
-- collision into a "someone else saved" message rather than a raw 23505.
create or replace function public.next_version_tag(p_recipe_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'V' || (
    coalesce(max((regexp_match(tag, '^V(\d+)$'))[1]::int), 0) + 1
  )::text
  from public.recipe_versions
  where recipe_id = p_recipe_id;
$$;

grant execute on function public.next_version_tag(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. save_recipe — parent, children and the version snapshot, in ONE transaction
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `p_expected_updated_at` is optimistic concurrency. The client sends the
-- `updated_at` it loaded; if the row has moved on, someone else saved in the
-- meantime and this save is refused rather than silently overwriting their
-- work. Pass NULL to skip the check.
--
-- `p_version_note` is the §9 versionDiff, computed on the client where the
-- previous and next recipe are both in hand and the algorithm is unit-tested.
-- It is descriptive text, not data anything depends on.

create or replace function public.save_recipe(
  p_recipe              jsonb,
  p_ingredients         jsonb default '[]'::jsonb,
  p_steps               jsonb default '[]'::jsonb,
  p_issues              jsonb default '[]'::jsonb,
  p_recipe_id           uuid default null,
  p_expected_updated_at timestamptz default null,
  p_version_note        text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_owner     uuid;
  v_updated   timestamptz;
  v_snapshot  jsonb;
  v_tag       text;
begin
  if v_uid is null then
    raise exception 'לא ניתן לשמור בלי התחברות' using errcode = 'insufficient_privilege';
  end if;

  if p_recipe_id is null then
    -- ── create ──────────────────────────────────────────────────────────────
    -- No version: there is no previous state to snapshot. A "V1" holding the
    -- recipe's own first state would be history of nothing.
    insert into public.recipes (
      owner_id, group_id, name, category, tags, is_sub, locked,
      yield_units, unit_weight, yield_actual, weight_before, weight_after,
      dough_mode, ddt, flour_temp, room_temp, friction, target_fc,
      shelf_life, storage, freezing, thawing, equipment, notes,
      manual_allergens, pan, version_of, version_note, saved_from_item_id
    )
    select
      v_uid,
      nullif(p_recipe->>'group_id','')::uuid,
      p_recipe->>'name',
      coalesce(nullif(p_recipe->>'category',''), 'אחר'),
      coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                 coalesce(p_recipe->'tags','[]'::jsonb)) as t(value)), '{}'::text[]),
      coalesce((p_recipe->>'is_sub')::boolean, false),
      coalesce((p_recipe->>'locked')::boolean, false),
      coalesce((p_recipe->>'yield_units')::numeric, 0),
      coalesce((p_recipe->>'unit_weight')::numeric, 0),
      (p_recipe->>'yield_actual')::numeric,
      (p_recipe->>'weight_before')::numeric,
      (p_recipe->>'weight_after')::numeric,
      coalesce((p_recipe->>'dough_mode')::boolean, false),
      (p_recipe->>'ddt')::numeric,
      (p_recipe->>'flour_temp')::numeric,
      (p_recipe->>'room_temp')::numeric,
      (p_recipe->>'friction')::numeric,
      coalesce((p_recipe->>'target_fc')::numeric, 0),
      coalesce(p_recipe->>'shelf_life',''),
      coalesce(p_recipe->>'storage',''),
      coalesce(p_recipe->>'freezing',''),
      coalesce(p_recipe->>'thawing',''),
      coalesce(p_recipe->>'equipment',''),
      coalesce(p_recipe->>'notes',''),
      coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                 coalesce(p_recipe->'manual_allergens','[]'::jsonb)) as t(value)), '{}'::text[]),
      case when p_recipe->'pan' = 'null'::jsonb then null else p_recipe->'pan' end,
      nullif(p_recipe->>'version_of','')::uuid,
      coalesce(p_recipe->>'version_note',''),
      nullif(p_recipe->>'saved_from_item_id','')::uuid
    returning id into v_id;

  else
    -- ── update ──────────────────────────────────────────────────────────────
    v_id := p_recipe_id;

    -- FOR UPDATE holds the row for the rest of the transaction, so a
    -- concurrent save waits here instead of interleaving with this one.
    select owner_id, updated_at into v_owner, v_updated
      from public.recipes where id = v_id for update;

    if v_owner is null then
      raise exception 'המתכון לא נמצא' using errcode = 'no_data_found';
    end if;
    -- Belt and braces: RLS already limits this, and an explicit check means a
    -- policy mistake fails closed.
    if v_owner <> v_uid then
      raise exception 'המתכון אינו של החשבון הזה' using errcode = 'insufficient_privilege';
    end if;

    if p_expected_updated_at is not null
       and v_updated is distinct from p_expected_updated_at then
      raise exception 'המתכון שונה במקום אחר מאז שנטען. יש לרענן ולנסות שוב.'
        using errcode = 'serialization_failure';
    end if;

    -- §9: snapshot the state as it is NOW, before a single column moves.
    v_snapshot := public.recipe_snapshot(v_id);
    v_tag := public.next_version_tag(v_id);

    begin
      insert into public.recipe_versions (recipe_id, tag, what, snapshot, created_by)
      values (v_id, v_tag, coalesce(p_version_note, ''), v_snapshot, v_uid);
    exception when unique_violation then
      raise exception 'המתכון שונה במקום אחר מאז שנטען. יש לרענן ולנסות שוב.'
        using errcode = 'serialization_failure';
    end;

    update public.recipes set
      name             = p_recipe->>'name',
      category         = coalesce(nullif(p_recipe->>'category',''), 'אחר'),
      tags             = coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                            coalesce(p_recipe->'tags','[]'::jsonb)) as t(value)), '{}'::text[]),
      is_sub           = coalesce((p_recipe->>'is_sub')::boolean, false),
      locked           = coalesce((p_recipe->>'locked')::boolean, false),
      yield_units      = coalesce((p_recipe->>'yield_units')::numeric, 0),
      unit_weight      = coalesce((p_recipe->>'unit_weight')::numeric, 0),
      yield_actual     = (p_recipe->>'yield_actual')::numeric,
      weight_before    = (p_recipe->>'weight_before')::numeric,
      weight_after     = (p_recipe->>'weight_after')::numeric,
      dough_mode       = coalesce((p_recipe->>'dough_mode')::boolean, false),
      ddt              = (p_recipe->>'ddt')::numeric,
      flour_temp       = (p_recipe->>'flour_temp')::numeric,
      room_temp        = (p_recipe->>'room_temp')::numeric,
      friction         = (p_recipe->>'friction')::numeric,
      target_fc        = coalesce((p_recipe->>'target_fc')::numeric, 0),
      shelf_life       = coalesce(p_recipe->>'shelf_life',''),
      storage          = coalesce(p_recipe->>'storage',''),
      freezing         = coalesce(p_recipe->>'freezing',''),
      thawing          = coalesce(p_recipe->>'thawing',''),
      equipment        = coalesce(p_recipe->>'equipment',''),
      notes            = coalesce(p_recipe->>'notes',''),
      manual_allergens = coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                            coalesce(p_recipe->'manual_allergens','[]'::jsonb)) as t(value)), '{}'::text[]),
      pan              = case when p_recipe->'pan' = 'null'::jsonb then null else p_recipe->'pan' end,
      version_of       = nullif(p_recipe->>'version_of','')::uuid,
      version_note     = coalesce(p_recipe->>'version_note',''),
      saved_from_item_id = nullif(p_recipe->>'saved_from_item_id','')::uuid
    where id = v_id;
  end if;

  perform public.replace_recipe_children(v_id, p_ingredients, p_steps, p_issues);
  return v_id;
end;
$$;

grant execute on function public.save_recipe(
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, text) to authenticated;

-- Shared by save_recipe and restore_recipe_version, so the two cannot drift
-- in how they write a child row.
create or replace function public.replace_recipe_children(
  p_recipe_id   uuid,
  p_ingredients jsonb,
  p_steps       jsonb,
  p_issues      jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.ingredients where recipe_id = p_recipe_id;
  delete from public.steps       where recipe_id = p_recipe_id;
  delete from public.issues      where recipe_id = p_recipe_id;

  insert into public.ingredients (
    recipe_id, ord, name, ingredient_key, qty, unit, flour, liquid,
    water_pct, unit_weight, g_per_100, price, price_unit, sub_recipe_id, note
  )
  select
    p_recipe_id,
    coalesce((e->>'ord')::int, (ordinality - 1)::int),
    coalesce(e->>'name',''),
    nullif(e->>'ingredient_key',''),
    coalesce((e->>'qty')::numeric, 0),
    coalesce(nullif(e->>'unit',''), 'גרם'),
    coalesce((e->>'flour')::boolean, false),
    coalesce((e->>'liquid')::boolean, false),
    -- NULL stays NULL and 0 stays 0, in every one of these four. This is the
    -- rule the whole app is built on (§1.1, §18.11).
    (e->>'water_pct')::numeric,
    (e->>'unit_weight')::numeric,
    (e->>'g_per_100')::numeric,
    (e->>'price')::numeric,
    nullif(e->>'price_unit',''),
    nullif(e->>'sub_recipe_id','')::uuid,
    coalesce(e->>'note','')
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) with ordinality as a(e, ordinality);

  insert into public.steps (recipe_id, ord, text, temp, temp_unit, minutes)
  select
    p_recipe_id,
    coalesce((e->>'ord')::int, (ordinality - 1)::int),
    coalesce(e->>'text',''),
    (e->>'temp')::numeric,
    coalesce(nullif(e->>'temp_unit',''), 'C'),
    (e->>'minutes')::numeric
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as a(e, ordinality);

  insert into public.issues (recipe_id, ord, problem, solution)
  select
    p_recipe_id,
    coalesce((e->>'ord')::int, (ordinality - 1)::int),
    coalesce(e->>'problem',''),
    coalesce(e->>'solution','')
  from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) with ordinality as a(e, ordinality);
end;
$$;

grant execute on function public.replace_recipe_children(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. restore_recipe_version — also one transaction
-- ═════════════════════════════════════════════════════════════════════════════
--
-- §9: "שחזור אינו מוחק — הוא דוחף את הגרסה הנוכחית להיסטוריה ואז מחזיר את
-- ה-snapshot." So a restore is two writes that must both happen or neither:
-- snapshot the present, then apply the past. A wrong restore is therefore
-- itself undoable, which is requirement 7.
--
-- §9 also: a `locked` recipe cannot be restored until it is unlocked.

create or replace function public.restore_recipe_version(p_version_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_recipe   uuid;
  v_owner    uuid;
  v_locked   boolean;
  v_tag      text;
  v_snapshot jsonb;
  v_snap_r   jsonb;
  v_new_tag  text;
begin
  if v_uid is null then
    raise exception 'לא ניתן לשחזר בלי התחברות' using errcode = 'insufficient_privilege';
  end if;

  -- RLS on recipe_versions already limits this to the caller's own recipes
  -- (`owns_recipe(recipe_id)`), so a version belonging to another account is
  -- simply not found here — which is the right answer and not a hint.
  select recipe_id, tag, snapshot into v_recipe, v_tag, v_snapshot
    from public.recipe_versions where id = p_version_id;

  if v_recipe is null then
    raise exception 'הגרסה לא נמצאה' using errcode = 'no_data_found';
  end if;

  select owner_id, locked into v_owner, v_locked
    from public.recipes where id = v_recipe for update;

  if v_owner is null or v_owner <> v_uid then
    raise exception 'המתכון אינו של החשבון הזה' using errcode = 'insufficient_privilege';
  end if;

  if v_locked then
    raise exception 'המתכון מסומן כנוסחה מאושרת לייצור. יש לבטל את הנעילה לפני שחזור.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The present becomes history FIRST, so an undo exists for this restore.
  v_new_tag := public.next_version_tag(v_recipe);
  begin
    insert into public.recipe_versions (recipe_id, tag, what, snapshot, created_by)
    values (v_recipe, v_new_tag,
            'המצב שלפני שחזור ' || v_tag,
            public.recipe_snapshot(v_recipe), v_uid);
  exception when unique_violation then
    raise exception 'המתכון שונה במקום אחר מאז שנטען. יש לרענן ולנסות שוב.'
      using errcode = 'serialization_failure';
  end;

  v_snap_r := v_snapshot->'recipe';
  if v_snap_r is null then
    raise exception 'ל-snapshot של הגרסה הזאת אין תוכן' using errcode = 'data_exception';
  end if;

  -- The snapshot's own id, owner_id, created_at and updated_at are ignored on
  -- purpose: restoring a formula must not move the recipe to a different
  -- account or rewrite when it was created.
  update public.recipes set
    name             = v_snap_r->>'name',
    category         = coalesce(nullif(v_snap_r->>'category',''), 'אחר'),
    tags             = coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                          coalesce(v_snap_r->'tags','[]'::jsonb)) as t(value)), '{}'::text[]),
    is_sub           = coalesce((v_snap_r->>'is_sub')::boolean, false),
    -- `locked` is NOT restored: it is an approval of the recipe as it stands,
    -- not a property of the formula. Restoring it could silently re-lock a
    -- recipe the user unlocked in order to do this restore.
    yield_units      = coalesce((v_snap_r->>'yield_units')::numeric, 0),
    unit_weight      = coalesce((v_snap_r->>'unit_weight')::numeric, 0),
    yield_actual     = (v_snap_r->>'yield_actual')::numeric,
    weight_before    = (v_snap_r->>'weight_before')::numeric,
    weight_after     = (v_snap_r->>'weight_after')::numeric,
    dough_mode       = coalesce((v_snap_r->>'dough_mode')::boolean, false),
    ddt              = (v_snap_r->>'ddt')::numeric,
    flour_temp       = (v_snap_r->>'flour_temp')::numeric,
    room_temp        = (v_snap_r->>'room_temp')::numeric,
    friction         = (v_snap_r->>'friction')::numeric,
    target_fc        = coalesce((v_snap_r->>'target_fc')::numeric, 0),
    shelf_life       = coalesce(v_snap_r->>'shelf_life',''),
    storage          = coalesce(v_snap_r->>'storage',''),
    freezing         = coalesce(v_snap_r->>'freezing',''),
    thawing          = coalesce(v_snap_r->>'thawing',''),
    equipment        = coalesce(v_snap_r->>'equipment',''),
    notes            = coalesce(v_snap_r->>'notes',''),
    manual_allergens = coalesce((select array_agg(value::text) from jsonb_array_elements_text(
                          coalesce(v_snap_r->'manual_allergens','[]'::jsonb)) as t(value)), '{}'::text[]),
    pan              = case when v_snap_r->'pan' = 'null'::jsonb then null else v_snap_r->'pan' end,
    version_of       = nullif(v_snap_r->>'version_of','')::uuid,
    version_note     = coalesce(v_snap_r->>'version_note',''),
    saved_from_item_id = nullif(v_snap_r->>'saved_from_item_id','')::uuid
  where id = v_recipe;

  -- The link guard fires on these inserts, so a snapshot taken before a
  -- sub-recipe was deleted cannot resurrect a dangling or cross-account link.
  perform public.replace_recipe_children(
    v_recipe,
    coalesce(v_snapshot->'ingredients', '[]'::jsonb),
    coalesce(v_snapshot->'steps', '[]'::jsonb),
    coalesce(v_snapshot->'issues', '[]'::jsonb)
  );

  return v_recipe;
end;
$$;

grant execute on function public.restore_recipe_version(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. which recipes use this one as a base
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `ingredients.sub_recipe_id` is ON DELETE SET NULL, so deleting a base recipe
-- silently turns every line that referenced it into a plain ingredient with no
-- weight. The data is consistent and the user is not told. This lets the delete
-- confirmation name the recipes that are about to break. RLS keeps it to the
-- caller's own recipes, so it cannot be used to probe anyone else's.

create or replace function public.recipes_using(p_recipe_id uuid)
returns table (id uuid, name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct r.id, r.name
    from public.ingredients i
    join public.recipes r on r.id = i.recipe_id
   where i.sub_recipe_id = p_recipe_id
     and r.id <> p_recipe_id;
$$;

grant execute on function public.recipes_using(uuid) to authenticated;
