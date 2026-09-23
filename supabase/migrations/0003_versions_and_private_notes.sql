-- ─────────────────────────────────────────────────────────────────────────────
-- 0003 — recipe versions, private notes, ingredient catalog
--
-- HANDOFF §1 and §3. Work-order steps 3 and 4.
-- §4 of the work order calls private_notes and calibrations "the first test of
-- RLS", which is exactly right: they are the two tables where a leak would be a
-- product failure and not just a bug.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verify: mcp list_migrations, or supabase/schema.snapshot.json + npm run schema:check.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── recipe_versions (§9) ────────────────────────────────────────────────────
-- A restore pushes the CURRENT state into history before returning a snapshot,
-- so restoring never deletes anything.
create table if not exists public.recipe_versions (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  tag        text not null,
  -- §9: a computed description of what changed, e.g. "שונתה כמות: קמח לחם"
  what       text not null default '',
  snapshot   jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (recipe_id, tag)
);

create index if not exists recipe_versions_idx
  on public.recipe_versions (recipe_id, created_at desc);

-- ── private_notes (§8, §12.3) ───────────────────────────────────────────────
-- §8: completely separate from recipes.notes. Never enters the order sheet, the
-- label, sharing or a group export.
-- A note hangs off a personal recipe OR off a group item, never both.
create table if not exists public.private_notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  recipe_id      uuid references public.recipes (id) on delete cascade,
  -- deferred FK → group_recipe_items(id); the groups migration adds it
  group_item_id  uuid,
  body           text not null default '',
  updated_at     timestamptz not null default now(),
  constraint private_notes_one_target check (
    (recipe_id is not null and group_item_id is null) or
    (recipe_id is null and group_item_id is not null)
  )
);

-- HANDOFF §1: "מפתח ייחודי על (user_id, recipe_id) ועל (user_id, group_item_id)"
create unique index if not exists private_notes_user_recipe_uniq
  on public.private_notes (user_id, recipe_id) where recipe_id is not null;
create unique index if not exists private_notes_user_item_uniq
  on public.private_notes (user_id, group_item_id) where group_item_id is not null;

comment on table public.private_notes is
  'Personal notes. HANDOFF 3: ALL WHERE user_id = auth.uid(), with no exception - not for an instructor, not for a group owner, not in any report.';

drop trigger if exists private_notes_touch on public.private_notes;
create trigger private_notes_touch
  before update on public.private_notes
  for each row execute function public.touch_updated_at();

-- ── ingredient_catalog (§13 central price update, engine finding B14) ───────
-- The prototype keyed ingredients by their exact name string, so "חמאה 82%" and
-- "חמאה 82% ללישה" were two unrelated rows. This table is the entity that fixes
-- it. owner_id NULL = a system-level catalog row.
create table if not exists public.ingredient_catalog (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  group_id   uuid,
  key        text not null,
  name       text not null,
  price      numeric(10, 3),
  price_unit text check (price_unit in ('ק"ג', 'ליטר', 'יח''')),
  g_per_100  numeric(7, 2),
  water_pct  numeric(5, 2),
  allergens  text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ingredient_catalog_owner_key_uniq
  on public.ingredient_catalog (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

drop trigger if exists ingredient_catalog_touch on public.ingredient_catalog;
create trigger ingredient_catalog_touch
  before update on public.ingredient_catalog
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.recipe_versions    enable row level security;
alter table public.private_notes      enable row level security;
alter table public.ingredient_catalog enable row level security;

drop policy if exists recipe_versions_via_recipe on public.recipe_versions;
create policy recipe_versions_via_recipe on public.recipe_versions
  for all using (public.owns_recipe(recipe_id))
  with check (public.owns_recipe(recipe_id));

-- The one with no exceptions.
drop policy if exists private_notes_own on public.private_notes;
create policy private_notes_own on public.private_notes
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Own rows are writable; system rows (owner_id IS NULL) are read-only.
drop policy if exists ingredient_catalog_read on public.ingredient_catalog;
create policy ingredient_catalog_read on public.ingredient_catalog
  for select using (owner_id = (select auth.uid()) or owner_id is null);

drop policy if exists ingredient_catalog_write on public.ingredient_catalog;
create policy ingredient_catalog_write on public.ingredient_catalog
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
