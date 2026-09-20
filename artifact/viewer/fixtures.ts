/*
  ARTIFACT FIXTURE — NOT PRODUCTION DATA.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT THIS FILE IS

  A repository, in the shape of `apps/web/src/data/repository.ts`, that feeds
  the EXISTING screens with enough data for a person to look at them. It exists
  only for the audit viewer in this directory. Nothing here is imported by the
  product, and no product file was changed to accommodate it.

  WHAT IT IS MADE OF, AND WHY THAT ORDER

    · `createLocalDemoRepository()` — PRODUCTION code, and the source of the
      five demo recipes (`data/demoRecipes.ts`, generated from the prototype).
      Reads come from it wherever it has real answers.
    · `createFakeGroups()` — the fixture layer that ALREADY EXISTS in the
      project, at `apps/web/src/test/fakeGroups.ts`. It enforces the same rank
      model the policies do, so a group screen in the viewer refuses what the
      database would refuse.
    · a few local overrides, below, for the paths the demo repository answers
      with "there is nowhere to write": the catalog, the plans, personal notes,
      and saving a recipe.

  THE ONE THING THAT IS DELIBERATELY NOT HONEST, AND WHERE IT IS DISCLOSED

  `capabilities()` reports `source: 'supabase', canWrite: true`, which is a
  LIE about this viewer and the only way to see what the screens look like in
  production: several of them read that field and, on 'local-demo', correctly
  replace their controls with "there is no server here" (that state is worth
  seeing too, and the real demo build at `npm run e2e:build` shows it).

  So the product UI in the viewer renders as it does for a signed-in account,
  and the disclosure lives OUTSIDE the product UI, in the artifact inspector,
  which says on every screen that no request leaves the page.

  SEVERAL PEOPLE IN ONE PAGE

  `createFakeGroups` binds one account at creation, so the messages, the read
  markers, the rosters and the uploaded pictures are kept OUTSIDE it (see "the
  simulation session" below) and a fresh fake is built for whoever is acting.
  Every rule still comes from the fake and from `features/groups/roles.ts`;
  this file only remembers the world between one person and the next.

  WHAT IS NOT FAKED

  Nothing that needs a server is simulated: no Supabase, no auth, no realtime
  socket, no storage, no edge function. Signed image URLs come back null, which
  is a real state the gallery already handles. Chat messages are delivered by
  the fixture's own in-memory publish, not by a socket — the inspector says so,
  and switching person is a local re-read, not a second client.
*/

import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import { defaultPrefs, ingredientKeyOf } from '@recipe-notebook/engine';
import { createLocalDemoRepository } from '../../apps/web/src/data/localDemoRepository.js';
import { createFakeGroups, type FakeGroupSeed } from '../../apps/web/src/test/fakeGroups.js';
import { DEMO_RECIPES } from '../../apps/web/src/data/demoRecipes.js';
import { basePriceOf, type CatalogItem } from '../../apps/web/src/features/pricing/catalog.js';
import type { ProductionPlan } from '../../apps/web/src/features/planning/plan.js';
import type { PurchaseRecord } from '../../apps/web/src/features/pricing/purchases.js';
import {
  RecipeInUseError,
  WriteNotAllowedError,
  type GroupRepository,
  type IdentityRepository,
  type PlanSummary,
  type RecipeImage,
  type Repository,
  type RepositoryCapabilities,
  type StoredVersion,
} from '../../apps/web/src/data/repository.js';
import { convertErrorText, convertToWebp } from '../../apps/web/src/features/images/convert.js';
import type {
  ChatMessage,
  GroupMember,
  JoinRequestView,
} from '../../apps/web/src/features/groups/types.js';
import { mergeMessages } from '../../apps/web/src/features/groups/chat.js';
import { rankOf } from '../../apps/web/src/features/groups/roles.js';
import type { InviteView } from '../../apps/web/src/features/groups/invites.js';

/* ── the ingredient centre ───────────────────────────────────────────────── */

/**
 * Six materials, keyed the way the engine keys them: `ingredientKeyOf` falls
 * back to the normalised NAME, so these keys are computed from the names that
 * actually appear in the demo recipes rather than typed by hand. That is what
 * makes the costing panel in the viewer compute from these prices — real
 * engine, fixture numbers.
 */
const material = (
  name: string,
  purchaseUnit: CatalogItem['purchaseUnit'],
  packageQty: number,
  packageCount: number,
  purchaseTotal: number,
  allergens: string[] = [],
): CatalogItem => ({
  id: `fixture-${ingredientKeyOf({ name })}`,
  key: ingredientKeyOf({ name }),
  name,
  purchaseUnit,
  packageQty,
  packageCount,
  purchaseTotal,
  usablePct: null,
  supplier: 'ספק לדוגמה',
  purchasedAt: '2026-09-10',
  priceUpdatedAt: '2026-09-10',
  note: '',
  purchasePrice: null,
  price: null,
  priceUnit: null,
  allergens,
});

/** The database derives these three columns; `basePriceOf` is what it mirrors. */
function derive(item: CatalogItem): CatalogItem {
  const d = basePriceOf(item);
  return d
    ? { ...item, purchasePrice: d.purchase, price: d.price, priceUnit: d.unit }
    : { ...item, purchasePrice: null, price: null, priceUnit: null };
}

const CATALOG: CatalogItem[] = [
  material('קמח לחם 13% חלבון', 'kg', 25, 1, 89, ['גלוטן']),
  material('חמאה 82%', 'kg', 1, 10, 340, ['חלב']),
  material('סוכר', 'kg', 25, 1, 62),
  material('חלב 3%', 'l', 1, 12, 78, ['חלב']),
  material('ביצים', 'unit', 1, 30, 36, ['ביצים']),
  material('שוקולד מריר 64%', 'kg', 5, 1, 195, ['חלב', 'סויה']),
].map(derive);

/* ── one production plan ─────────────────────────────────────────────────── */

const PLAN: ProductionPlan = {
  id: 'fixture-plan-1',
  name: 'יום ייצור — חמישי',
  planDate: '2026-09-18',
  note: 'תוכנית לדוגמה בתצוגה. לא נשמרה בשום מקום.',
  locked: false,
  lockedAt: null,
  snapshot: null,
  updatedAt: '2026-09-17T06:00:00Z',
  items: [
    { id: 'pi1', recipeId: 'brioche', qty: 40, qtyUnit: 'unit', readyAt: '07:00', note: '' },
    { id: 'pi2', recipeId: 'croissant', qty: 60, qtyUnit: 'unit', readyAt: '07:30', note: '' },
    { id: 'pi3', recipeId: 'pastrycream', qty: 2, qtyUnit: 'kg', readyAt: null, note: '' },
  ],
  onHand: {},
};

/* ── §10: two groups, so both sides of the permission model are visible ──── */

const roster = (over: Partial<GroupMember> & { userId: string }): GroupMember => ({
  displayName: null,
  avatarPath: null,
  role: 'member',
  rank: 1,
  joinedAt: '2026-09-01T00:00:00Z',
  ...over,
});

/** The account the viewer is signed in as, as far as the screens can tell. */
export const VIEWER_USER_ID = 'viewer-me';

/*
  WHOSE ACCOUNT THE FIXTURE IS ACTING AS.

  A neutral name by default, because the same fixture feeds the shareable demo
  — a file that goes to other people should not carry the owner's name in it,
  and a build that never calls `setSelfDisplayName` never contains it. The
  audit viewer, which is the owner's own page, sets his name at boot.
*/
export const SELF_NAME = 'שף לדוגמה';

const STUDENT_GROUP: FakeGroupSeed = {
  id: 'group-course',
  name: 'קורס קונדיטוריה — מחזור ב׳',
  kind: 'בית ספר לקונדיטוריה',
  note: 'הקבוצה פרטית. אי אפשר למצוא אותה בחיפוש ואי אפשר להיכנס בלי הזמנה.',
  code: 'PT-4K9Q',
  joinBy: ['invite', 'code'],
  // A STUDENT here: this is the half of §10 that has no teaching controls.
  myRole: 'member',
  roster: [
    roster({ userId: VIEWER_USER_ID, displayName: SELF_NAME }),
    roster({ userId: 'u-teacher', displayName: 'רונן אלמוג', role: 'owner', rank: 4 }),
    roster({ userId: 'u-noa', displayName: 'נועה בר־אור' }),
    roster({ userId: 'u-itay', displayName: '' }),
  ],
  courses: [
    {
      id: 'course-doughs',
      groupId: 'group-course',
      name: 'בצקים מועשרים',
      ord: 0,
      lessons: [
        {
          id: 'lesson-1',
          courseId: 'course-doughs',
          name: 'שיעור 1 — בצק שמרים מועשר',
          date: '2026-09-12',
          summary: 'לישה, פיתוח גלוטן, קיפול וחלוקה. שני בצקים באותו יום.',
          done: true,
          ord: 0,
          items: [
            {
              id: 'item-brioche',
              lessonId: 'lesson-1',
              recipeId: 'brioche',
              name: 'בריוש נאנט',
              ord: 0,
              // save ON: §11's copy button is reachable from this one.
              perms: { view: true, save: true, print: true, download: false, shareOut: false },
              createdAt: '2026-09-11T08:00:00Z',
            },
            {
              id: 'item-croissant',
              lessonId: 'lesson-1',
              recipeId: 'croissant',
              name: 'קרואסון חמאה',
              ord: 1,
              // save OFF: the other half of §10.4, with the spec's own wording.
              perms: { view: true, save: false, print: false, download: false, shareOut: false },
              createdAt: '2026-09-11T08:05:00Z',
            },
          ],
        },
        {
          id: 'lesson-2',
          courseId: 'course-doughs',
          name: 'שיעור 2 — מלית ושוקולד',
          date: '2026-09-19',
          summary: 'גנאש ביחסים שונים, והרכבה בתוך בצק מועשר.',
          done: false,
          ord: 1,
          items: [],
        },
      ],
    },
  ],
};

const STAFF_GROUP: FakeGroupSeed = {
  id: 'group-team',
  name: 'צוות מטבח — משמרת בוקר',
  kind: 'צוות מקצועי',
  note: 'הנוסחאות שהצוות מייצר בכל בוקר.',
  code: 'LV-88TR',
  joinBy: ['invite', 'link'],
  // OWNER here: every staff control in §10 is reachable from this group.
  myRole: 'owner',
  roster: [
    roster({ userId: VIEWER_USER_ID, displayName: SELF_NAME, role: 'owner', rank: 4 }),
    roster({ userId: 'u-dana', displayName: 'דנה לוי', role: 'instructor', rank: 2 }),
    roster({ userId: 'u-yossi', displayName: 'יוסי אברהם' }),
  ],
  courses: [
    {
      id: 'course-house',
      groupId: 'group-team',
      name: 'נוסחאות בית',
      ord: 0,
      lessons: [
        {
          id: 'lesson-morning',
          courseId: 'course-house',
          name: 'משמרת בוקר',
          date: null,
          summary: '',
          done: false,
          ord: 0,
          items: [
            {
              id: 'item-pastrycream',
              lessonId: 'lesson-morning',
              recipeId: 'pastrycream',
              name: 'קרם פטיסייר וניל',
              ord: 0,
              perms: { view: true, save: true, print: true, download: true, shareOut: false },
              createdAt: '2026-09-01T05:00:00Z',
            },
            {
              id: 'item-ganache',
              lessonId: 'lesson-morning',
              recipeId: 'ganache',
              name: 'גנאש שוקולד מריר 64%',
              ord: 1,
              // view OFF: staff see it greyed as "מוסתר"; a member sees nothing.
              perms: { view: false, save: false, print: false, download: false, shareOut: false },
              createdAt: '2026-09-01T05:02:00Z',
            },
          ],
        },
      ],
    },
  ],
};

const message = (
  over: Partial<ChatMessage> & { seq: number; groupId: string; authorId: string },
): ChatMessage => ({
  id: `msg-${over.groupId}-${over.seq}`,
  body: '',
  kind: 'text',
  replyToId: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-09-17T07:00:00Z',
  ...over,
});

const MESSAGES: ChatMessage[] = [
  message({
    seq: 1,
    groupId: 'group-course',
    authorId: 'u-teacher',
    kind: 'announcement',
    body: 'שיעור 2 נדחה ליום שישי. מי שלא קיבל הודעה — להגיד לי כאן.',
    createdAt: '2026-09-16T09:00:00Z',
  }),
  message({
    seq: 2,
    groupId: 'group-course',
    authorId: 'u-noa',
    body: 'איזו חמאה להביא לקיפולים?',
    createdAt: '2026-09-16T09:12:00Z',
  }),
  message({
    seq: 3,
    groupId: 'group-course',
    authorId: 'u-teacher',
    body: 'חמאת למינציה 84%. לא חמאה רגילה — היא נשברת בקיפול.',
    replyToId: 'msg-group-course-2',
    createdAt: '2026-09-16T09:20:00Z',
  }),
  message({
    seq: 4,
    groupId: 'group-course',
    authorId: VIEWER_USER_ID,
    body: 'תודה. אביא גם מדחום גלעין.',
    editedAt: '2026-09-16T09:31:00Z',
    createdAt: '2026-09-16T09:30:00Z',
  }),
  message({
    seq: 5,
    groupId: 'group-course',
    authorId: 'u-itay',
    body: '',
    deletedAt: '2026-09-16T10:00:00Z',
    createdAt: '2026-09-16T09:45:00Z',
  }),
  message({
    seq: 6,
    groupId: 'group-course',
    authorId: 'u-teacher',
    body: 'ומי שרוצה לתרגל לפני — הבריוש בשיעור פתוח לשמירה למחברת.',
    createdAt: '2026-09-17T06:10:00Z',
  }),
  message({
    seq: 7,
    groupId: 'group-team',
    authorId: 'u-dana',
    body: 'הקרם של אתמול יצא דליל. העליתי עמילן ב־5 גרם.',
    createdAt: '2026-09-17T05:40:00Z',
  }),
];

const INVITES: InviteView[] = [
  {
    id: 'invite-open',
    email: null,
    label: 'קישור למשמרת',
    token: 'fixture-token-open',
    status: 'pending',
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    createdAt: '2026-09-15T08:00:00Z',
    usedAt: null,
    revokedAt: null,
    replacesId: null,
  },
  {
    id: 'invite-expired',
    email: 'noa@example.com',
    label: '',
    token: 'fixture-token-expired',
    status: 'pending',
    expiresAt: '2026-09-01T08:00:00Z',
    createdAt: '2026-08-25T08:00:00Z',
    usedAt: null,
    revokedAt: null,
    replacesId: null,
  },
  {
    id: 'invite-used',
    email: 'dana@example.com',
    label: '',
    token: 'fixture-token-used',
    status: 'accepted',
    expiresAt: '2026-09-20T08:00:00Z',
    createdAt: '2026-09-10T08:00:00Z',
    usedAt: '2026-09-11T10:00:00Z',
    revokedAt: null,
    replacesId: null,
  },
];

const REQUESTS: JoinRequestView[] = [
  {
    id: 'req-1',
    groupId: 'group-team',
    userId: 'u-asker',
    note: 'עבדתי איתכם בקיץ',
    status: 'pending',
    createdAt: '2026-09-16T18:00:00Z',
    decidedAt: null,
  },
];

/* ── the simulation session: one §10 world, several people in it ─────────── */

/*
  WHY THIS EXISTS

  `createFakeGroups` binds ONE signed-in account at creation (`opts.userId`),
  because a screen test acts as one person. To hold a conversation you need
  several, so the viewer keeps the world OUTSIDE the fake — the messages, the
  read markers, the rosters and the uploaded pictures — and builds a fresh
  fake per active person, seeded from that world.

  WHAT IS STILL THE PROJECT'S OWN CODE, AND IT IS THE PART THAT DECIDES

  Every RULE is `apps/web/src/test/fakeGroups.ts` and, under it,
  `features/groups/roles.ts`: who may post, who may post an הכרזה, who may
  edit (author only), who may delete (author or rank ≥ 2), what a page of
  history contains, where the unread marker sits. Nothing below re-implements
  a permission or a chat behaviour. After every write the world is re-read
  FROM the fake (`chatPage`), so the fake stays the single source of truth and
  this file is only where the result is kept between one person and the next.

  WHAT IS NOT SIMULATED

  Realtime. The fake's own in-memory publish delivers a message to a screen
  that is already subscribed; there is no socket, and two people are two
  choices in the switcher rather than two devices. Everything else a group
  screen does that needs a server — an invitation email, storage, an RPC — is
  as it was: refused or reported, never faked.

  WHAT RESETS WHEN THE ACTIVE PERSON CHANGES, AND IS DOCUMENTED RATHER THAN
  PAPERED OVER

  A course, a lesson, a published item or an item permission created during
  the session lives inside the fake instance and is rebuilt from the seed on a
  switch. Messages, read markers, names, pictures and member roles are kept.
*/

const SIM_SEEDS: readonly FakeGroupSeed[] = [STUDENT_GROUP, STAFF_GROUP];

const sim = {
  /** every message in every group, in one list — the fake filters per group */
  messages: [...MESSAGES] as ChatMessage[],
  /** the read marker, per person per group */
  lastRead: { [VIEWER_USER_ID]: { 'group-course': 4 } } as Record<
    string,
    Record<string, number>
  >,
  /**
   * The rosters, which in production are `group_roster()` over `profiles`:
   * a name or a picture set in הגדרות shows up in the chat because the roster
   * reads the same profile. Keeping them here reproduces that, and keeps a
   * role change made in מסך ההרשאות from being undone by a switch.
   */
  rosters: new Map<string, GroupMember[]>(
    SIM_SEEDS.map((g) => [g.id, (g.roster ?? []).map((m) => ({ ...m }))]),
  ),
  /** object URLs for pictures uploaded during the session, by user id */
  avatars: new Map<string, string>(),
};

const simRosterOf = (groupId: string): GroupMember[] => sim.rosters.get(groupId) ?? [];

/** The people who can be spoken as in this group: its roster, nothing else. */
export function simParticipants(groupId: string): readonly GroupMember[] {
  return [...simRosterOf(groupId)].sort((a, b) => b.rank - a.rank);
}

export const SIM_GROUP_IDS: readonly string[] = SIM_SEEDS.map((g) => g.id);

const simMemberRow = (userId: string): GroupMember | undefined => {
  for (const id of SIM_GROUP_IDS) {
    const row = simRosterOf(id).find((m) => m.userId === userId);
    if (row) return row;
  }
  return undefined;
};

/** Writes a profile change into every roster it appears in, as a rename does. */
const simUpdateProfile = (userId: string, patch: Partial<GroupMember>): void => {
  for (const id of SIM_GROUP_IDS) {
    sim.rosters.set(
      id,
      simRosterOf(id).map((m) => (m.userId === userId ? { ...m, ...patch } : m)),
    );
  }
};

/* ── the repository the viewer mounts ────────────────────────────────────── */

/*
  The account-level state is module-level and NOT per call, because the viewer
  builds one repository per active person: a recipe edited as one person must
  still be there after a switch, the way the notebook does not empty when
  somebody else speaks in the group chat.
*/
let recipes: Recipe[] = [...DEMO_RECIPES];
let catalog: CatalogItem[] = [...CATALOG];
let plans: ProductionPlan[] = [PLAN];
const notes: Record<string, string> = {
  brioche: 'לישה ארוכה מדי — הבצק מתחמם. לעצור בשלב הצלקת.',
};
let calib: readonly Calibration[] = [];
/*
  `done: true`, so the onboarding gate lets the tabs render. The gate itself is
  real: with `done: false` every route redirects to /onboarding, which is the
  true first-run behaviour — and /onboarding is outside the gate, so it can
  still be opened.
*/
let prefs: MeasurementPrefs | null = { ...defaultPrefs('pro'), done: true };
let images: RecipeImage[] = [];
const objectUrls = new Map<string, string>();

/**
 * Renames the acting account across every roster in the simulated world.
 *
 * Called by the audit viewer, which shows the owner's own notebook. The demo
 * does not call it, so its bundle carries no name but the neutral one.
 */
export function setSelfDisplayName(name: string): void {
  simUpdateProfile(VIEWER_USER_ID, { displayName: name.trim() });
}

export function createViewerRepository(activeUserId: string = VIEWER_USER_ID): Repository {
  const demo = createLocalDemoRepository();

  /*
    The seeds this person is allowed to see. A group whose roster has no row
    for them is not passed in at all, so `getGroup` returns null and the
    screen says "הקבוצה אינה קיימת, או שאין לחשבון הזה גישה אליה" — which is
    what `groups_read` does to a non-member, and it is the same sentence for
    both reasons on purpose.
  */
  const seeds: FakeGroupSeed[] = SIM_SEEDS.flatMap((g) => {
    const roster = simRosterOf(g.id);
    const mine = roster.find((m) => m.userId === activeUserId);
    return mine ? [{ ...g, myRole: mine.role, roster: roster.map((m) => ({ ...m })) }] : [];
  });

  const fake = createFakeGroups({
    userId: activeUserId,
    groups: seeds,
    messages: sim.messages,
    invites: INVITES,
    requests: REQUESTS,
    lastRead: sim.lastRead[activeUserId] ?? {},
    identity: {
      displayName: simMemberRow(activeUserId)?.displayName ?? '',
      avatarPath: simMemberRow(activeUserId)?.avatarPath ?? null,
    },
    itemNotes: { 'item-brioche': 'התנור שלי חם ב־10 מעלות. לקצר ל־18 דקות.' },
    // `validToken` makes /join/:token refuse anything else, the way 0031 does.
    validToken: 'fixture-token-open',
    /*
      Kept across a switch: a role set in מסך ההרשאות is a row in
      `group_members`, not something the reader's own session holds.
    */
    onSetMemberRole: (userId, role) =>
      simUpdateProfile(userId, { role, rank: rankOf(role) }),
    onRemoveMember: (userId) => {
      for (const id of SIM_GROUP_IDS) {
        sim.rosters.set(
          id,
          simRosterOf(id).filter((m) => m.userId !== userId),
        );
      }
    },
  });

  /*
    Re-reads the group's history from the fake and keeps it. `mergeMessages`
    is the product's own merge (keyed by id, newer copy wins), which is what
    makes this a snapshot of the fake's state rather than a second opinion
    about it.
  */
  const keep = async (groupId: string): Promise<void> => {
    const page = await fake.chatPage(groupId, null, 1000);
    sim.messages = mergeMessages(sim.messages, page.messages);
  };

  const groups: GroupRepository & IdentityRepository = {
    ...fake,

    sendMessage: async (input) => {
      const sent = await fake.sendMessage(input);
      await keep(input.groupId);
      return sent;
    },
    editMessage: async (id, body) => {
      const edited = await fake.editMessage(id, body);
      await keep(edited.groupId);
      return edited;
    },
    deleteMessage: async (id) => {
      const groupId = sim.messages.find((m) => m.id === id)?.groupId;
      await fake.deleteMessage(id);
      if (groupId !== undefined) await keep(groupId);
    },
    markGroupRead: async (groupId, seq) => {
      await fake.markGroupRead(groupId, seq);
      const mine = sim.lastRead[activeUserId] ?? {};
      // `greatest`, the way `mark_group_read` does it: forward only.
      sim.lastRead[activeUserId] = { ...mine, [groupId]: Math.max(mine[groupId] ?? 0, seq) };
    },

    /*
      §10.1 identity, per person. In production this is one row in `profiles`
      that both הגדרות and `group_roster()` read, so a rename here is written
      into the rosters and the chat starts using the new name.
    */
    getIdentity: async () => ({
      displayName: simMemberRow(activeUserId)?.displayName ?? '',
      avatarPath: simMemberRow(activeUserId)?.avatarPath ?? null,
    }),
    saveDisplayName: async (name: string) => {
      simUpdateProfile(activeUserId, { displayName: name.trim() });
    },
    setAvatar: async (file: File | Blob) => {
      const converted = await convertToWebp(file, {}, { maxBytes: 512 * 1024, maxEdge: 512 });
      if (!converted.ok) throw new WriteNotAllowedError(convertErrorText(converted));
      const previous = sim.avatars.get(activeUserId);
      if (previous) URL.revokeObjectURL(previous);
      const path = `${activeUserId}/avatar.webp`;
      sim.avatars.set(activeUserId, URL.createObjectURL(converted.blob));
      simUpdateProfile(activeUserId, { avatarPath: path });
      return path;
    },
    removeAvatar: async () => {
      const previous = sim.avatars.get(activeUserId);
      if (previous) URL.revokeObjectURL(previous);
      sim.avatars.delete(activeUserId);
      simUpdateProfile(activeUserId, { avatarPath: null });
    },
    avatarUrl: async (path: string | null) => {
      if (path === null) return null;
      const owner = path.split('/')[0] ?? '';
      return sim.avatars.get(owner) ?? null;
    },
    avatarUrls: async (paths: readonly string[]) => {
      const out: Record<string, string> = {};
      for (const p of paths) {
        const url = sim.avatars.get(p.split('/')[0] ?? '');
        if (url) out[p] = url;
      }
      return out;
    },

    // The roster is the world's, so a rename or a role change survives a switch.
    roster: async (groupId: string) => simRosterOf(groupId).map((m) => ({ ...m })),
  };

  /*
    §9 — two stored versions on one recipe, so the history, the comparison and
    the restore are all reachable by clicking. The snapshots are the live
    recipe with one number changed, which is what a real snapshot is: the
    whole recipe as it was.
  */
  const versionsOf = (recipeId: string): StoredVersion[] => {
    const live = recipes.find((r) => r.id === recipeId);
    /*
      Two recipes, on purpose. `brioche` is `locked: true` in the demo data, so
      its history shows the versions with the restore DISABLED — which is §9's
      rule about an approved formula, and worth seeing. `ganache` is unlocked,
      so the restore actually runs there.
    */
    if (!live || (recipeId !== 'brioche' && recipeId !== 'ganache')) return [];
    const older = {
      ...live,
      ingredients: (live.ingredients ?? []).map((ing, i) =>
        i === 0 ? { ...ing, qty: Math.round(((ing.qty ?? 0) as number) * 0.9) } : ing,
      ),
    };
    return [
      {
        id: `fixture-version-2-${recipeId}`,
        recipeId,
        tag: 'V2',
        what: 'העלאת אחוז החמאה, וקיצור הלישה',
        createdAt: '2026-09-12T07:00:00Z',
        snapshot: older as Recipe,
      },
      {
        id: `fixture-version-1-${recipeId}`,
        recipeId,
        tag: 'V1',
        what: 'הנוסחה כפי שנכתבה בשיעור',
        createdAt: '2026-09-05T07:00:00Z',
        snapshot: older as Recipe,
      },
    ];
  };
  const capabilities = (): RepositoryCapabilities => ({
    // See the header: this is what makes the screens render their connected
    // state. The inspector outside the app says no request leaves the page.
    source: 'supabase',
    online: true,
    canWrite: true,
    servingFromCache: false,
  });

  const summary = (p: ProductionPlan): PlanSummary => ({
    id: p.id,
    name: p.name,
    planDate: p.planDate,
    locked: p.locked,
    items: p.items.length,
  });

  return {
    ...demo,
    ...groups,
    capabilities,

    // Recipes: the demo five, writable in memory so the edit form can be used.
    listRecipes: async () => [...recipes],
    getRecipe: async (id: string) => recipes.find((r) => r.id === id) ?? null,
    saveRecipe: async (recipe: Recipe) => {
      const saved =
        !recipe.id || recipe.id.startsWith('new-')
          ? { ...recipe, id: `fixture-recipe-${recipes.length + 1}` }
          : recipe;
      recipes = [...recipes.filter((r) => r.id !== saved.id), saved];
      return saved;
    },
    /* `deleteRecipe` is further down, with the §8 delete guard on it. It was
       ALSO here, unguarded, until `artifact/tsconfig.json` existed to report
       the duplicate key: the later property won, so the guard was in force
       and the dead one changed nothing — but two of them is one too many. */

    // Preferences, so the settings and tools screens can be operated.
    getPrefs: async () => prefs,
    savePrefs: async (next: MeasurementPrefs) => {
      prefs = next;
      return next;
    },
    listCalibrations: async () => [...calib],
    saveCalibrations: async (list: readonly Calibration[]) => {
      calib = [...list];
      return [...calib];
    },

    // The ingredient centre.
    listCatalog: async () => [...catalog],
    saveCatalogItem: async (item: CatalogItem) => {
      const saved = derive(item);
      catalog = [...catalog.filter((c) => c.key !== saved.key), saved];
      return saved;
    },
    deleteCatalogItem: async (key: string) => {
      catalog = catalog.filter((c) => c.key !== key);
    },
    recordPurchase: async (input) => {
      const existing = catalog.find((c) => c.key === input.key);
      const saved = derive({
        ...(existing ?? material(input.name, input.purchaseUnit, 1, 1, 0)),
        key: input.key,
        name: input.name,
        purchaseUnit: input.purchaseUnit,
        packageQty: input.packageQty,
        packageCount: input.packageCount,
        purchaseTotal: input.purchaseTotal,
        usablePct: input.usablePct,
        supplier: input.supplier,
        purchasedAt: input.purchasedAt,
        note: input.note,
      });
      catalog = [...catalog.filter((c) => c.key !== saved.key), saved];
      return saved;
    },
    purchaseHistory: async (): Promise<PurchaseRecord[]> => [],

    // Production plans.
    listPlans: async () => plans.map(summary),
    getPlan: async (id: string) => plans.find((p) => p.id === id) ?? null,
    savePlan: async (plan: ProductionPlan) => {
      const saved =
        plan.id === '' ? { ...plan, id: `fixture-plan-${plans.length + 1}` } : plan;
      plans = [...plans.filter((p) => p.id !== saved.id), saved];
      return saved;
    },
    deletePlan: async (id: string) => {
      plans = plans.filter((p) => p.id !== id);
    },
    setPlanLocked: async (id: string, locked: boolean, snapshot: unknown) => {
      plans = plans.map((p) =>
        p.id === id
          ? { ...p, locked, lockedAt: locked ? new Date().toISOString() : null, snapshot }
          : p,
      );
    },

    /*
      §9 versions. The demo repository answers "there is no history at all",
      which is true of it and would leave the panel empty here; these two make
      the history, the comparison and the restore clickable.
    */
    listVersions: async (recipeId: string) => versionsOf(recipeId),
    restoreVersion: async (versionId: string) => {
      const all = recipes.flatMap((r) => versionsOf(r.id));
      const v = all.find((x) => x.id === versionId);
      if (!v) throw new WriteNotAllowedError('הגרסה אינה קיימת בסימולציה.');
      const restored = { ...v.snapshot, id: v.recipeId } as Recipe;
      recipes = recipes.map((r) => (r.id === v.recipeId ? restored : r));
      return restored;
    },

    /*
      The delete guard. `ingredients.sub_recipe_id` is NO ACTION in migration
      0008, so deleting a recipe another recipe uses as a base is refused BY
      THE DATABASE — and the demo set really does have such a link (the
      chocolate brioche uses the ganache). Mirrored here so the refusal is
      demonstrable instead of the fixture quietly deleting what the server
      would not.
    */
    deleteRecipe: async (id: string) => {
      const usedBy = recipes
        .filter((r) => r.id !== id && (r.ingredients ?? []).some((i) => i.subId === id))
        .map((r) => ({ id: r.id, name: String(r.name ?? '') }));
      if (usedBy.length > 0) throw new RecipeInUseError(usedBy);
      recipes = recipes.filter((r) => r.id !== id);
    },
    recipesUsing: async (id: string) =>
      recipes
        .filter((r) => r.id !== id && (r.ingredients ?? []).some((i) => i.subId === id))
        .map((r) => ({ id: r.id, name: String(r.name ?? '') })),

    /*
      §5 photographs. The real path converts to WebP in the browser and uploads
      to a private bucket; the conversion is the product's own code and runs
      here unchanged — only the upload is replaced by an object URL, so a photo
      chosen on the device really appears on the recipe.
    */
    listRecipeImages: async (recipeId: string) =>
      images.filter((i) => i.recipeId === recipeId),
    addRecipeImage: async (recipeId: string, file: File | Blob) => {
      const converted = await convertToWebp(file);
      if (!converted.ok) throw new WriteNotAllowedError(convertErrorText(converted));
      const image: RecipeImage = {
        id: `fixture-image-${images.length + 1}`,
        recipeId,
        storagePath: `${recipeId}/fixture-${images.length + 1}.webp`,
        ord: images.filter((i) => i.recipeId === recipeId).length,
        width: converted.width,
        height: converted.height,
        bytes: converted.bytes,
        caption: '',
        createdAt: new Date().toISOString(),
      };
      objectUrls.set(image.storagePath, URL.createObjectURL(converted.blob));
      images = [...images, image];
      return image;
    },
    removeRecipeImage: async (image: RecipeImage) => {
      const url = objectUrls.get(image.storagePath);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(image.storagePath);
      images = images.filter((i) => i.id !== image.id);
    },
    signedImageUrl: async (storagePath: string) => objectUrls.get(storagePath) ?? null,

    // §10.1 identity and the rosters are in the simulation session above, so
    // a name or a picture set here is the same one the chat reads.

    // §8 personal notes.
    getPrivateNote: async (recipeId: string) => notes[recipeId] ?? null,
    savePrivateNote: async (recipeId: string, body: string) => {
      if (body.trim() === '') delete notes[recipeId];
      else notes[recipeId] = body;
    },
  };
}
