/*
  THE THREE PHOTOGRAPHS FROM THE DESIGN HANDOFF, MAPPED TO REAL CATEGORIES.

  The handoff ships three square photographs — doughs, creams and fillings,
  ganaches — and names them after ITS categories. This maps them onto the
  categories the notebook actually has, by name, in one place:

    · a category with no photograph is not a bug and gets no photograph. The
      card falls back to the category's own glyph, which every category has.
    · nothing here renames, merges or invents a category to fit a picture. The
      handoff is explicit about that, and so is the data: "גנאשים ורטבים" is
      the notebook's category, not the handoff's "גנאשים וסירופים".

  Two sizes per photograph (640 and 320 WebP, ~57KB and ~19KB), so a phone at
  1× does not download a tablet's image. The 1254px PNG originals stay in the
  handoff package; they are not shipped to the browser.
*/

import doughs320 from '../../assets/categories/doughs-320.webp';
import doughs640 from '../../assets/categories/doughs-640.webp';
import creams320 from '../../assets/categories/creams-320.webp';
import creams640 from '../../assets/categories/creams-640.webp';
import ganaches320 from '../../assets/categories/ganaches-320.webp';
import ganaches640 from '../../assets/categories/ganaches-640.webp';

export interface CategoryPhoto {
  /** 320px square — a phone card at 1×, or a list thumbnail. */
  readonly small: string;
  /** 640px square — a phone card at 2×, a tablet or a desktop card. */
  readonly large: string;
  /**
   * What the photograph shows, for a screen reader that is not already
   * reading the category's name beside it. A decorative photo next to a
   * visible name is marked `aria-hidden` at the call site instead.
   */
  readonly alt: string;
}

const DOUGHS: CategoryPhoto = { small: doughs320, large: doughs640, alt: 'בצק עלים מקופל על משטח מקומח' };
const CREAMS: CategoryPhoto = { small: creams320, large: creams640, alt: 'קרם פטיסייר בקערת זכוכית עם מקלות וניל' };
const GANACHES: CategoryPhoto = { small: ganaches320, large: ganaches640, alt: 'גנאש שוקולד מבריק בקערה' };

const BY_CATEGORY: Readonly<Record<string, CategoryPhoto>> = {
  בצקים: DOUGHS,
  לחמים: DOUGHS,
  מאפים: DOUGHS,
  'קרמים ומילויים': CREAMS,
  ממרחים: CREAMS,
  'גנאשים ורטבים': GANACHES,
  שוקולד: GANACHES,
};

/** The photograph for a category, or null when there is none for it. */
export function categoryPhoto(category: string | null | undefined): CategoryPhoto | null {
  if (!category) return null;
  return BY_CATEGORY[category.trim()] ?? null;
}
