-- ─────────────────────────────────────────────────────────────────────────────
-- 0038 — where a photograph is looked at: two numbers on recipe_images
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
-- ══════════════════════════════════════════════════════════════════════════
--
-- Ahmed asked for the recipe's photograph at the top of its screen, and for
-- the person editing it to be able to "להתאים חיתוך או מיקום… שמור את התמונה
-- ואת התאמת החיתוך במנגנון השמירה הקיים".
--
-- The hero is a fixed-height band — `clamp(170px, 30vh, 300px)` — with
-- `object-fit: cover`, because a photograph that is stretched to fit a band is
-- the defect he asked to avoid. Cover means the browser crops, and by default
-- it crops from the CENTRE. On a tall photo of a cake, the centre is the
-- middle of the cake; on a photo of a tray shot from above, the centre is
-- often nothing. So the person choosing where the crop sits is the whole
-- feature, and the thing that has to be remembered is WHERE THEY LOOKED:
-- one point, as a percentage of the image, which `object-position` then uses.
--
-- WHY A FOCAL POINT AND NOT A CROP RECTANGLE
--
-- A crop rectangle would mean re-encoding the picture and throwing pixels
-- away — irreversible, lossy, and a second copy in the bucket for every
-- adjustment. A focal point is two numbers that change nothing about the
-- file: the original stays whole, the adjustment is free to change again, and
-- the same photograph crops correctly in the 16:9 hero, in the square
-- notebook thumbnail and in whatever box comes next, because each box applies
-- the same point to its own shape. That is the property a rectangle cannot
-- have.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY NUMERIC AND WHY CLAMPED IN THE DATABASE
-- ══════════════════════════════════════════════════════════════════════════
--
-- 0..100, a percentage, which is what `object-position` takes. The CHECK is
-- not decoration: these values come from a drag gesture in a browser, and a
-- browser that sends 5000 would push the picture out of its own box on every
-- screen that reads it afterwards. A column that cannot hold a wrong value
-- does not need every reader to defend itself.
--
-- 50/50 is the default, which is exactly what `cover` does with no position at
-- all — so every row that exists today keeps the appearance it has now, and
-- this migration changes nothing on screen until somebody drags something.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.recipe_images
  add column if not exists focal_x numeric(5, 2) not null default 50
    check (focal_x >= 0 and focal_x <= 100),
  add column if not exists focal_y numeric(5, 2) not null default 50
    check (focal_y >= 0 and focal_y <= 100);

comment on column public.recipe_images.focal_x is
  'Horizontal focal point, 0-100%, fed to CSS object-position. 50 = centre, '
  'which is what object-fit: cover does on its own.';
comment on column public.recipe_images.focal_y is
  'Vertical focal point, 0-100%. See focal_x.';

-- ── who may move it ──────────────────────────────────────────────────────────
/*
  NOBODY NEW.

  `recipe_images_write` already covers this table `for all` with
  `owns_recipe(recipe_id)`, so moving the focal point is an UPDATE that the
  existing policy governs: the recipe's owner may, and nobody else may. This
  migration adds no policy, no grant and no function, which is the point —
  Ahmed's rule is that only somebody who may edit the recipe may change its
  picture, and that rule was already enforced one level up.

  Stated here rather than assumed, because "an UPDATE is covered by a FOR ALL
  policy" is exactly the kind of thing worth checking rather than believing.
*/
