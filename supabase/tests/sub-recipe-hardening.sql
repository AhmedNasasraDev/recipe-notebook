-- ─────────────────────────────────────────────────────────────────────────────
-- Sub-recipe hardening (stage-6 requirements 15-18), against real Postgres
--
-- Stage 5 proved the guards once. This re-proves them after stage 6 changed the
-- delete behaviour underneath them, and adds the three cases stage 5 did not
-- cover: changing a link that already exists, restoring a version whose link is
-- no longer valid, and a chain four levels deep.
--
-- Everything runs as `authenticated` with `request.jwt.claims` set, which is
-- what PostgREST does for a signed-in request, and every write goes through the
-- same `save_recipe` / `restore_recipe_version` / `delete_recipe` functions the
-- client calls. Nothing here reaches past them.
--
-- THREE TRAPS THIS SCRIPT WALKED INTO, ALL WORTH KNOWING
--
-- 1. A probe that can raise must be wrapped in its own BEGIN/EXCEPTION. A
--    plpgsql handler rolls back the subtransaction, so one unwrapped raise
--    discards everything recorded before it.
-- 2. `delete_recipe` issues `SET CONSTRAINTS ... IMMEDIATE`, and that applies
--    to the rest of the TRANSACTION. After calling it, the deferred delete
--    guard is immediate — which blocks the account cascade at the bottom of
--    this script. Hence `set constraints all deferred` before the cleanup.
--    (Harmless in the app: PostgREST gives each request its own transaction.)
-- 3. Anything that has to be read AFTER a delete_recipe call must be captured
--    BEFORE it, for the same reason.
--
-- Run:  every statement below, in one session, and read the result table.
--       Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table h6(ord int, area text, check_name text, expected text, actual text)
  on commit drop;
grant insert, select on h6 to authenticated;

insert into auth.users (id, email) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'h-a@test.invalid'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'h-b@test.invalid');
insert into public.recipes (id, owner_id, name) values
  ('e0000000-0000-4000-8000-0000000000bb', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'הסוד של ב');

do $p$
declare
  a uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  b_recipe uuid := 'e0000000-0000-4000-8000-0000000000bb';
  base1 uuid; base2 uuid; top uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  v1 uuid;
  n int; nm text; ing_sig text; vcount int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  base1 := public.save_recipe('{"name":"בסיס א"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, '');
  base2 := public.save_recipe('{"name":"בסיס ב"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, '');
  top   := public.save_recipe('{"name":"עליון"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','מילוי','qty',100,'unit','גרם','sub_recipe_id',base1)),
    '[]'::jsonb, '[]'::jsonb, null, null, '');

  -- ── requirement 15, re-verified after the stage-6 changes ─────────────
  begin
    perform public.save_recipe('{"name":"עליון"}'::jsonb,
      jsonb_build_array(jsonb_build_object('ord',0,'name','עצמי','qty',100,'unit','גרם','sub_recipe_id',top)),
      '[]'::jsonb, '[]'::jsonb, top, null, '');
    insert into h6 values (1,'req 15','self-reference','refused: 23514','ACCEPTED');
  exception when others then
    insert into h6 values (1,'req 15','self-reference','refused: 23514','refused: ' || SQLSTATE);
  end;

  begin
    -- `top` uses base1, so base1 using `top` closes the loop
    perform public.save_recipe('{"name":"בסיס א"}'::jsonb,
      jsonb_build_array(jsonb_build_object('ord',0,'name','עליון','qty',50,'unit','גרם','sub_recipe_id',top)),
      '[]'::jsonb, '[]'::jsonb, base1, null, '');
    insert into h6 values (2,'req 15','direct cycle A->B->A','refused: 23514','ACCEPTED');
  exception when others then
    insert into h6 values (2,'req 15','direct cycle A->B->A','refused: 23514','refused: ' || SQLSTATE);
  end;

  begin
    perform public.save_recipe('{"name":"עליון"}'::jsonb,
      jsonb_build_array(jsonb_build_object('ord',0,'name','גנוב','qty',100,'unit','גרם','sub_recipe_id',b_recipe)),
      '[]'::jsonb, '[]'::jsonb, top, null, '');
    insert into h6 values (3,'req 15','cross-account link','refused: 42501','ACCEPTED');
  exception when others then
    insert into h6 values (3,'req 15','cross-account link','refused: 42501','refused: ' || SQLSTATE);
  end;

  -- ── requirement 18: depth is legal; closing it at the bottom is not ───
  l4 := public.save_recipe('{"name":"רמה 4"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, '');
  l3 := public.save_recipe('{"name":"רמה 3"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','ל4','qty',10,'unit','גרם','sub_recipe_id',l4)),
    '[]'::jsonb, '[]'::jsonb, null, null, '');
  l2 := public.save_recipe('{"name":"רמה 2"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','ל3','qty',10,'unit','גרם','sub_recipe_id',l3)),
    '[]'::jsonb, '[]'::jsonb, null, null, '');
  l1 := public.save_recipe('{"name":"רמה 1"}'::jsonb,
    jsonb_build_array(jsonb_build_object('ord',0,'name','ל2','qty',10,'unit','גרם','sub_recipe_id',l2)),
    '[]'::jsonb, '[]'::jsonb, null, null, '');
  insert into h6 values (4,'req 18','a four-level chain is accepted','4 levels',
    case when l1 is not null and l2 is not null and l3 is not null and l4 is not null
         then '4 levels' else 'FAILED' end);

  begin
    perform public.save_recipe('{"name":"רמה 4"}'::jsonb,
      jsonb_build_array(jsonb_build_object('ord',0,'name','ל1','qty',10,'unit','גרם','sub_recipe_id',l1)),
      '[]'::jsonb, '[]'::jsonb, l4, null, '');
    insert into h6 values (5,'req 15','indirect cycle, four deep','refused: 23514','ACCEPTED');
  exception when others then
    insert into h6 values (5,'req 15','indirect cycle, four deep','refused: 23514','refused: ' || SQLSTATE);
  end;

  -- ── requirement 16: changing a link that already exists ──────────────
  begin
    perform public.save_recipe('{"name":"עליון"}'::jsonb,
      jsonb_build_array(jsonb_build_object('ord',0,'name','מילוי','qty',100,'unit','גרם','sub_recipe_id',base2)),
      '[]'::jsonb, '[]'::jsonb, top, null, '');
    insert into h6 values (6,'req 16','repoint a link to another base recipe','accepted','accepted');
  exception when others then
    insert into h6 values (6,'req 16','repoint a link to another base recipe','accepted','REFUSED: ' || SQLSTATE);
  end;
  select count(*) into n from public.ingredients where recipe_id = top and sub_recipe_id = base2;
  insert into h6 values (7,'req 16','and the new link is the one stored','1', n::text);

  -- Captured BEFORE the delete_recipe calls: see trap 3 in the header.
  select id into v1 from public.recipe_versions
   where recipe_id = top and (snapshot->'ingredients'->0->>'sub_recipe_id') = base1::text
   order by created_at limit 1;

  begin
    perform public.delete_recipe(base1);
    insert into h6 values (8,'req 16','the old base recipe becomes deletable','deleted','deleted');
  exception when others then
    insert into h6 values (8,'req 16','the old base recipe becomes deletable','deleted','BLOCKED: ' || SQLSTATE);
  end;
  begin
    perform public.delete_recipe(base2);
    insert into h6 values (9,'req 16','and the new base recipe is now held','refused: 23503','DELETED');
  exception when others then
    insert into h6 values (9,'req 16','and the new base recipe is now held','refused: 23503','refused: ' || SQLSTATE);
  end;

  -- ── requirement 17: restoring a version whose link is now invalid ────
  -- This is the ONLY way to reach that state now that stage 6 refuses to
  -- delete a base recipe in use: the link had to be removed from the live
  -- recipe first, which is exactly what happened above. V1 still holds it.
  insert into h6 values (10,'req 17','a version referencing the deleted base exists','found',
    case when v1 is null then 'NOT FOUND' else 'found' end);

  select name into nm from public.recipes where id = top;
  select string_agg(coalesce(name,'') || '/' || coalesce(qty::text,'') || '/' ||
                    coalesce(sub_recipe_id::text,'-'), '|' order by ord)
    into ing_sig from public.ingredients where recipe_id = top;
  select count(*) into vcount from public.recipe_versions where recipe_id = top;

  if v1 is not null then
    begin
      perform public.restore_recipe_version(v1);
      insert into h6 values (11,'req 17','the restore is refused','refused: 23503','ACCEPTED');
    exception when others then
      insert into h6 values (11,'req 17','the restore is refused','refused: 23503','refused: ' || SQLSTATE);
    end;

    -- ATOMIC: the restore fails after the pre-restore snapshot and the parent
    -- UPDATE have already been written inside the function, so "nothing
    -- changed" is the property that matters — and it covers the name, the rows
    -- and the history.
    insert into h6 select 12,'req 17','the recipe name is unchanged', nm,
      (select name from public.recipes where id = top);
    insert into h6 select 13,'req 17','the ingredient rows are unchanged', ing_sig,
      (select string_agg(coalesce(name,'') || '/' || coalesce(qty::text,'') || '/' ||
                         coalesce(sub_recipe_id::text,'-'), '|' order by ord)
         from public.ingredients where recipe_id = top);
    insert into h6 select 14,'req 17','no version added for a restore that did not happen',
      vcount::text, (select count(*)::text from public.recipe_versions where recipe_id = top);
  end if;

  execute 'reset role';
exception when others then
  execute 'reset role';
  insert into h6 values (99,'FAILED','probe aborted','', SQLERRM);
end $p$;

-- delete_recipe left the guard IMMEDIATE for this transaction (trap 2), which
-- would block the account cascade. Re-defer it, as a fresh request would have it.
set constraints all deferred;
delete from auth.users
 where id in ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

insert into h6
select 100, 'cleanup', 'no fixture row left', '0',
  ((select count(*) from auth.users) + (select count(*) from public.recipes)
 + (select count(*) from public.ingredients) + (select count(*) from public.recipe_versions))::text;

select ord, area, check_name, expected, actual, expected = actual as pass from h6 order by ord;
