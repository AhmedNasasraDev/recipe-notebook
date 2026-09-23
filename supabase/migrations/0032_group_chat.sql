-- ─────────────────────────────────────────────────────────────────────────────
-- 0032 — group chat: persisted messages, Broadcast delivery, two-layer RLS
--
-- ══════════════════════════════════════════════════════════════════════════
-- BROADCAST, NOT POSTGRES CHANGES — and this is Supabase's own recommendation
-- ══════════════════════════════════════════════════════════════════════════
--
-- The docs are explicit: of the two ways to get database changes to a client,
-- "Broadcast. This is the recommended method for scalability and security",
-- and Postgres Changes "does not scale as well". The mechanism matters here:
--
--   Postgres Changes  every subscriber's RLS is evaluated per change, by the
--                     Realtime server, over the replication stream. The cost
--                     grows with subscribers × changes.
--   Broadcast         a trigger writes one message to `realtime.messages`;
--                     delivery fans out over websockets. RLS is evaluated ONCE
--                     per subscriber at JOIN time, not per message.
--
-- So the table is the source of truth and the broadcast is only delivery.
-- Nothing here is transient: `group_messages` is an ordinary table with
-- ordinary RLS, history is read from it, and a client that was offline catches
-- up by querying rather than by replaying a stream it missed.
--
-- ══════════════════════════════════════════════════════════════════════════
-- TWO LAYERS OF AUTHORIZATION, BECAUSE THEY ANSWER DIFFERENT QUESTIONS
-- ══════════════════════════════════════════════════════════════════════════
--
--   RLS on `public.group_messages`  who may READ HISTORY and who may POST
--   RLS on `realtime.messages`      who may JOIN THE CHANNEL at all
--
-- Both are required. Without the first, history is readable by anyone; without
-- the second, a non-member who guesses the topic name receives every message
-- as it is sent, forever, without ever touching a table the first policy
-- protects. The channel is private (`realtime.broadcast_changes` uses Realtime
-- Authorization), and the topic is `group:<uuid>`, so the second policy is
-- "are you at least a member of that group".
--
-- ══════════════════════════════════════════════════════════════════════════
-- `seq`, AND WHY PAGINATION IS NOT ON A TIMESTAMP
-- ══════════════════════════════════════════════════════════════════════════
--
-- Keyset pagination needs a TOTAL order. `created_at` is not one: two messages
-- in the same millisecond tie, and a tie means either a duplicate or a skipped
-- row at the page boundary — in a chat, the most-reported bug shape there is.
-- Breaking the tie with `id` works but makes every cursor a compound
-- expression PostgREST states awkwardly.
--
-- `seq bigint generated always as identity` is a single monotonic key. A page
-- is `where seq < cursor order by seq desc limit n`, the cursor is one number,
-- and OFFSET — which re-reads rows and shifts the whole window every time a
-- new message arrives — is never needed.
--
-- ══════════════════════════════════════════════════════════════════════════
-- SOFT DELETE, AND WHY A MODERATOR MAY NOT EDIT
-- ══════════════════════════════════════════════════════════════════════════
--
-- `deleted_at` rather than a real delete, for one concrete reason: a reply
-- points at a message, and a hard delete with ON DELETE CASCADE would take
-- the replies with it. A thread that loses its answers because someone removed
-- the question is worse than a tombstone.
--
-- And the asymmetry in `guard_message_update`: an author may change their own
-- words; a moderator may only remove a message, never rewrite it. Putting
-- different words in somebody's mouth under their name and face is worse than
-- deleting the message, so the trigger refuses it rather than trusting the UI
-- not to offer it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT BUILT, AND WHY THE SCHEMA STILL ALLOWS IT
-- ══════════════════════════════════════════════════════════════════════════
--
--   channel_id  nullable, referencing nothing yet. Multiple channels per
--               group, and direct messages, become a `group_channels` table
--               and a non-null value here — no data migration, because every
--               existing row legitimately means "the group's main channel".
--   kind        'announcement' is already a legal value and already requires
--               rank >= 2 to post. The UI for it is not built.
--   reactions   a future `group_message_reactions(message_id, user_id, emoji)`.
--   attachments a future `group_message_attachments(message_id, storage_path…)`,
--               which is why `body` is not the only thing a message could be.
--   mentions    a future `group_message_mentions(message_id, user_id)`.
--   mute        a future `group_member_prefs(group_id, user_id, muted_until)`.
--
-- None of these is created here. None of them needs this schema to change.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.group_messages (
  id          uuid primary key default gen_random_uuid(),
  /* The total order pagination uses. See the header. */
  seq         bigint generated always as identity,
  group_id    uuid not null references public.groups (id) on delete cascade,
  /* Reserved for multiple channels and DMs. Null = the group's main channel. */
  channel_id  uuid,
  author_id   uuid not null references auth.users (id) on delete cascade,
  body        text not null default '',
  kind        text not null default 'text'
                check (kind in ('text', 'announcement', 'system')),
  /* ON DELETE SET NULL, not CASCADE: see the header on soft delete. Even so a
     reply should survive its parent being purged one day. */
  reply_to_id uuid references public.group_messages (id) on delete set null,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists group_messages_seq_key on public.group_messages (seq);
/* The one index the chat actually reads by: newest-first within a group. */
create index if not exists group_messages_group_seq_idx
  on public.group_messages (group_id, seq desc);
create index if not exists group_messages_reply_idx
  on public.group_messages (reply_to_id) where reply_to_id is not null;

/*
  The unread marker. One row per person per group, holding the highest `seq`
  they have seen.

  A `seq` rather than a timestamp, for the same reason as pagination: "messages
  after the last one I read" is exact, while "messages after the time I last
  read" is wrong by however long the write took.
*/
create table if not exists public.group_message_reads (
  group_id      uuid not null references public.groups (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  last_read_seq bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_messages      enable row level security;
alter table public.group_message_reads enable row level security;

-- ── who may read history ─────────────────────────────────────────────────────
drop policy if exists messages_read on public.group_messages;
create policy messages_read on public.group_messages
  for select using (public.group_rank(group_id) >= 1);

/*
  Who may post. Three conditions, and the second is the one that matters:
  `author_id` must be the caller, so a message cannot be written in somebody
  else's name — the name and face beside it come from `group_roster`, and a
  forged author would be a forged identity.

  'system' is absent on purpose: no client may write one. It exists for a future
  server-generated line ("X joined the course"), which would be inserted by a
  definer function, not by a browser.
*/
drop policy if exists messages_insert on public.group_messages;
create policy messages_insert on public.group_messages
  for insert
  with check (
    author_id = (select auth.uid())
    and (
      (kind = 'text' and public.group_rank(group_id) >= 1)
      or (kind = 'announcement' and public.group_rank(group_id) >= 2)
    )
  );

/*
  Editing and removing are both UPDATEs — there is no DELETE policy at all, so
  a message cannot be hard-deleted through the API. The author or a moderator
  may pass this policy; WHAT each of them may change is the trigger's job,
  because a policy cannot restrict columns.
*/
drop policy if exists messages_update on public.group_messages;
create policy messages_update on public.group_messages
  for update
  using (
    author_id = (select auth.uid())
    or public.group_rank(group_id) >= 2
  )
  with check (
    author_id = (select auth.uid())
    or public.group_rank(group_id) >= 2
  );

-- My own read marker, and nobody else's.
drop policy if exists reads_own on public.group_message_reads;
create policy reads_own on public.group_message_reads
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.group_rank(group_id) >= 1);

-- ── the column rules a policy cannot express ─────────────────────────────────
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_author boolean := old.author_id = v_uid;
begin
  -- Immutable, whoever you are. A message's group, author, kind, thread and
  -- time are what it IS; changing any of them rewrites history rather than
  -- editing a message.
  if new.group_id <> old.group_id
     or new.author_id <> old.author_id
     or new.kind <> old.kind
     or new.created_at <> old.created_at
     or coalesce(new.reply_to_id::text, '') <> coalesce(old.reply_to_id::text, '')
     or new.seq <> old.seq then
    raise exception 'לא ניתן לשנות את פרטי ההודעה, רק את תוכנה או למחוק אותה'
      using errcode = '42501';
  end if;

  -- A deletion is final. Un-deleting would make a tombstone a lie.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'הודעה שנמחקה אינה חוזרת' using errcode = '42501';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    -- Removing. Stamped here rather than trusted from the client.
    new.deleted_at := pg_catalog.now();
    new.deleted_by := v_uid;
    /*
      The body is KEPT in the row. It is not shown — every read path filters on
      `deleted_at` — and keeping it means a moderator can see what they removed
      if they are ever asked to justify it. Blanking it would destroy the only
      record of what happened.
    */
    return new;
  end if;

  -- From here it is an edit.
  if not v_is_author then
    /*
      THE ASYMMETRY. A moderator may remove a message and may not rewrite it:
      putting different words under somebody's name and face is worse than
      deleting the message. Enforced here rather than by not offering a button.
    */
    raise exception 'אפשר למחוק הודעה של חבר אחר, אבל לא לערוך אותה'
      using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'הודעה שנמחקה אינה ניתנת לעריכה' using errcode = '42501';
  end if;

  if new.body <> old.body then
    -- Stamped by the database, so "edited" cannot be hidden by the client.
    new.edited_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

comment on function public.guard_message_update() is
  'Enforces what a policy cannot: which columns may change, that a deletion is '
  'final, that `edited_at` is stamped by the database, and that a moderator '
  'may DELETE somebody else''s message but never EDIT it.';

drop trigger if exists messages_update_guard on public.group_messages;
create trigger messages_update_guard
  before update on public.group_messages
  for each row execute function public.guard_message_update();

/*
  An empty message is not a message. Checked in a trigger rather than a CHECK
  constraint because a 'system' message legitimately has no body, and because
  whitespace-only has to be normalised before it is judged.
*/
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := pg_catalog.btrim(coalesce(new.body, ''));
  if new.kind <> 'system' and new.body = '' then
    raise exception 'לא ניתן לשלוח הודעה ריקה' using errcode = '22023';
  end if;
  -- A reply must point at a message in the SAME group. Otherwise a reply is a
  -- way to name a message the replier may not be able to read.
  if new.reply_to_id is not null and not exists (
    select 1 from public.group_messages m
    where m.id = new.reply_to_id and m.group_id = new.group_id
  ) then
    raise exception 'ההודעה שמשיבים לה אינה בקבוצה הזאת' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_insert_guard on public.group_messages;
create trigger messages_insert_guard
  before insert on public.group_messages
  for each row execute function public.guard_message_insert();

-- ── Broadcast: one message to realtime, per change ───────────────────────────
/*
  The topic is `group:<group_id>`, so one channel per group and a subscriber
  authorizes once. `realtime.broadcast_changes` is the function the docs
  prescribe for this, and it uses a PRIVATE channel — which is why the policy
  on `realtime.messages` below is not optional.

  AFTER, and `return null`: the broadcast must not be able to fail the write.
  A message that is in the table but was not delivered is recoverable — the
  client re-reads on reconnect. A message that failed to save because delivery
  failed is not.
*/
create or replace function public.broadcast_group_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'group:' || coalesce(new.group_id, old.group_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return null;
end;
$$;

comment on function public.broadcast_group_message() is
  'Publishes a group message change to the private Realtime topic '
  'group:<group_id>. AFTER and returns null, so delivery can never fail the '
  'write.';

drop trigger if exists messages_broadcast on public.group_messages;
create trigger messages_broadcast
  after insert or update on public.group_messages
  for each row execute function public.broadcast_group_message();

-- ── who may JOIN the channel ─────────────────────────────────────────────────
/** The group id in a `group:<uuid>` topic, or null. CASE-guarded, like the
 *  storage path helpers — a policy that raises refuses everything. */
create or replace function public.topic_group_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_topic, '') ~
      '^group:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then pg_catalog.split_part(p_topic, ':', 2)::uuid
    else null
  end;
$$;

comment on function public.topic_group_id(text) is
  'The group id inside a `group:<uuid>` Realtime topic, or null for anything '
  'else. Used by the realtime.messages policy.';

/*
  Realtime Authorization. Without this policy a private channel admits nobody;
  with a `using (true)` policy — which is what the docs show as the simplest
  example — it would admit every signed-in account to every group's chat.

  So the condition is the real one: the topic must name a group, and the caller
  must be at least a member of it.
*/
drop policy if exists group_chat_join on realtime.messages;
create policy group_chat_join on realtime.messages
  for select
  to authenticated
  using (public.group_rank(public.topic_group_id(realtime.topic())) >= 1);

-- ── unread counts, in one call ───────────────────────────────────────────────
/**
 * How many unread messages the caller has in each of their groups.
 *
 * One RPC rather than a query per group: the groups screen shows a badge on
 * every row, and N round trips for N badges is how a list screen becomes slow.
 *
 * A message the caller WROTE is never unread, and a deleted one is not either.
 */
create or replace function public.group_unread_counts()
returns table (group_id uuid, unread integer, last_seq bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.group_id,
         count(*) filter (
           where m.seq > coalesce(r.last_read_seq, 0)
             and m.author_id <> (select auth.uid())
             and m.deleted_at is null
         )::integer as unread,
         max(m.seq) as last_seq
    from public.group_messages m
    left join public.group_message_reads r
      on r.group_id = m.group_id and r.user_id = (select auth.uid())
   group by m.group_id;
$$;

comment on function public.group_unread_counts() is
  'Unread count per group for the caller, in one round trip. SECURITY '
  'INVOKER: the RLS on group_messages is what scopes it, so it can only ever '
  'count messages the caller may read.';

/** Mark a group read up to a given message. */
create or replace function public.mark_group_read(
  p_group_id uuid,
  p_seq bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.group_message_reads (group_id, user_id, last_read_seq, updated_at)
  values (p_group_id, (select auth.uid()), p_seq, pg_catalog.now())
  on conflict (group_id, user_id) do update
    -- greatest(), so a stale client that reports an older position cannot
    -- resurrect messages the user has already read.
    set last_read_seq = greatest(public.group_message_reads.last_read_seq, excluded.last_read_seq),
        updated_at = pg_catalog.now();
end;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
grant select on public.group_messages, public.group_message_reads
  to anon, authenticated;
/* No DELETE on group_messages: removal is a soft delete, which is an UPDATE. */
grant insert, update on public.group_messages to authenticated;
grant insert, update, delete on public.group_message_reads to authenticated;

revoke execute on function public.guard_message_update() from public, anon, authenticated;
revoke execute on function public.guard_message_insert() from public, anon, authenticated;
revoke execute on function public.broadcast_group_message() from public, anon, authenticated;
revoke all on function public.topic_group_id(text) from public, anon;
revoke all on function public.group_unread_counts() from public, anon;
revoke all on function public.mark_group_read(uuid, bigint) from public, anon;
grant execute on function public.topic_group_id(text) to authenticated;
grant execute on function public.group_unread_counts() to authenticated;
grant execute on function public.mark_group_read(uuid, bigint) to authenticated;
