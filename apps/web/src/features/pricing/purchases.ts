// The purchase, as it was actually made (stage-8 requirements A, B, C).
//
// WHY THIS FILE IS SEPARATE FROM `catalog.ts`
//
// The catalog holds the ACTIVE price of a material — one row, one price, the
// thing every recipe inherits. This file is about the EVENTS that produced it:
// "on 12.3 I bought six 500 g packs from תנובה for ₪72". The two are different
// kinds of fact, and requirement C turns on keeping them apart:
//
//   · a new purchase never overwrites the previous one. It is appended.
//   · the ACTIVE price is unambiguous — it is the catalog row, full stop.
//   · a version snapshot keeps the price it was taken with, and none of this
//     touches it.
//
// So there is exactly one place a live recipe reads a price from, and a full
// history behind it that can be read but cannot be mistaken for the price.

import type { PriceUnit, PurchaseUnit } from '../../lib/database.types.js';

/** What the user enters at the counter. `null` is "not known", never 0. */
export interface PurchaseInput {
  key: string;
  name: string;
  purchaseUnit: PurchaseUnit;
  /** how many packages. 1 for a single sack, 6 for six packs */
  packageCount: number;
  /** how much is in ONE package */
  packageQty: number | null;
  /** the TOTAL paid for the whole purchase. 0 is legal and means free */
  purchaseTotal: number | null;
  /** usable share after cleaning, in percent. null = not declared */
  usablePct: number | null;
  supplier: string;
  /** ISO date. null lets the database use today */
  purchasedAt: string | null;
  note: string;
}

/** One row of history, with the change from the purchase before it. */
export interface PurchaseRecord {
  id: string;
  purchasedAt: string;
  supplier: string;
  purchaseUnit: PurchaseUnit;
  packageCount: number;
  packageQty: number | null;
  purchaseTotal: number | null;
  usablePct: number | null;
  /** ₪ per base unit as bought */
  purchasePrice: number | null;
  /** ₪ per USABLE base unit — the comparable number */
  price: number | null;
  /** the usable price of the purchase before this one. null = the first */
  prevPrice: number | null;
  /** null when there is no previous price, or it was 0 and there is no ratio */
  pctChange: number | null;
}

/**
 * How a change in price should read.
 *
 * Deliberately not "good" or "bad": a rise is bad for a cost and good for a
 * material you are reselling, and this layer does not know which.
 */
export const changeWord = (pct: number): string =>
  pct > 0 ? 'התייקר' : pct < 0 ? 'הוזל' : 'לא השתנה';

/** `12.5` → `+12.5%`, `-8` → `-8%`, rounded to one decimal. */
export function formatPct(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  const sign = r > 0 ? '+' : '';
  return `${sign}${r}%`;
}

/** The unit a purchase unit produces a price per. */
export const priceUnitOf = (u: PurchaseUnit): PriceUnit =>
  u === 'kg' || u === 'g' ? 'ק"ג' : u === 'l' || u === 'ml' ? 'ליטר' : "יח'";
