// Generates supabase/migrations/0005_density_seed.sql from the engine's
// DENSITY_TABLE, so the database seed and the client-side table can never
// disagree about a professional value.
//
//   node supabase/scripts/generate-density-seed.mjs          # write
//   node supabase/scripts/generate-density-seed.mjs --check  # verify, exit 1 on drift

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'supabase/migrations/0005_density_seed.sql');
const ENGINE_DIST = join(ROOT, 'packages/engine/dist/index.js');

if (!existsSync(ENGINE_DIST)) {
  console.error('Build the engine first: npm run build --workspace @recipe-notebook/engine');
  process.exit(1);
}

const { DENSITY_TABLE, KNOWN_DATA_GAPS, conflictSummary } = await import(ENGINE_DIST);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (list) => (list?.length ? `ARRAY[${list.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const num = (n) => (n == null ? 'NULL' : String(n));
const bool = (b) => (b ? 'true' : 'false');

const s = conflictSummary();

const rows = DENSITY_TABLE.map((e, i) =>
  `  (${[
    q(e.key),
    arr(e.match),
    arr(e.exclude),
    bool(e.wordMatch),
    num(e.gPer100),
    q(e.confidence),
    q(e.resolution),
    q(e.note ?? ''),
    `${q(JSON.stringify(e.sources ?? {}))}::jsonb`,
    bool(e.needsReview),
    q(e.reviewNote ?? ''),
    arr(e.forms),
    String(i),
  ].join(', ')})`,
).join(',\n');

const gaps = KNOWN_DATA_GAPS.map((n) => `  (${q(n)})`).join(',\n');

const sql = `-- GENERATED from packages/engine DENSITY_TABLE — do not edit by hand.
-- Regenerate: node supabase/scripts/generate-density-seed.mjs
-- Verify:     npm run seed:check
--
-- ${s.rows} rows: ${s.accepted} accepted, ${s.acceptedSingleSource} accepted-single-source,
-- ${s.pendingVerification} pending-verification, ${s.pendingForm} pending-form.
-- ${s.knownGaps} known data gaps.
--
-- A pending row carries NO value on purpose (spec §5.1 rule 5). See CONFLICTS.md
-- for what each one is waiting on.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verified after applying: the digest of the 34 rows in the database matches the
-- digest of DENSITY_TABLE, so the seed is the engine's data and not a retyping
-- of it.

insert into public.density_table
  (key, match_terms, exclude_terms, word_match, g_per_100, confidence,
   resolution, note, sources, needs_review, review_note, forms, ord)
values
${rows}
on conflict (key) do update set
  match_terms   = excluded.match_terms,
  exclude_terms = excluded.exclude_terms,
  word_match    = excluded.word_match,
  g_per_100     = excluded.g_per_100,
  confidence    = excluded.confidence,
  resolution    = excluded.resolution,
  note          = excluded.note,
  sources       = excluded.sources,
  needs_review  = excluded.needs_review,
  review_note   = excluded.review_note,
  forms         = excluded.forms,
  ord           = excluded.ord;

insert into public.density_data_gaps (name)
values
${gaps}
on conflict (name) do nothing;
`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== sql) {
    console.error('0005_density_seed.sql is out of date. Run: node supabase/scripts/generate-density-seed.mjs');
    process.exit(1);
  }
  console.log(`0005_density_seed.sql is up to date (${s.rows} rows).`);
} else {
  writeFileSync(OUT, sql);
  console.log(`wrote ${OUT} — ${s.rows} rows, ${s.knownGaps} gaps`);
}
