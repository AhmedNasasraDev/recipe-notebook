// Number formatting for measuring tools.
//
// Ported from measure.js:211. Two spec deviations that existed there are not
// reproduced, because writing a known defect into new code is not a port:
//   • the step was `x.tool === 'cup' ? 0.25 : 0.25` — a dead ternary, so every
//     tool rounded to quarters. Spec §5.2 asks for quarter cups and HALF
//     spoons. (This was logged as B11.)
//   • count plurals were built as `x.he + 'ות'`, which produced "2 ביצהות".
//     (Logged as B10.)
// Both are display-only and are called out in the hand-off notes.

import { unit } from './units.js';

const FRACTION_GLYPH: Record<string, string> = {
  '0.25': '¼',
  '0.5': '½',
  '0.75': '¾',
};

const TOOL_WORDS: Record<string, [string, string]> = {
  cup: ['כוס', 'כוסות'],
  tbsp: ['כף', 'כפות'],
  tsp: ['כפית', 'כפיות'],
};

const COUNT_WORDS: Record<string, [string, string]> = {
  unit: ["יח'", "יח'"],
  egg: ['ביצה', 'ביצים'],
  fruit: ['פרי', 'פירות'],
  slice: ['פרוסה', 'פרוסות'],
};

export function round1(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** Grams / kilograms, ported verbatim from engine.js:130 (fmtG). */
export function formatGrams(g: number): string {
  if (g >= 1000) {
    const kg = g / 1000;
    /*
      QA 22.09.2026, §6: the trailing-zero trim used to run on the WHOLE
      number, so 10 kg printed as "1 ק"ג" and 20 kg as "2 ק"ג" — on the order
      sheet, at exactly the quantities a production order is placed in.
      Zeros are trimmed only after a decimal point now.
    */
    const text = kg.toFixed(g % 1000 === 0 ? 0 : 2);
    return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + ' ק"ג';
  }
  return (g >= 10 ? Math.round(g) : Math.round(g * 10) / 10) + " גר'";
}

/**
 * Shekels — ALWAYS TWO DECIMALS.
 *
 * This was a verbatim port of the prototype's `nis()`, which rounded to one
 * decimal below ₪100 and to whole shekels above it. The arithmetic was never
 * affected — every figure the app derives is computed from the exact number
 * and only the printed string was rounded — but an exact ₪1.95 was DISPLAYED
 * as ₪2, a cost per unit of ₪0.195 as ₪0.2, and a ₪1,234.49 total as ₪1,234.
 * In a costing tool that is a reporting defect: agorot are the unit prices are
 * quoted in, and a label or an order sheet that says ₪2 for something that
 * costs ₪1.95 is wrong on paper.
 *
 * Ahmed approved the change (stage 3, item 1): two decimals everywhere, the
 * labels and the order sheets included, with the internal precision
 * untouched. `toLocaleString` keeps the Hebrew thousands separator, so a big
 * number still reads as ₪1,234.49.
 *
 * Zero is ₪0.00 — a real price of nothing, which the app distinguishes from
 * "no price" by not calling this function at all for the latter (see
 * `money()` on the recipe page and `priced` on a computed row).
 */
export function formatNis(n: number): string {
  return (
    '₪' +
    n.toLocaleString('he-IL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatForUnit(value: number, u: string): string {
  const x = unit(u);
  if (!x) return String(round1(value));

  if (x.tool) {
    const step = x.tool === 'cup' ? 0.25 : 0.5; // spec §5.2
    const [one, many] = TOOL_WORDS[x.tool] ?? ['', ''];
    const r = Math.round(value / step) * step;
    if (r === 0) {
      return value > 0 ? `פחות מ${fractionWord(step)} ${one}` : `0 ${one}`;
    }
    const whole = Math.floor(r + 1e-9);
    const frac = Math.round((r - whole) * 100) / 100;
    const glyph = frac > 0 ? (FRACTION_GLYPH[String(frac)] ?? '') : '';
    const num = whole === 0 ? glyph : whole + (glyph ? ' ' + glyph : '');
    return `${num} ${r > 1 ? many : one}`;
  }

  if (x.group === 'count') {
    const r = Math.round(value * 2) / 2;
    const [one, many] = COUNT_WORDS[x.id] ?? [x.he, x.he];
    return `${r} ${r > 1 ? many : one}`;
  }

  if (x.id === 'g') return `${Math.round(value)} גר'`;
  if (x.id === 'ml') return `${Math.round(value)} מ"ל`;
  return `${round1(value)} ${x.short ?? x.he}`;
}

function fractionWord(step: number): string {
  return step === 0.25 ? 'רבע' : 'חצי';
}
