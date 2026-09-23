// Proves that a VERSION taken by the database can reconstruct the recipe, and
// that restoring it really puts the recipe back — against real Postgres.
//
// WHY A SECOND SCRIPT, next to mapper-roundtrip.mts
//
// That one proves the live rows survive a trip through Postgres. Stage 5 adds
// two paths it says nothing about:
//
//   1. `recipe_snapshot()` builds a jsonb document inside the database, out of
//      `to_jsonb(row)`. What Postgres puts in that document is not what the
//      client would have serialised: a numeric(7,2) comes back as the string
//      "420.00" in some contexts and as a number in others, a NULL column is
//      present-and-null rather than absent, and a timestamptz is rendered by
//      Postgres and not by JavaScript. Requirement 2 says the version must be
//      enough to fully restore the recipe, so the document has to be proved to
//      reconstruct it — through the real `snapshotToRecipe`, not by eye.
//
//   2. `restore_recipe_version()` writes that document back into real columns.
//      A round trip that is lossy in either direction shows up here and
//      nowhere else.
//
// Same two phases as the sibling script, for the same reason: this environment
// blocks *.supabase.co, so nothing here opens an HTTP connection. Phase 1 emits
// SQL, the SQL runs against the live project, phase 2 checks what came back.
//
//   npx vite-node supabase/scripts/version-roundtrip.mts -- --emit
//   ... run the SQL it prints, as ONE statement ...
//   npx vite-node supabase/scripts/version-roundtrip.mts -- --verify out.json
//
// The whole SQL block is one transaction on purpose. `set_config(..., true)` is
// transaction-local, so the authenticated identity the RPCs read from
// `auth.uid()` only exists for as long as that transaction does — splitting it
// would silently run the RPCs as `postgres` and prove nothing about RLS.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  draftToRecipe,
  emptyDraft,
  emptyIngredient,
  emptyStep,
} from '../../apps/web/src/features/recipe/draft.js';
import {
  ingredientsToRows,
  issuesToRows,
  recipeToRow,
  snapshotToRecipe,
  stepsToRows,
  bundleToRecipe,
} from '../../apps/web/src/data/mappers.js';

const OUT = 'supabase/tests/version-roundtrip.payload.json';

const OWNER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * The state that must come back out of the version, containing every
 * distinction the two paths could lose:
 *
 *   - `yieldActual` untouched, which must stay NULL and never become 0
 *   - `waterPct: '0'` next to `waterPct: ''` — a measured zero beside "use the
 *     shared table", the distinction the whole data model is built around
 *   - `price: '0'` beside no price at all — a free ingredient is priced
 *   - a volume row, which needs a density to resolve
 *   - a gershayim and a percent sign in Hebrew text, which are both jsonb and
 *     SQL quoting hazards
 *   - tags, a text[] that has to survive to_jsonb and back
 */
function buildOriginal() {
  const d = emptyDraft('לחמים');
  d.name = 'לחם כוסמין 82% — בדיקת גרסאות';
  d.tags = 'בדיקה, גרסאות';
  d.yieldUnits = '2';
  d.unitWeight = '800';
  d.yieldActual = ''; // MUST stay NULL through snapshot AND restore
  d.targetFC = '27.5';
  // stage 8: the costing fields go through `save_recipe` → `apply_recipe_costing`
  // and must come back through a RESTORE as well. An entered 0 next to an
  // unentered field, because that is the pair a restore is most likely to lose.
  d.salePrice = '95';
  d.salePriceBasis = 'unit';
  d.packagingCost = '2.5';
  d.laborCost = '0';
  d.otherCost = '';
  d.targetGM = '62.5';
  d.notes = 'הערה עם גרשיים: קמח 82%';
  d.ingredients = [
    { ...emptyIngredient(), name: 'קמח מלא', qty: '600', unit: 'g', flour: true, price: '4.25', priceUnit: 'ק"ג' },
    { ...emptyIngredient(), name: 'מים', qty: '420', unit: 'g', liquid: true, waterPct: '100' },
    // a measured zero in two columns at once
    { ...emptyIngredient(), name: 'שמן זית', qty: '30', unit: 'ml', waterPct: '0', price: '0', priceUnit: 'ליטר' },
    { ...emptyIngredient(), name: 'מלח', qty: '12', unit: 'g' },
  ];
  d.steps = [
    // stage 9: one step CLASSIFIED and one left alone, because migration 0019
    // exists precisely because a `kind` was silently dropped on the way in.
    { ...emptyStep(), text: 'ללוש 12 דקות', minutes: '12', kind: 'active' },
    { ...emptyStep(), text: 'לאפות', temp: '240', minutes: '40' },
  ];
  return d;
}

/** Canonical digest, ignoring the ids and timestamps the database assigns. */
function digest(recipe: unknown): string {
  const stable = JSON.stringify(recipe, (key, value) =>
    key === 'id' || key === 'createdAt' || key === 'updatedAt' ? undefined : value,
  );
  return createHash('sha256').update(stable ?? '', 'utf8').digest('hex');
}

const jsonLit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

function emit() {
  const original = draftToRecipe(buildOriginal());
  const parent = recipeToRow(original, OWNER);
  // recipe_id is filled in by the RPC, so the payload rows carry ''.
  const ingredients = ingredientsToRows(original, '');
  const steps = stepsToRows(original, '');
  const issues = issuesToRows(original, '');

  // The Recipe the snapshot must reconstruct: the mappers' own claim, built
  // from the very rows about to be inserted. The database then has to agree.
  const expected = bundleToRecipe({
    recipe: { ...parent, id: 'X', created_at: 'T', updated_at: 'T' } as never,
    ingredients: ingredients.map((r, i) => ({ ...r, id: `i${i}` })) as never,
    steps: steps.map((r, i) => ({ ...r, id: `s${i}` })) as never,
    issues: [],
  });

  // The edit that triggers the version. One quantity, so the snapshot and the
  // live rows differ in exactly one place and a mix-up cannot pass.
  const edited = JSON.parse(JSON.stringify(ingredients)) as typeof ingredients;
  edited[1]!.qty = 450;

  const sql = `
-- GENERATED by supabase/scripts/version-roundtrip.mts.
--
-- ONE transaction, on purpose: set_config(..., true) is transaction-local, so
-- the authenticated identity the RPCs read from auth.uid() lives only here.
-- Splitting this would silently run the RPCs as \`postgres\` and prove nothing
-- about RLS or about SECURITY INVOKER.
--
-- The jsonb payloads go into a temp table BEFORE the role switch rather than
-- inline in the DO block: inside a dollar-quoted body a doubled '' is two
-- literal apostrophes, so a payload containing a geresh would be corrupted
-- silently rather than rejected.
--
-- Fixtures are removed at the end and the cleanup is asserted.
begin;

insert into auth.users (id, email)
values ('${OWNER}', 'version-roundtrip@test.invalid');

create temp table rt_in (k text primary key, v jsonb) on commit drop;
insert into rt_in (k, v) values
  ('parent', ${jsonLit(parent)}),
  ('ingredients', ${jsonLit(ingredients)}),
  ('ingredients_edited', ${jsonLit(edited)}),
  ('steps', ${jsonLit(steps)}),
  ('issues', ${jsonLit(issues)});

create temp table rt_out (ord int, result jsonb) on commit drop;
grant select on rt_in to authenticated;
grant insert, select on rt_out to authenticated;

select set_config('request.jwt.claims', '{"sub":"${OWNER}","role":"authenticated"}', true);
set local role authenticated;

do $rt$
declare
  rid uuid;
  vid uuid;
begin
  -- 1. create. No version is taken: there is no previous state to describe.
  select public.save_recipe(
    (select v from rt_in where k = 'parent'),
    (select v from rt_in where k = 'ingredients'),
    (select v from rt_in where k = 'steps'),
    (select v from rt_in where k = 'issues'),
    null, null, ''
  ) into rid;

  -- 2. update ONE quantity. The state above becomes V1, so the snapshot and
  --    the live rows differ in exactly one place and a mix-up cannot pass.
  perform public.save_recipe(
    (select v from rt_in where k = 'parent'),
    (select v from rt_in where k = 'ingredients_edited'),
    (select v from rt_in where k = 'steps'),
    (select v from rt_in where k = 'issues'),
    rid, null, 'test'
  );

  -- 3. the version document, exactly as the client reads it
  insert into rt_out select 1, jsonb_build_object(
    'phase', 'snapshot',
    'recipe_id', rid,
    'version_count', (select count(*) from public.recipe_versions where recipe_id = rid),
    'tag', (select tag from public.recipe_versions where recipe_id = rid),
    'snapshot', (select snapshot from public.recipe_versions where recipe_id = rid),
    'live_water_qty', (select qty from public.ingredients
                        where recipe_id = rid and name = 'מים')
  );

  -- 4. restore it, then read the LIVE rows back in the shape the client selects
  select id into vid from public.recipe_versions where recipe_id = rid and tag = 'V1';
  perform public.restore_recipe_version(vid);

  insert into rt_out select 2, jsonb_build_object(
    'phase', 'restored',
    'version_count', (select count(*) from public.recipe_versions where recipe_id = rid),
    'tags', (select jsonb_agg(tag order by tag) from public.recipe_versions where recipe_id = rid),
    'bundle', (
      select jsonb_build_object(
        'recipe', to_jsonb(r.*),
        'ingredients', coalesce((select jsonb_agg(to_jsonb(i.*) order by i.ord)
                                  from public.ingredients i where i.recipe_id = r.id), '[]'::jsonb),
        'steps', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.ord)
                            from public.steps s where s.recipe_id = r.id), '[]'::jsonb),
        'issues', coalesce((select jsonb_agg(to_jsonb(x.*) order by x.ord)
                             from public.issues x where x.recipe_id = r.id), '[]'::jsonb)
      )
      from public.recipes r where r.id = rid
    )
  );
end $rt$;

reset role;
select result from rt_out order by ord;
commit;
`.trim();

  const cleanup = `
delete from auth.users where id = '${OWNER}';
select (select count(*) from auth.users where id = '${OWNER}')
     + (select count(*) from public.recipes where owner_id = '${OWNER}')
     + (select count(*) from public.recipe_versions v
          join public.recipes r on r.id = v.recipe_id where r.owner_id = '${OWNER}') as leftovers;
`.trim();

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        _comment:
          'GENERATED. What the version snapshot and the restore must reproduce. See supabase/scripts/version-roundtrip.mts.',
        ownerId: OWNER,
        expectedDigest: digest(expected),
        expected,
        parentRow: parent,
        ingredientRows: ingredients,
        editedIngredientRows: edited,
        sql,
        cleanup,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`wrote ${OUT}`);
  console.log(`expected digest: ${digest(expected)}`);
  console.log('\n--- run this against the project, as ONE statement ---\n');
  console.log(sql);
  console.log('\n--- then this ---\n');
  console.log(cleanup);
}

interface Phase {
  phase?: string;
  version_count?: number | string;
  tag?: string;
  tags?: string[];
  snapshot?: unknown;
  live_water_qty?: unknown;
  bundle?: unknown;
}

function pick(raw: unknown, phase: string): Phase {
  const flat: Phase[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['phase'] === 'string') flat.push(o as Phase);
      else Object.values(o).forEach(walk);
    }
  };
  walk(raw);
  const found = flat.find((p) => p.phase === phase);
  if (!found) {
    console.error(`the results do not contain a "${phase}" row — found: ${flat.map((p) => p.phase).join(', ') || 'nothing'}`);
    process.exit(1);
  }
  return found;
}

function verify(rowsPath: string) {
  const payload = JSON.parse(readFileSync(OUT, 'utf8')) as {
    expectedDigest: string;
    expected: Record<string, unknown>;
  };
  const raw = JSON.parse(readFileSync(rowsPath, 'utf8')) as unknown;

  const snap = pick(raw, 'snapshot');
  const rest = pick(raw, 'restored');

  const fromSnapshot = snapshotToRecipe(snap.snapshot, 'X') as Record<string, unknown>;
  const fromRestore = bundleToRecipe(rest.bundle as Parameters<typeof bundleToRecipe>[0]) as Record<string, unknown>;

  const checks: Array<[string, boolean, string?]> = [
    // requirement 1: the create took no version, the update took exactly one
    ['the update took exactly one version, and the create took none', Number(snap.version_count) === 1, String(snap.version_count)],
    ['it is tagged V1', snap.tag === 'V1', String(snap.tag)],
    // requirement 2: enough to fully restore
    [
      'the snapshot reconstructs the pre-edit recipe exactly',
      digest(fromSnapshot) === payload.expectedDigest,
      `${digest(fromSnapshot)} vs ${payload.expectedDigest}`,
    ],
    ['the live row still holds the NEW quantity, so the two are not confused', Number(snap.live_water_qty) === 450, String(snap.live_water_qty)],
    // requirement 6: restore really puts it back
    [
      'restoring V1 reproduces the pre-edit recipe exactly',
      digest(fromRestore) === payload.expectedDigest,
      `${digest(fromRestore)} vs ${payload.expectedDigest}`,
    ],
    // requirement 7: the restore is itself undoable
    ['the restore added a version rather than consuming one', Number(rest.version_count) === 2, String(rest.version_count)],
    ['and V1 is still there', (rest.tags ?? []).includes('V1'), JSON.stringify(rest.tags)],
  ];

  // The distinctions a digest match proves but does not state.
  const say = (r: Record<string, unknown>, where: string) => {
    const ings = (r['ingredients'] ?? []) as Array<Record<string, unknown>>;
    const oil = ings.find((i) => i['name'] === 'שמן זית');
    const salt = ings.find((i) => i['name'] === 'מלח');
    const water = ings.find((i) => i['name'] === 'מים');
    checks.push(
      [`${where}: an untouched measured yield is ABSENT, not 0`, !('yieldActual' in r)],
      [`${where}: a measured water percentage of 0 is 0`, oil?.['waterPct'] === 0, JSON.stringify(oil?.['waterPct'])],
      [`${where}: an unset water percentage is absent`, salt !== undefined && !('waterPct' in salt)],
      [`${where}: a price of 0 is 0, not missing`, oil?.['price'] === 0, JSON.stringify(oil?.['price'])],
      [`${where}: an unpriced ingredient has no price`, salt !== undefined && !('price' in salt)],
      [`${where}: the pre-edit quantity is the one preserved`, Number(water?.['qty']) === 420, JSON.stringify(water?.['qty'])],
      [`${where}: the tags survived as an array of two`, Array.isArray(r['tags']) && (r['tags'] as unknown[]).length === 2],
      [`${where}: the gershayim and percent in the text survived`, String(r['notes']).includes('82%')],
      [`${where}: the ingredient order survived`, ings.map((i) => i['name']).join('|') === 'קמח מלא|מים|שמן זית|מלח'],
      // stage 8. The restore half is the one that matters: `sale_price` was
      // silently dropped by both save and restore until migration 0014, and a
      // digest match alone would not say which field had been lost.
      [`${where}: the sale price and its basis survived`,
        r['salePrice'] === 95 && r['salePriceBasis'] === 'unit'],
      [`${where}: an entered labour cost of 0 is 0, not missing`, r['laborCost'] === 0],
      [`${where}: an unentered other cost is ABSENT, not 0`, !('otherCost' in r)],
      [`${where}: the packaging cost and the margin target survived`,
        r['packagingCost'] === 2.5 && r['targetGM'] === 62.5],
      // stage 9: the step kind, which `replace_recipe_children` dropped until
      // migration 0019. One classified step and one deliberately not.
      [`${where}: a classified step kept its kind`,
        ((r['steps'] as Array<Record<string, unknown>>)[0]?.['kind']) === 'active'],
      [`${where}: an unclassified step has no kind, rather than a default`,
        !('kind' in ((r['steps'] as Array<Record<string, unknown>>)[1] ?? {}))],
    );
  };
  say(fromSnapshot, 'snapshot');
  say(fromRestore, 'restore');

  let ok = true;
  for (const [label, pass, detail] of checks) {
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${!pass && detail ? ` — got ${detail}` : ''}`);
    if (!pass) ok = false;
  }

  if (!ok) {
    // A field-by-field diff, because a digest alone says nothing useful.
    for (const [label, actual] of [['snapshot', fromSnapshot], ['restore', fromRestore]] as const) {
      if (digest(actual) === payload.expectedDigest) continue;
      console.error(`\n--- ${label} differs ---`);
      const a = JSON.parse(JSON.stringify(payload.expected)) as Record<string, unknown>;
      const c = JSON.parse(JSON.stringify(actual)) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(c)])) {
        if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
        const x = JSON.stringify(a[key]);
        const y = JSON.stringify(c[key]);
        if (x !== y) console.error(`  ${key}:\n    expected ${x}\n    actual   ${y}`);
      }
    }
    process.exit(1);
  }

  console.log(`\nVERSION ROUND TRIP OK — digest ${payload.expectedDigest}`);
}

const args = process.argv.slice(2);
if (args.includes('--emit')) {
  emit();
} else if (args.includes('--verify')) {
  const path = args[args.indexOf('--verify') + 1];
  if (!path) {
    console.error('usage: --verify <rows.json>');
    process.exit(1);
  }
  verify(path);
} else {
  console.error('usage: --emit | --verify <rows.json>');
  process.exit(1);
}
