-- ─────────────────────────────────────────────────────────────────────────────
-- 0033 — the message guard must not refuse the database's own housekeeping
--
-- WHAT BROKE, AND HOW IT SURFACED
--
-- Deleting a user account failed:
--
--   ERROR 42501: אפשר למחוק הודעה של חבר אחר, אבל לא לערוך אותה
--   CONTEXT: PL/pgSQL function public.guard_message_update() line 27
--   SQL statement: UPDATE ONLY "public"."group_messages"
--                  SET "deleted_by" = NULL WHERE $1 = "deleted_by"
--
-- `group_messages.deleted_by` is `ON DELETE SET NULL`. When an account goes,
-- Postgres issues that UPDATE itself to clear the reference — and it arrives at
-- `guard_message_update` looking like an edit by somebody who is not the
-- author, which is precisely what the guard exists to refuse. So the guard
-- refused the database's own referential maintenance, and the account could
-- not be deleted.
--
-- This is the same shape as the cascade problem in 0021: a guard written for
-- what a USER does, meeting what the ENGINE does. It was found by the chat test
-- suite's teardown, which is the only place an account actually gets deleted.
--
-- THE FIX, AND WHY IT IS NOT `pg_trigger_depth()`
--
-- Detecting "this came from a foreign key" by checking `pg_trigger_depth() > 1`
-- would work and would rest on an implementation detail — and worse, it would
-- also excuse any future trigger that happened to nest. The rule used instead
-- is about the DATA:
--
--   if neither the body nor `deleted_at` changed, this update is not an edit
--   and not a deletion, so the author/moderator rules do not apply to it.
--
-- That is true of the FK's `deleted_by = NULL`, true of a future FK clearing
-- `reply_to_id`, and not true of anything a client could use to rewrite a
-- message — because rewriting a message means changing its body, and removing
-- one means setting `deleted_at`. The immutable-column check still runs first
-- and still applies to everybody.
--
-- `reply_to_id` moves from "never changes" to "may be cleared, never
-- repointed", for the same reason: `ON DELETE SET NULL` has to be allowed to
-- do its job, while a client must not be able to move a reply to a different
-- parent (which would let it name a message it may not be able to read).
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Immutable for everybody, including the engine: these are what a message
  -- IS. Changing one rewrites history rather than editing a message.
  if new.group_id <> old.group_id
     or new.author_id <> old.author_id
     or new.kind <> old.kind
     or new.created_at <> old.created_at
     or new.seq <> old.seq then
    raise exception 'לא ניתן לשנות את פרטי ההודעה, רק את תוכנה או למחוק אותה'
      using errcode = '42501';
  end if;

  /*
    A reply may be CLEARED but never REPOINTED. Clearing is what
    `ON DELETE SET NULL` does; repointing would let a client attach its reply
    to a message it may not be able to read.
  */
  if new.reply_to_id is not null
     and coalesce(new.reply_to_id::text, '') <> coalesce(old.reply_to_id::text, '') then
    raise exception 'לא ניתן להעביר תשובה להודעה אחרת' using errcode = '42501';
  end if;

  /*
    NOTHING MEANINGFUL CHANGED → allow. This is the fix. See the header: the
    foreign key's own `deleted_by = NULL` lands here, and refusing it made
    deleting an account impossible.
  */
  if not v_body_changed and not v_deleted_changed then
    return new;
  end if;

  -- A deletion is final. Un-deleting would make a tombstone a lie.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'הודעה שנמחקה אינה חוזרת' using errcode = '42501';
  end if;

  if v_deleted_changed and new.deleted_at is not null then
    -- Removing. Stamped here rather than trusted from the client.
    new.deleted_at := pg_catalog.now();
    new.deleted_by := v_uid;
    /*
      The body is kept in the row. It is never shown — every read path filters
      on `deleted_at` — and keeping it means a moderator can still account for
      what they removed.
    */
    return new;
  end if;

  -- From here it is an edit.
  if not v_is_author then
    /*
      THE ASYMMETRY. A moderator may remove a message and may not rewrite it:
      putting different words under somebody's name and face is worse than
      deleting the message.
    */
    raise exception 'אפשר למחוק הודעה של חבר אחר, אבל לא לערוך אותה'
      using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'הודעה שנמחקה אינה ניתנת לעריכה' using errcode = '42501';
  end if;

  -- Stamped by the database, so "edited" cannot be hidden by the client.
  new.edited_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.guard_message_update() is
  'Enforces what a policy cannot: which columns may change, that a deletion is '
  'final, that edited_at is stamped by the database, and that a moderator may '
  'DELETE somebody else''s message but never EDIT it. Returns early when '
  'neither the body nor deleted_at changed, so a foreign key clearing '
  'deleted_by is not mistaken for an edit — see 0033.';
