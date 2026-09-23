-- ─────────────────────────────────────────────────────────────────────────────
-- 0013 — professional costing: purchases as they happen, yield, and profit
--
-- Stage 7 made the catalog the single source of truth for a price, and asked
-- for the package: one package, its quantity, its price. Stage 8's requirement
-- A asks for the purchase as it is ACTUALLY made, which is not the same shape:
--
--     "המחיר הכולל ששולם · מספר אריזות · כמות בכל אריזה"
--
-- Nobody divides ₪72 by six packs of 500 g in their head at the counter. So
-- `package_price` (the price of ONE package) becomes `purchase_total` (what was
-- paid), and `package_count` joins it. The four scenarios the requirement names:
--
--   1 × 5 kg      for ₪200  →  5 kg   →  ₪40/kg  →  ₪4/100g  →  ₪0.04/g
--   6 × 500 g     for ₪72   →  3 kg   →  ₪24/kg
--   1 × 30 units  for ₪39   →  30 u   →  ₪1.30/unit
--   12 × 1 L      for ₪180  →  12 L   →  ₪15/L
--
-- REQUIREMENT B: ONE SOURCE OF TRUTH, EVERYTHING ELSE DERIVED
--
-- `purchase_total`, `package_count`, `package_qty` and `purchase_unit` are the
-- facts. Every price per unit is a GENERATED STORED column computed from them,
-- so ₪/kg, ₪/100g and ₪/g cannot drift from each other or from the receipt —
-- they are one number rendered at three scales, and the UI derives those three
-- from the base without storing any of them.
--
-- REQUIREMENT D: PURCHASE COST IS NOT USABLE COST
--
-- Buy 10 kg for ₪200 and clean it down to 8 kg, and the kilo that goes into the
-- product cost ₪25, not ₪20. `usable_pct` is OPTIONAL — NULL means nobody has
-- declared a yield, and then the two costs are the same number.
--
-- Two generated columns, and which is which matters:
--   purchase_price  ₪ per base unit AS BOUGHT       — shown, for comparison
--   price           ₪ per base unit USABLE          — what the ENGINE reads
--
-- The engine gets the usable cost because a recipe's quantities refer to
-- cleaned, usable product. `price` keeps its name so nothing downstream changes.
--
-- REQUIREMENT C: NO SILENT OVERWRITE
--
-- `ingredient_purchases` is the log. Every purchase is appended, never
-- replaced, and `record_purchase()` does the append and the update to the
-- active price in ONE transaction — so there is no state where history and
-- active price disagree. The ACTIVE price is unambiguous: it is the row in
-- `ingredient_catalog`. The log is history, and a version snapshot keeps the
-- frozen price stage 7 gave it, untouched by any of this.
--
-- REQUIREMENT E: THE COST BREAKDOWN IS ENTERED, NEVER INVENTED
--
-- `packaging_cost`, `labor_cost`, `other_cost` on `recipes`, all NULL by
-- default. Nothing is derived from a rent or an overhead model, because there
-- is no such model and inventing one would produce a number that looks like a
-- measurement. NULL means "not entered"; 0 means "there is none", and the
-- screen says which.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. the purchase, as it was made ─────────────────────────────────────────

alter table public.ingredient_catalog drop column if exists price;
alter table public.ingredient_catalog drop column if exists price_unit;

alter table public.ingredient_catalog
  rename column package_price to purchase_total;

alter table public.ingredient_catalog
  add column if not exists package_count numeric(12, 3) not null default 1,
  add column if not exists usable_pct    numeric(6, 3),
  add column if not exists purchased_at  date;

alter table public.ingredient_catalog
  drop constraint if exists ingredient_catalog_package_sane_check;
alter table public.ingredient_catalog
  add constraint ingredient_catalog_package_sane_check
  check (
    (package_qty    is null or package_qty > 0)
    and (purchase_total is null or purchase_total >= 0)   -- 0 is free, and legal
    and package_count > 0
    -- A yield of 0% means nothing usable comes out, so there is no usable cost
    -- to compute; above 100% means the cleaning created matter.
    and (usable_pct is null or (usable_pct > 0 and usable_pct <= 100))
  );

-- ── 2. every price per unit, derived ────────────────────────────────────────
-- total quantity bought, in the purchase unit
create or replace function public.purchase_base_qty(
  p_unit text, p_count numeric, p_qty numeric
) returns numeric
language sql immutable
set search_path = ''
as $$
  -- Normalised to the BASE unit: kilograms, litres, or items.
  select case
    when p_qty is null or p_count is null or p_qty <= 0 or p_count <= 0 then null
    when p_unit = 'kg'   then p_count * p_qty
    when p_unit = 'g'    then p_count * p_qty / 1000
    when p_unit = 'l'    then p_count * p_qty
    when p_unit = 'ml'   then p_count * p_qty / 1000
    when p_unit = 'unit' then p_count * p_qty
  end;
$$;

revoke execute on function public.purchase_base_qty(text, numeric, numeric) from public, anon;
grant  execute on function public.purchase_base_qty(text, numeric, numeric) to authenticated;

alter table public.ingredient_catalog
  add column purchase_price numeric(14, 6) generated always as (
    case
      when purchase_total is null then null
      when public.purchase_base_qty(purchase_unit, package_count, package_qty) is null then null
      else purchase_total / public.purchase_base_qty(purchase_unit, package_count, package_qty)
    end
  ) stored;

alter table public.ingredient_catalog
  add column price numeric(14, 6) generated always as (
    case
      when purchase_total is null then null
      when public.purchase_base_qty(purchase_unit, package_count, package_qty) is null then null
      -- NULL usable_pct = no yield declared, so usable cost IS purchase cost.
      else purchase_total
           / public.purchase_base_qty(purchase_unit, package_count, package_qty)
           / (coalesce(usable_pct, 100) / 100)
    end
  ) stored;

alter table public.ingredient_catalog
  add column price_unit text generated always as (
    case
      when purchase_total is null then null
      when public.purchase_base_qty(purchase_unit, package_count, package_qty) is null then null
      when purchase_unit in ('kg', 'g')  then 'ק"ג'
      when purchase_unit in ('l', 'ml')  then 'ליטר'
      when purchase_unit = 'unit'        then 'יח'''
    end
  ) stored;

-- ── 3. the purchase log (requirement C) ─────────────────────────────────────

create table if not exists public.ingredient_purchases (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- The key, not the catalog id: a purchase is a record of what was bought and
  -- must survive the material being renamed or re-created.
  key            text not null,
  purchase_unit  text not null,
  package_count  numeric(12, 3) not null default 1,
  package_qty    numeric(12, 3),
  purchase_total numeric(12, 3),
  usable_pct     numeric(6, 3),
  supplier       text not null default '',
  purchased_at   date not null default current_date,
  note           text not null default '',
  created_at     timestamptz not null default now(),

  constraint ingredient_purchases_unit_check
    check (purchase_unit in ('kg', 'g', 'l', 'ml', 'unit')),
  constraint ingredient_purchases_sane_check
    check (
      (package_qty is null or package_qty > 0)
      and (purchase_total is null or purchase_total >= 0)
      and package_count > 0
      and (usable_pct is null or (usable_pct > 0 and usable_pct <= 100))
    )
);

-- The same derivations, so a history row can be compared with the active price
-- without the client recomputing anything.
alter table public.ingredient_purchases
  drop column if exists purchase_price,
  drop column if exists price,
  drop column if exists price_unit;

alter table public.ingredient_purchases
  add column purchase_price numeric(14, 6) generated always as (
    case
      when purchase_total is null then null
      when public.purchase_base_qty(purchase_unit, package_count, package_qty) is null then null
      else purchase_total / public.purchase_base_qty(purchase_unit, package_count, package_qty)
    end
  ) stored,
  add column price numeric(14, 6) generated always as (
    case
      when purchase_total is null then null
      when public.purchase_base_qty(purchase_unit, package_count, package_qty) is null then null
      else purchase_total
           / public.purchase_base_qty(purchase_unit, package_count, package_qty)
           / (coalesce(usable_pct, 100) / 100)
    end
  ) stored;

create index if not exists ingredient_purchases_owner_key_idx
  on public.ingredient_purchases (owner_id, key, purchased_at desc, created_at desc);

alter table public.ingredient_purchases enable row level security;

-- Requirement I: purchase prices, suppliers and totals are private business
-- data. One policy, no exceptions, no system rows.
drop policy if exists ingredient_purchases_own on public.ingredient_purchases;
create policy ingredient_purchases_own on public.ingredient_purchases
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ── 4. recording a purchase: the log and the active price, together ────────

create or replace function public.record_purchase(
  p_key            text,
  p_name           text,
  p_purchase_unit  text,
  p_package_count  numeric,
  p_package_qty    numeric,
  p_purchase_total numeric,
  p_usable_pct     numeric,
  p_supplier       text,
  p_purchased_at   date,
  p_note           text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'אין משתמש מחובר' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_key), '') = '' then
    raise exception 'לחומר גלם חייב להיות שם' using errcode = 'check_violation';
  end if;

  -- The log first. Appended, never replaced: requirement C forbids a silent
  -- overwrite, and a history that can be lost is not a history.
  insert into public.ingredient_purchases
    (owner_id, key, purchase_unit, package_count, package_qty, purchase_total,
     usable_pct, supplier, purchased_at, note)
  values
    (v_owner, trim(p_key), p_purchase_unit, coalesce(p_package_count, 1), p_package_qty,
     p_purchase_total, p_usable_pct, coalesce(p_supplier, ''),
     coalesce(p_purchased_at, current_date), coalesce(p_note, ''))
  returning id into v_id;

  -- Then the ACTIVE price, which is unambiguously the catalog row.
  insert into public.ingredient_catalog
    (owner_id, key, name, purchase_unit, package_count, package_qty,
     purchase_total, usable_pct, supplier, purchased_at, note)
  values
    (v_owner, trim(p_key), coalesce(nullif(trim(p_name), ''), trim(p_key)),
     p_purchase_unit, coalesce(p_package_count, 1), p_package_qty,
     p_purchase_total, p_usable_pct, coalesce(p_supplier, ''),
     coalesce(p_purchased_at, current_date), coalesce(p_note, ''))
  on conflict (owner_id, key) do update set
    name           = excluded.name,
    purchase_unit  = excluded.purchase_unit,
    package_count  = excluded.package_count,
    package_qty    = excluded.package_qty,
    purchase_total = excluded.purchase_total,
    usable_pct     = excluded.usable_pct,
    supplier       = excluded.supplier,
    purchased_at   = excluded.purchased_at,
    note           = excluded.note;

  return v_id;
end;
$$;

revoke execute on function public.record_purchase(text, text, text, numeric, numeric, numeric, numeric, text, date, text)
  from public, anon;
grant  execute on function public.record_purchase(text, text, text, numeric, numeric, numeric, numeric, text, date, text)
  to authenticated;

-- ── 5. the history, with the change from the purchase before it ────────────

create or replace function public.purchase_history(p_key text)
returns table (
  id             uuid,
  purchased_at   date,
  supplier       text,
  purchase_unit  text,
  package_count  numeric,
  package_qty    numeric,
  purchase_total numeric,
  usable_pct     numeric,
  purchase_price numeric,
  price          numeric,
  prev_price     numeric,
  pct_change     numeric
)
language sql
security invoker
stable
set search_path = ''
as $$
  -- Newest first. `prev_price` is the USABLE price of the purchase before it,
  -- so the change the user sees is the change in what the material really
  -- costs them, not in what the receipt happened to say.
  select h.id, h.purchased_at, h.supplier, h.purchase_unit, h.package_count,
         h.package_qty, h.purchase_total, h.usable_pct, h.purchase_price, h.price,
         h.prev_price,
         case
           when h.prev_price is null or h.prev_price = 0 or h.price is null then null
           else (h.price - h.prev_price) / h.prev_price * 100
         end as pct_change
    from (
      select p.*,
             lag(p.price) over (order by p.purchased_at, p.created_at) as prev_price
        from public.ingredient_purchases p
       where p.key = p_key
    ) h
   order by h.purchased_at desc, h.created_at desc;
$$;

revoke execute on function public.purchase_history(text) from public, anon;
grant  execute on function public.purchase_history(text) to authenticated;

-- ── 6. the product cost breakdown and the sale side ───────────────────────

alter table public.recipes
  add column if not exists packaging_cost  numeric(12, 3),
  add column if not exists labor_cost      numeric(12, 3),
  add column if not exists other_cost      numeric(12, 3),
  -- Is `sale_price` the price of the whole batch or of one unit? Guessing is
  -- the difference between a 5% and a 500% food cost, so it is stored.
  add column if not exists sale_price_basis text not null default 'batch',
  add column if not exists target_gm       numeric(6, 3);

alter table public.recipes
  drop constraint if exists recipes_costing_check;
alter table public.recipes
  add constraint recipes_costing_check
  check (
    (packaging_cost is null or packaging_cost >= 0)
    and (labor_cost is null or labor_cost >= 0)
    and (other_cost is null or other_cost >= 0)
    and sale_price_basis in ('batch', 'unit')
    -- A gross margin of 100% would need an infinite price; at or above it
    -- there is no price to compute.
    and (target_gm is null or (target_gm >= 0 and target_gm < 100))
  );
