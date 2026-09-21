/*
  THE ICON SET — ONE LIBRARY, ONE WEIGHT, ONE GRID, EVERY GLYPH IN THE APP.

  ─────────────────────────────────────────────────────────────────────────────
  WHICH LIBRARY, AND WHY

  Lucide (`lucide-react`, ISC). It is the only icon dependency in the project
  and every glyph below comes from its published catalogue — 1,748 icons in
  the installed version — through its own React components. Nothing here is a
  hand-drawn path any more.

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
  THE ONE PLACE THE CATALOGUE HAS NO ANSWER

  A spoon. All 1,748 names were searched: Lucide has `utensils`,
  `utensils-crossed` and `soup`, and no spoon at all. The tablespoon and
  teaspoon entries on the measuring-tools screen therefore use `Utensils`,
  which reads as "a cutlery-sized measure" beside `Beaker`'s "a graduated
  vessel" — and in Hebrew כף and כפית are literally cutlery. Drawing a spoon
  would have been the one hand-made path in the set, which is the thing this
  file exists to stop.

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
  MessageCircle,
  NotebookText,
  Search,
  Send,
  Settings,
  SquarePen,
  Thermometer,
  Trash2,
  Users,
  Utensils,
  Wheat,
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

/** A cutlery-sized measure — see the header on why this is not a spoon. */
export const SpoonIcon = inlineGlyph(Utensils);

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
  tbsp: glyph(Utensils, SIZE.glyph),
  tsp: glyph(Utensils, SIZE.glyph),
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
