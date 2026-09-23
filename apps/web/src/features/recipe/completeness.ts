// How complete is this calculation?
//
// The engine already refuses to invent a density: a row it cannot weigh comes
// back with `g === null` and lands in `Computed.unresolved`. But every total on
// the recipe page is a sum over the rows it COULD weigh, and a sum over some of
// the rows looks exactly like a sum over all of them.
//
// Stage-3 requirement 8, in the user's words: when `Computed.unresolved` is not
// empty, the total, the cost and the price must not be presented as a finished
// calculation, and the screen must distinguish
//
//   full  — every ingredient was weighed; the figures are the whole recipe
//   partial — some were; the figures are real but incomplete, and are labelled
//   none  — nothing was weighed; there is no figure to show, so none is shown
//
// It deliberately does NOT guess a value to close the gap. The way out of
// `partial` is a personal calibration or a verified density, both of which the
// conversion sheet already offers.
//
// STAGE 6 — IT HAS TO LOOK INSIDE THE SUB-RECIPES
//
// Found by testing a three-level chain (stage-6 requirement 18), and it was a
// real defect rather than a missing test: every function here read
// `computed.rows` and `computed.unresolved`, which are the TOP level only. A
// sub-recipe line has a weight of its own and a cost that rolled up, so it
// looked complete no matter what was wrong inside it. Two concrete results,
// both wrong:
//
//   - a cake whose ganache contained a cup of cocoa with no reliable density
//     reported `level: 'full'`. One level down the gap was still visible
//     through `row.sub.unresolved`; two levels down it was gone entirely.
//   - a cake whose chocolate — two levels below it — had NO price reported
//     `costLevel: 'full'` and a finished cost, with the chocolate counted at
//     zero. That is the "עלות כוללת ₪0" bug from stage 4 reappearing across
//     the sub-recipe boundary, and it is the kind that costs money.
//
// The engine was right about all of it: each level reports its own facts
// correctly and `ComputedRow.sub` carries the whole tree. What was missing is
// that "is this figure complete" is a question about the tree, not about one
// level of it — and that question belongs here, which is why no change to
// packages/engine was needed.
//
// So every predicate below recurses, and a name from inside a sub-recipe is
// reported with the path to it ("מילוי → גנאש → שוקולד מריר") rather than bare:
// an ingredient the reader cannot locate is not an explanation.

import type { Computed, ComputedRow } from '@recipe-notebook/engine';

export type CalcLevel = 'full' | 'partial' | 'none';

export interface CalcState {
  level: CalcLevel;
  /** ingredients with no reliable weight */
  missing: number;
  /** ingredients that did contribute to the totals */
  counted: number;
  /** their names, for the explanation */
  missingNames: readonly string[];
  /** one sentence, ready to render */
  summary: string;
  /** true while any figure derived from total mass or cost is incomplete */
  partialFigures: boolean;
  /**
   * Whether the COST figures mean anything, which is a separate question from
   * whether the weights do.
   *
   * Found while reviewing a tablet screenshot of the editor: a recipe with no
   * prices entered showed "עלות כוללת ₪0". Every weight was known, so the mass
   * side was legitimately `full` — but nobody had priced anything, and ₪0 reads
   * as "this recipe is free". That is the same failure requirement 8 exists to
   * prevent, one axis over.
   *
   *   full    every weighable ingredient carries a price
   *   partial some do
   *   none    none do, so there is no cost, no cost/kg and no sale price
   */
  costLevel: CalcLevel;
  /** ingredients with a weight but no price */
  unpricedNames: readonly string[];
  /** one sentence about the cost side, '' when it is complete */
  costSummary: string;
}

/** Hebrew agreement for a count of ingredients. */
function ingredientCount(n: number): string {
  return n === 1 ? 'רכיב אחד' : `${n} רכיבים`;
}

/** A name from inside a sub-recipe, with the path that leads to it. */
const under = (parent: string, names: readonly string[]): string[] =>
  names.map((n) => (parent ? `${parent} → ${n}` : n));

/**
 * Every ingredient in the tree that could not be weighed, deepest included.
 *
 * `Computed.unresolved` is one level's own answer, and a sub-recipe line is
 * never in it — the line itself weighs what it says. Without this recursion a
 * missing density stopped mattering as soon as it was one sub-recipe away.
 */
function unresolvedInTree(computed: Computed): string[] {
  const own = computed.unresolved.map((u) => u.name).filter(Boolean);
  const inner = computed.rows.flatMap((r) =>
    r.sub ? under(r.ing.name ?? '', unresolvedInTree(r.sub)) : [],
  );
  return [...own, ...inner];
}

/**
 * Did this row's own price actually reach the cost?
 *
 * Stage 7 replaced a check on `row.ing.price` with the engine's own answer.
 * The two differ in a case that turned out to be reachable from the editor: a
 * price in `יח'` with no known item weight. The field is filled, so the old
 * check said "priced" — and the row contributed nothing, so the recipe showed
 * a finished cost that was missing an ingredient. `row.priced` is true only
 * when the price was applied.
 *
 * A row with `price: 0` is still priced, and that is the engine's answer too —
 * someone typed a zero, and a foraged or donated ingredient really does cost
 * nothing. Treating an EMPTY price as zero is what all of this exists to avoid.
 */
function hasOwnPrice(row: ComputedRow): boolean {
  return row.priced;
}

/**
 * What one row contributes to the cost, and what is missing from it.
 *
 * A sub-recipe line has no price of its own by design (§18.6) — its cost comes
 * from the base recipe. So for such a row the question is entirely about what
 * is INSIDE, which is why this recurses instead of trusting `row.cost > 0`.
 * A rolled-up cost can be greater than zero while half the base is unpriced.
 */
function rowCost(row: ComputedRow): { contributes: boolean; unpriced: string[] } {
  if (row.g === null) return { contributes: false, unpriced: [] };

  if (row.ing.subId) {
    if (!row.sub) {
      // The base recipe is missing — the engine warns about it, and nothing can
      // be costed from a recipe that is not there.
      return { contributes: false, unpriced: [row.ing.name ?? ''] };
    }
    const inner = costState(row.sub);
    return {
      contributes: inner.costLevel !== 'none',
      unpriced: under(row.ing.name ?? '', inner.unpricedNames),
    };
  }

  return hasOwnPrice(row)
    ? { contributes: true, unpriced: [] }
    : { contributes: false, unpriced: [row.ing.name ?? ''] };
}

/** The cost side of the same question, over the whole tree. */
function costState(computed: Computed): {
  costLevel: CalcLevel;
  unpricedNames: string[];
  costSummary: string;
} {
  const weighable = computed.rows.filter((r) => r.g !== null);
  const costs = weighable.map(rowCost);
  const contributing = costs.filter((c) => c.contributes).length;
  const unpricedNames = costs.flatMap((c) => c.unpriced).filter(Boolean);

  if (weighable.length === 0 || contributing === 0) {
    return {
      costLevel: 'none',
      unpricedNames,
      costSummary:
        'לא הוזנו מחירים לאף רכיב, ולכן אין עלות, אין עלות לק"ג ואין מחיר מכירה. ' +
        'אפס אינו התשובה — פשוט אין נתון.',
    };
  }
  if (unpricedNames.length > 0) {
    return {
      costLevel: 'partial',
      unpricedNames,
      costSummary:
        `העלות מחושבת מ-${ingredientCount(contributing)} שיש להם מחיר. ` +
        `ל-${ingredientCount(unpricedNames.length)} אין מחיר, ולכן העלות נמוכה מהעלות בפועל.`,
    };
  }
  return { costLevel: 'full', unpricedNames: [], costSummary: '' };
}

export function calcState(computed: Computed): CalcState {
  // The whole tree, not this level: a gap inside a sub-recipe is still a gap in
  // the figure being shown. `counted` stays a count of THIS recipe's own rows,
  // because that is what the sentence about it is describing.
  const missingNames = unresolvedInTree(computed);
  const missing = missingNames.length;
  const ownMissing = computed.unresolved.length;
  const counted = computed.rows.length - ownMissing;

  const cost = costState(computed);

  if (missing === 0) {
    return {
      level: 'full',
      missing: 0,
      counted,
      missingNames: [],
      summary: '',
      partialFigures: false,
      ...cost,
    };
  }

  // Nothing could be weighed. A "total" of zero would be a lie, so the screen
  // shows no figure at all rather than a number that happens to be 0.
  if (counted === 0) {
    return {
      level: 'none',
      missing,
      counted: 0,
      missingNames,
      summary:
        `אין נתוני צפיפות לאף רכיב במתכון הזה, ולכן אי אפשר לחשב משקל, עלות או מחיר. ` +
        `כיול אישי של כלי המדידה שלכם, או הזנת משקל במקום נפח, יפתרו זאת.`,
      partialFigures: true,
      ...cost,
      // Nothing could be weighed, so nothing could be priced either, whatever
      // prices happen to be on the rows.
      costLevel: 'none',
    };
  }

  return {
    level: 'partial',
    missing,
    counted,
    missingNames,
    summary:
      `נתונים חלקיים — חסרים נתונים עבור ${ingredientCount(missing)}. ` +
      `סך המשקל, העלות והמחיר מחושבים מ-${ingredientCount(counted)} בלבד ואינם מלאים.`,
    partialFigures: true,
    ...cost,
  };
}
