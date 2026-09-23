-- ─────────────────────────────────────────────────────────────────────────────
-- Professional costing, against real Postgres (stage-8 requirements A-I)
--
-- What it asks the database, rather than the client:
--   · the purchase arithmetic, which lives in GENERATED columns — every shape
--     requirement A names, plus the ones that must produce NO price
--   · that the usable cost and the purchase cost are different numbers, and
--     that "no yield declared" is not "nothing usable"
--   · that a new price APPENDS to the history instead of replacing it, and
--     that the active price is unambiguously the catalog row
--   · that the costing and sale fields survive a save and a restore — the
--     defect migration 0014 fixed
--   · that a historical version keeps the price it was taken with, after the
--     material has been re-priced twice
--   · that one account cannot read, write or infer another's purchases,
--     suppliers, totals or costs, INCLUDING through the RPCs by hand
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED — the role is switched to
-- `authenticated` with `request.jwt.claims` set, which is what PostgREST does
-- for a signed-in request. As the table owner, `postgres` bypasses RLS, so a
-- probe that forgets the switch reports perfect isolation while testing nothing.
--
-- THE TRAPS, ALL OF WHICH HAVE BITTEN THIS SUITE BEFORE
--
-- 1. A version holds the state BEFORE the save that created it. Asserting on
--    "the version this save produced" reads the PREVIOUS state.
-- 2. `now()` is the TRANSACTION timestamp, so every version created here shares
--    one `created_at`. Versions are selected by TAG, never by time.
-- 3. A probe that can raise must be wrapped in its own BEGIN/EXCEPTION, or the
--    rollback of that subtransaction discards every `set_config` with it — and
--    then every later check runs as the wrong role and reports nonsense.
-- 4. `set constraints all immediate` persists for the whole transaction, which
--    is why the cleanup below sets them deferred again before deleting users.
--
-- Run:  every statement below, in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table p(ord int, area text, check_name text, expected text, actual text)
  on commit drop;
grant insert, select on p to authenticated, anon;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ca@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb@test.invalid');

do $$
declare
  a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  rid uuid; vid uuid; n int; v numeric; txt text; r record; snap jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- ── requirement A: the four purchase shapes ───────────────────────────
  perform public.record_purchase('קמח','קמח לחם','kg',1,5,200,null,'שק','2026-06-01','');
  perform public.record_purchase('סוכר','סוכר לבן','g',6,500,72,null,'','2026-06-01','');
  perform public.record_purchase('ביצים','ביצים L','unit',1,30,39,null,'','2026-06-01','');
  perform public.record_purchase('חלב','חלב 3%','l',12,1,180,null,'','2026-06-01','');

  -- One check per shape rather than one aggregate: Hebrew collation ordering
  -- is not something this suite should be asserting by accident.
  select trim_scale(price)::text || ' ' || price_unit into txt
    from public.ingredient_catalog where owner_id = a and key = 'קמח';
  insert into p values (1,'A','5 kg for 200 is 40 per kilo','40 ק"ג', txt);

  select trim_scale(price)::text || ' ' || price_unit into txt
    from public.ingredient_catalog where owner_id = a and key = 'סוכר';
  insert into p values (2,'A','6 packs of 500 g for a total of 72 is 24 per kilo',
    '24 ק"ג', txt);

  select trim_scale(price)::text || ' ' || price_unit into txt
    from public.ingredient_catalog where owner_id = a and key = 'ביצים';
  insert into p values (3,'A','30 eggs for 39 is 1.30 per egg','1.3 יח''', txt);

  select trim_scale(price)::text || ' ' || price_unit into txt
    from public.ingredient_catalog where owner_id = a and key = 'חלב';
  insert into p values (4,'A','12 bottles of 1 L for 180 is 15 per litre',
    '15 ליטר', txt);

  -- and the total quantity each of them normalises to
  select trim_scale(public.purchase_base_qty('g', 6, 500))::text into txt;
  insert into p values (5,'A','6 × 500 g is 3 kg','3', txt);

  -- 5 kg for 200 → 4 per 100 g → 0.04 per gram, all one number rescaled
  select trim_scale(round(price/10, 6))::text || ' / ' || trim_scale(round(price/1000, 6))::text
    into txt from public.ingredient_catalog where owner_id = a and key = 'קמח';
  insert into p values (6,'B','the same price at 100 g and 1 g scale','4 / 0.04', txt);

  -- ── requirement A: what must produce NO price ─────────────────────────
  perform public.record_purchase('חינם','שק במתנה','kg',1,5,0,null,'','2026-06-01','');
  perform public.record_purchase('ללא','בלי מחיר','kg',1,5,null,null,'','2026-06-01','');

  select coalesce(trim_scale(price)::text,'NULL') into txt
    from public.ingredient_catalog where owner_id = a and key = 'חינם';
  insert into p values (7,'A','a purchase of 0 is a price of zero','0', txt);

  select coalesce(trim_scale(price)::text,'NULL') into txt
    from public.ingredient_catalog where owner_id = a and key = 'ללא';
  insert into p values (8,'A','a purchase with no total has NO price','NULL', txt);

  -- a package of nothing, and zero packages: refused by the CHECK, not
  -- silently turned into a division by zero
  begin
    perform public.record_purchase('רע','רע','kg',1,0,100,null,'','2026-06-01','');
    insert into p values (9,'A','a package of nothing is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (9,'A','a package of nothing is refused','refused','refused');
  end;
  begin
    perform public.record_purchase('רע2','רע','kg',0,5,100,null,'','2026-06-01','');
    insert into p values (10,'A','zero packages is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (10,'A','zero packages is refused','refused','refused');
  end;

  -- ── requirement D: purchase cost is not usable cost ───────────────────
  perform public.record_purchase('סלרי','סלרי','kg',1,10,200,80,'','2026-06-01','');
  select trim_scale(purchase_price)::text || ' / ' || trim_scale(price)::text into txt
    from public.ingredient_catalog where owner_id = a and key = 'סלרי';
  insert into p values (11,'D','10 kg for 200 at 80% usable: buy 20, use 25','20 / 25', txt);

  perform public.record_purchase('גזר','גזר','kg',1,10,200,100,'','2026-06-01','');
  select trim_scale(purchase_price)::text || ' / ' || trim_scale(price)::text into txt
    from public.ingredient_catalog where owner_id = a and key = 'גזר';
  insert into p values (12,'D','100% usable is the same as no waste','20 / 20', txt);

  select trim_scale(purchase_price)::text || ' / ' || trim_scale(price)::text into txt
    from public.ingredient_catalog where owner_id = a and key = 'קמח';
  insert into p values (13,'D','no declared yield: the two costs are equal','40 / 40', txt);

  begin
    perform public.record_purchase('פחת0','פחת','kg',1,10,200,0,'','2026-06-01','');
    insert into p values (14,'D','a yield of 0% is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (14,'D','a yield of 0% is refused','refused','refused');
  end;
  begin
    perform public.record_purchase('פחת120','פחת','kg',1,10,200,120,'','2026-06-01','');
    insert into p values (15,'D','a yield above 100% is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (15,'D','a yield above 100% is refused','refused','refused');
  end;

  -- ── requirement C: history, not overwrite ─────────────────────────────
  -- Butter, three times, from two suppliers.
  perform public.record_purchase('חמאה','חמאה 82%','kg',1,1,36,null,'תנובה','2026-06-01','');
  perform public.record_purchase('חמאה','חמאה 82%','kg',1,1,45,null,'טרה','2026-07-01','');
  perform public.record_purchase('חמאה','חמאה 82%','kg',1,1,40.5,null,'טרה','2026-08-01','');

  select count(*) into n from public.ingredient_purchases
   where owner_id = a and key = 'חמאה';
  insert into p values (16,'C','every purchase is kept','3', n::text);

  select trim_scale(price)::text || ' ' || supplier into txt
    from public.ingredient_catalog where owner_id = a and key = 'חמאה';
  insert into p values (17,'C','the ACTIVE price is the catalog row: the latest',
    '40.5 טרה', txt);

  select string_agg(trim_scale(h.price)::text || '@' || h.purchased_at::text, ' | '
                    order by h.purchased_at desc)
    into txt from public.purchase_history('חמאה') h;
  insert into p values (18,'C','the history reads newest first',
    '40.5@2026-08-01 | 45@2026-07-01 | 36@2026-06-01', txt);

  select string_agg(coalesce(trim_scale(round(h.pct_change,1))::text,'NULL'), ' | '
                    order by h.purchased_at)
    into txt from public.purchase_history('חמאה') h;
  -- 36 → 45 is +25%, 45 → 40.5 is −10%, and the first has no previous price
  insert into p values (19,'C','the change from the purchase before it',
    'NULL | 25 | -10', txt);

  select string_agg(h.supplier, ' | ' order by h.purchased_at) into txt
    from public.purchase_history('חמאה') h;
  insert into p values (20,'C','the supplier of each purchase',
    'תנובה | טרה | טרה', txt);

  -- A change with no previous price gives no percentage rather than a made-up
  -- one: free, then not free.
  perform public.record_purchase('מים','מים','l',1,1,0,null,'','2026-06-01','');
  perform public.record_purchase('מים','מים','l',1,1,2,null,'','2026-07-01','');
  select coalesce(trim_scale(h.pct_change)::text,'NULL') into txt
    from public.purchase_history('מים') h where h.purchased_at = '2026-07-01';
  insert into p values (21,'C','no ratio from a previous price of 0','NULL', txt);

  -- ── requirements E, F: the costing fields survive a save ──────────────
  rid := public.save_recipe(
    jsonb_build_object('name','בריוש','sale_price',40,'sale_price_basis','unit',
                       'packaging_cost',2,'labor_cost',10,'other_cost',0,
                       'target_fc',30,'target_gm',60,'yield_units',2,'unit_weight',125),
    jsonb_build_array(jsonb_build_object(
      'name','חמאה 82%','ingredient_key','חמאה','qty',250,'unit','g','price',null)),
    '[]'::jsonb, '[]'::jsonb);

  select sale_price, sale_price_basis, packaging_cost, labor_cost, other_cost, target_gm
    into r from public.recipes where id = rid;
  insert into p values (22,'E','save_recipe persists the costing fields',
    '40|unit|2|10|0|60',
    format('%s|%s|%s|%s|%s|%s', trim_scale(r.sale_price), r.sale_price_basis,
           trim_scale(r.packaging_cost), trim_scale(r.labor_cost),
           trim_scale(r.other_cost), trim_scale(r.target_gm)));

  -- NULL stays NULL. This is the whole of requirement H at the column level:
  -- "not entered" must not arrive as 0 and make a total look complete.
  perform public.save_recipe(
    jsonb_build_object('name','בריוש','sale_price',40,'sale_price_basis','unit',
                       'labor_cost',10,'yield_units',2,'unit_weight',125),
    jsonb_build_array(jsonb_build_object(
      'name','חמאה 82%','ingredient_key','חמאה','qty',250,'unit','g','price',null)),
    '[]'::jsonb, '[]'::jsonb, rid, null, 'בלי עלות אריזה');
  select coalesce(trim_scale(packaging_cost)::text,'NULL') || '|' ||
         coalesce(trim_scale(labor_cost)::text,'NULL') into txt
    from public.recipes where id = rid;
  insert into p values (23,'H','an unentered cost stays NULL, an entered 0 stays 0',
    'NULL|10', txt);

  -- ── requirement C + Recipe Versions: history stays true ───────────────
  -- V1 holds the state before the second save — when packaging WAS 2 and the
  -- butter was still ₪40.50. Selected by tag, never by time.
  select id, snapshot into vid, snap from public.recipe_versions
   where recipe_id = rid and tag = 'V1';
  insert into p values (24,'C','the version froze the costing fields it had',
    '2', coalesce(trim_scale((snap->'recipe'->>'packaging_cost')::numeric)::text,'NULL'));

  insert into p values (25,'C','the version froze the price the material had then',
    '40.5', coalesce(trim_scale((snap->'ingredients'->0->>'price')::numeric)::text,'NULL'));

  -- Now the butter changes again. The live recipe must move; the version
  -- must not.
  perform public.record_purchase('חמאה','חמאה 82%','kg',1,1,60,null,'טרה','2026-09-01','');
  select snapshot into snap from public.recipe_versions where id = vid;
  insert into p values (26,'C','a later purchase does not rewrite an old version',
    '40.5', coalesce(trim_scale((snap->'ingredients'->0->>'price')::numeric)::text,'NULL'));

  select (public.recipe_snapshot(rid)->'ingredients'->0->>'price')::numeric into v;
  insert into p values (27,'C','but the live recipe is at the new price',
    '60', trim_scale(v)::text);

  -- ── requirement E/F through a restore (the 0014 fix) ──────────────────
  perform public.restore_recipe_version(vid);
  select coalesce(trim_scale(packaging_cost)::text,'NULL') || '|' ||
         trim_scale(sale_price)::text || '|' || sale_price_basis into txt
    from public.recipes where id = rid;
  insert into p values (28,'E','restore brings the costing fields back',
    '2|40|unit', txt);

  -- ── requirement I: isolation ──────────────────────────────────────────
  -- ── the price-update date (0016/0017) ─────────────────────────────────
  -- `now()` is the TRANSACTION timestamp, so two stamps set in this one
  -- transaction are equal and cannot be compared. An explicit old value is
  -- planted instead, and the question becomes "was it overwritten" — the
  -- first version of this check compared two identical timestamps and
  -- reported a working trigger as broken.
  update public.ingredient_catalog set price_updated_at = '2020-01-01'
   where owner_id = a and key = 'קמח';
  update public.ingredient_catalog set name = 'קמח לחם כוסמין'
   where owner_id = a and key = 'קמח';
  insert into p select 29,'C','a rename does not move the price-update date','true',
    (price_updated_at = '2020-01-01'::timestamptz)::text
    from public.ingredient_catalog where owner_id = a and key = 'קמח';

  update public.ingredient_catalog set price_updated_at = '2020-01-01'
   where owner_id = a and key = 'קמח';
  update public.ingredient_catalog set usable_pct = 80
   where owner_id = a and key = 'קמח';
  insert into p select 291,'D','a change to the yield does move it, and the price','true|50',
    (price_updated_at > '2020-01-01'::timestamptz)::text || '|' || trim_scale(price)::text
    from public.ingredient_catalog where owner_id = a and key = 'קמח';

  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);

  select count(*) into n from public.ingredient_purchases;
  insert into p values (30,'I','B sees none of A''s purchases','0', n::text);

  select count(*) into n from public.purchase_history('חמאה');
  insert into p values (31,'I','B gets nothing from purchase_history on A''s key',
    '0', n::text);

  select count(*) into n from public.ingredient_catalog where owner_id = a;
  insert into p values (32,'I','B sees none of A''s materials','0', n::text);

  -- B records the same key. It must become B's own material at B's own price,
  -- and A's must not move by a shekel.
  perform public.record_purchase('חמאה','חמאה שלי','kg',1,1,125,null,'סודי','2026-09-01','');
  select count(*) into n from public.ingredient_purchases;
  insert into p values (33,'I','B''s own purchase is B''s, and only that one','1', n::text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  select trim_scale(price)::text || ' ' || supplier into txt
    from public.ingredient_catalog where owner_id = a and key = 'חמאה';
  insert into p values (34,'I','A''s price and supplier are untouched','60 טרה', txt);

  select count(*) into n from public.purchase_history('חמאה');
  insert into p values (35,'I','and A''s history holds only A''s purchases','4', n::text);

  -- Writing another account's owner_id by hand: refused by the WITH CHECK.
  begin
    insert into public.ingredient_purchases
      (owner_id, key, purchase_unit, package_count, package_qty, purchase_total)
    values (b, 'חמאה', 'kg', 1, 1, 999);
    insert into p values (36,'I','A cannot write a purchase as B','refused','ACCEPTED');
  exception when others then
    insert into p values (36,'I','A cannot write a purchase as B','refused','refused');
  end;

  -- A generated column cannot be written at all, by anyone. This is what
  -- keeps ₪/kg from ever disagreeing with the receipt.
  begin
    insert into public.ingredient_purchases
      (owner_id, key, purchase_unit, package_count, package_qty, purchase_total, price)
    values (a, 'זיוף', 'kg', 1, 1, 10, 0.01);
    insert into p values (37,'B','a derived price cannot be written','refused','ACCEPTED');
  exception when others then
    insert into p values (37,'B','a derived price cannot be written','refused','refused');
  end;

  -- ── anon ──────────────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.ingredient_purchases;
    insert into p values (40,'I','an unauthenticated caller sees no purchase','0', n::text);
  exception when others then
    insert into p values (40,'I','an unauthenticated caller sees no purchase','0',
      'refused: ' || SQLSTATE);
  end;
  begin
    perform * from public.purchase_history('חמאה');
    insert into p values (41,'I','and cannot call purchase_history','refused','CALLED');
  exception when others then
    insert into p values (41,'I','and cannot call purchase_history','refused','refused');
  end;
  begin
    perform public.record_purchase('פריצה','x','kg',1,1,1,null,'','2026-09-01','');
    insert into p values (42,'I','and cannot record a purchase','refused','CALLED');
  exception when others then
    insert into p values (42,'I','and cannot record a purchase','refused','refused');
  end;

  execute 'reset role';
  perform set_config('p.note','probes complete',true);
exception when others then
  execute 'reset role';
  perform set_config('p.note','FAILED: ' || SQLERRM, true);
end $$;

insert into p select 99,'run','the probe block ran to the end','probes complete',
  coalesce(nullif(current_setting('p.note', true), ''), 'NEVER SET');

set constraints all deferred;
delete from auth.users;

insert into p select 100,'cleanup','no fixture row left','0',
  ((select count(*) from auth.users) + (select count(*) from public.recipes)
 + (select count(*) from public.ingredients) + (select count(*) from public.recipe_versions)
 + (select count(*) from public.ingredient_catalog)
 + (select count(*) from public.ingredient_purchases)
 + (select count(*) from public.profiles))::text;

select ord, area, check_name, expected, actual, expected = actual as pass from p order by ord;
