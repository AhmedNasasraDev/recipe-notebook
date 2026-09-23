// The paste parser, on the text a real kitchen pastes.
//
// QA 22.09.2026, §3: a pasted brioche put "משקל בצק לפני אפייה" on the weighing
// list and listed butter, milk and vanilla twice, because every short line
// with a number and a unit became an ingredient — including the recipe's own
// weight lines and the instructions that name a quantity.

import { describe, expect, it } from 'vitest';
import { parseLocal } from '../src/parse.js';

const BRIOCHE = `בריוש חמאה קלאסי
רכיבים:
500 גרם קמח לחם
10 גרם מלח
60 גרם סוכר
15 גרם שמרים טריים
4 ביצים
100 מ"ל חלב
1 כפית תמצית וניל
250 גרם חמאה
משקל בצק לפני אפייה: 1200 גרם
משקל אחרי אפייה: 1050 גרם
פחת: 12.5%
תפוקה: 12 יחידות
משקל ליחידה 100 גרם
אופן ההכנה:
מערבבים את הקמח, המלח, הסוכר והשמרים במערבל.
מוסיפים 4 ביצים ו-100 מ"ל חלב ולשים 8 דקות.
מוסיפים 250 גרם חמאה בהדרגה ולשים עד שהבצק חלק.
מתפיחים שעה וחצי.
אופים 25 דקות ב-180 מעלות.`;

describe('parseLocal reads a pasted recipe by its sections', () => {
  const p = parseLocal(BRIOCHE);

  it('lists each ingredient once, from the ingredient section only', () => {
    const names = p.ingredients.map((i) => i.name);
    expect(names).toEqual([
      'קמח לחם',
      'מלח',
      'סוכר',
      'שמרים טריים',
      'ביצים',
      'חלב',
      'תמצית וניל',
      'חמאה',
    ]);
    // Butter and milk are named again in the steps; they are not listed again.
    expect(names.filter((n) => n === 'חמאה')).toHaveLength(1);
    expect(names.filter((n) => n === 'חלב')).toHaveLength(1);
  });

  it('keeps the batch weights and the count OUT of the ingredient list', () => {
    expect(p.ingredients.some((i) => /משקל|פחת|תפוקה/.test(i.name ?? ''))).toBe(false);
    expect(p.steps.some((s) => /משקל בצק|פחת|תפוקה/.test(s.text))).toBe(false);
    expect(p.meta).toEqual({
      name: 'בריוש חמאה קלאסי',
      weightBefore: 1200,
      weightAfter: 1050,
      yieldUnits: 12,
      unitWeight: 100,
    });
  });

  it('turns every line after the steps heading into a step, numbers and all', () => {
    // The title is the name, not the first step.
    expect(p.meta.name).toBe('בריוש חמאה קלאסי');
    expect(p.steps.map((s) => s.text)).toEqual([
      'מערבבים את הקמח, המלח, הסוכר והשמרים במערבל.',
      'מוסיפים 4 ביצים ו-100 מ"ל חלב ולשים 8 דקות.',
      'מוסיפים 250 גרם חמאה בהדרגה ולשים עד שהבצק חלק.',
      'מתפיחים שעה וחצי.',
      'אופים 25 דקות ב-180 מעלות.',
    ]);
    expect(p.steps[1]?.minutes).toBe(8);
    expect(p.steps[3]?.minutes).toBe(90);
    expect(p.steps[4]?.temp).toBe('180');
  });
});

describe('without headings, an instruction is still an instruction', () => {
  it('reads a line that starts with a verb as a step even with a quantity', () => {
    const p = parseLocal('200 גרם חמאה\nמוסיפים 200 גרם חמאה ומערבבים היטב');
    expect(p.ingredients.map((i) => i.name)).toEqual(['חמאה']);
    expect(p.steps.map((s) => s.text)).toEqual(['מוסיפים 200 גרם חמאה ומערבבים היטב']);
  });

  it('still reads a plain quantity line as an ingredient', () => {
    const p = parseLocal('- 2 כפות שמן זית\n3 ביצים');
    expect(p.ingredients.map((i) => i.name)).toEqual(['שמן זית', 'ביצים']);
    expect(p.ingredients[1]?.unit).toBe("יח'");
    expect(p.meta).toEqual({});
  });
});
