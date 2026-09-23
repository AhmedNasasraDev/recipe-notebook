-- ─────────────────────────────────────────────────────────────────────────────
-- 0021 — a locked production plan is frozen in the DATABASE, not in the RPC
--
-- THE DEFECT THIS CLOSES (found in the stage-10 audit, §7)
--
-- 0018 decided the rule and documented it: "LOCKED → read the snapshot. NOT
-- LOCKED → compute live." The rule was then enforced in exactly one place —
-- the `if v_locked then raise` inside `save_production_plan`. Everything else
-- was left to RLS, and RLS only asks WHOSE row it is. So the owner's own
-- session, holding nothing but the anon key and its JWT, could do all of this
-- straight through PostgREST:
--
--     PATCH /production_plans?id=eq.…   {"name":"…"}        → 1 row changed
--     PATCH /production_plans?id=eq.…   {"snapshot":{…}}    → the frozen
--                                                             record rewritten
--     PATCH /production_plans?id=eq.…   {"locked":false}    → unlocked without
--                                                             clearing the snapshot
--     POST  /production_plan_items                          → a line added to
--                                                             a locked plan
--     DELETE /production_plan_stock?plan_id=eq.…            → stock removed
--
-- Measured on the live project before this migration: six of seven bypass
-- attempts succeeded. A record that anyone holding the browser's own key can
-- rewrite is not a record, and the snapshot is what the costing history of a
-- completed plan is read from. This is the same class of hole stage 6 closed
-- for the delete guard (UI-only → database) and stages 5/9 closed for
-- cross-account foreign keys (FK → owner-equality trigger): a rule that lives
-- in one code path is not a rule.
--
-- HOW IT IS CLOSED
--
-- A BEFORE trigger on each of the three tables. The lock TRANSITION itself is
-- legitimate and has exactly one author — `set_plan_locked` — so that function
-- announces itself with a transaction-local flag that the trigger checks. The
-- flag is set for one statement and cleared immediately after, so it cannot be
-- left standing for the rest of a transaction, and nothing outside this file
-- can set it usefully: `set_config` is available to the caller, but the flag
-- alone does not grant anything the owner does not already have — it only ever
-- re-opens the two columns that `set_plan_locked` maintains consistently, and
-- a forged flag can do no more than what calling `set_plan_locked` does
-- anyway. What it CANNOT do is happen by accident, which is the failure mode
-- that actually occurs.
--
-- WHY THE CHILD TABLES ALLOW A DELETE WHEN THE PARENT IS GONE
--
-- Two legitimate deletes pass through the child tables and must keep working:
--   · `delete_production_plan` (and the `auth.users` cascade) deletes the plan,
--     which cascades to its lines and stock. A locked plan can still be
--     deleted — keeping a record is the user's choice, not the schema's.
--   · deleting a RECIPE cascades to the plan lines that name it. 0018 chose
--     that on purpose: "the record of what was produced survives the recipe
--     being deleted", because the snapshot holds the content.
-- In both cases Postgres deletes the parent row FIRST and fires the cascade
-- afterwards, so by the time the child's BEFORE DELETE trigger runs the parent
-- row is already gone inside this transaction. "Parent no longer there" is
-- therefore the precise signature of a cascade, and the guard only refuses a
-- delete whose parents are both still present.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. the flag the lock transition announces itself with ───────────────────
--
-- Read INLINE in both guards rather than through a helper. A trigger function
-- with invoker rights runs as `authenticated`, and a nested call to a helper
-- would need EXECUTE granted to `authenticated` — which would hand every
-- signed-in session a function whose only purpose is to be internal. Two
-- copies of one expression is the cheaper price. It is written with
-- `pg_catalog.` because `search_path` is empty in these functions, and with
-- the `true` second argument so an unset flag reads as NULL instead of
-- raising.
--
--     nullif(pg_catalog.current_setting('app.plan_lock_op', true), '')::uuid

-- ── 2. the plan itself ──────────────────────────────────────────────────────

create or replace function public.guard_locked_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op uuid := nullif(pg_catalog.current_setting('app.plan_lock_op', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    -- A plan is born unlocked. Inserting one that is already locked, with a
    -- snapshot written by hand, would be forging a record of production that
    -- never ran — and there is no honest reason to do it, because locking is
    -- what freezes the figures that were true at the time.
    if new.locked or new.snapshot is not null then
      raise exception 'לא ניתן ליצור תוכנית נעולה. יש לשמור תוכנית ואז לסמן אותה כבוצעה.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;  -- deleting a record is allowed; rewriting one is not
  end if;

  -- The lock transition, and only it, may touch `locked`, `locked_at` and
  -- `snapshot`.
  if v_op is distinct from old.id then
    if new.locked is distinct from old.locked
       or new.locked_at is distinct from old.locked_at
       or new.snapshot is distinct from old.snapshot then
      raise exception 'סימון "בוצעה" והנתונים הקפואים משתנים רק דרך הפעולה המיועדת לכך.'
        using errcode = 'insufficient_privilege';
    end if;
    -- And while the plan is locked, nothing else may be touched either: it is
    -- a record of what happened, and the whole row is part of the record.
    if old.locked then
      raise exception 'התוכנית סומנה כבוצעה. יש לבטל את הסימון לפני עריכה.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The owner never moves, with or without the flag.
  if new.owner_id is distinct from old.owner_id then
    raise exception 'לא ניתן להעביר תוכנית לחשבון אחר' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_locked_plan() from public, anon, authenticated;

drop trigger if exists production_plans_lock_guard on public.production_plans;
create trigger production_plans_lock_guard
  before insert or update or delete on public.production_plans
  for each row execute function public.guard_locked_plan();

-- ── 3. the lines and the stock of a locked plan ─────────────────────────────

create or replace function public.guard_locked_plan_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_locked  boolean;
  v_found   boolean := false;
begin
  -- NEW and OLD are branched on explicitly rather than coalesced: in a DELETE
  -- trigger NEW is an unassigned record, and reading a field of it is an error
  -- rather than a null.
  if tg_op = 'DELETE' then
    v_plan_id := old.plan_id;
  else
    v_plan_id := new.plan_id;
  end if;

  select true, p.locked into v_found, v_locked
    from public.production_plans p where p.id = v_plan_id;

  -- The parent is already gone: this row is being removed by the cascade from
  -- the plan (see the header). There is no record left to protect.
  if not coalesce(v_found, false) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_locked and nullif(pg_catalog.current_setting('app.plan_lock_op', true), '')::uuid
       is distinct from v_plan_id then
    -- The recipe cascade, which 0018 chose deliberately: a plan line whose
    -- recipe no longer exists is being cleaned up, not edited. The content of
    -- the plan survives in the snapshot, which §2 above has frozen.
    --
    -- NESTED, not one `and` chain. plpgsql hands the whole condition of an IF
    -- to the SQL parser as a single expression, and `old.recipe_id` is then
    -- resolved even on the table that has no such column — which is what the
    -- first run of this guard did: a delete of a locked plan's STOCK row was
    -- refused with 42703 (undefined column) instead of 42501. Refused either
    -- way, and for the wrong reason, which is how a guard quietly stops
    -- guarding the case it was written for.
    if tg_op = 'DELETE' and tg_table_name = 'production_plan_items' then
      if not exists (select 1 from public.recipes r where r.id = old.recipe_id) then
        return old;
      end if;
    end if;
    raise exception 'התוכנית סומנה כבוצעה ואינה ניתנת לשינוי.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke execute on function public.guard_locked_plan_child() from public, anon, authenticated;

drop trigger if exists production_plan_items_lock_guard on public.production_plan_items;
create trigger production_plan_items_lock_guard
  before insert or update or delete on public.production_plan_items
  for each row execute function public.guard_locked_plan_child();

drop trigger if exists production_plan_stock_lock_guard on public.production_plan_stock;
create trigger production_plan_stock_lock_guard
  before insert or update or delete on public.production_plan_stock
  for each row execute function public.guard_locked_plan_child();

-- ── 4. the one author of the transition ─────────────────────────────────────
--
-- Unchanged in behaviour from 0018 apart from the two `set_config` calls: the
-- flag is raised for the single UPDATE and lowered straight after, so it is
-- never left standing for whatever else the transaction goes on to do.

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

  if p_locked and p_snapshot is null then
    raise exception 'לא ניתן לנעול תוכנית בלי snapshot' using errcode = 'check_violation';
  end if;

  perform pg_catalog.set_config('app.plan_lock_op', p_plan_id::text, true);

  if p_locked then
    update public.production_plans
       set locked = true, locked_at = pg_catalog.now(), snapshot = p_snapshot
     where id = p_plan_id;
  else
    -- The snapshot goes with the lock. A plan being edited again is not a
    -- record of anything, and keeping a stale frozen cost beside a live one is
    -- the second source of truth requirement 14 forbids.
    update public.production_plans
       set locked = false, locked_at = null, snapshot = null
     where id = p_plan_id;
  end if;

  perform pg_catalog.set_config('app.plan_lock_op', '', true);
end;
$$;

revoke execute on function public.set_plan_locked(uuid, boolean, jsonb) from public, anon;
grant  execute on function public.set_plan_locked(uuid, boolean, jsonb) to authenticated;
