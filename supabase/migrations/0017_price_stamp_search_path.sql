-- ─────────────────────────────────────────────────────────────────────────────
-- 0017 — a fixed search_path on the price-stamp trigger
--
-- Supabase's security linter (`function_search_path_mutable`) flags
-- `public.touch_price_updated_at` as the one function in this schema with a
-- role-mutable `search_path`. The finding PREDATES stage 8 — migration 0011
-- created the function without the setting, and every other function in the
-- project has had `set search_path = ''` since it was written. It is fixed here
-- because 0016 had to rewrite this body anyway, and leaving the single
-- outstanding lint in place while touching the function would be a choice.
--
-- The exposure is small and worth stating rather than overselling: the function
-- is SECURITY INVOKER, EXECUTE is revoked from `public`, `anon` and
-- `authenticated`, and the body calls only `now()`. But a trigger body whose
-- name resolution depends on the caller's `search_path` is a hazard that costs
-- nothing to remove.
--
-- `pg_catalog.now()` is qualified explicitly. With `search_path = ''`,
-- pg_catalog is still searched implicitly, so the bare call would resolve — the
-- qualification is so that a reader does not have to know that.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_price_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.purchase_total is not null then
      new.price_updated_at := coalesce(new.price_updated_at, pg_catalog.now());
    end if;
    return new;
  end if;

  if new.purchase_total is distinct from old.purchase_total
     or new.package_qty   is distinct from old.package_qty
     or new.package_count is distinct from old.package_count
     or new.usable_pct    is distinct from old.usable_pct
     or new.purchase_unit is distinct from old.purchase_unit then
    new.price_updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

revoke execute on function public.touch_price_updated_at() from public, anon, authenticated;
