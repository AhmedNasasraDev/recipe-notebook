/*
  An in-memory §10 world for screen tests.

  ─────────────────────────────────────────────────────────────────────────────
  IT ENFORCES THE RULES, AND THAT IS THE POINT

  A fake that accepted every write would let a screen test pass on a flow the
  database refuses — a member "promoting" somebody, a student editing an
  instructor's message — and the test would be proof of nothing. So this fake
  applies the same rank model the policies do, through the same
  `features/groups/roles.ts` the UI uses, and refuses with
  `WriteNotAllowedError` where RLS would refuse with 42501.

  WHAT IT IS NOT

  It is not evidence that the database enforces anything. That evidence is in
  supabase/tests/*.sql, run against the live project. This is evidence that the
  SCREENS behave correctly when the answer is "no" — which is a different
  claim, and both are needed.

  Pagination, unread and the realtime path are modelled properly rather than
  stubbed, because each one has a page boundary or an ordering that a stub
  would paper over.
*/

import { generateJoinCode } from '../features/groups/joinCode.js';
import {
  WriteNotAllowedError,
  type ChatEvents,
  type ChatSubscription,
  type GroupRepository,
  type IdentityRepository,
} from '../data/repository.js';
import type { GroupRole } from '../lib/database.types.js';
import type { InviteView } from '../features/groups/invites.js';
import type {
  ChatMessage,
  ChatPage,
  GroupCourse,
  GroupDetail,
  GroupMember,
  GroupSummary,
  JoinRequestView,
} from '../features/groups/types.js';
import type { ItemPerms } from '../features/groups/roles.js';
import { PERM_DEFAULT, can, canActOnMember, rankOf } from '../features/groups/roles.js';

export interface FakeGroupSeed extends Omit<GroupSummary, 'members' | 'unread' | 'lastSeq'> {
  roster?: GroupMember[];
  courses?: GroupCourse[];
}

export interface FakeGroupOptions {
  /** the signed-in account these tests act as */
  userId?: string;
  groups?: readonly FakeGroupSeed[];
  invites?: readonly InviteView[];
  requests?: readonly JoinRequestView[];
  messages?: readonly ChatMessage[];
  /** the caller's read marker per group */
  lastRead?: Readonly<Record<string, number>>;
  identity?: { displayName: string; avatarPath: string | null };
  itemNotes?: Readonly<Record<string, string>>;
  /** signed avatar URLs a test wants to exist, keyed by path */
  avatarUrls?: Readonly<Record<string, string>>;

  /**
   * Handed the emitter when a screen subscribes, so a test can deliver a
   * message the way a broadcast would. The screen must handle a message it
   * did not ask for and did not send.
   */
  onSubscribe?(emit: (message: ChatMessage) => void, groupId: string): void;
  /** what the status callback should report; default 'subscribed' */
  chatStatus?: 'connecting' | 'subscribed' | 'error';

  onSendMessage?(message: ChatMessage): void;
  onEditMessage?(id: string, body: string): void;
  onDeleteMessage?(id: string): void;
  onSetItemPerms?(itemId: string, perms: ItemPerms): void;
  onCreateInvite?(groupId: string, email: string | null, label: string): void;
  onSendInviteEmail?(inviteId: string): void;
  /** what the mail attempt should report; default `{ sent: true }` */
  inviteEmail?: { sent: boolean; reason?: string };
  onSetMemberRole?(userId: string, role: GroupRole): void;
  onRemoveMember?(userId: string): void;
  onPublishRecipe?(lessonId: string, recipeId: string, name: string): void;
  onSaveGroupCopy?(itemId: string): void;
  onSaveItemNote?(itemId: string, body: string): void;
  onMarkRead?(groupId: string, seq: number): void;
  onApproveJoin?(groupId: string, userId: string): void;
  onRedeemInvite?(token: string): void;
  /** a token the fake accepts; anything else is refused the way 0031 does */
  validToken?: string;
}

const REFUSED = 'אין לכם הרשאה לפעולה הזאת.';

export function createFakeGroups(
  opts: FakeGroupOptions = {},
): GroupRepository & IdentityRepository {
  const me = opts.userId ?? 'me';
  const groups: FakeGroupSeed[] = (opts.groups ?? []).map((g) => ({
    ...g,
    roster: [...(g.roster ?? [])],
    courses: (g.courses ?? []).map((c) => ({
      ...c,
      lessons: c.lessons.map((l) => ({ ...l, items: [...l.items] })),
    })),
  }));
  let invites: InviteView[] = [...(opts.invites ?? [])];
  let requests: JoinRequestView[] = [...(opts.requests ?? [])];
  let messages: ChatMessage[] = [...(opts.messages ?? [])];
  const lastRead: Record<string, number> = { ...(opts.lastRead ?? {}) };
  const itemNotes: Record<string, string> = { ...(opts.itemNotes ?? {}) };
  let identity = opts.identity ?? { displayName: '', avatarPath: null };
  let nextSeq = messages.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
  let created = 0;

  const find = (groupId: string): FakeGroupSeed => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) throw new WriteNotAllowedError('הקבוצה אינה קיימת');
    return g;
  };

  /** The group's own summary, with the counts the real query derives. */
  const summary = (g: FakeGroupSeed): GroupSummary => {
    const groupMessages = messages.filter((m) => m.groupId === g.id);
    const read = lastRead[g.id] ?? 0;
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      note: g.note,
      code: g.code,
      joinBy: g.joinBy,
      myRole: g.myRole,
      /*
        At least one: the caller is in this group, so the real count cannot be
        zero — `members_read` always returns their own row. A fake that said 0
        would let a screen render "0 חברים" for a group somebody is standing in.
      */
      members: Math.max(1, g.roster?.length ?? 0),
      unread: groupMessages.filter(
        (m) => m.seq > read && m.authorId !== me && m.deletedAt === null,
      ).length,
      lastSeq: groupMessages.reduce((max, m) => Math.max(max, m.seq), 0),
    };
  };

  /** The rank gate, in the same terms as the policies. */
  const require_ = (g: FakeGroupSeed, action: Parameters<typeof can>[1]): void => {
    if (!can(g.myRole, action)) throw new WriteNotAllowedError(REFUSED);
  };

  const groupOfItem = (itemId: string): { group: FakeGroupSeed; perms: ItemPerms } => {
    for (const g of groups) {
      for (const c of g.courses ?? []) {
        for (const l of c.lessons) {
          const item = l.items.find((i) => i.id === itemId);
          if (item) return { group: g, perms: item.perms };
        }
      }
    }
    throw new WriteNotAllowedError('הפריט אינו קיים');
  };

  const messageById = (id: string): ChatMessage => {
    const m = messages.find((x) => x.id === id);
    if (!m) throw new WriteNotAllowedError('ההודעה אינה קיימת');
    return m;
  };

  const listeners = new Map<string, Set<(m: ChatMessage) => void>>();
  const publish = (m: ChatMessage): void => {
    for (const fn of listeners.get(m.groupId) ?? []) fn(m);
  };

  return {
    async listGroups() {
      return groups.map(summary);
    },

    async createGroup({ name, kind, note }) {
      created += 1;
      const id = `new-group-${created}`;
      groups.push({
        id,
        name,
        kind,
        note,
        code: generateJoinCode(),
        joinBy: ['invite', 'link', 'code', 'request'],
        myRole: 'owner',
        roster: [
          {
            userId: me,
            displayName: identity.displayName,
            avatarPath: identity.avatarPath,
            role: 'owner',
            rank: rankOf('owner'),
            joinedAt: new Date().toISOString(),
          },
        ],
        courses: [],
      });
      return id;
    },

    async getGroup(groupId): Promise<GroupDetail | null> {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return null;
      /*
        `items_read` hides an item with `perm_view = false` from a member, so
        the fake hides it too — a screen tested against a fake that showed it
        would be tested against a list the server never sends.
      */
      const visible = (g.courses ?? []).map((c) => ({
        ...c,
        lessons: c.lessons.map((l) => ({
          ...l,
          items: can(g.myRole, 'teach') ? l.items : l.items.filter((i) => i.perms.view),
        })),
      }));
      return { ...summary(g), courses: visible };
    },

    async updateGroup(groupId, patch) {
      const g = find(groupId);
      require_(g, 'manage');
      Object.assign(g, patch);
    },

    async deleteGroup(groupId) {
      const g = find(groupId);
      require_(g, 'destroy');
      groups.splice(groups.indexOf(g), 1);
    },

    async leaveGroup(groupId) {
      const g = find(groupId);
      // `guard_owner_membership`: an owner cannot leave their own group.
      if (g.myRole === 'owner') {
        throw new WriteNotAllowedError(
          'בעל הקבוצה אינו יכול לצאת ממנה. אפשר להעביר בעלות או למחוק את הקבוצה.',
        );
      }
      groups.splice(groups.indexOf(g), 1);
    },

    async roster(groupId) {
      return [...(groups.find((g) => g.id === groupId)?.roster ?? [])];
    },

    async avatarUrls(paths) {
      const out: Record<string, string> = {};
      for (const p of paths) {
        const url = opts.avatarUrls?.[p];
        if (url) out[p] = url;
      }
      return out;
    },

    async setMemberRole(groupId, userId, role) {
      const g = find(groupId);
      const target = g.roster?.find((m) => m.userId === userId);
      if (!target) throw new WriteNotAllowedError('החבר אינו קיים');
      // Both halves of `members_role`: the caller's rank, and the target's.
      if (!canActOnMember(g.myRole, target.role) || rankOf(role) >= rankOf(g.myRole)) {
        throw new WriteNotAllowedError(REFUSED);
      }
      target.role = role;
      target.rank = rankOf(role);
      opts.onSetMemberRole?.(userId, role);
    },

    async removeMember(groupId, userId) {
      const g = find(groupId);
      const target = g.roster?.find((m) => m.userId === userId);
      if (!target) throw new WriteNotAllowedError('החבר אינו קיים');
      if (!canActOnMember(g.myRole, target.role)) throw new WriteNotAllowedError(REFUSED);
      g.roster = (g.roster ?? []).filter((m) => m.userId !== userId);
      opts.onRemoveMember?.(userId);
    },

    async listInvites(groupId) {
      return invites.filter(() => groups.some((g) => g.id === groupId));
    },

    async createInvite(groupId, email, label) {
      const g = find(groupId);
      require_(g, 'invite');
      const token = `token-${invites.length + 1}`;
      invites = [
        {
          id: `invite-${invites.length + 1}`,
          email,
          label,
          token,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
          usedAt: null,
          revokedAt: null,
          replacesId: null,
        },
        ...invites,
      ];
      opts.onCreateInvite?.(groupId, email, label);
      return token;
    },

    async sendInviteEmail(inviteId) {
      opts.onSendInviteEmail?.(inviteId);
      return opts.inviteEmail ?? { sent: true };
    },

    async revokeInvite(inviteId) {
      invites = invites.map((i) =>
        i.id === inviteId && i.status === 'pending'
          ? { ...i, status: 'revoked', revokedAt: new Date().toISOString() }
          : i,
      );
    },

    async resendInvite(inviteId) {
      const old = invites.find((i) => i.id === inviteId);
      if (!old) throw new WriteNotAllowedError('ההזמנה אינה קיימת');
      if (old.status === 'accepted') {
        throw new WriteNotAllowedError('ההזמנה כבר נוצלה, אין מה לשלוח מחדש');
      }
      const token = `token-resent-${invites.length + 1}`;
      invites = [
        {
          ...old,
          id: `invite-${invites.length + 1}`,
          token,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          replacesId: old.id,
        },
        ...invites.map((i) =>
          i.id === inviteId && i.status === 'pending'
            ? { ...i, status: 'revoked' as const, revokedAt: new Date().toISOString() }
            : i,
        ),
      ];
      return token;
    },

    async redeemInvite(token) {
      opts.onRedeemInvite?.(token);
      if (opts.validToken !== undefined && token !== opts.validToken) {
        /*
          ONE message for every failure — wrong address, expired, revoked,
          already used, unknown token — because a distinguishable error is a
          way to test whether an address is registered. 0031 does the same.
        */
        throw new WriteNotAllowedError(
          'ההזמנה אינה תקפה. ייתכן שפג תוקפה, שהיא בוטלה, שכבר נעשה בה שימוש, ' +
            'או שהיא נשלחה לכתובת אחרת.',
        );
      }
      const first = groups[0];
      if (!first) throw new WriteNotAllowedError('ההזמנה אינה תקפה');
      return first.id;
    },

    async rejectInvite() {},

    async listJoinRequests(groupId) {
      return requests.filter((r) => r.groupId === groupId);
    },

    async myJoinRequests() {
      return requests.filter((r) => r.userId === me);
    },

    async requestJoin(code) {
      const g = groups.find((x) => x.code === code);
      if (!g) throw new WriteNotAllowedError('הקוד אינו מתאים לאף קבוצה');
      requests = [
        ...requests,
        {
          id: `request-${requests.length + 1}`,
          groupId: g.id,
          userId: me,
          note: '',
          status: 'pending',
          createdAt: new Date().toISOString(),
          decidedAt: null,
        },
      ];
      return g.name;
    },

    async approveJoin(groupId, userId) {
      const g = find(groupId);
      require_(g, 'approve');
      // Approving DELETES the request and creates the membership — there is no
      // 'accepted' status, by design (0031).
      requests = requests.filter((r) => !(r.groupId === groupId && r.userId === userId));
      g.roster = [
        ...(g.roster ?? []),
        {
          userId,
          displayName: null,
          avatarPath: null,
          role: 'member',
          rank: rankOf('member'),
          joinedAt: new Date().toISOString(),
        },
      ];
      opts.onApproveJoin?.(groupId, userId);
    },

    async rejectJoin(groupId, userId) {
      const g = find(groupId);
      require_(g, 'approve');
      requests = requests.map((r) =>
        r.groupId === groupId && r.userId === userId
          ? { ...r, status: 'rejected', decidedAt: new Date().toISOString() }
          : r,
      );
    },

    async withdrawJoin(groupId) {
      requests = requests.filter((r) => !(r.groupId === groupId && r.userId === me));
    },

    async addCourse(groupId, name) {
      const g = find(groupId);
      require_(g, 'teach');
      const id = `course-${(g.courses?.length ?? 0) + 1}`;
      g.courses = [
        ...(g.courses ?? []),
        { id, groupId, name, ord: g.courses?.length ?? 0, lessons: [] },
      ];
      return id;
    },

    async renameCourse(courseId, name) {
      for (const g of groups) {
        const c = (g.courses ?? []).find((x) => x.id === courseId);
        if (c) {
          require_(g, 'teach');
          c.name = name;
          return;
        }
      }
      throw new WriteNotAllowedError('הקורס אינו קיים');
    },

    async removeCourse(courseId) {
      for (const g of groups) {
        if ((g.courses ?? []).some((c) => c.id === courseId)) {
          require_(g, 'teach');
          g.courses = (g.courses ?? []).filter((c) => c.id !== courseId);
          return;
        }
      }
      throw new WriteNotAllowedError('הקורס אינו קיים');
    },

    async addLesson(courseId, { name, date }) {
      for (const g of groups) {
        const c = (g.courses ?? []).find((x) => x.id === courseId);
        if (c) {
          require_(g, 'teach');
          const id = `lesson-${c.lessons.length + 1}`;
          c.lessons = [
            ...c.lessons,
            {
              id,
              courseId,
              name,
              date,
              summary: '',
              done: false,
              ord: c.lessons.length,
              items: [],
            },
          ];
          return id;
        }
      }
      throw new WriteNotAllowedError('הקורס אינו קיים');
    },

    async updateLesson(lessonId, patch) {
      for (const g of groups) {
        for (const c of g.courses ?? []) {
          const l = c.lessons.find((x) => x.id === lessonId);
          if (l) {
            require_(g, 'teach');
            Object.assign(l, patch);
            return;
          }
        }
      }
      throw new WriteNotAllowedError('השיעור אינו קיים');
    },

    async removeLesson(lessonId) {
      for (const g of groups) {
        for (const c of g.courses ?? []) {
          if (c.lessons.some((l) => l.id === lessonId)) {
            require_(g, 'teach');
            c.lessons = c.lessons.filter((l) => l.id !== lessonId);
            return;
          }
        }
      }
      throw new WriteNotAllowedError('השיעור אינו קיים');
    },

    async publishRecipe(lessonId, recipeId, name) {
      for (const g of groups) {
        for (const c of g.courses ?? []) {
          const l = c.lessons.find((x) => x.id === lessonId);
          if (l) {
            require_(g, 'teach');
            const id = `item-${l.items.length + 1}-${lessonId}`;
            l.items = [
              ...l.items,
              {
                id,
                lessonId,
                recipeId,
                name,
                ord: l.items.length,
                // §10.4: the default is the most restrictive one.
                perms: { ...PERM_DEFAULT },
                createdAt: new Date().toISOString(),
              },
            ];
            opts.onPublishRecipe?.(lessonId, recipeId, name);
            return id;
          }
        }
      }
      throw new WriteNotAllowedError('השיעור אינו קיים');
    },

    async unpublishItem(itemId) {
      for (const g of groups) {
        for (const c of g.courses ?? []) {
          for (const l of c.lessons) {
            if (l.items.some((i) => i.id === itemId)) {
              require_(g, 'teach');
              l.items = l.items.filter((i) => i.id !== itemId);
              return;
            }
          }
        }
      }
      throw new WriteNotAllowedError('הפריט אינו קיים');
    },

    async setItemPerms(itemId, perms) {
      for (const g of groups) {
        for (const c of g.courses ?? []) {
          for (const l of c.lessons) {
            const item = l.items.find((i) => i.id === itemId);
            if (item) {
              require_(g, 'perms');
              item.perms = { ...perms };
              opts.onSetItemPerms?.(itemId, perms);
              return;
            }
          }
        }
      }
      throw new WriteNotAllowedError('הפריט אינו קיים');
    },

    async saveGroupCopy(itemId) {
      const { perms } = groupOfItem(itemId);
      // HANDOFF §4: the server decides this, and so does the fake — a screen
      // test that could copy without permission would be testing nothing.
      if (!perms.save) {
        throw new WriteNotAllowedError(
          'המדריך לא אישר שמירה של המתכון הזה למחברת אישית.',
        );
      }
      opts.onSaveGroupCopy?.(itemId);
      return `copy-of-${itemId}`;
    },

    async getItemNote(itemId) {
      return itemNotes[itemId] ?? null;
    },

    async saveItemNote(itemId, body) {
      groupOfItem(itemId);
      if (body.trim() === '') delete itemNotes[itemId];
      else itemNotes[itemId] = body;
      opts.onSaveItemNote?.(itemId, body);
    },

    async chatPage(groupId, before, limit): Promise<ChatPage> {
      // Keyset, exactly as the query does it: `seq < before`, newest first,
      // one extra row to learn whether there is more.
      const all = messages
        .filter((m) => m.groupId === groupId && (before === null || m.seq < before))
        .sort((a, b) => b.seq - a.seq);
      const page = all.slice(0, limit);
      return { messages: page.reverse(), hasMore: all.length > limit };
    },

    async sendMessage({ groupId, body, replyToId = null, kind = 'text' }) {
      const g = find(groupId);
      require_(g, kind === 'announcement' ? 'announce' : 'participate');
      const message: ChatMessage = {
        id: `msg-${nextSeq}`,
        seq: nextSeq,
        groupId,
        authorId: me,
        body: body.trim(),
        kind,
        replyToId,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };
      nextSeq += 1;
      messages = [...messages, message];
      opts.onSendMessage?.(message);
      publish(message);
      return message;
    },

    async editMessage(messageId, body) {
      const m = messageById(messageId);
      // The author, and only the author — the asymmetry from 0033/0035.
      if (m.authorId !== me || m.deletedAt !== null) {
        throw new WriteNotAllowedError(REFUSED);
      }
      const edited = { ...m, body, editedAt: new Date().toISOString() };
      messages = messages.map((x) => (x.id === messageId ? edited : x));
      opts.onEditMessage?.(messageId, body);
      publish(edited);
      return edited;
    },

    async deleteMessage(messageId) {
      const m = messageById(messageId);
      const g = find(m.groupId);
      if (m.authorId !== me && !can(g.myRole, 'moderate')) {
        throw new WriteNotAllowedError(REFUSED);
      }
      // 0035: the words leave the message.
      const gone = { ...m, body: '', deletedAt: new Date().toISOString() };
      messages = messages.map((x) => (x.id === messageId ? gone : x));
      opts.onDeleteMessage?.(messageId);
      publish(gone);
    },

    async markGroupRead(groupId, seq) {
      // `greatest`: the marker only ever moves forward.
      lastRead[groupId] = Math.max(lastRead[groupId] ?? 0, seq);
      opts.onMarkRead?.(groupId, seq);
    },

    async lastReadSeq(groupId) {
      return lastRead[groupId] ?? 0;
    },

    subscribeGroupChat(groupId, events: ChatEvents): ChatSubscription {
      const set = listeners.get(groupId) ?? new Set();
      const fn = (m: ChatMessage): void => events.onMessage(m);
      set.add(fn);
      listeners.set(groupId, set);
      events.onStatus?.(opts.chatStatus ?? 'subscribed');
      opts.onSubscribe?.((m) => events.onMessage(m), groupId);
      return {
        unsubscribe() {
          set.delete(fn);
        },
      };
    },

    async getIdentity() {
      return { ...identity };
    },

    async saveDisplayName(name) {
      identity = { ...identity, displayName: name.trim() };
    },

    async setAvatar() {
      const path = `${me}/avatar.webp`;
      identity = { ...identity, avatarPath: path };
      return path;
    },

    async removeAvatar() {
      identity = { ...identity, avatarPath: null };
    },

    async avatarUrl(path) {
      return path ? (opts.avatarUrls?.[path] ?? null) : null;
    },
  };
}
