-- ─────────────────────────────────────────────────────────────────────────────
-- 0031 — invitations that can be revoked and resent, and an identity for chat
--
-- ══════════════════════════════════════════════════════════════════════════
-- EMAIL BINDING WITHOUT EMAIL ENUMERATION
-- ══════════════════════════════════════════════════════════════════════════
--
-- Requirement: "הזמנה באמצעות כתובת אימייל" AND "אין לחשוף אם כתובת אימייל
-- מסוימת קיימת במערכת." Those pull in opposite directions only if the lookup
-- happens at the wrong moment.
--
-- `create_group_invite` NEVER touches `auth.users`. It stores the address the
-- instructor typed and returns a token. There is no lookup, so there is
-- nothing to leak and no difference in behaviour between an address that has
-- an account and one that does not — including in timing.
--
-- The binding is enforced at REDEMPTION, where it costs nothing: if the
-- invitation carries an email, the caller's own verified email must match it.
-- The caller already knows their own address, so this reveals nothing either.
--
-- One message for every failure — "ההזמנה אינה תקפה" — covering wrong token,
-- expired, revoked, already used, and wrong account. Distinguishing them would
-- let a holder of one token learn which of their guesses was once real, and
-- would tell the wrong-account case that the invitation exists.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY "RESEND" MAKES A NEW TOKEN INSTEAD OF EXTENDING THE OLD ONE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Because the reason to resend is usually that the first link went somewhere
-- it should not have — the wrong chat, a shared phone, an address typed wrong.
-- Extending the old token would leave that copy working for another week. So
-- resending REVOKES the old invitation and issues a new one carrying
-- `replaces_id`, which also makes the history readable: two invitations to the
-- same person are a resend, not a mistake.
--
-- ══════════════════════════════════════════════════════════════════════════
-- IDENTITY: WHAT CHAT NEEDS AND WHAT IT MUST NOT GET
-- ══════════════════════════════════════════════════════════════════════════
--
-- A chat needs a name and a face next to each message. `profiles` had neither,
-- and it is own-row-only for good reason — it holds measurement preferences and
-- the professional profile, none of which is anybody else's business.
--
-- So identity is exposed through ONE narrow RPC, `group_roster`, which returns
-- `user_id, display_name, avatar_path, role, joined_at` for members of a group
-- the caller belongs to. No email. No preferences. Nothing about the notebook.
-- §12.3 is untouched: knowing who is in the course is not knowing what they
-- bake.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── identity on the profile ──────────────────────────────────────────────────
alter table public.profiles
  add column if not exists display_name text not null default '';
/* `{user_id}/{uuid}.webp` in the `avatars` bucket, same shape as 0029. */
alter table public.profiles
  add column if not exists avatar_path text;

-- ── the avatars bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = 524288,
       allowed_mime_types = array['image/webp'];

/** The user id at the front of an avatar path, or null. Same CASE-guarded
 *  safe cast as `path_recipe_id` in 0029, and for the same reason: a policy
 *  that raises refuses the legitimate request too. */
create or replace function public.path_user_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.split_part(coalesce(p_name, ''), '/', 1) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then pg_catalog.split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

/**
 * Does the caller share any group with this person?
 *
 * This is the one function here that names another user, so it is worth being
 * precise about what it discloses: a boolean the caller could already obtain
 * from `group_roster`, about a uuid they could only have got from
 * `group_roster` in the first place. It reveals nothing new and it cannot be
 * used to enumerate anything — a uuid is not guessable.
 *
 * SECURITY DEFINER because it reads `group_members` twice, and a policy that
 * did that inline would recurse.
 */
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

comment on function public.shares_group_with(uuid) is
  'Does the CALLER share a group with this user? Used by the avatar read '
  'policy. Discloses only what group_roster already does.';

drop policy if exists avatars_object_read on storage.objects;
create policy avatars_object_read on storage.objects
  for select
  using (
    bucket_id = 'avatars'
    and (
      public.path_user_id(name) = (select auth.uid())
      or public.shares_group_with(public.path_user_id(name))
    )
  );

drop policy if exists avatars_object_write on storage.objects;
create policy avatars_object_write on storage.objects
  for insert
  with check (
    bucket_id = 'avatars' and public.path_user_id(name) = (select auth.uid())
  );

drop policy if exists avatars_object_update on storage.objects;
create policy avatars_object_update on storage.objects
  for update
  using (bucket_id = 'avatars' and public.path_user_id(name) = (select auth.uid()))
  with check (bucket_id = 'avatars' and public.path_user_id(name) = (select auth.uid()));

drop policy if exists avatars_object_delete on storage.objects;
create policy avatars_object_delete on storage.objects
  for delete
  using (bucket_id = 'avatars' and public.path_user_id(name) = (select auth.uid()));

-- ── the roster ───────────────────────────────────────────────────────────────
create or replace function public.group_roster(p_group_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  role text,
  rank integer,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.group_rank(p_group_id) < 1 then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  return query
    select m.user_id,
           p.display_name,
           p.avatar_path,
           m.role,
           public.role_rank(m.role),
           m.joined_at
      from public.group_members m
      left join public.profiles p on p.user_id = m.user_id
     where m.group_id = p_group_id
     order by public.role_rank(m.role) desc, m.joined_at;
end;
$$;

comment on function public.group_roster(uuid) is
  'Who is in this group: id, display name, avatar path, role. NO email and no '
  'preferences. Requires the caller to be a member, checked first.';

-- ── invitations ──────────────────────────────────────────────────────────────
/**
 * Create an invitation. `p_email` null means a link anybody holding the token
 * may redeem; an email binds it to that account at redemption time.
 *
 * NO lookup against auth.users — see the header.
 */
create or replace function public.create_group_invite(
  p_group_id uuid,
  p_email text default null,
  p_label text default ''
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token text;
begin
  if public.group_rank(p_group_id) < 2 then
    raise exception 'only an instructor, an admin or the owner can invite'
      using errcode = '42501';
  end if;

  v_token :=
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into public.group_invites
    (group_id, label, email, token, expires_at, created_by, status)
  values
    (p_group_id, coalesce(p_label, ''), public.normalize_email(p_email), v_token,
     pg_catalog.now() + interval '7 days', (select auth.uid()), 'pending');

  return v_token;
end;
$$;

/** Revoking stops the link working immediately and keeps the record. */
create or replace function public.revoke_group_invite(p_invite_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group uuid;
begin
  select group_id into v_group from public.group_invites where id = p_invite_id;
  if v_group is null then
    raise exception 'ההזמנה אינה קיימת' using errcode = '42501';
  end if;
  if public.group_rank(v_group) < 2 then
    raise exception 'אין הרשאה לבטל הזמנה בקבוצה הזאת' using errcode = '42501';
  end if;

  update public.group_invites
     set status = 'revoked',
         revoked_at = pg_catalog.now(),
         revoked_by = (select auth.uid())
   where id = p_invite_id
     and status = 'pending';
end;
$$;

/**
 * Resend: revoke the old, issue a new one that points back at it.
 *
 * Returns the NEW token. The old link stops working — see the header for why
 * that is the point rather than a side effect.
 */
create or replace function public.resend_group_invite(p_invite_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.group_invites;
  v_token text;
begin
  select * into v_old from public.group_invites where id = p_invite_id;
  if v_old.id is null then
    raise exception 'ההזמנה אינה קיימת' using errcode = '42501';
  end if;
  if public.group_rank(v_old.group_id) < 2 then
    raise exception 'אין הרשאה לשלוח הזמנה בקבוצה הזאת' using errcode = '42501';
  end if;
  if v_old.status = 'accepted' then
    raise exception 'ההזמנה כבר נוצלה, אין מה לשלוח מחדש' using errcode = '42501';
  end if;

  update public.group_invites
     set status = 'revoked',
         revoked_at = pg_catalog.now(),
         revoked_by = (select auth.uid())
   where id = p_invite_id and status = 'pending';

  v_token :=
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into public.group_invites
    (group_id, label, email, token, expires_at, created_by, status, replaces_id)
  values
    (v_old.group_id, v_old.label, v_old.email, v_token,
     pg_catalog.now() + interval '7 days', (select auth.uid()), 'pending',
     v_old.id);

  return v_token;
end;
$$;

/**
 * Redeem. Single use, seven days, and the email binding — all server-side.
 *
 * SECURITY DEFINER because the caller is not a member yet: they cannot read the
 * invitation, the group, or `group_members`. The only row it can create is a
 * 'member' row for `auth.uid()`.
 */
create or replace function public.redeem_group_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.group_invites;
  v_my_email text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- FOR UPDATE: "single use" that only holds when nobody is in a hurry is not
  -- single use.
  select * into v_invite
    from public.group_invites
   where token = p_token
   for update;

  if v_invite.id is null
     or v_invite.status <> 'pending'
     or v_invite.expires_at <= pg_catalog.now() then
    raise exception 'ההזמנה אינה תקפה' using errcode = '42501';
  end if;

  /*
    The email binding. `auth.email()` reads the verified address off the JWT,
    so it is the account's own address and not something the client supplies.
    Same message as every other failure — see the header.
  */
  if v_invite.email is not null then
    v_my_email := public.normalize_email((select auth.email()));
    if v_my_email is null or v_my_email <> v_invite.email then
      raise exception 'ההזמנה אינה תקפה' using errcode = '42501';
    end if;
  end if;

  -- Already a member: succeed without burning the token on a no-op.
  if public.group_rank(v_invite.group_id) >= 1 then
    return v_invite.group_id;
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_invite.group_id, v_uid, 'member');

  update public.group_invites
     set status = 'accepted', used_at = pg_catalog.now(), used_by = v_uid
   where id = v_invite.id;

  -- A pending request from the same person is now moot.
  update public.group_join_requests
     set status = 'withdrawn', decided_at = pg_catalog.now(), decided_by = v_uid
   where group_id = v_invite.group_id and user_id = v_uid and status = 'pending';

  return v_invite.group_id;
end;
$$;

/** The invitee declines. Recorded, so the instructor is not left guessing. */
create or replace function public.reject_group_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.group_invites;
  v_my_email text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_invite from public.group_invites
   where token = p_token for update;

  if v_invite.id is null or v_invite.status <> 'pending' then
    raise exception 'ההזמנה אינה תקפה' using errcode = '42501';
  end if;
  -- Only the bound account may decline a bound invitation: otherwise anyone
  -- holding a leaked link could cancel somebody else's invitation.
  if v_invite.email is not null then
    v_my_email := public.normalize_email((select auth.email()));
    if v_my_email is null or v_my_email <> v_invite.email then
      raise exception 'ההזמנה אינה תקפה' using errcode = '42501';
    end if;
  end if;

  update public.group_invites
     set status = 'rejected', used_at = pg_catalog.now(), used_by = v_uid
   where id = v_invite.id;
end;
$$;

-- ── join requests: the decisions ─────────────────────────────────────────────
create or replace function public.request_group_join(
  p_code text,
  p_note text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group public.groups;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_group from public.groups
   where code = pg_catalog.btrim(p_code);

  if v_group.id is null or not ('code' = any(v_group.join_by)) then
    raise exception 'הקוד אינו מתאים לשום קבוצה' using errcode = '42501';
  end if;
  if public.group_rank(v_group.id) >= 1 then
    raise exception 'אתם כבר חברים בקבוצה הזאת' using errcode = '23505';
  end if;

  -- A second ask re-opens the same row rather than creating another. A person
  -- who was rejected may ask again; that is the instructor's call, not a
  -- permanent ban the schema imposes.
  insert into public.group_join_requests (group_id, user_id, note, status)
  values (v_group.id, v_uid, coalesce(p_note, ''), 'pending')
  on conflict (group_id, user_id) do update
    set status = 'pending',
        note = excluded.note,
        created_at = pg_catalog.now(),
        decided_at = null,
        decided_by = null;

  return v_group.name;
end;
$$;

create or replace function public.approve_group_join(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.group_rank(p_group_id) < 2 then
    raise exception 'אין הרשאה לאשר בקשות בקבוצה הזאת' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.group_join_requests
    where group_id = p_group_id and user_id = p_user_id and status = 'pending'
  ) then
    raise exception 'אין בקשה ממתינה מהמשתמש הזה' using errcode = '42501';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (p_group_id, p_user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  /*
    The request row is REMOVED rather than marked 'accepted'. There is no
    'accepted' status by design (0030): `group_members` is the only answer to
    "is this person a member", and a second row claiming to know would
    eventually disagree with it.
  */
  delete from public.group_join_requests
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.reject_group_join(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.group_rank(p_group_id) < 2 then
    raise exception 'אין הרשאה לדחות בקשות בקבוצה הזאת' using errcode = '42501';
  end if;

  update public.group_join_requests
     set status = 'rejected',
         decided_at = pg_catalog.now(),
         decided_by = (select auth.uid())
   where group_id = p_group_id and user_id = p_user_id and status = 'pending';
end;
$$;

create or replace function public.withdraw_group_join(p_group_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.group_join_requests
     set status = 'withdrawn',
         decided_at = pg_catalog.now(),
         decided_by = (select auth.uid())
   where group_id = p_group_id
     and user_id = (select auth.uid())
     and status = 'pending';
end;
$$;

-- ── the requests policy has to see status now ────────────────────────────────
/* An UPDATE policy is needed because `reject_group_join` and
   `withdraw_group_join` are SECURITY INVOKER — deliberately, since both are
   acts by someone who can already see the row. */
drop policy if exists requests_update on public.group_join_requests;
create policy requests_update on public.group_join_requests
  for update
  using (
    public.group_rank(group_id) >= 2
    or user_id = (select auth.uid())
  )
  with check (
    public.group_rank(group_id) >= 2
    or user_id = (select auth.uid())
  );

-- ── grants ───────────────────────────────────────────────────────────────────
revoke all on function public.path_user_id(text) from public, anon;
revoke all on function public.shares_group_with(uuid) from public, anon;
revoke all on function public.group_roster(uuid) from public, anon;
revoke all on function public.create_group_invite(uuid, text, text) from public, anon;
revoke all on function public.revoke_group_invite(uuid) from public, anon;
revoke all on function public.resend_group_invite(uuid) from public, anon;
revoke all on function public.redeem_group_invite(text) from public, anon;
revoke all on function public.reject_group_invite(text) from public, anon;
revoke all on function public.request_group_join(text, text) from public, anon;
revoke all on function public.approve_group_join(uuid, uuid) from public, anon;
revoke all on function public.reject_group_join(uuid, uuid) from public, anon;
revoke all on function public.withdraw_group_join(uuid) from public, anon;

grant execute on function public.path_user_id(text) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.group_roster(uuid) to authenticated;
grant execute on function public.create_group_invite(uuid, text, text) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.resend_group_invite(uuid) to authenticated;
grant execute on function public.redeem_group_invite(text) to authenticated;
grant execute on function public.reject_group_invite(text) to authenticated;
grant execute on function public.request_group_join(text, text) to authenticated;
grant execute on function public.approve_group_join(uuid, uuid) to authenticated;
grant execute on function public.reject_group_join(uuid, uuid) to authenticated;
grant execute on function public.withdraw_group_join(uuid) to authenticated;

-- The two-argument `create_group_invite` from 0027 is replaced by the
-- three-argument version above. Dropping it explicitly: leaving both would let
-- PostgREST pick either one by argument name, and the old one has no `email`.
drop function if exists public.create_group_invite(uuid, text);
