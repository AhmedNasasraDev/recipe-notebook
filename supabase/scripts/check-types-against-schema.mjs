// Checks apps/web/src/lib/database.types.ts against the applied schema in
// supabase/schema.snapshot.json.
//
// Why this exists: the TS row types are hand-written so they can be NARROWER
// than the database (see the comment in the snapshot). Hand-written types drift.
// This compares the two things that must never drift — the set of columns, and
// which of them are nullable — and leaves the value types alone, since that is
// where the hand-written version is deliberately stricter.
//
// Since stage 6 it also checks the FUNCTIONS, for two reasons that are not
// about types at all:
//
//   1. PostgREST passes RPC arguments BY NAME. A renamed argument is not a type
//      error anywhere — it is "function not found" at runtime, from a client
//      whose types all check out.
//   2. The grants. `CREATE FUNCTION` grants EXECUTE to PUBLIC by default and
//      Supabase adds `anon` on top, which is how six stage-5 functions ended up
//      answering unauthenticated callers (fixed in 0010). A loosened grant
//      should be a failing check, not something noticed months later.
//
//   node supabase/scripts/check-types-against-schema.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = join(ROOT, 'apps/web/src/lib/database.types.ts');
const SNAPSHOT = join(ROOT, 'supabase/schema.snapshot.json');

const src = readFileSync(TYPES, 'utf8');
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

// table name -> the interface that types its Row, read out of the Database map
// so a renamed interface is caught here rather than by a confusing type error.
const tableToInterface = new Map();
for (const [, table, iface] of src.matchAll(
  /^\s{6}(\w+):\s*Table<(\w+)>;/gm,
)) {
  tableToInterface.set(table, iface);
}
// density_data_gaps is typed inline, with no named interface
const INLINE = { density_data_gaps: { name: 'required' } };

/** Pulls the field name and nullability out of one interface body. */
function fieldsOf(iface) {
  // Row types are type aliases, not interfaces — see the note in
  // database.types.ts for why that distinction is load-bearing.
  const m = src.match(
    new RegExp(`export type ${iface} = \\{([\\s\\S]*?)\\n\\};`),
  );
  if (!m) return null;
  const fields = {};
  // `name: type;` — comments and doc blocks are skipped by the anchor on \n
  // Groups: 1 = name, 2 = the optional `?` marker, 3 = the type.
  for (const [, name, , type] of m[1].matchAll(/\n {2}(\w+)(\??): ([^;]+);/g)) {
    fields[name] = / \| null$|^null \| /.test(type.trim()) ? 'nullable' : 'required';
  }
  return fields;
}

const problems = [];

for (const [table, expected] of Object.entries(snapshot)) {
  if (table.startsWith('_')) continue;

  const actual = INLINE[table] ?? (() => {
    const iface = tableToInterface.get(table);
    if (!iface) {
      problems.push(`${table}: no entry in the Database.public.Tables map`);
      return null;
    }
    const f = fieldsOf(iface);
    if (!f) problems.push(`${table}: interface ${iface} not found`);
    return f;
  })();
  if (!actual) continue;

  for (const [col, nullability] of Object.entries(expected)) {
    if (!(col in actual)) {
      problems.push(`${table}.${col}: in the database, missing from the types`);
    } else if (actual[col] !== nullability) {
      problems.push(
        `${table}.${col}: database says ${nullability}, types say ${actual[col]}`,
      );
    }
  }
  for (const col of Object.keys(actual)) {
    if (!(col in expected)) {
      problems.push(`${table}.${col}: in the types, missing from the database`);
    }
  }
}

for (const table of tableToInterface.keys()) {
  if (!(table in snapshot)) {
    problems.push(`${table}: typed but not present in the applied schema`);
  }
}

// ── functions ───────────────────────────────────────────────────────────────
const fnSnapshot = snapshot['_functions'] ?? {};

// The argument names each function is DECLARED with in the Functions map.
// `Args: { p_recipe_id: string }` -> ['p_recipe_id'], in source order, because
// order is part of what a positional call in psql depends on.
const declaredFns = new Map();
const fnBlock = src.match(/\n {4}Functions: \{([\s\S]*?)\n {4}\};/);
if (!fnBlock) {
  problems.push('Functions: block not found in database.types.ts');
} else {
  // Each entry is `name: { Args: {...}; Returns: ... };`, possibly across lines.
  for (const [, name, args] of fnBlock[1].matchAll(
    /(\w+):\s*\{\s*Args:\s*\{([\s\S]*?)\}\s*;?\s*Returns:/g,
  )) {
    declaredFns.set(name, [...args.matchAll(/(\w+)\s*:/g)].map((m) => m[1]));
  }
  // A function with no arguments is typed `Args: Record<string, never>` —
  // postgrest-js's convention, and `Args: {}` would mean "any object".
  // Matched separately because it is not a braces block, and a declaration
  // this pattern misses is a declaration nothing checks: `group_unread_counts`
  // was silently unchecked until this line existed.
  for (const [, name] of fnBlock[1].matchAll(
    /(\w+):\s*\{\s*Args:\s*Record<string,\s*never>\s*;?\s*Returns:/g,
  )) {
    declaredFns.set(name, []);
  }
}

for (const [name, args] of declaredFns) {
  const actual = fnSnapshot[name];
  if (!actual) {
    problems.push(`${name}(): declared in the types, not present in the applied schema`);
    continue;
  }
  if (args.join(',') !== actual.args.join(',')) {
    problems.push(
      `${name}(): argument names differ — database has (${actual.args.join(', ')}), ` +
        `types declare (${args.join(', ')}). PostgREST calls by name, so this breaks at runtime.`,
    );
  }
  if (actual.authenticated_execute !== true) {
    problems.push(
      `${name}(): declared for the client to call, but \`authenticated\` has no EXECUTE on it`,
    );
  }
}

/*
  RLS POLICY HELPERS — the one exemption from the definer rule below, and why
  it is not a loophole.

  A policy expression is evaluated with the QUERYING ROLE's privileges, so a
  function a policy calls must be executable by that role. This was measured,
  not assumed: EXECUTE was revoked from `authenticated` on the group helpers
  and the whole group flow broke with `permission denied for function
  is_group_member` from inside the `members_bootstrap` policy. See migration
  0026.

  These three also cannot be written as SECURITY INVOKER, because a policy on
  `group_members` that reads `group_members` recurses — Postgres raises
  `infinite recursion detected in policy`.

  So the grant is unavoidable, and what makes it safe is the SHAPE of what is
  exposed. Every function on this list must:

    · answer only about `auth.uid()`. 0031 added `shares_group_with(uuid)`,
      which DOES take a user id, so the condition is stated more precisely
      than "no parameter naming a user": a parameter may name a second party
      only when the answer is still about the CALLER's own relationship to it
      ("do I share a group with this person?") and is a single boolean. It can
      never be asked about two OTHER people, and what it discloses — that a
      uuid you already hold is a groupmate — is what `group_roster` hands the
      caller anyway;
    · return a rank or a boolean, never a row and never an id. 0026 withdrew
      three earlier helpers (`course_group`, `lesson_group`, `item_group`)
      precisely because they returned somebody else's group id;
    · be `set search_path = ''` with every reference schema-qualified.

  Adding a name here is a security decision. If a helper does not meet all
  three conditions, the answer is to change the helper, not this list.

  CROSS-CHECKED against Supabase's own linter after 0036: its
  `authenticated_security_definer_function_executable` finding names exactly
  nine functions, and they are exactly the nine on the three lists in this file
  — the three rank helpers, `shares_group_with`, `group_roster`, and the four
  privileged RPCs. Two independent tools agreeing on the same set is what makes
  "deliberate" checkable by somebody who did not write it.
*/
const RLS_POLICY_HELPERS = new Set([
  'group_rank',
  'course_rank',
  'lesson_rank',
  'shares_group_with',
]);

/*
  DEFINER READS — a third exemption, for a function that reads rows the caller
  is entitled to see but RLS cannot express.

  `group_roster` is the case. A member may see who else is in their group,
  which means reading OTHER PEOPLE's `profiles` rows for a name and a picture.
  `profiles` is own-row-only and should stay that way: widening it to "anyone
  who shares a group with me" would expose every column of that row — and
  `profiles` is where a person's settings live — to get two of them.

  So the read is a definer function with a fixed, narrow projection. What
  every name on this list must satisfy:

    · the FIRST statement of the body is a check on `auth.uid()` that raises
      42501 — `group_roster` raises unless `group_rank(p_group_id) >= 1`;
    · it returns only data about a group the caller is ALREADY a member of,
      never a way to discover one;
    · it never returns an email address or a token. The roster returns
      `display_name` and `avatar_path` and stops there, because §10.1 is
      explicit that an address must not be disclosed, and a list every member
      can read is exactly where that would leak.

  A function that needs to return more than a fixed projection does not belong
  here; it belongs behind a policy.
*/
const DEFINER_READS = new Set(['group_roster']);

/*
  PRIVILEGED RPCs — a second, separate exemption, and a narrower one.

  Joining a group is the only thing a NON-member does, so it cannot run under
  the caller's own privileges: they cannot read the group, cannot read the
  invitation, and cannot insert into `group_members`. There is no policy that
  would help, because the authorisation is not "does this row belong to me" but
  "is this token valid" — which no `using` clause can express.

  So these three functions ARE the decision they own, and each one makes it in
  its own body. What every name on this list must satisfy:

    · the authorisation check is the FIRST thing the body does, and it is a
      check on `auth.uid()` or on a secret the caller presented;
    · the only row it can create is a plain 'member' membership. None of them
      accepts a role, so none can be used to promote anybody — promotion stays
      an UPDATE under `members_role`, which is the owner's alone;
    · `approve_group_join` is the one that can name a DIFFERENT user, so it
      checks the caller's rank first AND requires that the person actually
      asked. It cannot put an arbitrary account into a group.

  `reject_group_invite` (0031) is here for the invitee's side of the same
  problem: declining an invitation is done by somebody who is not a member, so
  no policy can reach the row either. It takes the TOKEN, not an id, so it can
  only affect an invitation whose secret the caller already holds, and it
  creates nothing at all.

  Note what is NOT here: `revoke_group_invite`, `resend_group_invite`,
  `reject_group_join` and `withdraw_group_join`. Each is performed by
  somebody the group's own policies already reach — staff, or the asker — so
  each is SECURITY INVOKER and needs no exemption. That is the test.

  Note what is NOT on this list: `save_group_recipe_copy`. It looked like it
  belonged here and does not — every step of §11's copy is within the caller's
  own RLS, so it is SECURITY INVOKER (see migration 0027). If a function can be
  written as INVOKER, it does not go on this list.
*/
const PRIVILEGED_RPCS = new Set([
  'redeem_group_invite',
  'reject_group_invite',
  'request_group_join',
  'approve_group_join',
]);

// The security posture, over EVERY function and not only the declared ones.
for (const [name, fn] of Object.entries(fnSnapshot)) {
  if (fn.anon_execute) {
    problems.push(
      `${name}(): callable by \`anon\`. Every RPC here needs a signed-in caller ` +
        `— see migrations 0006 and 0010.`,
    );
  }
  if (
    fn.security_definer &&
    (fn.authenticated_execute || fn.anon_execute) &&
    !RLS_POLICY_HELPERS.has(name) &&
    !PRIVILEGED_RPCS.has(name) &&
    !DEFINER_READS.has(name)
  ) {
    problems.push(
      `${name}(): SECURITY DEFINER and directly callable by a client role. ` +
        `A definer function runs as its owner, so it must only ever be reached ` +
        `through the trigger or function that owns the decision.`,
    );
  }
  // Neither exemption extends to `anon`. Both kinds of function decide
  // something about `auth.uid()`, which is null for an unauthenticated caller.
  if (
    (RLS_POLICY_HELPERS.has(name) ||
      PRIVILEGED_RPCS.has(name) ||
      DEFINER_READS.has(name)) &&
    fn.anon_execute
  ) {
    problems.push(
      `${name}(): an exempted definer function must not be callable by \`anon\`.`,
    );
  }
}

if (problems.length) {
  console.error('database.types.ts does not match the applied schema:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const tables = Object.keys(snapshot).filter((k) => !k.startsWith('_'));
const columns = tables.reduce((n, t) => n + Object.keys(snapshot[t]).length, 0);
console.log(
  `database.types.ts matches the applied schema: ${tables.length} tables, ` +
    `${columns} columns, ${declaredFns.size} declared functions ` +
    `(${Object.keys(fnSnapshot).length} checked for grants).`,
);
