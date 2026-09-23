-- ─────────────────────────────────────────────────────────────────────────────
-- 0002 — recipes, ingredients, steps, issues, trials, batches
--
-- Transcribed from HANDOFF §1 and the Recipe / Ingredient / Step / Batch shapes
-- in spec §1.1. Work-order step 2 ("the notebook works against the DB").
--
-- Two documented deferrals, both because groups are explicitly out of scope for
-- this stage:
--   • recipes.group_id and recipes.saved_from_item_id exist as nullable uuid
--     columns WITHOUT their foreign keys. The groups migration adds the
--     constraints; the columns are here now so nothing has to be back-filled.
--   • The group branch of the recipes SELECT policy is marked below and is added
--     by that same migration. The personal branch is complete and enforced.
--
-- One naming note: spec §1.1 calls the batch temperature fields tempIn/tempOut
-- while the prototype stores coreTemp/chillTemp and §13a reasons about core and
-- chill explicitly. The explicit names win, because haccpOf() depends on knowing
-- WHICH temperature it is reading.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verify: mcp list_migrations, or supabase/schema.snapshot.json + npm run schema:check.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── recipes ─────────────────────────────────────────────────────────────────
create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,

  -- deferred FK → groups(id); see header
  group_id      uuid,

  name          text not null check (length(btrim(name)) > 0),
  category      text not null default 'אחר',
  tags          text[] not null default '{}',
  is_sub        boolean not null default false,
  -- §9 / §18.7: an approved production formula. Editing needs explicit consent
  -- and version restore is blocked while it holds.
  locked        boolean not null default false,

  -- yield (§1.1)
  yield_units   numeric(10, 2) not null default 0,
  unit_weight   numeric(10, 2) not null default 0,
  -- null means "theoretical yield", which is not the same as zero (§18.11)
  yield_actual  numeric(12, 2),
  weight_before numeric(10, 2),
  weight_after  numeric(10, 2),

  -- dough (§1.1) — feeds the three-temperature water rule
  dough_mode    boolean not null default false,
  ddt           numeric(5, 2),
  flour_temp    numeric(5, 2),
  room_temp     numeric(5, 2),
  friction      numeric(5, 2),

  -- pricing
  target_fc     numeric(5, 2) not null default 0,

  -- texts (§1.1)
  shelf_life    text not null default '',
  storage       text not null default '',
  freezing      text not null default '',
  thawing       text not null default '',
  equipment     text not null default '',
  -- §8: public notes. These DO travel into sharing and the order sheet.
  notes         text not null default '',
  manual_allergens text[] not null default '{}',

  pan           jsonb,

  version_of    uuid references public.recipes (id) on delete set null,
  version_note  text not null default '',
  -- deferred FK → group_recipe_items(id); see header
  saved_from_item_id uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.recipes.yield_actual is
  'Measured yield in grams. NULL = use the theoretical total (spec 1.1) - distinct from 0.';
comment on column public.recipes.locked is
  'Approved production formula (9). Version restore is refused while true (18.7).';

create index if not exists recipes_owner_idx    on public.recipes (owner_id);
create index if not exists recipes_category_idx on public.recipes (owner_id, category);
create index if not exists recipes_group_idx    on public.recipes (group_id)
  where group_id is not null;

-- ── ingredients (§1.1 Ingredient) ───────────────────────────────────────────
create table if not exists public.ingredients (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.recipes (id) on delete cascade,
  ord         integer not null default 0,
  name        text not null,
  -- stable identity for calibration matching (engine B4); derived from name
  -- when the ingredient catalog has no entry yet
  ingredient_key text,
  qty         numeric(12, 3) not null default 0,
  unit        text not null default 'גרם',
  flour       boolean not null default false,
  liquid      boolean not null default false,
  -- §1.1: percentage of water inside the ingredient, for net hydration.
  -- NULL means "use the shared table"; it is not 0.
  water_pct   numeric(5, 2),
  unit_weight numeric(10, 3),
  -- §5.1 precedence rank 2: a density typed into this recipe
  g_per_100   numeric(7, 2),
  price       numeric(10, 3),
  price_unit  text check (price_unit in ('ק"ג', 'ליטר', 'יח''')),
  sub_recipe_id uuid references public.recipes (id) on delete set null,
  note        text not null default ''
);

create index if not exists ingredients_recipe_idx on public.ingredients (recipe_id, ord);
create index if not exists ingredients_sub_idx    on public.ingredients (sub_recipe_id)
  where sub_recipe_id is not null;

-- ── steps (§1.1 Step) ───────────────────────────────────────────────────────
create table if not exists public.steps (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ord       integer not null default 0,
  text      text not null default '',
  temp      numeric(6, 2),
  temp_unit text not null default 'C' check (temp_unit in ('C', 'F')),
  minutes   numeric(8, 2)
);

create index if not exists steps_recipe_idx on public.steps (recipe_id, ord);

-- ── issues and trials (§13 "אם משהו משתבש" and the trial log) ───────────────
create table if not exists public.issues (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ord       integer not null default 0,
  problem   text not null,
  solution  text not null
);

create table if not exists public.trials (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  date      date,
  note      text not null default ''
);

create index if not exists issues_recipe_idx on public.issues (recipe_id, ord);
create index if not exists trials_recipe_idx on public.trials (recipe_id, date desc);

-- ── batches (§13a) ──────────────────────────────────────────────────────────
-- §13a: the HACCP status is DERIVED and never stored. There is deliberately no
-- status column here — haccpOf() recomputes it from ccp and chill_temp on every
-- render, so a batch cannot be marked compliant without the record behind it.
create table if not exists public.batches (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  code       text not null,
  date       date,
  core_temp  numeric(5, 2),
  -- §13a: an empty field is not a measurement, so NULL is not an excursion
  chill_temp numeric(5, 2),
  weight     numeric(10, 2),
  owner      text not null default '',
  note       text not null default '',
  -- the four fixed control points, e.g. {"core":true,"chill":true,...}
  ccp        jsonb not null default '{}'::jsonb,
  -- §13a REQUIRES BACKEND: a private bucket path plus a server-set timestamp.
  -- A timestamp the user can edit is worth nothing in a food-safety audit, so
  -- taken_at is written by the server, never by the client.
  photo_path text,
  taken_at   timestamptz,
  created_at timestamptz not null default now(),
  unique (recipe_id, code)
);

create index if not exists batches_recipe_idx on public.batches (recipe_id, date desc);

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch
  before update on public.recipes
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — HANDOFF §3
--   recipes:        SELECT/UPDATE/DELETE WHERE owner_id = auth.uid()
--                   OR (group_id IS NOT NULL AND member AND perm_view)  ← later
--   child tables:   via recipe → owner_id = auth.uid()
--
-- HANDOFF §3 and §12.3, the rule that must not be crossed: an instructor or
-- owner must never be able to read a student's personal notebook. A student's
-- own recipe has group_id IS NULL, and the policy below reaches it only through
-- owner_id = auth.uid(). The group branch added later must keep
-- `group_id is not null` in its condition for exactly this reason.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.recipes     enable row level security;
alter table public.ingredients enable row level security;
alter table public.steps       enable row level security;
alter table public.issues      enable row level security;
alter table public.trials      enable row level security;
alter table public.batches     enable row level security;

drop policy if exists recipes_own on public.recipes;
create policy recipes_own on public.recipes
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Child rows follow their recipe's owner. One helper keeps the six policies
-- identical, so none of them can drift.
create or replace function public.owns_recipe(p_recipe_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.recipes r
    where r.id = p_recipe_id and r.owner_id = auth.uid()
  );
$$;

drop policy if exists ingredients_via_recipe on public.ingredients;
create policy ingredients_via_recipe on public.ingredients
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

drop policy if exists steps_via_recipe on public.steps;
create policy steps_via_recipe on public.steps
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

drop policy if exists issues_via_recipe on public.issues;
create policy issues_via_recipe on public.issues
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

drop policy if exists trials_via_recipe on public.trials;
create policy trials_via_recipe on public.trials
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

drop policy if exists batches_via_recipe on public.batches;
create policy batches_via_recipe on public.batches
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));
