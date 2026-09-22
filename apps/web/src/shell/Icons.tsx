/*
  THE ICON SET — ONE WEIGHT, ONE GRID, AND NOTHING DRAWN BY HAND.

  ─────────────────────────────────────────────────────────────────────────────
  WHICH LIBRARY, AND WHY

  Lucide (`lucide-react`, ISC) for every glyph but one. It is the project's
  only icon dependency at runtime, and the glyphs come out of its published
  catalogue — 1,748 icons in the installed version — through its own React
  components. The exception is the spoon, which Lucide does not have; it comes
  from Hugeicons, verbatim and verified by the test suite, and the section
  below says exactly why and how. Nothing in this file is a path I drew.

  Ahmed asked: "בדוק איזו ספריית אייקונים קיימת בפרויקט… אם הסט הקיים אינו
  מתאים, בחר ספרייה מקצועית אחת והשתמש בה בעקביות." The project had none —
  every glyph in this file used to be an SVG path written by hand, which is
  exactly what he asked to stop. Lucide was chosen over the alternatives for
  three concrete reasons:

    · it is the maintained continuation of Feather, drawn on one 24×24 grid at
      one stroke weight, so a set picked from it is coherent by construction
    · it ships real React components, so the glyphs are tree-shaken into the
      bundle — the trial file and the Artifact page must work with ZERO
      outward requests, which rules out an icon font or a CDN sprite
    · ISC licence, no attribution burden

  ─────────────────────────────────────────────────────────────────────────────
  ONE WEIGHT AND ONE OPTICAL SIZE, MEASURED RATHER THAN DECLARED

  `absoluteStrokeWidth` is the reason every glyph here looks like the same
  pen. Lucide scales the stroke with the icon by default, so a 1.75 stroke
  drawn at 20px renders THINNER than the same 1.75 at 26px — the set used to
  mix 18, 20 and 26px boxes and therefore three apparent line weights. With
  the flag, Lucide divides the width by the scale, so the rendered line is the
  same thickness at every size. Two sizes are used and no more:

    SIZE.glyph  24  the tab bar, the "עוד" cards, the category tiles
    SIZE.inline 20  a glyph sitting beside or inside text

  And two weights, which is one weight plus one STATE:

    STROKE.rest   1.75  everything
    STROKE.active 2.5   the current tab only — §2 marks it three ways (the
                        filled marker, the heavier label, this heavier line)
                        so the state is never carried by colour alone

  ─────────────────────────────────────────────────────────────────────────────
  DIRECTION IS PART OF THE MEANING IN HEBREW

  Ahmed: "התאם אייקונים כיווניים לעברית לפי משמעות הפעולה." Three glyphs are
  directional, and each is chosen by what the ACTION means here, not by
  mirroring the Latin habit:

    back     ArrowRight — the page you came from is to the RIGHT in RTL
    forward  ChevronLeft — a card opens towards the LEFT
    send     Send, mirrored on X — the paper plane must fly the way the text
             runs. This is a CSS transform on the library's own glyph, not a
             re-drawn path.

  ─────────────────────────────────────────────────────────────────────────────
  THE ONE GLYPH THAT COMES FROM SOMEWHERE ELSE, AND WHY

  A spoon. Lucide does not have one — all 1,748 names in the installed version
  were searched, and it offers `utensils` (a fork and a knife), `soup` (a
  bowl) and nothing else. The measuring-tools screen needs a כף and a כפית, so
  `Utensils` stood in for both, and Ahmed said no: "בחר כפית מספרייה אחרת."

  So five more catalogues were searched by name, not by eye:

    Phosphor      9,161 icons   no spoon
    Solar         8,433 icons   no spoon
    Iconoir       1,682 icons   no spoon
    Fluent       20,239 icons   only `spatula-spoon`, and filled
    MDI           7,638 icons   `silverware-spoon` — filled, wrong style
    Hugeicons     6,091 icons   `spoon`  ← this one

  Hugeicons it is: a real spoon, and drawn to the same conventions as Lucide —
  a 24×24 grid, `fill="none"`, `stroke="currentColor"`, round caps, a 1.5
  stroke that this file normalises to the set's own 1.75. MIT, free set,
  author Hugeicons.

  THE PATH BELOW IS THE LIBRARY'S, COPIED VERBATIM, AND THAT IS TESTED.

  `@iconify-json/hugeicons` is a devDependency for exactly one reason:
  `Icons.test.tsx` reads the published `spoon` out of it and asserts that the
  string below is identical. So "this is the library's glyph and not something
  I drew" is a fact the suite checks on every run, rather than a claim in a
  comment. Nothing is imported from it at runtime — the package is 6,091
  icons of JSON and the application needs one path.

  Every icon is `aria-hidden`. The name of each destination and action lives
  on its control, in Hebrew, where a screen reader expects it.
*/

import {
  ArrowRight,
  Beaker,
  Cake,
  ChevronLeft,
  ClipboardList,
  Clock,
  Croissant,
  Dessert,
  Droplet,
  Ellipsis,
  EllipsisVertical,
  GraduationCap,
  House,
  LayoutGrid,
  MessageCircle,
  NotebookText,
  Pause,
  Play,
  Printer,
  Search,
  Send,
  Settings,
  SquarePen,
  Thermometer,
  Trash2,
  Users,
  Wheat,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, JSX } from 'react';

interface IconProps {
  /** One weight for the whole bar; the active tab is drawn heavier. */
  width: number;
}

/** The two boxes in the set. Nothing renders at any other size. */
const SIZE = { glyph: 24, inline: 20 } as const;

/**
 * One wrapper, so no glyph can quietly differ from the rest.
 *
 * `absoluteStrokeWidth` keeps the rendered line identical at both sizes —
 * see the header. `aria-hidden` and `focusable` are set here rather than at
 * ~30 call sites, where one of them would eventually be forgotten.
 */
function glyph(
  Icon: LucideIcon,
  size: number,
  style?: CSSProperties,
): (p: IconProps) => JSX.Element {
  return function Glyph({ width }: IconProps) {
    return (
      <Icon
        size={size}
        strokeWidth={width}
        absoluteStrokeWidth
        aria-hidden="true"
        focusable={false}
        style={style}
      />
    );
  };
}

/** The same wrapper for a glyph that carries its own default weight. */
function inlineGlyph(
  Icon: LucideIcon,
  style?: CSSProperties,
): (p: { width?: number }) => JSX.Element {
  const G = glyph(Icon, SIZE.inline, style);
  return function InlineGlyph({ width = ICON_STROKE.rest }: { width?: number }) {
    return <G width={width} />;
  };
}

/* ── the four destinations (§2) ──────────────────────────────────────────── */
export const TAB_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  '/home': glyph(House, SIZE.glyph),
  /*
    NotebookText, not a plain book. Ahmed: "אייקון מחברת עם פרטים קריאים, ולא
    צורה דלה שלא ברור מה היא מייצגת." This one draws the spine rings AND the
    written lines inside the cover, so at 24px it reads as a notebook rather
    than as a generic rectangle.
  */
  '/notebook': glyph(NotebookText, SIZE.glyph),
  '/groups': glyph(Users, SIZE.glyph),
  '/more': glyph(Ellipsis, SIZE.glyph),
};

/* ── inline glyphs ──────────────────────────────────────────────────────── */

/** The chevron on a menu card, pointing the way the card goes — LEFT in RTL. */
export const ChevronIcon = inlineGlyph(ChevronLeft);

/** Back. In RTL the page you came from is to the right. */
export const BackIcon = inlineGlyph(ArrowRight);

/** The recipe hero's menu — dots stacked, so it is not the "עוד" TAB's row. */
export const MenuDotsIcon = inlineGlyph(EllipsisVertical);

/** The temperature chip in Cook Mode. */
export const ThermometerIcon = inlineGlyph(Thermometer);

/** The time chip, and the timer controls. */
export const ClockIcon = inlineGlyph(Clock);

/** The timer's own controls — each one beside its word, never alone. */
export const PauseIcon = inlineGlyph(Pause);
export const PlayIcon = inlineGlyph(Play);
export const CancelIcon = inlineGlyph(X);

/** "הדפסה / שמירה כ-PDF" on the recipe, the order sheet and Cook Mode. */
export const PrintIcon = inlineGlyph(Printer);

/**
 * A spoon — כף and כפית on the measuring-tools screen.
 *
 * Hugeicons' `spoon`, verbatim (see the header). It is not a Lucide component,
 * so it goes through the same wrapper by hand: the same box, the same stroke
 * from `STROKE`, the same `aria-hidden`.
 */
export const SPOON_PATH =
  'M21.105 2.895c-1.715-1.716-5.447-.765-7.377 1.165c-1.04 1.04-1.345 2.152-1.136 3.226c.21 1.08.19 2.299-.613 3.052L2.503 19.24a1.597 1.597 0 1 0 2.257 2.257l8.902-9.476c.753-.802 1.972-.823 3.052-.613c1.074.209 2.186-.095 3.226-1.136c1.93-1.93 2.88-5.661 1.165-7.377Z';

function Spoon({ width = ICON_STROKE.rest, size = SIZE.inline }: { width?: number; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      /* The same arithmetic Lucide's `absoluteStrokeWidth` does, so this glyph
         is the same apparent weight as every other one at either size. */
      strokeWidth={(width * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      <path d={SPOON_PATH} />
    </svg>
  );
}

export const SpoonIcon = Spoon;

/** צ׳אט. */
export const ChatIcon = inlineGlyph(MessageCircle);

/** שיעורים. */
export const LessonsIcon = inlineGlyph(GraduationCap);

/**
 * The chat's send control.
 *
 * Lucide's `Send` is the paper plane everybody recognises as "send", and it
 * flies up and to the RIGHT — which is the direction Latin text runs. Here
 * the text runs the other way, so the glyph is mirrored on X. A transform on
 * the library's own icon, not a second drawing of it.
 */
export const SendIcon = inlineGlyph(Send, { transform: 'scaleX(-1)' });

/** עריכה. */
export const EditIcon = inlineGlyph(SquarePen);

/** מחיקה. */
export const DeleteIcon = inlineGlyph(Trash2);

/** חיפוש. */
export const SearchIcon = inlineGlyph(Search);

/** הגדרות. */
export const SettingsIcon = inlineGlyph(Settings);

/* ── categories, on the home screen and the notebook cards ───────────────
   These label a category whose NAME is already on screen beside them, so the
   job is a recognisable silhouette at 24px, not a botanical illustration. A
   category with no glyph of its own shows its name alone. */
export const CATEGORY_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  /* Lucide has no plain loaf; `Croissant` is its baked-dough glyph and the
     one a pastry kitchen reads fastest. */
  בצקים: glyph(Croissant, SIZE.glyph),
  לחמים: glyph(Croissant, SIZE.glyph),
  מאפים: glyph(Croissant, SIZE.glyph),
  /* A cream in a cup — the filling, not the vessel it is whisked in. */
  'קרמים ומילויים': glyph(Dessert, SIZE.glyph),
  ממרחים: glyph(Dessert, SIZE.glyph),
  'גנאשים ורטבים': glyph(Droplet, SIZE.glyph),
  שוקולד: glyph(Droplet, SIZE.glyph),
  'עוגות ועוגיות': glyph(Cake, SIZE.glyph),
  קינוחים: glyph(Cake, SIZE.glyph),
};

/**
 * The three volume standards on the measuring-tools screen. `Beaker` is also
 * the glyph the "עוד" menu uses for that screen, so the card and the entry
 * that leads to it are drawn with one hand.
 */
export const TOOL_ICON: Readonly<Record<string, (p: { width: number }) => JSX.Element>> = {
  cup: glyph(Beaker, SIZE.glyph),
  /* A spoon for the two spoons. At the glyph size, like the beaker beside it. */
  tbsp: ({ width }) => <Spoon width={width} size={SIZE.glyph} />,
  tsp: ({ width }) => <Spoon width={width} size={SIZE.glyph} />,
};

/**
 * The quick-action row on Home. Every entry is a screen that exists — the
 * notebook, the categories inside it, the ingredient centre, the measuring
 * tools, the groups and the production planning.
 */
export const QUICK_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  notebook: glyph(NotebookText, SIZE.glyph),
  categories: glyph(LayoutGrid, SIZE.glyph),
  ingredients: glyph(Wheat, SIZE.glyph),
  tools: glyph(Beaker, SIZE.glyph),
  groups: glyph(Users, SIZE.glyph),
  plans: glyph(ClipboardList, SIZE.glyph),
};

export const MENU_ICON: Readonly<Record<string, (p: IconProps) => JSX.Element>> = {
  '/ingredients': glyph(Wheat, SIZE.glyph),
  '/plans': glyph(ClipboardList, SIZE.glyph),
  '/tools': glyph(Beaker, SIZE.glyph),
  '/settings': glyph(Settings, SIZE.glyph),
};

/**
 * One resting weight for the whole application, and one heavier weight that
 * exists only to mark the current tab.
 *
 * `menu` is kept as a name because several screens import it, and it is now
 * the SAME number as `rest` — that is the point of this pass: the set used to
 * run at 1.6, 1.7 and 2.3 depending on where a glyph happened to be used.
 */
export const ICON_STROKE = { rest: 1.75, active: 2.5, menu: 1.75 } as const;
