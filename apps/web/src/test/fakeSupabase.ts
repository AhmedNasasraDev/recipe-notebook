// An in-memory stand-in for the Supabase client.
//
// Why this exists: this environment's egress policy blocks *.supabase.co, so no
// test here can reach the real project. The isolation proof against the live
// database is supabase/tests/rls-isolation.sql, run through the management API
// and reported in the stage-3 report. These tests cover the OTHER half — that
// the repository issues correctly scoped queries and maps rows faithfully — and
// for that a double is actually better than a live database, because a test can
// assert on the queries themselves.
//
// It is not a PostgREST reimplementation. It supports exactly the query shapes
// data/supabaseRepository.ts uses, and throws on anything else rather than
// silently returning an empty result — a test must never pass because the
// double quietly did nothing.
//
// It DOES emulate the row-level policies from migrations 0001-0004, one function
// per table, mirroring the SQL. That makes a test like "user A's repository
// cannot read user B's recipe" meaningful: remove the `.eq('owner_id', userId)`
// from the repository and `policyFor` still hides the row, which is the property
// the real system has.

export type Row = Record<string, unknown>;
export type FakeDb = Record<string, Row[]>;

export interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface FakeResult<T> {
  data: T;
  error: PostgrestLikeError | null;
}

/** Everything a test may want to know about what the repository actually did. */
export interface FakeLog {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  select?: string | undefined;
  filters: [string, unknown][];
  rowsIn?: number | undefined;
  rowsOut?: number;
}

export interface FakeSupabaseOptions {
  db: FakeDb;
  /** the signed-in user, as `auth.uid()` would report it; null means anonymous */
  authUid: string | null;
  /** forces every request to fail, for the offline-fallback paths */
  failWith?: PostgrestLikeError | null;
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${++idCounter}`;

/** Resets the id sequence so ids are stable within one test. */
export function resetFakeIds(): void {
  idCounter = 0;
}

// ── the emulated policies ──────────────────────────────────────────────────
// One entry per table with RLS enabled. Each mirrors the USING clause of the
// policy in supabase/migrations.

type Policy = (row: Row, uid: string | null, db: FakeDb) => boolean;

const ownsRecipe: Policy = (row, uid, db) => {
  if (!uid) return false;
  const parent = (db['recipes'] ?? []).find((r) => r['id'] === row['recipe_id']);
  return parent?.['owner_id'] === uid;
};

/** `owns_plan(plan_id)`, migration 0018. */
const ownsPlan: Policy = (row, uid, db) => {
  if (!uid) return false;
  const parent = (db['production_plans'] ?? []).find((p) => p['id'] === row['plan_id']);
  return parent?.['owner_id'] === uid;
};

const POLICIES: Record<string, Policy> = {
  // profiles_own / calibrations_own / private_notes_own: user_id = auth.uid()
  profiles: (row, uid) => Boolean(uid) && row['user_id'] === uid,
  calibrations: (row, uid) => Boolean(uid) && row['user_id'] === uid,
  private_notes: (row, uid) => Boolean(uid) && row['user_id'] === uid,
  // recipes_own: owner_id = auth.uid()
  recipes: (row, uid) => Boolean(uid) && row['owner_id'] === uid,
  // the five child tables: public.owns_recipe(recipe_id)
  ingredients: ownsRecipe,
  steps: ownsRecipe,
  issues: ownsRecipe,
  trials: ownsRecipe,
  batches: ownsRecipe,
  recipe_versions: ownsRecipe,
  // ingredient_catalog_read / _write (0003): own rows, plus system rows with a
  // NULL owner readable by anyone signed in. Write is own rows only, which is
  // what keeps one account's prices and suppliers out of another's reach.
  ingredient_catalog: (row, uid) =>
    Boolean(uid) && (row['owner_id'] === uid || row['owner_id'] === null),
  // ingredient_purchases_own (0013): own rows ONLY, with no system-row
  // exception. A purchase total and a supplier are private business data, and
  // there is no such thing as a shared one.
  ingredient_purchases: (row, uid) => Boolean(uid) && row['owner_id'] === uid,
  // production_plans_own / _via_plan (0018): a plan is the account's own, and
  // its children are reached only through it — the same shape as a recipe's.
  production_plans: (row, uid) => Boolean(uid) && row['owner_id'] === uid,
  production_plan_items: ownsPlan,
  production_plan_stock: ownsPlan,
  // shared reference data: SELECT to authenticated, and no write policy at all
  density_table: (_row, uid) => Boolean(uid),
  density_data_gaps: (_row, uid) => Boolean(uid),
};

const READ_ONLY_TABLES = new Set(['density_table', 'density_data_gaps']);

/**
 * Columns the DATABASE computes, recomputed here after every write.
 *
 * `ingredient_catalog.price` and `price_unit` are GENERATED STORED columns
 * (migration 0011), derived from the package. Modelling them matters for a
 * reason beyond fidelity: a double that simply stored whatever the client sent
 * would let a test pass on a price the real database would have recomputed —
 * and the per-base-unit conversion (a 200 g pack at ₪8.90 is ₪44.50/kg) is
 * exactly the arithmetic worth getting wrong.
 *
 * It also keeps NULL and 0 apart, which is the whole point: no package price
 * gives NO unit price, and a package price of 0 gives a unit price of 0.
 */
function generated(table: string, row: Row): Row {
  if (table !== 'ingredient_catalog' && table !== 'ingredient_purchases') return {};

  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  const qty = num(row['package_qty']);
  const count = num(row['package_count']) ?? 1;
  const total = num(row['purchase_total']);
  const usable = num(row['usable_pct']);
  const none = { purchase_price: null, price: null, price_unit: null };

  if (total === null || qty === null || qty <= 0 || count <= 0) return none;
  if (usable !== null && (usable <= 0 || usable > 100)) return none;

  let base: number;
  let unit: string;
  switch (row['purchase_unit']) {
    case 'kg':
      base = count * qty;
      unit = 'ק"ג';
      break;
    case 'g':
      base = (count * qty) / 1000;
      unit = 'ק"ג';
      break;
    case 'l':
      base = count * qty;
      unit = 'ליטר';
      break;
    case 'ml':
      base = (count * qty) / 1000;
      unit = 'ליטר';
      break;
    case 'unit':
      base = count * qty;
      unit = "יח'";
      break;
    default:
      return none;
  }
  if (base <= 0) return none;

  const purchase = total / base;
  return {
    purchase_price: purchase,
    // The USABLE cost — what a recipe's quantities actually refer to. With no
    // declared yield it is the same number, not zero.
    price: purchase / ((usable ?? 100) / 100),
    price_unit: unit,
  };
}

/**
 * Column defaults the database fills in on INSERT.
 *
 * Without these the double hands back rows that no real Postgres would produce
 * — a `recipes` row with no `created_at`, for instance — and a test then fails
 * for a reason that could never happen in production. Modelling the defaults
 * keeps the double honest in the other direction too: it cannot excuse a mapper
 * that depends on a column the schema does not guarantee.
 */
const INSERT_DEFAULTS: Record<string, () => Row> = {
  recipes: () => ({ created_at: NOW, updated_at: NOW }),
  profiles: () => ({ created_at: NOW, updated_at: NOW }),
  calibrations: () => ({ created_at: NOW }),
  private_notes: () => ({ updated_at: NOW }),
  recipe_versions: () => ({ created_at: NOW }),
  batches: () => ({ created_at: NOW }),
  ingredient_catalog: () => ({
    created_at: NOW,
    updated_at: NOW,
    purchase_unit: 'kg',
    supplier: '',
    note: '',
    allergens: [],
    g_per_100: null,
    water_pct: null,
    group_id: null,
    // Stamped by the 0011 trigger when a package is priced.
    price_updated_at: NOW,
    package_count: 1,
    usable_pct: null,
    purchased_at: null,
  }),
  ingredient_purchases: () => ({
    created_at: NOW,
    supplier: '',
    note: '',
    package_count: 1,
    usable_pct: null,
  }),
  production_plans: () => ({
    created_at: NOW,
    updated_at: NOW,
    name: '',
    note: '',
    locked: false,
    locked_at: null,
    snapshot: null,
  }),
  production_plan_items: () => ({
    ord: 0,
    qty_unit: 'unit',
    ready_at: null,
    note: '',
  }),
  production_plan_stock: () => ({ on_hand: null }),
};

const NOW = '2026-04-01T12:00:00Z';

const RLS_DENIED: PostgrestLikeError = {
  message: 'new row violates row-level security policy',
  code: '42501',
};

/**
 * `ingredients (*)` inside a select string — the nested-embed syntax.
 *
 * A child may name its foreign key, `ingredients!ingredients_recipe_id_fkey (*)`,
 * which is how PostgREST is told which of two keys to follow. The hint is
 * dropped here: this double joins every child on CHILD_FK, so the table name
 * is all it needs, and the response key is the table name either way.
 */
function embeddedTables(select: string | undefined): string[] {
  if (!select) return [];
  // Any column list, not just `(*)`: the plans list embeds
  // `production_plan_items (id)` purely to count them.
  return [...select.matchAll(/(\w+)(?:!\w+)?\s*\(\s*[^()]*\)/g)].map((m) => m[1]!);
}

/**
 * Which column an embedded child joins on.
 *
 * PostgREST reads this from the foreign key; here it is declared, because a
 * child table that joined on the wrong column would silently return nothing
 * and a test would read that as "the plan has no lines".
 */
const CHILD_FK: Readonly<Record<string, string>> = {
  recipes: 'recipe_id',
  production_plans: 'plan_id',
};

export interface FakeSupabase {
  client: unknown;
  db: FakeDb;
  log: FakeLog[];
  /** swap the signed-in user, for the two-user isolation tests */
  setAuthUid(uid: string | null): void;
  setFailWith(error: PostgrestLikeError | null): void;
}

export function createFakeSupabase(opts: FakeSupabaseOptions): FakeSupabase {
  const db = opts.db;
  const log: FakeLog[] = [];
  let authUid = opts.authUid;
  let failWith = opts.failWith ?? null;

  const visible = (table: string, rows: Row[]): Row[] => {
    const policy = POLICIES[table];
    if (!policy) return rows; // a table with RLS off would be a bug, not a default
    return rows.filter((r) => policy(r, authUid, db));
  };

  const matches = (row: Row, filters: [string, unknown][]): boolean =>
    filters.every(([col, val]) => row[col] === val);

  class Builder implements PromiseLike<FakeResult<unknown>> {
    private op: FakeLog['op'] = 'select';
    private selectStr: string | undefined;
    private filters: [string, unknown][] = [];
    private payload: Row | Row[] | null = null;
    private cardinality: 'many' | 'one' | 'maybe' = 'many';
    private orderBy: { column: string; ascending: boolean } | null = null;

    private conflictOn: string[] = ['id'];

    constructor(private table: string) {}

    select(cols?: string): this {
      // `.select()` after an insert is a RETURNING clause, not a new query
      if (this.op === 'select') this.op = 'select';
      this.selectStr = cols ?? '*';
      return this;
    }
    insert(payload: Row | Row[]): this {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }
    /**
     * `upsert` with an `onConflict` key, which is how the catalog is written.
     * Modelled as a real upsert rather than an insert, because "save this
     * material again" is the ordinary case and an insert would collide.
     */
    upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
      this.op = 'upsert';
      this.payload = payload;
      this.conflictOn = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
      return this;
    }
    update(payload: Row): this {
      this.op = 'update';
      this.payload = payload;
      return this;
    }
    delete(): this {
      this.op = 'delete';
      return this;
    }
    eq(column: string, value: unknown): this {
      this.filters.push([column, value]);
      return this;
    }
    order(column: string, o?: { ascending?: boolean }): this {
      this.orderBy = { column, ascending: o?.ascending !== false };
      return this;
    }
    single(): this {
      this.cardinality = 'one';
      return this;
    }
    maybeSingle(): this {
      this.cardinality = 'maybe';
      return this;
    }

    private embed(rows: Row[]): Row[] {
      const children = embeddedTables(this.selectStr);
      if (!children.length) return rows;
      const fk = CHILD_FK[this.table] ?? 'recipe_id';
      return rows.map((r) => {
        const out: Row = { ...r };
        for (const child of children) {
          out[child] = visible(child, db[child] ?? []).filter(
            (c) => c[fk] === r['id'],
          );
        }
        return out;
      });
    }

    private run(): FakeResult<unknown> {
      const entry: FakeLog = {
        table: this.table,
        op: this.op,
        select: this.selectStr,
        filters: [...this.filters],
      };

      if (failWith) {
        log.push({ ...entry, rowsOut: 0 });
        return { data: null, error: failWith };
      }

      const all = (db[this.table] ??= []);

      if (this.op === 'upsert') {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
        entry.rowsIn = incoming.length;
        const out: Row[] = [];
        for (const raw of incoming) {
          const row: Row = { ...raw };
          const policy = POLICIES[this.table];
          if (policy && !policy(row, authUid, db)) {
            log.push({ ...entry, rowsOut: 0 });
            return { data: null, error: RLS_DENIED };
          }
          const existing = all.find((r) =>
            this.conflictOn.every((c) => r[c] === row[c]),
          );
          if (existing) {
            Object.assign(existing, row, generated(this.table, { ...existing, ...row }));
            out.push(existing);
          } else {
            const made: Row = {
              id: newId(this.table),
              ...(INSERT_DEFAULTS[this.table]?.() ?? {}),
              ...row,
            };
            Object.assign(made, generated(this.table, made));
            all.push(made);
            out.push(made);
          }
        }
        log.push({ ...entry, rowsOut: out.length });
        return this.shape(out);
      }

      if (this.op === 'insert') {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
        entry.rowsIn = incoming.length;
        if (READ_ONLY_TABLES.has(this.table)) {
          log.push({ ...entry, rowsOut: 0 });
          return { data: null, error: RLS_DENIED };
        }
        const created: Row[] = [];
        const defaults = INSERT_DEFAULTS[this.table]?.() ?? {};
        for (const raw of incoming) {
          const row: Row = { id: newId(this.table), ...defaults, ...raw };
          Object.assign(row, generated(this.table, row));
          // WITH CHECK: a row the policy would not admit is refused outright,
          // which is how the real database reports it too.
          const policy = POLICIES[this.table];
          if (policy && !policy(row, authUid, db)) {
            log.push({ ...entry, rowsOut: 0 });
            return { data: null, error: RLS_DENIED };
          }
          all.push(row);
          created.push(row);
        }
        log.push({ ...entry, rowsOut: created.length });
        return this.shape(created);
      }

      const candidates = visible(this.table, all).filter((r) => matches(r, this.filters));

      if (this.op === 'update') {
        if (READ_ONLY_TABLES.has(this.table)) {
          log.push({ ...entry, rowsOut: 0 });
          return { data: null, error: null }; // no policy admits it: zero rows
        }
        for (const row of candidates) {
          Object.assign(row, this.payload);
          // Generated columns are recomputed by the database after every write,
          // never sent by the client.
          Object.assign(row, generated(this.table, row));
        }
        log.push({ ...entry, rowsOut: candidates.length });
        return this.shape(candidates);
      }

      if (this.op === 'delete') {
        // Migration 0008's guard, on the RAW delete path as well as the RPC.
        // In Postgres this is a foreign key, so it applies to
        // `DELETE /recipes?id=eq.x` sent straight at PostgREST with nothing but
        // the anon key — which is the bypass stage-6 requirement 5 names. A
        // double that only guarded the RPC would let a test "prove" the bypass
        // was blocked while modelling nothing.
        if (this.table === 'recipes') {
          const held = candidates.find((row) =>
            (db['ingredients'] ?? []).some(
              (i) => i['sub_recipe_id'] === row['id'] && i['recipe_id'] !== row['id'],
            ),
          );
          if (held) {
            log.push({ ...entry, rowsOut: 0 });
            return {
              data: null,
              error: {
                message:
                  'update or delete on table "recipes" violates foreign key constraint "ingredients_sub_recipe_id_fkey" on table "ingredients"',
                code: '23503',
              },
            };
          }
        }

        for (const row of candidates) {
          const i = all.indexOf(row);
          if (i >= 0) all.splice(i, 1);
          // ON DELETE CASCADE, for the one relationship the repository relies on
          if (this.table === 'recipes') {
            for (const child of [
              'ingredients',
              'steps',
              'issues',
              'trials',
              'batches',
              'recipe_versions',
              'private_notes',
            ]) {
              db[child] = (db[child] ?? []).filter((c) => c['recipe_id'] !== row['id']);
            }
          }
        }
        log.push({ ...entry, rowsOut: candidates.length });
        return this.shape(candidates);
      }

      let rows = this.embed(candidates);
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows = [...rows].sort((a, b) => {
          const x = a[column] as string | number | undefined;
          const y = b[column] as string | number | undefined;
          if (x === y) return 0;
          const less = (x ?? '') < (y ?? '');
          return (less ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      log.push({ ...entry, rowsOut: rows.length });
      return this.shape(rows);
    }

    private shape(rows: Row[]): FakeResult<unknown> {
      if (this.cardinality === 'many') return { data: rows, error: null };
      if (rows.length === 1) return { data: rows[0]!, error: null };
      if (this.cardinality === 'maybe' && rows.length === 0) {
        return { data: null, error: null };
      }
      return {
        data: null,
        error: {
          message:
            rows.length === 0
              ? 'JSON object requested, multiple (or no) rows returned'
              : 'multiple rows returned',
          code: 'PGRST116',
        },
      };
    }

    then<R1 = FakeResult<unknown>, R2 = never>(
      onfulfilled?: ((v: FakeResult<unknown>) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  // ── the RPCs from migration 0007 ─────────────────────────────────────────
  //
  // Mirrored here, not reimplemented differently: the SQL is the authority and
  // is verified directly against the live database (see REVIEW_STEP5_REPORT).
  // This exists so a component test can exercise save-with-version, restore and
  // the sub-recipe guards without a network — including the failure paths,
  // which are the ones worth testing.
  //
  // The one thing it cannot model is transactionality: JavaScript has no
  // rollback. So every guard is evaluated BEFORE anything is written, which is
  // the same observable outcome for a caller — nothing changed, and an error
  // came back. The real atomicity is proved against Postgres.

  const nextTag = (recipeId: string): string => {
    const used = (db['recipe_versions'] ?? [])
      .filter((v) => v['recipe_id'] === recipeId)
      .map((v) => Number(/^V(\d+)$/.exec(String(v['tag']))?.[1] ?? 0));
    return `V${Math.max(0, ...used) + 1}`;
  };

  const snapshotOf = (recipeId: string): Row => ({
    recipe: { ...(db['recipes'] ?? []).find((r) => r['id'] === recipeId) },
    ingredients: (db['ingredients'] ?? [])
      .filter((i) => i['recipe_id'] === recipeId)
      .map((i) => {
        // Migration 0011: the snapshot FREEZES the effective price, so a
        // version keeps its historical meaning when the centre changes later.
        // `coalesce(i.price, c.price)` — an override wins, and NULL survives
        // when neither has a price, so an unpriced recipe does not acquire a
        // cost retroactively.
        const owner = (db['recipes'] ?? []).find((r) => r['id'] === recipeId)?.['owner_id'];
        const cat = (db['ingredient_catalog'] ?? []).find(
          (c) => c['key'] === i['ingredient_key'] && c['owner_id'] === owner,
        );
        return {
          ...i,
          price: i['price'] ?? cat?.['price'] ?? null,
          price_unit: i['price_unit'] ?? cat?.['price_unit'] ?? null,
        };
      }),
    steps: (db['steps'] ?? [])
      .filter((x) => x['recipe_id'] === recipeId)
      .map((x) => ({ ...x })),
    issues: (db['issues'] ?? [])
      .filter((x) => x['recipe_id'] === recipeId)
      .map((x) => ({ ...x })),
  });

  /** The `check_sub_recipe_link` trigger, as a function. */
  const checkLink = (parentId: string, subId: string | null): string | null => {
    if (!subId) return null;
    if (subId === parentId) return 'מתכון אינו יכול להכיל את עצמו כתת־מתכון';
    const recipes = db['recipes'] ?? [];
    const parent = recipes.find((r) => r['id'] === parentId);
    const sub = recipes.find((r) => r['id'] === subId);
    if (!sub) return 'תת־המתכון המקושר אינו קיים';
    if (parent?.['owner_id'] !== sub['owner_id']) {
      return 'תת־מתכון חייב להיות מתכון של אותו חשבון';
    }
    // Walk forward from the sub and see whether the parent is reachable.
    const seen = new Set<string>();
    const stack = [subId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === parentId) return 'הקישור הזה יוצר מעגל בין מתכונים';
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const i of db['ingredients'] ?? []) {
        if (i['recipe_id'] === cur && i['sub_recipe_id']) {
          stack.push(String(i['sub_recipe_id']));
        }
      }
    }
    return null;
  };

  const writeChildren = (
    recipeId: string,
    ingredients: Row[],
    steps: Row[],
    issues: Row[],
  ): void => {
    for (const t of ['ingredients', 'steps', 'issues'] as const) {
      db[t] = (db[t] ?? []).filter((r) => r['recipe_id'] !== recipeId);
    }
    ingredients.forEach((e, i) => {
      (db['ingredients'] ??= []).push({
        id: newId('ing'),
        ...e,
        recipe_id: recipeId,
        ord: e['ord'] ?? i,
      });
    });
    steps.forEach((e, i) => {
      (db['steps'] ??= []).push({
        id: newId('step'),
        ...e,
        recipe_id: recipeId,
        ord: e['ord'] ?? i,
        temp_unit: e['temp_unit'] ?? 'C',
      });
    });
    issues.forEach((e, i) => {
      (db['issues'] ??= []).push({
        id: newId('issue'),
        ...e,
        recipe_id: recipeId,
        ord: e['ord'] ?? i,
      });
    });
  };

  const rpc = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<FakeResult<unknown>> => {
    log.push({ table: `rpc:${name}`, op: 'select', filters: [] });
    if (failWith) return { data: null, error: failWith };
    if (!authUid) {
      return { data: null, error: { message: 'לא ניתן לשמור בלי התחברות', code: '42501' } };
    }

    if (name === 'save_recipe') {
      const parent = (args['p_recipe'] ?? {}) as Row;
      const ingredients = (args['p_ingredients'] ?? []) as Row[];
      const steps = (args['p_steps'] ?? []) as Row[];
      const issues = (args['p_issues'] ?? []) as Row[];
      const recipeId = (args['p_recipe_id'] ?? null) as string | null;
      const expected = (args['p_expected_updated_at'] ?? null) as string | null;
      const note = String(args['p_version_note'] ?? '');

      const recipes = (db['recipes'] ??= []);

      if (recipeId === null) {
        const id = newId('recipes');
        // Guards first: nothing is written if any link is bad.
        const row: Row = {
          ...recipeRow(id, authUid),
          ...parent,
          id,
          owner_id: authUid,
          created_at: NOW,
          updated_at: NOW,
        };
        recipes.push(row);
        for (const e of ingredients) {
          const bad = checkLink(id, (e['sub_recipe_id'] ?? null) as string | null);
          if (bad) {
            // Undo the parent insert, standing in for the transaction.
            db['recipes'] = recipes.filter((r) => r['id'] !== id);
            return { data: null, error: { message: bad, code: '23514' } };
          }
        }
        writeChildren(id, ingredients, steps, issues);
        return { data: id, error: null };
      }

      const existing = recipes.find((r) => r['id'] === recipeId);
      if (!existing || existing['owner_id'] !== authUid) {
        return { data: null, error: { message: 'המתכון לא נמצא', code: 'P0002' } };
      }
      if (expected !== null && existing['updated_at'] !== expected) {
        return {
          data: null,
          error: {
            message: 'המתכון שונה במקום אחר מאז שנטען. יש לרענן ולנסות שוב.',
            code: '40001',
          },
        };
      }
      // Every guard BEFORE the first write, so a refusal leaves no trace.
      for (const e of ingredients) {
        const bad = checkLink(recipeId, (e['sub_recipe_id'] ?? null) as string | null);
        if (bad) return { data: null, error: { message: bad, code: '23514' } };
      }

      // §9: the PREVIOUS state becomes history.
      (db['recipe_versions'] ??= []).push({
        id: newId('ver'),
        recipe_id: recipeId,
        tag: nextTag(recipeId),
        what: note,
        snapshot: snapshotOf(recipeId),
        created_at: new Date(Date.now() + (db['recipe_versions'] ?? []).length).toISOString(),
        created_by: authUid,
      });

      Object.assign(existing, parent, {
        id: recipeId,
        owner_id: authUid,
        // A distinct value each save, which is what makes the optimistic
        // concurrency check testable at all.
        updated_at: new Date(Date.now() + (db['recipe_versions'] ?? []).length).toISOString(),
      });
      writeChildren(recipeId, ingredients, steps, issues);
      return { data: recipeId, error: null };
    }

    if (name === 'restore_recipe_version') {
      const versionId = String(args['p_version_id'] ?? '');
      const version = (db['recipe_versions'] ?? []).find((v) => v['id'] === versionId);
      if (!version) {
        return { data: null, error: { message: 'הגרסה לא נמצאה', code: 'P0002' } };
      }
      const recipeId = String(version['recipe_id']);
      const recipe = (db['recipes'] ?? []).find((r) => r['id'] === recipeId);
      if (!recipe || recipe['owner_id'] !== authUid) {
        return { data: null, error: { message: 'הגרסה לא נמצאה', code: 'P0002' } };
      }
      if (recipe['locked'] === true) {
        return {
          data: null,
          error: {
            message:
              'המתכון מסומן כנוסחה מאושרת לייצור. יש לבטל את הנעילה לפני שחזור.',
            code: '42501',
          },
        };
      }
      const snap = (version['snapshot'] ?? {}) as Row;
      const snapRecipe = (snap['recipe'] ?? null) as Row | null;
      if (!snapRecipe) {
        return {
          data: null,
          error: { message: 'ל-snapshot של הגרסה הזאת אין תוכן', code: '22000' },
        };
      }
      const snapIngredients = ((snap['ingredients'] ?? []) as Row[]).map((e) => ({ ...e }));
      // The trigger fires on the restore's inserts too, so a snapshot taken
      // before a sub-recipe was deleted cannot resurrect a dead link.
      for (const e of snapIngredients) {
        const bad = checkLink(recipeId, (e['sub_recipe_id'] ?? null) as string | null);
        if (bad) return { data: null, error: { message: bad, code: '23514' } };
      }

      // The present becomes history FIRST, so this restore is itself undoable.
      (db['recipe_versions'] ??= []).push({
        id: newId('ver'),
        recipe_id: recipeId,
        tag: nextTag(recipeId),
        what: `המצב שלפני שחזור ${String(version['tag'])}`,
        snapshot: snapshotOf(recipeId),
        created_at: new Date(Date.now() + (db['recipe_versions'] ?? []).length).toISOString(),
        created_by: authUid,
      });

      const { id: _i, owner_id: _o, created_at: _c, updated_at: _u, locked: _l, ...rest } =
        snapRecipe;
      void _i; void _o; void _c; void _u; void _l;
      Object.assign(recipe, rest, {
        updated_at: new Date(Date.now() + (db['recipe_versions'] ?? []).length).toISOString(),
      });
      writeChildren(
        recipeId,
        snapIngredients,
        ((snap['steps'] ?? []) as Row[]).map((e) => ({ ...e })),
        ((snap['issues'] ?? []) as Row[]).map((e) => ({ ...e })),
      );
      return { data: recipeId, error: null };
    }

    if (name === 'recipes_using') {
      const target = String(args['p_recipe_id'] ?? '');
      const mine = new Set(
        (db['recipes'] ?? [])
          .filter((r) => r['owner_id'] === authUid)
          .map((r) => String(r['id'])),
      );
      const out = new Map<string, string>();
      for (const i of db['ingredients'] ?? []) {
        if (i['sub_recipe_id'] !== target) continue;
        const rid = String(i['recipe_id']);
        if (rid === target || !mine.has(rid)) continue;
        const r = (db['recipes'] ?? []).find((x) => x['id'] === rid);
        if (r) out.set(rid, String(r['name'] ?? ''));
      }
      return {
        data: [...out].map(([id, name]) => ({ id, name })),
        error: null,
      };
    }

    if (name === 'recipes_pricing_on') {
      const key = String(args['p_key'] ?? '');
      const mine = new Set(
        (db['recipes'] ?? [])
          .filter((r) => r['owner_id'] === authUid)
          .map((r) => String(r['id'])),
      );
      const out = new Map<string, { id: string; name: string; rows: number; overridden: number }>();
      for (const i of db['ingredients'] ?? []) {
        if (i['ingredient_key'] !== key || i['sub_recipe_id']) continue;
        const rid = String(i['recipe_id']);
        if (!mine.has(rid)) continue;
        const r = (db['recipes'] ?? []).find((x) => x['id'] === rid);
        if (!r) continue;
        const acc = out.get(rid) ?? { id: rid, name: String(r['name'] ?? ''), rows: 0, overridden: 0 };
        // A line with its own price does NOT move when the centre changes, and
        // is counted separately rather than ignored.
        if (i['price'] === null || i['price'] === undefined) acc.rows += 1;
        else acc.overridden += 1;
        out.set(rid, acc);
      }
      return {
        data: [...out.values()].filter((r) => r.rows > 0),
        error: null,
      };
    }

    if (name === 'record_purchase') {
      if (!authUid) {
        return {
          data: null,
          error: { message: 'אין משתמש מחובר', code: '42501' },
        };
      }
      const key = String(args['p_key'] ?? '').trim();
      if (!key) {
        return {
          data: null,
          error: { message: 'לחומר גלם חייב להיות שם', code: '23514' },
        };
      }

      const facts: Row = {
        purchase_unit: args['p_purchase_unit'],
        package_count: args['p_package_count'] ?? 1,
        package_qty: args['p_package_qty'] ?? null,
        purchase_total: args['p_purchase_total'] ?? null,
        usable_pct: args['p_usable_pct'] ?? null,
        supplier: args['p_supplier'] ?? '',
        purchased_at: args['p_purchased_at'] ?? '2026-01-01',
        note: args['p_note'] ?? '',
      };

      // The log first, exactly as migration 0013 does — a history that can be
      // lost to a failure halfway through is not a history.
      const logRow: Row = {
        id: `pur-${(db['ingredient_purchases'] ?? []).length + 1}`,
        owner_id: authUid,
        key,
        ...facts,
        created_at: new Date().toISOString(),
      };
      Object.assign(logRow, generated('ingredient_purchases', logRow));
      db['ingredient_purchases'] = [...(db['ingredient_purchases'] ?? []), logRow];

      // Then the ACTIVE price, which is the catalog row and nothing else.
      const existing = (db['ingredient_catalog'] ?? []).find(
        (c) => c['owner_id'] === authUid && c['key'] === key,
      );
      if (existing) {
        Object.assign(existing, facts, {
          name: String(args['p_name'] ?? '').trim() || key,
        });
        Object.assign(existing, generated('ingredient_catalog', existing));
      } else {
        const made: Row = {
          id: `cat-${(db['ingredient_catalog'] ?? []).length + 1}`,
          owner_id: authUid,
          group_id: null,
          key,
          name: String(args['p_name'] ?? '').trim() || key,
          ...facts,
          g_per_100: null,
          water_pct: null,
          allergens: [],
          price_updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        Object.assign(made, generated('ingredient_catalog', made));
        db['ingredient_catalog'] = [...(db['ingredient_catalog'] ?? []), made];
      }
      return { data: logRow['id'], error: null };
    }

    if (name === 'purchase_history') {
      const key = String(args['p_key'] ?? '');
      // RLS: only the caller's own purchases exist as far as this is concerned.
      const rows = (db['ingredient_purchases'] ?? [])
        .filter((r) => r['key'] === key && r['owner_id'] === authUid)
        .sort((a, b) =>
          String(a['purchased_at']).localeCompare(String(b['purchased_at'])) ||
          String(a['created_at']).localeCompare(String(b['created_at'])),
        );

      const out = rows.map((r, i) => {
        const prev = i === 0 ? null : (rows[i - 1]!['price'] as number | null);
        const price = r['price'] as number | null;
        return {
          id: r['id'],
          purchased_at: r['purchased_at'],
          supplier: r['supplier'],
          purchase_unit: r['purchase_unit'],
          package_count: r['package_count'],
          package_qty: r['package_qty'],
          purchase_total: r['purchase_total'],
          usable_pct: r['usable_pct'],
          purchase_price: r['purchase_price'],
          price,
          prev_price: prev,
          // No previous price, or a previous price of 0, gives no ratio — and
          // a made-up percentage would be worse than none.
          pct_change:
            prev === null || prev === 0 || price === null
              ? null
              : ((price - prev) / prev) * 100,
        };
      });
      return { data: out.reverse(), error: null };
    }

    if (name === 'save_production_plan') {
      if (!authUid) {
        return { data: null, error: { message: 'לא ניתן לשמור בלי התחברות', code: '42501' } };
      }
      const plan = (args['p_plan'] ?? {}) as Row;
      const items = (args['p_items'] ?? []) as Row[];
      const stock = (args['p_stock'] ?? []) as Row[];
      const planId = args['p_plan_id'] ? String(args['p_plan_id']) : null;

      let row: Row | undefined;
      if (planId) {
        row = (db['production_plans'] ?? []).find(
          (p) => p['id'] === planId && p['owner_id'] === authUid,
        );
        if (!row) {
          return { data: null, error: { message: 'התוכנית לא נמצאה', code: '02000' } };
        }
        // A locked plan is a record of what happened. The RPC refuses, and so
        // must the double, or a test would pass on an edit the database
        // rejects.
        if (row['locked']) {
          return {
            data: null,
            error: {
              message: 'התוכנית סומנה כבוצעה. יש לבטל את הסימון לפני עריכה.',
              code: '42501',
            },
          };
        }
        const expected = args['p_expected_updated_at'];
        if (expected && row['updated_at'] !== expected) {
          return {
            data: null,
            error: {
              message: 'התוכנית שונתה במקום אחר מאז שנטענה. יש לרענן ולנסות שוב.',
              code: '40001',
            },
          };
        }
        Object.assign(row, {
          name: plan['name'] ?? '',
          plan_date: plan['plan_date'] ?? NOW.slice(0, 10),
          note: plan['note'] ?? '',
          updated_at: new Date().toISOString(),
        });
      } else {
        row = {
          id: `plan-${(db['production_plans'] ?? []).length + 1}`,
          owner_id: authUid,
          name: plan['name'] ?? '',
          plan_date: plan['plan_date'] ?? NOW.slice(0, 10),
          note: plan['note'] ?? '',
          locked: false,
          locked_at: null,
          snapshot: null,
          created_at: NOW,
          updated_at: NOW,
        };
        db['production_plans'] = [...(db['production_plans'] ?? []), row];
      }

      const id = String(row['id']);
      db['production_plan_items'] = (db['production_plan_items'] ?? []).filter(
        (i) => i['plan_id'] !== id,
      );
      db['production_plan_stock'] = (db['production_plan_stock'] ?? []).filter(
        (i) => i['plan_id'] !== id,
      );

      let n = 0;
      for (const e of items) {
        // The 0018 owner guard: a line may not point at another account's
        // recipe, and the FK alone does not stop it.
        const recipe = (db['recipes'] ?? []).find((r) => r['id'] === e['recipe_id']);
        if (!recipe || recipe['owner_id'] !== authUid) {
          return {
            data: null,
            error: { message: 'המתכון אינו של החשבון הזה', code: '42501' },
          };
        }
        db['production_plan_items']!.push({
          id: `pi-${(db['production_plan_items'] ?? []).length + 1}`,
          plan_id: id,
          recipe_id: e['recipe_id'],
          ord: e['ord'] ?? n,
          qty: e['qty'],
          qty_unit: e['qty_unit'] ?? 'unit',
          ready_at: e['ready_at'] ? String(e['ready_at']) : null,
          note: e['note'] ?? '',
        });
        n += 1;
      }
      for (const e of stock) {
        const key = String(e['key'] ?? '');
        if (!key) continue;
        const raw = e['on_hand'];
        db['production_plan_stock']!.push({
          id: `ps-${(db['production_plan_stock'] ?? []).length + 1}`,
          plan_id: id,
          key,
          // '' stays NULL. A blank field is not a zero.
          on_hand: raw === '' || raw === null || raw === undefined ? null : Number(raw),
        });
      }
      return { data: id, error: null };
    }

    if (name === 'set_plan_locked') {
      const id = String(args['p_plan_id'] ?? '');
      const row = (db['production_plans'] ?? []).find(
        (p) => p['id'] === id && p['owner_id'] === authUid,
      );
      if (!row) {
        return {
          data: null,
          error: { message: 'התוכנית אינה של החשבון הזה', code: '42501' },
        };
      }
      const lock = args['p_locked'] === true;
      if (lock && (args['p_snapshot'] === null || args['p_snapshot'] === undefined)) {
        return {
          data: null,
          error: { message: 'לא ניתן לנעול תוכנית בלי snapshot', code: '23514' },
        };
      }
      Object.assign(row, {
        locked: lock,
        locked_at: lock ? new Date().toISOString() : null,
        // The snapshot goes with the lock, in both directions.
        snapshot: lock ? args['p_snapshot'] : null,
      });
      return { data: null, error: null };
    }

    if (name === 'delete_production_plan') {
      const id = String(args['p_plan_id'] ?? '');
      // RLS: another account's id matches no row, so this is a silent no-op.
      const row = (db['production_plans'] ?? []).find(
        (p) => p['id'] === id && p['owner_id'] === authUid,
      );
      if (!row) return { data: null, error: null };
      db['production_plans'] = (db['production_plans'] ?? []).filter((p) => p !== row);
      for (const child of ['production_plan_items', 'production_plan_stock']) {
        db[child] = (db[child] ?? []).filter((c) => c['plan_id'] !== id);
      }
      return { data: null, error: null };
    }

    if (name === 'delete_recipe') {
      const target = String(args['p_recipe_id'] ?? '');

      // Migration 0008's guard. In the real database this is a foreign key
      // that no client can get around; here it is a check, evaluated BEFORE
      // anything is written, because JavaScript has no rollback.
      //
      // Deliberately NOT scoped to the caller's own recipes: the constraint is
      // not RLS-aware either. What keeps that from leaking is the owner-equality
      // invariant the 0007 trigger maintains, and modelling the guard as the
      // database really behaves is the only way a test could ever catch that
      // invariant breaking.
      const blockers = (db['ingredients'] ?? []).filter(
        (i) => i['sub_recipe_id'] === target && i['recipe_id'] !== target,
      );
      if (blockers.length > 0) {
        return {
          data: null,
          error: {
            message:
              'המתכון הזה משמש כמתכון בסיס, ולכן אי אפשר למחוק אותו.',
            code: '23503',
          },
        };
      }

      // RLS: another account's id matches no row, so this is a silent no-op.
      const row = (db['recipes'] ?? []).find(
        (r) => r['id'] === target && r['owner_id'] === authUid,
      );
      if (!row) return { data: null, error: null };

      db['recipes'] = (db['recipes'] ?? []).filter((r) => r !== row);
      for (const child of [
        'ingredients',
        'steps',
        'issues',
        'trials',
        'batches',
        'recipe_versions',
        'private_notes',
      ]) {
        db[child] = (db[child] ?? []).filter((c) => c['recipe_id'] !== target);
      }
      return { data: null, error: null };
    }

    // §8, migration 0022. Modelled including the two things the real function
    // does that a plain upsert would not: it refuses a recipe that is not the
    // caller's, and an empty body removes the row rather than storing one.
    if (name === 'save_private_note') {
      const recipeId = String(args['p_recipe_id'] ?? '');
      const body = String(args['p_body'] ?? '');
      const recipe = (db['recipes'] ?? []).find((r) => r['id'] === recipeId);
      if (!recipe || recipe['owner_id'] !== authUid) {
        return {
          data: null,
          error: { message: 'המתכון אינו של החשבון הזה', code: '42501' },
        };
      }
      const rows = db['private_notes'] ?? [];
      const at = rows.findIndex(
        (n) => n['user_id'] === authUid && n['recipe_id'] === recipeId,
      );
      if (body.trim() === '') {
        if (at >= 0) rows.splice(at, 1);
      } else if (at >= 0) {
        rows[at] = { ...rows[at], body, updated_at: NOW };
      } else {
        rows.push({
          id: `note-${rows.length + 1}`,
          user_id: authUid,
          recipe_id: recipeId,
          group_item_id: null,
          body,
          updated_at: NOW,
        });
      }
      db['private_notes'] = rows;
      return { data: null, error: null };
    }

    throw new Error(`fakeSupabase: rpc('${name}') is not modelled`);
  };

  const client = {
    from(table: string) {
      return new Builder(table);
    },
    rpc,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  };

  return {
    client,
    db,
    log,
    setAuthUid(uid) {
      authUid = uid;
    },
    setFailWith(error) {
      failWith = error;
    },
  };
}

// ── fixtures ───────────────────────────────────────────────────────────────

export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A profile row as migration 0001's trigger creates it for a new account. */
export function newProfileRow(userId: string, over: Row = {}): Row {
  return {
    user_id: userId,
    profile: 'pro',
    pro: true,
    units: ['g', 'kg', 'ml', 'l', 'unit'],
    tools: { cup: 240, tbsp: 15, tsp: 5 },
    touched_units: false,
    locale: 'he',
    onboarding_done: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

export function recipeRow(id: string, ownerId: string, over: Row = {}): Row {
  return {
    id,
    owner_id: ownerId,
    group_id: null,
    name: 'מתכון',
    category: 'אחר',
    tags: [],
    is_sub: false,
    locked: false,
    yield_units: 0,
    unit_weight: 0,
    yield_actual: null,
    weight_before: null,
    weight_after: null,
    dough_mode: false,
    ddt: null,
    flour_temp: null,
    room_temp: null,
    friction: null,
    target_fc: 0,
    // stage 8: NOT NULL with a default, and the rest NULL until entered
    sale_price_basis: 'batch',
    packaging_cost: null,
    labor_cost: null,
    other_cost: null,
    target_gm: null,
    shelf_life: '',
    storage: '',
    freezing: '',
    thawing: '',
    equipment: '',
    notes: '',
    manual_allergens: [],
    pan: null,
    version_of: null,
    version_note: '',
    saved_from_item_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

export function ingredientRow(recipeId: string, over: Row = {}): Row {
  return {
    id: newId('ing'),
    recipe_id: recipeId,
    ord: 0,
    name: 'קמח לבן',
    ingredient_key: 'flour.white',
    qty: 500,
    unit: 'גרם',
    flour: true,
    liquid: false,
    water_pct: null,
    unit_weight: null,
    g_per_100: null,
    price: null,
    price_unit: null,
    sub_recipe_id: null,
    note: '',
    ...over,
  };
}

/** A step row, for the stage-9 timeline tests. */
export function stepRow(recipeId: string, over: Row = {}): Row {
  return {
    id: newId('step'),
    recipe_id: recipeId,
    ord: 0,
    text: '',
    temp: null,
    temp_unit: 'C',
    minutes: null,
    // null = nobody classified it, which is what the timeline reports
    kind: null,
    ...over,
  };
}
