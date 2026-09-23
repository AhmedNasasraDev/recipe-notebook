// Generates apps/web/src/data/demoRecipes.ts from the untouched prototype's
// data.js, so the demo content can never drift by transcription error.
// Re-run after the prototype changes:  node scripts/generate-demo-data.mjs
// Verify without writing:              node scripts/generate-demo-data.mjs --check

import { readFileSync, writeFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = join(ROOT, 'design_handoff_recipe_notebook');
const OUT = join(ROOT, 'apps/web/src/data/demoRecipes.ts');

const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
const ctx = createContext(sandbox);
runInContext(readFileSync(join(PROTO, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
const { RECIPES, CATEGORIES, CONTACTS } = sandbox.window.PN_DATA;

const header = `// GENERATED from design_handoff_recipe_notebook/data.js — do not edit by hand.
// Regenerate with: node scripts/generate-demo-data.mjs
//
// These are the prototype's five demo recipes, typed. They are seed content for
// development only; once Supabase is connected a new account starts empty and
// may import them explicitly.

import type { Recipe } from '@recipe-notebook/engine';

export const DEMO_CATEGORIES: readonly string[] = ${JSON.stringify(CATEGORIES, null, 2)};

export const DEMO_CONTACTS: readonly { id: string; name: string; role: string }[] =
  ${JSON.stringify(CONTACTS, null, 2)};

export const DEMO_RECIPES: readonly Recipe[] = ${JSON.stringify(RECIPES, null, 2)};
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== header) {
    console.error('demoRecipes.ts is out of date. Run: node scripts/generate-demo-data.mjs');
    process.exit(1);
  }
  console.log('demoRecipes.ts is up to date.');
} else {
  writeFileSync(OUT, header);
  console.log(`wrote ${OUT} — ${RECIPES.length} recipes, ${CATEGORIES.length} categories`);
}
