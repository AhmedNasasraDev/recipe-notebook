import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(HERE, 'tokens.css'), 'utf8');

const SRC = join(HERE, '..');
const moduleSheets = (): string[] =>
  globSync('**/*.module.css', { cwd: SRC }).map((f) => join(SRC, f));

const HEX: Readonly<Record<string, string>> = Object.fromEntries(
  [...tokens.matchAll(/(--c-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
);

/**
 * The names the stylesheets read are mostly ALIASES now — `--c-paper` holds
 * `var(--c-surface)`, Cook Mode's surface holds the page's — which is the
 * point: one palette, named once, pointed at from the structural names. A
 * guard that cannot follow an alias measures nothing, so this follows the
 * chain to the hex at the end of it.
 */
const ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  [...tokens.matchAll(/(--c-[\w-]+):\s*var\((--c-[\w-]+)\)/g)].map((m) => [m[1]!, m[2]!]),
);

const hexOf = (name: string, seen = new Set<string>()): string | undefined => {
  if (seen.has(name)) return undefined; // a cycle is a bug, not a colour
  seen.add(name);
  const direct = HEX[name];
  if (direct) return direct;
  const next = ALIAS[name];
  return next ? hexOf(next, seen) : undefined;
};

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


/**
 * THE PALETTE IS A CONTRACT — a different one from §16's, and Ahmed's.
 *
 * §16's colours were asserted here verbatim for eleven stages under HANDOFF
 * §8 ("do not change the design language without a professional reason"). The
 * reason is now on the record: Ahmed designed the pâtisserie language, approved
 * it on the recipe screen, and then approved rolling it across the application.
 * So the table below is the new one, and the guards that used to keep the new
 * palette OUT of other screens are replaced by guards that keep it UNIFORM.
 *
 * Everything structural §16 specified is still asserted further down: the
 * tokens every stylesheet uses must exist, the container queries must name a
 * real container, the hit target stays 44px, and every background/text pair
 * has to measure 4.5:1.
 */
const PALETTE: readonly [string, string][] = [
  ['שמנת בהירה', '#f7f5ef'],
  ['כרטיסים ומשטחים', '#fffefa'],
  ['ירוק מרווה', '#496451'],
  ['פחם חם', '#292d29'],
  ['מסגרות', '#ded8cc'],
  ['רקע בחירה', '#e7ede4'],
];

describe('the design system is one palette, in one place', () => {
  for (const [name, hex] of PALETTE) {
    it(`${name} = ${hex}`, () => {
      expect(tokens.toLowerCase()).toContain(hex);
    });
  }

  it('binds the names every stylesheet reads to that palette', () => {
    for (const [token, source] of [
      ['--c-app-bg', '--c-base'],
      ['--c-paper', '--c-surface'],
      ['--c-ink', '--c-text'],
      ['--c-muted', '--c-muted-ink'],
      ['--c-line', '--c-border'],
      ['--c-green', '--c-accent'],
    ] as const) {
      expect(tokens).toMatch(new RegExp(`${token}:\\s*var\\(${source}\\)`));
    }
  });

  it('keeps warning and error as their own colours, and merges success with the action green', () => {
    /*
      Ahmed: "שמור צבעים מובחנים להצלחה, אזהרה ושגיאה." With a GREEN action
      colour, a second different green for "correct" is two greens nobody can
      tell apart — so success is the sage and the distinction that carries
      meaning is kept where it matters: amber and red are their own hues, and
      neither is the action colour.
    */
    expect(tokens).toMatch(/--c-ok:\s*var\(--c-accent\)/);
    expect(tokens).toMatch(/--c-source-exact:\s*var\(--c-ok\)/);
    expect(tokens).toMatch(/--c-amber:\s*#/);
    expect(tokens).toMatch(/--c-red:\s*#/);
    for (const semantic of ['--c-amber', '--c-red']) {
      expect(hexOf(semantic)).not.toBe(hexOf('--c-accent'));
    }
    // And the two of them are not each other.
    expect(hexOf('--c-amber')).not.toBe(hexOf('--c-red'));
  });

  it('declares ONE Hebrew face, and serves it from this project', () => {
    /*
      Ahmed's decision: Heebo for the whole interface, headings included. Both
      of the family names the rules use hold it, so a heading differs by size
      and weight and never by a change of voice — and the two faces it
      replaced must be gone, not merely unused.
    */
    expect(tokens).toMatch(/--font-body:\s*'Heebo'/);
    expect(tokens).toMatch(/--font-display:\s*'Heebo'/);
    expect(tokens).not.toContain('Frank Ruhl Libre');
    expect(tokens).not.toContain('Assistant');

    /*
      A `font-family` declaration is not a font. These are the @font-face rules
      that make the two faces real, pointing at files inside the repository —
      the app must not depend on a third-party host being reachable, which in
      this project's own audit environment it is not.
    */
    const faces = readFileSync(join(HERE, 'fonts.css'), 'utf8');
    for (const file of ['heebo-hebrew.woff2', 'heebo-latin.woff2']) {
      expect(faces).toContain(file);
      expect(existsSync(join(HERE, 'fonts', file))).toBe(true);
    }
    // The weights the hierarchy uses — 400 body, 500 quantities, 600 headings
    // — all come from the one variable file, so its range has to cover them.
    expect(faces).toMatch(/font-weight:\s*400 700/);
    // The Hebrew subsets have to cover the Hebrew block, or a Hebrew page
    // silently falls back while the CSS looks correct.
    expect(faces).toContain('U+0590-05FF');
    // …and the shekel sign, which lives outside it.
    expect(faces).toContain('U+20AA');
    expect(faces).toContain('font-display: swap');
    // OFL 1.1 requires the notice to travel with the files.
    expect(existsSync(join(HERE, 'fonts', 'OFL.txt'))).toBe(true);
  });

  it('nothing loads a font from a third party any more', () => {
    const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('uses three weights, and never the heavy one', () => {
    /*
      Ahmed: "כותרות 500–600 · הוראות, רכיבים ותיאורים 400 · כמויות ופעולות
      חשובות 500–600… אל תשתמש במשקל כבד בכל מקום." Heebo's file carries 700,
      so nothing stops a stylesheet asking for it; this is what stops it.
    */
    expect(tokens).toMatch(/--fw-body:\s*400/);
    const mid = Number(/--fw-mid:\s*(\d+)/.exec(tokens)?.[1]);
    const title = Number(/--fw-title:\s*(\d+)/.exec(tokens)?.[1]);
    expect(mid).toBeGreaterThanOrEqual(500);
    expect(title).toBeGreaterThanOrEqual(500);
    expect(title).toBeLessThanOrEqual(600);

    const heavy: string[] = [];
    for (const sheet of [...moduleSheets(), join(HERE, 'global.css')]) {
      const css = readFileSync(sheet, 'utf8');
      // The variable range in fonts.css (`400 700`) is a different thing and
      // is not matched here: this looks for a single resolved weight.
      for (const m of css.matchAll(/font-weight:\s*(\d{3}|bold(?:er)?)\s*;/g)) {
        const w = m[1] ?? '';
        if (w === 'bold' || w === 'bolder' || Number(w) > 600) {
          heavy.push(`${sheet.slice(SRC.length + 1)}: ${w}`);
        }
      }
    }
    expect(heavy).toEqual([]);
  });

  it('never fades a disabled control below legibility', () => {
    /*
      Ahmed asked for the contrast to be checked in practice, "כולל טקסט משני
      ומצבי כפתורים". Every disabled button in the app was an `opacity` fade
      (0.3–0.6), which computes to 1.6:1–2.9:1 on this light page. The state is
      a flat neutral fill with the secondary ink now; the only fade left is on
      a label-less icon, and it has a floor.
    */
    expect(contrast(hexOf('--c-off-ink') ?? '', hexOf('--c-off-bg') ?? '')).toBeGreaterThanOrEqual(4.5);

    const faded: string[] = [];
    for (const sheet of moduleSheets()) {
      const css = readFileSync(sheet, 'utf8');
      for (const m of css.matchAll(/([^{}]*(?::disabled|\[disabled\])[^{}]*)\{([^}]*)\}/g)) {
        const value = /opacity:\s*([\d.]+)/.exec(m[2] ?? '')?.[1];
        if (value !== undefined && Number(value) < 0.75) {
          faded.push(`${sheet.slice(SRC.length + 1)}: ${(m[1] ?? '').trim()} → ${value}`);
        }
      }
    }
    expect(faded).toEqual([]);
  });

  it('keeps the 44px minimum hit target (§15)', () => {
    expect(tokens).toMatch(/--hit-min:\s*44px/);
  });

  it('keeps the working text at 16px on a phone', () => {
    // Ahmed: "טקסט העבודה המרכזי יהיה בדרך כלל בגודל 16px לפחות בנייד."
    expect(tokens).toMatch(/--fs-body:\s*16px/);
    const smallest = Number(/--fs-label:\s*(\d+(?:\.\d+)?)px/.exec(tokens)?.[1]);
    expect(smallest).toBeGreaterThanOrEqual(11);
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
// THE PALETTE, MEASURED — AND THE SAME EVERYWHERE.
//
// While the dress was approved for the recipe screen only, this block measured
// the new pairings AND asserted that no other stylesheet wore them. Ahmed has
// since approved the roll-out and asked, in as many words, for the guards that
// kept the palette out of other screens to be replaced by guards that keep it
// uniform. So the measurements stay — they are what makes the palette safe to
// use — and the scoping test is inverted: the colours come from `:root`, and
// no module may declare a palette of its own.
describe('the palette, measured', () => {
  const pastry = (name: string): string => {
    const hex = hexOf(name);
    expect(hex, `${name} resolves to a colour in tokens.css`).toBeTruthy();
    return hex!;
  };

  const base = () => pastry('--c-base');
  const surface = () => pastry('--c-surface');
  const text = () => pastry('--c-text');
  const soft = () => pastry('--c-muted-ink');
  const select = () => pastry('--c-select');
  const accent = () => pastry('--c-accent');

  it('the charcoal reads on the page and on a card, with room to spare', () => {
    expect(contrast(base(), text())).toBeGreaterThanOrEqual(7);
    expect(contrast(surface(), text())).toBeGreaterThanOrEqual(7);
  });

  it('the secondary ink reaches AA on every surface it is used on', () => {
    for (const bg of [base(), surface(), select(), pastry('--c-outer-bg')]) {
      expect(contrast(bg, soft())).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the selection fill carries the text, the secondary ink and the green', () => {
    expect(contrast(select(), text())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(select(), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(select(), accent())).toBeGreaterThanOrEqual(4.5);
  });

  it('the green works as an action — as ink on the page and as a filled button', () => {
    expect(contrast(base(), accent())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(surface(), accent())).toBeGreaterThanOrEqual(4.5);
    // A filled button: the surface colour as its label.
    expect(contrast(accent(), surface())).toBeGreaterThanOrEqual(4.5);
  });

  it('the meaning colours reach AA on the surfaces they appear on', () => {
    for (const [ink, bg] of [
      ['--c-ok', '--c-ok-bg'],
      ['--c-amber', '--c-amber-bg'],
      ['--c-red', '--c-red-bg'],
    ] as const) {
      expect(contrast(pastry(bg), pastry(ink)), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(base(), pastry(ink)),
        `${ink} on the app background`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Cook Mode is light now, and every pairing on it measures', () => {
    /*
      It was the one dark screen — §16's near-black, then a dark chocolate.
      Ahmed's decision is that the weighing list and the steps are light like
      the rest of the application, so these pairings are the same ones the
      light screens use and are held to the same floor.
    */
    const bg = pastry('--c-cook-bg');
    expect(contrast(bg, pastry('--c-cook-text'))).toBeGreaterThanOrEqual(7);
    expect(contrast(bg, pastry('--c-cook-muted'))).toBeGreaterThanOrEqual(4.5);
    // A filled control there: the action green with the surface on it.
    expect(contrast(bg, pastry('--c-cook-accent'))).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(pastry('--c-cook-accent'), pastry('--c-cook-on-accent')),
    ).toBeGreaterThanOrEqual(4.5);
    // And it is a LIGHT screen: its surface IS the application's own page,
    // rather than a dark value of its own.
    expect(hexOf('--c-cook-bg')).toBe(hexOf('--c-base'));
    expect(tokens).toMatch(/--c-cook-bg:\s*var\(--c-base\)/);
  });

  it('the border colour is never asked to be text', () => {
    // #ded8cc is 1.30:1 on the page. It draws edges and fills shapes.
    expect(contrast(base(), pastry('--c-border'))).toBeLessThan(3);
  });

  it('no module declares a palette of its own', () => {
    /*
      THE UNIFORMITY GUARD, which replaced the scoping one.

      One place holds the colours. A stylesheet that declares a `--c-*` name is
      how two screens start disagreeing about what "paper" is — the drift this
      roll-out cleaned up. The dark screen is not an exception: its surface is
      `--c-cook-*`, declared in tokens.css with everything else.
    */
    const offenders: string[] = [];
    for (const sheet of moduleSheets()) {
      const css = readFileSync(sheet, 'utf8');
      const name = sheet.slice(SRC.length + 1);
      for (const m of css.matchAll(/(--c-[a-z0-9-]+)\s*:/g)) {
        offenders.push(`${name} declares ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
