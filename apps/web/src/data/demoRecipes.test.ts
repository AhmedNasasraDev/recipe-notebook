import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_CATEGORIES, DEMO_CONTACTS, DEMO_RECIPES } from './demoRecipes.js';

const PROTO = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../design_handoff_recipe_notebook',
);

function loadPrototypeData() {
  const sandbox: any = { window: {}, console };
  sandbox.window.window = sandbox.window;
  const ctx = createContext(sandbox);
  runInContext(readFileSync(join(PROTO, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  return sandbox.window.PN_DATA;
}

describe('demo data is generated from the untouched prototype', () => {
  const proto = loadPrototypeData();

  it('has not drifted by transcription', () => {
    expect(JSON.parse(JSON.stringify(DEMO_RECIPES))).toEqual(proto.RECIPES);
    expect([...DEMO_CATEGORIES]).toEqual(proto.CATEGORIES);
    expect(JSON.parse(JSON.stringify(DEMO_CONTACTS))).toEqual(proto.CONTACTS);
  });

  it('carries the five recipes the review found', () => {
    expect(DEMO_RECIPES.map((r) => r.id)).toEqual([
      'ganache',
      'brioche',
      'croissant',
      'pastrycream',
      'brioche-choc',
    ]);
  });
});
