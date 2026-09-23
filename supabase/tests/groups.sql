-- ─────────────────────────────────────────────────────────────────────────────
-- Do the group policies hold? Three accounts, one group, and §12.3.
--
-- WHAT THIS SCRIPT IS FOR
--
-- Spec §12.3 and HANDOFF §8 state a rule in absolute terms: an instructor or a
-- group owner must NEVER be able to read a student's personal notebook — no
-- recipe, no private note, no calibration — through any policy, view, RPC or
-- report. A screen that does not show the student's recipes proves the
-- screen's query had a filter. It proves nothing about what the database does
-- when the filter is removed, which is the first thing anyone probing the
-- boundary would try. So every read below is deliberately unfiltered, or
-- filtered TOWARDS the data it must not reach.
--
-- THE SECURITY CONTEXT IS THE REAL ONE
--
-- PostgREST serves a signed-in request by switching to the `authenticated`
-- role and putting the JWT payload in `request.jwt.claims`; `auth.uid()` reads
-- `sub` from there. This script sets the same role and the same claim, so the
-- policies evaluate against the same inputs as a real request. The role switch
-- is not optional: as the table owner, `postgres` bypasses RLS entirely, and a
-- version of this script that forgot `set local role authenticated` would
-- report perfect isolation while testing nothing.
--
-- THE CAST
--   I  instructor — creates the group, owns it, teaches the course
--   S  student    — a member, with a private notebook of their own
--   X  outsider   — signed in, member of nothing
--
-- THREE GROUPS OF CHECKS EARNED THEIR PLACE BY CATCHING SOMETHING
--
--   "INSERT RETURNING"  Postgres applies the SELECT policy to a RETURNING
--                       clause, and PostgREST returns the created row by
--                       default — so every insert the app makes is an
--                       INSERT ... RETURNING. Two policies were written to
--                       look the row up by its own id, which cannot work
--                       during its own insert. See migration 0024.
--   "escalation"        An instructor could point a lesson item at a
--                       student's personal recipe. It did not leak, but the
--                       row was a lie waiting for a plausible future policy
--                       to turn into a breach. See migration 0025.
--   "§10.4 defaults"    A new item must be view-only. A default that drifts
--                       hands out recipes nobody released.
--
-- Run: every statement below in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table g_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
) on commit drop;

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'grp-instructor@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'grp-student@test.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'grp-outsider@test.invalid');

insert into public.groups (id, name, kind, code, owner_id) values
  ('9c000000-0000-4000-8000-000000000001', 'קורס לחמים', 'course', 'BREAD24',
   '11111111-1111-4111-8111-111111111111'),
  -- a second group the instructor also owns, for the cross-group attack
  ('9c000000-0000-4000-8000-000000000002', 'קורס קינוחים', 'course', 'SWEET24',
   '11111111-1111-4111-8111-111111111111');

insert into public.group_members (group_id, user_id, role) values
  ('9c000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('9c000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'member'),
  ('9c000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'owner');

insert into public.courses (id, group_id, name) values
  ('9c000000-0000-4000-8000-0000000000c1', '9c000000-0000-4000-8000-000000000001', 'מחזור סתיו');

insert into public.lessons (id, course_id, name, date) values
  ('9c000000-0000-4000-8000-0000000000d1', '9c000000-0000-4000-8000-0000000000c1',
   'שיעור 1 — בצק מחמצת', '2026-09-18');

-- The group's own recipes (group_id set), owned by the instructor.
insert into public.recipes (id, owner_id, group_id, name, category) values
  ('9c000000-0000-4000-8000-00000000a001', '11111111-1111-4111-8111-111111111111',
   '9c000000-0000-4000-8000-000000000001', 'מחמצת של הקורס', 'לחמים ובצקים'),
  ('9c000000-0000-4000-8000-00000000a002', '11111111-1111-4111-8111-111111111111',
   '9c000000-0000-4000-8000-000000000001', 'לחם שנשמר לשיעור 3', 'לחמים ובצקים'),
  -- and one in the OTHER group
  ('9c000000-0000-4000-8000-00000000a003', '11111111-1111-4111-8111-111111111111',
   '9c000000-0000-4000-8000-000000000002', 'מקרון של הקורס השני', 'קינוחים');

insert into public.ingredients (recipe_id, ord, name, qty, unit) values
  ('9c000000-0000-4000-8000-00000000a001', 0, 'קמח שיפון', 500, 'גרם'),
  ('9c000000-0000-4000-8000-00000000a002', 0, 'קמח לחם', 1000, 'גרם');

insert into public.steps (recipe_id, ord, text) values
  ('9c000000-0000-4000-8000-00000000a001', 0, 'להאכיל כל 12 שעות');

-- Two items: one visible, one with perm_view FALSE.
insert into public.group_recipe_items
  (id, lesson_id, recipe_id, name, perm_view, perm_save) values
  ('9c000000-0000-4000-8000-0000000000e1', '9c000000-0000-4000-8000-0000000000d1',
   '9c000000-0000-4000-8000-00000000a001', 'מחמצת', true, true),
  ('9c000000-0000-4000-8000-0000000000e2', '9c000000-0000-4000-8000-0000000000d1',
   '9c000000-0000-4000-8000-00000000a002', 'לשיעור 3', false, false);

-- THE STUDENT'S OWN NOTEBOOK. group_id null: this is what §12.3 protects.
insert into public.recipes (id, owner_id, name, category) values
  ('9c000000-0000-4000-8000-00000000b001', '22222222-2222-4222-8222-222222222222',
   'הניסוי הפרטי שלי', 'לחמים ובצקים');

insert into public.ingredients (recipe_id, ord, name, qty, unit) values
  ('9c000000-0000-4000-8000-00000000b001', 0, 'קמח כוסמין', 300, 'גרם');

insert into public.private_notes (user_id, recipe_id, body) values
  ('22222222-2222-4222-8222-222222222222',
   '9c000000-0000-4000-8000-00000000b001', 'ההערה הפרטית של התלמיד');

insert into public.calibrations
  (user_id, ingredient_name, ingredient_key, tool, tool_ml, grams) values
  ('22222222-2222-4222-8222-222222222222', 'קמח כוסמין', 'flour.spelt', 'cup', 240, 120);

-- ── the probes ──────────────────────────────────────────────────────────────
do $$
declare
  i_uid uuid := '11111111-1111-4111-8111-111111111111';
  s_uid uuid := '22222222-2222-4222-8222-222222222222';
  x_uid uuid := '33333333-3333-4333-8333-333333333333';
  gid   uuid := '9c000000-0000-4000-8000-000000000001';
  cid   uuid := '9c000000-0000-4000-8000-0000000000c1';
  lid   uuid := '9c000000-0000-4000-8000-0000000000d1';
  item2 uuid := '9c000000-0000-4000-8000-0000000000e2';
  gr1   uuid := '9c000000-0000-4000-8000-00000000a001';
  gr2   uuid := '9c000000-0000-4000-8000-00000000a002';
  gr3   uuid := '9c000000-0000-4000-8000-00000000a003';
  s_rec uuid := '9c000000-0000-4000-8000-00000000b001';
  n int; txt text; newgid uuid; tmp uuid;
begin

-- ══════════════════════════════════════════════════════════════════════════
-- AS THE STUDENT
-- ══════════════════════════════════════════════════════════════════════════
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
execute 'set local role authenticated';

-- Unfiltered: one group, because they are in one.
select count(*) into n from public.groups; perform set_config('grp.t1', n::text, true);
select count(*) into n from public.courses; perform set_config('grp.t2', n::text, true);
select count(*) into n from public.lessons; perform set_config('grp.t3', n::text, true);
select count(*) into n from public.group_recipe_items; perform set_config('grp.t4', n::text, true);
select coalesce(string_agg(name, ','), '(none)') into txt from public.group_recipe_items;
perform set_config('grp.t5', txt, true);
select count(*) into n from public.recipes where id = gr1; perform set_config('grp.t6', n::text, true);
select count(*) into n from public.ingredients where recipe_id = gr1; perform set_config('grp.t7', n::text, true);
select count(*) into n from public.steps where recipe_id = gr1; perform set_config('grp.t8', n::text, true);
-- §10.4: no view means the recipe does not appear at all.
select count(*) into n from public.recipes where id = gr2; perform set_config('grp.t9', n::text, true);
select count(*) into n from public.ingredients where recipe_id = gr2; perform set_config('grp.t10', n::text, true);

update public.recipes set name = 'x' where id = gr1;
get diagnostics n = row_count; perform set_config('grp.t11', n::text, true);
update public.lessons set summary = 'x' where id = lid;
get diagnostics n = row_count; perform set_config('grp.t12', n::text, true);
update public.group_recipe_items set perm_save = true where id = item2;
get diagnostics n = row_count; perform set_config('grp.t13', n::text, true);
update public.courses set name = 'x' where id = cid;
get diagnostics n = row_count; perform set_config('grp.t14', n::text, true);
update public.group_members set role = 'instructor' where group_id = gid and user_id = s_uid;
get diagnostics n = row_count; perform set_config('grp.t15', n::text, true);
delete from public.group_members where group_id = gid and user_id = i_uid;
get diagnostics n = row_count; perform set_config('grp.t16', n::text, true);

begin
  insert into public.group_members (group_id, user_id, role) values (gid, x_uid, 'member');
  perform set_config('grp.t17', 'INSERTED', true);
exception when others then perform set_config('grp.t17', 'refused: ' || sqlstate, true);
end;
begin
  insert into public.lessons (course_id, name) values (cid, 'שיעור של תלמיד') returning id into tmp;
  perform set_config('grp.t18b', 'INSERTED', true);
exception when others then perform set_config('grp.t18b', 'refused: ' || sqlstate, true);
end;
-- A member CAN see the roster: a student may know who teaches the course.
select count(*) into n from public.group_members where group_id = gid;
perform set_config('grp.t18', n::text, true);

-- ══════════════════════════════════════════════════════════════════════════
-- AS THE INSTRUCTOR — §12.3
-- ══════════════════════════════════════════════════════════════════════════
perform set_config('request.jwt.claims',
  json_build_object('sub', i_uid, 'role', 'authenticated')::text, true);

select count(*) into n from public.group_recipe_items; perform set_config('grp.t19', n::text, true);
select count(*) into n from public.recipes where group_id = gid; perform set_config('grp.t20', n::text, true);

-- EVERY ONE OF THESE MUST BE ZERO.
select count(*) into n from public.recipes where id = s_rec; perform set_config('grp.t21', n::text, true);
-- Unfiltered: three group recipes across two groups, and NOT the student's.
select count(*) into n from public.recipes; perform set_config('grp.t22', n::text, true);
select count(*) into n from public.ingredients where recipe_id = s_rec; perform set_config('grp.t23', n::text, true);
select count(*) into n from public.private_notes; perform set_config('grp.t24', n::text, true);
select count(*) into n from public.private_notes where user_id = s_uid; perform set_config('grp.t25', n::text, true);
select count(*) into n from public.calibrations where user_id = s_uid; perform set_config('grp.t26', n::text, true);
select count(*) into n from public.profiles where user_id = s_uid; perform set_config('grp.t27', n::text, true);

update public.recipes set name = 'y' where id = s_rec;
get diagnostics n = row_count; perform set_config('grp.t28', n::text, true);
delete from public.recipes where id = s_rec;
get diagnostics n = row_count; perform set_config('grp.t29', n::text, true);
update public.private_notes set body = 'y' where user_id = s_uid;
get diagnostics n = row_count; perform set_config('grp.t30', n::text, true);
-- The escalation that would work if the policy were wrong: move the student's
-- recipe into the group, which would then make it readable.
update public.recipes set group_id = gid where id = s_rec;
get diagnostics n = row_count; perform set_config('grp.t31', n::text, true);

-- ── the escalation migration 0025 closed ─────────────────────────────────
begin
  insert into public.group_recipe_items (lesson_id, recipe_id, name)
  values (lid, s_rec, 'ניסיון לחטוף מתכון של תלמיד');
  perform set_config('grp.t32', 'INSERTED', true);
exception when others then perform set_config('grp.t32', 'refused: ' || sqlstate, true);
end;
-- and the cross-group version of the same thing
begin
  insert into public.group_recipe_items (lesson_id, recipe_id, name)
  values (lid, gr3, 'מתכון של קבוצה אחרת');
  perform set_config('grp.t32b', 'INSERTED', true);
exception when others then perform set_config('grp.t32b', 'refused: ' || sqlstate, true);
end;
-- and through UPDATE rather than INSERT
begin
  update public.group_recipe_items set recipe_id = s_rec where id = item2;
  perform set_config('grp.t32c', 'UPDATED', true);
exception when others then perform set_config('grp.t32c', 'refused: ' || sqlstate, true);
end;
-- and from the other side: move a group recipe out while an item points at it
begin
  update public.recipes set group_id = null where id = gr1;
  perform set_config('grp.t32d', 'UPDATED', true);
exception when others then perform set_config('grp.t32d', 'refused: ' || sqlstate, true);
end;

select count(*) into n from public.recipes where id = s_rec; perform set_config('grp.t33', n::text, true);
select count(*) into n from public.ingredients where recipe_id = s_rec; perform set_config('grp.t34', n::text, true);

-- The instructor CAN change a permission — that is the job (§10.4).
update public.group_recipe_items set perm_save = true where id = item2;
get diagnostics n = row_count; perform set_config('grp.t35', n::text, true);

-- ── the PostgREST-shaped writes: INSERT ... RETURNING ────────────────────
begin
  insert into public.courses (group_id, name) values (gid, 'מחזור אביב') returning id into tmp;
  perform set_config('grp.r1', 'ok', true);
exception when others then perform set_config('grp.r1', 'ERR ' || sqlstate, true);
end;
begin
  insert into public.lessons (course_id, name) values (cid, 'שיעור 2') returning id into tmp;
  perform set_config('grp.r2', 'ok', true);
exception when others then perform set_config('grp.r2', 'ERR ' || sqlstate, true);
end;
begin
  insert into public.group_recipe_items (lesson_id, recipe_id, name)
  values (lid, gr2, 'פריט חדש') returning id into tmp;
  perform set_config('grp.r3', 'ok', true);
exception when others then perform set_config('grp.r3', 'ERR ' || sqlstate, true);
end;
select (perm_view::text || '/' || perm_save::text || '/' || perm_print::text || '/'
        || perm_download::text || '/' || perm_share_out::text) into txt
  from public.group_recipe_items where id = tmp;
perform set_config('grp.r4', coalesce(txt, 'NULL'), true);

-- ══════════════════════════════════════════════════════════════════════════
-- AS THE OUTSIDER
-- ══════════════════════════════════════════════════════════════════════════
perform set_config('request.jwt.claims',
  json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);

select count(*) into n from public.groups; perform set_config('grp.t36', n::text, true);
select count(*) into n from public.groups where id = gid; perform set_config('grp.t37', n::text, true);
-- §6: the join code is not a credential and does not even reveal the group.
select count(*) into n from public.groups where code = 'BREAD24'; perform set_config('grp.t38', n::text, true);
select count(*) into n from public.group_members; perform set_config('grp.t39', n::text, true);
select count(*) into n from public.courses; perform set_config('grp.t40', n::text, true);
select count(*) into n from public.lessons; perform set_config('grp.t41', n::text, true);
select count(*) into n from public.group_recipe_items; perform set_config('grp.t42', n::text, true);
select count(*) into n from public.recipes; perform set_config('grp.t43', n::text, true);

begin
  insert into public.group_members (group_id, user_id, role) values (gid, x_uid, 'member');
  perform set_config('grp.t44', 'INSERTED', true);
exception when others then perform set_config('grp.t44', 'refused: ' || sqlstate, true);
end;
select count(*) into n from public.group_members where group_id = gid and user_id = x_uid;
perform set_config('grp.t45', n::text, true);
select public.group_rank(gid)::text into txt; perform set_config('grp.t46', txt, true);
-- and the parent-scoped ranks answer 0 too, without revealing a group id
select public.course_rank(cid)::text into txt; perform set_config('grp.t47', txt, true);
select public.lesson_rank(lid)::text into txt; perform set_config('grp.t47b', txt, true);

-- ── create_group: atomic, and in the caller's own name ───────────────────
select public.create_group('הקבוצה של האאוטסיידר', 'team', '') into newgid;
perform set_config('grp.t48', case when newgid is null then 'NULL' else 'created' end, true);
select public.group_rank(newgid)::text into txt; perform set_config('grp.t49', txt, true);
select count(*) into n from public.group_members where group_id = newgid and user_id = x_uid;
perform set_config('grp.t49b', n::text, true);
select count(*) into n from public.groups where id = newgid;
perform set_config('grp.t49c', n::text, true);
begin
  perform public.create_group('   ', '', '');
  perform set_config('grp.t50', 'CREATED', true);
exception when others then perform set_config('grp.t50', 'refused: ' || sqlstate, true);
end;

-- ── leaving ──────────────────────────────────────────────────────────────
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
delete from public.group_members where group_id = gid and user_id = s_uid;
get diagnostics n = row_count; perform set_config('grp.t51', n::text, true);
select count(*) into n from public.recipes where group_id = gid; perform set_config('grp.t52', n::text, true);
-- and their own recipe is untouched: leaving a course costs them nothing.
select count(*) into n from public.recipes where id = s_rec; perform set_config('grp.t53', n::text, true);

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('grp.note', 'PROBE CRASHED: ' || sqlerrm, true);
end $$;

-- ── results ─────────────────────────────────────────────────────────────────
insert into g_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('student reads', 'sees the one group they are in', '1', current_setting('grp.t1', true)),
  ('student reads', 'sees its course', '1', current_setting('grp.t2', true)),
  ('student reads', 'sees its lesson', '1', current_setting('grp.t3', true)),
  ('student reads', 'sees ONLY the item with perm_view', '1', current_setting('grp.t4', true)),
  ('student reads', 'and it is the right one', 'מחמצת', current_setting('grp.t5', true)),
  ('student reads', 'can read the visible group recipe', '1', current_setting('grp.t6', true)),
  ('student reads', 'with its ingredients', '1', current_setting('grp.t7', true)),
  ('student reads', 'and its steps', '1', current_setting('grp.t8', true)),
  ('student reads', 'CAN see the roster of their own group', '2', current_setting('grp.t18', true)),
  ('10.4 perm_view', 'a recipe whose item is hidden is NOT readable', '0', current_setting('grp.t9', true)),
  ('10.4 perm_view', 'nor are its ingredients', '0', current_setting('grp.t10', true)),
  ('student writes', 'cannot edit the group recipe', '0', current_setting('grp.t11', true)),
  ('student writes', 'cannot edit the lesson', '0', current_setting('grp.t12', true)),
  ('student writes', 'cannot change permissions', '0', current_setting('grp.t13', true)),
  ('student writes', 'cannot edit the course', '0', current_setting('grp.t14', true)),
  ('student writes', 'cannot promote themselves', '0', current_setting('grp.t15', true)),
  ('student writes', 'cannot remove the instructor', '0', current_setting('grp.t16', true)),
  ('student writes', 'cannot add a member', 'refused: 42501', current_setting('grp.t17', true)),
  ('student writes', 'cannot add a lesson', 'refused: 42501', current_setting('grp.t18b', true)),
  ('instructor', 'sees both items, hidden one included', '2', current_setting('grp.t19', true)),
  ('instructor', 'sees both recipes of this group', '2', current_setting('grp.t20', true)),
  ('instructor', 'CAN change a permission', '1', current_setting('grp.t35', true)),
  ('PRIVACY 12.3', 'cannot read the student own recipe', '0', current_setting('grp.t21', true)),
  ('PRIVACY 12.3', 'unfiltered, sees only group recipes', '3', current_setting('grp.t22', true)),
  ('PRIVACY 12.3', 'cannot read its ingredients', '0', current_setting('grp.t23', true)),
  ('PRIVACY 12.3', 'sees no private note at all', '0', current_setting('grp.t24', true)),
  ('PRIVACY 12.3', 'not the student private note', '0', current_setting('grp.t25', true)),
  ('PRIVACY 12.3', 'not the student calibration', '0', current_setting('grp.t26', true)),
  ('PRIVACY 12.3', 'not the student profile', '0', current_setting('grp.t27', true)),
  ('PRIVACY 12.3', 'cannot edit the student recipe', '0', current_setting('grp.t28', true)),
  ('PRIVACY 12.3', 'cannot delete the student recipe', '0', current_setting('grp.t29', true)),
  ('PRIVACY 12.3', 'cannot edit the student note', '0', current_setting('grp.t30', true)),
  ('escalation', 'cannot move the student recipe into the group', '0', current_setting('grp.t31', true)),
  ('escalation', 'cannot point an item at a personal recipe', 'refused: 42501', current_setting('grp.t32', true)),
  ('escalation', 'cannot point an item at another group recipe', 'refused: 42501', current_setting('grp.t32b', true)),
  ('escalation', 'cannot repoint an item by UPDATE either', 'refused: 42501', current_setting('grp.t32c', true)),
  ('escalation', 'cannot move a recipe out while an item uses it', 'refused: 42501', current_setting('grp.t32d', true)),
  ('escalation', 'the student recipe is still unreadable', '0', current_setting('grp.t33', true)),
  ('escalation', 'and its ingredients too', '0', current_setting('grp.t34', true)),
  ('INSERT RETURNING', 'a course inserts and reads back', 'ok', current_setting('grp.r1', true)),
  ('INSERT RETURNING', 'a lesson inserts and reads back', 'ok', current_setting('grp.r2', true)),
  ('INSERT RETURNING', 'an item inserts and reads back', 'ok', current_setting('grp.r3', true)),
  ('10.4 defaults', 'a new item is view-only, everything else off',
     'true/false/false/false/false', current_setting('grp.r4', true)),
  ('outsider', 'sees no group', '0', current_setting('grp.t36', true)),
  ('outsider', 'not even by id', '0', current_setting('grp.t37', true)),
  ('outsider', 'not even by join code', '0', current_setting('grp.t38', true)),
  ('outsider', 'sees no member', '0', current_setting('grp.t39', true)),
  ('outsider', 'sees no course', '0', current_setting('grp.t40', true)),
  ('outsider', 'sees no lesson', '0', current_setting('grp.t41', true)),
  ('outsider', 'sees no item', '0', current_setting('grp.t42', true)),
  ('outsider', 'sees no recipe', '0', current_setting('grp.t43', true)),
  ('outsider', 'cannot let themselves in', 'refused: 42501', current_setting('grp.t44', true)),
  ('outsider', 'and did not become a member', '0', current_setting('grp.t45', true)),
  ('helpers', 'group_rank is 0 for a non-member', '0', current_setting('grp.t46', true)),
  ('helpers', 'course_rank is 0 for a non-member', '0', current_setting('grp.t47', true)),
  ('helpers', 'lesson_rank is 0 for a non-member', '0', current_setting('grp.t47b', true)),
  ('create_group', 'creates a group', 'created', current_setting('grp.t48', true)),
  ('create_group', 'creator is owner in the same call', '3', current_setting('grp.t49', true)),
  ('create_group', 'and the membership row really exists', '1', current_setting('grp.t49b', true)),
  ('create_group', 'and the group is readable by its creator', '1', current_setting('grp.t49c', true)),
  ('create_group', 'refuses a blank name', 'refused: 22023', current_setting('grp.t50', true)),
  ('leaving', 'a member can remove themselves', '1', current_setting('grp.t51', true)),
  ('leaving', 'group recipes go with the membership', '0', current_setting('grp.t52', true)),
  ('leaving', 'but their OWN recipe is untouched', '1', current_setting('grp.t53', true))
) as t(area, check_name, expected, actual)
cross join lateral (select t.expected = t.actual) as p(pass);

-- ── cleanup, and proof that it happened ─────────────────────────────────────
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

-- Scoped to the fixture accounts, so this stays valid once the project has real
-- users: it must prove IT left nothing behind, not that the database is empty.
insert into g_result (area, check_name, expected, actual, pass)
select 'cleanup', 'no fixture row left in any table', '0', n::text, n = 0
from (
  select (select count(*) from auth.users where id = any(ids))
       + (select count(*) from public.groups where owner_id = any(ids))
       + (select count(*) from public.group_members where user_id = any(ids))
       + (select count(*) from public.recipes where owner_id = any(ids))
       + (select count(*) from public.private_notes where user_id = any(ids))
       + (select count(*) from public.calibrations where user_id = any(ids))
       + (select count(*) from public.profiles where user_id = any(ids))
       + (select count(*) from public.courses c
           where exists (select 1 from public.groups g
                          where g.id = c.group_id and g.owner_id = any(ids)))
       + (select count(*) from public.group_recipe_items i
           where exists (select 1 from public.recipes r
                          where r.id = i.recipe_id and r.owner_id = any(ids))) as n
  from (select array['11111111-1111-4111-8111-111111111111',
                     '22222222-2222-4222-8222-222222222222',
                     '33333333-3333-4333-8333-333333333333']::uuid[] as ids) f
) c;

select area, check_name, expected, actual, pass,
       current_setting('grp.note', true) as probe_status
from g_result
order by ord;
