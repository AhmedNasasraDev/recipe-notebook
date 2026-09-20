import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(HERE, 'tokens.css'), 'utf8');

const SRC = join(HERE, '..');
const moduleSheets = (): string[] =>
  globSync('**/*.module.css', { cwd: SRC }).map((f) => join(SRC, f));

/**
 * §16 is a contract. HANDOFF §8 forbids changing the design language without a
 * professional reason, so the token file is asserted against the spec's table.
 */
const SPEC_16_COLOURS: readonly [string, string][] = [
  ['רקע אפליקציה', '#fbfbf9'],
  ['נייר', '#fdfbf6'],
  ['רקע חוץ', '#e9ece8'],
  ['קו', '#cdd4ce'],
  ['ירוק ראשי', '#1e6b4c'],
  ['ירוק רקע', '#e2efe8'],
  ['חום־חול', '#c4a99b'],
  ['ענבר', '#a56a0e'],
  ['ענבר רקע', '#f6ebd6'],
  ['אדום', '#9e362c'],
  ['אדום רקע', '#f6e3e0'],
  ['דיו', '#171a18'],
  ['אפור טקסט', '#6e7a73'],
  ['אפור רקע ניטרלי', '#edefec'],
];

describe('design tokens match spec §16', () => {
  for (const [name, hex] of SPEC_16_COLOURS) {
    it(`${name} = ${hex}`, () => {
      expect(tokens.toLowerCase()).toContain(hex);
    });
  }

  it('declares both spec fonts', () => {
    expect(tokens).toContain('Heebo');
    expect(tokens).toContain('Frank Ruhl Libre');
  });

  it('keeps the 44px minimum hit target (§15)', () => {
    expect(tokens).toMatch(/--hit-min:\s*44px/);
  });

  it('maps every engine Source to a colour, so a badge cannot pick its own', () => {
    for (const s of ['exact', 'personal', 'recipe', 'system', 'estimate', 'unavailable']) {
      expect(tokens).toContain(`--c-source-${s}:`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('every token a stylesheet uses is actually declared', () => {
  // ADDED IN STAGE 7, after writing a stylesheet against seven tokens that do
  // not exist (`--c-card`, `--c-ink-2`, `--c-clay`, `--r-btn`, `--fs-h1`…).
  // An undefined custom property does not error and does not fall back — the
  // declaration is simply dropped, so the element renders with no background,
  // no radius, no colour, and nothing anywhere says so. Same class of silent
  // failure as a container query naming a container that does not exist.
  const declared = new Set(
    [...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
  );

  // `absolute: true` is not honoured by Node's fs.globSync here, so the paths
  // come back relative to `cwd` and are joined explicitly.
  const sheets = moduleSheets();

  it('finds the stylesheets to check', () => {
    // A guard on the guard: a broken glob would make every case below pass.
    expect(sheets.length).toBeGreaterThan(3);
  });

  for (const sheet of sheets) {
    const name = sheet.slice(sheet.lastIndexOf('/') + 1);
    it(`${name} uses only declared tokens`, () => {
      const css = readFileSync(sheet, 'utf8');
      const used = new Set(
        [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]!),
      );
      // A token defined locally in the same sheet is fine too.
      const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
      const missing = [...used].filter((t) => !declared.has(t) && !local.has(t));
      expect(missing).toEqual([]);
    });
  }
});

describe('every container query names a container that exists', () => {
  // Also stage 7, for the same reason and from the same stage-6 mistake: an
  // `@container frame (...)` where the shell declares `container-name: app`
  // never matches, so the responsive layout is dead with no error anywhere.
  const names = new Set(
    moduleSheets().flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/container-name:\s*([a-z0-9-]+)/g)].map(
        (m) => m[1]!,
      ),
    ),
  );

  it('at least one container is declared somewhere', () => {
    expect(names.size).toBeGreaterThan(0);
  });

  for (const sheet of moduleSheets()) {
    const short = sheet.slice(sheet.lastIndexOf('/') + 1);
    it(`${short} queries only declared containers`, () => {
      const css = readFileSync(sheet, 'utf8');
      const queried = [...css.matchAll(/@container\s+([a-z0-9-]+)\s*\(/g)].map((m) => m[1]!);
      expect(queried.filter((q) => !names.has(q))).toEqual([]);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// STAGE-10 AUDIT GUARD: text has to be readable on the background it sits on.
//
// The audit found `--c-sand` (#c4a99b) used as a PANEL BACKGROUND under
// `--c-muted` text — 2.02:1 measured, on the "no connection" notice and on
// three empty states — and as small TEXT on paper and on white, at 2.14 and
// 2.21:1, including on a tab label and on the "המר" affordance. The token's
// own comment says sand is a fill ("step numbers, paper frame"), and nothing
// caught the misuse because every one of those rules is valid CSS with a
// declared token.
//
// So the pairing is checked arithmetically. A rule that sets BOTH a background
// token and a text colour token is measured; a rule that sets only one is
// skipped, because its counterpart comes from the cascade and this is a static
// file check rather than a browser. The browser-side measurement that found
// these lives in the stage-10 report.
const HEX: Readonly<Record<string, string>> = Object.fromEntries(
  [...tokens.matchAll(/(--c-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
);

const luminance = (hex: string): number => {
  const v = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
};

const contrast = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Pairings that come straight from the spec's §16 palette and are therefore
 * NOT this test's business to reject. They are reported as a known limitation
 * in REVIEW_STEP10_FINAL_REPORT.md instead, because changing them means
 * changing the product's colours — a decision for the designer, not a test.
 */
const SPEC_PAIRS: ReadonlySet<string> = new Set([
  '--c-amber-bg/--c-amber', // 3.81:1 — the warning banner, as specified
  '--c-paper/--c-muted', // 4.33:1 — secondary text on a card
  '--c-app-bg/--c-muted', // 4.32:1 — secondary text on a screen
  '--c-neutral-bg/--c-muted', // 3.87:1
  '--c-white/--c-muted', // 4.47:1 — the active tab label
  '--c-paper/--c-sand', // 2.14:1 — §16 step numerals, from the prototype
  '--c-outer-bg/--c-muted', // label and order sheets
]);

describe('stage-10 audit: no stylesheet pairs unreadable colours', () => {
  const findings: string[] = [];

  for (const sheet of moduleSheets()) {
    const css = readFileSync(sheet, 'utf8');
    const name = sheet.slice(SRC.length + 1);
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = rule[2]!;
      const bg = /background(?:-color)?:\s*var\((--c-[\w-]+)\)/.exec(body);
      const fg = /(?<!-)\bcolor:\s*var\((--c-[\w-]+)\)/.exec(body);
      if (!bg || !fg) continue;
      const bgHex = HEX[bg[1]!];
      const fgHex = HEX[fg[1]!];
      if (!bgHex || !fgHex) continue;
      if (SPEC_PAIRS.has(`${bg[1]}/${fg[1]}`)) continue;
      const ratio = contrast(bgHex, fgHex);
      if (ratio < 4.5) {
        findings.push(
          `${name} · ${rule[1]!.trim().replace(/\s+/g, ' ')} · ` +
            `${fg[1]} on ${bg[1]} = ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }

  it('every rule that sets both a background and a text colour reaches 4.5:1', () => {
    expect(findings).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE PASTRY DRESS: measured, and kept to the one screen it was approved for.
//
// The recipe page re-binds §16's colour names to the cream-and-chocolate
// palette on its own root element. That is invisible to the audit above: it
// reads `background: var(--c-paper)` against `--c-paper`'s value in `:root`,
// which is the right answer everywhere EXCEPT inside `.page`. So the new
// pairings are measured here directly, and the scoping is asserted — because
// "it only affects the recipe screen" is the whole reason this shape was
// chosen, and one stray declaration in `:root` would silently re-dress the
// entire app.
describe('the pastry palette (recipe screen)', () => {
  const pastry = (name: string): string => {
    const hex = HEX[name];
    expect(hex, `${name} is declared in tokens.css`).toBeTruthy();
    return hex!;
  };

  const cream = () => pastry('--c-cream');
  const ivory = () => pastry('--c-ivory');
  const cocoa = () => pastry('--c-cocoa');
  const soft = () => pastry('--c-cocoa-soft');
  const deep = () => pastry('--c-cream-deep');

  it('chocolate reads on both papers, with room to spare', () => {
    expect(contrast(cream(), cocoa())).toBeGreaterThanOrEqual(7);
    expect(contrast(ivory(), cocoa())).toBeGreaterThanOrEqual(7);
  });

  it('the secondary brown reaches AA on both papers — it carries real text', () => {
    expect(contrast(cream(), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ivory(), soft())).toBeGreaterThanOrEqual(4.5);
  });

  it('the deep cream fill carries both text colours', () => {
    // The step-number disc and the soft note sit on it.
    expect(contrast(deep(), cocoa())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(deep(), soft())).toBeGreaterThanOrEqual(4.5);
  });

  it('ivory reads on chocolate, which is the primary button', () => {
    expect(contrast(cocoa(), ivory())).toBeGreaterThanOrEqual(7);
  });

  it('caramel is never asked to be text on a light surface', () => {
    /*
      1.87:1 on cream. It is a hairline and a fill, and the brief says so in
      as many words. This test states the fact so that a future rule that
      makes it a colour has to argue with a number.
    */
    expect(contrast(cream(), pastry('--c-caramel'))).toBeLessThan(3);
  });

  it('is applied on the recipe page and nowhere else', () => {
    const rebinds = /--c-(?:app-bg|paper|ink|muted|green|line|sand|white|neutral-bg)\s*:\s*var\(--c-(?:cream|ivory|cocoa|caramel|cream-deep)/;

    for (const sheet of moduleSheets()) {
      const css = readFileSync(sheet, 'utf8');
      const name = sheet.slice(SRC.length + 1);
      for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!rebinds.test(rule[2]!)) continue;
        // The captured "selector" carries whatever comment preceded it.
        const selector = rule[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        expect(
          `${name} · ${selector}`,
          'only the recipe page may wear the pastry palette',
        ).toBe('features/recipe/recipe.module.css · .page');
      }
    }
  });

  it('and `:root` still serves every other screen §16', () => {
    // The palette is DECLARED globally so it can be measured; it must not be
    // USED globally.
    const root = /:root\s*\{([^}]*)\}/g;
    for (const block of tokens.matchAll(root)) {
      expect(block[1]).not.toMatch(/--c-app-bg:\s*var\(--c-cream\)/);
      expect(block[1]).not.toMatch(/--c-ink:\s*var\(--c-cocoa\)/);
    }
    expect(tokens).toContain('--c-app-bg: #fbfbf9');
  });
});
