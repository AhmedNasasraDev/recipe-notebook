-- ─────────────────────────────────────────────────────────────────────────────
-- Publishing a recipe into a lesson, §10.4's permissions in force, §11's copy,
-- and the student's private note on a group item (migration 0036).
--
-- WHAT THIS FILE IS ACTUALLY TESTING
--
-- Not "does the RPC return an id". The three things that would be a breach if
-- they were wrong:
--
--   1. `perm_view = false` hides the RECIPE, not only the item. The item's
--      policy and `recipes_group_read` are two different predicates, and the
--      second one reads the first through a subquery — so if RLS did not apply
--      inside a policy's subquery, turning view off would hide the item and
--      leave the recipe readable. That is measured here rather than reasoned
--      about.
--   2. `perm_save = false` refuses the copy ON THE SERVER. HANDOFF §4 is
--      explicit that a client-side check is UX only.
--   3. §12.3 — the instructor cannot read the student's private note. Not
--      "the UI does not show it": the row must be invisible.
--
-- AND ONE THING THAT IS NOT A BREACH BUT IS A BUG
--
--   4. Publishing is two writes (0025's invariant), so it is one RPC. A
--      student calling it must be refused, and unpublishing the last item must
--      hand the recipe back to the personal notebook — otherwise the recipe
--      silently refuses to change group ever again.
--
-- EVERY STATEMENT THAT CAN RAISE IS WRAPPED, AND HERE IS WHY
--
-- The first run of this file reported all thirty checks as empty rather than
-- as failures. An exception escaping the block rolls the block's subtransaction
-- back, and `set_config(..., is_local => true)` is transactional, so every
-- measurement taken before the error is erased along with it. The error itself
-- was mine (`pg_catalog.nullif` — NULLIF is a parser construct and cannot be
-- schema-qualified, so it raised 42883), and the shape of the failure hid it:
-- the visible symptom was a later call receiving a null item id.
--
-- So an unwrapped statement here is not just an untested line; it is a line
-- that can silently delete the whole run's evidence.
--
-- Run: every statement below in one session, inside a transaction that ends in
-- ROLLBACK. Every row must have pass = true.
--
-- Measured 36/36 on the live project. The run that WROTE this file measured
-- 29/32, and all three failures were my own expectations: the note is stored
-- verbatim rather than trimmed (as `save_private_note` does too), and "the
-- student's copy survives" was being asked as the INSTRUCTOR, who cannot see
-- it — the 0 was §12.3 working. Both readings are now checked, and the extra
-- checks that came out of the corrections bring the count to 36.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create temp table t_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
) on commit drop;

insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001','t-ins@test.invalid'),
  ('50000000-0000-4000-8000-000000000002','t-stu@test.invalid'),
  ('50000000-0000-4000-8000-000000000003','t-out@test.invalid');

insert into public.groups (id, name, owner_id) values
  ('51000000-0000-4000-8000-00000000000a','קורס אפייה','50000000-0000-4000-8000-000000000001');
insert into public.group_members (group_id, user_id, role) values
  ('51000000-0000-4000-8000-00000000000a','50000000-0000-4000-8000-000000000001','owner'),
  ('51000000-0000-4000-8000-00000000000a','50000000-0000-4000-8000-000000000002','member');
insert into public.courses (id, group_id, name) values
  ('52000000-0000-4000-8000-00000000000c','51000000-0000-4000-8000-00000000000a','בצקים');
insert into public.lessons (id, course_id, name) values
  ('53000000-0000-4000-8000-00000000000e','52000000-0000-4000-8000-00000000000c','שיעור 1');
insert into public.recipes (id, owner_id, name) values
  ('54000000-0000-4000-8000-00000000000f','50000000-0000-4000-8000-000000000001','בריוש נאנט'),
  ('54000000-0000-4000-8000-000000000010','50000000-0000-4000-8000-000000000002','העוגה שלי');

do $$
declare
  ins uuid := '50000000-0000-4000-8000-000000000001';
  stu uuid := '50000000-0000-4000-8000-000000000002';
  out_ uuid := '50000000-0000-4000-8000-000000000003';
  grp uuid := '51000000-0000-4000-8000-00000000000a';
  les uuid := '53000000-0000-4000-8000-00000000000e';
  rec uuid := '54000000-0000-4000-8000-00000000000f';
  own uuid := '54000000-0000-4000-8000-000000000010';
  item uuid; copy1 uuid; copy2 uuid; n int; txt text;
begin
perform set_config('request.jwt.claims', json_build_object('sub', ins,'role','authenticated')::text, true);
execute 'set local role authenticated';

-- 1. the instructor publishes their own recipe
begin
  item := public.publish_recipe_to_lesson(les, rec, '');
  perform set_config('tg.p1', (item is not null)::text, true);
exception when others then perform set_config('tg.p1','refused: '||sqlstate,true); end;
-- the name falls back to the recipe's own when none is given
select name into txt from public.group_recipe_items where id = item;
perform set_config('tg.p2', coalesce(txt,'none'), true);
-- and the recipe now belongs to the group
select (group_id = grp)::text into txt from public.recipes where id = rec;
perform set_config('tg.p3', coalesce(txt,'none'), true);

-- a recipe that is not the caller's is refused, and says so as "not yours"
begin
  perform public.publish_recipe_to_lesson(les, own, 'לא שלי');
  perform set_config('tg.p4','PUBLISHED',true);
exception when others then perform set_config('tg.p4','refused: '||sqlstate,true); end;

-- 2. the student sees the item and the recipe, with perm_view on by default
perform set_config('request.jwt.claims', json_build_object('sub', stu,'role','authenticated')::text, true);
select count(*) into n from public.group_recipe_items where id = item;
perform set_config('tg.v1', n::text, true);
select count(*) into n from public.recipes where id = rec;
perform set_config('tg.v2', n::text, true);

-- a student cannot publish anything, their own recipe included
begin
  perform public.publish_recipe_to_lesson(les, own, 'שלי');
  perform set_config('tg.v3','PUBLISHED',true);
exception when others then perform set_config('tg.v3','refused: '||sqlstate,true); end;
-- nor set the permissions
begin
  update public.group_recipe_items set perm_save = true where id = item;
  get diagnostics n = row_count;
  perform set_config('tg.v4','rows: '||n,true);
exception when others then perform set_config('tg.v4','refused: '||sqlstate,true); end;

-- 3. §11 — the copy is refused while perm_save is false
begin
  perform public.save_group_recipe_copy(item);
  perform set_config('tg.s1','COPIED',true);
exception when others then perform set_config('tg.s1','refused: '||sqlstate,true); end;

-- 4. §8 — the student's own note on the item, and §12.3 on top of it
begin
  perform public.save_item_note(item, '  להוסיף 10 דקות קיפול  ');
  perform set_config('tg.n1','ok',true);
exception when others then perform set_config('tg.n1','refused: '||sqlstate,true); end;
/*
  Stored VERBATIM, padding and all. `save_private_note` (0022) does the same,
  and the two must agree: a note is the person's own text, where a trailing
  space is theirs to keep. A chat message IS trimmed by the database, which is
  not an inconsistency — a message is display text in somebody else's
  conversation, and there the padding is noise.

  I expected a trim here and the database was right.
*/
select body into txt from public.private_notes where group_item_id = item;
perform set_config('tg.n2', '['||coalesce(txt,'none')||']', true);
-- ...but a note of nothing but spaces is not a note: it removes the row.
begin
  perform public.save_item_note(item, '     ');
  select count(*) into n from public.private_notes where group_item_id = item;
  perform set_config('tg.n4', n::text, true);
exception when others then perform set_config('tg.n4','refused: '||sqlstate,true); end;
begin
  perform public.save_item_note(item, '  להוסיף 10 דקות קיפול  ');
  perform set_config('tg.n5','ok',true);
exception when others then perform set_config('tg.n5','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims', json_build_object('sub', ins,'role','authenticated')::text, true);
select count(*) into n from public.private_notes where group_item_id = item;
perform set_config('tg.n3', n::text, true);

-- 5. perm_view off hides the RECIPE as well as the item
begin
  update public.group_recipe_items set perm_view = false where id = item;
  get diagnostics n = row_count;
  perform set_config('tg.h0','rows: '||n,true);
exception when others then perform set_config('tg.h0','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', stu,'role','authenticated')::text, true);
select count(*) into n from public.group_recipe_items where id = item;
perform set_config('tg.h1', n::text, true);
select count(*) into n from public.recipes where id = rec;
perform set_config('tg.h2', n::text, true);
-- and the copy is refused with the same message as "no such item"
begin
  perform public.save_group_recipe_copy(item);
  perform set_config('tg.h3','COPIED',true);
exception when others then perform set_config('tg.h3','refused: '||sqlstate,true); end;

-- 6. the instructor turns view and save on; now the copy works
perform set_config('request.jwt.claims', json_build_object('sub', ins,'role','authenticated')::text, true);
begin
  update public.group_recipe_items set perm_view = true, perm_save = true where id = item;
  get diagnostics n = row_count;
  perform set_config('tg.c0','rows: '||n,true);
exception when others then perform set_config('tg.c0','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims', json_build_object('sub', stu,'role','authenticated')::text, true);
begin
  copy1 := public.save_group_recipe_copy(item);
  perform set_config('tg.c1', (copy1 is not null)::text, true);
exception when others then perform set_config('tg.c1','refused: '||sqlstate,true); end;
select (owner_id = stu and group_id is null and not locked)::text into txt
  from public.recipes where id = copy1;
perform set_config('tg.c2', coalesce(txt,'none'), true);
select (saved_from_item_id = item)::text into txt from public.recipes where id = copy1;
perform set_config('tg.c3', coalesce(txt,'none'), true);
-- the private note travelled with the copy (§11 step 2)
select body into txt from public.private_notes where recipe_id = copy1;
perform set_config('tg.c4', coalesce(txt,'none'), true);
-- asking twice does not make a second copy
begin
  copy2 := public.save_group_recipe_copy(item);
  perform set_config('tg.c5', (copy2 = copy1)::text, true);
exception when others then perform set_config('tg.c5','refused: '||sqlstate,true); end;
-- and the group's own recipe was not touched
select (group_id = grp)::text into txt from public.recipes where id = rec;
perform set_config('tg.c6', coalesce(txt,'none'), true);

-- 7. the outsider
perform set_config('request.jwt.claims', json_build_object('sub', out_,'role','authenticated')::text, true);
select count(*) into n from public.group_recipe_items;
perform set_config('tg.o1', n::text, true);
select count(*) into n from public.recipes where id = rec;
perform set_config('tg.o2', n::text, true);
begin
  perform public.save_group_recipe_copy(item);
  perform set_config('tg.o3','COPIED',true);
exception when others then perform set_config('tg.o3','refused: '||sqlstate,true); end;
begin
  perform public.save_item_note(item, 'זר');
  perform set_config('tg.o4','SAVED',true);
exception when others then perform set_config('tg.o4','refused: '||sqlstate,true); end;

-- 8. unpublishing hands the recipe back
perform set_config('request.jwt.claims', json_build_object('sub', stu,'role','authenticated')::text, true);
begin
  perform public.unpublish_recipe_from_lesson(item);
  perform set_config('tg.u1','REMOVED',true);
exception when others then perform set_config('tg.u1','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims', json_build_object('sub', ins,'role','authenticated')::text, true);
begin
  perform public.unpublish_recipe_from_lesson(item);
  perform set_config('tg.u2','ok',true);
exception when others then perform set_config('tg.u2','refused: '||sqlstate,true); end;
select count(*) into n from public.group_recipe_items where id = item;
perform set_config('tg.u3', n::text, true);
select (group_id is null)::text into txt from public.recipes where id = rec;
perform set_config('tg.u4', coalesce(txt,'none'), true);
/*
  The student's copy survives the original leaving the group (§11) — and this
  has to be read AS THE STUDENT. My first version asked as the instructor and
  got 0, which I briefly read as "the copy was deleted". It was §12.3 working:
  an instructor cannot see a student's notebook. Both readings are recorded,
  because the 0 is the more interesting of the two.
*/
select count(*) into n from public.recipes where id = copy1;
perform set_config('tg.u5', n::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', stu,'role','authenticated')::text, true);
select count(*) into n from public.recipes where id = copy1;
perform set_config('tg.u6', n::text, true);
/*
  And the copy's link to the item is now null — `saved_from_item_id` is
  ON DELETE SET NULL. So republishing the same recipe creates a NEW item, and
  §11's "no duplicate" rule (which keys on the item) would let the student take
  a second copy. That is the right answer rather than a defect: a new
  publication is a new thing to copy, and the old copy is the student's own
  recipe by then.
*/
select (saved_from_item_id is null)::text into txt from public.recipes where id = copy1;
perform set_config('tg.u7', coalesce(txt,'none'), true);

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('tg.note','CRASHED: '||sqlerrm,true);
end $$;

insert into t_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('publish','an instructor publishes their own recipe','true',current_setting('tg.p1',true)),
  ('publish','the item takes the recipe name when none is given','בריוש נאנט',current_setting('tg.p2',true)),
  ('publish','the recipe is now the group''s','true',current_setting('tg.p3',true)),
  ('publish','a recipe the caller does not own is refused','refused: 42501',current_setting('tg.p4',true)),
  ('view','the student sees the item','1',current_setting('tg.v1',true)),
  ('view','and the recipe behind it','1',current_setting('tg.v2',true)),
  ('view','a student cannot publish','refused: 42501',current_setting('tg.v3',true)),
  ('view','nor change the permissions','rows: 0',current_setting('tg.v4',true)),
  ('§11','the copy is refused while save is off','refused: 42501',current_setting('tg.s1',true)),
  ('§8','the student saves a note on the item','ok',current_setting('tg.n1',true)),
  ('§8','stored verbatim, padding included','[  להוסיף 10 דקות קיפול  ]',current_setting('tg.n2',true)),
  ('§8','a note of nothing but spaces removes it','0',current_setting('tg.n4',true)),
  ('§8','and it can be written again','ok',current_setting('tg.n5',true)),
  ('§12.3','THE INSTRUCTOR CANNOT READ IT','0',current_setting('tg.n3',true)),
  ('perm_view','the instructor can turn view off','rows: 1',current_setting('tg.h0',true)),
  ('perm_view','turning view off hides the item','0',current_setting('tg.h1',true)),
  ('perm_view','AND THE RECIPE BEHIND IT','0',current_setting('tg.h2',true)),
  ('perm_view','and the copy is refused','refused: 42501',current_setting('tg.h3',true)),
  ('§11','the instructor turns view and save on','rows: 1',current_setting('tg.c0',true)),
  ('§11','with save on, the copy is created','true',current_setting('tg.c1',true)),
  ('§11','it is the student''s, unlocked, and in no group','true',current_setting('tg.c2',true)),
  ('§11','it records the item it came from','true',current_setting('tg.c3',true)),
  ('§11','the private note travelled with it','  להוסיף 10 דקות קיפול  ',current_setting('tg.c4',true)),
  ('§11','asking twice returns the same copy','true',current_setting('tg.c5',true)),
  ('§11','the group''s recipe is untouched','true',current_setting('tg.c6',true)),
  ('outsider','sees no lesson item at all','0',current_setting('tg.o1',true)),
  ('outsider','cannot read the group recipe','0',current_setting('tg.o2',true)),
  ('outsider','cannot copy it','refused: 42501',current_setting('tg.o3',true)),
  ('outsider','cannot leave a note on it','refused: 42501',current_setting('tg.o4',true)),
  ('unpublish','a student cannot unpublish','refused: 42501',current_setting('tg.u1',true)),
  ('unpublish','the instructor can','ok',current_setting('tg.u2',true)),
  ('unpublish','the item is gone','0',current_setting('tg.u3',true)),
  ('unpublish','and the recipe is personal again','true',current_setting('tg.u4',true)),
  ('unpublish','§12.3 — the instructor cannot see the copy','0',current_setting('tg.u5',true)),
  ('unpublish','the student''s copy survives, read as the student','1',current_setting('tg.u6',true)),
  ('unpublish','and its link to the removed item is cleared','true',current_setting('tg.u7',true))
) as t(area,check_name,expected,actual)
cross join lateral (select t.expected = t.actual) as p(pass);

select area, check_name, expected, actual, pass,
       current_setting('tg.note',true) as probe_status
from t_result order by ord;

rollback;
