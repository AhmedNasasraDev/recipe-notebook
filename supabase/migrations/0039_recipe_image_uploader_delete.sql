-- ─────────────────────────────────────────────────────────────────────────────
-- 0039 — a photograph may be deleted by the account that uploaded it, even
--        after the recipe it belonged to is gone
--
-- ADDITIVE. One policy is re-created with one more way to satisfy it. No
-- table changes, no data touched, nothing revoked, nothing widened for anyone
-- but the uploader of a file acting on that file.
--
-- WHY
--
-- 0029's delete policy recognises the owner THROUGH THE RECIPE: the object's
-- path starts with the recipe id, and `owns_recipe()` looks the recipe up.
-- Once the recipe row is deleted there is nothing to look up, so its files
-- could only be removed BEFORE the row — and that order lost photographs (QA
-- 22.09.2026, acceptance finding 2): the files were removed, the delete of
-- the recipe was then refused by a dropped connection, and the recipe stayed
-- on screen without its pictures, for good.
--
-- The right order is the row first and the files after, so a refused delete
-- leaves everything as it was. For that the files have to stay deletable
-- after the row is gone, and the one fact that survives the row is who
-- uploaded the file: storage sets `owner_id` to the uploader's auth uid on
-- every insert. That is the second clause below.
--
-- WHAT IT DOES NOT ALLOW
--
-- Nobody gains delete over anyone else's file: `owner_id = auth.uid()` is the
-- uploader and only the uploader. A student copying a shared recipe uploads
-- the copies as themselves (`copyRecipeImages` runs as the copying account),
-- so the copies are theirs and the originals stay the instructor's. Reading,
-- inserting and updating are untouched.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook) on 22.09.2026,
-- with approval for additive migrations on the image chain.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists recipe_images_object_delete on storage.objects;
create policy recipe_images_object_delete on storage.objects
  for delete
  using (
    bucket_id = 'recipe-images'
    and (
      public.owns_recipe(public.path_recipe_id(name))
      or owner_id = (select auth.uid())::text
    )
  );
