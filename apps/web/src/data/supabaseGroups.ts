// §10 — the Supabase implementation of GroupRepository and IdentityRepository.
//
// Split out of supabaseRepository.ts because it is a large, self-contained
// surface; it is spread into the same object, so nothing above the seam knows
// there are two files.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THAT SHAPES EVERY WRITE IN THIS FILE
//
// An UPDATE or DELETE that RLS refuses matches ZERO ROWS and raises NOTHING.
// PostgREST returns 200 with an empty body, and a client that does not look
// reports success for a write the database declined. That is not a theory: the
// SQL suites in supabase/tests measure it in both directions — a DELETE no
// policy admits is `rows: 0`, while an UPDATE that fails a `with check` raises
// 42501.
//
// So every write here asks for the affected rows back and refuses to return
// normally when there are none. `expectOne` is that check, and its message is
// deliberately about permission rather than about existence, because from the
// client's side those two are the same answer — and telling them apart would
// disclose which ids exist.
//
// WHY READS DO NOT NEED THE SAME TREATMENT
//
// A read that RLS filters comes back empty, which is the honest answer to
// "what may I see". The screens render an empty state; nothing is claimed.
//
// WHAT IS NOT VERIFIED HERE, AND HOW IT IS VERIFIED INSTEAD
//
// This sandbox cannot reach *.supabase.co, so no code in this file has been
// run against the live project. What HAS been measured on the live project is
// everything it depends on: the policies, the triggers, the RPC behaviour and
// the Realtime join predicate, in supabase/tests/*.sql. The mapping and the
// refusal handling in this file are covered by unit tests against a fake
// PostgREST client (supabaseGroups.test.ts), and the screens are covered
// against the fake repository. Those are different claims from "the chat was
// seen working in a browser", and this comment exists so nobody reads one as
// the other.

import { generateJoinCode, normaliseJoinCode } from '../features/groups/joinCode.js';
import { describeCause } from '../lib/errorText.js';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { TypedSupabaseClient } from '../lib/supabase.js';
import type {
  GroupInviteRow,
  GroupJoinRequestRow,
  GroupMessageRow,
  GroupRole,
  GroupRow,
  JoinMethod,
  LessonRow,
} from '../lib/database.types.js';
import type {
  ChatEvents,
  ChatSubscription,
  GroupRepository,
  IdentityRepository,
} from './repository.js';
import { WriteNotAllowedError } from './repository.js';
import type { InviteView } from '../features/groups/invites.js';
import type {
  ChatMessage,
  ChatPage,
  GroupCourse,
  GroupDetail,
  GroupItem,
  GroupLesson,
  GroupMember,
  GroupSummary,
  JoinRequestView,
} from '../features/groups/types.js';
import type { ItemPerms } from '../features/groups/roles.js';
import {
  AVATAR_LIMITS,
  convertErrorText,
  convertToWebp,
} from '../features/images/convert.js';

/** The private bucket from migration 0031. 512 KB, WebP only. */
export const AVATAR_BUCKET = 'avatars';

/** How long a signed URL lives. Ten minutes, as for recipe photographs. */
const SIGNED_URL_TTL = 600;

export class GroupRepositoryError extends Error {
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    // The cause is translated (lib/errorText.ts) so the screen prints Hebrew,
    // and a cause with nothing to add leaves the operation alone.
    const detail = describeCause(cause);
    super(detail ? `${operation}: ${detail}` : operation);
    this.name = 'GroupRepositoryError';
  }
}

/**
 * A write must have changed exactly the row it named.
 *
 * Zero rows means RLS did not admit the write — see the header. The message
 * does not distinguish "no such row" from "not allowed", because the database
 * does not either, and inventing the distinction would leak which ids exist.
 */
function expectOne<T>(rows: readonly T[] | null, what: string): T {
  const row = rows?.[0];
  if (!row) {
    throw new WriteNotAllowedError(
      `${what} לא בוצע. ייתכן שאין לכם הרשאה לפעולה הזאת, או שהפריט אינו קיים.`,
    );
  }
  return row;
}

function permsOf(row: {
  perm_view: boolean;
  perm_save: boolean;
  perm_print: boolean;
  perm_download: boolean;
  perm_share_out: boolean;
}): ItemPerms {
  return {
    view: row.perm_view,
    save: row.perm_save,
    print: row.perm_print,
    download: row.perm_download,
    shareOut: row.perm_share_out,
  };
}

function inviteFromRow(row: GroupInviteRow): InviteView {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    token: row.token,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    replacesId: row.replaces_id,
  };
}

function requestFromRow(row: GroupJoinRequestRow): JoinRequestView {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export function messageFromRow(row: GroupMessageRow): ChatMessage {
  return {
    id: row.id,
    seq: Number(row.seq),
    groupId: row.group_id,
    authorId: row.author_id,
    body: row.body,
    kind: row.kind,
    replyToId: row.reply_to_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

/**
 * A broadcast payload, turned into a message.
 *
 * `realtime.broadcast_changes` sends `{ operation, record, old_record, schema,
 * table }`. A DELETE would carry only `old_record` — there is none today (the
 * table has no DELETE policy and `authenticated` has no privilege), and
 * returning null for anything unrecognised is what keeps a future one from
 * being rendered as a live message.
 */
export function messageFromBroadcast(payload: unknown): ChatMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = (payload as { payload?: { record?: unknown }; record?: unknown });
  const raw = record.payload?.record ?? record.record;
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<GroupMessageRow>;
  if (!r.id || !r.group_id || !r.author_id || r.seq === undefined) return null;
  return messageFromRow({
    id: r.id,
    seq: Number(r.seq),
    group_id: r.group_id,
    channel_id: r.channel_id ?? null,
    author_id: r.author_id,
    body: r.body ?? '',
    kind: r.kind ?? 'text',
    reply_to_id: r.reply_to_id ?? null,
    edited_at: r.edited_at ?? null,
    deleted_at: r.deleted_at ?? null,
    deleted_by: r.deleted_by ?? null,
    created_at: r.created_at ?? new Date().toISOString(),
  });
}

export interface GroupDeps {
  client: TypedSupabaseClient;
  userId: string;
  /** Refuses a write when the browser reports no network. */
  requireOnline(what: string): void;
}

export function createSupabaseGroups({
  client,
  userId,
  requireOnline,
}: GroupDeps): GroupRepository & IdentityRepository {
  /* ── groups ─────────────────────────────────────────────────────────────── */

  const summaries = async (): Promise<GroupSummary[]> => {
    /*
      One round trip for the memberships WITH the group embedded. The caller's
      own membership row is the only place their role lives, so this is not an
      optimisation — a separate group query would not know the role.
    */
    const { data, error } = await client
      .from('group_members')
      .select('role, group_id, groups (*)')
      .eq('user_id', userId);
    if (error) throw new GroupRepositoryError('טעינת הקבוצות נכשלה', error);

    /*
      Member counts, in one more round trip. `members_read` is rank >= 1, so
      this returns memberships of the caller's own groups and nothing else —
      the count is therefore both correct and safe to do in the client.
    */
    const { data: everyone, error: countError } = await client
      .from('group_members')
      .select('group_id');
    if (countError) throw new GroupRepositoryError('טעינת הקבוצות נכשלה', countError);
    const counts = new Map<string, number>();
    for (const row of everyone ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }

    // Unread, computed in the database — counting it here would mean
    // downloading the messages you have not read in order to count them.
    const unread = new Map<string, { unread: number; lastSeq: number }>();
    const { data: counters, error: unreadError } = await client.rpc('group_unread_counts');
    if (!unreadError) {
      for (const row of counters ?? []) {
        unread.set(row.group_id, { unread: Number(row.unread), lastSeq: Number(row.last_seq) });
      }
    }

    const out: GroupSummary[] = [];
    for (const row of data ?? []) {
      const g = (row as { groups?: unknown }).groups as
        | {
            id: string;
            name: string;
            kind: string;
            note: string;
            code: string | null;
            join_by: JoinMethod[];
          }
        | null
        | undefined;
      if (!g) continue;
      const u = unread.get(g.id);
      out.push({
        id: g.id,
        name: g.name,
        kind: g.kind,
        note: g.note,
        code: g.code,
        joinBy: g.join_by,
        myRole: row.role,
        members: counts.get(g.id) ?? 1,
        unread: u?.unread ?? 0,
        lastSeq: u?.lastSeq ?? 0,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  };

  return {
    async listGroups() {
      return summaries();
    },

    async createGroup({ name, kind, note }) {
      requireOnline('הקבוצה');
      // A group is TWO rows — the group and its owner's membership — and two
      // requests can fail between them, leaving a group its creator cannot
      // see. `create_group` (0023/0024) does both in one transaction.
      const { data, error } = await client.rpc('create_group', {
        p_name: name,
        p_kind: kind,
        p_note: note,
      });
      if (error) throw new GroupRepositoryError('יצירת הקבוצה נכשלה', error);
      const id = data as string;
      /*
        The join code. Written by the owner under the ordinary update policy
        rather than by the RPC, which does not know about codes (see
        features/groups/joinCode.ts). A failure here leaves a group without a
        code — which the group screen repairs on its next visit — and never
        turns a created group into "creation failed".
      */
      await client
        .from('groups')
        .update({ code: generateJoinCode() })
        .eq('id', id)
        .then(() => undefined, () => undefined);
      return id;
    },

    async getGroup(groupId): Promise<GroupDetail | null> {
      const list = await summaries();
      const summary = list.find((g) => g.id === groupId);
      if (!summary) return null;

      /*
        The §10.3 tree in one request. `items_read` filters the items a
        student may see — a recipe with `perm_view = false` is not in this
        result at all, which is what §10.4 means by "bless it אינו מופיע
        לתלמיד כלל".
      */
      const { data, error } = await client
        .from('courses')
        .select('*, lessons (*, group_recipe_items (*))')
        .eq('group_id', groupId)
        .order('ord');
      if (error) throw new GroupRepositoryError('טעינת הקבוצה נכשלה', error);

      const courses: GroupCourse[] = (data ?? []).map((c) => {
        const lessonRows = ((c as { lessons?: unknown }).lessons ?? []) as Array<
          Record<string, unknown>
        >;
        const lessons: GroupLesson[] = lessonRows
          .map((l) => {
            const itemRows = ((l['group_recipe_items'] ?? []) as Array<Record<string, unknown>>);
            const items: GroupItem[] = itemRows
              .map((i) => ({
                id: i['id'] as string,
                lessonId: i['lesson_id'] as string,
                recipeId: i['recipe_id'] as string,
                name: i['name'] as string,
                ord: i['ord'] as number,
                perms: permsOf(i as never),
                createdAt: i['created_at'] as string,
              }))
              .sort((a, b) => a.ord - b.ord);
            return {
              id: l['id'] as string,
              courseId: l['course_id'] as string,
              name: l['name'] as string,
              date: (l['date'] as string | null) ?? null,
              summary: l['summary'] as string,
              done: l['done'] as boolean,
              ord: l['ord'] as number,
              items,
            };
          })
          .sort((a, b) => a.ord - b.ord);
        return {
          id: c.id,
          groupId: c.group_id,
          name: c.name,
          ord: c.ord,
          lessons,
        };
      });

      return { ...summary, courses };
    },

    async updateGroup(groupId, patch) {
      requireOnline('העדכון');
      /*
        Built as a typed partial rather than a `Record<string, unknown>`:
        postgrest-js rejects an index-signature object outright (its update
        argument is `RejectExcessProperties`), and the rejection is a feature —
        a typo'd column name in a loose record is a silent no-op update.
      */
      const row: Partial<GroupRow> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.kind !== undefined) row.kind = patch.kind;
      if (patch.note !== undefined) row.note = patch.note;
      if (patch.joinBy !== undefined) row.join_by = patch.joinBy;
      if (patch.code !== undefined) row.code = patch.code;
      if (Object.keys(row).length === 0) return;
      const { data, error } = await client
        .from('groups')
        .update(row)
        .eq('id', groupId)
        .select('id');
      if (error) throw new GroupRepositoryError('עדכון הקבוצה נכשל', error);
      expectOne(data, 'עדכון הקבוצה');
    },

    async deleteGroup(groupId) {
      requireOnline('המחיקה');
      const { data, error } = await client
        .from('groups')
        .delete()
        .eq('id', groupId)
        .select('id');
      if (error) throw new GroupRepositoryError('מחיקת הקבוצה נכשלה', error);
      expectOne(data, 'מחיקת הקבוצה');
    },

    async leaveGroup(groupId) {
      requireOnline('היציאה מהקבוצה');
      /*
        `members_remove` admits the caller's own row — and `guard_owner_membership`
        refuses it for an owner, because a group with no owner is a group
        nobody can administer. The refusal arrives as an exception; a row count
        of zero would mean something else, so both are handled.
      */
      const { data, error } = await client
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .select('user_id');
      if (error) throw new GroupRepositoryError('היציאה מהקבוצה נכשלה', error);
      expectOne(data, 'היציאה מהקבוצה');
    },

    /* ── members ──────────────────────────────────────────────────────────── */

    async roster(groupId): Promise<GroupMember[]> {
      // A definer RPC, because a member may see who else is in their group,
      // which means reading other people's `profiles` rows. It returns a fixed
      // projection and NO email address — see 0031.
      const { data, error } = await client.rpc('group_roster', { p_group_id: groupId });
      if (error) throw new GroupRepositoryError('טעינת רשימת החברים נכשלה', error);
      return (data ?? []).map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarPath: r.avatar_path,
        role: r.role,
        rank: Number(r.rank),
        joinedAt: r.joined_at,
      }));
    },

    async avatarUrls(paths) {
      const wanted = [...new Set(paths.filter((p) => p.length > 0))];
      if (wanted.length === 0) return {};
      const { data, error } = await client.storage
        .from(AVATAR_BUCKET)
        .createSignedUrls(wanted, SIGNED_URL_TTL);
      // Not throwing: a missing picture is a state the roster renders, and a
      // failure here must not take the members list down with it.
      if (error || !data) return {};
      const out: Record<string, string> = {};
      for (const row of data) {
        if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
      }
      return out;
    },

    async setMemberRole(groupId, userId_: string, role: GroupRole) {
      requireOnline('שינוי התפקיד');
      /*
        `members_role` carries the invariant on BOTH sides: rank >= 3 and the
        role being written must rank strictly below the caller's. Failing the
        `using` side matches zero rows; failing `with check` RAISES 42501. Both
        outcomes are refusals, and both are surfaced.
      */
      const { data, error } = await client
        .from('group_members')
        .update({ role })
        .eq('group_id', groupId)
        .eq('user_id', userId_)
        .select('user_id');
      if (error) throw new GroupRepositoryError('שינוי התפקיד נכשל', error);
      expectOne(data, 'שינוי התפקיד');
    },

    async removeMember(groupId, userId_: string) {
      requireOnline('הסרת החבר');
      const { data, error } = await client
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId_)
        .select('user_id');
      if (error) throw new GroupRepositoryError('הסרת החבר נכשלה', error);
      expectOne(data, 'הסרת החבר');
    },

    /* ── invitations ──────────────────────────────────────────────────────── */

    async listInvites(groupId) {
      const { data, error } = await client
        .from('group_invites')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });
      if (error) throw new GroupRepositoryError('טעינת ההזמנות נכשלה', error);
      return (data ?? []).map(inviteFromRow);
    },

    async createInvite(groupId, email, label) {
      requireOnline('ההזמנה');
      const { data, error } = await client.rpc('create_group_invite', {
        p_group_id: groupId,
        p_email: email,
        p_label: label,
      });
      if (error) throw new GroupRepositoryError('יצירת ההזמנה נכשלה', error);
      return data as string;
    },

    async sendInviteEmail(inviteId) {
      requireOnline('שליחת המייל');
      /*
        An Edge Function, because the mail provider's API key must never reach
        the browser. The function reads the invitation with the service role,
        checks that the CALLER is staff of that group, and sends.

        A failure here is reported, never swallowed: the invitation exists
        either way, and an instructor who thinks a mail went out when it did
        not will wait for a student who was never told.
      */
      /*
        Read as `unknown` and narrowed by hand. `functions.invoke`'s generic is
        a promise about a payload the server controls — trusting it would let a
        response shaped `{ sent: "yes" }` reach `data.sent === true` as an
        `any`, which is exactly the check that must not be fooled.
      */
      const invoked = (await client.functions.invoke('send-group-invite', {
        body: { invite_id: inviteId },
      })) as { data?: unknown; error?: unknown };
      const error = invoked.error;
      const payload =
        typeof invoked.data === 'object' && invoked.data !== null
          ? (invoked.data as { sent?: unknown; reason?: unknown })
          : null;
      const data = {
        sent: payload?.sent === true,
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
      };

      if (error) {
        return {
          sent: false,
          reason:
            'שליחת המייל נכשלה. ההזמנה עצמה נוצרה — אפשר להעתיק את הקישור ולשלוח אותו.',
        };
      }
      if (data.sent) return { sent: true };
      return {
        sent: false,
        reason:
          data.reason ??
          'שירות המייל אינו מחובר בפרויקט הזה. ההזמנה נוצרה — אפשר להעתיק את הקישור ולשלוח אותו.',
      };
    },

    async revokeInvite(inviteId) {
      requireOnline('ביטול ההזמנה');
      const { error } = await client.rpc('revoke_group_invite', { p_invite_id: inviteId });
      if (error) throw new GroupRepositoryError('ביטול ההזמנה נכשל', error);
    },

    async resendInvite(inviteId) {
      requireOnline('שליחת ההזמנה מחדש');
      const { data, error } = await client.rpc('resend_group_invite', {
        p_invite_id: inviteId,
      });
      if (error) throw new GroupRepositoryError('שליחת ההזמנה מחדש נכשלה', error);
      return data as string;
    },

    async redeemInvite(token) {
      requireOnline('ההצטרפות');
      const { data, error } = await client.rpc('redeem_group_invite', { p_token: token });
      if (error) throw new GroupRepositoryError('ההצטרפות נכשלה', error);
      return data as string;
    },

    async rejectInvite(token) {
      requireOnline('דחיית ההזמנה');
      const { error } = await client.rpc('reject_group_invite', { p_token: token });
      if (error) throw new GroupRepositoryError('דחיית ההזמנה נכשלה', error);
    },

    /* ── join requests ────────────────────────────────────────────────────── */

    async listJoinRequests(groupId) {
      const { data, error } = await client
        .from('group_join_requests')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });
      if (error) throw new GroupRepositoryError('טעינת הבקשות נכשלה', error);
      return (data ?? []).map(requestFromRow);
    },

    async myJoinRequests() {
      const { data, error } = await client
        .from('group_join_requests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new GroupRepositoryError('טעינת הבקשות נכשלה', error);
      return (data ?? []).map(requestFromRow);
    },

    async requestJoin(code, note) {
      requireOnline('הבקשה');
      const { data, error } = await client.rpc('request_group_join', {
        p_code: normaliseJoinCode(code),
        p_note: note,
      });
      if (error) throw new GroupRepositoryError('הבקשה נכשלה', error);
      return data as string;
    },

    async approveJoin(groupId, userId_: string) {
      requireOnline('אישור הבקשה');
      const { error } = await client.rpc('approve_group_join', {
        p_group_id: groupId,
        p_user_id: userId_,
      });
      if (error) throw new GroupRepositoryError('אישור הבקשה נכשל', error);
    },

    async rejectJoin(groupId, userId_: string) {
      requireOnline('דחיית הבקשה');
      const { error } = await client.rpc('reject_group_join', {
        p_group_id: groupId,
        p_user_id: userId_,
      });
      if (error) throw new GroupRepositoryError('דחיית הבקשה נכשלה', error);
    },

    async withdrawJoin(groupId) {
      requireOnline('ביטול הבקשה');
      const { error } = await client.rpc('withdraw_group_join', { p_group_id: groupId });
      if (error) throw new GroupRepositoryError('ביטול הבקשה נכשל', error);
    },

    /* ── courses, lessons, items ──────────────────────────────────────────── */

    async addCourse(groupId, name) {
      requireOnline('הקורס');
      const { data, error } = await client
        .from('courses')
        .insert({ group_id: groupId, name })
        .select('id')
        .single();
      if (error) throw new GroupRepositoryError('יצירת הקורס נכשלה', error);
      return data.id;
    },

    async renameCourse(courseId, name) {
      requireOnline('העדכון');
      const { data, error } = await client
        .from('courses')
        .update({ name })
        .eq('id', courseId)
        .select('id');
      if (error) throw new GroupRepositoryError('עדכון הקורס נכשל', error);
      expectOne(data, 'עדכון הקורס');
    },

    async removeCourse(courseId) {
      requireOnline('המחיקה');
      const { data, error } = await client
        .from('courses')
        .delete()
        .eq('id', courseId)
        .select('id');
      if (error) throw new GroupRepositoryError('מחיקת הקורס נכשלה', error);
      expectOne(data, 'מחיקת הקורס');
    },

    async addLesson(courseId, { name, date }) {
      requireOnline('השיעור');
      const { data, error } = await client
        .from('lessons')
        .insert({ course_id: courseId, name, date })
        .select('id')
        .single();
      if (error) throw new GroupRepositoryError('יצירת השיעור נכשלה', error);
      return data.id;
    },

    async updateLesson(lessonId, patch) {
      requireOnline('העדכון');
      const row: Partial<LessonRow> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.date !== undefined) row.date = patch.date;
      if (patch.summary !== undefined) row.summary = patch.summary;
      if (patch.done !== undefined) row.done = patch.done;
      if (Object.keys(row).length === 0) return;
      const { data, error } = await client
        .from('lessons')
        .update(row)
        .eq('id', lessonId)
        .select('id');
      if (error) throw new GroupRepositoryError('עדכון השיעור נכשל', error);
      expectOne(data, 'עדכון השיעור');
    },

    async removeLesson(lessonId) {
      requireOnline('המחיקה');
      const { data, error } = await client
        .from('lessons')
        .delete()
        .eq('id', lessonId)
        .select('id');
      if (error) throw new GroupRepositoryError('מחיקת השיעור נכשלה', error);
      expectOne(data, 'מחיקת השיעור');
    },

    async publishRecipe(lessonId, recipeId, name) {
      requireOnline('פרסום המתכון');
      const { data, error } = await client.rpc('publish_recipe_to_lesson', {
        p_lesson_id: lessonId,
        p_recipe_id: recipeId,
        p_name: name,
      });
      if (error) throw new GroupRepositoryError('פרסום המתכון נכשל', error);
      return data as string;
    },

    async unpublishItem(itemId) {
      requireOnline('הסרת המתכון');
      const { error } = await client.rpc('unpublish_recipe_from_lesson', {
        p_item_id: itemId,
      });
      if (error) throw new GroupRepositoryError('הסרת המתכון נכשלה', error);
    },

    async setItemPerms(itemId, perms) {
      requireOnline('עדכון ההרשאות');
      const { data, error } = await client
        .from('group_recipe_items')
        .update({
          perm_view: perms.view,
          perm_save: perms.save,
          perm_print: perms.print,
          perm_download: perms.download,
          perm_share_out: perms.shareOut,
        })
        .eq('id', itemId)
        .select('id');
      if (error) throw new GroupRepositoryError('עדכון ההרשאות נכשל', error);
      expectOne(data, 'עדכון ההרשאות');
    },

    async saveGroupCopy(itemId) {
      requireOnline('שמירת העותק');
      // §11 and HANDOFF §4: the `perm_save` check is the server's, because a
      // client-side one is UX only.
      const { data, error } = await client.rpc('save_group_recipe_copy', {
        p_item_id: itemId,
      });
      if (error) throw new GroupRepositoryError('שמירת העותק נכשלה', error);
      return data as string;
    },

    async getItemNote(itemId) {
      const { data, error } = await client
        .from('private_notes')
        .select('body')
        .eq('group_item_id', itemId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new GroupRepositoryError('טעינת ההערה נכשלה', error);
      return data?.body ?? null;
    },

    async saveItemNote(itemId, body) {
      requireOnline('ההערה');
      const { error } = await client.rpc('save_item_note', {
        p_item_id: itemId,
        p_body: body,
      });
      if (error) throw new GroupRepositoryError('שמירת ההערה נכשלה', error);
    },

    /* ── chat ─────────────────────────────────────────────────────────────── */

    async chatPage(groupId, before, limit): Promise<ChatPage> {
      /*
        Keyset pagination on `seq`. One row more than asked for is fetched, and
        its presence — not a count query — is what "there is more" means.
      */
      let query = client
        .from('group_messages')
        .select('*')
        .eq('group_id', groupId)
        .order('seq', { ascending: false })
        .limit(limit + 1);
      if (before !== null) query = query.lt('seq', before);

      const { data, error } = await query;
      if (error) throw new GroupRepositoryError('טעינת ההודעות נכשלה', error);
      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = (hasMore ? rows.slice(0, limit) : rows).map(messageFromRow);
      // Oldest first: reading order.
      return { messages: page.reverse(), hasMore };
    },

    async sendMessage({ groupId, body, replyToId = null, kind = 'text' }) {
      requireOnline('ההודעה');
      const { data, error } = await client
        .from('group_messages')
        .insert({
          group_id: groupId,
          author_id: userId,
          body,
          reply_to_id: replyToId,
          kind,
        })
        .select('*')
        .single();
      if (error) throw new GroupRepositoryError('שליחת ההודעה נכשלה', error);
      return messageFromRow(data);
    },

    async editMessage(messageId, body) {
      requireOnline('העריכה');
      /*
        `edited_at` is deliberately NOT sent: the trigger stamps it, so "edited"
        is not a label the client can decline to apply. A non-author edit is
        refused by the same trigger with 42501.
      */
      const { data, error } = await client
        .from('group_messages')
        .update({ body })
        .eq('id', messageId)
        .select('*');
      if (error) throw new GroupRepositoryError('עריכת ההודעה נכשלה', error);
      return messageFromRow(expectOne(data, 'עריכת ההודעה'));
    },

    async deleteMessage(messageId) {
      requireOnline('המחיקה');
      /*
        A soft delete: `deleted_at` is sent so the trigger knows what is being
        asked, and the trigger then overwrites it with its own `now()` and
        stamps `deleted_by`. The words move to `group_message_removals` (0035),
        so the row that comes back carries an empty body.

        There is no hard delete to fall back on: 0034 revoked DELETE from
        `authenticated` on this table.
      */
      const { data, error } = await client
        .from('group_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId)
        .select('id');
      if (error) throw new GroupRepositoryError('מחיקת ההודעה נכשלה', error);
      expectOne(data, 'מחיקת ההודעה');
    },

    async markGroupRead(groupId, seq) {
      const { error } = await client.rpc('mark_group_read', {
        p_group_id: groupId,
        p_seq: seq,
      });
      // Not fatal: failing to record that a conversation was read is a worse
      // reason to show an error than it is a problem.
      if (error && import.meta.env.DEV) {
        console.warn('mark_group_read failed', error);
      }
    },

    async lastReadSeq(groupId) {
      const { data, error } = await client
        .from('group_message_reads')
        .select('last_read_seq')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return 0;
      return Number(data?.last_read_seq ?? 0);
    },

    subscribeGroupChat(groupId, events: ChatEvents): ChatSubscription {
      /*
        A PRIVATE channel, so the join is authorised by RLS on
        `realtime.messages` — the policy in 0032, keyed on the group id parsed
        out of the topic. `setAuth()` hands the socket the current session;
        without it the join is anonymous and the policy refuses it.

        `setAuth` is a promise and this function is not async, because the
        caller needs the unsubscribe handle immediately — a screen that
        unmounts during the handshake must still be able to tear it down.
      */
      const channel = client.channel(`group:${groupId}`, { config: { private: true } });
      let cancelled = false;

      const deliver = (payload: unknown): void => {
        const message = messageFromBroadcast(payload);
        if (message && message.groupId === groupId) events.onMessage(message);
      };

      void (async () => {
        try {
          await client.realtime.setAuth();
        } catch {
          events.onStatus?.('error');
          return;
        }
        if (cancelled) return;
        events.onStatus?.('connecting');
        channel
          .on('broadcast', { event: 'INSERT' }, deliver)
          .on('broadcast', { event: 'UPDATE' }, deliver)
          /*
            The states come from realtime-js's own enum rather than from
            string literals: comparing a literal against it type-checks and
            lints as an unsafe enum comparison, and a renamed member would
            then silently never match.
          */
          .subscribe((status) => {
            if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
              events.onStatus?.('subscribed');
            } else if (
              status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
              status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
            ) {
              events.onStatus?.('error');
            }
          });
      })();

      return {
        unsubscribe() {
          cancelled = true;
          void client.removeChannel(channel);
        },
      };
    },

    /* ── identity (migration 0031) ────────────────────────────────────────── */

    async getIdentity() {
      const { data, error } = await client
        .from('profiles')
        .select('display_name, avatar_path')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new GroupRepositoryError('טעינת הפרופיל נכשלה', error);
      return {
        displayName: data?.display_name ?? '',
        avatarPath: data?.avatar_path ?? null,
      };
    },

    async saveDisplayName(name) {
      requireOnline('השם');
      const { data, error } = await client
        .from('profiles')
        .update({ display_name: name.trim() })
        .eq('user_id', userId)
        .select('user_id');
      if (error) throw new GroupRepositoryError('שמירת השם נכשלה', error);
      expectOne(data, 'שמירת השם');
    },

    async setAvatar(file) {
      requireOnline('התמונה');
      /*
        The same conversion as a recipe photograph, for the same reasons: the
        bucket accepts WebP only, the re-encode strips EXIF (including GPS),
        and a smaller edge is plenty for a 40-pixel circle. 512 KB is the
        bucket's limit (0031), so the ladder has less room than a recipe
        photo's — `convertToWebp` is told the smaller budget rather than
        discovering it as a 400 from storage.
      */
      const converted = await convertToWebp(file, {}, AVATAR_LIMITS);
      if (!converted.ok) throw new WriteNotAllowedError(convertErrorText(converted));

      const path = `${userId}/${crypto.randomUUID()}.webp`;
      const upload = await client.storage
        .from(AVATAR_BUCKET)
        .upload(path, converted.blob, { contentType: 'image/webp', upsert: false });
      if (upload.error) throw new GroupRepositoryError('העלאת התמונה נכשלה', upload.error);

      const { data, error } = await client
        .from('profiles')
        .update({ avatar_path: path })
        .eq('user_id', userId)
        .select('avatar_path');
      if (error || !data?.[0]) {
        // The object is up and the row did not change. Remove the object
        // rather than leave a file nothing points at.
        await client.storage.from(AVATAR_BUCKET).remove([path]);
        throw new GroupRepositoryError('שמירת התמונה נכשלה', error ?? 'no row updated');
      }

      /*
        The previous picture, if there was one, is now unreferenced. It is
        removed AFTER the row points at the new one: in this order a failure
        leaves an orphan file, and in the other it leaves a profile pointing at
        a picture that is gone.
      */
      const previous = (await (async () => {
        const { data: prev } = await client
          .from('profiles')
          .select('avatar_path')
          .eq('user_id', userId)
          .maybeSingle();
        return prev?.avatar_path ?? null;
      })());
      if (previous && previous !== path) {
        await client.storage.from(AVATAR_BUCKET).remove([previous]);
      }
      return path;
    },

    async removeAvatar() {
      requireOnline('הסרת התמונה');
      const { data, error } = await client
        .from('profiles')
        .select('avatar_path')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new GroupRepositoryError('הסרת התמונה נכשלה', error);
      const path = data?.avatar_path ?? null;

      const { data: updated, error: updateError } = await client
        .from('profiles')
        .update({ avatar_path: null })
        .eq('user_id', userId)
        .select('user_id');
      if (updateError) throw new GroupRepositoryError('הסרת התמונה נכשלה', updateError);
      expectOne(updated, 'הסרת התמונה');

      if (path) await client.storage.from(AVATAR_BUCKET).remove([path]);
    },

    async avatarUrl(path) {
      if (!path) return null;
      const { data, error } = await client.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },
  };
}
