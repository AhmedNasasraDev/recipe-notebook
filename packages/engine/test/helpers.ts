import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MeasurementPrefs } from '../src/types.js';
import { TOOL_DEFAULTS } from '../src/units.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE_DIR = join(
  HERE,
  '..',
  '..',
  '..',
  'design_handoff_recipe_notebook',
);

/** Loads the untouched prototype modules for parity testing. */
export function loadLegacy(): {
  PN_ENGINE: any;
  PN_MEASURE: any;
  PN_PARSER: any;
  PN_DATA: any;
} {
  const sandbox: any = { window: {}, console };
  sandbox.window.window = sandbox.window;
  const ctx = createContext(sandbox);
  for (const f of ['engine.js', 'measure.js', 'parser.js', 'data.js']) {
    runInContext(readFileSync(join(PROTOTYPE_DIR, f), 'utf8'), ctx, {
      filename: f,
    });
  }
  return sandbox.window;
}

export function prefsWithCup(
  cupMl: number,
  extra: Partial<MeasurementPrefs> = {},
): MeasurementPrefs {
  return {
    tools: { ...TOOL_DEFAULTS, cup: cupMl },
    calib: [],
    units: ['g'],
    ...extra,
  };
}

export const DEFAULT_PREFS: MeasurementPrefs = {
  tools: { ...TOOL_DEFAULTS },
  calib: [],
};

export const close = (a: number, b: number, eps = 1e-9): boolean =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
