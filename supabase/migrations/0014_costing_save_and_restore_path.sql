-- ─────────────────────────────────────────────────────────────────────────────
-- 0014 — the save path learns about the sale price and the cost breakdown
--
-- A REAL DEFECT, and it predates stage 8: migration 0012 added
-- `recipes.sale_price`, and the client sends it inside `p_recipe` on every
-- save — but `save_recipe` enumerates the columns it writes, and nobody added
-- `sale_price` to that list. So the sale price was accepted by the form, sent
-- to the database, and silently dropped; and `restore_recipe_version` never
-- restored it either. The web tests did not catch it because the in-memory
-- double applies the whole row instead of enumerating columns, so only real
-- Postgres could show it.
--
-- Stage 8 adds five more such fields, so the fix is not "add six names to two
-- 100-line column lists" — that is precisely how the first one drifted. The
-- new fields live in ONE helper that both functions call. Adding a costing
-- field from now on means touching a single statement.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.apply_recipe_costing(p_id uuid, p_recipe jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  -- NULL stays NULL: "not entered" is not ₪0, and a missing key in the payload
  -- must not become a zero cost that looks measured.
  update public.recipes set
    sale_price       = (p_recipe->>'sale_price')::numeric,
    sale_price_basis = coalesce(nullif(p_recipe->>'sale_price_basis', ''), 'batch'),
    packaging_cost   = (p_recipe->>'packaging_cost')::numeric,
    labor_cost       = (p_recipe->>'labor_cost')::numeric,
    other_cost       = (p_recipe->>'other_cost')::numeric,
    target_gm        = (p_recipe->>'target_gm')::numeric
  where id = p_id;
$$;

-- An internal helper of save_recipe and restore_recipe_version, exactly like
-- replace_recipe_children: SECURITY INVOKER called from SECURITY INVOKER, so
-- the signed-in caller must keep EXECUTE for those to work. RLS on `recipes`
-- is what stops it touching anyone else's row.
revoke execute on function public.apply_recipe_costing(uuid, jsonb) from public, anon;
grant  execute on function public.apply_recipe_costing(uuid, jsonb)  to authenticated;

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

  -- 0013: the costing and sale fields, in one place for both functions.
  perform public.apply_recipe_costing(v_id, p_recipe);

  perform public.replace_recipe_children(v_id, p_ingredients, p_steps, p_issues);
  return v_id;
end;
$$;

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
  -- 0013: restore the costing and sale fields the snapshot carries. A version
  -- taken before these columns existed has no such keys, so the restore sets
  -- them to NULL — which is the truth about that document, exactly as it is
  -- for every other nullable field a snapshot may predate.
  perform public.apply_recipe_costing(v_recipe, v_snap_r);

  perform public.replace_recipe_children(
    v_recipe,
    coalesce(v_snapshot->'ingredients', '[]'::jsonb),
    coalesce(v_snapshot->'steps', '[]'::jsonb),
    coalesce(v_snapshot->'issues', '[]'::jsonb)
  );

  return v_recipe;
end;
$$;

-- `create or replace` keeps the existing grants, but stating them keeps this
-- migration true on a fresh database as well.
revoke execute on function public.save_recipe(jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, text)
  from public, anon;
grant  execute on function public.save_recipe(jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, text)
  to authenticated;
revoke execute on function public.restore_recipe_version(uuid) from public, anon;
grant  execute on function public.restore_recipe_version(uuid)  to authenticated;
