-- ─────────────────────────────────────────────────────────────────────────────
-- 0001 — profiles and personal calibrations
--
-- Transcribed from RECIPE_NOTEBOOK_IMPLEMENTATION_SPEC.md → CLAUDE CODE HANDOFF
-- §1 (Database) and §3 (RLS). Work-order step 1.
--
-- One documented adaptation: the spec lists
--     users(id, email, created_at, locale)
-- Supabase already owns that table as `auth.users`, and applications must not
-- shadow it. So `auth.users` plays the role of `users`, and `locale` — the one
-- app-owned column on it — moves into `profiles`. Nothing else changed.
--
-- Three things below differ from a naive transcription of the handoff, all for
-- reasons the Supabase linter or planner cares about:
--   • every function pins `search_path = ''` and qualifies its table names, so a
--     SECURITY DEFINER function cannot be redirected by a caller's search_path
--   • the policy predicates say `(select auth.uid())` rather than `auth.uid()`.
--     Identical meaning; Postgres hoists the subquery into an InitPlan and
--     evaluates it once per query instead of once per row.
--   • EXECUTE on the trigger functions is revoked in 0006 — see that file.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verify: mcp list_migrations, or supabase/schema.snapshot.json + npm run schema:check.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── profiles (spec §1.2 MeasurementPrefs, one row per account) ──────────────
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  profile      text not null default 'pro'
                 check (profile in ('home', 'pro', 'study')),
  pro          boolean not null default true,
  units        jsonb not null default '["g","kg","ml","l","unit"]'::jsonb,
  tools        jsonb not null default '{"cup":240,"tbsp":15,"tsp":5}'::jsonb,
  touched_units boolean not null default false,
  -- §15: Hebrew now, Arabic planned. Per-account locale is REQUIRES BACKEND there.
  locale       text not null default 'he'
                 check (locale in ('he', 'ar')),
  -- §4: the onboarding runs once and can be reset from settings
  onboarding_done boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Per-account measurement preferences and disclosure level. Spec 1.2, 3.';
comment on column public.profiles.tools is
  'Measuring tool volumes in millilitres. Every volume conversion depends on this (engine B1).';

-- ── calibrations (spec §1.2 Calibration, §5.1 precedence rank 1) ────────────
create table if not exists public.calibrations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  ingredient_name text not null,
  -- stable identity, so a calibration is never matched by substring (engine B4)
  ingredient_key  text not null,
  tool            text not null check (tool in ('cup', 'tbsp', 'tsp')),
  -- engine B5: the tool volume AT CALIBRATION TIME. Frozen on purpose, so a
  -- later change to profiles.tools cannot rewrite a past measurement.
  tool_ml         numeric(7, 2) not null check (tool_ml > 0),
  grams           numeric(9, 2) not null check (grams > 0),
  -- set when tool_ml had to be assumed while migrating a pre-B5 record
  tool_ml_assumed boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (user_id, ingredient_key, tool)
);

comment on table public.calibrations is
  'Personal density measurements. Highest precedence in spec 5.1. Never readable by anyone else.';

create index if not exists calibrations_user_idx
  on public.calibrations (user_id, ingredient_key);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── a profile row per new account, so no screen has to handle "no profile" ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — HANDOFF §3
--   profiles:     ALL WHERE user_id = auth.uid()
--   calibrations: ALL WHERE user_id = auth.uid()
--
-- HANDOFF §3, the rule that must not be crossed: no policy, view, RPC or report
-- may let an owner or instructor read another account's calibrations. Personal
-- calibration belongs to the account and is never sent to a group (§12.5).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles     enable row level security;
alter table public.calibrations enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists calibrations_own on public.calibrations;
create policy calibrations_own on public.calibrations
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
