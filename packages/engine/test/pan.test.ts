// §7 — pans. The numbers below are the prototype's own arithmetic
// (`measure.js#panArea/panFactor`) recomputed by hand, so this file is a parity
// check on a port and not a restatement of the implementation.

import { describe, expect, it } from 'vitest';
import {
  GN,
  PAN_KINDS,
  PAN_SUGGEST_THRESHOLD,
  panArea,
  panFactor,
  panIsEmpty,
  panLabel,
  panWorthAdapting,
  type Pan,
} from '../src/index.js';

const round = (n: number) => Math.round(n * 1000) / 1000;

describe('panArea', () => {
  it('a round pan is π·r²', () => {
    expect(round(panArea({ kind: 'round', diameter: 20 })!)).toBe(round(Math.PI * 100));
  });

  it('a rectangular pan is width × length, and height is not part of the area', () => {
    expect(panArea({ kind: 'rect', width: 20, length: 30, height: 5 })).toBe(600);
  });

  it('an english-cake pan is measured the same way', () => {
    expect(panArea({ kind: 'loaf', width: 10, length: 25, height: 7 })).toBe(250);
  });

  it('a GN pan comes from the table, not from typed dimensions', () => {
    expect(panArea({ kind: 'gn', gn: '1/1' })).toBe(GN['1/1']!.w * GN['1/1']!.l);
    expect(panArea({ kind: 'gn', gn: '1/2' })).toBe(GN['1/2']!.w * GN['1/2']!.l);
  });

  it('a muffin tin is counted in cavities, which is what a baker scales by', () => {
    expect(panArea({ kind: 'muffin', cavities: 12 })).toBe(12);
  });

  it('has NO area when the dimension was not filled in — not zero', () => {
    expect(panArea({ kind: 'round' })).toBeNull();
    expect(panArea({ kind: 'round', diameter: '' })).toBeNull();
    expect(panArea({ kind: 'rect', width: 20 })).toBeNull();
    expect(panArea({ kind: 'gn', gn: 'GN 9/9' })).toBeNull();
    expect(panArea({ kind: 'none' })).toBeNull();
    expect(panArea(null)).toBeNull();
  });

  it('treats 0 and a negative as unknown, because no pan has them', () => {
    expect(panArea({ kind: 'round', diameter: 0 })).toBeNull();
    expect(panArea({ kind: 'rect', width: -5, length: 10 })).toBeNull();
  });
});

describe('panFactor', () => {
  it('compares by AREA when a height is missing', () => {
    // Ø20 → Ø26 is (13² / 10²) = 1.69, the example in §7.
    const c = panFactor({ kind: 'round', diameter: 20 }, { kind: 'round', diameter: 26 })!;
    expect(round(c.factor)).toBe(1.69);
    expect(c.byVolume).toBe(false);
  });

  it('compares by VOLUME when both heights are known', () => {
    const c = panFactor(
      { kind: 'rect', width: 20, length: 20, height: 4 },
      { kind: 'rect', width: 20, length: 20, height: 8 },
    )!;
    expect(c.factor).toBe(2);
    expect(c.byVolume).toBe(true);
  });

  it('falls back to area when only ONE height is known', () => {
    // A height we do not have cannot enter a volume.
    const c = panFactor(
      { kind: 'rect', width: 20, length: 20, height: 4 },
      { kind: 'rect', width: 20, length: 40 },
    )!;
    expect(c.factor).toBe(2);
    expect(c.byVolume).toBe(false);
  });

  it('compares across kinds, because a baker really does swap them', () => {
    const c = panFactor({ kind: 'round', diameter: 20 }, { kind: 'rect', width: 20, length: 20 })!;
    expect(round(c.factor)).toBe(round(400 / (Math.PI * 100)));
  });

  it('is null when either pan is unknown — never 1', () => {
    expect(panFactor({ kind: 'round' }, { kind: 'round', diameter: 26 })).toBeNull();
    expect(panFactor({ kind: 'round', diameter: 20 }, { kind: 'none' })).toBeNull();
    expect(panFactor(null, null)).toBeNull();
  });

  it('returns 1 for two identical pans, which is an answer and not a fallback', () => {
    const c = panFactor({ kind: 'round', diameter: 20 }, { kind: 'round', diameter: 20 })!;
    expect(c.factor).toBe(1);
    expect(panWorthAdapting(c)).toBe(false);
  });
});

describe('the suggestion threshold (§7)', () => {
  it('stays quiet inside ±2%', () => {
    expect(panWorthAdapting({ factor: 1.02, byVolume: false })).toBe(false);
    expect(panWorthAdapting({ factor: 0.99, byVolume: false })).toBe(false);
  });

  it('speaks up outside it, in both directions', () => {
    expect(panWorthAdapting({ factor: 1.03, byVolume: false })).toBe(true);
    expect(panWorthAdapting({ factor: 0.8, byVolume: false })).toBe(true);
  });

  it('says nothing at all when there is no comparison', () => {
    expect(panWorthAdapting(null)).toBe(false);
  });

  it('is the number §7 names', () => {
    expect(PAN_SUGGEST_THRESHOLD).toBe(0.02);
  });
});

describe('panLabel', () => {
  it('writes a round pan with its diameter and height', () => {
    expect(panLabel({ kind: 'round', diameter: 20, height: 7 })).toBe('Ø20×7 ס"מ');
    expect(panLabel({ kind: 'round', diameter: 20 })).toBe('Ø20 ס"מ');
  });

  it('writes a rectangle, a GN and a muffin tin', () => {
    expect(panLabel({ kind: 'rect', width: 20, length: 30 })).toBe('20×30 ס"מ');
    expect(panLabel({ kind: 'gn', gn: '1/2' })).toBe('GN 1/2');
    expect(panLabel({ kind: 'muffin', cavities: 12 })).toBe('12 שקעי מאפינס');
  });

  it('says nothing rather than something misleading when the pan is blank', () => {
    expect(panLabel({ kind: 'round' })).toBe('');
    expect(panLabel({ kind: 'none' })).toBe('');
    expect(panLabel(null)).toBe('');
  });
});

describe('panIsEmpty — what the editor may drop on save', () => {
  it('is empty for no pan, and for a kind with nothing filled in', () => {
    expect(panIsEmpty(null)).toBe(true);
    expect(panIsEmpty({ kind: 'none' })).toBe(true);
    expect(panIsEmpty({ kind: 'round' })).toBe(true);
  });

  it('is NOT empty once anything real is there, height alone included', () => {
    expect(panIsEmpty({ kind: 'round', diameter: 20 })).toBe(false);
    expect(panIsEmpty({ kind: 'round', height: 7 })).toBe(false);
  });
});

describe('PAN_KINDS', () => {
  it('lists the six kinds §7 names, with the fields each one asks for', () => {
    expect(PAN_KINDS.map((k) => k.id)).toEqual([
      'round',
      'rect',
      'gn',
      'loaf',
      'muffin',
      'none',
    ]);
    expect(PAN_KINDS.find((k) => k.id === 'round')!.fields).toEqual(['diameter', 'height']);
    expect(PAN_KINDS.find((k) => k.id === 'none')!.fields).toEqual([]);
  });

  it('every kind that asks for a field can produce an area from it', () => {
    const sample: Record<string, Pan> = {
      round: { kind: 'round', diameter: 20 },
      rect: { kind: 'rect', width: 10, length: 10 },
      gn: { kind: 'gn', gn: '1/1' },
      loaf: { kind: 'loaf', width: 10, length: 20 },
      muffin: { kind: 'muffin', cavities: 6 },
    };
    for (const k of PAN_KINDS) {
      if (k.id === 'none') continue;
      expect(panArea(sample[k.id]!)).not.toBeNull();
    }
  });
});
