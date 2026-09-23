-- ─────────────────────────────────────────────────────────────────────────────
-- 0029 — recipe images: a private bucket, signed access, WebP only
--
-- HANDOFF §7 step 8, HANDOFF §5:
--   "תמונות מתכון, תמונות קטגוריה, תמונות אצווה"
--   "Bucket פרטי, גישה חתומה. תמונה של מתכון אישי אינה נגישה לקבוצה."
--   "מגבלת גודל והמרה ל־WebP בהעלאה."
--
-- SCOPE: recipe images. Batch photos (§13a) are work-order step 10 and need
-- something this does not build — a timestamp the user cannot edit, because in
-- a food audit a timestamp the user controls is worth nothing. `batches.
-- photo_path` has been a nullable column since 0002 and stays unused here
-- rather than being half-wired.
--
-- ══════════════════════════════════════════════════════════════════════════
-- HOW AN OBJECT IS TIED TO A RECIPE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Every object lives at `{recipe_id}/{uuid}.webp`. The first path segment IS
-- the recipe id, which is what lets a storage policy answer "may this caller
-- see this file" by asking the question that is already answered correctly:
-- can they read that recipe?
--
-- That single decision gives §5's privacy rule for free. A personal recipe has
-- `group_id` null, so `can_read_recipe` is false for everybody else and its
-- photo is unreachable — "תמונה של מתכון אישי אינה נגישה לקבוצה" is not a
-- separate rule to maintain, it is the same rule. A GROUP recipe's photo is
-- readable by members exactly when the recipe is, `perm_view` included.
--
-- THE SAFE CAST MATTERS. A policy that RAISES is a broken policy, and
-- `'not-a-uuid'::uuid` raises. `and` is not guaranteed to short-circuit in
-- SQL, so a regex test next to the cast is not enough; `path_recipe_id` uses
-- CASE, where the WHEN is guaranteed to be evaluated before the THEN.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY THE BUCKET ACCEPTS ONLY image/webp
-- ══════════════════════════════════════════════════════════════════════════
--
-- §5 asks for conversion to WebP on upload. A client-side conversion that the
-- server does not insist on is a suggestion: the first code path that forgets
-- it uploads an 8 MB JPEG and nothing complains. `allowed_mime_types` makes
-- the conversion a precondition of the upload succeeding.
--
-- It also has a privacy consequence worth stating: a phone photo carries EXIF,
-- and EXIF carries GPS. Re-encoding through a canvas to produce the WebP drops
-- every EXIF tag, so a photo of a bench does not quietly publish the address
-- of the bakery. That is a side effect of the format rule, and it is the
-- reason not to add "or image/jpeg, to be nice".
--
-- 2 MB, after conversion, is a generous ceiling for a 1600px WebP.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the private bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 2097152, array['image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = 2097152,
       allowed_mime_types = array['image/webp'];

-- ── the index of what is in it ───────────────────────────────────────────────
/*
  A table as well as the bucket, for three things the bucket cannot give:
  an order the user chose, the dimensions (so the UI can reserve the right box
  before the signed URL resolves, instead of reflowing), and a row that RLS can
  attach to the recipe. It mirrors the shape §13a specifies for `batch_photos`.
*/
create table if not exists public.recipe_images (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes (id) on delete cascade,
  /* `{recipe_id}/{uuid}.webp` — unique, so one object cannot be indexed twice */
  storage_path  text not null unique,
  ord           integer not null default 0,
  /* What the client measured after conversion. Nullable because a row is
     still useful without them; the UI falls back to an aspect-ratio box. */
  width         integer,
  height        integer,
  bytes         integer,
  /* The caption a baker writes under a photo. Not alt text — it is content. */
  caption       text not null default '',
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null
);

create index if not exists recipe_images_recipe_idx
  on public.recipe_images (recipe_id, ord, created_at);

alter table public.recipe_images enable row level security;

/*
  Read follows the recipe (so a group member sees a group recipe's photos);
  write follows ownership. `can_read_recipe` and `owns_recipe` are both
  SECURITY INVOKER, so neither grants anything the caller does not have.
*/
drop policy if exists recipe_images_read on public.recipe_images;
create policy recipe_images_read on public.recipe_images
  for select using (public.can_read_recipe(recipe_id));

drop policy if exists recipe_images_write on public.recipe_images;
create policy recipe_images_write on public.recipe_images
  for all
  using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

-- ── the path → recipe id helper ──────────────────────────────────────────────
/**
 * The recipe id at the front of a storage path, or null if there isn't one.
 *
 * CASE, not `and`: `'x'::uuid` raises, SQL does not promise to short-circuit
 * `and`, and a policy that raises refuses everything including the legitimate
 * request. CASE guarantees the WHEN runs first.
 */
create or replace function public.path_recipe_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.split_part(coalesce(p_name, ''), '/', 1) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then pg_catalog.split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function public.path_recipe_id(text) is
  'The recipe id in the first segment of a storage object path, or null. Uses '
  'CASE so a malformed path returns null instead of raising inside a policy.';

-- ── storage.objects: the same two questions, asked of the path ───────────────
/*
  No `alter table storage.objects enable row level security` here. That table
  is owned by `supabase_storage_admin`, not by us, and the statement fails with
  `42501 must be owner of table objects`. It is also unnecessary: Supabase
  ships with RLS already enabled on `storage.objects` and `storage.buckets` —
  checked, both `relrowsecurity = true` — and with no policies at all, which is
  why a private bucket is inaccessible until policies like these are added.
*/

drop policy if exists recipe_images_object_read on storage.objects;
create policy recipe_images_object_read on storage.objects
  for select
  using (
    bucket_id = 'recipe-images'
    and public.can_read_recipe(public.path_recipe_id(name))
  );

drop policy if exists recipe_images_object_insert on storage.objects;
create policy recipe_images_object_insert on storage.objects
  for insert
  with check (
    bucket_id = 'recipe-images'
    and public.owns_recipe(public.path_recipe_id(name))
  );

drop policy if exists recipe_images_object_update on storage.objects;
create policy recipe_images_object_update on storage.objects
  for update
  using (
    bucket_id = 'recipe-images'
    and public.owns_recipe(public.path_recipe_id(name))
  )
  with check (
    bucket_id = 'recipe-images'
    and public.owns_recipe(public.path_recipe_id(name))
  );

drop policy if exists recipe_images_object_delete on storage.objects;
create policy recipe_images_object_delete on storage.objects
  for delete
  using (
    bucket_id = 'recipe-images'
    and public.owns_recipe(public.path_recipe_id(name))
  );

/*
  Deleting the row does NOT delete the object — Postgres cannot reach into
  storage, and a trigger that tried would either need the storage service's
  credentials or would leave the two out of step on failure. The app deletes
  the object first and the row second (see the repository), and an object whose
  row is gone is unreachable anyway: nothing lists the bucket, and a signed URL
  is only ever minted from a row. Orphans cost storage, not privacy.
*/

-- ── grants ───────────────────────────────────────────────────────────────────
grant select on public.recipe_images to anon, authenticated;
grant insert, update, delete on public.recipe_images to authenticated;

revoke all on function public.path_recipe_id(text) from public, anon;
grant execute on function public.path_recipe_id(text) to authenticated;
