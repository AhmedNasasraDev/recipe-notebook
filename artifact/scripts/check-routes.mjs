// Does the viewer's route table still match the product's?
//
// The non-product builds copy the route list out of `apps/web/src/App.tsx`
// (they have to: they swap BrowserRouter for MemoryRouter). A copy drifts, and
// a viewer that shows a route the product does not have — or misses one it
// does — is worse than no viewer at all, because it would be read as evidence.
// The copy lives in ONE file, `viewer/routes.tsx`, which both the audit viewer
// and the shareable demo render; this compares that file with the product's.
//
// So this parses both files for `path="…"` and compares the sets. The viewer
// is allowed exactly one extra: `/__inspector/auth`, which renders a screen
// that in production is reached through AuthGate rather than a route.
//
//   node artifact/scripts/check-routes.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const paths = (src) =>
  new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

const product = paths(read('../../apps/web/src/App.tsx'));
const viewer = paths(read('../viewer/routes.tsx'));

const VIEWER_ONLY = new Set(['/__inspector/auth']);

const missing = [...product].filter((p) => !viewer.has(p));
const extra = [...viewer].filter((p) => !product.has(p) && !VIEWER_ONLY.has(p));

if (missing.length || extra.length) {
  console.error('the audit viewer no longer mirrors App.tsx:');
  for (const p of missing) console.error(`  - missing from the viewer: ${p}`);
  for (const p of extra) console.error(`  - in the viewer only: ${p}`);
  process.exit(1);
}

console.log(
  `route tables match: ${product.size} product routes, ` +
    `${VIEWER_ONLY.size} viewer-only path (${[...VIEWER_ONLY].join(', ')}).`,
);
