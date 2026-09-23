// The database's shape, as TypeScript.
//
// Hand-written on purpose, and kept that way after the project was provisioned.
// `supabase gen types` widens every CHECK constraint to `string` and every jsonb
// column to `Json`, which throws away exactly the distinctions this app runs on:
// ToolId, PriceUnit, temp_unit 'C' | 'F', and the four density resolution
// states. Those unions are load-bearing, so the narrow version stays.
//
// The safety net for a hand-written file is mechanical, not vigilance:
//   npm run schema:check
// compares the column names and nullability here against
// supabase/schema.snapshot.json, which is read back out of the live database.

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type ProfileKind = 'home' | 'pro' | 'study';
export type Locale = 'he' | 'ar';
export type ToolId = 'cup' | 'tbsp' | 'tsp';
/** Re-exported from the engine so a row type and a domain type cannot drift. */
export type { StepKind } from '@recipe-notebook/engine';
import type { StepKind } from '@recipe-notebook/engine';

export type PriceUnit = 'ק"ג' | 'ליטר' | "יח'";
export type DensityConfidence = 'system' | 'estimate';
export type DensityResolution =
  | 'accepted'
  | 'accepted-single-source'
  | 'pending-verification'
  | 'pending-form';

/**
 * One table's three shapes.
 *
 * A TYPE alias, not an interface, and the same goes for every row type below.
 * postgrest-js constrains a table's Row/Insert/Update to
 * `Record<string, unknown>`; TypeScript gives an object type literal an
 * implicit index signature but gives an interface none. Declared as interfaces,
 * `Database['public']` quietly fails postgrest's `GenericSchema` check, the
 * client's `Schema` parameter resolves to `never`, and every insert and update
 * argument in the repository is rejected as `never` with no hint as to why.
 */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ProfileRow = {
  user_id: string;
  profile: ProfileKind;
  pro: boolean;
  units: string[];
  tools: Partial<Record<ToolId, number>>;
  touched_units: boolean;
  locale: Locale;
  onboarding_done: boolean;
  /*
    §10's chat needs a name and a face.

    Default '', and migration 0031 deliberately does NOT derive one from the
    email address. The local part of an address is not a name anybody chose,
    and putting it in a group roster would disclose most of an address to
    every other member — which is the one thing §10.1 says not to do.

    So '' means "not set yet" and the UI falls back to a neutral label.
  */
  display_name: string;
  /** `{user_id}/{uuid}.webp` in the `avatars` bucket. null = no picture. */
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
};

export type CalibrationRow = {
  id: string;
  user_id: string;
  ingredient_name: string;
  ingredient_key: string;
  tool: ToolId;
  /** engine B5: the tool volume frozen at calibration time */
  tool_ml: number;
  grams: number;
  tool_ml_assumed: boolean;
  created_at: string;
};

export type RecipeRow = {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  category: string;
  tags: string[];
  is_sub: boolean;
  locked: boolean;
  yield_units: number;
  unit_weight: number;
  /** null = theoretical yield, which is not zero (§18.11) */
  yield_actual: number | null;
  weight_before: number | null;
  weight_after: number | null;
  dough_mode: boolean;
  ddt: number | null;
  flour_temp: number | null;
  room_temp: number | null;
  friction: number | null;
  target_fc: number;
  /** stage 7: what the user charges. null = not set; 0 = given away */
  sale_price: number | null;
  /**
   * stage 8: is `sale_price` the price of the whole batch or of one unit?
   * Stored rather than guessed — guessing is the difference between a 5% and a
   * 500% food cost.
   */
  sale_price_basis: 'batch' | 'unit';
  /**
   * stage 8, requirement E: the cost breakdown, ENTERED and never invented.
   * null = not entered; 0 = there is none, and the screen says which.
   */
  packaging_cost: number | null;
  labor_cost: number | null;
  other_cost: number | null;
  /** stage 8, requirement G: a target gross margin, in percent. < 100 */
  target_gm: number | null;
  shelf_life: string;
  storage: string;
  freezing: string;
  thawing: string;
  equipment: string;
  notes: string;
  manual_allergens: string[];
  pan: Json | null;
  version_of: string | null;
  version_note: string;
  saved_from_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IngredientRow = {
  id: string;
  recipe_id: string;
  ord: number;
  name: string;
  ingredient_key: string | null;
  qty: number;
  unit: string;
  flour: boolean;
  liquid: boolean;
  /** null = use the shared water table; not 0 */
  water_pct: number | null;
  unit_weight: number | null;
  /** §5.1 precedence rank 2 */
  g_per_100: number | null;
  price: number | null;
  price_unit: PriceUnit | null;
  sub_recipe_id: string | null;
  note: string;
};

export type StepRow = {
  id: string;
  recipe_id: string;
  ord: number;
  text: string;
  temp: number | null;
  temp_unit: 'C' | 'F';
  minutes: number | null;
  /** stage 9: null = nobody classified this step. See migration 0018 */
  kind: StepKind | null;
};

export type IssueRow = {
  id: string;
  recipe_id: string;
  ord: number;
  problem: string;
  solution: string;
};

export type TrialRow = {
  id: string;
  recipe_id: string;
  date: string | null;
  note: string;
};

export type BatchRow = {
  id: string;
  recipe_id: string;
  code: string;
  date: string | null;
  core_temp: number | null;
  /** §13a: null is not an excursion — an empty field is not a measurement */
  chill_temp: number | null;
  weight: number | null;
  owner: string;
  note: string;
  ccp: Record<string, boolean>;
  /** §13a REQUIRES BACKEND: private bucket path */
  photo_path: string | null;
  /** §13a: set by the server. A user-editable timestamp is worthless in an audit. */
  taken_at: string | null;
  created_at: string;
};

export type RecipeVersionRow = {
  id: string;
  recipe_id: string;
  tag: string;
  what: string;
  snapshot: Json;
  created_at: string;
  created_by: string | null;
};

export type PrivateNoteRow = {
  id: string;
  user_id: string;
  recipe_id: string | null;
  group_item_id: string | null;
  body: string;
  updated_at: string;
};

/** What a material is bought in. Not everything is bought by the kilogram. */
export type PurchaseUnit = 'kg' | 'g' | 'l' | 'ml' | 'unit';

export type IngredientCatalogRow = {
  id: string;
  owner_id: string | null;
  group_id: string | null;
  key: string;
  name: string;
  /** what was actually bought — the source of truth for the price (0011) */
  purchase_unit: PurchaseUnit;
  /** how much is in ONE package, in `purchase_unit`. null = unknown */
  package_qty: number | null;
  /** how many packages were bought. 6 packs of 500 g is `6` (0013) */
  package_count: number;
  /** what the whole purchase cost. null = unpriced; 0 = free, and they differ */
  purchase_total: number | null;
  /**
   * usable share after cleaning/trimming, in percent. null = nobody declared a
   * yield, and then the usable cost IS the purchase cost — it is NOT 0% (0013).
   */
  usable_pct: number | null;
  supplier: string;
  /** the date of the purchase, as the user entered it (0013) */
  purchased_at: string | null;
  /** stamped only when the package actually changes — see 0011 */
  price_updated_at: string | null;
  note: string;
  /**
   * GENERATED STORED in the database, from the purchase above. Read-only: an
   * insert or update that includes any of these is rejected by Postgres,
   * which is the point — they cannot drift from the purchase they came from.
   *
   * `purchase_price` is the cost per base unit AS BOUGHT; `price` is the cost
   * per USABLE base unit, and it is the one the engine reads. With no declared
   * yield the two are the same number.
   */
  purchase_price: number | null;
  price: number | null;
  price_unit: PriceUnit | null;
  g_per_100: number | null;
  water_pct: number | null;
  allergens: string[];
  created_at: string;
  updated_at: string;
};

/**
 * The columns a client may actually write. `purchase_price`, `price` and
 * `price_unit` are generated, so they are absent here on purpose — the type is
 * what stops a caller trying.
 */
export type IngredientCatalogWrite = Omit<
  IngredientCatalogRow,
  | 'id'
  | 'purchase_price'
  | 'price'
  | 'price_unit'
  | 'created_at'
  | 'updated_at'
  | 'price_updated_at'
>;

/**
 * One recorded purchase (migration 0013, requirement C). Append-only: a new
 * price never overwrites the previous one, it is a new row here, and the
 * ACTIVE price is unambiguously the `ingredient_catalog` row.
 *
 * Keyed by `key`, not by catalog id, so a purchase survives the material
 * being renamed or re-created.
 */
export type IngredientPurchaseRow = {
  id: string;
  owner_id: string;
  key: string;
  purchase_unit: PurchaseUnit;
  package_count: number;
  package_qty: number | null;
  purchase_total: number | null;
  usable_pct: number | null;
  supplier: string;
  purchased_at: string;
  note: string;
  created_at: string;
  /** GENERATED STORED, exactly as in the catalog */
  purchase_price: number | null;
  price: number | null;
};

export type DensityTableRow = {
  key: string;
  match_terms: string[];
  exclude_terms: string[];
  word_match: boolean;
  /** null when no value may be used yet — see CONFLICTS.md */
  g_per_100: number | null;
  confidence: DensityConfidence;
  resolution: DensityResolution;
  note: string;
  sources: Record<string, number>;
  needs_review: boolean;
  review_note: string;
  forms: string[];
  ord: number;
  updated_at: string;
};

/**
 * A production plan (migration 0018). It holds INTENT only — the requirement,
 * the purchase list and the cost are derived from the recipes and the
 * ingredient centre every time the plan is opened.
 */
/* ── §10 groups, courses, lessons and items (migrations 0023-0026) ───────── */

/**
 * The four roles, in the order `role_rank` ranks them (migration 0030):
 * owner 4, admin 3, instructor 2, member 1.
 *
 * `admin` was added in 0030. Before it there was no way to let somebody run
 * a group — invite, approve, remove — without handing them the group itself,
 * and "owner or nothing" is how groups end up with three owners. The rank is
 * what every policy compares; the names are only labels for it.
 */
export type GroupRole = 'owner' | 'admin' | 'instructor' | 'member';

/** §10.2's four ways in. Stored as a text[] so a group can accept a subset. */
export type JoinMethod = 'invite' | 'link' | 'code' | 'request';

export type GroupRow = {
  id: string;
  name: string;
  kind: string;
  /**
   * §10.2: private by default, and the column is CHECKed to this one value.
   * Nothing implements a public group — no policy admits a non-member and
   * there is no discovery path — so the type says so rather than leaving a
   * `string` that looks like it could hold something else.
   */
  privacy: 'private';
  /**
   * The join code. §6: it is NOT a credential — it creates a REQUEST that an
   * admin approves. Nullable because a group that does not accept a code
   * should not carry one that works.
   */
  code: string | null;
  join_by: JoinMethod[];
  owner_id: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export type GroupMemberRow = {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
};

export type CourseRow = {
  id: string;
  group_id: string;
  name: string;
  ord: number;
};

export type LessonRow = {
  id: string;
  course_id: string;
  name: string;
  /** A calendar date: "the lesson on 18.9" is the same lesson in every zone. */
  date: string | null;
  summary: string;
  done: boolean;
  ord: number;
};

/**
 * §10.4 — the five per-recipe permissions.
 *
 * Five booleans rather than one jsonb `perms`, because a default belongs in the
 * column: a jsonb object arriving without a key would have to be interpreted by
 * every reader, and the first reader to read a missing `perm_save` as `true`
 * hands out a recipe the instructor never released. The database defaults are
 * the spec's: view true, everything else false.
 */
export type GroupRecipeItemRow = {
  id: string;
  lesson_id: string;
  recipe_id: string;
  name: string;
  ord: number;
  perm_view: boolean;
  perm_save: boolean;
  perm_print: boolean;
  perm_download: boolean;
  perm_share_out: boolean;
  created_at: string;
};

/* ── §10.2 joining a group (migration 0027) ──────────────────────────────── */

/**
 * An invitation. §6: single use, seven days, both checked server-side.
 *
 * `token` is stored in plaintext, which is not the usual advice for a bearer
 * token. Migration 0027 has the reasoning: without a mail service the only way
 * an invitation reaches anyone is the instructor copying the link and sending
 * it themselves, so the link has to be readable again afterwards. If a mailer
 * is added, this should become a hash.
 */
/**
 * The four states an invitation is STORED in. `expired` is not among them on
 * purpose: expiry is a fact about the clock, not a transition anybody
 * performs, so it is derived by `invite_state` rather than written by a job
 * that might not run. See migration 0030.
 */
export type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'revoked';

/** What `invite_state` answers: the stored status, or the derived expiry. */
export type InviteState = InviteStatus | 'expired';

export type GroupInviteRow = {
  id: string;
  group_id: string;
  /**
   * A free-text note for the inviter's own list ("the Tuesday group"). Never
   * a check — see `email` for the thing that is one.
   */
  label: string;
  /**
   * Who it was issued to, normalised (trimmed and lower-cased) by
   * `normalize_email`. Since 0031 this IS a check: `redeem_group_invite`
   * compares it against `auth.email()` and refuses a mismatch, so a leaked
   * link cannot be used by whoever ends up holding it.
   *
   * Null = an open link, the 0027 behaviour, kept because an invitation the
   * instructor hands out in a lesson has no address to bind to.
   */
  email: string | null;
  status: InviteStatus;
  token: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  /**
   * "Resend" issues a NEW invitation with a new token and revokes the old
   * one, rather than extending the old row. The old link must stop working —
   * that is the whole point of being able to resend — and this column keeps
   * the chain readable afterwards.
   */
  replaces_id: string | null;
};

/**
 * A pending request to join, from the §10.2 code path.
 *
 * Its own table rather than a `status` column on `group_members`, because a
 * row here grants NOTHING: no policy anywhere references this table, so there
 * is no `and status = 'active'` for a future policy to forget. See 0027.
 */
/**
 * `accepted` is absent, and that is the design: approving a request creates
 * the membership and DELETES the request row, so there is never a row that
 * says "accepted" next to a membership that might not exist. See 0031's
 * `approve_group_join`.
 */
export type JoinRequestStatus = 'pending' | 'rejected' | 'withdrawn';

export type GroupJoinRequestRow = {
  id: string;
  group_id: string;
  user_id: string;
  note: string;
  status: JoinRequestStatus;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
};

/* ── group chat (migration 0032) ─────────────────────────────────────────── */

/**
 * `system` is a legal value the client can never write — 0032's insert guard
 * refuses it — so a "X joined the group" line can be added later by a trigger
 * without a message that only looks official.
 */
export type MessageKind = 'text' | 'announcement' | 'system';

export type GroupMessageRow = {
  id: string;
  /**
   * The total order the chat pages on. `bigint` in the database; it arrives
   * as a NUMBER here because PostgREST serialises int8 as a JSON number, and
   * the sequence would have to pass 2^53 for that to matter.
   *
   * Pagination is `seq < cursor order by seq desc`, never OFFSET: a new
   * message shifts every offset by one and the page boundary duplicates or
   * skips a row. See the header of 0032.
   */
  seq: number;
  group_id: string;
  /** Reserved for multiple channels and DMs. null = the group's main channel. */
  channel_id: string | null;
  author_id: string;
  body: string;
  kind: MessageKind;
  /** null = not a reply. Survives its parent's soft delete by design. */
  reply_to_id: string | null;
  /** Stamped by the database on an author's edit, never sent by the client. */
  edited_at: string | null;
  /**
   * Soft delete, because a reply points at a message: a hard delete would
   * take the answers with the question. A deleted row keeps its `seq` and
   * its place in the thread, and the client renders a tombstone.
   */
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
};

/**
 * One row per person per group, holding the highest `seq` they have seen.
 *
 * A `seq` and not a timestamp: "after the last message I read" is exact,
 * while "after the time I last read" is wrong by however long the write took.
 */
export type GroupMessageReadRow = {
  group_id: string;
  user_id: string;
  last_read_seq: number;
  updated_at: string;
};

/**
 * The text of a deleted message (migration 0035).
 *
 * A soft delete used to leave the body in the message row, where
 * `messages_read` — which has no condition on `deleted_at` — let any member
 * read it straight from the API, and where the delete's own broadcast carried
 * it to every open client. So the words move here, where only rank >= 2 may
 * read them, and the message keeps an empty body.
 *
 * Typed because it is part of the schema and `schema:check` requires every
 * table to be. NOTHING IN THE APP READS IT YET: the accountability view for a
 * moderator is not built, and a screen that showed removed text would need its
 * own thought about who is looking at the phone.
 */
export type GroupMessageRemovalRow = {
  message_id: string;
  group_id: string;
  body: string;
  /** null once the account that removed it is deleted (ON DELETE SET NULL) */
  removed_by: string | null;
  removed_at: string;
};

/* ── §5 recipe photographs (migration 0029) ──────────────────────────────── */

/**
 * The index of what is in the private bucket.
 *
 * `storage_path` is `{recipe_id}/{uuid}.webp`, and the leading segment is load
 * bearing: 0029's storage policies read the recipe id out of it to decide
 * access. A path built any other way is refused by the database.
 */
export type RecipeImageRow = {
  id: string;
  recipe_id: string;
  storage_path: string;
  ord: number;
  /** what the client measured after conversion; null is allowed */
  width: number | null;
  height: number | null;
  bytes: number | null;
  caption: string;
  /** 0..100 per axis, fed to CSS object-position — migration 0038. */
  focal_x: number;
  focal_y: number;
  created_at: string;
  created_by: string | null;
};

export type ProductionPlanRow = {
  id: string;
  owner_id: string;
  name: string;
  plan_date: string;
  note: string;
  /**
   * Requirement 14. A locked plan is a record of what happened, and its
   * snapshot is what is read; an unlocked plan has no snapshot and is
   * computed live. The two always move together.
   */
  locked: boolean;
  locked_at: string | null;
  snapshot: Json | null;
  created_at: string;
  updated_at: string;
};

export type PlanQtyUnit = 'unit' | 'kg' | 'g';

export type ProductionPlanItemRow = {
  id: string;
  plan_id: string;
  recipe_id: string;
  ord: number;
  qty: number;
  qty_unit: PlanQtyUnit;
  /** the hour the product must be READY. null = the user did not say */
  ready_at: string | null;
  note: string;
};

export type ProductionPlanStockRow = {
  id: string;
  plan_id: string;
  key: string;
  /** null = not entered. 0 = there is none left. NOT the same thing */
  on_hand: number | null;
};

export type Database = {
  /**
   * supabase-js reads this to pick its PostgREST behaviour. It is part of the
   * generated shape, so it is part of this one.
   */
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      calibrations: Table<CalibrationRow>;
      recipes: Table<RecipeRow>;
      ingredients: Table<IngredientRow>;
      steps: Table<StepRow>;
      issues: Table<IssueRow>;
      trials: Table<TrialRow>;
      batches: Table<BatchRow>;
      recipe_versions: Table<RecipeVersionRow>;
      private_notes: Table<PrivateNoteRow>;
      ingredient_catalog: Table<IngredientCatalogRow>;
      ingredient_purchases: Table<IngredientPurchaseRow>;
      production_plans: Table<ProductionPlanRow>;
      production_plan_items: Table<ProductionPlanItemRow>;
      production_plan_stock: Table<ProductionPlanStockRow>;
      density_table: Table<DensityTableRow>;
      density_data_gaps: Table<{ name: string }>;
      groups: Table<GroupRow>;
      group_members: Table<GroupMemberRow>;
      courses: Table<CourseRow>;
      lessons: Table<LessonRow>;
      group_recipe_items: Table<GroupRecipeItemRow>;
      group_invites: Table<GroupInviteRow>;
      group_join_requests: Table<GroupJoinRequestRow>;
      group_messages: Table<GroupMessageRow>;
      group_message_reads: Table<GroupMessageReadRow>;
      group_message_removals: Table<GroupMessageRemovalRow>;
      recipe_images: Table<RecipeImageRow>;
    };
    // Empty MAPPED types, not `Record<string, never>`. Record<string, never>
    // says every possible name is a view whose row type is `never`, so
    // `from('recipes')` resolves against Views instead of Tables and every
    // insert argument collapses to `never`.
    Views: { [_ in never]: never };
    Functions: {
      owns_recipe: { Args: { p_recipe_id: string }; Returns: boolean };
      /*
        migration 0023/0024/0026 — §10 groups.

        `create_group` exists because a group is TWO rows: the group and its
        owner's membership. Two requests from the browser can fail between
        them and leave a group its creator cannot see, edit or delete.

        The three rank helpers are NOT declared here. They are called by RLS
        policies, not by this app, and the grant they need is documented in
        supabase/scripts/check-types-against-schema.mjs.
      */
      create_group: {
        Args: { p_name: string; p_kind: string; p_note: string };
        Returns: string;
      };
      /*
        migration 0027 — §10.2 joining, and §11's copy.

        Every comment here sits ABOVE its entry, never between `Args` and
        `Returns`: check-types-against-schema.mjs reads this block with a
        regex, and a comment inside an entry makes it run on into the next one
        and report an argument list stitched from both.

        create_group_invite     → the token; the caller builds the link
        redeem_group_invite     → the group joined, so the UI can navigate
        request_group_join      → §6: a REQUEST, never membership. Returns the
                                  group's NAME, so the person can see what they
                                  asked to join.
        approve_group_join      → void; staff only, and only for someone who
                                  actually asked
        save_group_recipe_copy  → §11, and HANDOFF §4 requires it server-side
                                  because a client-side perm_save check is UX
                                  only. Returns the new recipe, or the existing
                                  copy when there already was one.
      */
      create_group_invite: {
        Args: { p_group_id: string; p_email: string | null; p_label: string };
        Returns: string;
      };
      redeem_group_invite: { Args: { p_token: string }; Returns: string };
      request_group_join: { Args: { p_code: string; p_note: string }; Returns: string };
      approve_group_join: {
        Args: { p_group_id: string; p_user_id: string };
        Returns: undefined;
      };
      save_group_recipe_copy: { Args: { p_item_id: string }; Returns: string };
      /*
        migrations 0030/0031 — the invitation lifecycle and the roster.

        revoke_group_invite   → void. Kills the token now; the row stays, so
                                the list still shows what was sent to whom.
        resend_group_invite   → the NEW token. Revokes the old invitation and
                                issues a replacement rather than extending it,
                                because a resend has to make the old link stop
                                working.
        reject_group_invite   → void. "Not me / no thanks", from the invitee.
                                Definer like redemption, and for the same
                                reason: the person is not a member yet, so no
                                policy can reach the row.
        reject_group_join     → void. Staff decline a request; the row stays
                                with status 'rejected' so the same person
                                asking again is visibly a second attempt.
        withdraw_group_join   → void. The asker takes it back themselves.
        group_roster          → the members, with the name and picture the
                                chat draws. NO EMAIL ADDRESSES: §10.1 says an
                                address must not be disclosed, and a roster
                                read by every member is exactly where that
                                would leak. display_name and avatar_path are
                                nullable because the join to profiles is a
                                LEFT join — a member whose profile row was
                                never created still belongs in the list.
      */
      revoke_group_invite: { Args: { p_invite_id: string }; Returns: undefined };
      resend_group_invite: { Args: { p_invite_id: string }; Returns: string };
      reject_group_invite: { Args: { p_token: string }; Returns: undefined };
      reject_group_join: {
        Args: { p_group_id: string; p_user_id: string };
        Returns: undefined;
      };
      withdraw_group_join: { Args: { p_group_id: string }; Returns: undefined };
      group_roster: {
        Args: { p_group_id: string };
        Returns: Array<{
          user_id: string;
          display_name: string | null;
          avatar_path: string | null;
          role: GroupRole;
          rank: number;
          joined_at: string;
        }>;
      };
      /*
        migration 0032 — the chat's two aggregate reads.

        group_unread_counts  → one row per group the caller is in. `unread`
                               counts messages above their last-read `seq`,
                               computed in the database because doing it in
                               the browser means downloading the messages you
                               have not read in order to count them.
        mark_group_read      → void, and it only ever moves the marker
                               FORWARD (`greatest`), so a stale client that
                               reports an old seq cannot un-read a
                               conversation the person already saw elsewhere.
      */
      group_unread_counts: {
        Args: Record<string, never>;
        Returns: Array<{ group_id: string; unread: number; last_seq: number }>;
      };
      mark_group_read: { Args: { p_group_id: string; p_seq: number }; Returns: undefined };
      // migration 0007 — the atomic write paths (§9, stage-5 requirement 9)
      save_recipe: {
        Args: {
          p_recipe: Json;
          p_ingredients: Json;
          p_steps: Json;
          p_issues: Json;
          p_recipe_id: string | null;
          p_expected_updated_at: string | null;
          p_version_note: string;
        };
        Returns: string;
      };
      restore_recipe_version: { Args: { p_version_id: string }; Returns: string };
      recipes_using: {
        Args: { p_recipe_id: string };
        Returns: Array<{ id: string; name: string }>;
      };
      recipe_snapshot: { Args: { p_recipe_id: string }; Returns: Json };
      next_version_tag: { Args: { p_recipe_id: string }; Returns: string };
      // migration 0009 — stage-6 requirements 1-6. Returns void; the refusal is
      // an error with code 23503, not a value.
      delete_recipe: { Args: { p_recipe_id: string }; Returns: undefined };
      // migration 0011 — which of the caller's recipes a price change moves
      recipes_pricing_on: {
        Args: { p_key: string };
        Returns: Array<{ id: string; name: string; rows: number; overridden: number }>;
      };
      // migration 0013 — the purchase as it was actually made (requirements A, C)
      record_purchase: {
        Args: {
          p_key: string;
          p_name: string;
          p_purchase_unit: PurchaseUnit;
          p_package_count: number;
          p_package_qty: number | null;
          p_purchase_total: number | null;
          p_usable_pct: number | null;
          p_supplier: string;
          p_purchased_at: string | null;
          p_note: string;
        };
        Returns: string;
      };
      purchase_history: {
        Args: { p_key: string };
        Returns: Array<{
          id: string;
          purchased_at: string;
          supplier: string;
          purchase_unit: PurchaseUnit;
          package_count: number;
          package_qty: number | null;
          purchase_total: number | null;
          usable_pct: number | null;
          purchase_price: number | null;
          price: number | null;
          /** the USABLE price of the purchase before this one. null = the first */
          prev_price: number | null;
          /** null when there is no previous price, or it was 0 (no ratio) */
          pct_change: number | null;
        }>;
      };
      purchase_base_qty: {
        Args: { p_unit: PurchaseUnit; p_count: number; p_qty: number | null };
        Returns: number | null;
      };
      // migration 0014 — an internal helper of save_recipe/restore_recipe_version
      apply_recipe_costing: { Args: { p_id: string; p_recipe: Json }; Returns: undefined };
      // migration 0018 — production planning (stage-9 requirements 1, 13, 14)
      owns_plan: { Args: { p_plan_id: string }; Returns: boolean };
      save_production_plan: {
        Args: {
          p_plan: Json;
          p_items: Json;
          p_stock: Json;
          p_plan_id: string | null;
          p_expected_updated_at: string | null;
        };
        Returns: string;
      };
      set_plan_locked: {
        Args: { p_plan_id: string; p_locked: boolean; p_snapshot: Json | null };
        Returns: undefined;
      };
      delete_production_plan: { Args: { p_plan_id: string }; Returns: undefined };
      /*
        migration 0036 — teaching, and §8 on a group item.

        publish_recipe_to_lesson      → the new item's id. ONE call because
                                        0025's invariant makes it two writes:
                                        the recipe has to be marked as the
                                        group's and the item has to point at
                                        it. Split across two client calls, a
                                        failure between them leaves a recipe
                                        that refuses to change group for a
                                        reason nobody can see.
        unpublish_recipe_from_lesson  → void. Removes the item, and hands the
                                        recipe back to the personal notebook
                                        when it was the last one.
        save_item_note                → void. `save_private_note` cannot serve
                                        this: it refuses a recipe the caller
                                        does not own, which is what a group
                                        recipe is. So the note hangs off the
                                        ITEM and stays as private as ever.
      */
      publish_recipe_to_lesson: {
        Args: { p_lesson_id: string; p_recipe_id: string; p_name: string | null };
        Returns: string;
      };
      unpublish_recipe_from_lesson: { Args: { p_item_id: string }; Returns: undefined };
      save_item_note: { Args: { p_item_id: string; p_body: string }; Returns: undefined };
      /** §8, migration 0022. An empty body removes the note. */
      save_private_note: {
        Args: { p_recipe_id: string; p_body: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
