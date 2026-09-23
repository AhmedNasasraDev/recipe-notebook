/*
  §10.1 — the roles, and what each one may DO.
  ─────────────────────────────────────────────────────────────────────────────
  WHAT THIS FILE IS FOR, AND WHAT IT IS NOT

  This is the UI's copy of the permission model: which buttons to offer, which
  roles a person may hand out, what to call each role in Hebrew. It is NOT the
  enforcement. Every rank threshold here exists a second time as an RLS policy
  in migration 0030, and the policy is the one that decides — the user's
  requirement was explicit: "כל פעולה רגישה חייבת להיאכף גם בצד השרת/DB ולא רק
  להסתיר כפתורים ב-UI".

  So if this file is wrong in the permissive direction, the database refuses and
  the screen shows an error. If it is wrong in the restrictive direction, a
  button is missing. Neither is a breach, which is the whole point of having
  the model in both places.

  THE RANKS ARE THE MIGRATION'S RANKS

  `role_rank` in 0030 is owner 4, admin 3, instructor 2, member 1, and the
  numbers below are the same numbers on purpose: the policies compare ranks,
  not names, so a UI that ranked them differently would offer exactly the
  actions the database rejects. `roles.test.ts` pins them.

  §10.1 in the spec lists three roles (owner 3 / instructor 2 / member 1).
  `admin` was added in 0030 because "owner or nothing" is how a group ends up
  with three owners — the spec's three keep their ORDER, and the ranks shifted
  up by one to make room.
*/

import type { GroupRole } from '../../lib/database.types.js';

/** Must equal `public.role_rank` (migration 0030). */
export const ROLE_RANK: Readonly<Record<GroupRole, number>> = {
  owner: 4,
  admin: 3,
  instructor: 2,
  member: 1,
};

export const ROLE_LABEL: Readonly<Record<GroupRole, string>> = {
  owner: 'בעל הקבוצה',
  admin: 'מנהל',
  instructor: 'מדריך',
  member: 'תלמיד',
};

/** What each role is for, shown next to the picker so a choice is informed. */
export const ROLE_NOTE: Readonly<Record<GroupRole, string>> = {
  owner: 'שולט בכול, כולל מחיקת הקבוצה. תפקיד אחד בקבוצה.',
  admin: 'מנהל חברים, הזמנות ותפקידים — בלי למחוק את הקבוצה.',
  instructor: 'בונה קורסים ושיעורים, קובע הרשאות ומזמין תלמידים.',
  member: 'צופה בשיעורים ובמתכונים שהמדריך אישר, ומשתתף בצ׳אט.',
};

export const ROLES_BY_RANK: readonly GroupRole[] = ['owner', 'admin', 'instructor', 'member'];

/**
 * The actions the UI gates, each with the rank the DATABASE requires.
 *
 * Every line names the policy that enforces it, because these two lists
 * drifting apart is the failure mode this file is most exposed to.
 */
export const ACTION_RANK = {
  /** post a message, read the group at all — `messages_insert`, `groups_read` */
  participate: 1,
  /** build courses, lessons and items — `courses_write`, `lessons_write`, `items_write` */
  teach: 2,
  /** set the five per-recipe permissions — `items_write` */
  perms: 2,
  /** create, revoke and resend invitations — `invites_staff`, `create_group_invite` */
  invite: 2,
  /** approve or decline a join request — `approve_group_join`, `requests_*` */
  approve: 2,
  /** post an announcement — `messages_insert`'s second branch */
  announce: 2,
  /** delete somebody else's message (never EDIT it — see 0032) — `messages_update` */
  moderate: 2,
  /** rename the group, change how it may be joined — `groups_write` */
  manage: 3,
  /** change a member's role, or remove a member — `members_role`, `members_remove` */
  roles: 3,
  /** delete the group — `groups_delete`, which is rank = 4 exactly */
  destroy: 4,
} as const;

export type GroupAction = keyof typeof ACTION_RANK;

export function rankOf(role: GroupRole): number {
  return ROLE_RANK[role];
}

/** May somebody with this role do this, as far as the UI should offer it? */
export function can(role: GroupRole, action: GroupAction): boolean {
  return rankOf(role) >= ACTION_RANK[action];
}

/**
 * Which roles this person may assign.
 *
 * Mirrors `members_role`: `role_rank(role) < group_rank(group_id)`. So an admin
 * (3) may make somebody an instructor or a member, and may NOT make somebody
 * an admin or an owner — including themselves. That strictness is deliberate:
 * the invariant is on both sides of the policy, so the database refuses the
 * promotion even if this list were wrong.
 *
 * It also means `owner` is never assignable through this path. Transferring a
 * group is a different operation, and it does not exist yet.
 */
export function assignableRoles(myRole: GroupRole): GroupRole[] {
  return ROLES_BY_RANK.filter((r) => rankOf(r) < rankOf(myRole));
}

/**
 * May this person change that person's role, or remove them?
 *
 * `members_role` and `members_remove` both require rank >= 3 AND that the
 * TARGET's rank is strictly lower. Equal ranks cannot touch each other — two
 * admins cannot demote one another — and nobody can act on the owner.
 */
export function canActOnMember(myRole: GroupRole, targetRole: GroupRole): boolean {
  return can(myRole, 'roles') && rankOf(targetRole) < rankOf(myRole);
}

/** A group's own list of the ways in (§10.2), for the labels a screen shows. */
export const JOIN_METHOD_LABEL = {
  invite: 'הזמנה אישית',
  link: 'קישור פרטי',
  code: 'קוד קבוצה',
  request: 'בקשה לאישור מנהל',
} as const;

export const JOIN_METHOD_NOTE = {
  invite: 'המדריך שולח הזמנה לכתובת מייל מסוימת. רק היא תוכל להשתמש בה.',
  link: 'קישור חד־פעמי שפג בתוך 7 ימים.',
  code: 'קוד שנמסר בשיעור. יוצר בקשה שמנהל מאשר — הקוד לבדו לא מכניס לקבוצה.',
  request: 'כל בקשה מחכה לאישור ידני.',
} as const;

/* §10.4 — the five per-recipe permissions, most restrictive by default. */
export const PERM_LABELS: ReadonlyArray<readonly [keyof ItemPerms, string, string]> = [
  ['view', 'צפייה במתכון', 'בלי צפייה המתכון לא מופיע לתלמיד כלל'],
  ['save', 'שמירה למחברת האישית', 'נוצר עותק פרטי אצל התלמיד'],
  ['print', 'הדפסה', 'כולל שמירה כ־PDF'],
  ['download', 'הורדת קובץ', 'ייצוא המתכון כנתונים'],
  ['shareOut', 'שיתוף מחוץ לקבוצה', 'שליחה לאנשים שאינם חברי הקבוצה'],
];

export interface ItemPerms {
  view: boolean;
  save: boolean;
  print: boolean;
  download: boolean;
  shareOut: boolean;
}

/** §10.4: the default is the most restrictive one, and it lives in the database too. */
export const PERM_DEFAULT: ItemPerms = {
  view: true,
  save: false,
  print: false,
  download: false,
  shareOut: false,
};
