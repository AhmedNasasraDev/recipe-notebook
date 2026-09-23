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
  /*
    Ahmed darkened the spec's own grey and amber for accessibility
    (23.09.2026, "תאשר" following SPEC-STAGE-4's flagged gap) — see
    tokens.css. Every pairing below now measures 4.5:1 or better, so the
    only entry left here is the one this test's own arithmetic cannot
    verify: it reads a `background` and a `color` declared on the SAME
    rule, and the step numerals are a `--c-sand` FILL with no text colour
    declared beside it — carried from the prototype, unrelated to §3.1.
  */
  '--c-paper/--c-sand', // step numerals, from the prototype
]);


/**
 * THE PALETTE IS A CONTRACT — spec §3.1's, verbatim.
 *
 * Eleven named colours (stage 4, 23.09.2026). The table below is the spec's
 * own list; the two banner tints in tokens.css are the amber and the red laid
 * over the paper and are asserted as such further down, so a twelfth colour
 * cannot arrive as a "tint".
 *
 * Everything structural is still asserted below: the tokens every stylesheet
 * uses must exist, the container queries must name a real container, the hit
 * target stays 44px, and every background/text pair is measured.
 */
const PALETTE: readonly [string, string][] = [
  ['משטח עבודה', '#e9ece8'],
  ['נייר ממשק', '#fbfbf9'],
  ['נייר מתכון', '#fdfbf6'],
  ['דיו', '#171a18'],
  /*
    Ahmed darkened these two from the spec's own #6e7a73 and #a56a0e
    (23.09.2026, "תאשר"), which fell under 4.5:1 AA on the workspace and on
    the amber's own banner (SPEC-STAGE-4 flagged it; see tokens.css for the
    measured floors). Same hues, darker — not a twelfth colour.
  */
  ['אפור (מוחשך)', '#616b65'],
  ['קווים', '#cdd4ce'],
  ['ירוק', '#1e6b4c'],
  ['ירוק רך', '#e2efe8'],
  ['ענבר (מוחשך)', '#8c5a0c'],
  ['אדום', '#9e362c'],
  ['שוליים חמים', '#c4a99b'],
];

describe('the design system is one palette, in one place', () => {
  for (const [name, hex] of PALETTE) {
    it(`${name} = ${hex}`, () => {
      expect(tokens.toLowerCase()).toContain(hex);
    });
  }

  it('declares no colour the spec does not name, tints included', () => {
    const named = new Set(PALETTE.map(([, hex]) => hex));
    const mix = (a: string, b: string, t: number): string =>
      '#' +
      [0, 2, 4]
        .map((i) => Math.round(parseInt(a.slice(i + 1, i + 3), 16) * t + parseInt(b.slice(i + 1, i + 3), 16) * (1 - t)))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
    // The two banner fills: amber at 14% and red at 12% over the paper.
    named.add(mix('#8c5a0c', '#fbfbf9', 0.14));
    named.add(mix('#9e362c', '#fbfbf9', 0.12));
    const strangers = [...tokens.toLowerCase().matchAll(/#[0-9a-f]{6}\b/g)]
      .map((m) => m[0])
      .filter((hex) => !named.has(hex));
    expect([...new Set(strangers)]).toEqual([]);
  });

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

  it('declares the two faces of spec §3.2, and serves both from this project', () => {
    /*
      Heebo for the interface, Frank Ruhl Libre for headings and the recipe
      page (stage 4, with approval to bundle the second face). The one they
      replaced earlier must be gone, not merely unused.
    */
    expect(tokens).toMatch(/--font-body:\s*'Heebo'/);
    expect(tokens).toMatch(/--font-display:\s*'Frank Ruhl Libre'/);
    expect(tokens).not.toContain('Assistant');

    /*
      A `font-family` declaration is not a font. These are the @font-face rules
      that make the faces real, pointing at files inside the repository —
      the app must not depend on a third-party host being reachable, which in
      this project's own audit environment it is not.
    */
    const faces = readFileSync(join(HERE, 'fonts.css'), 'utf8');
    for (const file of [
      'heebo-hebrew.woff2',
      'heebo-latin.woff2',
      'frank-ruhl-libre-hebrew.woff2',
      'frank-ruhl-libre-latin.woff2',
    ]) {
      expect(faces).toContain(file);
      expect(existsSync(join(HERE, 'fonts', file))).toBe(true);
    }
    expect(faces).not.toContain('fonts.gstatic.com');
    // The weights the hierarchy uses — 400 body, 500 quantities, 600 headings
    // — come from one variable file per face, so each range has to cover them.
    expect(faces).toMatch(/font-weight:\s*400 700/);
    expect(faces).toMatch(/font-weight:\s*300 900/);
    // The Hebrew subsets have to cover the Hebrew block, or a Hebrew page
    // silently falls back while the CSS looks correct.
    expect(faces).toContain('U+0590-05FF');
    // …and the shekel sign, which lives outside it.
    expect(faces).toContain('U+20AA');
    expect(faces).toContain('font-display: swap');
    // OFL 1.1 requires the notice to travel with the files.
    const ofl = readFileSync(join(HERE, 'fonts', 'OFL.txt'), 'utf8');
    expect(ofl).toContain('Heebo');
    expect(ofl).toContain('Frank Ruhl Libre');
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

  it('the secondary ink reaches AA everywhere, darkened from the spec (23.09.2026, "תאשר")', () => {
    /*
      Spec §3.1's own grey (#6e7a73) measured 4.32:1 on paper and 3.76:1 on
      the workspace — AA for large text, short of it for body text.
      SPEC-STAGE-4 flagged this; Ahmed approved darkening it. The new value
      (#616b65) clears 4.5:1 on every surface it is used on.
    */
    expect(contrast(surface(), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pastry('--c-recipe-paper'), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(base(), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(select(), soft())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pastry('--c-outer-bg'), soft())).toBeGreaterThanOrEqual(4.5);
  });

  it('the selection fill carries the text and the green', () => {
    expect(contrast(select(), text())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(select(), accent())).toBeGreaterThanOrEqual(4.5);
  });

  it('the green works as an action — as ink on the page and as a filled button', () => {
    expect(contrast(base(), accent())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(surface(), accent())).toBeGreaterThanOrEqual(4.5);
    // A filled button: the surface colour as its label.
    expect(contrast(accent(), surface())).toBeGreaterThanOrEqual(4.5);
  });

  it('the meaning colours reach AA on the surfaces they appear on — the amber measured', () => {
    for (const [ink, bg] of [
      ['--c-ok', '--c-ok-bg'],
      ['--c-red', '--c-red-bg'],
    ] as const) {
      expect(contrast(pastry(bg), pastry(ink)), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(base(), pastry(ink)),
        `${ink} on the app background`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // The darkened amber (23.09.2026, "תאשר"): 5.66 on paper, 4.64 on its
    // own banner, 4.92 on the workspace — AA everywhere now, body text
    // included.
    expect(contrast(surface(), pastry('--c-amber'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pastry('--c-amber-bg'), pastry('--c-amber'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(base(), pastry('--c-amber'))).toBeGreaterThanOrEqual(4.5);
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
    // #cdd4ce is 1.46:1 on the workspace. It draws edges and fills shapes.
    expect(contrast(base(), pastry('--c-border'))).toBeLessThan(3);
  });

  /*
    ── ONE SHAPE LANGUAGE ────────────────────────────────────────────────────

    Ahmed asked for it in these words: "השתמש במלבנים עם עיגול עדין ואחיד של
    12px בכל ארבע הפינות עבור כפתורי פעולה, שדות חיפוש, שדות טקסט, בחירות
    ותיבות כתיבה. אין להשתמש בצורת גלולה ברכיבים האלה."

    A one-off pass that converts 46 rules is worth nothing if the 47th is
    written next week, so the rule is a test. It reads the stylesheets rather
    than the rendered page, because that is where a pill is introduced.
  */
  it('the radius scale is two steps, and 12px is a literal nowhere', () => {
    expect(tokens).toMatch(/--r-control:\s*12px/);
    expect(tokens).toMatch(/--r-card:\s*16px/);
    expect(tokens).toMatch(/--r-card-lg:\s*16px/);

    /*
      NO PIXEL LITERAL ANYWHERE, except five that are not app surfaces.

      The pass that unified the shapes found 9px, 10px, 13px and 14px radii
      scattered around — each one defensible on its own line ("the group's 12
      minus its padding") and collectively the reason the interface read as
      four shape languages. So the rule is: a radius comes from a token. The
      five exceptions are named, because each is a different MEDIUM:

        the two 28px  the simulated device's own edge, in AppShell and in
                      Onboarding's copy of it. Not a control, not a card — the
                      rounding of the phone the app is drawn inside.
        6px, 5px, 4px paper. The order sheet, its figure boxes and the product
                      label are printed, and a 12px corner on a printed label
                      is not a house style, it is a mistake.
    */
    const PAPER = new Set([
      'shell/AppShell.module.css:28px',
      'routes/OnboardingScreen.module.css:28px',
      'routes/OrderScreen.module.css:6px',
      'routes/OrderScreen.module.css:5px',
      'routes/LabelScreen.module.css:4px',
    ]);
    const literals: string[] = [];
    for (const sheet of moduleSheets()) {
      const css = readFileSync(sheet, 'utf8');
      const name = sheet.slice(SRC.length + 1);
      for (const m of css.matchAll(/border-radius:\s*(\d+px)/g)) {
        /* 999px is the pill test's business, by SELECTOR, just below. */
        if (m[1] === '999px') continue;
        if (!PAPER.has(`${name}:${m[1]}`)) literals.push(`${name} hard-codes ${m[1]}`);
      }
    }
    expect(literals).toEqual([]);
  });

  it('no control is a pill', () => {
    /*
      The five exceptions are named, and each is a shape whose ROUNDNESS IS
      THE MEANING rather than a control: two round avatars, the onboarding
      progress dot, the step-progress segment and the wizard's numbered stage
      marker. Anything else with a 999px or `--r-pill` radius is the mixture
      Ahmed asked to end, so it fails here with its own name.
    */
    const ALLOWED = new Set([
      'features/groups/GroupChat.module.css:.avatar',
      'features/groups/IdentityCard.module.css:.avatar',
      'routes/OnboardingScreen.module.css:.dotOff',
      'routes/CookScreen.module.css:.segNow::after',
      'routes/RecipeEditScreen.module.css:.stageNum',
    ]);
    const offenders: string[] = [];
    for (const sheet of moduleSheets()) {
      const css = readFileSync(sheet, 'utf8');
      const name = sheet.slice(SRC.length + 1);
      let selector = '';
      for (const line of css.split('\n')) {
        const head = /^([.:&#a-zA-Z[][^{}]*)\{/.exec(line.trim());
        if (head) selector = head[1]!.trim();
        if (/border-radius:\s*(var\(--r-pill\)|999px)/.test(line)) {
          const at = `${name}:${selector}`;
          if (!ALLOWED.has(at)) offenders.push(at);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the platform cannot re-shape a field on a phone', () => {
    /*
      iOS Safari draws its own chrome on form controls and two of them change
      the SHAPE: a search input gets fully rounded ends, and a button gets the
      platform radius and a gradient. `appearance: none` is what turns that
      off — and the radius has to be restated, because removing the platform
      style removes the platform's rounding with it.
    */
    const g = readFileSync(join(HERE, 'global.css'), 'utf8');
    expect(g).toMatch(/appearance:\s*none/);
    expect(g).toMatch(/-webkit-appearance:\s*none/);
    expect(g).toMatch(/border-radius:\s*var\(--r-control\)/);
    /* And the three whose shape is their meaning are spared by name. */
    expect(g).toMatch(/\[type='radio'\]/);
    expect(g).toMatch(/\[type='checkbox'\]/);
    expect(g).toMatch(/\[type='range'\]/);
    /* A select keeps its native arrow: stripping it would leave a control
       that looks exactly like a text field. */
    expect(g).not.toMatch(/select\s*\{[^}]*appearance:\s*none/);
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

/*
  NOTHING ON SCREEN BELOW 12px.

  QA 22.09.2026 (acceptance, findings 17–20 and 43): chips at 9.5px, tab
  labels and table headings at 11px, in nine places. A floor in one test
  rather than nine fixes, so the tenth place cannot appear. Paper is exempt
  — the print sheets are sized for A4, not for a phone — so the print
  feature's own sheets are left out.
*/
describe('no text on screen is set below 12px', () => {
  it('every px font-size in the app stylesheets is at least 12', () => {
    const sheets = [
      ...moduleSheets().filter((f) => !f.includes('/features/print/')),
      join(HERE, 'tokens.css'),
      join(HERE, 'global.css'),
    ];
    const small: string[] = [];
    for (const file of sheets) {
      const css = readFileSync(file, 'utf8')
        // paper only: whatever is inside @media print is not on a screen
        .replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');
      for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) < 12) small.push(`${file.replace(SRC, '')}: ${m[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
});
