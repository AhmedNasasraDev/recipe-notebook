-- ─────────────────────────────────────────────────────────────────────────────
-- 0004 — the shared density table
--
-- HANDOFF §1: "הצפיפויות מ-measure.js#TABLE נזרעות ל-density_table. סדר הקדימות
-- (§5.1) נשאר בדיוק כפי שהוא."
--
-- The spec's sketch was density_table(ingredient_key, g_per_100, confidence).
-- It grew three columns during the stage-1 merge, and each one is load-bearing:
--
--   resolution   which of the four states a row is in. A row whose legacy
--                sources disagree carries NO value and must answer
--                `unavailable` — see CONFLICTS.md.
--   sources      every legacy value on record, so a conflict can be reviewed
--                later without archaeology.
--   needs_review the flag the UI shows next to a value that wants a second
--                opinion.
--
-- g_per_100 is therefore NULLABLE. That is the point: 12 of the 34 rows are
-- deliberately unvalued, and spec §5.1 rule 5 requires no number rather than a
-- wrong one.
--
-- The seed is GENERATED from the engine, never hand-written:
--   node supabase/scripts/generate-density-seed.mjs
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verify: mcp list_migrations, or supabase/schema.snapshot.json + npm run schema:check.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.density_table (
  key          text primary key,
  -- Hebrew match terms, ordered most specific first
  match_terms  text[] not null,
  exclude_terms text[] not null default '{}',
  -- whole-word matching, for short terms that live inside other words:
  -- 'מים' is inside "שלמים" and 'חלב' is inside "חלבון"
  word_match   boolean not null default false,
  -- NULL = no value may be used yet. See the header.
  g_per_100    numeric(7, 2) check (g_per_100 is null or g_per_100 > 0),
  confidence   text not null check (confidence in ('system', 'estimate')),
  resolution   text not null check (resolution in (
                 'accepted', 'accepted-single-source',
                 'pending-verification', 'pending-form')),
  note         text not null default '',
  sources      jsonb not null default '{}'::jsonb,
  needs_review boolean not null default false,
  review_note  text not null default '',
  forms        text[] not null default '{}',
  ord          integer not null,
  updated_at   timestamptz not null default now(),
  -- an accepted row must have a value; a pending row must not
  constraint density_value_matches_resolution check (
    (resolution in ('accepted', 'accepted-single-source') and g_per_100 is not null) or
    (resolution in ('pending-verification', 'pending-form') and g_per_100 is null)
  )
);

comment on table public.density_table is
  'Single source of truth for ingredient density, in grams per 100 ml. Seeded from packages/engine DENSITY_TABLE. Lookup order is ord.';

-- Ingredients we know are distinct from every row here and have no value for.
-- Refused before term matching, so a general term can never answer for them.
create table if not exists public.density_data_gaps (
  name text primary key
);

comment on table public.density_data_gaps is
  'Known gaps (CONFLICTS.md 6). A personal calibration or a recipe-level g_per_100 still overrides these.';

drop trigger if exists density_table_touch on public.density_table;
create trigger density_table_touch
  before update on public.density_table
  for each row execute function public.touch_updated_at();

-- ── RLS: shared reference data — readable by any signed-in account, writable
--         by nobody through the API. Changes arrive as migrations, so a client
--         can never quietly alter a professional value.
alter table public.density_table      enable row level security;
alter table public.density_data_gaps  enable row level security;

drop policy if exists density_table_read on public.density_table;
create policy density_table_read on public.density_table
  for select to authenticated using (true);

drop policy if exists density_gaps_read on public.density_data_gaps;
create policy density_gaps_read on public.density_data_gaps
  for select to authenticated using (true);
