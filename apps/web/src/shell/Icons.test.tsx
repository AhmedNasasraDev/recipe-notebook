import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  CATEGORY_ICON,
  ChevronIcon,
  ICON_STROKE,
  MENU_ICON,
  SendIcon,
  SPOON_PATH,
  SpoonIcon,
  TAB_ICON,
  TOOL_ICON,
} from './Icons.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'Icons.tsx'), 'utf8');

/*
  ── THE ICONS COME FROM A LIBRARY, AND STAY THAT WAY ────────────────────────

  Ahmed: "אני רוצה אייקונים מוכנים ממקור מקצועי, ולא סמלים שמצוירים או
  מומצאים באופן עצמאי… אל תצייר נתיבי SVG משלך, אל תחליף אייקונים באימוג׳י
  ואל תערבב משפחות שונות."

  Every one of those four instructions is a thing a future edit can quietly
  undo — one `<path d="…">` added "just for this one glyph" and the set is
  mixed again. So each is a test, and they read the module's SOURCE, because
  that is where the mistake gets written.
*/
describe('the icon set', () => {
  it('draws nothing by hand', () => {
    /*
      No geometry in this file except ONE path, and that one is checked against
      the library it came from in the case below. If a glyph is missing from a
      catalogue the answer is a different catalogue, not a drawing.
    */
    for (const tag of ['<circle', '<ellipse', '<rect', '<polyline', '<polygon', '<line']) {
      expect(source).not.toContain(tag);
    }
    expect(source.match(/<path/g) ?? []).toHaveLength(1);
    expect(source.match(/\bd=\{?/g)?.filter((m) => m === 'd={') ?? []).toHaveLength(1);
  });

  it('takes the one borrowed glyph from Hugeicons, byte for byte', () => {
    /*
      THE CLAIM "THIS IS THE LIBRARY'S SPOON" IS A FACT, NOT A COMMENT.

      Lucide has no spoon — searched, all 1,748 names — and Ahmed asked for one
      from another library. This reads the published `spoon` out of
      `@iconify-json/hugeicons` and compares it to the string the application
      ships. Anybody who "tidies up" that path, or replaces it with something
      drawn by hand, fails here with a diff.
    */
    const set = JSON.parse(
      readFileSync(
        join(HERE, '..', '..', '..', '..', 'node_modules', '@iconify-json', 'hugeicons', 'icons.json'),
        'utf8',
      ),
    ) as { icons: Record<string, { body: string }> };
    const published = /d="([^"]+)"/.exec(set.icons['spoon']!.body)?.[1];
    expect(published).toBeTruthy();
    expect(SPOON_PATH).toBe(published);
  });

  it('imports from exactly one family at runtime', () => {
    /* The Hugeicons package is a devDependency read by the test above; nothing
       is imported from it here, so the bundle carries one icon library. */
    const families = [...source.matchAll(/from '([^']+)'/g)]
      .map((m) => m[1]!)
      .filter((m) => !m.startsWith('.') && m !== 'react');
    expect([...new Set(families)]).toEqual(['lucide-react']);
  });

  it('draws the spoon at the set\'s own weight, at either size', () => {
    /* The borrowed glyph does not get Lucide's `absoluteStrokeWidth`, so the
       same arithmetic is done by hand — and therefore measured. */
    const { container } = render(
      <>
        <SpoonIcon />
        {TOOL_ICON['tbsp']?.({ width: ICON_STROKE.rest })}
      </>,
    );
    const [inline, big] = [...container.querySelectorAll('svg')];
    expect(inline?.getAttribute('width')).toBe('20');
    expect(Number(inline?.getAttribute('stroke-width'))).toBeCloseTo(2.1, 5);
    expect(big?.getAttribute('width')).toBe('24');
    expect(Number(big?.getAttribute('stroke-width'))).toBeCloseTo(1.75, 5);
    expect(inline?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no emoji in it', () => {
    expect(source).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('runs at one resting weight everywhere, and one heavier weight for state', () => {
    /*
      The set used to run at 1.6, 1.7 and 2.3 depending on where a glyph was
      used. `menu` is kept as a NAME because several screens import it, and it
      is now the same number as `rest` — that equality is the fix, so it is
      asserted rather than left to be re-diverged.
    */
    expect(ICON_STROKE.menu).toBe(ICON_STROKE.rest);
    expect(ICON_STROKE.active).toBeGreaterThan(ICON_STROKE.rest);
  });

  it('renders two sizes and no others, at one apparent line weight', () => {
    /*
      `absoluteStrokeWidth` is what makes 20px and 24px glyphs look like the
      same pen: Lucide divides the stroke by the scale, so the rendered line
      is identical. Measured on the DOM rather than trusted: a 24px glyph
      asking for 1.75 must carry a stroke-width of 1.75, and a 20px one must
      carry 1.75 × 24/20 = 2.1.
      */
    const { container } = render(
      <>
        {TAB_ICON['/notebook']?.({ width: ICON_STROKE.rest })}
        <ChevronIcon />
      </>,
    );
    const [big, small] = [...container.querySelectorAll('svg')];
    expect(big?.getAttribute('width')).toBe('24');
    expect(Number(big?.getAttribute('stroke-width'))).toBeCloseTo(1.75, 5);
    expect(small?.getAttribute('width')).toBe('20');
    expect(Number(small?.getAttribute('stroke-width'))).toBeCloseTo(2.1, 5);
  });

  it('hides every glyph from the accessibility tree', () => {
    /* The name of a destination or an action lives on its control, in Hebrew.
       A glyph that announces itself is a second, English-shaped name. */
    const all = [
      ...Object.values(TAB_ICON),
      ...Object.values(MENU_ICON),
      ...Object.values(CATEGORY_ICON),
      ...Object.values(TOOL_ICON),
    ];
    for (const Glyph of all) {
      const { container, unmount } = render(<>{Glyph({ width: ICON_STROKE.rest })}</>);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
      unmount();
    }
  });

  it('flies the send plane the way Hebrew runs', () => {
    /*
      Lucide's `Send` points up and to the RIGHT, which is the direction Latin
      text runs. Mirrored on X here, as a transform on the library's glyph —
      not a redrawn path. Ahmed: "התאם אייקונים כיווניים לעברית לפי משמעות
      הפעולה."
    */
    const { container } = render(<SendIcon />);
    expect(container.querySelector('svg')?.getAttribute('style')).toContain('scaleX(-1)');
  });

  it('gives the four destinations four different glyphs', () => {
    const paths = Object.values(TAB_ICON).map((Glyph) => {
      const { container, unmount } = render(<>{Glyph({ width: ICON_STROKE.rest })}</>);
      const html = container.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(paths).size).toBe(4);
  });
});
