// The purchase list: from "what the plan needs" to "what to buy".
//
// FOUR THINGS THIS FILE REFUSES TO CONFLATE
//
// 1. WHAT PRODUCTION NEEDS vs WHAT TO BUY (requirement 6). A recipe needing
//    8.2 kg of flour needs 8.2 kg. The shop sells 5 kg sacks, so you buy 10 kg
//    and have 1.8 kg left. The recipe is NEVER rounded to fit the sack — the
//    two numbers sit side by side and the professional quantity is untouched.
//
// 2. USABLE vs PURCHASED (stage 8, requirement D, meeting this one). The
//    engine's requirement is in USABLE material: a recipe wanting 8 kg of
//    cleaned celery wants 8 kg of cleaned celery. At an 80% yield you must buy
//    10 kg to have it. So the purchase quantity is the requirement divided by
//    the yield, and the cost uses the AS-BOUGHT price — otherwise the yield
//    would be charged twice.
//
// 3. MISSING vs ZERO (requirement 5). No on-hand figure means nobody said what
//    is in the store room, and then only the requirement is shown. `0` means
//    the shelf is empty. Telling someone to buy nothing because a field was
//    blank is the expensive version of this mistake.
//
// 4. A PRICE OF 0 vs NO PRICE (requirement 7). Free is a price. Unpriced is
//    not, and a total that silently skips an unpriced material is a total
//    nobody should budget from.

import { densityFor, gramsPerItem, type MeasurementPrefs } from '@recipe-notebook/engine';
import type { CatalogItem } from '../pricing/catalog.js';
import type { PriceUnit } from '../../lib/database.types.js';
import type { Requirement } from './explode.js';

export interface PurchaseLine {
  key: string;
  name: string;
  /** what the recipes need, in grams. Always known when the rows were weighed */
  grams: number;
  /** the catalog's base unit for this material. null = it is not in the centre */
  unit: PriceUnit | null;
  /** the requirement in the base unit — USABLE material. null = not expressible */
  required: number | null;
  /** the same, grossed up for the declared yield: what must be BOUGHT */
  requiredPurchase: number | null;
  /** the declared usable percentage, when there is one */
  usablePct: number | null;
  /** what the user says they have, in the base unit. null = not entered */
  onHand: number | null;
  /** requiredPurchase − onHand, never below 0. null when either is unknown */
  toBuy: number | null;
  /** one package, in the base unit. null = the centre does not say */
  packageQty: number | null;
  /** whole packages to buy. null when the package or the need is unknown */
  packages: number | null;
  /** packages × packageQty — the quantity actually bought */
  buyQty: number | null;
  /** buyQty − toBuy: what is left over afterwards */
  remainder: number | null;
  /** ₪ per base unit AS BOUGHT (not the usable price — see the header) */
  unitPrice: number | null;
  /** buyQty × unitPrice, or the requirement's cost when there is no package */
  cost: number | null;
  inCatalog: boolean;
  /** why a figure above is null, when it is. '' when everything is known */
  why: string;
  /** the requirement itself is incomplete (a row somewhere could not be weighed) */
  partial: boolean;
}

export interface PurchaseList {
  lines: PurchaseLine[];
  /** the sum of `cost`, or null when it cannot honestly be stated */
  total: number | null;
  level: 'full' | 'partial' | 'none';
  /** materials that need buying and have no price */
  unpriced: string[];
  /** materials whose quantity could not be expressed in a purchasable unit */
  unconvertible: string[];
  why: string;
}

/**
 * The requirement in the catalog's base unit.
 *
 * Grams are what the engine deals in; a shop sells kilos, litres or eggs. The
 * litre case needs a density, and there is none to invent: a material sold by
 * the litre with no density is reported as unconvertible rather than costed at
 * 1.0 g/ml. (`compute()` does fall back to 1.0 for a per-litre PRICE, with a
 * warning, because there it is costing an existing recipe rather than telling
 * someone how many bottles to carry home.)
 */
export function inBaseUnit(
  grams: number,
  item: CatalogItem,
  req: Requirement,
  prefs: MeasurementPrefs | undefined,
): { qty: number; unit: PriceUnit } | { qty: null; unit: PriceUnit; why: string } {
  switch (item.purchaseUnit) {
    case 'kg':
    case 'g':
      return { qty: grams / 1000, unit: 'ק"ג' };
    case 'l':
    case 'ml': {
      const d = densityFor(req.sample, prefs, 'ml');
      if (!d) {
        return {
          qty: null,
          unit: 'ליטר',
          why: `${req.name}: נמכר לפי נפח, ואין נתון צפיפות אמין להמיר ממשקל לליטרים.`,
        };
      }
      return { qty: grams / (d.gPer100 * 10), unit: 'ליטר' };
    }
    case 'unit': {
      const per = gramsPerItem(req.sample);
      if (per === null || per <= 0) {
        return {
          qty: null,
          unit: "יח'",
          why: `${req.name}: נמכר לפי יחידות, ואין משקל ליחידה להמיר ממשקל למספר יחידות.`,
        };
      }
      return { qty: grams / per, unit: "יח'" };
    }
  }
}

/** One package, expressed in the same base unit as the price. */
function packageInBaseUnit(item: CatalogItem): number | null {
  if (item.packageQty === null || item.packageQty <= 0) return null;
  switch (item.purchaseUnit) {
    case 'kg':
    case 'l':
    case 'unit':
      return item.packageQty;
    case 'g':
    case 'ml':
      return item.packageQty / 1000;
  }
}

export function purchaseList(
  requirements: readonly Requirement[],
  catalog: readonly CatalogItem[],
  onHand: Readonly<Record<string, number>>,
  prefs: MeasurementPrefs | undefined,
): PurchaseList {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const unpriced: string[] = [];
  const unconvertible: string[] = [];
  let total = 0;
  let anyCost = false;
  let costIncomplete = false;

  const lines = requirements.map<PurchaseLine>((req) => {
    const item = byKey.get(req.key);
    const line: PurchaseLine = {
      key: req.key,
      name: req.name,
      grams: req.grams,
      unit: null,
      required: null,
      requiredPurchase: null,
      usablePct: null,
      onHand: null,
      toBuy: null,
      packageQty: null,
      packages: null,
      buyQty: null,
      remainder: null,
      unitPrice: null,
      cost: null,
      inCatalog: item !== undefined,
      why: '',
      partial: req.partial,
    };

    if (!item) {
      line.why = `${req.name}: אינו במרכז חומרי הגלם, ולכן אין לו יחידת רכישה, אריזה או מחיר.`;
      unpriced.push(req.name);
      costIncomplete = true;
      return line;
    }

    const conv = inBaseUnit(req.grams, item, req, prefs);
    line.unit = conv.unit;
    if (conv.qty === null) {
      line.why = conv.why;
      unconvertible.push(req.name);
      costIncomplete = true;
      return line;
    }

    line.required = conv.qty;
    line.usablePct = item.usablePct;
    // Buy enough that the USABLE part covers the requirement.
    line.requiredPurchase =
      item.usablePct !== null && item.usablePct > 0
        ? conv.qty / (item.usablePct / 100)
        : conv.qty;

    // Requirement 5: absent means absent. A key present with 0 is a real zero.
    const hand = Object.prototype.hasOwnProperty.call(onHand, req.key)
      ? onHand[req.key]!
      : null;
    line.onHand = hand;
    line.toBuy =
      hand === null ? line.requiredPurchase : Math.max(0, line.requiredPurchase - hand);

    line.packageQty = packageInBaseUnit(item);
    if (line.packageQty !== null && line.toBuy !== null) {
      // Whole packages, rounded UP: half a sack is not a thing you can buy.
      // The recipe's own quantity is untouched — see the file header.
      line.packages = line.toBuy > 0 ? Math.ceil(line.toBuy / line.packageQty) : 0;
      line.buyQty = line.packages * line.packageQty;
      line.remainder = line.buyQty - line.toBuy;
    }

    // The AS-BOUGHT price, because what is being costed is a purchase.
    line.unitPrice = item.purchasePrice;
    if (line.unitPrice === null) {
      if ((line.toBuy ?? 0) > 0) {
        unpriced.push(req.name);
        costIncomplete = true;
        line.why = `${req.name}: אין מחיר במרכז חומרי הגלם, ולכן אין עלות צפויה.`;
      }
      return line;
    }

    const qty = line.buyQty ?? line.toBuy;
    if (qty !== null) {
      line.cost = qty * line.unitPrice;
      total += line.cost;
      anyCost = true;
    }
    if (req.partial) costIncomplete = true;
    return line;
  });

  const level: PurchaseList['level'] = !anyCost
    ? 'none'
    : costIncomplete
      ? 'partial'
      : 'full';

  let why = '';
  if (level === 'none') {
    why = 'אין מחיר לאף חומר גלם שצריך לקנות, ולכן אין עלות רכש.';
  } else if (level === 'partial') {
    const bits: string[] = [];
    if (unpriced.length) bits.push(`חסר מחיר ל: ${[...new Set(unpriced)].join(' · ')}`);
    if (unconvertible.length) {
      bits.push(`אי אפשר להמיר ליחידת רכישה: ${[...new Set(unconvertible)].join(' · ')}`);
    }
    why =
      `העלות חלקית ואינה סכום הרכש המלא. ${bits.join('. ')}`.trim();
  }

  return {
    lines,
    // A partial total is not a total. What IS known stays on each line.
    total: level === 'full' ? total : null,
    level,
    unpriced: [...new Set(unpriced)],
    unconvertible: [...new Set(unconvertible)],
    why,
  };
}

/**
 * The purchase list, reduced to something worth freezing (requirement 14).
 *
 * A locked plan is a record of what was bought and what it cost, so the
 * snapshot keeps the numbers and drops everything that only exists to compute
 * them — the ingredient sample, the catalog lookups. It is a frozen document,
 * not a second source of truth about today's prices: nothing reads it unless
 * the plan is locked.
 */
export interface PlanSnapshot {
  at: string;
  lines: Array<{
    key: string;
    name: string;
    unit: PriceUnit | null;
    required: number | null;
    requiredPurchase: number | null;
    onHand: number | null;
    toBuy: number | null;
    packages: number | null;
    buyQty: number | null;
    remainder: number | null;
    unitPrice: number | null;
    cost: number | null;
  }>;
  total: number | null;
  level: PurchaseList['level'];
  why: string;
}

export function snapshotOf(list: PurchaseList, at: string): PlanSnapshot {
  return {
    at,
    lines: list.lines.map((l) => ({
      key: l.key,
      name: l.name,
      unit: l.unit,
      required: l.required,
      requiredPurchase: l.requiredPurchase,
      onHand: l.onHand,
      toBuy: l.toBuy,
      packages: l.packages,
      buyQty: l.buyQty,
      remainder: l.remainder,
      unitPrice: l.unitPrice,
      cost: l.cost,
    })),
    total: list.total,
    level: list.level,
    why: list.why,
  };
}

/** A snapshot read back. Unknown shapes are refused rather than half-read. */
export function readSnapshot(value: unknown): PlanSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<PlanSnapshot>;
  if (!Array.isArray(v.lines)) return null;
  return {
    at: typeof v.at === 'string' ? v.at : '',
    lines: v.lines,
    total: typeof v.total === 'number' ? v.total : null,
    level: v.level === 'full' || v.level === 'partial' ? v.level : 'none',
    why: typeof v.why === 'string' ? v.why : '',
  };
}
