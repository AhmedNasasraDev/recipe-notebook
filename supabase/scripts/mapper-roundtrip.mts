// Proves that a recipe built in the editor really lands in Postgres, and comes
// back out identical.
//
// WHY THIS EXISTS, and what it is not
//
// The stage-4 route test (apps/web/src/app/RecipeFlow.test.tsx) drives the real
// components, the real draft model, the real mappers and the real repository —
// but against an in-memory double, because this environment's egress policy
// blocks *.supabase.co and no test here can open an HTTP connection to the
// project. A double cannot catch a numeric(7,2) that silently rounds, a CHECK
// constraint the mapper violates, a jsonb column that does not accept what is
// handed to it, or a text[] that arrives as a string.
//
// So this script splits the job in two:
//
//   phase 1 (`--emit`)  runs the real draft → Recipe → row pipeline in Node and
//                       writes the exact INSERT payloads to a JSON file, plus a
//                       digest of the Recipe those rows are supposed to
//                       reconstruct.
//   phase 2 (`--verify`) takes the rows SELECTed back out of the live database,
//                       runs them through the real `bundleToRecipe`, and
//                       compares the digest.
//
// Between the two phases the INSERT and SELECT run against the real project
// through the management API. If any column type, constraint or default differs
// from what the mappers assume, phase 2 fails.
//
//   npx vite-node supabase/scripts/mapper-roundtrip.mts -- --emit
//   ... run the SQL it prints ...
//   npx vite-node supabase/scripts/mapper-roundtrip.mts -- --verify rows.json

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { draftToRecipe, emptyDraft, emptyIngredient, emptyStep } from '../../apps/web/src/features/recipe/draft.js';
import {
  bundleToRecipe,
  ingredientsToRows,
  recipeToRow,
  stepsToRows,
} from '../../apps/web/src/data/mappers.js';

const OUT = 'supabase/tests/mapper-roundtrip.payload.json';

/**
 * A draft that exercises every distinction worth testing:
 *   - a weighed row and a volume row
 *   - a row with a price and one without
 *   - waterPct 0 (a measured zero) next to waterPct '' (use the table)
 *   - an UNTOUCHED yieldActual, which must land as NULL and not as 0
 *   - Hebrew text with a gershayim, which is also a SQL quoting hazard
 *   - tags, which is a text[]
 */
function buildDraft() {
  const d = emptyDraft('לחמים');
  d.name = 'לחם כוסמין 82% — בדיקת מסד';
  d.tags = 'בדיקה, כוסמין';
  d.yieldUnits = '2';
  d.unitWeight = '800';
  d.yieldActual = ''; // MUST become NULL
  d.targetFC = '27.5';
  // stage 8: the sale side and the cost breakdown, with the distinction that
  // matters — an ENTERED 0 next to an UNENTERED field.
  d.salePrice = '95';
  d.salePriceBasis = 'unit';
  d.packagingCost = '2.5';
  d.laborCost = '0';        // MUST land as 0
  d.otherCost = '';         // MUST land as NULL
  d.targetGM = '62.5';
  d.shelfLife = '3 ימים';
  d.notes = 'הערה עם גרשיים: קמח 82%';
  d.ingredients = [
    {
      ...emptyIngredient(),
      name: 'קמח מלא',
      qty: '600',
      unit: 'g',
      flour: true,
      price: '4.25',
      priceUnit: 'ק"ג',
    },
    {
      ...emptyIngredient(),
      name: 'מים',
      qty: '420',
      unit: 'g',
      liquid: true,
      waterPct: '100',
    },
    {
      ...emptyIngredient(),
      name: 'שמן זית',
      qty: '30',
      unit: 'ml',
      // a MEASURED zero, which must not collapse into NULL
      waterPct: '0',
    },
    {
      ...emptyIngredient(),
      name: 'מלח',
      qty: '12',
      unit: 'g',
    },
  ];
  d.steps = [
    // stage 9: one step CLASSIFIED and one left alone, because migration 0019
    // exists precisely because a `kind` was silently dropped on the way in.
    { ...emptyStep(), text: 'ללוש 12 דקות', minutes: '12', kind: 'active' },
    { ...emptyStep(), text: 'לאפות', temp: '240', minutes: '40' },
  ];
  return d;
}

/** Canonical digest of a Recipe, ignoring what the database assigns. */
function digest(recipe: unknown): string {
  const stable = JSON.stringify(recipe, (key, value) => {
    // Row ids are local before the insert and database uuids afterwards, so
    // they cannot be part of the comparison. Everything else must match.
    //
    // `updatedAt` joined this list in stage 6, and the reason is worth
    // recording: stage 5 added it to `bundleToRecipe` as the optimistic
    // concurrency token, which silently broke THIS script — the recorded
    // `expected` predated the field, so the round trip reported a mismatch on a
    // value the database is supposed to assign. It went unnoticed because
    // stage 5 re-ran the versions round trip and not this one. Both are in the
    // closing checklist now.
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') return undefined;
    return value;
  });
  return createHash('sha256').update(stable ?? '', 'utf8').digest('hex');
}

const q = (s: unknown) =>
  s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
const n = (v: unknown) => (v === null || v === undefined ? 'NULL' : String(v));
const b = (v: unknown) => (v ? 'true' : 'false');
/**
 * One value, as a SQL literal, by its JavaScript type.
 *
 * The recipes INSERT is generated from the row object's own keys rather than
 * from a hand-written column list. That list had already drifted: `sale_price`
 * (stage 7) and the five stage-8 costing columns were missing from it, so this
 * round trip — the one thing that checks the mappers against real column types
 * — was not checking them at all. A derived list cannot drift again.
 */
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return b(v);
  if (typeof v === 'number') return n(v);
  if (Array.isArray(v)) return arr(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return q(v);
};

const arr = (list: unknown) =>
  Array.isArray(list) && list.length
    ? `ARRAY[${list.map(q).join(', ')}]::text[]`
    : `'{}'::text[]`;

const OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RECIPE_ID = 'd0000000-0000-4000-8000-00000000000a';

function emit() {
  const draft = buildDraft();
  const recipe = draftToRecipe(draft);
  const parent = recipeToRow(recipe, OWNER);
  const ingredients = ingredientsToRows(recipe, RECIPE_ID);
  const steps = stepsToRows(recipe, RECIPE_ID);

  // The Recipe the round trip must reproduce. Built by feeding the very rows
  // that are about to be inserted back through the reader, so this is the
  // mappers' own claim about themselves — the database then has to agree.
  const expected = bundleToRecipe({
    recipe: { ...parent, id: RECIPE_ID, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as never,
    ingredients: ingredients.map((r, i) => ({ ...r, id: `i${i}` })) as never,
    steps: steps.map((r, i) => ({ ...r, id: `s${i}` })) as never,
  });

  const sql = `
-- GENERATED by supabase/scripts/mapper-roundtrip.mts. Fixtures are removed at
-- the end and the cleanup is asserted.
insert into auth.users (id, email)
values ('${OWNER}', 'roundtrip@test.invalid');

insert into public.recipes (
  id, ${Object.keys(parent).join(', ')}
) values (
  '${RECIPE_ID}', ${Object.values(parent).map(lit).join(', ')}
);

insert into public.ingredients (
  ${Object.keys(ingredients[0] ?? {}).join(', ')}
) values
${ingredients
  .map((r) => `  (${Object.values(r).map(lit).join(', ')})`)
  .join(',\n')};

insert into public.steps (
  ${Object.keys(steps[0] ?? {}).join(', ')}
) values
${steps.map((r) => `  (${Object.values(r).map(lit).join(', ')})`).join(',\n')};

-- Read it back in exactly the nested shape RECIPE_SELECT produces.
select jsonb_build_object(
  'recipe', to_jsonb(r.*),
  'ingredients', coalesce((select jsonb_agg(to_jsonb(i.*) order by i.ord)
                            from public.ingredients i where i.recipe_id = r.id), '[]'::jsonb),
  'steps', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.ord)
                      from public.steps s where s.recipe_id = r.id), '[]'::jsonb)
) as bundle
from public.recipes r
where r.id = '${RECIPE_ID}';
`.trim();

  const cleanup = `
delete from auth.users where id = '${OWNER}';
select (select count(*) from auth.users  where id = '${OWNER}')
     + (select count(*) from public.recipes where owner_id = '${OWNER}') as leftovers;
`.trim();

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        _comment:
          'GENERATED. The expected Recipe and the SQL that must reproduce it. See supabase/scripts/mapper-roundtrip.mts.',
        ownerId: OWNER,
        recipeId: RECIPE_ID,
        expectedDigest: digest(expected),
        expected,
        parentRow: parent,
        ingredientRows: ingredients,
        stepRows: steps,
        sql,
        cleanup,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`wrote ${OUT}`);
  console.log(`expected digest: ${digest(expected)}`);
  console.log('\n--- run this against the project ---\n');
  console.log(sql);
  console.log('\n--- then this ---\n');
  console.log(cleanup);
}

function verify(rowsPath: string) {
  const payload = JSON.parse(readFileSync(OUT, 'utf8')) as {
    expectedDigest: string;
    expected: unknown;
  };
  const raw = JSON.parse(readFileSync(rowsPath, 'utf8')) as unknown;

  // Accept either the bundle itself or the single-row result wrapping it.
  const bundle = (
    Array.isArray(raw)
      ? ((raw[0] as { bundle?: unknown }).bundle ?? raw[0])
      : ((raw as { bundle?: unknown }).bundle ?? raw)
  ) as Parameters<typeof bundleToRecipe>[0];

  const actual = bundleToRecipe(bundle);
  const actualDigest = digest(actual);

  if (actualDigest !== payload.expectedDigest) {
    console.error('ROUND TRIP FAILED — the database did not return what went in.');
    console.error(`expected ${payload.expectedDigest}`);
    console.error(`actual   ${actualDigest}`);
    // A field-by-field diff, because a digest alone says nothing useful.
    const a = JSON.parse(JSON.stringify(payload.expected)) as Record<string, unknown>;
    const c = JSON.parse(JSON.stringify(actual)) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(c)])) {
      if (key === 'id' || key === 'createdAt') continue;
      const x = JSON.stringify(a[key]);
      const y = JSON.stringify(c[key]);
      if (x !== y) console.error(`  ${key}:\n    expected ${x}\n    actual   ${y}`);
    }
    process.exit(1);
  }

  // The two distinctions most worth stating separately, because a digest match
  // proves them but does not say so.
  const r = actual as Record<string, unknown>;
  const ings = (r['ingredients'] ?? []) as Array<Record<string, unknown>>;
  const oil = ings.find((i) => i['name'] === 'שמן זית');
  const salt = ings.find((i) => i['name'] === 'מלח');

  const checks: Array<[string, boolean]> = [
    ['an untouched measured yield came back ABSENT, not as 0', !('yieldActual' in r)],
    ['a measured water percentage of 0 came back as 0', oil?.['waterPct'] === 0],
    ['an unset water percentage came back absent', salt !== undefined && !('waterPct' in salt)],
    ['the tags array survived as an array', Array.isArray(r['tags']) && (r['tags'] as unknown[]).length === 2],
    ['the gershayim in the notes survived', String(r['notes']).includes('82%')],
    ['the ingredient order survived', ings.map((i) => i['name']).join('|') === 'קמח מלא|מים|שמן זית|מלח'],
    // stage 8: the same NULL-vs-0 distinction, on the cost breakdown. An
    // entered labour cost of 0 means "we do not pay for this"; an unentered
    // other-cost means nobody has said. Real numeric columns are where that
    // distinction is most easily lost.
    ['an entered labour cost of 0 came back as 0', r['laborCost'] === 0],
    ['an unentered other cost came back ABSENT, not as 0', !('otherCost' in r)],
    ['the sale price and its basis survived', r['salePrice'] === 95 && r['salePriceBasis'] === 'unit'],
    ['the gross-margin target survived', r['targetGM'] === 62.5],
    // stage 9: `steps.kind` through real column types (migration 0019).
    ['a classified step kept its kind',
      ((r['steps'] as Array<Record<string, unknown>>)[0]?.['kind']) === 'active'],
    ['an unclassified step has no kind, rather than a default',
      !('kind' in ((r['steps'] as Array<Record<string, unknown>>)[1] ?? {}))],
  ];

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`);
    if (!pass) ok = false;
  }
  if (!ok) process.exit(1);

  console.log(`\nROUND TRIP OK — digest ${actualDigest}`);
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
