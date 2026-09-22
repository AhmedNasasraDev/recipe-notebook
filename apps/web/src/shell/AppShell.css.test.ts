// QA 22.09.2026, §7 — the tab bar drifted because the DOCUMENT could scroll.
//
// jsdom lays nothing out, so the browser measurement lives in the QA scripts
// (artifact/qa). What a unit test CAN hold is the rule that made it true:
// the frame and its scroller are positioned, so an absolutely positioned
// descendant (the `.visuallyHidden` file inputs and labels) is contained
// and clipped by the scroller instead of extending the document.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppShell.module.css'), 'utf8');

const rule = (selector: string): string =>
  new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('the app frame contains its own absolutely positioned descendants', () => {
  it('positions the frame and the scroller, so nothing escapes to the document', () => {
    expect(rule('.frame')).toMatch(/position:\s*relative/);
    expect(rule('.content')).toMatch(/position:\s*relative/);
  });

  it('keeps the tab bar in normal flow — never fixed, never sticky', () => {
    const bar = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TabBar.module.css'),
      'utf8',
    );
    const barRule = /\.bar\s*\{([^}]*)\}/.exec(bar)?.[1] ?? '';
    expect(barRule).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    expect(barRule).toMatch(/env\(safe-area-inset-bottom/);
  });
});
