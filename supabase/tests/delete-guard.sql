-- ─────────────────────────────────────────────────────────────────────────────
-- Can a recipe that is in use as a sub-recipe be deleted?  (stage 6, 1-6)
--
-- The product decision is "no", and the enforcement has to be in the database
-- rather than in the UI. Migrations 0008 (the deferred foreign key) and 0009
-- (delete_recipe) are what enforce it; this asks the database whether they do.
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED — same as rls-isolation.sql: the role
-- is switched to `authenticated` and `request.jwt.claims` is set, which is
-- exactly what PostgREST does for a signed-in request. As the table owner,
-- `postgres` bypasses RLS, so a probe that forgets the role switch reports
-- perfect behaviour while testing nothing.
--
-- AND WHERE THE VERIFICATION HAS TO BE DONE AS `postgres`
--
-- This is the trap that caught me while writing it. "Did A's delete actually
-- remove B's row?" cannot be answered from A's session: RLS hides B's row from
-- A either way, so `not exists(...)` reads as "deleted" even when the row is
-- untouched. The first version of this probe accused a correct function of
-- deleting another account's data. Every such check below resets the role
-- first and is annotated where it matters.
--
-- A PROBE THAT CAN RAISE MUST BE WRAPPED IN ITS OWN BEGIN/EXCEPTION — a
-- plpgsql handler rolls back the subtransaction, including every set_config
-- made before it, so one unwrapped raise blanks the whole result table. Same
-- hazard as rls-isolation.sql, same rule.
--
-- SET CONSTRAINTS ... IMMEDIATE PERSISTS FOR THE REST OF THE TRANSACTION.
-- Forcing the deferred check early in one probe leaves it immediate for the
-- probes that follow, which is how an earlier run reported that deleting an
-- account was blocked when it is not. Anything that needs the declared
-- DEFERRED behaviour issues `set constraints all deferred` first.
--
-- Run:  every statement below, in one session, and read the result table.
--       Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table del_result (
  ord        serial,
  area       text,
  check_name text,
  expected   text,
  actual     text,
  pass       boolean
) on commit drop;
grant insert, select on del_result to authenticated, anon;

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'del-a@test.invalid'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'del-b@test.invalid');

insert into public.recipes (id, owner_id, name) values
  ('d0000000-0000-4000-8000-0000000000ba', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'גנאש בסיס'),
  ('d0000000-0000-4000-8000-0000000000cd', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'עוגה עליונה'),
  ('d0000000-0000-4000-8000-0000000000ee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'מתכון בודד'),
  ('e0000000-0000-4000-8000-0000000000bb', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'הסוד של ב');

insert into public.ingredients (recipe_id, ord, name, qty, unit, sub_recipe_id) values
  ('d0000000-0000-4000-8000-0000000000cd', 0, 'גנאש', 150, 'גרם',
   'd0000000-0000-4000-8000-0000000000ba');

-- ── the probes ──────────────────────────────────────────────────────────────
do $probe$
declare
  a        uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  base     uuid := 'd0000000-0000-4000-8000-0000000000ba';
  top      uuid := 'd0000000-0000-4000-8000-0000000000cd';
  lonely   uuid := 'd0000000-0000-4000-8000-0000000000ee';
  b_recipe uuid := 'e0000000-0000-4000-8000-0000000000bb';
  n   int;
  msg text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- ── requirements 1, 2, 5: the raw DELETE, which is what the anon key can
  --    send straight at PostgREST with no function involved ────────────────
  begin
    delete from public.recipes where id = base and owner_id = a;
    set constraints public.ingredients_sub_recipe_id_fkey immediate;
    perform set_config('del.raw', 'DELETED', true);
  exception when others then
    perform set_config('del.raw', 'blocked: ' || SQLSTATE, true);
  end;

  execute 'reset role';
  select count(*) into n from public.recipes where id = base;   -- as postgres
  perform set_config('del.raw_survived', n::text, true);
  select count(*) into n from public.ingredients where sub_recipe_id = base;
  perform set_config('del.link_survived', n::text, true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- ── requirement 3's data source ─────────────────────────────────────────
  select coalesce(string_agg(name, ','), '(none)') into msg
    from public.recipes_using(base);
  perform set_config('del.using', msg, true);

  -- ── the RPC: same refusal, readable message, no names in it ─────────────
  begin
    perform public.delete_recipe(base);
    perform set_config('del.rpc', 'DELETED', true);
  exception when others then
    msg := SQLERRM;
    perform set_config('del.rpc', 'blocked: ' || SQLSTATE, true);
    perform set_config('del.rpc_msg',
      case when msg like '%מתכון אחד%' and msg not like '%עוגה עליונה%'
           then 'a count, no names' else msg end, true);
  end;

  -- ── a recipe nobody uses is unaffected ──────────────────────────────────
  begin
    perform public.delete_recipe(lonely);
    perform set_config('del.lonely', 'deleted', true);
  exception when others then
    perform set_config('del.lonely', 'BLOCKED: ' || SQLSTATE, true);
  end;
  execute 'reset role';
  select count(*) into n from public.recipes where id = lonely;   -- as postgres
  perform set_config('del.lonely_gone', n::text, true);

  -- ── requirement 4: remove the dependency and the delete goes through ────
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.ingredients set sub_recipe_id = null where sub_recipe_id = base;
  begin
    perform public.delete_recipe(base);
    perform set_config('del.after', 'deleted', true);
  exception when others then
    perform set_config('del.after', 'BLOCKED: ' || SQLSTATE, true);
  end;
  execute 'reset role';
  select count(*) into n from public.recipes where id = base;     -- as postgres
  perform set_config('del.after_gone', n::text, true);

  -- ── requirement 6: none of this says anything about another account ─────
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- A asks the guard about B's recipe. It must behave exactly as it does for
  -- an id that does not exist: silently, with no refusal to reason from.
  begin
    perform public.delete_recipe(b_recipe);
    perform set_config('del.cross', 'no error', true);
  exception when others then
    perform set_config('del.cross', 'raised: ' || SQLSTATE, true);
  end;
  begin
    perform public.delete_recipe('00000000-0000-4000-8000-000000000000');
    perform set_config('del.absent', 'no error', true);
  exception when others then
    perform set_config('del.absent', 'raised: ' || SQLSTATE, true);
  end;
  -- and recipes_using is no oracle either
  select count(*) into n from public.recipes_using(b_recipe);
  perform set_config('del.cross_using', n::text, true);

  execute 'reset role';
  -- THE check that must be made as postgres: A cannot see B's row whatever
  -- happened to it, so asking as A proves nothing.
  select count(*) into n from public.recipes where id = b_recipe;
  perform set_config('del.cross_survived', n::text, true);

  -- ── anon has no route in at all ─────────────────────────────────────────
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.delete_recipe(b_recipe);
    perform set_config('del.anon', 'CALLED', true);
  exception when others then
    perform set_config('del.anon', 'refused', true);
  end;

  execute 'reset role';
  perform set_config('del.note', 'probes complete', true);
exception when others then
  execute 'reset role';
  perform set_config('del.note', 'FAILED: ' || SQLERRM, true);
end $probe$;

insert into del_result (area, check_name, expected, actual, pass)
select * from (values
  ('raw delete',    'a recipe in use as a sub-recipe cannot be deleted',
     'blocked: 23503', current_setting('del.raw', true)),
  ('raw delete',    'and the recipe is still there afterwards',
     '1', current_setting('del.raw_survived', true)),
  ('raw delete',    'the dependent link was NOT silently nulled (the old behaviour)',
     '1', current_setting('del.link_survived', true)),
  ('recipes_using', 'names the dependent, for the message the UI shows',
     'עוגה עליונה', current_setting('del.using', true)),
  ('delete_recipe', 'refuses the same delete, inside the call',
     'blocked: 23503', current_setting('del.rpc', true)),
  ('delete_recipe', 'and its message carries a count, not the recipe names',
     'a count, no names', current_setting('del.rpc_msg', true)),
  ('delete_recipe', 'a recipe nobody uses is deleted normally',
     'deleted', current_setting('del.lonely', true)),
  ('delete_recipe', 'and it really is gone',
     '0', current_setting('del.lonely_gone', true)),
  ('requirement 4', 'once the link is removed the delete works',
     'deleted', current_setting('del.after', true)),
  ('requirement 4', 'and the base recipe really is gone',
     '0', current_setting('del.after_gone', true)),
  ('requirement 6', 'another account''s recipe raises nothing to reason from',
     'no error', current_setting('del.cross', true)),
  ('requirement 6', 'an id that does not exist behaves identically',
     'no error', current_setting('del.absent', true)),
  ('requirement 6', 'recipes_using tells A nothing about B''s recipe',
     '0', current_setting('del.cross_using', true)),
  ('requirement 6', 'and B''s recipe is untouched (checked as postgres)',
     '1', current_setting('del.cross_survived', true)),
  ('anon',          'anon cannot call delete_recipe at all',
     'refused', current_setting('del.anon', true))
) as t(area, check_name, expected, actual)
cross join lateral (select t.expected = t.actual) as p(pass);

-- ── the reason the constraint is DEFERRED and not RESTRICT ──────────────────
-- Deleting an account must still cascade, sub-recipe links and all. This needs
-- the declared DEFERRED mode, which the probes above turned off for the rest of
-- the transaction with `set constraints ... immediate`.
set constraints all deferred;

insert into public.recipes (id, owner_id, name) values
  ('d0000000-0000-4000-8000-0000000000f1', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'בסיס 2'),
  ('d0000000-0000-4000-8000-0000000000f2', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'עליון 2');
insert into public.ingredients (recipe_id, ord, name, qty, unit, sub_recipe_id) values
  ('d0000000-0000-4000-8000-0000000000f2', 0, 'בסיס 2', 50, 'גרם',
   'd0000000-0000-4000-8000-0000000000f1');

do $cascade$
begin
  begin
    delete from auth.users
     where id in ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    perform set_config('del.cascade', 'deleted', true);
  exception when others then
    perform set_config('del.cascade', 'BLOCKED: ' || SQLSTATE, true);
  end;
end $cascade$;

insert into del_result (area, check_name, expected, actual, pass)
select 'account', 'deleting an account still cascades, sub-recipe links and all',
       'deleted', current_setting('del.cascade', true),
       current_setting('del.cascade', true) = 'deleted';

-- ── cleanup, and proof that it happened ─────────────────────────────────────
delete from auth.users
 where id in ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

insert into del_result (area, check_name, expected, actual, pass)
select 'cleanup', 'no fixture row left in any table', '0', n::text, n = 0
from (
  select (select count(*) from auth.users            where id       = any(ids))
       + (select count(*) from public.profiles       where user_id  = any(ids))
       + (select count(*) from public.recipes        where owner_id = any(ids))
       + (select count(*) from public.ingredients i
           where exists (select 1 from public.recipes r
                          where r.id = i.recipe_id and r.owner_id = any(ids))) as n
  from (select array['dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']::uuid[] as ids) f
) c;

select area, check_name, expected, actual, pass,
       current_setting('del.note', true) as probe_status
from del_result
order by ord;
