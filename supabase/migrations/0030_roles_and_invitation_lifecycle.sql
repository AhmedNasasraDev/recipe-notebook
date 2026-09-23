-- ─────────────────────────────────────────────────────────────────────────────
-- 0030 — a fourth role, and a lifecycle for invitations
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY RENUMBERING THE RANKS IS THE EXPENSIVE PART, AND HOW IT IS DONE SAFELY
-- ══════════════════════════════════════════════════════════════════════════
--
-- 0023 defined owner 3, instructor 2, member 1. `admin` goes between owner and
-- instructor, so the ranks become owner 4, admin 3, instructor 2, member 1 —
-- and every policy that said `= 3` meaning "the owner" now says something
-- else. There are five of them and each needed a decision rather than a
-- find-and-replace:
--
--   groups_write   `= 3` → `>= 3`   settings are management: owner AND admin
--   groups_delete  `= 3` → `= 4`    deleting the group stays the owner's alone
--   members_role   `= 3` → `>= 3` + the invariant below
--   members_remove `= 3` → `>= 3` + the invariant below
--   (everything on `>= 1` and `>= 2` is unchanged by construction: adding a
--    rank ABOVE instructor cannot change what "at least instructor" means)
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE ONE INVARIANT THAT KEEPS AN ADMIN FROM BECOMING AN OWNER
-- ══════════════════════════════════════════════════════════════════════════
--
--   You may only set or remove a role STRICTLY BELOW your own rank.
--
-- That single sentence replaces a list of special cases, and it is expressible
-- as a policy because `using` sees the row as it IS and `with check` sees it as
-- it WILL BE. Both sides get the same condition, so:
--
--   · an admin (3) can act on instructors and members, not on other admins and
--     not on the owner;
--   · an owner (4) can appoint admins, and CANNOT appoint another owner —
--     there is no rank 4 they are allowed to write;
--   · nobody can promote themselves, because their own rank is never strictly
--     below itself.
--
-- Transferring ownership is therefore deliberately NOT possible through this
-- policy. It is a real operation and it deserves its own RPC with its own
-- confirmation; inventing it as a side effect of a role dropdown would be the
-- wrong way to acquire it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY `group_members` STILL HAS NO `status` COLUMN
-- ══════════════════════════════════════════════════════════════════════════
--
-- Requested: Pending / Accepted / Rejected / Revoked. Those are states of an
-- INVITATION, and that is where they live.
--
-- A row in `group_members` means access — full stop, no predicate. The moment
-- it means "access if status = 'active'", every one of the seventeen policies
-- that asks about membership has to remember the predicate, and so does every
-- policy added later. The first one that forgets admits somebody nobody
-- approved. Keeping the lifecycle on the invitation makes that class of bug
-- unreachable rather than merely avoided.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the role set ─────────────────────────────────────────────────────────────
alter table public.group_members
  drop constraint if exists group_members_role_check;
alter table public.group_members
  add constraint group_members_role_check
  check (role in ('owner', 'admin', 'instructor', 'member'));

/**
 * The rank of a role NAME. Pure, so a policy can use it on a row's column.
 *
 * Separate from `group_rank`, which answers about the caller. This one answers
 * about a value — which is what the role-change invariant needs, because it
 * compares the caller's rank against the rank being written.
 */
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
           when 'owner' then 4
           when 'admin' then 3
           when 'instructor' then 2
           when 'member' then 1
           else 0
         end;
$$;

comment on function public.role_rank(text) is
  'The §10.1 rank of a role name: owner 4, admin 3, instructor 2, member 1, '
  'anything else 0. IMMUTABLE and pure — it answers about a VALUE, unlike '
  'group_rank which answers about the caller.';

-- `group_rank` renumbered, and expressed in terms of `role_rank` so the two
-- can no longer disagree about what a role is worth.
create or replace function public.group_rank(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce(
      (
        select public.role_rank(m.role)
        from public.group_members m
        where m.group_id = p_group_id
          and m.user_id = (select auth.uid())
      ),
      0
    ),
    -- The owner anchor from 0023: an owner is never locked out of their own
    -- group by a missing membership row.
    case
      when exists (
        select 1 from public.groups g
        where g.id = p_group_id and g.owner_id = (select auth.uid())
      ) then 4
      else 0
    end
  );
$$;

comment on function public.group_rank(uuid) is
  'The CALLER''s rank in this group: owner 4, admin 3, instructor 2, member 1, '
  'non-member 0. Takes no user parameter. Granted to `authenticated` because '
  'RLS policies call it — see 0026.';

-- ── the policies that changed meaning ────────────────────────────────────────

-- Settings are management: the owner and an admin.
drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for update
  using (public.group_rank(id) >= 3)
  with check (public.group_rank(id) >= 3);

-- Deleting the group takes every course, lesson, item and group recipe with it.
-- That stays the owner's alone.
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete using (public.group_rank(id) = 4);

/*
  The invariant, both sides. `using` reads the row's CURRENT role, `with check`
  reads the role being written, and both must be strictly below the caller's
  rank.
*/
drop policy if exists members_role on public.group_members;
create policy members_role on public.group_members
  for update
  using (
    public.group_rank(group_id) >= 3
    and public.role_rank(role) < public.group_rank(group_id)
  )
  with check (
    public.group_rank(group_id) >= 3
    and public.role_rank(role) < public.group_rank(group_id)
  );

/*
  Removal: staff may remove someone BELOW them, and anybody may remove
  themselves. §12.4 cuts both ways — a private group nobody can leave is a
  trap.
*/
drop policy if exists members_remove on public.group_members;
create policy members_remove on public.group_members
  for delete
  using (
    (
      public.group_rank(group_id) >= 3
      and public.role_rank(role) < public.group_rank(group_id)
    )
    or user_id = (select auth.uid())
  );

/*
  ── staff may add a member directly ────────────────────────────────────────

  Requested: "מנהל יכול לאשר או להסיר חברים". Adding somebody straight in is
  not one of §10.2's four ways to JOIN — it is the staff acting on a person who
  is already known to them — so it is a separate policy from
  `members_bootstrap` and it is bounded the same way as every other role write:
  strictly below the caller's rank, which means an admin can add members and
  instructors and can never mint an owner.
*/
drop policy if exists members_add_by_staff on public.group_members;
create policy members_add_by_staff on public.group_members
  for insert
  with check (
    public.group_rank(group_id) >= 3
    and public.role_rank(role) < public.group_rank(group_id)
  );

/*
  ── the owner's membership row cannot simply be deleted ────────────────────

  `members_remove` lets anyone remove themselves, and without this an owner
  could delete their own row. `group_rank` would still return 4 through the
  `groups.owner_id` anchor, so nothing would break — but the roster would stop
  listing the person who owns the group, which is a lie the UI would repeat.
  Leaving is for members; an owner deletes the group or hands it over.
*/
create or replace function public.guard_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and exists (
    select 1 from public.groups g where g.id = old.group_id
  ) then
    raise exception
      'בעל הקבוצה אינו יכול לעזוב אותה. אפשר למחוק את הקבוצה או להעביר בעלות.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

comment on function public.guard_owner_membership() is
  'Stops the owner''s membership row being deleted while the group exists. '
  'The `exists` check is what lets a group DELETE cascade through — see 0021 '
  'for the same pattern and why a cascade looks like a missing parent.';

drop trigger if exists members_owner_guard on public.group_members;
create trigger members_owner_guard
  before delete on public.group_members
  for each row execute function public.guard_owner_membership();

-- ── invitations: an explicit lifecycle ───────────────────────────────────────
/*
  `status` is stored, and `expired` is NOT one of its values. An invitation does
  not become expired by an event — it simply is, once `expires_at` has passed —
  and a stored flag would need a cron job to stay true. `invite_state()` below
  derives it, the same way §13a derives the HACCP status rather than storing it.
*/
alter table public.group_invites
  add column if not exists status text not null default 'pending';
alter table public.group_invites
  add column if not exists email text;
alter table public.group_invites
  add column if not exists revoked_at timestamptz;
alter table public.group_invites
  add column if not exists revoked_by uuid references auth.users (id) on delete set null;
/* Which invitation this one replaces, so "resend" is traceable rather than
   looking like two invitations to the same person for no reason. */
alter table public.group_invites
  add column if not exists replaces_id uuid references public.group_invites (id) on delete set null;

-- Backfill before the constraint, so an existing row cannot fail it. There are
-- none today; a migration that assumed that would be wrong tomorrow.
update public.group_invites
   set status = case when used_at is not null then 'accepted' else 'pending' end
 where status not in ('pending', 'accepted', 'rejected', 'revoked');

alter table public.group_invites
  drop constraint if exists group_invites_status_check;
alter table public.group_invites
  add constraint group_invites_status_check
  check (status in ('pending', 'accepted', 'rejected', 'revoked'));

/*
  The email is stored lowercased and trimmed, because it is COMPARED at
  redemption — see 0031's `redeem_group_invite`. A case difference between what
  the instructor typed and what the account holds would refuse a legitimate
  invitee, and that failure would look like a broken link.
*/
create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
$$;

/** The state an invitation is actually in, expiry included. */
create or replace function public.invite_state(p_invite public.group_invites)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_invite.status <> 'pending' then p_invite.status
    when p_invite.expires_at <= pg_catalog.now() then 'expired'
    else 'pending'
  end;
$$;

comment on function public.invite_state(public.group_invites) is
  'The invitation''s real state. `expired` is derived from expires_at rather '
  'than stored, because nothing happens at the moment an invitation expires '
  'and a stored flag would need a cron job to stay honest.';

create index if not exists group_invites_email_idx
  on public.group_invites (public.normalize_email(email))
  where email is not null and status = 'pending';

-- ── join requests: the same treatment ────────────────────────────────────────
alter table public.group_join_requests
  add column if not exists status text not null default 'pending';
alter table public.group_join_requests
  add column if not exists decided_at timestamptz;
alter table public.group_join_requests
  add column if not exists decided_by uuid references auth.users (id) on delete set null;

alter table public.group_join_requests
  drop constraint if exists group_join_requests_status_check;
alter table public.group_join_requests
  add constraint group_join_requests_status_check
  check (status in ('pending', 'rejected', 'withdrawn'));

/*
  There is no 'accepted'. An accepted request BECOMES a membership and the
  request row is removed — keeping an 'accepted' row would create a second
  place that claims to know whether somebody is a member, and the two would
  eventually disagree. `group_members` is the only answer to that question.
*/

-- ── grants ───────────────────────────────────────────────────────────────────
revoke all on function public.role_rank(text) from public, anon;
revoke all on function public.normalize_email(text) from public, anon;
revoke all on function public.invite_state(public.group_invites) from public, anon;
revoke execute on function public.guard_owner_membership() from public, anon, authenticated;
grant execute on function public.role_rank(text) to authenticated;
grant execute on function public.normalize_email(text) to authenticated;
grant execute on function public.invite_state(public.group_invites) to authenticated;
