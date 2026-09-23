-- ─────────────────────────────────────────────────────────────────────────────
-- 0035 — a deleted message's words stop being readable
--
-- WHAT WAS WRONG
--
-- 0032 kept the body in the row on a soft delete, and its comment claimed that
-- "every read path filters on `deleted_at`". That is true of the read paths in
-- this repository and of nothing else. `messages_read` is
-- `group_rank(group_id) >= 1` with no condition on `deleted_at`, so any member
-- could ask PostgREST for the row and read the text a moderator had just
-- removed — and `broadcast_group_message` sent the whole row on the delete, so
-- the body reached every open client as part of the deletion itself.
--
-- A deletion the UI honours and the API does not is not a deletion. It is the
-- exact shape of "enforced in the UI only" that this project rules out.
--
-- WHY THE BODY IS MOVED RATHER THAN DROPPED
--
-- 0032's reason for keeping it was real: a moderator who removes a message
-- should be able to account for what they removed. So the text moves to
-- `group_message_removals`, which only rank >= 2 may read, and the message's
-- own `body` becomes ''. Nobody loses the record; members lose the ability to
-- read it, which is what deleting it was for.
--
-- WHY THE TABLE HAS NO INSERT POLICY
--
-- The only writer is `guard_message_update`, which is SECURITY DEFINER and
-- owned by the same role as the table, so its insert is not subject to RLS.
-- `authenticated` is granted SELECT and nothing else: a client cannot write a
-- removal record, and cannot forge one for a message it never removed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.group_message_removals (
  message_id uuid primary key
               references public.group_messages (id) on delete cascade,
  /* Denormalised so the policy can decide without reading the message — the
     same rule as everywhere else here: a policy must reach what it depends on
     through a column the ROW CARRIES. See 0024. */
  group_id   uuid not null references public.groups (id) on delete cascade,
  body       text not null,
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz not null default now()
);

alter table public.group_message_removals enable row level security;

/* Supabase grants `all` to `authenticated` on a new table in `public`. On this
   one that would mean a member could insert, update and delete removal
   records. SELECT is the only thing a client has any business doing. */
revoke all on public.group_message_removals from anon, authenticated;
grant select on public.group_message_removals to authenticated;

drop policy if exists removals_staff on public.group_message_removals;
create policy removals_staff on public.group_message_removals
  for select
  using (public.group_rank(group_id) >= 2);

comment on table public.group_message_removals is
  'The text of a deleted message, readable by rank >= 2 only. The message row '
  'keeps its place, its seq and its tombstone; the words move here so that a '
  'member cannot read what a moderator removed, while a moderator can still '
  'account for it. Written only by guard_message_update.';

-- ── the guard, with the one branch changed ───────────────────────────────────
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_author boolean := old.author_id = v_uid;
  v_body_changed boolean := new.body <> old.body;
  v_deleted_changed boolean :=
    coalesce(new.deleted_at::text, '') <> coalesce(old.deleted_at::text, '');
begin
  if new.group_id <> old.group_id
     or new.author_id <> old.author_id
     or new.kind <> old.kind
     or new.created_at <> old.created_at
     or new.seq <> old.seq then
    raise exception 'לא ניתן לשנות את פרטי ההודעה, רק את תוכנה או למחוק אותה'
      using errcode = '42501';
  end if;

  if new.reply_to_id is not null
     and coalesce(new.reply_to_id::text, '') <> coalesce(old.reply_to_id::text, '') then
    raise exception 'לא ניתן להעביר תשובה להודעה אחרת' using errcode = '42501';
  end if;

  /* 0033: nothing meaningful changed — the foreign key's own maintenance
     (deleted_by set to null as an account is removed) lands here, and
     refusing it made deleting an account impossible. */
  if not v_body_changed and not v_deleted_changed then
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'הודעה שנמחקה אינה חוזרת' using errcode = '42501';
  end if;

  if v_deleted_changed and new.deleted_at is not null then
    new.deleted_at := pg_catalog.now();
    new.deleted_by := v_uid;
    /*
      0035. The words move out of the message and into a table only staff may
      read, and the message keeps an empty body. A client that asks PostgREST
      for the row — and the broadcast that goes out for this very update — now
      carry nothing to read.

      `old.body` and not `new.body`: a client is free to send any body along
      with its delete, and the text that must be preserved is the one that was
      actually posted.
    */
    if pg_catalog.btrim(old.body) <> '' then
      insert into public.group_message_removals
        (message_id, group_id, body, removed_by)
      values (old.id, old.group_id, old.body, v_uid)
      on conflict (message_id) do nothing;
    end if;
    new.body := '';
    return new;
  end if;

  if not v_is_author then
    raise exception 'אפשר למחוק הודעה של חבר אחר, אבל לא לערוך אותה'
      using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'הודעה שנמחקה אינה ניתנת לעריכה' using errcode = '42501';
  end if;

  new.edited_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.guard_message_update() is
  'Enforces what a policy cannot: which columns may change, that a deletion is '
  'final, that edited_at is stamped by the database, that a moderator may '
  'DELETE somebody else''s message but never EDIT it, and (0035) that a '
  'deleted body leaves the message for group_message_removals so no member can '
  'read what was removed. Returns early when neither the body nor deleted_at '
  'changed, so a foreign key clearing deleted_by is not mistaken for an edit.';
