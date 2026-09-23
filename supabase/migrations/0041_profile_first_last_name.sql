-- ─────────────────────────────────────────────────────────────────────────────
-- 0041 — first name / last name, and where display_name now comes from
--
-- Personal Settings, stage 1 (23.09.2026). Ahmed's decision: split name into
-- first_name/last_name going forward, DERIVE display_name from them, and do
-- not break any existing account that only ever set display_name through
-- IdentityCard (migration 0031) and has no first/last name at all.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A TRIGGER AND NOT APPLICATION CODE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Every other derived value in this schema (touched_at, the group rank
-- helpers) is enforced in the database rather than trusted from the client,
-- so that it is correct regardless of which repository implementation wrote
-- the row. display_name is what group_roster() and the chat hand to OTHER
-- people (0031), so the same rule applies here.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE GUARD THAT KEEPS EXISTING ACCOUNTS UNTOUCHED
-- ══════════════════════════════════════════════════════════════════════════
--
-- The trigger only overwrites display_name when THIS WRITE is the one
-- setting or changing first_name or last_name (compared against OLD, on
-- UPDATE). An account that has display_name set from before and never
-- touches first_name/last_name is never rewritten by this migration or by
-- any later, unrelated update to its row — including one made from
-- IdentityCard, which still edits display_name directly and continues to
-- work exactly as it did.
--
-- Both must be present and non-blank for the derivation to fire: a person
-- who has filled in only one of the two has not finished the form, and
-- overwriting a real display_name with "אחמד " (trailing space, blank
-- surname) would be a worse account than leaving it alone.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

comment on column public.profiles.first_name is
  'Stage 1 of Personal Settings. Nullable: existing accounts have neither this '
  'nor last_name until they visit the new profile screen — see the trigger '
  'below for what filling both in does to display_name.';
comment on column public.profiles.last_name is
  'Paired with first_name; see that column''s comment.';

create or replace function public.derive_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_first text := pg_catalog.btrim(coalesce(new.first_name, ''));
  v_last  text := pg_catalog.btrim(coalesce(new.last_name, ''));
  v_changed boolean :=
    tg_op = 'INSERT'
    or new.first_name is distinct from old.first_name
    or new.last_name is distinct from old.last_name;
begin
  if v_changed and v_first <> '' and v_last <> '' then
    new.display_name := v_first || ' ' || v_last;
  end if;
  return new;
end;
$$;

comment on function public.derive_display_name() is
  'Sets display_name from first_name + last_name, but only on the write that '
  'actually changes one of them, and only once both are non-blank. Never '
  'touches display_name on any other update — an account that has not filled '
  'in first/last name keeps whatever display_name it already had.';

drop trigger if exists profiles_derive_display_name on public.profiles;
create trigger profiles_derive_display_name
  before insert or update on public.profiles
  for each row execute function public.derive_display_name();

-- A trigger function is invoked by the trigger mechanism, as the table
-- owner — never called directly by a client role. `create function` grants
-- EXECUTE to PUBLIC by default, which cascades to anon and authenticated;
-- every other trigger function in this schema (touch_updated_at,
-- guard_message_insert, ...) revokes that. This one had been left open.
revoke all on function public.derive_display_name() from public, anon, authenticated;
