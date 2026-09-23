-- ─────────────────────────────────────────────────────────────────────────────
-- 0040 — the account that uploaded a photograph can still SEE it after the
--        recipe it belonged to is gone, so that it can be removed
--
-- ADDITIVE. One policy is re-created with one more way to satisfy it. No
-- table changes, no data touched, nothing revoked. Nobody gains read over
-- anyone else's file: `owner_id = auth.uid()` is the uploader and only the
-- uploader.
--
-- WHY
--
-- 0039 let the uploader DELETE a file after the recipe row is gone, and the
-- app now deletes the row first and the files after (a refused delete leaves
-- everything as it was). QA 22.09.2026 (status check, finding S1) showed the
-- delete still did nothing: Supabase Storage's `remove()` first SELECTS the
-- objects it was asked to remove, under the READ policy, and only deletes the
-- ones it found. 0029's read policy recognises a reader THROUGH THE RECIPE
-- (`can_read_recipe(path_recipe_id(name))`), and once the row is gone there
-- is nothing to look up — so the select found nothing, `remove()` returned
-- `200 []`, and the files stayed in the bucket as orphans, invisible to
-- everyone and paid for by nobody in particular.
--
-- The one fact that survives the row is who uploaded the file: storage sets
-- `owner_id` to the uploader's auth uid on every insert. Adding it to the
-- read policy — exactly as 0039 added it to the delete policy — lets the
-- uploader's own `remove()` find its own files after the row is gone.
--
-- WHAT IT DOES NOT ALLOW
--
-- A student who copied a shared recipe uploaded the copies as themselves, so
-- the copies are theirs and the originals stay the instructor's; nobody can
-- read a file they did not upload unless they can read the recipe it belongs
-- to, as before. Inserting and updating are untouched.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook) on 23.09.2026,
-- with explicit approval (spec stage 3א, A-11).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists recipe_images_object_read on storage.objects;
create policy recipe_images_object_read on storage.objects
  for select
  using (
    bucket_id = 'recipe-images'
    and (
      public.can_read_recipe(public.path_recipe_id(name))
      or owner_id = (select auth.uid())::text
    )
  );
