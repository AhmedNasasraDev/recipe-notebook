-- ─────────────────────────────────────────────────────────────────────────────
-- Does RLS actually isolate two accounts?
--
-- Stage-3 requirement 5, in the user's words: "אל תסתפק בבדיקת UI. בדוק זאת מול
-- RLS בפועל" — do not settle for a UI check, verify it against RLS in practice.
-- A screen that shows the right rows proves the query had the right filter. It
-- proves nothing about what happens when the filter is removed, which is what an
-- attacker does first. So this script removes the filter and asks the database.
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED
--
-- PostgREST serves a signed-in request by doing exactly two things: it switches
-- to the `authenticated` role, and it puts the JWT's payload into the
-- `request.jwt.claims` GUC. `auth.uid()` reads `sub` out of that GUC. This
-- script sets the same role and the same claim, so every policy evaluates
-- against the same inputs it would on a real request. It is the enforcement
-- path, not a simulation of it.
--
-- What it is NOT: an HTTP test. This environment's egress policy blocks
-- *.supabase.co, so the proof runs over SQL rather than over the REST API. The
-- boundary being tested is the same one either way — RLS is enforced in
-- Postgres, not in PostgREST.
--
-- Note the role switch is not optional. As the table owner, `postgres` bypasses
-- RLS entirely; a version of this script that forgot `set local role
-- authenticated` would report perfect isolation while testing nothing.
--
-- WHAT IT COVERS (the four things stage-3 requirement 5 names)
--   recipes · private_notes · calibrations · profiles/preferences
-- read, and also write: a cross-account UPDATE, DELETE and INSERT.
--
-- Extended in stage 5 with the two surfaces §9 and §18.6 added, because both
-- are reachable with nothing but the anon key:
--   recipe_versions   — stage-5 requirement 8: another account's history must
--                       be unreadable, uncreatable and unrestorable. Note the
--                       policy is indirect (it joins through `recipes`), which
--                       is exactly the kind of policy that looks right and
--                       admits everything.
--   ingredients.sub_recipe_id — stage-5 requirement 15: a link to another
--                       account's recipe must be impossible even when the id is
--                       supplied by hand. RLS alone does NOT do this: the
--                       policy on `ingredients` checks the PARENT recipe, and
--                       foreign-key validation runs with RLS bypassed, so the
--                       column would happily accept a stranger's uuid. The
--                       `check_sub_recipe_link` trigger from 0007 is what
--                       closes it, and it is asserted here.
--
-- FIXTURES
-- Two throwaway accounts with fixed UUIDs, created at the top and removed at the
-- bottom. The cleanup is verified, not assumed — the last row of the output is
-- the count of leftovers, which must be 0. Nothing here is seed data and nothing
-- here is left behind (requirement 6).
--
-- A PROBE THAT CAN RAISE MUST BE WRAPPED IN ITS OWN BEGIN/EXCEPTION
--
-- The DO block has a top-level `exception when others` as a safety net, and a
-- plpgsql exception handler rolls the subtransaction back — including every
-- `set_config(..., true)` made before it. So ONE unwrapped raise does not fail
-- one row: it blanks all of them, and the result table then reports every
-- check as failed, including the ones that had already passed. That is worse
-- than a crash, because it reads as a broken database rather than a broken
-- script. This was found the hard way when the anon version probe below was
-- added unwrapped.
--
-- Run:  every statement below, in one session, and read the result table.
--       Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table rls_result (
  ord        serial,
  area       text,
  check_name text,
  expected   text,
  actual     text,
  pass       boolean
) on commit drop;

-- ── fixtures ────────────────────────────────────────────────────────────────
-- Inserting into auth.users also exercises the on_auth_user_created trigger
-- from migration 0001, so the profile rows below are created the same way a
-- real sign-up creates them.
insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls-a@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rls-b@test.invalid');

insert into public.recipes (id, owner_id, name, category)
values
  ('a0000000-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'עוגת השוקולד של א', 'עוגות ועוגיות'),
  ('b0000000-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'הבריוש הסודי של ב', 'לחמים ובצקים');

insert into public.ingredients (recipe_id, ord, name, qty, unit)
values
  ('a0000000-0000-4000-8000-000000000001', 0, 'קמח לבן', 500, 'גרם'),
  ('b0000000-0000-4000-8000-000000000001', 0, 'חמאה 82%', 250, 'גרם');

insert into public.private_notes (user_id, recipe_id, body)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a0000000-0000-4000-8000-000000000001', 'הערה פרטית של א'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b0000000-0000-4000-8000-000000000001', 'הערה פרטית של ב');

insert into public.calibrations
  (user_id, ingredient_name, ingredient_key, tool, tool_ml, grams)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'קמח לבן', 'flour.white', 'cup', 240, 128),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'קמח לבן', 'flour.white', 'cup', 250, 141);

-- One version for each account, so a leak is visible as a row and as a value.
-- `recipe_snapshot` is the same function `save_recipe` uses, so these are real
-- snapshots and not hand-written stand-ins.
insert into public.recipe_versions (id, recipe_id, tag, what, snapshot, created_by)
values
  ('a0000000-0000-4000-8000-0000000000a1'::uuid, 'a0000000-0000-4000-8000-000000000001',
   'V1', 'הגרסה הסודית של א',
   public.recipe_snapshot('a0000000-0000-4000-8000-000000000001'),
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('b0000000-0000-4000-8000-0000000000b1'::uuid, 'b0000000-0000-4000-8000-000000000001',
   'V1', 'הגרסה הסודית של ב',
   public.recipe_snapshot('b0000000-0000-4000-8000-000000000001'),
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- B's preferences differ from A's, so a leak would be visible as a value and
-- not only as a row count.
update public.profiles
   set tools = '{"cup":250,"tbsp":15,"tsp":5}'::jsonb, profile = 'home'
 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- ── the probes ──────────────────────────────────────────────────────────────
do $$
declare
  a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  a_recipe uuid := 'a0000000-0000-4000-8000-000000000001';
  b_recipe uuid := 'b0000000-0000-4000-8000-000000000001';
  b_version uuid := 'b0000000-0000-4000-8000-0000000000b1';
  n int;
  txt text;
  err text;

  procedure_note text;
begin
  -- Become user A, exactly as PostgREST would for a request carrying A's JWT.
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- ── reads ────────────────────────────────────────────────────────────────
  -- Every query here is deliberately UNFILTERED, or filtered TOWARDS B. If the
  -- application's own `where owner_id = ...` were the only thing protecting the
  -- data, all of these would return rows.

  select count(*) into n from public.recipes;
  perform set_config('rls.tmp', n::text, true);
  select count(*) into n from public.recipes where owner_id = b;
  perform set_config('rls.tmp2', n::text, true);

  select count(*) into n from public.ingredients;
  perform set_config('rls.tmp3', n::text, true);

  select count(*) into n from public.private_notes;
  perform set_config('rls.tmp4', n::text, true);

  select count(*) into n from public.calibrations;
  perform set_config('rls.tmp5', n::text, true);

  select count(*) into n from public.profiles;
  perform set_config('rls.tmp6', n::text, true);

  select coalesce(string_agg(tools::text, ','), '(none)') into txt
    from public.profiles where user_id = b;
  perform set_config('rls.tmp7', txt, true);

  -- Shared reference data must stay readable — the app is useless without it.
  select count(*) into n from public.density_table;
  perform set_config('rls.tmp8', n::text, true);

  -- ── writes ───────────────────────────────────────────────────────────────
  -- An UPDATE or DELETE that no policy admits is not an error: it matches zero
  -- rows. So the row count is the assertion.
  update public.recipes set name = 'נחטף על ידי א' where id = b_recipe;
  get diagnostics n = row_count;
  perform set_config('rls.tmp9', n::text, true);

  delete from public.recipes where id = b_recipe;
  get diagnostics n = row_count;
  perform set_config('rls.tmp10', n::text, true);

  update public.private_notes set body = 'נחטף' where user_id = b;
  get diagnostics n = row_count;
  perform set_config('rls.tmp11', n::text, true);

  update public.calibrations set grams = 999 where user_id = b;
  get diagnostics n = row_count;
  perform set_config('rls.tmp12', n::text, true);

  update public.profiles set profile = 'pro' where user_id = b;
  get diagnostics n = row_count;
  perform set_config('rls.tmp13', n::text, true);

  -- An INSERT that fails WITH CHECK raises, so this one is caught.
  begin
    insert into public.recipes (owner_id, name) values (b, 'מתכון שנשתל אצל ב');
    perform set_config('rls.tmp14', 'inserted', true);
  exception when insufficient_privilege then
    perform set_config('rls.tmp14', 'refused', true);
  end;

  -- Writing to shared reference data must also be refused: professional values
  -- change by migration, never from a client (migration 0004).
  begin
    update public.density_table set g_per_100 = 1 where key = 'flour.white';
    get diagnostics n = row_count;
    perform set_config('rls.tmp15', case when n = 0 then 'refused' else 'updated' end, true);
  exception when insufficient_privilege then
    perform set_config('rls.tmp15', 'refused', true);
  end;

  -- ── stage-5 requirement 8: another account's version history ────────────
  -- Unfiltered, then filtered towards B. The policy on `recipe_versions` joins
  -- through `recipes`, so this is where a join written the wrong way round
  -- would show up as "every version in the database".
  select count(*) into n from public.recipe_versions;
  perform set_config('rls.tmp27', n::text, true);
  select count(*) into n from public.recipe_versions where recipe_id = b_recipe;
  perform set_config('rls.tmp28', n::text, true);
  select coalesce(string_agg(what, ','), '(none)') into txt
    from public.recipe_versions where recipe_id = b_recipe;
  perform set_config('rls.tmp29', txt, true);

  -- Writing into B's history. A forged version is worse than a read: it puts a
  -- false past into somebody else's notebook.
  begin
    insert into public.recipe_versions (recipe_id, tag, what, snapshot, created_by)
    values (b_recipe, 'V99', 'היסטוריה מזויפת', '{}'::jsonb, a);
    perform set_config('rls.tmp30', 'inserted', true);
  exception when insufficient_privilege then
    perform set_config('rls.tmp30', 'refused', true);
  end;

  update public.recipe_versions set what = 'נחטף' where recipe_id = b_recipe;
  get diagnostics n = row_count;
  perform set_config('rls.tmp31', n::text, true);

  delete from public.recipe_versions where recipe_id = b_recipe;
  get diagnostics n = row_count;
  perform set_config('rls.tmp32', n::text, true);

  -- And the restore RPC. It is SECURITY INVOKER, so it sees B's version row
  -- exactly as this session does — which is to say not at all.
  begin
    perform public.restore_recipe_version(b_version);
    perform set_config('rls.tmp33', 'restored', true);
  exception when others then
    perform set_config('rls.tmp33', 'refused', true);
  end;

  -- A can still read A's own history.
  select count(*) into n from public.recipe_versions where recipe_id = a_recipe;
  perform set_config('rls.tmp34', n::text, true);

  -- ── stage-5 requirement 15: linking another account's recipe ─────────────
  -- Straight into the column, which is what the anon key allows. RLS admits
  -- this row (the PARENT is A's) and the foreign key is satisfied (B's recipe
  -- does exist), so without the 0007 trigger this succeeds.
  begin
    insert into public.ingredients (recipe_id, ord, name, qty, unit, sub_recipe_id)
    values (a_recipe, 9, 'תת־מתכון גנוב', 100, 'גרם', b_recipe);
    perform set_config('rls.tmp35', 'inserted', true);
  exception when others then
    perform set_config('rls.tmp35', 'refused: ' || SQLSTATE, true);
  end;

  -- The same attempt as an UPDATE of an existing row, because a trigger
  -- declared for INSERT only would let this one through.
  begin
    update public.ingredients set sub_recipe_id = b_recipe where recipe_id = a_recipe;
    perform set_config('rls.tmp36', 'updated', true);
  exception when others then
    perform set_config('rls.tmp36', 'refused: ' || SQLSTATE, true);
  end;

  -- A self-reference and a cycle, for completeness: same trigger, same session.
  begin
    update public.ingredients set sub_recipe_id = a_recipe where recipe_id = a_recipe;
    perform set_config('rls.tmp37', 'updated', true);
  exception when others then
    perform set_config('rls.tmp37', 'refused: ' || SQLSTATE, true);
  end;

  -- Nothing above may have left a link behind.
  select count(*) into n from public.ingredients
   where recipe_id = a_recipe and sub_recipe_id is not null;
  perform set_config('rls.tmp38', n::text, true);

  -- A's own data must still be reachable. Isolation that also blocks the owner
  -- is not isolation, it is an outage.
  select count(*) into n from public.recipes where owner_id = a;
  perform set_config('rls.tmp16', n::text, true);
  select count(*) into n from public.private_notes where user_id = a;
  perform set_config('rls.tmp17', n::text, true);
  select count(*) into n from public.calibrations where user_id = a;
  perform set_config('rls.tmp18', n::text, true);

  -- ── and now the other direction, so the result is not an artefact of which
  --    account happened to be first ──────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.recipes where owner_id = a;
  perform set_config('rls.tmp19', n::text, true);
  select count(*) into n from public.private_notes;
  perform set_config('rls.tmp20', n::text, true);
  select count(*) into n from public.calibrations;
  perform set_config('rls.tmp21', n::text, true);
  select count(*) into n from public.recipes where owner_id = b;
  perform set_config('rls.tmp22', n::text, true);
  select count(*) into n from public.recipe_versions where recipe_id = a_recipe;
  perform set_config('rls.tmp39', n::text, true);
  select count(*) into n from public.recipe_versions;
  perform set_config('rls.tmp40', n::text, true);

  -- ── an anonymous caller, which is what an unauthenticated request is ──────
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  select count(*) into n from public.recipes;
  perform set_config('rls.tmp23', n::text, true);
  select count(*) into n from public.private_notes;
  perform set_config('rls.tmp24', n::text, true);
  select count(*) into n from public.calibrations;
  perform set_config('rls.tmp25', n::text, true);
  select count(*) into n from public.density_table;
  perform set_config('rls.tmp26', n::text, true);
  -- An anon read of a CHILD table does not come back empty — it is refused
  -- outright, because migration 0006 took EXECUTE on `owns_recipe` away from
  -- `anon` and every child table's policy calls it by name. Strictly safer
  -- than an empty result (no row is evaluated at all), and deliberate, so it
  -- is asserted as a refusal rather than quietly "fixed" by widening the
  -- grant. It must be wrapped: see the note above about the top-level handler.
  begin
    select count(*) into n from public.recipe_versions;
    perform set_config('rls.tmp41', n::text, true);
  exception when others then
    perform set_config('rls.tmp41', 'refused: ' || SQLSTATE, true);
  end;

  execute 'reset role';
  procedure_note := 'probes complete';
  perform set_config('rls.note', procedure_note, true);
exception when others then
  execute 'reset role';
  err := SQLERRM;
  perform set_config('rls.note', 'FAILED: ' || err, true);
end $$;

-- ── the assertions ──────────────────────────────────────────────────────────
insert into rls_result (area, check_name, expected, actual, pass)
select * from (values
  ('recipes',       'A, unfiltered select, sees only A''s recipe',
     '1', current_setting('rls.tmp',  true)),
  ('recipes',       'A, selecting B''s owner_id, gets nothing',
     '0', current_setting('rls.tmp2', true)),
  ('ingredients',   'A, unfiltered, sees only A''s ingredient rows',
     '1', current_setting('rls.tmp3', true)),
  ('private_notes', 'A, unfiltered, sees only A''s private note',
     '1', current_setting('rls.tmp4', true)),
  ('calibrations',  'A, unfiltered, sees only A''s calibration',
     '1', current_setting('rls.tmp5', true)),
  ('profiles',      'A, unfiltered, sees only A''s profile',
     '1', current_setting('rls.tmp6', true)),
  ('profiles',      'A cannot read B''s measuring-tool settings',
     '(none)', current_setting('rls.tmp7', true)),
  ('density_table', 'shared reference data stays readable to A',
     '34', current_setting('rls.tmp8', true)),
  ('recipes',       'A''s UPDATE of B''s recipe matches no row',
     '0', current_setting('rls.tmp9', true)),
  ('recipes',       'A''s DELETE of B''s recipe matches no row',
     '0', current_setting('rls.tmp10', true)),
  ('private_notes', 'A''s UPDATE of B''s note matches no row',
     '0', current_setting('rls.tmp11', true)),
  ('calibrations',  'A''s UPDATE of B''s calibration matches no row',
     '0', current_setting('rls.tmp12', true)),
  ('profiles',      'A''s UPDATE of B''s profile matches no row',
     '0', current_setting('rls.tmp13', true)),
  ('recipes',       'A cannot insert a recipe owned by B',
     'refused', current_setting('rls.tmp14', true)),
  ('density_table', 'no client can rewrite a professional density value',
     'refused', current_setting('rls.tmp15', true)),
  ('recipes',       'A can still read A''s own recipe',
     '1', current_setting('rls.tmp16', true)),
  ('private_notes', 'A can still read A''s own note',
     '1', current_setting('rls.tmp17', true)),
  ('calibrations',  'A can still read A''s own calibration',
     '1', current_setting('rls.tmp18', true)),
  ('recipes',       'B, selecting A''s owner_id, gets nothing',
     '0', current_setting('rls.tmp19', true)),
  ('private_notes', 'B, unfiltered, sees only B''s note',
     '1', current_setting('rls.tmp20', true)),
  ('calibrations',  'B, unfiltered, sees only B''s calibration',
     '1', current_setting('rls.tmp21', true)),
  ('recipes',       'B can still read B''s own recipe',
     '1', current_setting('rls.tmp22', true)),
  ('anon',          'an unauthenticated caller sees no recipe',
     '0', current_setting('rls.tmp23', true)),
  ('anon',          'an unauthenticated caller sees no private note',
     '0', current_setting('rls.tmp24', true)),
  ('anon',          'an unauthenticated caller sees no calibration',
     '0', current_setting('rls.tmp25', true)),
  ('anon',          'an unauthenticated caller sees no density row either',
     '0', current_setting('rls.tmp26', true)),
  -- ── stage-5 requirement 8 ──────────────────────────────────────────────
  ('recipe_versions', 'A, unfiltered, sees only A''s own version',
     '1', current_setting('rls.tmp27', true)),
  ('recipe_versions', 'A, selecting B''s recipe_id, gets nothing',
     '0', current_setting('rls.tmp28', true)),
  ('recipe_versions', 'A cannot read the text of B''s version',
     '(none)', current_setting('rls.tmp29', true)),
  ('recipe_versions', 'A cannot plant a version in B''s history',
     'refused', current_setting('rls.tmp30', true)),
  ('recipe_versions', 'A''s UPDATE of B''s version matches no row',
     '0', current_setting('rls.tmp31', true)),
  ('recipe_versions', 'A''s DELETE of B''s version matches no row',
     '0', current_setting('rls.tmp32', true)),
  ('recipe_versions', 'A cannot restore B''s version through the RPC',
     'refused', current_setting('rls.tmp33', true)),
  ('recipe_versions', 'A can still read A''s own version',
     '1', current_setting('rls.tmp34', true)),
  ('recipe_versions', 'B, selecting A''s recipe_id, gets nothing',
     '0', current_setting('rls.tmp39', true)),
  ('recipe_versions', 'B, unfiltered, sees only B''s own version',
     '1', current_setting('rls.tmp40', true)),
  ('anon',            'an unauthenticated caller is refused the version table outright',
     'refused: 42501', current_setting('rls.tmp41', true)),
  -- ── stage-5 requirement 15 ─────────────────────────────────────────────
  ('sub_recipe_id',   'A cannot INSERT a link to B''s recipe, id supplied by hand',
     'refused: 42501', current_setting('rls.tmp35', true)),
  ('sub_recipe_id',   'A cannot UPDATE an existing row into a link to B''s recipe',
     'refused: 42501', current_setting('rls.tmp36', true)),
  ('sub_recipe_id',   'a self-reference is refused as a check violation',
     'refused: 23514', current_setting('rls.tmp37', true)),
  ('sub_recipe_id',   'and none of those attempts left a link behind',
     '0', current_setting('rls.tmp38', true))
) as t(area, check_name, expected, actual)
cross join lateral (select t.expected = t.actual) as p(pass);

-- ── cleanup, and proof that it happened ─────────────────────────────────────
delete from auth.users
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Scoped to the two fixture accounts by id, so the script stays valid once the
-- project has real users in it: it must prove IT left nothing behind, not that
-- the database is empty.
insert into rls_result (area, check_name, expected, actual, pass)
select 'cleanup', 'no fixture row left in any table', '0', n::text, n = 0
from (
  select (select count(*) from auth.users            where id       = any(ids))
       + (select count(*) from public.profiles       where user_id  = any(ids))
       + (select count(*) from public.recipes        where owner_id = any(ids))
       + (select count(*) from public.private_notes  where user_id  = any(ids))
       + (select count(*) from public.calibrations   where user_id  = any(ids))
       + (select count(*) from public.ingredients i
           where exists (select 1 from public.recipes r
                          where r.id = i.recipe_id and r.owner_id = any(ids)))
       + (select count(*) from public.recipe_versions v
           where exists (select 1 from public.recipes r
                          where r.id = v.recipe_id and r.owner_id = any(ids))) as n
  from (select array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                     'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[] as ids) f
) c;

select area, check_name, expected, actual, pass,
       current_setting('rls.note', true) as probe_status
from rls_result
order by ord;
