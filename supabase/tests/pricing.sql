-- ─────────────────────────────────────────────────────────────────────────────
-- The ingredient centre, against real Postgres (stage-7 requirements 2-6, 8)
--
-- What it asks the database:
--   · the package arithmetic, which is a GENERATED column and not client code
--   · NULL vs 0, in both directions, in the catalog and in the snapshot
--   · that a live recipe stores no price and inherits the central one
--   · that a VERSION freezes the price it used, so history stays true
--   · that one account cannot read, write or infer another's prices,
--     suppliers, or which of their recipes use a material
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED — the role is switched to
-- `authenticated` with `request.jwt.claims` set, which is what PostgREST does
-- for a signed-in request. As the table owner, `postgres` bypasses RLS, so a
-- probe that forgets the switch reports perfect isolation while testing nothing.
--
-- THREE TRAPS, ALL HIT WHILE WRITING THIS
--
-- 1. A version holds the state BEFORE the save that created it. Checking that
--    "an override of 0 was frozen" against the version a save produced reads
--    the PREVIOUS state, which legitimately had no override. It accused
--    correct code of losing the override.
-- 2. `now()` is the TRANSACTION timestamp, so every version created in this
--    script shares one `created_at`. `order by created_at desc limit 1` picks
--    an arbitrary version — which is how the same check then read a snapshot
--    from a different state. Versions are selected by TAG below.
-- 3. A probe that can raise must be wrapped in its own BEGIN/EXCEPTION, or one
--    raise discards every result recorded before it.
--
-- STAGE 8 NOTE: `package_price` became `purchase_total` in migration 0013, and
-- `package_count` joined it (defaulting to 1). Every purchase below is a single
-- package, so the arithmetic these checks assert is unchanged — only the column
-- name is.
--
-- Run:  every statement below, in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table p(ord int, area text, check_name text, expected text, actual text)
  on commit drop;
grant insert, select on p to authenticated, anon;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pa@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pb@test.invalid');

-- A and B both have a material under the SAME key, at different prices. This
-- is the case that would collide if uniqueness were on `key` alone.
insert into public.ingredient_catalog
  (owner_id, key, name, purchase_unit, package_qty, purchase_total, supplier, allergens)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','חמאה','חמאה 82%','g',200,8.90,'תנובה',array['חלב']),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','חמאה','חמאה שלי','kg',1,125,'סודי',array['חלב']);

do $$
declare
  a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  rid uuid; snap jsonb; n int; txt text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- ── requirement 6: isolation ──────────────────────────────────────────
  select count(*) into n from public.ingredient_catalog;
  insert into p values (1,'req 6','A, unfiltered, sees only A''s materials','1', n::text);

  select coalesce(string_agg(trim_scale(price)::text, ','), '(none)') into txt
    from public.ingredient_catalog where owner_id = b;
  insert into p values (2,'req 6','A cannot read B''s PRICE','(none)', txt);

  select coalesce(string_agg(supplier, ','), '(none)') into txt
    from public.ingredient_catalog where supplier = 'סודי';
  insert into p values (3,'req 6','A cannot read B''s SUPPLIER','(none)', txt);

  update public.ingredient_catalog set purchase_total = 1 where owner_id = b;
  get diagnostics n = row_count;
  insert into p values (4,'req 6','A''s UPDATE of B''s material matches no row','0', n::text);

  delete from public.ingredient_catalog where owner_id = b;
  get diagnostics n = row_count;
  insert into p values (5,'req 6','A''s DELETE of B''s material matches no row','0', n::text);

  begin
    insert into public.ingredient_catalog
      (owner_id, key, name, purchase_unit, package_qty, purchase_total)
    values (b, 'נשתל', 'נשתל אצל ב', 'kg', 1, 5);
    insert into p values (6,'req 6','A cannot plant a material in B''s centre','refused','INSERTED');
  exception when others then
    insert into p values (6,'req 6','A cannot plant a material in B''s centre','refused','refused');
  end;

  -- ── requirement 3: the package arithmetic is the DATABASE's ──────────
  select trim_scale(price)::text || ' / ' || price_unit into txt
    from public.ingredient_catalog where owner_id = a;
  insert into p values (7,'req 3','a 200 g pack at 8.90 is 44.50 per kilo','44.5 / ק"ג', txt);

  begin
    update public.ingredient_catalog set price = 999 where owner_id = a;
    insert into p values (8,'req 3','the derived price cannot be written by a client','refused','WRITTEN');
  exception when others then
    insert into p values (8,'req 3','the derived price cannot be written by a client','refused','refused');
  end;

  -- ── requirement 2: the recipe stores no price and inherits ───────────
  rid := public.save_recipe('{"name":"בריוש","sale_price":40}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ord',0,'name','חמאה 82%','ingredient_key','חמאה','qty',250,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb, null, null, '');

  select count(*) into n from public.ingredients where recipe_id = rid and price is null;
  insert into p values (9,'req 2','the recipe row stores NO price of its own','1', n::text);

  select count(*) into n from public.recipes_pricing_on('חמאה');
  insert into p values (10,'req 5','and the centre knows the recipe is affected','1', n::text);

  -- ── requirement 5: the version freezes the price it used ────────────
  perform public.save_recipe('{"name":"בריוש 2","sale_price":40}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ord',0,'name','חמאה 82%','ingredient_key','חמאה','qty',260,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'שונתה כמות');

  select snapshot into snap from public.recipe_versions
   where recipe_id = rid and tag = 'V1';                    -- by TAG, see trap 2
  insert into p values (11,'req 5','the snapshot froze the RESOLVED price','44.5',
    trim_scale((snap->'ingredients'->0->>'price')::numeric)::text);
  insert into p values (12,'req 5','and its unit','ק"ג', (snap->'ingredients'->0->>'price_unit'));

  update public.ingredient_catalog set purchase_total = 17.80 where owner_id = a;
  select trim_scale(price)::text into txt from public.ingredient_catalog where owner_id = a;
  insert into p values (13,'req 2','the central price moved','89', txt);

  select snapshot into snap from public.recipe_versions where recipe_id = rid and tag = 'V1';
  insert into p values (14,'req 5','the VERSION did not move with it','44.5',
    trim_scale((snap->'ingredients'->0->>'price')::numeric)::text);
  select count(*) into n from public.ingredients where recipe_id = rid and price is null;
  insert into p values (15,'req 2','and the live row still stores no price','1', n::text);

  -- ── requirement 8: NULL vs 0, in the catalog ────────────────────────
  insert into public.ingredient_catalog
    (owner_id, key, name, purchase_unit, package_qty, purchase_total)
  values (a,'מלח','מלח','kg',1,null), (a,'מים','מים','l',1,0);

  select coalesce(trim_scale(price)::text,'null') into txt
    from public.ingredient_catalog where owner_id = a and key = 'מלח';
  insert into p values (16,'req 8','an unpriced material has NO price, not 0','null', txt);
  select coalesce(trim_scale(price)::text,'null') into txt
    from public.ingredient_catalog where owner_id = a and key = 'מים';
  insert into p values (17,'req 8','and an explicit 0 is a price of zero','0', txt);

  -- ── an override of 0 in a RECIPE ────────────────────────────────────
  perform public.save_recipe('{"name":"בריוש 3","sale_price":40}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','חמאה 82%','ingredient_key','חמאה',
      'qty',260,'unit','גרם','price',0,'price_unit','ק"ג')),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'מחיר מפורש 0');

  select coalesce(trim_scale(price)::text,'null') into txt
    from public.ingredients where recipe_id = rid;
  insert into p values (18,'req 8','a recipe''s explicit 0 is stored as 0, not replaced','0', txt);
  select count(*) into n from public.recipes_pricing_on('חמאה');
  insert into p values (19,'req 5','and the centre stops claiming that recipe is affected','0', n::text);

  -- One more save, so a snapshot is taken OF the overriding state (trap 1).
  perform public.save_recipe('{"name":"בריוש 4","sale_price":40}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','חמאה 82%','ingredient_key','חמאה',
      'qty',260,'unit','גרם','price',0,'price_unit','ק"ג')),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'שוב');
  select snapshot into snap from public.recipe_versions where recipe_id = rid and tag = 'V3';
  insert into p values (20,'req 8','a snapshot of that state freezes 0, not the central price','0',
    coalesce(trim_scale((snap->'ingredients'->0->>'price')::numeric)::text,'null'));

  -- ── a material priced nowhere must stay NULL in the snapshot ────────
  -- Otherwise an unpriced recipe would acquire a cost retroactively.
  perform public.save_recipe('{"name":"בצק"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','שמרים טריים',
      'ingredient_key','שמרים','qty',15,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'הוחלף');
  perform public.save_recipe('{"name":"בצק 2"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','שמרים טריים',
      'ingredient_key','שמרים','qty',20,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'שוב');
  select snapshot into snap from public.recipe_versions where recipe_id = rid and tag = 'V5';
  insert into p values (21,'req 8','an unpriced material stays NULL in the snapshot','true',
    ((snap->'ingredients'->0->'price') = 'null'::jsonb)::text);

  -- ── B's side ────────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.ingredient_catalog;
  insert into p values (22,'req 6','B sees only B''s own material','1', n::text);
  select trim_scale(price)::text into txt from public.ingredient_catalog;
  insert into p values (23,'req 6','at B''s own price','125', txt);
  select count(*) into n from public.recipes_pricing_on('חמאה');
  insert into p values (24,'req 6','recipes_pricing_on tells B nothing about A''s recipes','0', n::text);

  -- ── anon ────────────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.ingredient_catalog;
    insert into p values (25,'anon','an unauthenticated caller sees no material','0', n::text);
  exception when others then
    insert into p values (25,'anon','an unauthenticated caller sees no material','0',
      'refused: ' || SQLSTATE);
  end;
  begin
    perform * from public.recipes_pricing_on('חמאה');
    insert into p values (26,'anon','and cannot call recipes_pricing_on','refused','CALLED');
  exception when others then
    insert into p values (26,'anon','and cannot call recipes_pricing_on','refused','refused');
  end;

  execute 'reset role';
  perform set_config('p.note','probes complete',true);
exception when others then
  execute 'reset role';
  perform set_config('p.note','FAILED: ' || SQLERRM, true);
end $$;

set constraints all deferred;
delete from auth.users;

insert into p select 100,'cleanup','no fixture row left','0',
  ((select count(*) from auth.users) + (select count(*) from public.recipes)
 + (select count(*) from public.ingredients) + (select count(*) from public.recipe_versions)
 + (select count(*) from public.ingredient_catalog) + (select count(*) from public.profiles))::text;

select ord, area, check_name, expected, actual, expected = actual as pass from p order by ord;
