-- ─────────────────────────────────────────────────────────────────────────────
-- 0011 — the ingredient centre: packages, suppliers, and one price per material
--
-- `ingredient_catalog` has existed since 0003 with `key`, `name`, `price`,
-- `price_unit`, `g_per_100`, `water_pct` and `allergens`, RLS and all — and no
-- UI, so it has never held a row. Stage 7 turns it into the source of truth for
-- pricing. What it was missing is the whole of stage-7 requirement 3: nothing
-- is bought in "per kilogram", it is bought in packages.
--
--   flour   a 25 kg sack for ₪110
--   butter  a 200 g pack for ₪8.90
--   cream   1 litre for ₪18
--   eggs    a tray of 30 for ₪39
--
-- WHY `price` AND `price_unit` BECOME GENERATED COLUMNS
--
-- The per-base-unit price is a FUNCTION of the package, so storing it as well
-- would be the duplicate source of truth the instructions rule out — and the
-- one that rots, because nothing stops the two disagreeing. Generated columns
-- make that impossible: Postgres computes them, no client can write them, and
-- they cannot drift from the package they came from.
--
-- The engine already reads `price` + `price_unit` and needs no teaching. The
-- three units it understands are exactly the three base units here:
--   'ק"ג' per kilogram · 'ליטר' per litre · 'יח'' per item
--
-- (Per-item pricing did not actually WORK in the engine before this stage —
-- `יח'` fell through to the per-kilogram formula and undercharged eggs
-- eighteen-fold. Fixed in packages/engine, documented in
-- test/per-unit-price.test.ts.)
--
-- NULL vs 0, WHICH THIS MUST NOT BLUR
--
-- `package_price` NULL means nobody has priced this material. `package_price`
-- 0 means it is free — foraged, donated, a gift from a supplier. The generated
-- expression keeps them apart: 0 / 1 is 0 and stays a price, while NULL
-- anywhere in the inputs gives NULL out. `package_qty = 0` also gives NULL
-- rather than a division error, because a package of nothing has no unit price.
--
-- EXISTING DATA IS NOT MIGRATED, AND THAT IS THE POINT
--
-- Recipes today store `ingredients.price` / `price_unit` per row. Those columns
-- STAY, and stay authoritative for the row that has them: they become an
-- override, and a row with no price of its own inherits from the catalog. So
-- no existing price is rewritten, no explicit 0 is turned into "missing", and
-- no missing price is turned into 0 — there is nothing to lose because nothing
-- is moved. Adopting a central price is an explicit action the user takes per
-- ingredient, never a migration that happens to them.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. what was actually bought ─────────────────────────────────────────────

alter table public.ingredient_catalog
  add column if not exists purchase_unit text not null default 'kg',
  add column if not exists package_qty    numeric(12, 3),
  add column if not exists package_price  numeric(12, 3),
  add column if not exists supplier       text not null default '',
  add column if not exists price_updated_at timestamptz,
  add column if not exists note           text not null default '';

alter table public.ingredient_catalog
  drop constraint if exists ingredient_catalog_purchase_unit_check;
alter table public.ingredient_catalog
  add constraint ingredient_catalog_purchase_unit_check
  check (purchase_unit in ('kg', 'g', 'l', 'ml', 'unit'));

-- A package of a negative amount, or for a negative price, is not a typo worth
-- keeping. Zero PRICE is allowed (free); zero QUANTITY is not (no unit price).
alter table public.ingredient_catalog
  drop constraint if exists ingredient_catalog_package_sane_check;
alter table public.ingredient_catalog
  add constraint ingredient_catalog_package_sane_check
  check (
    (package_qty is null or package_qty > 0)
    and (package_price is null or package_price >= 0)
  );

-- ── 2. the derived per-base-unit price ──────────────────────────────────────
-- Dropped and re-added rather than altered: a plain column cannot be converted
-- to a generated one in place. Safe here because the table has never held a
-- row, and `schema:check` would catch it if that stopped being true.

alter table public.ingredient_catalog drop column if exists price;
alter table public.ingredient_catalog drop column if exists price_unit;

alter table public.ingredient_catalog
  add column price numeric(12, 4) generated always as (
    case
      when package_price is null or package_qty is null or package_qty = 0 then null
      when purchase_unit = 'kg'   then package_price / package_qty
      when purchase_unit = 'g'    then package_price / package_qty * 1000
      when purchase_unit = 'l'    then package_price / package_qty
      when purchase_unit = 'ml'   then package_price / package_qty * 1000
      when purchase_unit = 'unit' then package_price / package_qty
    end
  ) stored;

alter table public.ingredient_catalog
  add column price_unit text generated always as (
    case
      when package_price is null or package_qty is null or package_qty = 0 then null
      when purchase_unit in ('kg', 'g')  then 'ק"ג'
      when purchase_unit in ('l', 'ml')  then 'ליטר'
      when purchase_unit = 'unit'        then 'יח'''
    end
  ) stored;

-- ── 3. when the price last moved ────────────────────────────────────────────
-- Requirement 1 asks for a price-update date. Deriving it from `updated_at`
-- would be wrong: renaming an ingredient or adding an allergen would read as a
-- price change, and "this price is three months old" is a business decision.
-- So it is stamped only when the package actually changes.

create or replace function public.touch_price_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.package_price is not null then
      new.price_updated_at := coalesce(new.price_updated_at, now());
    end if;
    return new;
  end if;

  if new.package_price is distinct from old.package_price
     or new.package_qty  is distinct from old.package_qty
     or new.purchase_unit is distinct from old.purchase_unit then
    new.price_updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.touch_price_updated_at() from public, anon, authenticated;

drop trigger if exists ingredient_catalog_price_stamp on public.ingredient_catalog;
create trigger ingredient_catalog_price_stamp
  before insert or update on public.ingredient_catalog
  for each row execute function public.touch_price_updated_at();

-- ── 4. which recipes a price change would move (requirement 5) ─────────────
-- SECURITY INVOKER, so RLS answers the question: the caller sees their own
-- recipes and nothing else. A recipe counts as affected when it has a row with
-- this ingredient key AND no price of its own — a row with an override is not
-- moved by a change to the centre, and saying it was would be a lie.

create or replace function public.recipes_pricing_on(p_key text)
returns table (id uuid, name text, rows int, overridden int)
language sql
security invoker
stable
set search_path = ''
as $$
  select r.id,
         r.name,
         count(*) filter (where i.price is null)::int      as rows,
         count(*) filter (where i.price is not null)::int   as overridden
    from public.recipes r
    join public.ingredients i on i.recipe_id = r.id
   where i.ingredient_key = p_key
     and i.sub_recipe_id is null
   group by r.id, r.name
   having count(*) filter (where i.price is null) > 0
   order by r.name;
$$;

revoke execute on function public.recipes_pricing_on(text) from public, anon;
grant  execute on function public.recipes_pricing_on(text) to authenticated;

-- ── 5. a version must keep its historical meaning (requirement 5) ──────────
-- `recipe_snapshot` now FREEZES the effective price into each ingredient row.
--
-- This is the resolution of the conflict the instructions name. A live recipe
-- has exactly one source of truth for a price — the catalog — and resolves it
-- at read time, so changing the centre moves every recipe that inherits. A
-- VERSION is not a recipe: it is a frozen document, which is what §9 made it.
-- Freezing the price it used is the same act as freezing the quantities it
-- used, and it is what keeps "this cost ₪18.40 in March" true in June. It is
-- not a second source of truth about today's price, because it is not about
-- today.
--
-- Note `coalesce(i.price, c.price)`: an override wins, exactly as at read time,
-- and NULL survives when neither has a price — a version of a recipe nobody
-- had priced must not acquire a cost retroactively.

create or replace function public.recipe_snapshot(p_recipe_id uuid)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'recipe', (select to_jsonb(r.*) from public.recipes r where r.id = p_recipe_id),
    'ingredients', coalesce((
      select jsonb_agg(
               to_jsonb(i.*)
               || jsonb_build_object(
                    'price',      coalesce(i.price, c.price),
                    'price_unit', coalesce(i.price_unit, c.price_unit)
                  )
               order by i.ord)
        from public.ingredients i
        left join public.ingredient_catalog c
               on c.key = i.ingredient_key
              and c.owner_id = (select owner_id from public.recipes where id = p_recipe_id)
       where i.recipe_id = p_recipe_id
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(to_jsonb(s.*) order by s.ord)
        from public.steps s where s.recipe_id = p_recipe_id
    ), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(to_jsonb(x.*) order by x.ord)
        from public.issues x where x.recipe_id = p_recipe_id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.recipe_snapshot(uuid) from public, anon;
grant  execute on function public.recipe_snapshot(uuid) to authenticated;
