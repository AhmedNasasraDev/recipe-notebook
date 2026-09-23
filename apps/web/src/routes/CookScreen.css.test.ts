// Ahmed reported real-device screenshots (23.09.2026): the progress bar's
// segments cut off at the screen's edge, in a screenshot that showed the bar
// touching the edge with none of the page's usual padding. Root cause:
// global.css's `button { min-width: var(--hit-min) }` (the spec §3.4 floor
// for a standalone button) applies to every `<button>`, including the 28
// segment buttons of a full recipe's progress bar — at var(--hit-min) each,
// 28 of them alone ask for more width than any phone has, which `flex: 1`
// cannot shrink past once an explicit `min-width` overrides the default
// `auto`. `.seg`/`.segDone`/`.segNow` need `min-width: 0` to opt back into
// the shrink the row was written for; this guards against losing that again.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'CookScreen.module.css'), 'utf8')
  // Strip comments first — one of them documents the very rule this file
  // guards against with the words "min-width" and a literal "{", either of
  // which would otherwise confuse a regex written for real CSS only.
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rule = (selector: string): string =>
  new RegExp(`\\${selector}\\s*,?[^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('the step progress bar shrinks below the global button floor', () => {
  it('overrides min-width so 28 segments can still fit one phone screen', () => {
    for (const selector of ['.seg', '.segDone', '.segNow']) {
      expect(rule(selector)).toMatch(/min-width:\s*0/);
    }
  });
});
