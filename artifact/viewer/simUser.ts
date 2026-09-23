/*
  WHICH OF A GROUP'S MEMBERS THE VIEWER IS ACTING AS — WITH NO UI AT ALL.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT THIS REPLACED, AND WHY

  This used to be `SimUserBar.tsx`: a dashed grey bar above the chat with one
  chip per member, labelled "משתמש פעיל בסימולציה — כלי בדיקה של ה־Artifact".
  Ahmed asked for it gone — "הסר את פס הבדיקה" — and it is gone: nothing is
  rendered, nothing is portalled into the chat, and no MutationObserver
  watches for the chat to appear.

  What it existed FOR has not gone anywhere. Holding a conversation inside the
  artifact — write as a student, switch, answer as the instructor, switch back
  — is how `artifact/scripts/probe-chat.mjs` covers §10's permissions without
  a server and without a second browser: 55 checks depend on being able to
  change who is acting. So the switch keeps living here, as a store plus a
  seam on `window`, and the probe drives it by name instead of by clicking a
  control that a person can see.

  ─────────────────────────────────────────────────────────────────────────────
  WHY A `window` SEAM IS THE RIGHT SHAPE FOR IT

  It is the same kind of thing as `InspectorBridge` and the hash-to-route
  mapping: viewer plumbing, not a product feature and not presented as one.
  Three properties make it safe to leave in the published page:

    · it is only reachable from the page's own console. Nothing in the
      application calls it, no control exposes it, and a reader who never
      opens devtools cannot find it.
    · it can only ever pick a DIFFERENT FIXTURE. There is no account, no
      server and no data belonging to anybody — `simParticipants` returns the
      made-up roster of a made-up group, so "acting as" someone reaches
      nothing that is not already in the page.
    · the product below it is untouched. `AppDataProvider` already takes
      `repository` and `userId` — the seam the screen tests use — so a switch
      changes two props and nothing else.

  The name is prefixed and documented rather than short and guessable, so it
  reads as plumbing to anybody who does find it.
*/

import { useSyncExternalStore } from 'react';
import { simParticipants, SIM_GROUP_IDS, VIEWER_USER_ID } from './fixtures.js';

let activeUserId: string = VIEWER_USER_ID;
const listeners = new Set<() => void>();

export function setActiveSimUser(userId: string): void {
  if (userId === activeUserId) return;
  activeUserId = userId;
  for (const fn of listeners) fn();
}

export function useActiveSimUser(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => activeUserId,
    () => activeUserId,
  );
}

/**
 * Everyone the viewer could act as, per group, highest rank first.
 *
 * A member with no name of their own is real in the fixtures — §10 shows an
 * account that never set one — so `displayName` is normalised to '' here and
 * a name match simply never hits them. They are still reachable by id.
 */
function everyone(): { groupId: string; userId: string; displayName: string; role: string }[] {
  return SIM_GROUP_IDS.flatMap((groupId) =>
    simParticipants(groupId).map((m) => ({
      groupId,
      userId: m.userId,
      displayName: m.displayName ?? '',
      role: String(m.role),
    })),
  );
}

interface SimSeam {
  /**
   * Act as somebody. Takes a user id, or any part of a display name — the
   * probe reads "נועה" the way a person would, not `u-noa`. Returns the id it
   * settled on, or null when nothing matched, so a typo fails loudly instead
   * of silently leaving the previous person acting.
   */
  actAs(who: string): string | null;
  /** Who is acting now. */
  active(): string;
  /** The roster of one group, or of every group when none is named. */
  participants(groupId?: string): { userId: string; displayName: string; role: string }[];
}

export function installSimSeam(): void {
  const seam: SimSeam = {
    actAs(who) {
      const all = everyone();
      const hit =
        all.find((m) => m.userId === who) ??
        all.find((m) => m.displayName !== '' && m.displayName.includes(who));
      if (!hit) return null;
      setActiveSimUser(hit.userId);
      return hit.userId;
    },
    active: () => activeUserId,
    participants(groupId) {
      const rows = groupId === undefined ? everyone() : everyone().filter((m) => m.groupId === groupId);
      return rows.map(({ userId, displayName, role }) => ({ userId, displayName, role }));
    },
  };
  (window as unknown as Record<string, unknown>)['__recipeNotebookViewerSim'] = seam;
}
