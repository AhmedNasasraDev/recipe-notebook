/*
  THE FOUR TAB GLYPHS — ONE SET, ONE GRID, ONE WEIGHT.

  WHY THEY ARE DRAWN HERE AND NOT IMPORTED

  Ahmed asked for icons from a single library, in a consistent line style, and
  said to use one the project already has if it fits. It has none: `apps/web`
  depends on React, the router, Supabase and idb-keyval, and nothing else. So
  the choice was to add a dependency for four glyphs or to draw four glyphs.

  These are drawn, to one set of rules, which is what "the same library" buys
  in the first place:

    · a 24×24 box, `viewBox="0 0 24 24"`, with the drawing inset to ~20px so
      the four optical weights match
    · `fill: none`, stroke from `currentColor`, round caps and round joins
    · ONE stroke width for the whole bar, handed in as a prop — so the active
      tab's heavier line is a property of the set rather than a per-icon tweak

  If a library is preferred later (Lucide and Feather both have all four of
  these), swapping is a change to this file alone: the bar imports `TAB_ICON`
  and knows nothing about how a glyph is made.

  Every icon is `aria-hidden`. The name of each destination lives on the link,
  in Hebrew, where a screen reader expects it.
*/

interface IconProps {
  /** One weight for the whole bar; the active tab is drawn heavier. */
  width: number;
}

const base = (width: number) => ({
  viewBox: '0 0 24 24',
  width: 26,
  height: 26,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

/** בית */
function HomeIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M3.8 10.4 12 4l8.2 6.4" />
      <path d="M5.6 9.6V18a1.6 1.6 0 0 0 1.6 1.6h9.6a1.6 1.6 0 0 0 1.6-1.6V9.6" />
      <path d="M9.8 19.6v-4.4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v4.4" />
    </svg>
  );
}

/** מחברת — an open book */
function BookIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M12 7.6C10.7 6.3 8.8 5.6 6.8 5.6c-.9 0-1.8.1-2.6.4v12c.8-.3 1.7-.4 2.6-.4 2 0 3.9.7 5.2 2" />
      <path d="M12 7.6c1.3-1.3 3.2-2 5.2-2 .9 0 1.8.1 2.6.4v12c-.8-.3-1.7-.4-2.6-.4-2 0-3.9.7-5.2 2" />
      <path d="M12 7.6v12" />
    </svg>
  );
}

/** קבוצות — a group of people */
function PeopleIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <circle cx="9.4" cy="8.6" r="2.9" />
      <path d="M3.9 19.4c0-2.7 2.5-4.6 5.5-4.6s5.5 1.9 5.5 4.6" />
      <path d="M16.4 6.2a2.6 2.6 0 0 1 0 5.1" />
      <path d="M17.4 14.5c1.7.5 2.9 1.8 2.9 3.5" />
    </svg>
  );
}

/** עוד — three horizontal dots */
function MoreIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <circle cx="5.6" cy="12" r="1.1" />
      <circle cx="12" cy="12" r="1.1" />
      <circle cx="18.4" cy="12" r="1.1" />
    </svg>
  );
}

/** Keyed by the tab's own `to`, so the bar cannot pair a glyph with the wrong
    destination by getting an array order wrong. */
export const TAB_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  '/home': HomeIcon,
  '/notebook': BookIcon,
  '/groups': PeopleIcon,
  '/more': MoreIcon,
};

/** §16 keeps its weights in one place; so does this set. */
export const ICON_STROKE = { rest: 1.6, active: 2.3 } as const;
