// §13a. The four acceptance cases from the spec, plus the edge cases it lists.
//
// The most important test in this file is the one about a blank chill
// temperature. A blank field is not a measurement, so it cannot be a breach —
// and if it were, people would learn to type a number to clear the red chip,
// which is the exact opposite of what a food-safety record is for.

import { describe, expect, it } from 'vitest';
import type { Batch, Recipe } from '@recipe-notebook/engine';
import { CONTROL_POINTS, haccpOf, labelHaccpNote, lastBatch } from './haccp.js';

const all = (): Record<string, boolean> =>
  Object.fromEntries(CONTROL_POINTS.map((c) => [c.id, true]));

const batch = (over: Partial<Batch> = {}): Batch => ({
  code: 'L250917-01',
  date: '17.9.2025',
  ...over,
});

describe('§13a acceptance', () => {
  it('four control points and a 4°C chill is compliant', () => {
    const s = haccpOf(batch({ ccp: all(), chillTemp: 4 }));
    expect(s.level).toBe('ok');
    expect(s.label).toBe('HACCP תקין');
    expect(s.done).toBe(4);
    expect(labelHaccpNote(s)).toBe('כל נקודות הבקרה תועדו לאצווה הזאת');
  });

  it('the SAME batch at 7°C is a breach even with every point ticked', () => {
    const s = haccpOf(batch({ ccp: all(), chillTemp: 7 }));
    expect(s.level).toBe('breach');
    expect(s.done).toBe(4);
    // And it says which limit was passed, with the number.
    expect(s.breach).toContain('7');
    expect(s.breach).toContain('5');
  });

  it('a batch from before the feature is not shown as compliant', () => {
    // No `ccp` at all — an older record.
    const s = haccpOf(batch({ chillTemp: 3 }));
    expect(s.level).toBe('none');
    expect(s.label).toBe('לא תועד');
    expect(s.done).toBe(0);
  });

  it('some points ticked is partial, and says how many', () => {
    const s = haccpOf(batch({ ccp: { core: true, clean: true } }));
    expect(s.level).toBe('partial');
    expect(s.done).toBe(2);
    expect(s.total).toBe(4);
  });
});

describe('a blank field is not a measurement', () => {
  it('no chill temperature is not a breach', () => {
    expect(haccpOf(batch({ ccp: all() })).level).toBe('ok');
    expect(haccpOf(batch({ ccp: all(), chillTemp: '' })).level).toBe('ok');
    expect(haccpOf(batch({ ccp: all(), chillTemp: '   ' })).level).toBe('ok');
  });

  it('but 0°C IS a measurement, and a good one', () => {
    const s = haccpOf(batch({ ccp: all(), chillTemp: 0 }));
    expect(s.level).toBe('ok');
  });

  it('text where a temperature should be is not read as a number', () => {
    // "בערך 8" must not become a breach by accident, nor a pass: it is not a
    // measurement, so it is treated as absent.
    expect(haccpOf(batch({ ccp: all(), chillTemp: 'בערך 8' })).level).toBe('ok');
  });

  it('a temperature stored as a string still counts', () => {
    // The forms in this app hold numeric fields as strings on purpose.
    expect(haccpOf(batch({ ccp: all(), chillTemp: '7' })).level).toBe('breach');
    expect(haccpOf(batch({ ccp: all(), chillTemp: '4.5' })).level).toBe('ok');
  });

  it('exactly 5°C is inside the limit', () => {
    expect(haccpOf(batch({ ccp: all(), chillTemp: 5 })).level).toBe('ok');
    expect(haccpOf(batch({ ccp: all(), chillTemp: 5.1 })).level).toBe('breach');
  });

  it('a ccp key that is present but false does not count as ticked', () => {
    const s = haccpOf(batch({ ccp: { core: true, chill: false, clean: false, alrg: false } }));
    expect(s.done).toBe(1);
    expect(s.level).toBe('partial');
  });
});

describe('which batch the label speaks for', () => {
  const r = (batches: Batch[]): Recipe => ({ id: 'x', batches }) as Recipe;

  it('is the last one recorded', () => {
    expect(lastBatch(r([batch({ code: 'A' }), batch({ code: 'B' })]))?.code).toBe('B');
  });

  it('is nothing at all when there are no batches — not "לא תועד"', () => {
    expect(lastBatch(r([]))).toBeNull();
    expect(lastBatch({ id: 'x' } as Recipe)).toBeNull();
  });

  it('falls back to the one before when the last is removed', () => {
    // Derived on every read, so a delete needs no extra bookkeeping.
    const list = [batch({ code: 'A' }), batch({ code: 'B' })];
    expect(lastBatch(r(list.slice(0, 1)))?.code).toBe('A');
  });
});
