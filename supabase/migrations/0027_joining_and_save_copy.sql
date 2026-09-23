-- ─────────────────────────────────────────────────────────────────────────────
-- 0027 — the four ways into a group (§10.2), and §11's save-copy
--
-- HANDOFF §7 steps 6 and 7.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY A PENDING REQUEST IS ITS OWN TABLE AND NOT A STATUS COLUMN
-- ══════════════════════════════════════════════════════════════════════════
--
-- §6: "קוד קבוצה אינו מעניק חברות — הוא יוצר בקשה שדורשת אישור". A join code
-- must produce a REQUEST, never membership.
--
-- The cheaper design is a `status` column on `group_members` ('pending' |
-- 'active'), and `approve` becomes an UPDATE. It is also the design where one
-- forgotten `and status = 'active'` — in any of the eleven policies that ask
-- about membership, or in any policy added later — silently admits someone an
-- admin never approved.
--
-- `group_join_requests` cannot fail that way. A row in it grants nothing
-- because NO POLICY REFERENCES IT. There is no predicate to forget.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ON STORING INVITE TOKENS IN PLAINTEXT — a deliberate choice, with its cost
-- ══════════════════════════════════════════════════════════════════════════
--
-- Best practice for a bearer token is to store a hash, so a database read does
-- not yield working credentials. That is not what this does, and the reason is
-- the delivery channel.
--
-- HANDOFF §4 specifies `POST /groups/:id/invite → creates invite + SENDS MAIL`.
-- There is no mail service in this project. Until there is, the only way an
-- invitation reaches anyone is the instructor copying the link and sending it
-- themselves — WhatsApp, SMS, in person. That means the link has to be
-- readable again after it was created: an instructor who closes the screen, or
-- who is asked "resend it, I lost it", must be able to get the same link back.
-- Hashing would make the token unreadable after the one moment it was
-- generated, which in the absence of a mailer makes invitations unusable
-- rather than secure.
--
-- What limits the exposure instead:
--   · RLS restricts reads to the group's owner and instructors — the people who
--     created the invitation.
--   · Single use: `used_at` is set on redemption and a used token is refused.
--   · Seven days (§6), enforced server-side in the redeem function, not by the
--     client.
--   · The token is not a guessable id: 64 hex characters, from two
--     `gen_random_uuid()` values with the dashes removed. This line used to
--     say "32 bytes from `gen_random_bytes`", which the body of this same
--     migration then explains is NOT what happens — `gen_random_bytes` is
--     pgcrypto, it is not on the search_path this function pins, and the
--     first attempt failed with 42883. A header that contradicts its own body
--     is worse than no header, so it now says what the code does.
--
-- IF A MAIL SERVICE IS ADDED, this should change: the mailer becomes the
-- delivery channel, nobody needs to re-read the link, and the column should
-- hold `sha256(token)` with the raw value returned once to the caller. That is
-- a small migration and it is the right one to make at that point.
--
-- STAGE 12, AND THE DECISION THAT DID NOT CHANGE. A mail service now exists
-- (`functions/send-group-invite`), so the paragraph above came due — and the
-- answer is still plaintext, for a reason that is about the product rather
-- than about effort:
--
--   · §10.2 lists "קישור פרטי" as one of the four ways in, separately from
--     "הזמנה אישית". An open link has no address to mail it to; it is handed
--     over in a lesson, so it has to be readable after it was created.
--   · The permissions screen shows the link beside every pending invitation,
--     because the mail service can legitimately be unconnected or bounce, and
--     "copy the link" is the fallback that keeps a class working.
--
-- Hashing would break both. What limits the exposure is unchanged and now
-- narrower than in 0027: staff-only reads, single use, seven days, an address
-- binding checked against `auth.email()` (0031) so a leaked link is not a way
-- in, and `revoke`/`resend` to kill one deliberately. The day the product
-- drops the open-link method, hashing becomes the right change.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT IS SECURITY DEFINER HERE AND WHY EACH ONE HAS TO BE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Joining is the one operation a non-member performs, so by definition it
-- cannot be done under the caller's own privileges: they cannot read the group,
-- cannot read the invite, and cannot insert into `group_members`. Three
-- functions are therefore DEFINER — and only three. `save_group_recipe_copy`
-- looked like a fourth and is not; see the note on it below. Each of the three
-- is written so that the ONLY row it can create is a membership for
-- `auth.uid()`:
--
--   redeem_group_invite   takes a token. Adds auth.uid() as 'member'.
--   request_group_join    takes a code. Adds a REQUEST for auth.uid().
--   approve_group_join    takes a group and a user, and checks the CALLER's
--                         rank >= 2 first. This one can name another user, so
--                         the rank check is the whole security argument and it
--                         is the first thing in the body.
--
-- None of them accepts a role above 'member'. Promotion stays an UPDATE under
-- the `members_role` policy, which is the owner's alone.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── invitations ──────────────────────────────────────────────────────────────
create table if not exists public.group_invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  /*
    Who it was meant for. Free text and nullable: §10.2 says "מייל/טלפון", and
    a link invitation is for nobody in particular. It is a LABEL, not a check —
    redemption is by token, so this never decides who may join. Writing it that
    way on purpose: an email column that looked like a check, but was not,
    would be the more dangerous design.
  */
  label       text not null default '',
  token       text not null unique,
  expires_at  timestamptz not null,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid references auth.users (id) on delete set null
);

create index if not exists group_invites_group_idx
  on public.group_invites (group_id, created_at desc);

-- ── pending join requests ────────────────────────────────────────────────────
create table if not exists public.group_join_requests (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_requests_group_idx
  on public.group_join_requests (group_id, created_at);

alter table public.group_invites        enable row level security;
alter table public.group_join_requests  enable row level security;

/*
  Invitations are visible to the group's staff only. A member does not need to
  see them, and an invitee never reads the row — they present the token to
  `redeem_group_invite`, which runs as the owner.
*/
drop policy if exists invites_staff on public.group_invites;
create policy invites_staff on public.group_invites
  for all
  using (public.group_rank(group_id) >= 2)
  with check (public.group_rank(group_id) >= 2);

/*
  A request is visible to the group's staff — who must act on it — and to the
  person who made it, so they can see it is pending and withdraw it. Nothing
  else reads it, and no access policy anywhere references this table.
*/
drop policy if exists requests_read on public.group_join_requests;
create policy requests_read on public.group_join_requests
  for select
  using (
    public.group_rank(group_id) >= 2
    or user_id = (select auth.uid())
  );

-- Staff may reject (delete); the requester may withdraw their own.
drop policy if exists requests_delete on public.group_join_requests;
create policy requests_delete on public.group_join_requests
  for delete
  using (
    public.group_rank(group_id) >= 2
    or user_id = (select auth.uid())
  );

/*
  No INSERT policy. A request is only ever created by `request_group_join`,
  which runs as the owner — a non-member cannot reach the group row to know it
  exists, so there is nothing for an INSERT policy to check against.
*/

-- ── creating an invitation ───────────────────────────────────────────────────
/**
 * §10.2 invitation / private link. Returns the token; the caller builds the
 * link. Seven days (§6), set here rather than accepted from the client.
 */
create or replace function public.create_group_invite(
  p_group_id uuid,
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
    raise exception 'only an instructor or the owner can invite'
      using errcode = '42501';
  end if;

  /*
    THE TOKEN, AND WHY IT IS NOT `gen_random_bytes`

    The obvious version is `encode(gen_random_bytes(32), 'base64')`. It failed
    here with `function pg_catalog.gen_random_bytes(integer) does not exist`,
    because `gen_random_bytes` is pgcrypto and Supabase installs pgcrypto into
    the `extensions` schema — and this function runs with `search_path = ''`,
    so every name must be qualified with the schema it is actually in.

    Qualifying it as `extensions.gen_random_bytes` would work today and ties an
    invitation token to where one host happens to put an extension. Two
    `gen_random_uuid()` values do the same job with no extension at all: it is
    in `pg_catalog` in PostgreSQL 13 and later, each value carries 122 random
    bits, and the hex text is URL-safe by construction — no '+' or '/' to be
    escaped by one client and not another, which is the kind of bug that only
    shows up for some invitees.
  */
  v_token :=
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into public.group_invites
    (group_id, label, token, expires_at, created_by)
  values
    (p_group_id, coalesce(p_label, ''), v_token,
     pg_catalog.now() + interval '7 days', (select auth.uid()));

  return v_token;
end;
$$;

comment on function public.create_group_invite(uuid, text) is
  'Creates a 7-day single-use invitation and returns its token. SECURITY '
  'INVOKER: the `invites_staff` policy is what authorises it.';

-- ── redeeming an invitation ──────────────────────────────────────────────────
/**
 * §10.2 / §6: single use, seven days, CHECKED ON THE SERVER.
 *
 * SECURITY DEFINER because the caller is not a member yet: they cannot read
 * the invite, cannot read the group, and cannot insert into `group_members`.
 * The only row it can ever create is a 'member' row for `auth.uid()`.
 *
 * Returns the group id so the UI can navigate there. A wrong, expired or used
 * token gets ONE message — 'ההזמנה אינה תקפה' — because distinguishing
 * "expired" from "never existed" tells a guesser which of their guesses was
 * once a real token.
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
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  /*
    FOR UPDATE, so two people redeeming the same link at the same moment
    cannot both pass the `used_at is null` check. "Single use" that holds only
    when nobody is in a hurry is not single use.
  */
  select * into v_invite
    from public.group_invites
   where token = p_token
   for update;

  if v_invite.id is null
     or v_invite.used_at is not null
     or v_invite.expires_at <= pg_catalog.now() then
    raise exception 'ההזמנה אינה תקפה' using errcode = '42501';
  end if;

  -- Already a member: succeed quietly and do not burn the token on a no-op.
  if public.group_rank(v_invite.group_id) >= 1 then
    return v_invite.group_id;
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_invite.group_id, v_uid, 'member');

  update public.group_invites
     set used_at = pg_catalog.now(), used_by = v_uid
   where id = v_invite.id;

  -- A pending request from the same person is now moot.
  delete from public.group_join_requests
   where group_id = v_invite.group_id and user_id = v_uid;

  return v_invite.group_id;
end;
$$;

comment on function public.redeem_group_invite(text) is
  'Joins the CALLER to a group by invitation token. Single use and 7 days, '
  'both enforced here. SECURITY DEFINER because a non-member cannot read the '
  'invite; it can only ever add auth.uid() as a plain member.';

-- ── asking to join with a code ───────────────────────────────────────────────
/**
 * §6: "קוד קבוצה אינו מעניק חברות — הוא יוצר בקשה שדורשת אישור".
 *
 * Returns the group's NAME, so the person can see what they asked to join.
 * That is also the one thing this function leaks: a valid code tells you a
 * group by that name exists. It is inherent to having a join code at all.
 *
 * `REQUIRES BACKEND`: a per-account rate limit belongs in front of this. A
 * short code is guessable at volume, and Postgres is the wrong place to count
 * attempts per minute. Not pretending otherwise.
 */
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

  select * into v_group
    from public.groups
   where code = pg_catalog.btrim(p_code);

  -- One message for "no such code" and for "this group does not take codes".
  if v_group.id is null or not ('code' = any(v_group.join_by)) then
    raise exception 'הקוד אינו מתאים לשום קבוצה' using errcode = '42501';
  end if;

  if public.group_rank(v_group.id) >= 1 then
    raise exception 'אתם כבר חברים בקבוצה הזאת' using errcode = '23505';
  end if;

  insert into public.group_join_requests (group_id, user_id, note)
  values (v_group.id, v_uid, coalesce(p_note, ''))
  on conflict (group_id, user_id) do nothing;

  return v_group.name;
end;
$$;

comment on function public.request_group_join(text, text) is
  'Creates a PENDING request from the caller for the group with this code. '
  'Never grants membership (§6). SECURITY DEFINER because a non-member cannot '
  'read the group row.';

-- ── approving a request ──────────────────────────────────────────────────────
/**
 * §10.1: `invite` belongs to owner and instructor.
 *
 * This is the one function here that can name a DIFFERENT user, so the rank
 * check is the entire security argument and it is the first statement in the
 * body. It also refuses any role but 'member': promotion is a separate act,
 * under `members_role`, which is the owner's alone.
 */
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
    raise exception 'only an instructor or the owner can approve'
      using errcode = '42501';
  end if;

  -- There must BE a request. This function approves; it does not add people
  -- who never asked, which would make it a way to put anyone in any group.
  if not exists (
    select 1 from public.group_join_requests
    where group_id = p_group_id and user_id = p_user_id
  ) then
    raise exception 'אין בקשה ממתינה מהמשתמש הזה' using errcode = '42501';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (p_group_id, p_user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  delete from public.group_join_requests
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

comment on function public.approve_group_join(uuid, uuid) is
  'Turns a pending request into a plain membership. Requires the CALLER to be '
  'rank >= 2 in that group, checked first. Refuses a user who never asked.';

-- ── §11 save a copy of a group recipe into my own notebook ───────────────────
/**
 * HANDOFF §4: "`save-copy` חייב להיות בצד שרת. בדיקת `perm_save` בצד לקוח היא
 * UX בלבד."
 *
 * The rules, from §11, in the order they are checked:
 *
 *   1. `perm_save` must be true ON THE ITEM. Not on the recipe, not in the
 *      client's copy of it — read here, now.
 *   2. If a copy already exists (`saved_from_item_id` matches), no second copy
 *      is made; the existing one is returned so the caller can navigate to it.
 *   3. The copy is the caller's: new id, their `owner_id`, `group_id` null,
 *      `locked` false, name + " — העותק שלי".
 *   4. `versions`, `trials`, `batches` are NOT copied. A version history and a
 *      HACCP record belong to whoever produced them; copying a batch record
 *      would fabricate food-safety documentation. `duplicateRecipe` in the app
 *      refuses the same three for the same reason.
 *   5. The personal note the caller wrote ON THE GROUP ITEM moves into the
 *      copy's `privateNotes` — it is their note about this recipe, and §8 keeps
 *      it theirs.
 *   6. The group's recipe is not touched. Not once, not in any branch.
 *
 * SECURITY INVOKER — and it is worth saying why, because the obvious reading
 * of HANDOFF §4 ("save-copy must be server-side") is that it needs elevated
 * privilege. It does not. Every step is something the caller may already do
 * under their own RLS:
 *
 *   read the item        `items_read`, and only with perm_view
 *   read the recipe      `recipes_group_read`
 *   read its children    `ingredients_readable` / `steps_readable`
 *   write the copy       `recipes_own` — the copy is theirs
 *   write its children   the `owns_recipe` policies from 0002
 *   read and write the note   `private_notes` is theirs alone (§8)
 *
 * What §4 is actually asking for is that `perm_save` be decided by the SERVER,
 * and it is: this body runs in the database, and a client cannot skip it and
 * get a copy with `saved_from_item_id` set. Running as INVOKER instead of
 * DEFINER means this function cannot be turned into a way to read a recipe the
 * caller could not already read — which, for a function that takes an id and
 * copies rows, is worth more than the convenience.
 *
 * To be precise about what `perm_save` therefore is NOT: a student who can SEE
 * a recipe can always retype it. `perm_view` is the information barrier;
 * `perm_save` governs this convenience and the `savedFrom` link it records.
 */
create or replace function public.save_group_recipe_copy(p_item_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_item  public.group_recipe_items;
  v_src   public.recipes;
  v_new   uuid;
  v_note  text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.group_recipe_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'הפריט אינו קיים' using errcode = '42501';
  end if;

  -- Must be a member, and the item must be one they are allowed to see.
  if public.lesson_rank(v_item.lesson_id) < 1 or not v_item.perm_view then
    raise exception 'הפריט אינו קיים' using errcode = '42501';
  end if;

  -- Rule 1. The server's answer, not the client's.
  if not v_item.perm_save then
    raise exception
      'המדריך לא אישר שמירה של המתכון הזה למחברת אישית'
      using errcode = '42501';
  end if;

  -- Rule 2. Idempotent: the same item saved twice gives one copy.
  select id into v_new
    from public.recipes
   where owner_id = v_uid and saved_from_item_id = p_item_id
   limit 1;
  if v_new is not null then
    return v_new;
  end if;

  select * into v_src from public.recipes where id = v_item.recipe_id;
  if v_src.id is null then
    raise exception 'המתכון אינו קיים' using errcode = '42501';
  end if;

  -- Rule 3. Every column copied explicitly. A `select *`-style copy would pick
  -- up the next column someone adds, and `owner_id` or `group_id` arriving by
  -- accident is the whole bug this function exists to prevent.
  insert into public.recipes (
    owner_id, group_id, name, category, tags, is_sub, locked,
    yield_units, unit_weight, yield_actual, weight_before, weight_after,
    dough_mode, ddt, flour_temp, room_temp, friction, target_fc, target_gm,
    labor_cost, other_cost, packaging_cost, sale_price, sale_price_basis,
    shelf_life, storage, freezing, thawing, equipment, notes,
    manual_allergens, pan, version_of, version_note, saved_from_item_id
  )
  values (
    v_uid, null,
    v_src.name || ' — העותק שלי',
    v_src.category, v_src.tags, v_src.is_sub, false,
    v_src.yield_units, v_src.unit_weight, v_src.yield_actual,
    v_src.weight_before, v_src.weight_after,
    v_src.dough_mode, v_src.ddt, v_src.flour_temp, v_src.room_temp,
    v_src.friction, v_src.target_fc, v_src.target_gm,
    v_src.labor_cost, v_src.other_cost, v_src.packaging_cost,
    v_src.sale_price, v_src.sale_price_basis,
    v_src.shelf_life, v_src.storage, v_src.freezing, v_src.thawing,
    v_src.equipment, v_src.notes, v_src.manual_allergens, v_src.pan,
    null,
    'עותק אישי מהקבוצה',
    p_item_id
  )
  returning id into v_new;

  /*
    Ingredients. `sub_recipe_id` is deliberately NOT carried over: it would
    point at a recipe in the GROUP's notebook, which this account may lose
    access to the moment they leave. The line keeps its name and quantity and
    becomes a plain ingredient — honest about what it is, rather than a link
    that breaks later.
  */
  insert into public.ingredients (
    recipe_id, ord, name, ingredient_key, qty, unit, flour, liquid,
    water_pct, unit_weight, g_per_100, price, price_unit, sub_recipe_id, note
  )
  select v_new, i.ord, i.name, i.ingredient_key, i.qty, i.unit, i.flour,
         i.liquid, i.water_pct, i.unit_weight, i.g_per_100, i.price,
         i.price_unit, null, i.note
    from public.ingredients i
   where i.recipe_id = v_src.id
   order by i.ord;

  insert into public.steps (recipe_id, ord, text, kind, temp, temp_unit, minutes)
  select v_new, s.ord, s.text, s.kind, s.temp, s.temp_unit, s.minutes
    from public.steps s
   where s.recipe_id = v_src.id
   order by s.ord;

  insert into public.issues (recipe_id, ord, problem, solution)
  select v_new, x.ord, x.problem, x.solution
    from public.issues x
   where x.recipe_id = v_src.id
   order by x.ord;

  -- Rule 5. The note the caller wrote on the group item becomes the copy's
  -- private note. Only theirs — the WHERE is on user_id.
  select body into v_note
    from public.private_notes
   where user_id = v_uid and group_item_id = p_item_id;

  if v_note is not null and pg_catalog.btrim(v_note) <> '' then
    insert into public.private_notes (user_id, recipe_id, body)
    values (v_uid, v_new, v_note)
    on conflict (user_id, recipe_id) where recipe_id is not null
    do update set body = excluded.body;
  end if;

  return v_new;
end;
$$;

comment on function public.save_group_recipe_copy(uuid) is
  '§11: copies a group recipe into the caller''s own notebook. SECURITY '
  'INVOKER — every step is within the caller''s own RLS. Checks perm_save on '
  'the server (HANDOFF §4), never copies versions/trials/batches, and never '
  'touches the group''s recipe.';

-- ── grants ───────────────────────────────────────────────────────────────────
grant select on public.group_invites, public.group_join_requests
  to anon, authenticated;
grant insert, update, delete on public.group_invites, public.group_join_requests
  to authenticated;

revoke all on function public.create_group_invite(uuid, text) from public, anon;
revoke all on function public.redeem_group_invite(text) from public, anon;
revoke all on function public.request_group_join(text, text) from public, anon;
revoke all on function public.approve_group_join(uuid, uuid) from public, anon;
revoke all on function public.save_group_recipe_copy(uuid) from public, anon;
grant execute on function public.create_group_invite(uuid, text) to authenticated;
grant execute on function public.redeem_group_invite(text) to authenticated;
grant execute on function public.request_group_join(text, text) to authenticated;
grant execute on function public.approve_group_join(uuid, uuid) to authenticated;
grant execute on function public.save_group_recipe_copy(uuid) to authenticated;
