-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — production planning and purchasing
--
-- WHAT IS STORED HERE AND WHAT IS NOT (requirement 14, decided explicitly)
--
-- A production plan stores INTENT: a date, which products, how many, when they
-- must be ready, and optionally how much of a material the user already has.
-- It stores NO requirement, NO purchase list and NO cost, because all three are
-- derived from the recipes and the ingredient centre — and deriving them is the
-- whole point. A plan opened next week shows next week's prices, which is what
-- a plan for next week should show.
--
-- The exception is a plan the user marks as DONE. Then it stops being a plan
-- and becomes a record of what happened, and a record whose costs move is not a
-- record. `locked` + `snapshot` freeze it, exactly as a recipe version freezes
-- the prices it was taken with (stage 7, §5). The rule is one line and has no
-- middle: LOCKED → read the snapshot. NOT LOCKED → compute live. Unlocking
-- clears the snapshot, because a plan being edited again is not a record of
-- anything. Nothing is written twice while a plan is live, so there is no
-- second source of truth about today's prices.
--
-- WHY `on_hand` IS ITS OWN TABLE AND NULLABLE
--
-- Requirement 5: this is NOT an inventory system, and must not become one by
-- accident. `production_plan_stock` holds what the user typed into the purchase
-- list of THIS plan and nothing else — no movements, no balances, no history.
-- `on_hand` is NULLABLE and that is load-bearing: NULL means "nobody said what
-- is in the store room", and then only the requirement is shown. It does NOT
-- mean zero, and assuming zero would tell someone to buy 12 kg of flour they
-- already have.
--
-- WHY `steps.kind` EXISTS (requirement 8)
--
-- Requirement 8 asks the timeline to distinguish active work, passive rest,
-- refrigeration, proofing and baking "כאשר הנתונים מאפשרים". The data did not
-- allow it: a step held text, a temperature and a duration, and nothing that
-- says what KIND of waiting 90 minutes is. Inferring it from the Hebrew text
-- would be exactly the invention the instructions forbid, so the field is added
-- and the user fills it. NULL = not classified, and the timeline says so
-- rather than guessing. A temperature is real data, so the one inference that
-- IS made (≤ 8 °C reads as refrigeration, ≥ 100 °C as baking/cooking) is made
-- from the temperature alone, in the client, and labelled as derived from it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. what kind of step it is ──────────────────────────────────────────────

alter table public.steps
  add column if not exists kind text;

alter table public.steps
  drop constraint if exists steps_kind_check;
alter table public.steps
  add constraint steps_kind_check
  check (kind is null or kind in ('active', 'passive', 'chill', 'proof', 'bake'));

-- ── 2. the plan ─────────────────────────────────────────────────────────────

create table if not exists public.production_plans (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null default '',
  plan_date  date not null default current_date,
  note       text not null default '',
  -- Requirement 14. `locked` and `snapshot` move together: a locked plan has a
  -- snapshot and reads from it, an unlocked plan has neither.
  locked     boolean not null default false,
  locked_at  timestamptz,
  snapshot   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint production_plans_lock_check
    check ((locked and snapshot is not null) or (not locked and snapshot is null))
);

create index if not exists production_plans_owner_date_idx
  on public.production_plans (owner_id, plan_date desc);

create trigger production_plans_touch
  before update on public.production_plans
  for each row execute function public.touch_updated_at();

-- ── 3. the products in it ───────────────────────────────────────────────────

create table if not exists public.production_plan_items (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.production_plans (id) on delete cascade,
  -- A plan line without its recipe means nothing, so it goes with the recipe.
  -- A LOCKED plan keeps its content in the snapshot, which is what makes this
  -- safe: the record of what was produced survives the recipe being deleted.
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ord       integer not null default 0,
  qty       numeric(12, 3) not null,
  qty_unit  text not null default 'unit',
  -- The hour the product must be READY. NULL = the user did not say, and then
  -- there is no timeline for this line rather than an invented one.
  ready_at  time,
  note      text not null default '',

  constraint production_plan_items_unit_check
    check (qty_unit in ('unit', 'kg', 'g')),
  constraint production_plan_items_qty_check check (qty > 0)
);

create index if not exists production_plan_items_plan_idx
  on public.production_plan_items (plan_id, ord);

-- ── 4. what the user already has (requirement 5) ────────────────────────────

create table if not exists public.production_plan_stock (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references public.production_plans (id) on delete cascade,
  -- The ingredient identity the whole app uses, so this aggregates with the
  -- catalog and with the recipe rows and not by a display string.
  key      text not null,
  -- NULLABLE ON PURPOSE. NULL = not entered; 0 = there is none of it left.
  on_hand  numeric(12, 3),

  constraint production_plan_stock_uniq unique (plan_id, key),
  constraint production_plan_stock_check check (on_hand is null or on_hand >= 0)
);

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

-- The same shape as `owns_recipe`: the children join through the parent, so one
-- policy decides everything and a child cannot be reached without the plan.
create or replace function public.owns_plan(p_plan_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.production_plans p
    where p.id = p_plan_id and p.owner_id = (select auth.uid())
  );
$$;

revoke execute on function public.owns_plan(uuid) from public, anon;
grant  execute on function public.owns_plan(uuid) to authenticated;

alter table public.production_plans      enable row level security;
alter table public.production_plan_items enable row level security;
alter table public.production_plan_stock enable row level security;

drop policy if exists production_plans_own on public.production_plans;
create policy production_plans_own on public.production_plans
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists production_plan_items_via_plan on public.production_plan_items;
create policy production_plan_items_via_plan on public.production_plan_items
  for all
  using (public.owns_plan(plan_id))
  with check (public.owns_plan(plan_id));

drop policy if exists production_plan_stock_via_plan on public.production_plan_stock;
create policy production_plan_stock_via_plan on public.production_plan_stock
  for all
  using (public.owns_plan(plan_id))
  with check (public.owns_plan(plan_id));

-- ── 6. a plan line may not point at another account's recipe ────────────────
--
-- RLS does NOT apply to foreign-key validation, and the FK above is satisfied
-- by ANY existing recipe. So the same hole stage 5 found in `sub_recipe_id` is
-- open here, and it is closed the same way: a trigger that compares owners.
-- SECURITY DEFINER because it must see the recipe row the caller cannot —
-- which is the point, and why it answers only yes or no.

create or replace function public.check_plan_item_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_owner   uuid;
  v_recipe_owner uuid;
begin
  select owner_id into v_plan_owner
    from public.production_plans where id = new.plan_id;
  select owner_id into v_recipe_owner
    from public.recipes where id = new.recipe_id;

  if v_plan_owner is null then
    raise exception 'התוכנית לא נמצאה' using errcode = 'no_data_found';
  end if;
  -- Deliberately the same message for "not yours" and "does not exist": a
  -- distinct error would answer the question "does this recipe id exist in
  -- somebody else's account".
  if v_recipe_owner is null or v_recipe_owner <> v_plan_owner then
    raise exception 'המתכון אינו של החשבון הזה' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_plan_item_owner() from public, anon, authenticated;

drop trigger if exists production_plan_items_owner_guard on public.production_plan_items;
create trigger production_plan_items_owner_guard
  before insert or update of plan_id, recipe_id on public.production_plan_items
  for each row execute function public.check_plan_item_owner();

-- ── 7. saving a plan: one transaction ───────────────────────────────────────

create or replace function public.save_production_plan(
  p_plan                jsonb,
  p_items               jsonb default '[]'::jsonb,
  p_stock               jsonb default '[]'::jsonb,
  p_plan_id             uuid default null,
  p_expected_updated_at timestamptz default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_id      uuid;
  v_owner   uuid;
  v_updated timestamptz;
  v_locked  boolean;
begin
  if v_uid is null then
    raise exception 'לא ניתן לשמור בלי התחברות' using errcode = 'insufficient_privilege';
  end if;

  if p_plan_id is null then
    insert into public.production_plans (owner_id, name, plan_date, note)
    values (v_uid,
            coalesce(p_plan->>'name', ''),
            coalesce((p_plan->>'plan_date')::date, current_date),
            coalesce(p_plan->>'note', ''))
    returning id into v_id;
  else
    v_id := p_plan_id;

    select owner_id, updated_at, locked into v_owner, v_updated, v_locked
      from public.production_plans where id = v_id for update;

    if v_owner is null then
      raise exception 'התוכנית לא נמצאה' using errcode = 'no_data_found';
    end if;
    if v_owner <> v_uid then
      raise exception 'התוכנית אינה של החשבון הזה' using errcode = 'insufficient_privilege';
    end if;
    -- A locked plan is a record of what happened. Editing it would make it a
    -- record of something else.
    if v_locked then
      raise exception 'התוכנית סומנה כבוצעה. יש לבטל את הסימון לפני עריכה.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_expected_updated_at is not null
       and v_updated is distinct from p_expected_updated_at then
      raise exception 'התוכנית שונתה במקום אחר מאז שנטענה. יש לרענן ולנסות שוב.'
        using errcode = 'serialization_failure';
    end if;

    update public.production_plans set
      name      = coalesce(p_plan->>'name', ''),
      plan_date = coalesce((p_plan->>'plan_date')::date, current_date),
      note      = coalesce(p_plan->>'note', '')
    where id = v_id;
  end if;

  -- Replaced wholesale, like a recipe's children: the payload is the plan.
  delete from public.production_plan_items where plan_id = v_id;
  delete from public.production_plan_stock where plan_id = v_id;

  insert into public.production_plan_items
    (plan_id, recipe_id, ord, qty, qty_unit, ready_at, note)
  select v_id,
         (e->>'recipe_id')::uuid,
         coalesce((e->>'ord')::int, (ord - 1)::int),
         (e->>'qty')::numeric,
         coalesce(nullif(e->>'qty_unit', ''), 'unit'),
         nullif(e->>'ready_at', '')::time,
         coalesce(e->>'note', '')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  insert into public.production_plan_stock (plan_id, key, on_hand)
  select v_id,
         e->>'key',
         -- `nullif(...,'')` and NOT coalesce: an empty field must stay NULL,
         -- and a typed 0 must stay 0.
         nullif(e->>'on_hand', '')::numeric
    from jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) as e
   where coalesce(e->>'key', '') <> '';

  return v_id;
end;
$$;

revoke execute on function public.save_production_plan(jsonb, jsonb, jsonb, uuid, timestamptz)
  from public, anon;
grant  execute on function public.save_production_plan(jsonb, jsonb, jsonb, uuid, timestamptz)
  to authenticated;

-- ── 8. locking, unlocking and deleting ──────────────────────────────────────

create or replace function public.set_plan_locked(
  p_plan_id  uuid,
  p_locked   boolean,
  p_snapshot jsonb default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'לא ניתן לשנות בלי התחברות' using errcode = 'insufficient_privilege';
  end if;

  select owner_id into v_owner
    from public.production_plans where id = p_plan_id for update;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'התוכנית אינה של החשבון הזה' using errcode = 'insufficient_privilege';
  end if;

  if p_locked then
    if p_snapshot is null then
      raise exception 'לא ניתן לנעול תוכנית בלי snapshot' using errcode = 'check_violation';
    end if;
    update public.production_plans
       set locked = true, locked_at = now(), snapshot = p_snapshot
     where id = p_plan_id;
  else
    -- The snapshot goes with the lock. A plan being edited again is not a
    -- record of anything, and keeping a stale frozen cost beside a live one is
    -- the second source of truth requirement 14 forbids.
    update public.production_plans
       set locked = false, locked_at = null, snapshot = null
     where id = p_plan_id;
  end if;
end;
$$;

revoke execute on function public.set_plan_locked(uuid, boolean, jsonb) from public, anon;
grant  execute on function public.set_plan_locked(uuid, boolean, jsonb) to authenticated;

create or replace function public.delete_production_plan(p_plan_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'לא ניתן למחוק בלי התחברות' using errcode = 'insufficient_privilege';
  end if;
  -- RLS already hides another account's plan, so this is a silent no-op for an
  -- id that is not the caller's — the same answer as for an id that does not
  -- exist, which is the only answer that leaks nothing.
  delete from public.production_plans
   where id = p_plan_id and owner_id = v_uid;
end;
$$;

revoke execute on function public.delete_production_plan(uuid) from public, anon;
grant  execute on function public.delete_production_plan(uuid) to authenticated;
