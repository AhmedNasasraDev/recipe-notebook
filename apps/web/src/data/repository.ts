// The data seam.
//
// Everything above this file talks to these interfaces and never to Supabase or
// to IndexedDB directly. That is what made connecting Supabase in stage 3 a
// change in one directory rather than a change in every screen: not one route
// component was touched to accommodate it.
//
// Offline model — approved for this project:
//   Supabase is the source of truth. The active recipe, the measurement
//   preferences and Cook Mode progress are mirrored into IndexedDB so they stay
//   READABLE with no network. Writes require a connection.
//
// `capabilities` lets a screen say the honest thing instead of failing silently:
// a save button knows whether saving is possible right now.

import type { Calibration, MeasurementPrefs, Recipe } from '@recipe-notebook/engine';
import type { CatalogItem } from '../features/pricing/catalog.js';
import type {
  PurchaseInput,
  PurchaseRecord,
} from '../features/pricing/purchases.js';
import type { ProductionPlan } from '../features/planning/plan.js';
import type { GroupRole } from '../lib/database.types.js';
import type { ItemPerms } from '../features/groups/roles.js';
import type { InviteView } from '../features/groups/invites.js';
import type {
  ChatMessage,
  ChatPage,
  GroupDetail,
  GroupLesson,
  GroupMember,
  GroupSummary,
  JoinRequestView,
} from '../features/groups/types.js';

/** Extra instructions for a save. All optional; a plain save still works. */
export interface SaveOptions {
  /**
   * The `updated_at` this client loaded, for optimistic concurrency. When it
   * no longer matches the stored row the save is REFUSED — somebody else saved
   * in between, and silently overwriting their work is worse than an error.
   * Omit to skip the check.
   */
  expectedUpdatedAt?: string | null;
  /** §9 versionDiff — the description stored with the snapshot of the previous state. */
  versionNote?: string;
}

/** A stored version of a recipe (§9). */
export interface StoredVersion {
  id: string;
  recipeId: string;
  /** V1, V2, ... assigned by the database */
  tag: string;
  /** what changed, per §9's versionDiff */
  what: string;
  createdAt: string;
  /**
   * The recipe as it was. Reconstructed by the SAME mapper that reads live
   * rows, so a version cannot be interpreted differently from the present.
   */
  snapshot: Recipe;
}

/**
 * Which backend is serving this session.
 *
 *   · `supabase`    — the real service, with an account behind it.
 *   · `local-demo`  — no backend at all: the five demo recipes, read-only.
 *   · `simulated`   — the TRIAL: a full working application whose backend is
 *                     a fixture in the browser. Writes succeed and persist in
 *                     this browser, and nothing leaves the page.
 *
 * `simulated` exists because the trial used to report itself as `supabase` so
 * that the screens would render their connected state — which meant the
 * application's own disclosure banner was suppressed exactly where it was
 * most needed. Ahmed asked for the trial to say what it is (stage 3, item 3):
 * it can keep working locally, and it must not present itself as a connection
 * to a real server.
 */
export type DataSourceKind = 'local-demo' | 'simulated' | 'supabase';

export interface RepositoryCapabilities {
  /** which backend is actually serving this session */
  source: DataSourceKind;
  /** false when the browser reports no network */
  online: boolean;
  /**
   * whether a write can succeed right now. False for the demo repository, which
   * has nowhere to write, and false offline — writes are refused, not queued.
   */
  canWrite: boolean;
  /** true when the data on screen came from the offline mirror */
  servingFromCache: boolean;
}

export interface RecipeRepository {
  listRecipes(): Promise<Recipe[]>;
  getRecipe(id: string): Promise<Recipe | null>;
  /**
   * Removes a recipe and everything hanging off it.
   *
   * The child tables are ON DELETE CASCADE, so one statement takes the
   * ingredients, steps, issues, trials, batches, versions and private note with
   * it. That is deliberate: a recipe whose ingredients had been orphaned would
   * still compute, and would compute wrongly.
   *
   * A recipe that is IN USE as somebody's sub-recipe is refused — by the
   * database, in migration 0008, not here. Rejects with `RecipeInUseError`,
   * which carries the dependents the caller is allowed to see so the screen can
   * name them.
   *
   * Rejects with `WriteNotAllowedError` when the repository cannot write.
   */
  deleteRecipe(id: string): Promise<void>;
  /**
   * Persists a recipe. Rejects with `WriteNotAllowedError` when the repository
   * cannot write — callers must surface that, never pretend it worked.
   * (§17 / AC #17: no screen may present a mock action as if it reached a server.)
   *
   * For an existing recipe this ALSO snapshots the previous state into the
   * version history, atomically (§9). There is no way to save without
   * versioning, on purpose: an optional snapshot is a snapshot somebody
   * eventually forgets to take.
   */
  saveRecipe(recipe: Recipe, options?: SaveOptions): Promise<Recipe>;

  /** The version history, newest first (§9). */
  listVersions(recipeId: string): Promise<StoredVersion[]>;

  /**
   * Restores a version.
   *
   * §9: a restore does not delete. It pushes the CURRENT state into history
   * first and then applies the snapshot, so a mistaken restore is itself
   * undoable. Atomic — both writes happen or neither.
   *
   * Refused for a `locked` recipe until it is unlocked.
   */
  restoreVersion(versionId: string): Promise<Recipe>;

  /**
   * Which of the caller's own recipes use this one as a sub-recipe.
   *
   * Since stage 6 this is not a warning but the reason a delete is refused:
   * `ingredients.sub_recipe_id` is NO ACTION (migration 0008), so a base recipe
   * in use cannot be deleted at all. The screen uses this to say WHICH recipes
   * are holding it, which a foreign-key violation cannot tell anyone.
   *
   * It is RLS-filtered at source, so it can only ever return recipes the caller
   * may see — which is what keeps the refusal from saying anything about
   * another account (stage-6 requirement 6).
   */
  recipesUsing(recipeId: string): Promise<Array<{ id: string; name: string }>>;
}

/**
 * The ingredient centre (stage 7).
 *
 * The catalog is the single source of truth for a material's price. A recipe
 * row that has no price of its own resolves one from here at read time, so
 * changing a price here moves every recipe that inherits it — see
 * `features/pricing/catalog.ts` for how that coexists with frozen version
 * snapshots.
 */
export interface CatalogRepository {
  listCatalog(): Promise<CatalogItem[]>;
  /**
   * Creates or updates one material, keyed by `key` within the account.
   *
   * `price` and `priceUnit` on the item are IGNORED: they are generated
   * columns in the database, derived from the package. Sending them would be
   * rejected, and accepting them here would invite a caller to think it could
   * set a price directly.
   */
  saveCatalogItem(item: CatalogItem): Promise<CatalogItem>;
  deleteCatalogItem(key: string): Promise<void>;
  /**
   * Which of the caller's recipes would move if this material's price changed
   * (stage-7 requirement 5).
   *
   * `rows` counts the lines that INHERIT the central price. `overridden`
   * counts the lines in the same recipe that carry their own price and would
   * therefore not move — saying a recipe is affected when every line overrides
   * would be wrong.
   */
  recipesPricingOn(key: string): Promise<
    Array<{ id: string; name: string; rows: number; overridden: number }>
  >;
  /**
   * Records a purchase (stage-8 requirements A, C).
   *
   * ONE call, because the append to the history and the update of the active
   * price must both happen or neither: a history that disagrees with the price
   * in effect is worse than no history. `record_purchase` (migration 0013)
   * does both in one transaction.
   *
   * Returns the material as it now stands, so the caller shows the price the
   * DATABASE derived and never one it computed itself.
   */
  recordPurchase(input: PurchaseInput): Promise<CatalogItem>;
  /**
   * The purchases of one material, newest first, each with the change from the
   * one before it (requirement C).
   */
  purchaseHistory(key: string): Promise<PurchaseRecord[]>;
}

/**
 * Production plans (stage 9).
 *
 * A plan holds INTENT only. The requirement, the purchase list, the cost and
 * the timeline are all DERIVED from the recipes and the ingredient centre when
 * the plan is opened — there is no stored copy of any of them, so a plan cannot
 * quietly disagree with today's prices. The single exception is a plan the user
 * marks as done: `setPlanLocked` freezes a snapshot, and a locked plan reads
 * from it. See migration 0018 for why unlocking discards it.
 */
export interface PlanRepository {
  listPlans(): Promise<PlanSummary[]>;
  getPlan(id: string): Promise<ProductionPlan | null>;
  /** Creates or updates, atomically. Returns the plan as it now stands */
  savePlan(plan: ProductionPlan): Promise<ProductionPlan>;
  deletePlan(id: string): Promise<void>;
  /**
   * Marks a plan done, or reopens it.
   *
   * Locking REQUIRES a snapshot: a record of what happened whose costs still
   * move is not a record. Unlocking clears it.
   */
  setPlanLocked(id: string, locked: boolean, snapshot: unknown): Promise<void>;
}

export interface PlanSummary {
  id: string;
  name: string;
  planDate: string;
  locked: boolean;
  items: number;
}

export interface PrefsRepository {
  getPrefs(): Promise<MeasurementPrefs | null>;
  savePrefs(prefs: MeasurementPrefs): Promise<MeasurementPrefs>;
}

/**
 * §8 — personal notes. Separate from `Recipe.notes` in every sense: a private
 * note belongs to the ACCOUNT rather than to the recipe, it never travels with
 * a shared copy, an order sheet or a label, and HANDOFF §3 says no policy, view
 * or report may let anyone else read it — an instructor included.
 *
 * `null` from `getPrivateNote` means there is no note. The empty string is not
 * a note either: saving one removes the row (migration 0022), because for text
 * "empty" and "absent" are the same statement.
 */
export interface PrivateNoteRepository {
  getPrivateNote(recipeId: string): Promise<string | null>;
  savePrivateNote(recipeId: string, body: string): Promise<void>;
}

/**
 * §5 / HANDOFF §7 step 8 — recipe photographs.
 *
 * WHY A URL IS A SEPARATE CALL, AND WHY IT EXPIRES
 *
 * The bucket is PRIVATE (migration 0029), so there is no permanent address for
 * a photo. A viewer needs a signed URL, minted per request and valid for a
 * while, and the signing is itself an authorisation check: the storage policy
 * decides whether this caller may have one. So `signedImageUrl` is not a
 * formatting helper — it is a request that can legitimately fail, and the UI
 * has to be able to show a photo that would not load.
 *
 * WHY UPLOAD TAKES A FILE AND NOT A URL
 *
 * The conversion to WebP happens in the browser (features/images/convert.ts)
 * and the bucket accepts nothing else. Passing an already-converted blob would
 * let a caller skip the conversion, get a 400 from storage, and have no idea
 * why; passing the original file keeps the one code path that knows the rules.
 */
export interface RecipeImage {
  id: string;
  recipeId: string;
  storagePath: string;
  ord: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
  caption: string;
  createdAt: string;
  /**
   * WHERE THE PICTURE IS LOOKED AT — 0..100 per axis, fed straight to CSS
   * `object-position` (migration 0038).
   *
   * The hero is a fixed band with `object-fit: cover`, so the browser crops;
   * without this it crops from the centre, which on a tray shot from above is
   * often nothing. 50/50 is exactly what `cover` does on its own, so a photo
   * nobody has adjusted looks the way it always did.
   *
   * A point and not a rectangle on purpose: the file is never re-encoded, so
   * the original keeps every pixel, the adjustment can be changed again for
   * free, and the same point crops correctly in the wide hero AND in the
   * square notebook thumbnail — which a rectangle cannot do.
   */
  focalX: number;
  focalY: number;
}

export interface RecipeImageRepository {
  listRecipeImages(recipeId: string): Promise<RecipeImage[]>;
  /**
   * Converts, uploads and indexes one photo. Rejects with a message the UI can
   * show when the file cannot be made to fit — see `convertErrorText`.
   */
  addRecipeImage(recipeId: string, file: File | Blob): Promise<RecipeImage>;
  /** Removes the object AND its row. The object goes first — see 0029. */
  removeRecipeImage(image: RecipeImage): Promise<void>;
  /**
   * Moves the focal point. Two numbers, no re-upload, no new object — the
   * picture itself is untouched, so this can be changed as often as somebody
   * likes and never degrades the original.
   *
   * Returns the row as it now stands, so a caller renders what was stored
   * rather than what it hoped was stored.
   */
  setRecipeImageFocus(image: RecipeImage, focal: { x: number; y: number }): Promise<RecipeImage>;
  /**
   * Swaps the picture behind an existing photo for a new file, keeping its
   * place, its caption and its focal point. The new object goes up first, so
   * a failure leaves the old picture exactly where it was.
   */
  replaceRecipeImage(image: RecipeImage, file: File | Blob): Promise<RecipeImage>;
  /**
   * Gives a recipe its own copies of another recipe's photographs — new
   * objects, new rows — so the two can be edited and deleted independently.
   * Used by "שכפול": a duplicate that shared the original's files would lose
   * its pictures the moment the original deleted them.
   *
   * Best effort per picture: the result says how many landed and how many
   * did not, and the caller decides what to tell the person.
   */
  copyRecipeImages(fromRecipeId: string, toRecipeId: string): Promise<{ copied: number; failed: number }>;
  /**
   * A time-limited URL for a private object, or null when one cannot be had.
   * Null is a real answer: the photo exists and this caller may not see it.
   */
  signedImageUrl(storagePath: string): Promise<string | null>;
  /**
   * THE FIRST PHOTOGRAPH OF EACH OF THESE RECIPES, SIGNED, IN ONE ROUND TRIP.
   *
   * For lists. The notebook shows a recipe's own picture on its card, and
   * doing that with `listRecipeImages` + `signedImageUrl` would be two
   * requests per row — a hundred requests for a notebook of fifty recipes,
   * on a phone, to draw fifty thumbnails. This is one select over the rows
   * and one batch of signatures.
   *
   * A recipe with no photograph, or one whose photograph this caller may not
   * see, is simply absent from the result: the caller falls back to whatever
   * it shows when there is no picture, and never to a broken image.
   */
  recipeThumbs(recipeIds: readonly string[]): Promise<Record<string, string>>;
}

/**
 * §10 — groups, courses, lessons, invitations, members and the chat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE IS A PERMISSION DECISION
 *
 * Every method is a request that the database may refuse, and several of them
 * exist precisely BECAUSE they can be refused: `setMemberRole` is not "change
 * this role", it is "ask to change this role", and an admin asking to create
 * another admin gets a 42501 no matter what the UI offered. The role a
 * `GroupSummary` carries is what the database reported, and the UI uses it to
 * decide what to OFFER — never as the check itself.
 *
 * WHY SO MANY OF THESE ARE RPCs RATHER THAN TABLE WRITES
 *
 * Three different reasons, and they are worth telling apart:
 *
 *   · the caller is not a member yet, so no policy can reach the row —
 *     redeeming or declining an invitation, asking to join;
 *   · it is two writes that must not come apart — publishing a recipe into a
 *     lesson (see migration 0036), creating a group with its owner membership;
 *   · it needs to read rows the caller may not select — the roster, which
 *     reaches other people's `profiles` for a name and a picture.
 *
 * Everything else is an ordinary insert, update or delete under RLS.
 *
 * WHAT A LOCAL DEMO SESSION DOES WITH ALL THIS
 *
 * Refuses it, in words. A group is other people; there is no honest way to
 * have one without an account, and a fabricated group list would be exactly
 * the §17 dishonesty this project rules out.
 */
export interface GroupRepository {
  listGroups(): Promise<GroupSummary[]>;
  /** Group plus owner membership in one transaction (`create_group`). */
  createGroup(input: { name: string; kind: string; note: string }): Promise<string>;
  /** The whole §10.3 tree. null = no such group, or not the caller's. */
  getGroup(groupId: string): Promise<GroupDetail | null>;
  updateGroup(
    groupId: string,
    patch: Partial<Pick<GroupSummary, 'name' | 'kind' | 'note' | 'joinBy' | 'code'>>,
  ): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  /** Removes the caller's own membership. The owner cannot — see 0030. */
  leaveGroup(groupId: string): Promise<void>;

  /** Members with the name and picture the chat draws. Never an email address. */
  roster(groupId: string): Promise<GroupMember[]>;
  /** Signed URLs for avatar paths, keyed by path. A path may be missing. */
  avatarUrls(paths: readonly string[]): Promise<Record<string, string>>;
  setMemberRole(groupId: string, userId: string, role: GroupRole): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;

  listInvites(groupId: string): Promise<InviteView[]>;
  /** Returns the TOKEN; the caller builds the link with `inviteLink`. */
  createInvite(groupId: string, email: string | null, label: string): Promise<string>;
  /**
   * Asks the server to email an invitation.
   *
   * A SEPARATE call from `createInvite`, and that is a product decision as
   * much as a technical one: an invitation is usable the moment it exists (the
   * link can be handed over in a lesson), and a creation that failed because a
   * mail service is not configured would be a worse outcome than a link with
   * no email.
   *
   * So this can legitimately answer "not sent", and the caller must SAY so.
   * `reason` is a sentence in Hebrew for the person reading the screen, not a
   * code: "the mail service is not connected yet" is something an instructor
   * can act on by copying the link.
   */
  sendInviteEmail(inviteId: string): Promise<{ sent: boolean; reason?: string }>;
  revokeInvite(inviteId: string): Promise<void>;
  /** Revokes and issues a replacement. Returns the NEW token. */
  resendInvite(inviteId: string): Promise<string>;
  /** Returns the group joined, so the screen can navigate to it. */
  redeemInvite(token: string): Promise<string>;
  rejectInvite(token: string): Promise<void>;

  listJoinRequests(groupId: string): Promise<JoinRequestView[]>;
  /**
   * The caller's OWN requests, across every group.
   *
   * `requests_read` admits `user_id = auth.uid()` as well as the group's
   * staff, so this works for somebody who is not a member of anything — which
   * is the whole point: it is what lets the groups screen say "your request is
   * waiting" after a reload instead of forgetting it happened.
   *
   * It carries no group NAME, because a non-member cannot read the group row
   * and inventing one would be a fabrication. The screen says so.
   */
  myJoinRequests(): Promise<JoinRequestView[]>;
  /** §6: a code creates a REQUEST, never membership. Returns the group NAME. */
  requestJoin(code: string, note: string): Promise<string>;
  approveJoin(groupId: string, userId: string): Promise<void>;
  rejectJoin(groupId: string, userId: string): Promise<void>;
  withdrawJoin(groupId: string): Promise<void>;

  addCourse(groupId: string, name: string): Promise<string>;
  renameCourse(courseId: string, name: string): Promise<void>;
  removeCourse(courseId: string): Promise<void>;
  addLesson(courseId: string, input: { name: string; date: string | null }): Promise<string>;
  updateLesson(
    lessonId: string,
    patch: Partial<Pick<GroupLesson, 'name' | 'date' | 'summary' | 'done'>>,
  ): Promise<void>;
  removeLesson(lessonId: string): Promise<void>;

  /** Marks the caller's own recipe as the group's and adds the item (0036). */
  publishRecipe(lessonId: string, recipeId: string, name: string): Promise<string>;
  /** Removes the item, and un-groups the recipe when it was the last (0036). */
  unpublishItem(itemId: string): Promise<void>;
  setItemPerms(itemId: string, perms: ItemPerms): Promise<void>;
  /** §11. Returns the personal recipe — the existing copy if there is one. */
  saveGroupCopy(itemId: string): Promise<string>;

  /** §8 on a group item. null = no note. */
  getItemNote(itemId: string): Promise<string | null>;
  saveItemNote(itemId: string, body: string): Promise<void>;

  /**
   * One page of history, newest first in the database and oldest-first in the
   * result, because that is reading order.
   *
   * `before` is a `seq` cursor: the page is `seq < before`. Null asks for
   * the newest page. Never OFFSET — a new message shifts every offset by one.
   */
  chatPage(groupId: string, before: number | null, limit: number): Promise<ChatPage>;
  sendMessage(input: {
    groupId: string;
    body: string;
    replyToId?: string | null;
    kind?: 'text' | 'announcement';
  }): Promise<ChatMessage>;
  /** Author only. The database stamps `edited_at` — see 0032. */
  editMessage(messageId: string, body: string): Promise<ChatMessage>;
  /** Soft delete. The author, or rank >= 2. The words move out of reach (0035). */
  deleteMessage(messageId: string): Promise<void>;
  /** The caller's own marker. Only ever moves forward (`greatest`). */
  markGroupRead(groupId: string, seq: number): Promise<void>;
  lastReadSeq(groupId: string): Promise<number>;
  /**
   * Live delivery over Realtime BROADCAST on a private channel.
   *
   * Broadcast rather than Postgres Changes because Supabase's own
   * documentation recommends it for scalability and security, and because RLS
   * is then evaluated once per subscriber at JOIN time instead of per change
   * per subscriber. The table is still the source of truth: a client that was
   * offline catches up with `chatPage`, not by replaying a stream it missed.
   */
  subscribeGroupChat(groupId: string, events: ChatEvents): ChatSubscription;
}

export interface ChatEvents {
  /** an insert or an update — the caller merges by id, newest copy winning */
  onMessage(message: ChatMessage): void;
  onStatus?(status: 'connecting' | 'subscribed' | 'error'): void;
}

export interface ChatSubscription {
  unsubscribe(): void;
}

/**
 * The account's own name and picture (migration 0031).
 *
 * Separate from `PrefsRepository` because it is not a preference: a display
 * name and an avatar are what OTHER PEOPLE see in a group, and the whole
 * reason they exist is that §10.1 will not let a roster or a chat disclose an
 * email address.
 */
export interface IdentityRepository {
  getIdentity(): Promise<{ displayName: string; avatarPath: string | null }>;
  saveDisplayName(name: string): Promise<void>;
  /** Converts to WebP in the browser, uploads, and returns the stored path. */
  setAvatar(file: File | Blob): Promise<string>;
  removeAvatar(): Promise<void>;
  /** A time-limited URL, or null when there is no picture or it cannot be had. */
  avatarUrl(path: string | null): Promise<string | null>;
}

export interface CalibrationRepository {
  listCalibrations(): Promise<Calibration[]>;
  saveCalibrations(list: readonly Calibration[]): Promise<Calibration[]>;
}

export interface Repository
  extends GroupRepository,
    IdentityRepository,
    RecipeImageRepository,
    RecipeRepository,
    PlanRepository,
    PrefsRepository,
    CalibrationRepository,
    PrivateNoteRepository,
    CatalogRepository {
  capabilities(): RepositoryCapabilities;
  /** categories available for the picker (§1.1 `category` comes from CATEGORIES) */
  listCategories(): Promise<readonly string[]>;
}

/**
 * The write SUCCEEDED and the read-back did not.
 *
 * QA 22.09.2026: a save whose follow-up read failed was reported as "the save
 * failed", and the natural next press created a second recipe. The row exists;
 * this says so and carries its id, so the screen can go to it (and the
 * notebook can refetch) instead of inviting a retry.
 */
export class SavedButNotReloadedError extends Error {
  constructor(
    readonly what: string,
    readonly recipeId: string,
    readonly why: unknown,
  ) {
    super(`${what} נשמר, אבל לא הצלחנו לטעון אותו מחדש. הוא במחברת — רענון יציג אותו.`);
    this.name = 'SavedButNotReloadedError';
  }
}

export class WriteNotAllowedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'WriteNotAllowedError';
  }
}

/**
 * A recipe could not be deleted because other recipes use it as a base
 * (stage-6 requirements 1-3).
 *
 * `usedBy` is what the screen needs and the database cannot provide: a foreign
 * key violation says a constraint was violated, not which recipes are holding
 * the thing. The list comes from `recipesUsing`, which is RLS-filtered, so it
 * is everything the caller is allowed to know and nothing more. It can be
 * EMPTY — a dependency may have been added by another tab between the check and
 * the delete — and the message has to survive that case rather than rendering
 * an empty list as though nothing were wrong.
 */
export class RecipeInUseError extends Error {
  constructor(
    readonly usedBy: ReadonlyArray<{ id: string; name: string }>,
    message = 'המתכון הזה משמש כמתכון בסיס, ולכן אי אפשר למחוק אותו.',
  ) {
    super(message);
    this.name = 'RecipeInUseError';
  }
}
