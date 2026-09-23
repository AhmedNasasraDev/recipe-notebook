-- ─────────────────────────────────────────────────────────────────────────────
-- §10.2's ways into a group, and §11's save-copy.
--
-- WHAT THIS SCRIPT IS FOR
--
-- Three requirements here are absolute, and each is the kind that passes a UI
-- test while being broken underneath:
--
--   §6   "קוד קבוצה אינו מעניק חברות — הוא יוצר בקשה שדורשת אישור". A join
--        code must produce a REQUEST. If it ever produces membership, the
--        approval step is decoration.
--   §6   invite tokens are single-use and expire in seven days, "נבדקים בצד
--        שרת". So a second redemption is attempted here, and an expired token,
--        and a made-up one.
--   §4   "`save-copy` חייב להיות בצד שרת. בדיקת `perm_save` בצד לקוח היא UX
--        בלבד." So `perm_save` is turned OFF and the copy attempted anyway.
--
-- §11 also lists what a copy must NOT inherit, and the reason is not tidiness:
-- copying a batch record would fabricate food-safety documentation. The source
-- below HAS a version, a trial and a batch, so "not copied" is a measurement
-- rather than an absence of data. It is also locked, so "the copy is unlocked"
-- is a real assertion.
--
-- The security context is the real one — the `authenticated` role plus a
-- `request.jwt.claims` GUC, which is what PostgREST sets. As the table owner
-- `postgres` bypasses RLS, so a script that forgot the role switch would report
-- everything working while testing nothing.
--
-- ONE CHECK IN HERE FOUND A REAL BUG. "the issue copied" failed on the first
-- run: `save_group_recipe_copy` is an `insert ... select`, so a source the
-- caller cannot read yields no rows and no error. 0023 had withheld a group
-- read policy from `issues` along with `trials` and `batches`; 0028 corrected
-- it, because a `תקלה → פתרון` list is knowledge about the formula, not a
-- record of a production run.
--
-- Run: every statement below in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table j_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
) on commit drop;

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('aa111111-1111-4111-8111-111111111111', 'join-owner@test.invalid'),
  ('bb222222-2222-4222-8222-222222222222', 'join-student@test.invalid'),
  ('cc333333-3333-4333-8333-333333333333', 'join-outsider@test.invalid'),
  ('dd444444-4444-4444-8444-444444444444', 'join-thief@test.invalid');

insert into public.groups (id, name, code, join_by, owner_id) values
  ('9e000000-0000-4000-8000-000000000001', 'קורס מחמצות', 'SOUR24',
   array['invite','link','code','request']::text[],
   'aa111111-1111-4111-8111-111111111111'),
  -- a group that does NOT accept a code, so the join_by check is exercised
  ('9e000000-0000-4000-8000-000000000002', 'קבוצה סגורה', 'CLOSED1',
   array['invite']::text[], 'aa111111-1111-4111-8111-111111111111');

insert into public.group_members (group_id, user_id, role) values
  ('9e000000-0000-4000-8000-000000000001', 'aa111111-1111-4111-8111-111111111111', 'owner'),
  ('9e000000-0000-4000-8000-000000000002', 'aa111111-1111-4111-8111-111111111111', 'owner');

insert into public.courses (id, group_id, name) values
  ('9e000000-0000-4000-8000-0000000000c1', '9e000000-0000-4000-8000-000000000001', 'מחזור א');
insert into public.lessons (id, course_id, name) values
  ('9e000000-0000-4000-8000-0000000000d1', '9e000000-0000-4000-8000-0000000000c1', 'שיעור 1');

insert into public.recipes (id, owner_id, group_id, name, category, notes,
                            shelf_life, yield_units, unit_weight, locked) values
  ('9e000000-0000-4000-8000-00000000a001', 'aa111111-1111-4111-8111-111111111111',
   '9e000000-0000-4000-8000-000000000001', 'מחמצת שיפון', 'לחמים ובצקים',
   'הערה ציבורית של המדריך', '5 ימים', 4, 250, true);

insert into public.ingredients (recipe_id, ord, name, qty, unit, flour, note) values
  ('9e000000-0000-4000-8000-00000000a001', 0, 'קמח שיפון', 500, 'גרם', true, 'טחינה מלאה'),
  ('9e000000-0000-4000-8000-00000000a001', 1, 'מים', 500, 'גרם', false, '');
insert into public.steps (recipe_id, ord, text, minutes, temp) values
  ('9e000000-0000-4000-8000-00000000a001', 0, 'לערבב', 5, null),
  ('9e000000-0000-4000-8000-00000000a001', 1, 'להתפיח', 720, 26);
insert into public.issues (recipe_id, ord, problem, solution) values
  ('9e000000-0000-4000-8000-00000000a001', 0, 'לא תופחת', 'להעלות טמפרטורה');

-- A version, a trial and a batch on the SOURCE. None may reach the copy.
insert into public.recipe_versions (recipe_id, tag, what, snapshot, created_by) values
  ('9e000000-0000-4000-8000-00000000a001', 'V1', 'הגרסה של המדריך',
   public.recipe_snapshot('9e000000-0000-4000-8000-00000000a001'),
   'aa111111-1111-4111-8111-111111111111');
insert into public.trials (recipe_id, date, note) values
  ('9e000000-0000-4000-8000-00000000a001', '2026-09-01', 'ניסיון של המדריך');
insert into public.batches (recipe_id, code, ccp, chill_temp) values
  ('9e000000-0000-4000-8000-00000000a001', 'L001', '{"core":true}'::jsonb, 4);

insert into public.group_recipe_items (id, lesson_id, recipe_id, name, perm_view, perm_save) values
  ('9e000000-0000-4000-8000-0000000000e1', '9e000000-0000-4000-8000-0000000000d1',
   '9e000000-0000-4000-8000-00000000a001', 'מחמצת', true, true);

-- ── the probes ──────────────────────────────────────────────────────────────
do $$
declare
  o_uid uuid := 'aa111111-1111-4111-8111-111111111111';
  s_uid uuid := 'bb222222-2222-4222-8222-222222222222';
  x_uid uuid := 'cc333333-3333-4333-8333-333333333333';
  t_uid uuid := 'dd444444-4444-4444-8444-444444444444';
  gid   uuid := '9e000000-0000-4000-8000-000000000001';
  gid2  uuid := '9e000000-0000-4000-8000-000000000002';
  item1 uuid := '9e000000-0000-4000-8000-0000000000e1';
  src   uuid := '9e000000-0000-4000-8000-00000000a001';
  tok text; tok2 text; n int; txt text; copyid uuid; copy2 uuid;
begin
-- ══ the owner creates two invitations ══
perform set_config('request.jwt.claims',
  json_build_object('sub', o_uid, 'role', 'authenticated')::text, true);
execute 'set local role authenticated';

select public.create_group_invite(gid, 'דנה') into tok;
perform set_config('jn.t1', case when length(coalesce(tok,'')) >= 40 then 'token'
  else 'SHORT:' || coalesce(tok,'null') end, true);
-- base64url only: a '+' or '/' in a query string breaks for SOME clients only
perform set_config('jn.t2',
  case when tok ~ '^[A-Za-z0-9_-]+$' then 'url-safe' else 'UNSAFE' end, true);
select public.create_group_invite(gid, 'expired') into tok2;

-- ══ an outsider can neither create nor read an invitation ══
perform set_config('request.jwt.claims',
  json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
begin
  perform public.create_group_invite(gid, 'x');
  perform set_config('jn.t3', 'CREATED', true);
exception when others then perform set_config('jn.t3', 'refused: ' || sqlstate, true);
end;
select count(*) into n from public.group_invites; perform set_config('jn.t4', n::text, true);

-- ══ the student redeems one ══
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
begin
  perform public.redeem_group_invite(tok);
  perform set_config('jn.t5', 'joined', true);
exception when others then
  perform set_config('jn.t5', 'ERR ' || sqlstate || ' ' || sqlerrm, true);
end;
-- rank 1: a token never confers more than plain membership
select public.group_rank(gid)::text into txt; perform set_config('jn.t6', txt, true);

-- ══ single use ══
perform set_config('request.jwt.claims',
  json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
begin
  perform public.redeem_group_invite(tok);
  perform set_config('jn.t7', 'JOINED', true);
exception when others then perform set_config('jn.t7', 'refused: ' || sqlstate, true);
end;
select public.group_rank(gid)::text into txt; perform set_config('jn.t8', txt, true);
begin
  perform public.redeem_group_invite('not-a-real-token');
  perform set_config('jn.t9', 'JOINED', true);
exception when others then perform set_config('jn.t9', 'refused: ' || sqlstate, true);
end;

-- ══ seven days, checked on the server ══
execute 'set local role postgres';
update public.group_invites set expires_at = now() - interval '1 day' where token = tok2;
execute 'set local role authenticated';
begin
  perform public.redeem_group_invite(tok2);
  perform set_config('jn.t10', 'JOINED', true);
exception when others then perform set_config('jn.t10', 'refused: ' || sqlstate, true);
end;

-- ══ §6: a code makes a REQUEST, never a membership ══
begin
  select public.request_group_join('SOUR24', 'אני מעוניין') into txt;
  perform set_config('jn.t11', txt, true);
exception when others then perform set_config('jn.t11', 'ERR ' || sqlstate, true);
end;
select public.group_rank(gid)::text into txt; perform set_config('jn.t12', txt, true);
select count(*) into n from public.group_join_requests where user_id = t_uid;
perform set_config('jn.t13', n::text, true);
begin
  perform public.request_group_join('NOPE', '');
  perform set_config('jn.t14', 'ACCEPTED', true);
exception when others then perform set_config('jn.t14', 'refused: ' || sqlstate, true);
end;
begin
  perform public.request_group_join('CLOSED1', '');
  perform set_config('jn.t15', 'ACCEPTED', true);
exception when others then perform set_config('jn.t15', 'refused: ' || sqlstate, true);
end;
select count(*) into n from public.group_members where group_id = gid2 and user_id = t_uid;
perform set_config('jn.t16', n::text, true);

-- ══ approval is staff-only, and only of someone who asked ══
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
begin
  perform public.approve_group_join(gid, t_uid);
  perform set_config('jn.t17', 'APPROVED', true);
exception when others then perform set_config('jn.t17', 'refused: ' || sqlstate, true);
end;

perform set_config('request.jwt.claims',
  json_build_object('sub', o_uid, 'role', 'authenticated')::text, true);
begin
  perform public.approve_group_join(gid, x_uid);
  perform set_config('jn.t18', 'APPROVED', true);
exception when others then perform set_config('jn.t18', 'refused: ' || sqlstate, true);
end;
begin
  perform public.approve_group_join(gid, t_uid);
  perform set_config('jn.t19', 'ok', true);
exception when others then perform set_config('jn.t19', 'ERR ' || sqlstate, true);
end;
select count(*) into n from public.group_members where group_id = gid and user_id = t_uid;
perform set_config('jn.t20', n::text, true);
select role into txt from public.group_members where group_id = gid and user_id = t_uid;
perform set_config('jn.t21', coalesce(txt,'none'), true);
select count(*) into n from public.group_join_requests where user_id = t_uid;
perform set_config('jn.t22', n::text, true);

-- ══ §11 save-copy ══
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
-- the note the student wrote ON THE GROUP ITEM, which §11 moves into the copy
insert into public.private_notes (user_id, group_item_id, body)
values (s_uid, item1, 'ההערה שלי על המחמצת');

begin
  select public.save_group_recipe_copy(item1) into copyid;
  perform set_config('jn.s1', 'copied', true);
exception when others then
  perform set_config('jn.s1', 'ERR ' || sqlstate || ' ' || sqlerrm, true);
end;
select name into txt from public.recipes where id = copyid;
perform set_config('jn.s2', coalesce(txt,'none'), true);
select (owner_id = s_uid)::text into txt from public.recipes where id = copyid;
perform set_config('jn.s3', coalesce(txt,'none'), true);
select coalesce(group_id::text,'null') into txt from public.recipes where id = copyid;
perform set_config('jn.s4', txt, true);
select locked::text into txt from public.recipes where id = copyid;
perform set_config('jn.s5', coalesce(txt,'none'), true);
select count(*) into n from public.ingredients where recipe_id = copyid;
perform set_config('jn.s6', n::text, true);
select count(*) into n from public.steps where recipe_id = copyid;
perform set_config('jn.s7', n::text, true);
select count(*) into n from public.issues where recipe_id = copyid;
perform set_config('jn.s8', n::text, true);
select coalesce(note,'(none)') into txt from public.ingredients where recipe_id = copyid and ord = 0;
perform set_config('jn.s9', txt, true);
select body into txt from public.private_notes where user_id = s_uid and recipe_id = copyid;
perform set_config('jn.s10', coalesce(txt,'none'), true);
select version_note into txt from public.recipes where id = copyid;
perform set_config('jn.s11', coalesce(txt,'none'), true);

-- idempotent (§11 rule 1): the same item saved twice gives ONE copy
begin
  select public.save_group_recipe_copy(item1) into copy2;
  perform set_config('jn.s12', case when copy2 = copyid then 'same' else 'DIFFERENT' end, true);
exception when others then perform set_config('jn.s12', 'ERR ' || sqlstate, true);
end;
select count(*) into n from public.recipes where owner_id = s_uid and saved_from_item_id = item1;
perform set_config('jn.s13', n::text, true);

-- the group's recipe is untouched, and none of its history came along
execute 'set local role postgres';
select name into txt from public.recipes where id = src; perform set_config('jn.s14', txt, true);
select locked::text into txt from public.recipes where id = src; perform set_config('jn.s15', txt, true);
select count(*) into n from public.recipe_versions where recipe_id = copyid;
perform set_config('jn.s16', n::text, true);
select count(*) into n from public.batches where recipe_id = copyid;
perform set_config('jn.s17', n::text, true);
select count(*) into n from public.trials where recipe_id = copyid;
perform set_config('jn.s18', n::text, true);
select count(*) into n from public.ingredients
 where recipe_id = copyid and sub_recipe_id is not null;
perform set_config('jn.s19', n::text, true);

-- ══ §4: perm_save is the SERVER's decision ══
update public.group_recipe_items set perm_save = false where id = item1;
perform set_config('request.jwt.claims',
  json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
execute 'set local role authenticated';
begin
  perform public.save_group_recipe_copy(item1);
  perform set_config('jn.s20', 'COPIED', true);
exception when others then perform set_config('jn.s20', 'refused: ' || sqlstate, true);
end;
select count(*) into n from public.recipes where owner_id = t_uid;
perform set_config('jn.s21', n::text, true);

perform set_config('request.jwt.claims',
  json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
begin
  perform public.save_group_recipe_copy(item1);
  perform set_config('jn.s22', 'COPIED', true);
exception when others then perform set_config('jn.s22', 'refused: ' || sqlstate, true);
end;

-- ══ leaving the course costs the student nothing they wrote ══
perform set_config('request.jwt.claims',
  json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
delete from public.group_members where group_id = gid and user_id = s_uid;
select count(*) into n from public.recipes where id = copyid;
perform set_config('jn.s23', n::text, true);
select count(*) into n from public.ingredients where recipe_id = copyid;
perform set_config('jn.s24', n::text, true);

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('jn.note', 'PROBE CRASHED: ' || sqlerrm, true);
end $$;

-- ── results ─────────────────────────────────────────────────────────────────
insert into j_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('invite', 'the owner gets a long token', 'token', current_setting('jn.t1', true)),
  ('invite', 'and it is URL-safe', 'url-safe', current_setting('jn.t2', true)),
  ('invite', 'an outsider cannot create one', 'refused: 42501', current_setting('jn.t3', true)),
  ('invite', 'nor read any invitation', '0', current_setting('jn.t4', true)),
  ('invite', 'the student redeems it and joins', 'joined', current_setting('jn.t5', true)),
  ('invite', 'as a plain member (rank 1)', '1', current_setting('jn.t6', true)),
  ('invite', 'SINGLE USE: a second redemption is refused', 'refused: 42501', current_setting('jn.t7', true)),
  ('invite', 'and the second person did not join', '0', current_setting('jn.t8', true)),
  ('invite', 'a made-up token is refused', 'refused: 42501', current_setting('jn.t9', true)),
  ('invite', 'an EXPIRED token is refused', 'refused: 42501', current_setting('jn.t10', true)),
  ('code', 'a valid code returns the group name', 'קורס מחמצות', current_setting('jn.t11', true)),
  ('code', 'but grants NO membership', '0', current_setting('jn.t12', true)),
  ('code', 'it creates a pending request', '1', current_setting('jn.t13', true)),
  ('code', 'a wrong code is refused', 'refused: 42501', current_setting('jn.t14', true)),
  ('code', 'a group that does not accept codes refuses', 'refused: 42501', current_setting('jn.t15', true)),
  ('code', 'and nobody joined it', '0', current_setting('jn.t16', true)),
  ('approve', 'a plain member cannot approve', 'refused: 42501', current_setting('jn.t17', true)),
  ('approve', 'nor approve someone who never asked', 'refused: 42501', current_setting('jn.t18', true)),
  ('approve', 'the owner approves a real request', 'ok', current_setting('jn.t19', true)),
  ('approve', 'the person is now a member', '1', current_setting('jn.t20', true)),
  ('approve', 'as a plain member, never promoted', 'member', current_setting('jn.t21', true)),
  ('approve', 'and the request is gone', '0', current_setting('jn.t22', true)),
  ('save-copy', 'perm_save true: the copy is made', 'copied', current_setting('jn.s1', true)),
  ('save-copy', 'named with the suffix', 'מחמצת שיפון — העותק שלי', current_setting('jn.s2', true)),
  ('save-copy', 'owned by the student', 'true', current_setting('jn.s3', true)),
  ('save-copy', 'and NOT in the group', 'null', current_setting('jn.s4', true)),
  ('save-copy', 'unlocked though the source was locked', 'false', current_setting('jn.s5', true)),
  ('save-copy', 'both ingredients copied', '2', current_setting('jn.s6', true)),
  ('save-copy', 'both steps copied', '2', current_setting('jn.s7', true)),
  ('save-copy', 'the troubleshooting list copied (0028)', '1', current_setting('jn.s8', true)),
  ('save-copy', 'an ingredient note came with it', 'טחינה מלאה', current_setting('jn.s9', true)),
  ('save-copy', 'the group note became the private note', 'ההערה שלי על המחמצת', current_setting('jn.s10', true)),
  ('save-copy', 'the version note says where it came from', 'עותק אישי מהקבוצה', current_setting('jn.s11', true)),
  ('save-copy', 'saving twice returns the SAME copy', 'same', current_setting('jn.s12', true)),
  ('save-copy', 'and there is exactly one', '1', current_setting('jn.s13', true)),
  ('save-copy', 'the group recipe kept its name', 'מחמצת שיפון', current_setting('jn.s14', true)),
  ('save-copy', 'and is still locked', 'true', current_setting('jn.s15', true)),
  ('save-copy', 'NO version history copied', '0', current_setting('jn.s16', true)),
  ('save-copy', 'NO batch record copied', '0', current_setting('jn.s17', true)),
  ('save-copy', 'no trial log copied', '0', current_setting('jn.s18', true)),
  ('save-copy', 'no sub-recipe link carried over', '0', current_setting('jn.s19', true)),
  ('save-copy', 'perm_save false: refused BY THE SERVER', 'refused: 42501', current_setting('jn.s20', true)),
  ('save-copy', 'and no recipe was created', '0', current_setting('jn.s21', true)),
  ('save-copy', 'an outsider is refused', 'refused: 42501', current_setting('jn.s22', true)),
  ('save-copy', 'leaving the group keeps the copy', '1', current_setting('jn.s23', true)),
  ('save-copy', 'with its ingredients', '2', current_setting('jn.s24', true))
) as t(area, check_name, expected, actual)
cross join lateral (select t.expected = t.actual) as p(pass);

-- ── cleanup, and proof that it happened ─────────────────────────────────────
delete from auth.users where id in (
  'aa111111-1111-4111-8111-111111111111', 'bb222222-2222-4222-8222-222222222222',
  'cc333333-3333-4333-8333-333333333333', 'dd444444-4444-4444-8444-444444444444');

insert into j_result (area, check_name, expected, actual, pass)
select 'cleanup', 'no fixture row left behind', '0', n::text, n = 0
from (
  select (select count(*) from auth.users where id = any(ids))
       + (select count(*) from public.groups where owner_id = any(ids))
       + (select count(*) from public.recipes where owner_id = any(ids))
       + (select count(*) from public.group_invites where created_by = any(ids))
       + (select count(*) from public.group_join_requests where user_id = any(ids)) as n
  from (select array['aa111111-1111-4111-8111-111111111111',
                     'bb222222-2222-4222-8222-222222222222',
                     'cc333333-3333-4333-8333-333333333333',
                     'dd444444-4444-4444-8444-444444444444']::uuid[] as ids) f
) c;

select area, check_name, expected, actual, pass,
       current_setting('jn.note', true) as probe_status
from j_result
order by ord;
