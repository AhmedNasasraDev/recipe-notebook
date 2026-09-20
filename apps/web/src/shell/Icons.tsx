/*
  THE ICON SET — ONE GRID, ONE WEIGHT, EVERY GLYPH IN THE APPLICATION.

  WHY THEY ARE DRAWN HERE AND NOT IMPORTED

  Ahmed asked for icons from a single library, in a consistent line style, and
  said to use one the project already has if it fits. It has none: `apps/web`
  depends on React, the router, Supabase and idb-keyval, and nothing else. So
  the choice was to add a dependency or to draw the glyphs. They are drawn —
  first the four tab destinations, then the four cards on "עוד" and the
  chevron they carry, all to the same rules.

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

/* ── the "עוד" menu, and the chevron its cards carry ─────────────────────── */

/** חומרי גלם ומחירים — an ear of wheat */
function WheatIcon({ width }: IconProps) {
  /*
    A stem with three pairs of awns. The first drawing used closed leaf shapes
    and, at the 26px this is actually rendered at, they collapsed into specks
    on a stick — legible in a viewer at 200%, not on a card. Open strokes at
    the same weight as every other glyph in the set read as an ear of wheat at
    the size it is used.
  */
  return (
    <svg {...base(width)}>
      <path d="M12 21V5.4" />
      <path d="M12 8.6 7.6 6.1M12 8.6l4.4-2.5" />
      <path d="M12 12.6 7.6 10.1M12 12.6l4.4-2.5" />
      <path d="M12 16.6 7.6 14.1M12 16.6l4.4-2.5" />
    </svg>
  );
}

/** תכנון ייצור ורכש — a clipboard with ticks */
function ClipboardIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M9 4.6H7.4A1.6 1.6 0 0 0 5.8 6.2v12.6a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V6.2a1.6 1.6 0 0 0-1.6-1.6H15" />
      <rect x="9" y="3" width="6" height="3.2" rx="1.1" />
      <path d="M8.8 11.4l1.2 1.2 2.1-2.1" />
      <path d="M8.8 15.8l1.2 1.2 2.1-2.1" />
      <path d="M14.6 11.6h2.2M14.6 16h2.2" />
    </svg>
  );
}

/** כלי המדידה שלי — a measuring jug */
function JugIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      {/* the pouring lip, then the body, then the handle */}
      <path d="M6.6 8.4 4.7 6.6" />
      <path d="M6.6 8.4h9.6v8.6a2.8 2.8 0 0 1-2.8 2.8H9.4a2.8 2.8 0 0 1-2.8-2.8z" />
      <path d="M16.2 10.6h1.5a2.3 2.3 0 0 1 0 4.6h-1.5" />
      {/* the measure marks */}
      <path d="M9.2 11.6h3.4M9.2 14.2h3.4M9.2 16.8h2.2" />
    </svg>
  );
}

/** הגדרות — a gear */
function GearIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l1.7-1.3-1.7-3-2 .8a7 7 0 0 0-2-1.2L14.5 4h-5l-.4 2.1a7 7 0 0 0-2 1.2l-2-.8-1.7 3 1.7 1.3a7 7 0 0 0 0 2.4l-1.7 1.3 1.7 3 2-.8a7 7 0 0 0 2 1.2l.4 2.1h5l.4-2.1a7 7 0 0 0 2-1.2l2 .8 1.7-3-1.7-1.3c.06-.4.1-.8.1-1.2z" />
    </svg>
  );
}

/**
 * The chevron on a menu card, pointing the way the card goes.
 *
 * The application is RTL, so "forward" is to the LEFT — which is what the
 * design shows and what this draws. It is decoration: the card is a link and
 * its name is the title.
 */
export function ChevronIcon({ width = 1.8 }: { width?: number }) {
  return (
    <svg {...base(width)} width={20} height={20}>
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

/* ── categories, on the home screen ──────────────────────────────────────
   The tiles carried emojis — 🥖, 🍫 — which render as a different artist's
   work in a different style, in colour, beside a set of line glyphs. Ahmed
   asked for one set and no emojis. These are the same 24×24 grid and the same
   stroke as everything above. A category with no glyph of its own shows its
   name alone, which was the whole answer before. */

/** בצקים · לחמים — a loaf */
function LoafIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M4.6 14.6c0-3.8 3.3-6.8 7.4-6.8s7.4 3 7.4 6.8v1.2a1.6 1.6 0 0 1-1.6 1.6H6.2a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M9.2 8.4c.6 1.6.6 3.2 0 4.8M12.6 8.1c.6 1.7.6 3.4 0 5.1M16 9c.5 1.4.5 2.8 0 4.2" />
    </svg>
  );
}

/** קרמים ומילויים — a bowl and a whisk */
function BowlIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M4.4 12.4h15.2a7.6 7.6 0 0 1-7.6 7.2 7.6 7.6 0 0 1-7.6-7.2z" />
      <path d="M14.6 9.6 17 4.4" />
      <path d="M12.8 9.8c.4-1.8 1.4-3.4 2.9-4.5" />
    </svg>
  );
}

/** גנאשים ורטבים · שוקולד — a drop */
function DropIcon({ width }: IconProps) {
  /*
    This was a chocolate bar — a rounded rectangle with a cross through it —
    and at 26px on a category tile it read as a spreadsheet. A drop says
    ganache and sauce at any size, and has no other reading.
  */
  return (
    <svg {...base(width)}>
      <path d="M12 3.4c3.7 4.5 5.6 7.6 5.6 10.1a5.6 5.6 0 1 1-11.2 0c0-2.5 1.9-5.6 5.6-10.1z" />
      <path d="M9.2 13.8a2.9 2.9 0 0 0 2.2 3.4" />
    </svg>
  );
}

/** עוגות ועוגיות · קינוחים — a slice */
function CakeIcon({ width }: IconProps) {
  return (
    <svg {...base(width)}>
      <path d="M4.8 18.6v-5.2c0-2.2 3.2-4 7.2-4s7.2 1.8 7.2 4v5.2" />
      <path d="M4.8 13.4c0 2.2 3.2 4 7.2 4s7.2-1.8 7.2-4" />
      <path d="M12 9.4V6.6M12 5.4a1 1 0 1 0 0-.1" />
      <path d="M4.8 18.6h14.4" />
    </svg>
  );
}

export const CATEGORY_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  בצקים: LoafIcon,
  לחמים: LoafIcon,
  מאפים: LoafIcon,
  'קרמים ומילויים': BowlIcon,
  ממרחים: BowlIcon,
  'גנאשים ורטבים': DropIcon,
  שוקולד: DropIcon,
  'עוגות ועוגיות': CakeIcon,
  קינוחים: CakeIcon,
};

export const MENU_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  '/ingredients': WheatIcon,
  '/plans': ClipboardIcon,
  '/tools': JugIcon,
  '/settings': GearIcon,
};

/** §16 keeps its weights in one place; so does this set. */
export const ICON_STROKE = { rest: 1.6, active: 2.3, menu: 1.7 } as const;
