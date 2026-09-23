/*
  The invitation, as the UI has to talk about it.

  ─────────────────────────────────────────────────────────────────────────────
  WHY `expired` IS COMPUTED HERE AND NOT READ FROM A COLUMN

  There is no `expired` status in the database, on purpose (migration 0030):
  expiry is a fact about the clock, not something anybody performs, and a
  status column that said `expired` would be wrong from the moment the row was
  written until whatever job was supposed to update it ran.

  So the state is derived — by `public.invite_state` on the server, and by
  `inviteState` here for the list on screen. The two must agree, and
  `invites.test.ts` reads the SQL to check that they do.

  WHAT THE UI MAY SAY ABOUT AN ADDRESS

  §10.1 and the user's requirement: "אין לחשוף אם כתובת אימייל מסוימת קיימת
  במערכת". These labels are read by the STAFF of a group, who typed the address
  themselves, so showing it back to them discloses nothing they did not already
  know. The place that must stay silent is redemption — and it does: every
  refusal in `redeem_group_invite` returns the same sentence, so a failed
  attempt cannot be used to test whether an address is registered.
*/

import type { InviteState, InviteStatus } from '../../lib/database.types.js';

export interface InviteView {
  id: string;
  /** null = an open link, with no address bound to it */
  email: string | null;
  label: string;
  token: string;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  replacesId: string | null;
}

/**
 * Must agree with `public.invite_state` (migration 0030):
 * a non-pending status stands; a pending one that is past its expiry reads
 * `expired`.
 */
export function inviteState(
  invite: Pick<InviteView, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): InviteState {
  if (invite.status !== 'pending') return invite.status;
  return Date.parse(invite.expiresAt) <= now.getTime() ? 'expired' : 'pending';
}

export const INVITE_STATE_LABEL: Readonly<Record<InviteState, string>> = {
  pending: 'ממתינה',
  accepted: 'נוצלה',
  rejected: 'נדחתה',
  revoked: 'בוטלה',
  expired: 'פג תוקף',
};

/** Only a live invitation has a link worth copying. */
export function isLive(state: InviteState): boolean {
  return state === 'pending';
}

/**
 * Resend is refused only for an invitation that was already used.
 *
 * Mirrors `resend_group_invite`, which raises on `status = 'accepted'` and
 * accepts every other state — including `expired`, which is the case it exists
 * for, and `revoked`, because "cancel, then change your mind" is a normal
 * thing to do.
 */
export function canResend(state: InviteState): boolean {
  return state !== 'accepted';
}

/** Revoke only does something to a live invitation (0031 filters on pending). */
export function canRevoke(state: InviteState): boolean {
  return state === 'pending';
}

/**
 * The link that goes in the email.
 *
 * `origin` is passed in rather than read from `window` so this is testable and
 * so a server-side sender (the Edge Function) can build the same link from the
 * same function. The path is the route registered in App.tsx.
 */
export function inviteLink(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${token}`;
}

/**
 * A light check before a pointless round trip. NOT validation in any
 * meaningful sense — the database normalises and stores whatever it is given,
 * and an address that looks fine here can still bounce.
 */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length >= 5 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v);
}

/** What the server stores: trimmed and lower-cased (`normalize_email`, 0030). */
export function normalizeEmail(value: string): string | null {
  const v = value.trim().toLowerCase();
  return v === '' ? null : v;
}

/** How many days are left, for "פג בתוך 3 ימים". Never negative. */
export function daysLeft(expiresAt: string, now: Date = new Date()): number {
  const ms = Date.parse(expiresAt) - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
