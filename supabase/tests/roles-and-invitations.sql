-- ─────────────────────────────────────────────────────────────────────────────
-- Roles, the role-change invariant, and the invitation lifecycle.
--
-- THE INVARIANT THIS FILE EXISTS TO PROVE
--
--   You may only set or remove a role STRICTLY BELOW your own rank.
--
-- One sentence, and it is what keeps an admin from becoming an owner. It is
-- checked from every direction below: an admin promoting a member (allowed),
-- promoting to admin (refused), touching another admin (refused), touching the
-- owner (refused), promoting themselves (refused) — and the owner appointing an
-- admin (allowed) but never another owner (refused).
--
-- TWO SHAPES OF REFUSAL, AND WHY THE DIFFERENCE MATTERS
--
-- An UPDATE that fails the policy's `using` clause matches ZERO ROWS and raises
-- nothing. One that passes `using` and fails `with check` RAISES 42501. So
-- "refused" is not one observable thing, and a test that expects a row count
-- everywhere reports a false failure the moment the refusal comes from the
-- other side. Every write below is wrapped and records which of the two it got
-- — the first draft of this file expected `0` for three checks that raise, and
-- the whole probe aborted.
--
-- EMAIL: BOUND AT REDEMPTION, NEVER LOOKED UP AT CREATION
--
-- `create_group_invite` does not touch `auth.users`, so nothing distinguishes
-- an address that has an account from one that does not — asserted below by
-- inviting `nobody@nowhere.invalid` and getting the same success. The binding
-- is enforced when the invitation is redeemed, against `auth.email()`, and
-- every failure gives the SAME message so a holder of one token learns nothing.
--
-- Run: every statement below in one session. Every row must have pass = true.
-- Verified 49/49.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table r_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
) on commit drop;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'own@test.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'adm@test.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'ins@test.invalid'),
  ('10000000-0000-4000-8000-000000000004', 'mem@test.invalid'),
  ('10000000-0000-4000-8000-000000000005', 'adm2@test.invalid'),
  ('10000000-0000-4000-8000-000000000006', 'out@test.invalid');

insert into public.groups (id, name, code, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'קורס', 'RB1',
   '10000000-0000-4000-8000-000000000001');
-- TWO admins on purpose: "an admin may not touch another admin" is only a real
-- assertion when a second one exists.
insert into public.group_members (group_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','admin'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','instructor'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','member'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','admin');

-- ── the probes ──────────────────────────────────────────────────────────────
do $$
declare
  o uuid := '10000000-0000-4000-8000-000000000001';
  a uuid := '10000000-0000-4000-8000-000000000002';
  i uuid := '10000000-0000-4000-8000-000000000003';
  m uuid := '10000000-0000-4000-8000-000000000004';
  a2 uuid := '10000000-0000-4000-8000-000000000005';
  x uuid := '10000000-0000-4000-8000-000000000006';
  g uuid := '20000000-0000-4000-8000-000000000001';
  n int; txt text; tok text; tok2 text; inv uuid;
begin
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
execute 'set local role authenticated';
perform set_config('rl.r1', public.group_rank(g)::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
perform set_config('rl.r2', public.group_rank(g)::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', i, 'role','authenticated')::text, true);
perform set_config('rl.r3', public.group_rank(g)::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', m, 'role','authenticated')::text, true);
perform set_config('rl.r4', public.group_rank(g)::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', x, 'role','authenticated')::text, true);
perform set_config('rl.r5', public.group_rank(g)::text, true);

-- ══ ADMIN ══
perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
begin
  update public.groups set name = 'קורס שונה' where id = g;
  get diagnostics n = row_count; perform set_config('rl.a1','rows: '||n,true);
exception when others then perform set_config('rl.a1','refused: '||sqlstate,true); end;
begin
  delete from public.groups where id = g;
  get diagnostics n = row_count; perform set_config('rl.a2','rows: '||n,true);
exception when others then perform set_config('rl.a2','refused: '||sqlstate,true); end;
begin
  update public.group_members set role='instructor' where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.a3','rows: '||n,true);
exception when others then perform set_config('rl.a3','refused: '||sqlstate,true); end;
-- passes `using` (target is below), fails `with check` (admin is not below) → RAISES
begin
  update public.group_members set role='admin' where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.a4','rows: '||n,true);
exception when others then perform set_config('rl.a4','refused: '||sqlstate,true); end;
begin
  update public.group_members set role='owner' where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.a5','rows: '||n,true);
exception when others then perform set_config('rl.a5','refused: '||sqlstate,true); end;
-- fails `using` (target is not below) → ZERO ROWS, no raise
begin
  update public.group_members set role='member' where group_id=g and user_id=a2;
  get diagnostics n = row_count; perform set_config('rl.a6','rows: '||n,true);
exception when others then perform set_config('rl.a6','refused: '||sqlstate,true); end;
begin
  update public.group_members set role='member' where group_id=g and user_id=o;
  get diagnostics n = row_count; perform set_config('rl.a7','rows: '||n,true);
exception when others then perform set_config('rl.a7','refused: '||sqlstate,true); end;
begin
  update public.group_members set role='owner' where group_id=g and user_id=a;
  get diagnostics n = row_count; perform set_config('rl.a8','rows: '||n,true);
exception when others then perform set_config('rl.a8','refused: '||sqlstate,true); end;
begin
  delete from public.group_members where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.a9','rows: '||n,true);
exception when others then perform set_config('rl.a9','refused: '||sqlstate,true); end;
begin
  delete from public.group_members where group_id=g and user_id=a2;
  get diagnostics n = row_count; perform set_config('rl.a10','rows: '||n,true);
exception when others then perform set_config('rl.a10','refused: '||sqlstate,true); end;
begin
  insert into public.group_members (group_id,user_id,role) values (g,m,'member');
  perform set_config('rl.a11','ok',true);
exception when others then perform set_config('rl.a11','refused: '||sqlstate,true); end;
begin
  insert into public.group_members (group_id,user_id,role) values (g,x,'admin');
  perform set_config('rl.a12','INSERTED',true);
exception when others then perform set_config('rl.a12','refused: '||sqlstate,true); end;

-- ══ INSTRUCTOR — teaches, does not manage ══
perform set_config('request.jwt.claims', json_build_object('sub', i, 'role','authenticated')::text, true);
begin
  update public.groups set name='x' where id=g;
  get diagnostics n = row_count; perform set_config('rl.i1','rows: '||n,true);
exception when others then perform set_config('rl.i1','refused: '||sqlstate,true); end;
begin
  update public.group_members set role='instructor' where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.i2','rows: '||n,true);
exception when others then perform set_config('rl.i2','refused: '||sqlstate,true); end;
begin
  delete from public.group_members where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.i3','rows: '||n,true);
exception when others then perform set_config('rl.i3','refused: '||sqlstate,true); end;
begin
  perform public.create_group_invite(g, null, 'by instructor');
  perform set_config('rl.i4','ok',true);
exception when others then perform set_config('rl.i4','refused: '||sqlstate,true); end;

-- ══ OWNER ══
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
begin
  update public.group_members set role='admin' where group_id=g and user_id=i;
  get diagnostics n = row_count; perform set_config('rl.o1','rows: '||n,true);
exception when others then perform set_config('rl.o1','refused: '||sqlstate,true); end;
-- there is no rank 4 an owner is allowed to WRITE, so ownership cannot be
-- handed over through a role dropdown. That is deliberate (0030).
begin
  update public.group_members set role='owner' where group_id=g and user_id=i;
  get diagnostics n = row_count; perform set_config('rl.o2','rows: '||n,true);
exception when others then perform set_config('rl.o2','refused: '||sqlstate,true); end;
begin
  delete from public.group_members where group_id=g and user_id=o;
  perform set_config('rl.o3','DELETED',true);
exception when others then perform set_config('rl.o3','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', m, 'role','authenticated')::text, true);
begin
  delete from public.group_members where group_id=g and user_id=m;
  get diagnostics n = row_count; perform set_config('rl.o4','rows: '||n,true);
exception when others then perform set_config('rl.o4','refused: '||sqlstate,true); end;

-- ══ INVITATIONS ══
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
-- typed with different case and surrounding spaces, on purpose
select public.create_group_invite(g, '  MEM@Test.Invalid ', 'דנה') into tok;
select id into inv from public.group_invites where token = tok;
select email into txt from public.group_invites where id = inv;
perform set_config('rl.e1', coalesce(txt,'null'), true);
-- an address with no account must behave identically — no lookup happens
begin
  perform public.create_group_invite(g, 'nobody@nowhere.invalid', '');
  perform set_config('rl.e2','ok',true);
exception when others then perform set_config('rl.e2','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims',
  json_build_object('sub', x, 'role','authenticated','email','out@test.invalid')::text, true);
begin
  perform public.redeem_group_invite(tok);
  perform set_config('rl.e3','JOINED',true);
exception when others then perform set_config('rl.e3','refused: '||sqlerrm,true); end;
perform set_config('rl.e4', public.group_rank(g)::text, true);

perform set_config('request.jwt.claims',
  json_build_object('sub', m, 'role','authenticated','email','mem@test.invalid')::text, true);
begin
  perform public.redeem_group_invite(tok);
  perform set_config('rl.e5','joined',true);
exception when others then perform set_config('rl.e5','ERR '||sqlerrm,true); end;
perform set_config('rl.e6', public.group_rank(g)::text, true);
execute 'set local role postgres';
select status into txt from public.group_invites where id = inv;
perform set_config('rl.e7', txt, true);
execute 'set local role authenticated';

perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
select public.create_group_invite(g, null, 'link') into tok2;
select id into inv from public.group_invites where token = tok2;
perform public.revoke_group_invite(inv);
execute 'set local role postgres';
select status into txt from public.group_invites where id = inv;
perform set_config('rl.e8', txt, true);
execute 'set local role authenticated';
perform set_config('request.jwt.claims',
  json_build_object('sub', x, 'role','authenticated','email','out@test.invalid')::text, true);
begin
  perform public.redeem_group_invite(tok2);
  perform set_config('rl.e9','JOINED',true);
exception when others then perform set_config('rl.e9','refused: '||sqlstate,true); end;

-- resend: the whole point is that the OLD link stops working
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
select public.create_group_invite(g, null, 'to resend') into tok;
select id into inv from public.group_invites where token = tok;
select public.resend_group_invite(inv) into tok2;
execute 'set local role postgres';
select status into txt from public.group_invites where id = inv;
perform set_config('rl.e10', txt, true);
select (replaces_id = inv)::text into txt from public.group_invites where token = tok2;
perform set_config('rl.e11', coalesce(txt,'null'), true);
execute 'set local role authenticated';
perform set_config('request.jwt.claims',
  json_build_object('sub', x, 'role','authenticated','email','out@test.invalid')::text, true);
begin
  perform public.redeem_group_invite(tok);
  perform set_config('rl.e12','JOINED',true);
exception when others then perform set_config('rl.e12','refused: '||sqlstate,true); end;
begin
  perform public.redeem_group_invite(tok2);
  perform set_config('rl.e13','joined',true);
exception when others then perform set_config('rl.e13','ERR '||sqlerrm,true); end;
perform set_config('rl.e14', public.group_rank(g)::text, true);

-- expiry is DERIVED, not stored, so it needs no cron job to stay honest
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
select public.create_group_invite(g, null, 'old') into tok;
select id into inv from public.group_invites where token = tok;
execute 'set local role postgres';
update public.group_invites set expires_at = now() - interval '1 day' where id = inv;
select public.invite_state(gi.*) into txt from public.group_invites gi where gi.id = inv;
perform set_config('rl.e15', txt, true);
execute 'set local role authenticated';
begin
  perform public.redeem_group_invite(tok);
  perform set_config('rl.e16','JOINED',true);
exception when others then perform set_config('rl.e16','refused: '||sqlstate,true); end;

-- ══ REQUESTS ══
perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role','authenticated')::text, true);
execute 'set local role postgres';
delete from public.group_members where group_id=g and user_id=a2;
execute 'set local role authenticated';
begin
  select public.request_group_join('RB1','אשמח להצטרף') into txt;
  perform set_config('rl.q1', txt, true);
exception when others then perform set_config('rl.q1','ERR '||sqlerrm,true); end;
perform set_config('rl.q2', public.group_rank(g)::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
perform public.reject_group_join(g, a2);
execute 'set local role postgres';
select status into txt from public.group_join_requests where group_id=g and user_id=a2;
perform set_config('rl.q3', coalesce(txt,'none'), true);
execute 'set local role authenticated';
-- a rejection is not a ban: asking again reopens the same row
perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role','authenticated')::text, true);
perform public.request_group_join('RB1','שוב');
execute 'set local role postgres';
select status into txt from public.group_join_requests where group_id=g and user_id=a2;
perform set_config('rl.q4', coalesce(txt,'none'), true);
execute 'set local role authenticated';
perform set_config('request.jwt.claims', json_build_object('sub', m, 'role','authenticated')::text, true);
begin
  perform public.approve_group_join(g, a2);
  perform set_config('rl.q5','APPROVED',true);
exception when others then perform set_config('rl.q5','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
perform public.approve_group_join(g, a2);
execute 'set local role postgres';
-- there is no 'accepted' status: group_members is the only answer to "is this
-- person a member", so the request row is removed rather than duplicated
select count(*) into n from public.group_join_requests where group_id=g and user_id=a2;
perform set_config('rl.q6', n::text, true);
select role into txt from public.group_members where group_id=g and user_id=a2;
perform set_config('rl.q7', coalesce(txt,'none'), true);
execute 'set local role authenticated';

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('rl.note','CRASHED: '||sqlerrm,true);
end $$;

-- ── results ─────────────────────────────────────────────────────────────────
insert into r_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('ranks','owner is 4','4',current_setting('rl.r1',true)),
  ('ranks','admin is 3','3',current_setting('rl.r2',true)),
  ('ranks','instructor is 2','2',current_setting('rl.r3',true)),
  ('ranks','member is 1','1',current_setting('rl.r4',true)),
  ('ranks','outsider is 0','0',current_setting('rl.r5',true)),
  ('admin','may edit group settings','rows: 1',current_setting('rl.a1',true)),
  ('admin','may NOT delete the group','rows: 0',current_setting('rl.a2',true)),
  ('admin','may promote a member to instructor','rows: 1',current_setting('rl.a3',true)),
  ('admin','may NOT promote to admin','refused: 42501',current_setting('rl.a4',true)),
  ('admin','may NOT promote to owner','refused: 42501',current_setting('rl.a5',true)),
  ('admin','may NOT demote another admin','rows: 0',current_setting('rl.a6',true)),
  ('admin','may NOT touch the owner','rows: 0',current_setting('rl.a7',true)),
  ('admin','may NOT promote themselves','rows: 0',current_setting('rl.a8',true)),
  ('admin','may remove someone below them','rows: 1',current_setting('rl.a9',true)),
  ('admin','may NOT remove another admin','rows: 0',current_setting('rl.a10',true)),
  ('admin','may add a member directly','ok',current_setting('rl.a11',true)),
  ('admin','may NOT add an admin','refused: 42501',current_setting('rl.a12',true)),
  ('instructor','may NOT edit group settings','rows: 0',current_setting('rl.i1',true)),
  ('instructor','may NOT change roles','rows: 0',current_setting('rl.i2',true)),
  ('instructor','may NOT remove members','rows: 0',current_setting('rl.i3',true)),
  ('instructor','CAN invite','ok',current_setting('rl.i4',true)),
  ('owner','may appoint an admin','rows: 1',current_setting('rl.o1',true)),
  ('owner','may NOT appoint another owner','refused: 42501',current_setting('rl.o2',true)),
  ('owner','may NOT leave their own group','refused: 42501',current_setting('rl.o3',true)),
  ('owner','a member CAN leave','rows: 1',current_setting('rl.o4',true)),
  ('invite','the email is stored normalised','mem@test.invalid',current_setting('rl.e1',true)),
  ('invite','an address with no account behaves identically','ok',current_setting('rl.e2',true)),
  ('invite','the WRONG account cannot redeem','refused: ההזמנה אינה תקפה',current_setting('rl.e3',true)),
  ('invite','and did not join','0',current_setting('rl.e4',true)),
  ('invite','the RIGHT account can','joined',current_setting('rl.e5',true)),
  ('invite','and is a member','1',current_setting('rl.e6',true)),
  ('invite','the invitation reads accepted','accepted',current_setting('rl.e7',true)),
  ('invite','revoking sets revoked','revoked',current_setting('rl.e8',true)),
  ('invite','a revoked token is refused','refused: 42501',current_setting('rl.e9',true)),
  ('invite','resend revokes the old one','revoked',current_setting('rl.e10',true)),
  ('invite','and the new one points back at it','true',current_setting('rl.e11',true)),
  ('invite','the OLD token is dead','refused: 42501',current_setting('rl.e12',true)),
  ('invite','the NEW token works','joined',current_setting('rl.e13',true)),
  ('invite','and that person joined','1',current_setting('rl.e14',true)),
  ('invite','invite_state derives expired','expired',current_setting('rl.e15',true)),
  ('invite','an expired token is refused','refused: 42501',current_setting('rl.e16',true)),
  ('request','a code returns the group name','קורס שונה',current_setting('rl.q1',true)),
  ('request','and grants NO membership','0',current_setting('rl.q2',true)),
  ('request','staff can reject it','rejected',current_setting('rl.q3',true)),
  ('request','the person may ask again','pending',current_setting('rl.q4',true)),
  ('request','a member cannot approve','refused: 42501',current_setting('rl.q5',true)),
  ('request','approving removes the request row','0',current_setting('rl.q6',true)),
  ('request','and creates a plain member','member',current_setting('rl.q7',true))
) as t(area,check_name,expected,actual)
cross join lateral (select t.expected = t.actual) as p(pass);

delete from auth.users where email like '%test.invalid';

insert into r_result (area, check_name, expected, actual, pass)
select 'cleanup','nothing left behind','0',n::text,n=0
from (select (select count(*) from public.groups)+(select count(*) from public.group_invites)
           +(select count(*) from public.group_members)
           +(select count(*) from public.group_join_requests) as n) c;

select area, check_name, expected, actual, pass,
       current_setting('rl.note',true) as probe_status
from r_result order by ord;
