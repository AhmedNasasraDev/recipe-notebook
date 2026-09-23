-- ─────────────────────────────────────────────────────────────────────────────
-- Group chat: isolation, the edit/delete asymmetry, and unread counts.
--
-- TWO GROUPS, NOT ONE. Isolation is the point, and a single-group fixture
-- cannot test it: group A holds a conversation, group B holds one message, and
-- neither side may see the other's. A member of A is also asked to POST into
-- B, because read isolation without write isolation is half a wall.
--
-- THE ASYMMETRY THIS FILE EXISTS TO PROVE
--
-- A moderator may DELETE somebody else's message and may never EDIT it.
-- Putting different words under another person's name and face is worse than
-- removing the message, and the rule lives in a trigger rather than in the
-- absence of a button.
--
-- WHAT THE DATABASE STAMPS, NOT THE CLIENT
--
-- `edited_at`, `deleted_at` and `deleted_by` are all set by the trigger. The
-- test sends a FALSE `edited_at` of 2001-01-01 and asserts it was overwritten —
-- otherwise "edited" is a label the client can decline to apply.
--
-- TWO MEASUREMENTS THAT CORRECTED MY OWN ASSUMPTIONS
--
--   · A DELETE that no policy admits matches ZERO ROWS and raises nothing. My
--     first draft treated "no exception" as "it deleted", which would have
--     reported a hole that is not there. The assertion is the row count — and
--     it is kept as a row count deliberately, so that the day somebody grants
--     DELETE again this check goes back to measuring the POLICY rather than
--     the privilege.
--   · That same check then failed once more, and the failure was mine again:
--     after migration 0034 revoked DELETE from `authenticated` the statement
--     no longer matches zero rows, it raises 42501 before RLS is consulted.
--     I had written the expectation from a run made BEFORE 0034. The recorded
--     expectation is now the measured one; the refusal is stricter than the
--     empty match it replaced.
--   · The unread count is 2, not 3, because one of the three messages was
--     soft-deleted earlier in the run. I expected 3; the engine was right.
--
-- THE TEARDOWN IS ITSELF A TEST. Deleting these accounts used to FAIL: the
-- foreign key clearing `deleted_by` reached the update guard looking like an
-- edit by a non-author, and was refused. Migration 0033 exists because of it,
-- so the delete is wrapped and asserted rather than assumed.
--
-- Run: every statement below in one session. Every row must have pass = true.
-- Verified 45/45 after 0035 and 0034. The run that added the five 0035
-- checks measured 44/45, the one failure being the stale DELETE expectation
-- described above; the expectation now records what that run measured.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table c_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
) on commit drop;

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001','c-own@test.invalid'),
  ('30000000-0000-4000-8000-000000000002','c-ins@test.invalid'),
  ('30000000-0000-4000-8000-000000000003','c-mem@test.invalid'),
  ('30000000-0000-4000-8000-000000000004','c-other@test.invalid');

insert into public.groups (id, name, owner_id) values
  ('40000000-0000-4000-8000-00000000000a','קבוצה א','30000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-00000000000b','קבוצה ב','30000000-0000-4000-8000-000000000004');
insert into public.group_members (group_id,user_id,role) values
  ('40000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-000000000001','owner'),
  ('40000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-000000000002','instructor'),
  ('40000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-000000000003','member'),
  ('40000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-000000000004','owner');

do $$
declare
  o uuid := '30000000-0000-4000-8000-000000000001';
  i uuid := '30000000-0000-4000-8000-000000000002';
  m uuid := '30000000-0000-4000-8000-000000000003';
  z uuid := '30000000-0000-4000-8000-000000000004';
  ga uuid := '40000000-0000-4000-8000-00000000000a';
  gb uuid := '40000000-0000-4000-8000-00000000000b';
  n int; txt text; msg uuid; msg2 uuid; s bigint;
begin
perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
execute 'set local role authenticated';
begin
  insert into public.group_messages (group_id, author_id, body)
  values (ga, m, '   שלום לכולם   ') returning id into msg;
  perform set_config('ch.p1','ok',true);
exception when others then perform set_config('ch.p1','ERR '||sqlerrm,true); end;
select body into txt from public.group_messages where id = msg;
perform set_config('ch.p2', coalesce(txt,'none'), true);
begin
  insert into public.group_messages (group_id, author_id, body) values (ga, m, '    ');
  perform set_config('ch.p3','INSERTED',true);
exception when others then perform set_config('ch.p3','refused: '||sqlstate,true); end;
-- the name and face beside a message come from group_roster, so a forged
-- author would be a forged identity
begin
  insert into public.group_messages (group_id, author_id, body) values (ga, o, 'מתחזה');
  perform set_config('ch.p4','INSERTED',true);
exception when others then perform set_config('ch.p4','refused: '||sqlstate,true); end;
begin
  insert into public.group_messages (group_id, author_id, body, kind)
  values (ga, m, 'הודעה', 'announcement');
  perform set_config('ch.p5','INSERTED',true);
exception when others then perform set_config('ch.p5','refused: '||sqlstate,true); end;
-- 'system' is for a future server-generated line; no client may write one
begin
  insert into public.group_messages (group_id, author_id, body, kind)
  values (ga, m, 'X הצטרף', 'system');
  perform set_config('ch.p6','INSERTED',true);
exception when others then perform set_config('ch.p6','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', i,'role','authenticated')::text, true);
begin
  insert into public.group_messages (group_id, author_id, body, kind)
  values (ga, i, 'שיעור נדחה', 'announcement') returning id into msg2;
  perform set_config('ch.p7','ok',true);
exception when others then perform set_config('ch.p7','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
begin
  insert into public.group_messages (group_id, author_id, body, reply_to_id)
  values (ga, m, 'תשובה', msg);
  perform set_config('ch.r1','ok',true);
exception when others then perform set_config('ch.r1','refused: '||sqlstate,true); end;
-- a cross-group reply would be a way to NAME a message the replier cannot read
perform set_config('request.jwt.claims', json_build_object('sub', z,'role','authenticated')::text, true);
begin
  insert into public.group_messages (group_id, author_id, body, reply_to_id)
  values (gb, z, 'תשובה חוצה קבוצות', msg);
  perform set_config('ch.r2','INSERTED',true);
exception when others then perform set_config('ch.r2','refused: '||sqlstate,true); end;

-- ══ isolation, both directions ══
insert into public.group_messages (group_id, author_id, body) values (gb, z, 'סוד של קבוצה ב');
select count(*) into n from public.group_messages;
perform set_config('ch.x1', n::text, true);
select count(*) into n from public.group_messages where group_id = ga;
perform set_config('ch.x2', n::text, true);
perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
select count(*) into n from public.group_messages where group_id = gb;
perform set_config('ch.x3', n::text, true);
begin
  insert into public.group_messages (group_id, author_id, body) values (gb, m, 'חדירה');
  perform set_config('ch.x4','INSERTED',true);
exception when others then perform set_config('ch.x4','refused: '||sqlstate,true); end;

-- ══ editing ══
begin
  update public.group_messages set body='שלום, תוקן' where id = msg;
  perform set_config('ch.e1','ok',true);
exception when others then perform set_config('ch.e1','refused: '||sqlstate,true); end;
select (edited_at is not null)::text into txt from public.group_messages where id = msg;
perform set_config('ch.e2', coalesce(txt,'none'), true);
-- a FALSE edited_at from the client must be overwritten by the database
begin
  update public.group_messages set body='שוב', edited_at='2001-01-01' where id = msg;
  select (edited_at > '2020-01-01')::text into txt from public.group_messages where id = msg;
  perform set_config('ch.e3', coalesce(txt,'none'), true);
exception when others then perform set_config('ch.e3','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', i,'role','authenticated')::text, true);
begin
  update public.group_messages set body='מילים שלא נאמרו' where id = msg;
  perform set_config('ch.e4','EDITED',true);
exception when others then perform set_config('ch.e4','refused: '||sqlstate,true); end;
select body into txt from public.group_messages where id = msg;
perform set_config('ch.e5', coalesce(txt,'none'), true);
perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
begin
  update public.group_messages set kind='announcement' where id = msg;
  perform set_config('ch.e6','CHANGED',true);
exception when others then perform set_config('ch.e6','refused: '||sqlstate,true); end;
begin
  update public.group_messages set group_id=gb where id = msg;
  perform set_config('ch.e7','CHANGED',true);
exception when others then perform set_config('ch.e7','refused: '||sqlstate,true); end;
begin
  update public.group_messages set reply_to_id=msg2 where id = msg;
  perform set_config('ch.e8','CHANGED',true);
exception when others then perform set_config('ch.e8','refused: '||sqlstate,true); end;

-- ══ deleting ══
-- No DELETE policy and, after 0034, no DELETE privilege either. A DELETE that
-- matches nothing raises nothing, so the assertion is the ROW COUNT.
begin
  delete from public.group_messages where id = msg;
  get diagnostics n = row_count;
  perform set_config('ch.d1','rows: '||n,true);
exception when others then perform set_config('ch.d1','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', i,'role','authenticated')::text, true);
begin
  update public.group_messages set deleted_at = now() where id = msg;
  perform set_config('ch.d2','ok',true);
exception when others then perform set_config('ch.d2','refused: '||sqlstate,true); end;
select (deleted_by = i)::text into txt from public.group_messages where id = msg;
perform set_config('ch.d3', coalesce(txt,'none'), true);
begin
  update public.group_messages set deleted_at = null where id = msg;
  perform set_config('ch.d4','UNDELETED',true);
exception when others then perform set_config('ch.d4','refused: '||sqlstate,true); end;
perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
begin
  update public.group_messages set body='אחרי מחיקה' where id = msg;
  perform set_config('ch.d5','EDITED',true);
exception when others then perform set_config('ch.d5','refused: '||sqlstate,true); end;

/*
  Group A now holds three messages, ONE OF WHICH WAS JUST SOFT-DELETED:
    msg   (member, edited, then removed by the instructor) → not counted
    msg2  (instructor, announcement)                       → counted
    reply (member)                                         → counted
  So the owner has 2 unread. My first draft said 3 and was wrong — excluding
  the deleted one is the behaviour under test.
*/
perform set_config('request.jwt.claims', json_build_object('sub', o,'role','authenticated')::text, true);
select unread into n from public.group_unread_counts() where group_id = ga;
perform set_config('ch.u1', coalesce(n::text,'none'), true);
insert into public.group_messages (group_id, author_id, body) values (ga, o, 'מהמדריך');
select unread into n from public.group_unread_counts() where group_id = ga;
perform set_config('ch.u2', coalesce(n::text,'none'), true);
select max(seq) into s from public.group_messages where group_id = ga;
perform public.mark_group_read(ga, s);
select unread into n from public.group_unread_counts() where group_id = ga;
perform set_config('ch.u3', coalesce(n::text,'none'), true);
-- greatest(): a stale client reporting an older position must not resurrect
-- messages the user has already read
perform public.mark_group_read(ga, 1);
select last_read_seq into s from public.group_message_reads where group_id = ga and user_id = o;
perform set_config('ch.u4', (s > 1)::text, true);
select count(*) into n from public.group_unread_counts() where group_id = gb;
perform set_config('ch.u5', n::text, true);

/*
  The realtime.messages join predicate, evaluated as the caller. This is the
  POLICY EXPRESSION, not a websocket handshake — the channel join itself is not
  reachable from SQL — so what is proven here is that the predicate admits a
  member of the topic's group and nobody else, and that a malformed topic
  yields null rather than raising inside a policy.
*/
perform set_config('ch.t1', (public.group_rank(public.topic_group_id('group:'||ga::text)) >= 1)::text, true);
perform set_config('ch.t2', (public.group_rank(public.topic_group_id('group:'||gb::text)) >= 1)::text, true);
perform set_config('ch.t3', coalesce(public.topic_group_id('group:not-a-uuid')::text,'null'), true);
perform set_config('ch.t4', coalesce(public.topic_group_id('realtime:anything')::text,'null'), true);
perform set_config('ch.t5', (public.group_rank(public.topic_group_id('nonsense')) >= 1)::text, true);

perform set_config('request.jwt.claims', json_build_object('sub', z,'role','authenticated')::text, true);
select count(*) into n from public.group_messages where group_id = ga;
perform set_config('ch.n1', n::text, true);
select count(*) into n from public.group_message_reads;
perform set_config('ch.n2', n::text, true);

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('ch.note','CRASHED: '||sqlerrm,true);
end $$;

/*
  0035 — WHAT A DELETED MESSAGE STILL SAID.

  This section exists because the hole was real and was MEASURED before it was
  closed. 0032 left the body in the row and claimed "every read path filters on
  deleted_at", which was true of this repository's queries and of nothing else:
  `messages_read` has no condition on `deleted_at`, so a member could ask
  PostgREST for the row and read the text a moderator had just removed. The
  probe returned it in full.

  0035 moves the words to `group_message_removals` (rank >= 2 only) and leaves
  the message with an empty body. The five checks below are the five things
  that has to mean.
*/
do $$
declare
  o uuid := '30000000-0000-4000-8000-000000000001';
  i uuid := '30000000-0000-4000-8000-000000000002';
  m uuid := '30000000-0000-4000-8000-000000000003';
  ga uuid := '40000000-0000-4000-8000-00000000000a';
  msg uuid; txt text; n int;
begin
perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
execute 'set local role authenticated';
insert into public.group_messages (group_id, author_id, body)
values (ga, m, 'טקסט שיוסר') returning id into msg;

perform set_config('request.jwt.claims', json_build_object('sub', o,'role','authenticated')::text, true);
update public.group_messages set deleted_at = now() where id = msg;

perform set_config('request.jwt.claims', json_build_object('sub', m,'role','authenticated')::text, true);
select body into txt from public.group_messages where id = msg;
perform set_config('ch.rm1', coalesce(nullif(txt,''),'<empty>'), true);
select count(*) into n from public.group_message_removals where message_id = msg;
perform set_config('ch.rm2', n::text, true);
begin
  insert into public.group_message_removals (message_id, group_id, body)
  values (msg, ga, 'forged');
  perform set_config('ch.rm3','INSERTED',true);
exception when others then perform set_config('ch.rm3','refused: '||sqlstate,true); end;

perform set_config('request.jwt.claims', json_build_object('sub', i,'role','authenticated')::text, true);
select body into txt from public.group_message_removals where message_id = msg;
perform set_config('ch.rm4', coalesce(txt,'<none>'), true);

-- The tombstone keeps its place in the thread: a reply that pointed at it
-- still has a parent to point at, which is why the delete is soft at all.
select seq into n from public.group_messages where id = msg;
perform set_config('ch.rm5', (n is not null)::text, true);

execute 'set local role postgres';
exception when others then
  execute 'set local role postgres';
  perform set_config('ch.rmnote','CRASHED: '||sqlerrm,true);
end $$;

-- 0033's regression, and the reason that migration exists.
do $$
begin
  delete from auth.users where email like '%test.invalid';
  perform set_config('ch.td','ok',true);
exception when others then
  perform set_config('ch.td','FAILED: '||sqlstate||' '||sqlerrm,true);
end $$;

insert into c_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('posting','a member can post','ok',current_setting('ch.p1',true)),
  ('posting','the body is trimmed by the database','שלום לכולם',current_setting('ch.p2',true)),
  ('posting','an empty message is refused','refused: 22023',current_setting('ch.p3',true)),
  ('posting','cannot post in another author name','refused: 42501',current_setting('ch.p4',true)),
  ('posting','a member cannot announce','refused: 42501',current_setting('ch.p5',true)),
  ('posting','nobody can write a system line','refused: 42501',current_setting('ch.p6',true)),
  ('posting','an instructor CAN announce','ok',current_setting('ch.p7',true)),
  ('reply','a reply in the same group works','ok',current_setting('ch.r1',true)),
  ('reply','a reply across groups is refused','refused: 23503',current_setting('ch.r2',true)),
  ('ISOLATION','group B owner sees only their own group messages','1',current_setting('ch.x1',true)),
  ('ISOLATION','and none of group A','0',current_setting('ch.x2',true)),
  ('ISOLATION','group A member sees none of group B','0',current_setting('ch.x3',true)),
  ('ISOLATION','nor can they post into group B','refused: 42501',current_setting('ch.x4',true)),
  ('editing','the author may edit','ok',current_setting('ch.e1',true)),
  ('editing','edited_at is set','true',current_setting('ch.e2',true)),
  ('editing','a client-supplied edited_at is overwritten','true',current_setting('ch.e3',true)),
  ('editing','a moderator may NOT edit somebody else words','refused: 42501',current_setting('ch.e4',true)),
  ('editing','and the body is untouched','שוב',current_setting('ch.e5',true)),
  ('editing','kind cannot be changed','refused: 42501',current_setting('ch.e6',true)),
  ('editing','group cannot be changed','refused: 42501',current_setting('ch.e7',true)),
  ('editing','a reply cannot be repointed','refused: 42501',current_setting('ch.e8',true)),
  ('deleting','a hard DELETE is refused outright','refused: 42501',current_setting('ch.d1',true)),
  ('deleting','a moderator may remove a message','ok',current_setting('ch.d2',true)),
  ('deleting','deleted_by is stamped by the database','true',current_setting('ch.d3',true)),
  ('deleting','a deletion cannot be undone','refused: 42501',current_setting('ch.d4',true)),
  ('deleting','nor can a deleted message be edited','refused: 42501',current_setting('ch.d5',true)),
  ('unread','the deleted message is NOT counted','2',current_setting('ch.u1',true)),
  ('unread','my own message is not unread for me','2',current_setting('ch.u2',true)),
  ('unread','marking read clears it','0',current_setting('ch.u3',true)),
  ('unread','a stale older position does not resurrect them','true',current_setting('ch.u4',true)),
  ('unread','no row for a group I am not in','0',current_setting('ch.u5',true)),
  ('realtime','a member passes the join predicate for their group','true',current_setting('ch.t1',true)),
  ('realtime','and fails it for another group','false',current_setting('ch.t2',true)),
  ('realtime','a malformed topic yields null, not an error','null',current_setting('ch.t3',true)),
  ('realtime','a foreign topic prefix yields null','null',current_setting('ch.t4',true)),
  ('realtime','and nonsense fails the predicate','false',current_setting('ch.t5',true)),
  ('non-member','reads no message','0',current_setting('ch.n1',true)),
  ('non-member','reads no read-marker','0',current_setting('ch.n2',true)),
  ('0035 removal','a member reads an EMPTY body after a delete','<empty>',current_setting('ch.rm1',true)),
  ('0035 removal','a member sees no removal record at all','0',current_setting('ch.rm2',true)),
  ('0035 removal','a member cannot forge a removal record','refused: 42501',current_setting('ch.rm3',true)),
  ('0035 removal','staff can still account for what was removed','טקסט שיוסר',current_setting('ch.rm4',true)),
  ('0035 removal','the tombstone keeps its seq','true',current_setting('ch.rm5',true)),
  ('teardown 0033','deleting an account with chat history succeeds','ok',current_setting('ch.td',true))
) as t(area,check_name,expected,actual)
cross join lateral (select t.expected = t.actual) as p(pass);

insert into c_result (area, check_name, expected, actual, pass)
select 'cleanup','nothing left behind','0',n::text,n=0
from (select (select count(*) from public.groups)+(select count(*) from public.group_messages)
           +(select count(*) from public.group_message_reads)
           +(select count(*) from public.group_message_removals)
           +(select count(*) from auth.users where email like '%test.invalid') as n) c;

select area, check_name, expected, actual, pass,
       current_setting('ch.note',true) as probe_status,
       current_setting('ch.rmnote',true) as removal_probe_status
from c_result order by ord;
