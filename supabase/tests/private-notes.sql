-- ─────────────────────────────────────────────────────────────────────────────
-- Personal notes against real Postgres (spec §8, migration 0022)
--
-- What it asks the DATABASE, rather than the client:
--   · that a note round-trips, and that writing twice updates ONE row —
--     which is the `on conflict` against a PARTIAL unique index, the exact
--     shape that silently matched no constraint in stage 8's `record_purchase`
--   · that clearing the box removes the row rather than storing an empty one
--   · that account B can neither write a note onto A's recipe nor see A's,
--     which is HANDOFF §3's "ללא יוצא מן הכלל" for this table
--   · that an unknown recipe id is refused with the same answer as one that
--     belongs to somebody else, so the error leaks nothing
--   · that deleting a recipe takes its note with it
--   · that `anon` cannot call the function at all
--
-- HOW THE SECURITY CONTEXT IS REPRODUCED — the role is switched to
-- `authenticated` with `request.jwt.claims` set, which is what PostgREST does
-- for a signed-in request. As the table owner, `postgres` bypasses RLS, so a
-- probe that forgets the switch reports perfect isolation while testing nothing.
--
-- Run:  every statement below, in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

create temp table n(ord int, check_name text, expected text, actual text) on commit drop;
grant insert, select on n to authenticated, anon;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'note-a@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'note-b@test.invalid');

do $$
declare
  a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  ra uuid; ra2 uuid; rb uuid; txt text; cnt int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ra := public.save_recipe('{"name":"בריוש"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);

  perform public.save_private_note(ra, 'החמאה של תנובה עובדת טוב יותר');
  select body into txt from public.private_notes where recipe_id = ra;
  insert into n values (1,'a note is stored','החמאה של תנובה עובדת טוב יותר', txt);

  -- The one that had to be proven: ON CONFLICT against a partial index.
  perform public.save_private_note(ra, 'נוסח שני');
  select count(*) into cnt from public.private_notes where recipe_id = ra;
  insert into n values (2,'a second write is one row, not two','1', cnt::text);
  select body into txt from public.private_notes where recipe_id = ra;
  insert into n values (3,'and it holds the newer text','נוסח שני', txt);

  -- Whitespace only is empty: a note is text, and for text "empty" and
  -- "absent" are the same statement.
  perform public.save_private_note(ra, '   ');
  select count(*) into cnt from public.private_notes where recipe_id = ra;
  insert into n values (4,'an emptied note leaves no row behind','0', cnt::text);

  perform public.save_private_note(ra, 'חוזר');
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);
  begin
    perform public.save_private_note(ra, 'נשתל על ידי ב');
    insert into n values (5,'B cannot write a note on A''s recipe','refused: 42501','ACCEPTED');
  exception when others then
    insert into n values (5,'B cannot write a note on A''s recipe','refused: 42501',
      'refused: ' || SQLSTATE);
  end;
  select count(*) into cnt from public.private_notes;
  insert into n values (6,'B, unfiltered, sees no note of A''s','0', cnt::text);

  rb := public.save_recipe('{"name":"של ב"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  perform public.save_private_note(rb, 'ההערה של ב');
  select count(*) into cnt from public.private_notes;
  insert into n values (7,'B sees exactly one note, B''s own','1', cnt::text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  select body into txt from public.private_notes where recipe_id = ra;
  insert into n values (8,'A''s note is exactly what A wrote','חוזר', txt);

  begin
    perform public.save_private_note('00000000-0000-4000-8000-000000000000', 'לאיפה');
    insert into n values (9,'an unknown recipe id is refused','refused: 42501','ACCEPTED');
  exception when others then
    insert into n values (9,'an unknown recipe id is refused','refused: 42501',
      'refused: ' || SQLSTATE);
  end;

  perform public.delete_recipe(ra);
  select count(*) into cnt from public.private_notes where recipe_id = ra;
  insert into n values (10,'deleting the recipe removes its note','0', cnt::text);

  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  execute 'set local role anon';
  begin
    perform public.save_private_note(rb, 'anon');
    insert into n values (11,'anon cannot call it at all','refused','CALLED');
  exception when others then
    insert into n values (11,'anon cannot call it at all','refused','refused');
  end;
  -- ── the same isolation, asked of the TABLE rather than of the function ──
  --
  -- The RPC is one door; RLS is the wall. Both are checked, because a change
  -- to either one must not be able to open the other.
  --
  -- TRAP, and the first version of this section fell into it: an UNQUALIFIED
  -- `update public.private_notes` as B is not an attack on A — RLS scopes it
  -- to B's OWN note, so it legitimately matches one row, and the probe read
  -- that as a breach. And `ra` was deleted two checks ago, which took A's note
  -- with it, so there was nothing of A's left to fail to reach either. The
  -- probes below give A a fresh note and name A's rows explicitly, so a pass
  -- means what it says.
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ra2 := public.save_recipe('{"name":"סוד מקצועי"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb);
  perform public.save_private_note(ra2, 'לא לעיניים זרות');

  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role','authenticated')::text, true);
  update public.private_notes set body = 'נחטף' where user_id = a;
  get diagnostics cnt = row_count;
  insert into n values (12,'B''s direct UPDATE of A''s note matches no row','0', cnt::text);
  delete from public.private_notes where user_id = a;
  get diagnostics cnt = row_count;
  insert into n values (13,'B''s direct DELETE of A''s note matches no row','0', cnt::text);
  begin
    insert into public.private_notes (user_id, recipe_id, body) values (a, ra2, 'נשתל');
    insert into n values (14,'B cannot plant a note as A','refused','INSERTED');
  exception when others then
    insert into n values (14,'B cannot plant a note as A','refused','refused');
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  execute 'set local role anon';
  begin
    select count(*) into cnt from public.private_notes;
    insert into n values (15,'anon sees no note at all','0', cnt::text);
  exception when others then
    insert into n values (15,'anon sees no note at all','0','refused: ' || SQLSTATE);
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(string_agg(body, '|'), '(none)') into txt
    from public.private_notes where recipe_id = ra2;
  insert into n values (16,'and A''s note came through all of it unchanged',
    'לא לעיניים זרות', txt);

  execute 'reset role';
  perform set_config('n.note','probes complete',true);
exception when others then
  execute 'reset role';
  perform set_config('n.note','FAILED: ' || SQLERRM, true);
end $$;

insert into n select 99,'the probe block ran to the end','probes complete',
  coalesce(nullif(current_setting('n.note', true),''),'NEVER SET');

set constraints all deferred;
delete from auth.users;

insert into n select 100,'no fixture row left','0',
  ((select count(*) from auth.users) + (select count(*) from public.recipes)
 + (select count(*) from public.private_notes))::text;

select ord, check_name, expected, actual, expected = actual as pass from n order by ord;
