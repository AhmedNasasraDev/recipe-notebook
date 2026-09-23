-- ─────────────────────────────────────────────────────────────────────────────
-- Production planning, against real Postgres (stage-9 requirements 1, 5, 11-14)
--
-- What it asks the DATABASE, rather than the client:
--   · that a plan round-trips: its lines, their units, their ready times, and
--     an on-hand figure that is 0 as opposed to absent
--   · that a plan line cannot point at another account's recipe, with the id
--     supplied by hand, straight at the table
--   · that `locked` and `snapshot` cannot come apart — the CHECK refuses a
--     lock with no snapshot and a snapshot with no lock
--   · that a locked plan cannot be edited — not through the RPC and not
--     through any direct path at the three tables — and that unlocking clears
--     the freeze
--   · that a cycle of sub-recipes is still impossible, so the dependency walk
--     the timeline does cannot loop
--   · that one account cannot read, write, or delete another's plans, their
--     lines, or what they have in the store room
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED — the role is switched to
-- `authenticated` with `request.jwt.claims` set, which is what PostgREST does
-- for a signed-in request. As the table owner, `postgres` bypasses RLS, so a
-- probe that forgets the switch reports perfect isolation while testing nothing.
--
-- THE TRAPS, from the earlier suites and still live here:
--   1. `now()` is the TRANSACTION timestamp, so two timestamps set in this one
--      transaction are EQUAL. Nothing below compares them.
--   2. A probe that can raise must be wrapped in its own BEGIN/EXCEPTION, or
--      the rollback of that subtransaction discards every `set_config` before
--      it and every later check runs as the wrong role.
--   3. `numeric(12,3)` renders as '0.000'. Every number is `trim_scale`d.
--
-- Run:  every statement below, in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table p(ord int, area text, check_name text, expected text, actual text)
  on commit drop;
grant insert, select on p to authenticated, anon;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'plan-a@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'plan-b@test.invalid');

do $$
declare
  a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  ra uuid; rsub uuid; rb uuid; pid uuid; n int; txt text;
  rtmp uuid; ptmp uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- A base recipe and a product that uses it, so the dependency chain is real.
  rsub := public.save_recipe('{"name":"בצק פריך","is_sub":true}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ord',0,'name','קמח לבן','ingredient_key','קמח לבן','qty',1000,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb);
  ra := public.save_recipe(
    '{"name":"עוגיות ריבה","yield_units":20,"unit_weight":50}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ord',0,'name','בצק פריך','qty',1000,'unit','גרם','sub_recipe_id',rsub)),
    jsonb_build_array(
      jsonb_build_object('ord',0,'text','קירור','minutes',480,'kind','chill'),
      jsonb_build_object('ord',1,'text','אפייה','minutes',20,'temp',180,'kind','bake')),
    '[]'::jsonb);

  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);
  rb := public.save_recipe('{"name":"הסוד של ב"}'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);

  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);

  -- ── requirement 8: the step kind round-trips ──────────────────────────
  select string_agg(coalesce(kind,'NULL'), ',' order by ord) into txt
    from public.steps where recipe_id = ra;
  insert into p values (1,'8','a step keeps the kind it was saved with',
    'chill,bake', txt);

  -- ── requirements 1, 13: the plan round-trips ──────────────────────────
  pid := public.save_production_plan(
    jsonb_build_object('name','שישי','plan_date','2026-10-02','note','הכול לבוקר'),
    jsonb_build_array(jsonb_build_object(
      'recipe_id', ra, 'qty', 60, 'qty_unit','unit','ready_at','08:00','note','ארגז')),
    jsonb_build_array(
      jsonb_build_object('key','קמח לבן','on_hand','4'),
      jsonb_build_object('key','חמאה','on_hand','0'),
      jsonb_build_object('key','סוכר','on_hand','')),
    null, null);

  select format('%s|%s|%s|%s|%s',
                trim_scale(qty), qty_unit, ready_at::text, note,
                (select trim_scale(count(*)) from public.production_plan_items
                  where plan_id = pid))
    into txt from public.production_plan_items where plan_id = pid;
  insert into p values (2,'1','the line keeps its quantity, unit, hour and note',
    '60|unit|08:00:00|ארגז|1', txt);

  select name || '|' || plan_date::text || '|' || note into txt
    from public.production_plans where id = pid;
  insert into p values (3,'13','and the plan keeps its own fields',
    'שישי|2026-10-02|הכול לבוקר', txt);

  -- ── requirement 5: 0 is a real quantity, blank is not ────────────────
  select coalesce(trim_scale(on_hand)::text,'NULL') into txt
    from public.production_plan_stock where plan_id = pid and key = 'קמח לבן';
  insert into p values (4,'5','an entered on-hand figure is kept','4', txt);
  select coalesce(trim_scale(on_hand)::text,'NULL') into txt
    from public.production_plan_stock where plan_id = pid and key = 'חמאה';
  insert into p values (5,'5','an entered 0 stays 0','0', txt);
  select coalesce(trim_scale(on_hand)::text,'NULL') into txt
    from public.production_plan_stock where plan_id = pid and key = 'סוכר';
  insert into p values (6,'5','a blank field stays NULL, not 0','NULL', txt);

  -- ── the table's own constraints ──────────────────────────────────────
  begin
    insert into public.production_plan_items (plan_id, recipe_id, qty)
    values (pid, ra, 0);
    insert into p values (7,'1','a target of zero is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (7,'1','a target of zero is refused','refused','refused');
  end;
  begin
    insert into public.production_plan_items (plan_id, recipe_id, qty, qty_unit)
    values (pid, ra, 1, 'litre');
    insert into p values (8,'1','an unknown target unit is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (8,'1','an unknown target unit is refused','refused','refused');
  end;
  begin
    insert into public.production_plan_stock (plan_id, key, on_hand)
    values (pid, 'שלילי', -1);
    insert into p values (9,'5','a negative on-hand figure is refused','refused','ACCEPTED');
  exception when others then
    insert into p values (9,'5','a negative on-hand figure is refused','refused','refused');
  end;

  -- ── requirement 13: a line may not point at another account's recipe ──
  -- Straight at the table, with the id supplied by hand. RLS admits the row
  -- (the PLAN is A's) and the foreign key is satisfied (B's recipe exists),
  -- so without the 0018 trigger this succeeds.
  begin
    insert into public.production_plan_items (plan_id, recipe_id, qty)
    values (pid, rb, 1);
    insert into p values (10,'13','a line cannot point at B''s recipe',
      'refused: 42501','ACCEPTED');
  exception when others then
    insert into p values (10,'13','a line cannot point at B''s recipe',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    update public.production_plan_items set recipe_id = rb where plan_id = pid;
    insert into p values (11,'13','nor be UPDATED into pointing at it',
      'refused: 42501','ACCEPTED');
  exception when others then
    insert into p values (11,'13','nor be UPDATED into pointing at it',
      'refused: 42501','refused: ' || SQLSTATE);
  end;

  -- ── requirement 14: locked and snapshot move together ────────────────
  begin
    perform public.set_plan_locked(pid, true, null);
    insert into p values (12,'14','locking without a snapshot is refused',
      'refused','ACCEPTED');
  exception when others then
    insert into p values (12,'14','locking without a snapshot is refused',
      'refused','refused');
  end;
  begin
    -- Refused twice over since 0021: the guard answers first (a snapshot is
    -- written only by the lock transition) and the CHECK behind it still
    -- refuses a snapshot on an unlocked row.
    update public.production_plans set snapshot = '{"x":1}'::jsonb where id = pid;
    insert into p values (13,'14','a snapshot cannot be set without a lock',
      'refused','ACCEPTED');
  exception when others then
    insert into p values (13,'14','a snapshot cannot be set without a lock',
      'refused','refused');
  end;

  perform public.set_plan_locked(pid, true,
    jsonb_build_object('at','2026-10-02','total',80,'level','full','lines','[]'::jsonb));
  -- `format('%s', a boolean)` prints 't', not 'true'. Cast, so the expected
  -- value in this file reads like the thing it is asserting.
  select format('%s|%s|%s', locked::text, (snapshot is not null)::text,
                trim_scale((snapshot->>'total')::numeric))
    into txt from public.production_plans where id = pid;
  insert into p values (14,'14','a locked plan carries its frozen figures',
    'true|true|80', txt);

  begin
    perform public.save_production_plan('{"name":"שינוי"}'::jsonb,
      '[]'::jsonb, '[]'::jsonb, pid, null);
    insert into p values (15,'14','a locked plan cannot be edited','refused','ACCEPTED');
  exception when others then
    insert into p values (15,'14','a locked plan cannot be edited','refused','refused');
  end;

  perform public.set_plan_locked(pid, false);
  select format('%s|%s', locked::text, (snapshot is null)::text) into txt
    from public.production_plans where id = pid;
  insert into p values (16,'14','unlocking clears the freeze','false|true', txt);

  -- ── stage-10 audit, §7: the freeze is enforced by the DATABASE ───────
  --
  -- Until 0021 the rule "a locked plan is a record and cannot be edited"
  -- lived in exactly one place: the `if v_locked then raise` inside
  -- `save_production_plan`. Probe 15 above passed, and six other paths
  -- straight at the tables succeeded — the owner's own session, holding
  -- nothing but the anon key and its JWT, could rename a locked plan,
  -- rewrite its frozen snapshot, unlock it without clearing the freeze, add
  -- a line to it, change its lines and delete its stock. Every one of them
  -- must now be refused with 42501, and the row must come out of the
  -- attempt byte for byte as it went in.
  perform public.set_plan_locked(pid, true,
    jsonb_build_object('at','2026-10-02','total',80,'level','full'));

  begin
    update public.production_plans set name = 'נחטף' where id = pid;
    get diagnostics n = row_count;
    insert into p values (50,'7','a direct UPDATE of a locked plan is refused',
      'refused: 42501', n || ' rows changed');
  exception when others then
    insert into p values (50,'7','a direct UPDATE of a locked plan is refused',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    update public.production_plans set snapshot = jsonb_build_object('total',1)
     where id = pid;
    get diagnostics n = row_count;
    insert into p values (51,'7','the frozen snapshot cannot be rewritten',
      'refused: 42501', n || ' rows changed');
  exception when others then
    insert into p values (51,'7','the frozen snapshot cannot be rewritten',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    update public.production_plans set locked = false, snapshot = null where id = pid;
    get diagnostics n = row_count;
    insert into p values (52,'7','and it cannot be unlocked behind the RPC''s back',
      'refused: 42501', n || ' rows changed');
  exception when others then
    insert into p values (52,'7','and it cannot be unlocked behind the RPC''s back',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    insert into public.production_plan_items (plan_id, recipe_id, ord, qty, qty_unit)
    values (pid, ra, 9, 99, 'unit');
    get diagnostics n = row_count;
    insert into p values (53,'7','no line can be added to a locked plan',
      'refused: 42501', n || ' rows added');
  exception when others then
    insert into p values (53,'7','no line can be added to a locked plan',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    update public.production_plan_items set qty = 999 where plan_id = pid;
    get diagnostics n = row_count;
    insert into p values (54,'7','nor any of its lines changed',
      'refused: 42501', n || ' rows changed');
  exception when others then
    insert into p values (54,'7','nor any of its lines changed',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    -- The one that first came back as 42703 rather than 42501: `old.recipe_id`
    -- in the guard's condition, resolved on the table that has no such column.
    -- Refused, and for the wrong reason. The expected SQLSTATE below is the
    -- whole point of writing it down.
    delete from public.production_plan_stock where plan_id = pid;
    get diagnostics n = row_count;
    insert into p values (55,'7','nor its store-room figures deleted',
      'refused: 42501', n || ' rows removed');
  exception when others then
    insert into p values (55,'7','nor its store-room figures deleted',
      'refused: 42501','refused: ' || SQLSTATE);
  end;
  begin
    insert into public.production_plans (owner_id, name, locked, snapshot)
    values (a, 'רשומה מפוברקת', true, jsonb_build_object('total',0));
    get diagnostics n = row_count;
    insert into p values (56,'7','a plan cannot be born locked, with figures never produced',
      'refused: 42501', n || ' rows added');
  exception when others then
    insert into p values (56,'7','a plan cannot be born locked, with figures never produced',
      'refused: 42501','refused: ' || SQLSTATE);
  end;

  select format('%s|%s|%s|%s', name, locked::text,
                trim_scale((snapshot->>'total')::numeric),
                (select count(*) from public.production_plan_items where plan_id = pid)::text)
    into txt from public.production_plans where id = pid;
  insert into p values (57,'7','after all of it the record is untouched',
    'שישי|true|80|1', txt);

  -- The legitimate transition is not collateral damage: the one function that
  -- owns the lock still works, in both directions.
  perform public.set_plan_locked(pid, false);
  select format('%s|%s', locked::text, (snapshot is null)::text) into txt
    from public.production_plans where id = pid;
  insert into p values (58,'7','the RPC still unlocks, and clears the freeze','false|true', txt);
  -- Re-saved with the content it already had, so the isolation probes that
  -- follow still have a line and a store-room figure to fail to reach.
  perform public.save_production_plan(
    jsonb_build_object('name','שישי','plan_date','2026-10-02','note','הכול לבוקר'),
    jsonb_build_array(jsonb_build_object(
      'recipe_id', ra, 'qty', 60, 'qty_unit','unit','ready_at','08:00','note','ארגז')),
    jsonb_build_array(
      jsonb_build_object('key','קמח לבן','on_hand','4'),
      jsonb_build_object('key','חמאה','on_hand','0'),
      jsonb_build_object('key','סוכר','on_hand','')),
    pid, null);
  select format('%s|%s|%s', name,
                (select trim_scale(count(*)) from public.production_plan_items
                  where plan_id = pid),
                (select trim_scale(count(*)) from public.production_plan_stock
                  where plan_id = pid))
    into txt from public.production_plans where id = pid;
  insert into p values (59,'7','and an unlocked plan is editable again','שישי|1|3', txt);

  -- And the cascade 0018 chose on purpose still passes the guard: deleting a
  -- RECIPE removes it from a locked plan's lines, because the record of what
  -- was produced lives in the snapshot rather than in the lines.
  rtmp := public.save_recipe('{"name":"מתכון זמני","yield_units":2,"unit_weight":100}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ord',0,'name','קמח לבן','ingredient_key','קמח לבן','qty',500,'unit','גרם')),
    '[]'::jsonb, '[]'::jsonb);
  ptmp := public.save_production_plan('{"name":"תוכנית זמנית"}'::jsonb,
    jsonb_build_array(jsonb_build_object('recipe_id', rtmp, 'qty', 2, 'qty_unit','unit')),
    '[]'::jsonb);
  perform public.set_plan_locked(ptmp, true, jsonb_build_object('total',9));
  begin
    perform public.delete_recipe(rtmp);
    select count(*) into n from public.production_plan_items where plan_id = ptmp;
    insert into p values (60,'7','deleting a recipe still cascades out of a locked plan',
      '0', n::text);
  exception when others then
    insert into p values (60,'7','deleting a recipe still cascades out of a locked plan',
      '0','refused: ' || SQLERRM);
  end;
  select format('%s|%s', locked::text, trim_scale((snapshot->>'total')::numeric)) into txt
    from public.production_plans where id = ptmp;
  insert into p values (61,'7','and the frozen record of it survives','true|9', txt);
  -- A record may be deleted; it may only not be rewritten.
  perform public.delete_production_plan(ptmp);
  select count(*) into n from public.production_plans where id = ptmp;
  insert into p values (62,'7','a locked plan can still be deleted outright','0', n::text);

  -- ── requirement 11: a cycle is still impossible ──────────────────────
  begin
    perform public.save_recipe('{"name":"בצק פריך","is_sub":true}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'ord',0,'name','עוגיות','qty',100,'unit','גרם','sub_recipe_id',ra)),
      '[]'::jsonb, '[]'::jsonb, rsub, null, 'מעגל');
    insert into p values (17,'11','a sub-recipe cycle is still refused',
      'refused: 23514','ACCEPTED');
  exception when others then
    insert into p values (17,'11','a sub-recipe cycle is still refused',
      'refused: 23514','refused: ' || SQLSTATE);
  end;

  -- ── requirement 13: isolation ────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);

  select count(*) into n from public.production_plans;
  insert into p values (20,'13','B, unfiltered, sees no plan of A''s','0', n::text);
  select count(*) into n from public.production_plan_items;
  insert into p values (21,'13','nor any plan line','0', n::text);
  select count(*) into n from public.production_plan_stock;
  insert into p values (22,'13','nor what A has in the store room','0', n::text);
  insert into p select 23,'13','nor can B ask owns_plan about it','false',
    public.owns_plan(pid)::text;

  update public.production_plans set name = 'נחטף' where id = pid;
  get diagnostics n = row_count;
  insert into p values (24,'13','B''s UPDATE of A''s plan matches no row','0', n::text);
  delete from public.production_plan_items where plan_id = pid;
  get diagnostics n = row_count;
  insert into p values (25,'13','B''s DELETE of A''s lines matches no row','0', n::text);

  begin
    insert into public.production_plans (owner_id, name) values (a, 'נשתל אצל א');
    insert into p values (26,'13','B cannot plant a plan in A''s account',
      'refused','INSERTED');
  exception when others then
    insert into p values (26,'13','B cannot plant a plan in A''s account',
      'refused','refused');
  end;

  perform public.delete_production_plan(pid);
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  select count(*) into n from public.production_plans where id = pid;
  insert into p values (27,'13','B''s delete did not touch it','1', n::text);
  select name into txt from public.production_plans where id = pid;
  insert into p values (28,'13','and its name is untouched','שישי', txt);

  -- ── A's own delete takes the children with it ────────────────────────
  perform public.delete_production_plan(pid);
  execute 'reset role';
  select (select count(*) from public.production_plans where id = pid)
       + (select count(*) from public.production_plan_items where plan_id = pid)
       + (select count(*) from public.production_plan_stock where plan_id = pid)
    into n;
  insert into p values (29,'13','A''s delete removes the plan and its children',
    '0', n::text);

  -- ── anon ─────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims','',true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.production_plans;
    insert into p values (40,'13','an unauthenticated caller sees no plan','0', n::text);
  exception when others then
    insert into p values (40,'13','an unauthenticated caller sees no plan','0',
      'refused: ' || SQLSTATE);
  end;
  begin
    perform public.save_production_plan('{"name":"x"}'::jsonb, '[]'::jsonb, '[]'::jsonb);
    insert into p values (41,'13','and cannot save one','refused','CALLED');
  exception when others then
    insert into p values (41,'13','and cannot save one','refused','refused');
  end;
  begin
    perform public.owns_plan(pid);
    insert into p values (42,'13','and cannot call owns_plan','refused','CALLED');
  exception when others then
    insert into p values (42,'13','and cannot call owns_plan','refused','refused');
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
 + (select count(*) from public.ingredients) + (select count(*) from public.steps)
 + (select count(*) from public.recipe_versions)
 + (select count(*) from public.production_plans)
 + (select count(*) from public.production_plan_items)
 + (select count(*) from public.production_plan_stock))::text;

select ord, area, check_name, expected, actual, expected = actual as pass from p order by ord;
