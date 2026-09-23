-- ─────────────────────────────────────────────────────────────────────────────
-- 0012 — the sale price the user actually charges
--
-- Stage-7 requirement 4 asks a recipe to show both "מחיר מכירה, אם המשתמש
-- הגדיר אותו" and "Food Cost %", where Food Cost is cost ÷ sale price × 100.
--
-- The engine already computes a price, and it is the OTHER direction: from
-- `target_fc` it derives the price you would have to charge to hit that food
-- cost. That is a suggestion. Requirement 4 wants the measurement — what the
-- item is really sold for, and therefore what the food cost really is. The two
-- are both useful and neither can be derived from the other, so this is a new
-- fact and not a duplicate.
--
-- NULL means the user has not set a sale price, and then there is no food cost
-- to show. 0 is allowed and means the item is given away, which is a real
-- thing a bakery does — and it makes the food cost undefined rather than zero,
-- because dividing by it is not a number. The screen must distinguish those
-- two cases from each other and from a genuine 0%.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.recipes
  add column if not exists sale_price numeric(12, 3);

alter table public.recipes
  drop constraint if exists recipes_sale_price_check;
alter table public.recipes
  add constraint recipes_sale_price_check
  check (sale_price is null or sale_price >= 0);
