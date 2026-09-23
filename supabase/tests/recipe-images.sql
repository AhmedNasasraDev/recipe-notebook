-- ─────────────────────────────────────────────────────────────────────────────
-- Recipe images: does the private bucket actually stay private?
--
-- HANDOFF §5 states a rule that is easy to claim and easy to get wrong:
-- "Bucket פרטי, גישה חתומה. תמונה של מתכון אישי אינה נגישה לקבוצה." A bucket
-- marked private with no policies is inaccessible to everybody; a bucket with
-- one careless policy is readable by everybody. Nothing in between announces
-- itself, so this asks the database.
--
-- WHY THIS SCRIPT ROLLS BACK INSTEAD OF DELETING ITS FIXTURES
--
-- Supabase installs a `storage.protect_delete()` trigger on the storage tables:
-- `delete from storage.objects` raises `42501 Direct deletion from storage
-- tables is not allowed. Use the Storage API instead.` — before RLS is even
-- consulted. And `postgres` is NOT a member of `supabase_storage_admin`
-- (checked: `pg_has_role(...) = false`), so there is no role to switch to.
--
-- So a test that inserts storage rows cannot clean them up in SQL at all. The
-- whole script is therefore one explicit transaction that ends in ROLLBACK.
-- That is stronger than a delete-based teardown, not weaker: nothing can be
-- left behind, including the rows that could not have been removed.
--
-- TWO CONSEQUENCES OF THAT TRIGGER, WORTH KNOWING
--
--   · The DELETE policy on `storage.objects` cannot be exercised from SQL. It
--     is exercised by the app, which deletes through the Storage API — and the
--     API applies the same policy. The policy is still declared in 0029; what
--     is not asserted here is its effect.
--   · A real delete in the app must go through `storage.remove()`. A repository
--     that deleted the index row and expected the object to follow would leave
--     the file behind.
--
-- WHAT `anon` GETS, MEASURED RATHER THAN ASSUMED
--
-- These policies call `can_read_recipe` and `owns_recipe`, and this project
-- grants no function to `anon` (check-types-against-schema.mjs enforces it).
-- So an unauthenticated read is `42501 permission denied for function`, not an
-- empty result. Both are refusals. The first draft of this script asserted an
-- empty result, which was my assumption rather than a measurement, and it was
-- wrong — the row below records what actually happens.
--
-- Run: every statement below in one session. Every row must have pass = true.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create temp table i_result (
  ord serial, area text, check_name text, expected text, actual text, pass boolean
);

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'img-owner@test.invalid'),
  ('b2222222-2222-4222-8222-222222222222', 'img-member@test.invalid'),
  ('c3333333-3333-4333-8333-333333333333', 'img-outsider@test.invalid');

insert into public.groups (id, name, owner_id) values
  ('a0000000-0000-4000-8000-000000000001', 'קורס', 'a1111111-1111-4111-8111-111111111111');
insert into public.group_members (group_id, user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111', 'owner'),
  ('a0000000-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222', 'member');
insert into public.courses (id, group_id, name) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'c');
insert into public.lessons (id, course_id, name) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000c1', 'l');

-- The pair that makes §5's rule testable: the SAME owner has one recipe in the
-- group and one that is purely personal. A member must see the first photo and
-- not the second.
insert into public.recipes (id, owner_id, group_id, name) values
  ('a0000000-0000-4000-8000-00000000e001', 'a1111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'מתכון הקבוצה'),
  ('a0000000-0000-4000-8000-00000000f001', 'a1111111-1111-4111-8111-111111111111',
   null, 'המתכון הפרטי של המדריך');
insert into public.group_recipe_items (lesson_id, recipe_id, name, perm_view) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-00000000e001', 'i', true);

insert into public.recipe_images (recipe_id, storage_path, width, height, bytes) values
  ('a0000000-0000-4000-8000-00000000e001',
   'a0000000-0000-4000-8000-00000000e001/11111111-1111-4111-8111-111111111111.webp',
   1600, 1200, 180000),
  ('a0000000-0000-4000-8000-00000000f001',
   'a0000000-0000-4000-8000-00000000f001/22222222-2222-4222-8222-222222222222.webp',
   1600, 1200, 190000);

-- Objects inserted as `postgres`, which bypasses RLS, so the READ policies are
-- tested against real rows. The WRITE policies are tested as each user below.
insert into storage.objects (bucket_id, name, owner) values
  ('recipe-images',
   'a0000000-0000-4000-8000-00000000e001/11111111-1111-4111-8111-111111111111.webp',
   'a1111111-1111-4111-8111-111111111111'),
  ('recipe-images',
   'a0000000-0000-4000-8000-00000000f001/22222222-2222-4222-8222-222222222222.webp',
   'a1111111-1111-4111-8111-111111111111');

-- ── the probes ──────────────────────────────────────────────────────────────
do $$
declare
  o_uid uuid := 'a1111111-1111-4111-8111-111111111111';
  m_uid uuid := 'b2222222-2222-4222-8222-222222222222';
  x_uid uuid := 'c3333333-3333-4333-8333-333333333333';
  grec uuid := 'a0000000-0000-4000-8000-00000000e001';
  prec uuid := 'a0000000-0000-4000-8000-00000000f001';
  gobj text := 'a0000000-0000-4000-8000-00000000e001/11111111-1111-4111-8111-111111111111.webp';
  pobj text := 'a0000000-0000-4000-8000-00000000f001/22222222-2222-4222-8222-222222222222.webp';
  n int; txt text;
begin
-- The bucket's own configuration is part of the contract: private, capped, and
-- WebP only so the conversion cannot be skipped.
select (public::text || '/' || file_size_limit::text || '/' ||
        array_to_string(allowed_mime_types, ',')) into txt
  from storage.buckets where id = 'recipe-images';
perform set_config('im.b1', coalesce(txt,'none'), true);

-- `path_recipe_id` must never RAISE: a policy that raises refuses the
-- legitimate request too. Four malformed inputs, each expecting null.
perform set_config('im.p1', coalesce(public.path_recipe_id(pobj)::text,'null'), true);
begin
  perform set_config('im.p2', coalesce(public.path_recipe_id('not-a-uuid/x.webp')::text,'null'), true);
exception when others then perform set_config('im.p2', 'RAISED ' || sqlstate, true);
end;
begin
  perform set_config('im.p3', coalesce(public.path_recipe_id('')::text,'null'), true);
exception when others then perform set_config('im.p3', 'RAISED ' || sqlstate, true);
end;
begin
  perform set_config('im.p4', coalesce(public.path_recipe_id(null)::text,'null'), true);
exception when others then perform set_config('im.p4', 'RAISED ' || sqlstate, true);
end;
begin
  perform set_config('im.p5',
    coalesce(public.path_recipe_id('../' || prec::text || '/x.webp')::text,'null'), true);
exception when others then perform set_config('im.p5', 'RAISED ' || sqlstate, true);
end;

-- ══ the owner ══
perform set_config('request.jwt.claims',
  json_build_object('sub', o_uid, 'role', 'authenticated')::text, true);
execute 'set local role authenticated';

select count(*) into n from public.recipe_images; perform set_config('im.o1', n::text, true);
select count(*) into n from storage.objects; perform set_config('im.o1b', n::text, true);
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', grec::text || '/33333333-3333-4333-8333-333333333333.webp', o_uid);
  perform set_config('im.o2', 'ok', true);
exception when others then perform set_config('im.o2', 'refused: ' || sqlstate, true);
end;
-- A path naming a recipe they do not own, and a path naming no recipe at all.
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', '99999999-9999-4999-8999-999999999999/x.webp', o_uid);
  perform set_config('im.o3', 'INSERTED', true);
exception when others then perform set_config('im.o3', 'refused: ' || sqlstate, true);
end;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', 'loose-file.webp', o_uid);
  perform set_config('im.o4', 'INSERTED', true);
exception when others then perform set_config('im.o4', 'refused: ' || sqlstate, true);
end;

-- ══ the group member — §5's rule ══
perform set_config('request.jwt.claims',
  json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

select count(*) into n from public.recipe_images; perform set_config('im.m1', n::text, true);
select count(*) into n from public.recipe_images where recipe_id = grec;
perform set_config('im.m2', n::text, true);
select count(*) into n from public.recipe_images where recipe_id = prec;
perform set_config('im.m3', n::text, true);
select count(*) into n from storage.objects where name = gobj;
perform set_config('im.m4', n::text, true);
select count(*) into n from storage.objects where name = pobj;
perform set_config('im.m5', n::text, true);
-- Read follows the recipe; WRITE follows ownership. A member of the course is
-- not an author of its recipes.
begin
  insert into public.recipe_images (recipe_id, storage_path)
  values (grec, grec::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
  perform set_config('im.m6', 'INSERTED', true);
exception when others then perform set_config('im.m6', 'refused: ' || sqlstate, true);
end;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', grec::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp', m_uid);
  perform set_config('im.m7', 'INSERTED', true);
exception when others then perform set_config('im.m7', 'refused: ' || sqlstate, true);
end;
delete from public.recipe_images where recipe_id = grec;
get diagnostics n = row_count; perform set_config('im.m9', n::text, true);

-- ══ an outsider ══
perform set_config('request.jwt.claims',
  json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
select count(*) into n from public.recipe_images; perform set_config('im.x1', n::text, true);
select count(*) into n from storage.objects; perform set_config('im.x2', n::text, true);
select count(*) into n from storage.buckets; perform set_config('im.x3', n::text, true);
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', grec::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp', x_uid);
  perform set_config('im.x4', 'INSERTED', true);
exception when others then perform set_config('im.x4', 'refused: ' || sqlstate, true);
end;

-- ══ anon — recorded, not assumed. See the header. ══
perform set_config('request.jwt.claims', '{"role":"anon"}', true);
execute 'set local role anon';
begin
  select count(*) into n from public.recipe_images;
  perform set_config('im.a1', 'rows: ' || n::text, true);
exception when others then perform set_config('im.a1', 'refused: ' || sqlstate, true);
end;
begin
  select count(*) into n from storage.objects;
  perform set_config('im.a2', 'rows: ' || n::text, true);
exception when others then perform set_config('im.a2', 'refused: ' || sqlstate, true);
end;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('recipe-images', grec::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', null);
  perform set_config('im.a3', 'INSERTED', true);
exception when others then perform set_config('im.a3', 'refused: ' || sqlstate, true);
end;

-- ══ the cascade ══
execute 'set local role postgres';
delete from public.recipes where id = prec;
select count(*) into n from public.recipe_images where recipe_id = prec;
perform set_config('im.c1', n::text, true);

exception when others then
  execute 'set local role postgres';
  perform set_config('im.note', 'PROBE CRASHED: ' || sqlerrm, true);
end $$;

-- ── results ─────────────────────────────────────────────────────────────────
insert into i_result (area, check_name, expected, actual, pass)
select area, check_name, expected, actual, pass from (values
  ('bucket', 'private, 2 MB, WebP only', 'false/2097152/image/webp', current_setting('im.b1', true)),
  ('path helper', 'reads the recipe id out of a real path',
     'a0000000-0000-4000-8000-00000000f001', current_setting('im.p1', true)),
  ('path helper', 'a non-uuid folder returns null, does NOT raise', 'null', current_setting('im.p2', true)),
  ('path helper', 'an empty path returns null', 'null', current_setting('im.p3', true)),
  ('path helper', 'a null path returns null', 'null', current_setting('im.p4', true)),
  ('path helper', 'a ../ traversal attempt returns null', 'null', current_setting('im.p5', true)),
  ('owner', 'sees both of their image rows', '2', current_setting('im.o1', true)),
  ('owner', 'and both objects', '2', current_setting('im.o1b', true)),
  ('owner', 'may upload under their own recipe', 'ok', current_setting('im.o2', true)),
  ('owner', 'not under a recipe that is not theirs', 'refused: 42501', current_setting('im.o3', true)),
  ('owner', 'not at a path with no recipe id', 'refused: 42501', current_setting('im.o4', true)),
  ('member 5', 'sees ONLY the group recipe image row', '1', current_setting('im.m1', true)),
  ('member 5', 'which is the group one', '1', current_setting('im.m2', true)),
  ('member 5', 'and NOT the personal recipe image row', '0', current_setting('im.m3', true)),
  ('member 5', 'sees the group OBJECT', '1', current_setting('im.m4', true)),
  ('member 5', 'and NOT the personal OBJECT', '0', current_setting('im.m5', true)),
  ('member 5', 'cannot add an image row to the group recipe', 'refused: 42501', current_setting('im.m6', true)),
  ('member 5', 'cannot upload an object for it either', 'refused: 42501', current_setting('im.m7', true)),
  ('member 5', 'cannot delete the image row', '0', current_setting('im.m9', true)),
  ('outsider', 'sees no image row', '0', current_setting('im.x1', true)),
  ('outsider', 'sees no object', '0', current_setting('im.x2', true)),
  ('outsider', 'sees no bucket', '0', current_setting('im.x3', true)),
  ('outsider', 'cannot upload', 'refused: 42501', current_setting('im.x4', true)),
  ('anon', 'image rows are refused outright', 'refused: 42501', current_setting('im.a1', true)),
  ('anon', 'objects are refused outright', 'refused: 42501', current_setting('im.a2', true)),
  ('anon', 'cannot upload', 'refused: 42501', current_setting('im.a3', true)),
  ('cascade', 'deleting a recipe removes its image rows', '0', current_setting('im.c1', true))
) as t(area, check_name, expected, actual)
cross join lateral (select t.expected = t.actual) as p(pass);

select area, check_name, expected, actual, pass,
       current_setting('im.note', true) as probe_status
from i_result
order by ord;

-- Nothing is deleted, because nothing is kept. See the header.
rollback;
