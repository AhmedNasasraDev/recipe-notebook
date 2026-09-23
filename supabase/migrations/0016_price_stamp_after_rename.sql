-- ─────────────────────────────────────────────────────────────────────────────
-- 0016 — the price-stamp trigger, after the 0013 rename
--
-- A REAL DEFECT, mine, introduced by 0013 and found by running
-- supabase/tests/costing.sql against the live database:
--
--     record "new" has no field "package_price"
--     CONTEXT: SQL expression "new.package_price is not null"
--              PL/pgSQL function public.touch_price_updated_at() line 4
--
-- `touch_price_updated_at` (0011) fires BEFORE every insert and update on
-- `ingredient_catalog` and read `new.package_price` — which 0013 renamed to
-- `purchase_total`. A plpgsql body is not dependency-checked against a column
-- rename, so the rename applied cleanly and then EVERY write to the ingredient
-- centre failed at runtime: the catalog was effectively read-only.
--
-- WHY NO TEST CAUGHT IT BEFORE THIS ONE. The web suite's double models the
-- generated columns but not the triggers, so it stamped the date itself and
-- passed. Only a real write to real Postgres could show this, which is exactly
-- what the live suites are for — and it is the second defect in a row that
-- only the live run found (see 0015).
--
-- The stamp now watches every fact the price is derived FROM, which after 0013
-- is four columns rather than two: a change to the number of packages or to the
-- usable yield moves the price just as surely as a change to the total paid.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_price_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.purchase_total is not null then
      new.price_updated_at := coalesce(new.price_updated_at, now());
    end if;
    return new;
  end if;

  -- Every input to the generated price. Renaming the material or adding an
  -- allergen still does NOT stamp it — "this price is three months old" has to
  -- stay true.
  if new.purchase_total is distinct from old.purchase_total
     or new.package_qty   is distinct from old.package_qty
     or new.package_count is distinct from old.package_count
     or new.usable_pct    is distinct from old.usable_pct
     or new.purchase_unit is distinct from old.purchase_unit then
    new.price_updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.touch_price_updated_at() from public, anon, authenticated;
