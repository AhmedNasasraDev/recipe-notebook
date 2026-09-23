-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 — the save path learns about `steps.kind`
--
-- A REAL DEFECT, mine, found by running supabase/tests/planning.sql against the
-- live database: migration 0018 added `steps.kind`, the client sends it, and
-- `replace_recipe_children` (0007) enumerates the step columns it writes — so
-- every kind arrived as NULL. A timeline would then report every step as "לא
-- מסווג" no matter what the user chose, and the choice would look like it had
-- not been saved because it HAD not been.
--
-- This is the same defect stage 8 found in `sale_price` (migration 0014), in
-- the same kind of place, one stage later. Two observations worth recording:
--
--   · An enumerated column list in a write function is a standing trap. The
--     stage-8 fix moved the RECIPE's new fields into a single helper for
--     exactly this reason; the CHILD writer still enumerates, and this is what
--     that costs. It is not refactored here — `replace_recipe_children` is
--     shared by save and restore and is the one place each child column is
--     written, so the fix is to add the column, not to add indirection.
--   · Only real Postgres could catch it. The in-memory double applies whole
--     rows, so the kind survived there and every web test passed.
-- ─────────────────────────────────────────────────────────────────────────────

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

  insert into public.steps (recipe_id, ord, text, temp, temp_unit, minutes, kind)
  select
    p_recipe_id,
    coalesce((e->>'ord')::int, (ordinality - 1)::int),
    coalesce(e->>'text',''),
    (e->>'temp')::numeric,
    coalesce(nullif(e->>'temp_unit',''), 'C'),
    (e->>'minutes')::numeric,
    -- NULL stays NULL: "nobody classified this step" is a real state, and the
    -- timeline reports it rather than guessing (migration 0018).
    nullif(e->>'kind','')
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

revoke execute on function public.replace_recipe_children(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant  execute on function public.replace_recipe_children(uuid, jsonb, jsonb, jsonb)
  to authenticated;
