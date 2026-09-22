/**
 * §2 screen 8 — the ingredient declaration for a product label.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE INGREDIENT TABLE ON THE RECIPE PAGE
 *
 * An ingredient declaration is not a list of what you weigh. It is a list of
 * what is IN the product, in descending order of weight, and a compound
 * ingredient has to be declared by its own contents. The label screen in the
 * prototype said exactly that — "הרכב יורד בסדר משקל, מגולגל גם מתוך מתכוני
 * בסיס" — and then listed the top-level rows only, so a cake made from a base
 * ganache declared "גנאש 40%" and never mentioned cream or chocolate. This
 * does the roll-up the sentence promised.
 *
 * THE PART THAT DECIDES WHETHER THIS SCREEN IS SAFE
 *
 * Percentages are a share of a total. If one ingredient's weight could not be
 * established, the total is wrong, EVERY percentage is wrong, and the
 * descending order is not knowable either — the missing one could be the
 * largest. A recipe page can show a partial figure with a "חלקי" chip next to
 * it. A label cannot: it leaves the building, gets stuck to a box, and is read
 * as a declaration.
 *
 * So this returns `certain: false` when anything is unresolved, and the screen
 * then shows the names WITHOUT percentages and says what is missing. The order
 * is still returned, because it is useful for filling the gaps in, but it is
 * marked as not established and the screen must not present it as the
 * declaration.
 */

import type { Computed, ComputedRow } from '@recipe-notebook/engine';

export interface CompositionLine {
  name: string;
  grams: number;
  /** share of the whole product, or null when it cannot be established */
  pct: number | null;
}

export interface Composition {
  lines: readonly CompositionLine[];
  /** total weight the shares are taken of */
  totalG: number;
  /**
   * Is this a declaration, or a draft of one? false as soon as a single
   * ingredient weight is unknown, anywhere in the tree.
   */
  certain: boolean;
  /** names whose weight could not be established, for the screen to print */
  missing: readonly string[];
}

/**
 * Flatten a computed recipe into the ingredients a label declares.
 *
 * A row that is a base recipe contributes its OWN rows, scaled by how much of
 * the base the parent uses. A base recipe's line is therefore replaced by its
 * contents rather than listed alongside them, which is what "מגולגל" means.
 *
 * Ingredients that appear more than once — sugar in the cake and sugar in the
 * filling — are added together under one name, because a label that lists
 * sugar twice understates where sugar sits in the order.
 */
export function composition(computed: Computed): Composition {
  const totals = new Map<string, number>();
  const missing: string[] = [];

  const walk = (rows: readonly ComputedRow[], scale: number): void => {
    for (const row of rows) {
      const name = (row.ing.name ?? '').trim() || 'רכיב ללא שם';

      if (row.sub) {
        /*
          `row.g` is how many grams of the base go into this product, and the
          base's own computation is at factor 1. The ratio between them is what
          scales the base's contents — the same ratio `compute` itself uses to
          roll a sub-recipe's cost up, and for the same reason.
        */
        const baseYield = row.sub.actualYield || row.sub.totalG;
        if (row.g === null || baseYield <= 0) {
          // Unknown how much of the base is used, so its contents cannot be
          // apportioned. Named, not skipped.
          missing.push(name);
          continue;
        }
        walk(row.sub.rows, scale * (row.g / baseYield));
        continue;
      }

      if (row.g === null) {
        missing.push(name);
        continue;
      }
      totals.set(name, (totals.get(name) ?? 0) + row.g * scale);
    }
  };

  walk(computed.rows, 1);

  const totalG = [...totals.values()].reduce((a, b) => a + b, 0);
  const certain = missing.length === 0 && totalG > 0;

  const unresolved = [...new Set(missing)];
  const lines: CompositionLine[] = [...totals.entries()]
    .map(([name, grams]) => ({
      name,
      grams,
      pct: certain ? (grams / totalG) * 100 : null,
    }))
    // Descending by weight. A tie falls back to the name so the same recipe
    // always produces the same label — a declaration that reorders itself
    // between two prints is not a declaration.
    .sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name, 'he'));

  /*
    An ingredient whose weight is unknown is STILL IN THE PRODUCT. QA
    22.09.2026 (acceptance, finding 5): the eggs of a brioche had no weight,
    were dropped from "רכיבים:", and the same label said "מכיל: ביצים" two
    lines down. A declaration that omits an ingredient is a false one, so the
    unresolved names go on the list too — last, because their place in the
    descending order cannot be established, and with no share, because no
    share can. `missing` still names them for the screen's note.
  */
  const listed = new Set(lines.map((l) => l.name));
  for (const name of unresolved) {
    if (!listed.has(name)) lines.push({ name, grams: 0, pct: null });
  }

  return { lines, totalG, certain, missing: unresolved };
}

/**
 * "קמח לחם (41.2%), חלב (22.0%)" — the declaration as one sentence.
 *
 * The share is parenthesised because ingredient NAMES carry percentages of
 * their own on a pastry bench — "שוקולד מריר 64%", "קמח לחם 13% חלבון" — and
 * "שוקולד מריר 64% 17.9%" is two numbers in a row that mean different things.
 * It is also how a supermarket label writes it.
 */
export function declarationText(c: Composition): string {
  return c.lines
    .map((l) => (l.pct === null ? l.name : `${l.name} (${l.pct.toFixed(1)}%)`))
    .join(', ');
}
