// Duplicating a recipe.
//
// The tests that matter here are the negative ones. Copying a formula is easy;
// the risk is copying things that are records of something that happened — a
// production batch with its HACCP fields, a trial log, an approval — into a
// recipe that none of it happened to.

import { describe, expect, it } from 'vitest';
import type { Recipe } from '@recipe-notebook/engine';
import { copyName, duplicateRecipe } from './duplicate.js';

const FULL: Recipe = {
  id: 'r1',
  name: 'בריוש נאנטר',
  category: 'לחמים',
  tags: ['חג'],
  locked: true,
  yieldUnits: 12,
  unitWeight: 85,
  targetFC: 28,
  notes: 'הערה ציבורית',
  privateNotes: 'ההערה הפרטית שלי',
  versionOf: 'r0',
  versionNote: 'הועלתה החמאה',
  savedFrom: 'group1:item9',
  createdAt: '2026-01-01',
  ingredients: [{ id: 'i1', name: 'קמח לחם', qty: 1000, unit: 'גרם', flour: true }],
  steps: [{ id: 's1', text: 'ללוש', minutes: 12 }],
  issues: [{ id: 'is1', p: 'הבצק נדבק', s: 'לקרר את החמאה' }],
  trials: [{ id: 't1', date: '2026-02-01', note: 'ניסיון ראשון' }],
  batches: [
    { id: 'b1', code: 'BR-001', date: '2026-02-02', coreTemp: 94, chillTemp: 4, ccp: { core: true } },
  ],
  versions: [{ tag: 'v1', at: '2026-01-05', what: 'שונתה כמות', snapshot: {} as Recipe }],
  pan: { kind: 'loaf', length: 30, width: 11 },
};

describe('what a copy inherits', () => {
  const copy = duplicateRecipe(FULL);

  it('the formula — ingredients and steps', () => {
    expect(copy.ingredients?.map((i) => i.name)).toEqual(['קמח לחם']);
    expect(copy.steps?.map((s) => s.text)).toEqual(['ללוש']);
  });

  it('the yield, the pricing target and the texts', () => {
    expect(copy.yieldUnits).toBe(12);
    expect(copy.unitWeight).toBe(85);
    expect(copy.targetFC).toBe(28);
    expect(copy.notes).toBe('הערה ציבורית');
  });

  it('the category, the tags and the pan', () => {
    expect(copy.category).toBe('לחמים');
    expect(copy.tags).toEqual(['חג']);
    expect(copy.pan).toEqual({ kind: 'loaf', length: 30, width: 11 });
  });

  it('the troubleshooting notes, which are knowledge about the formula', () => {
    expect(copy.issues?.map((i) => i.p)).toEqual(['הבצק נדבק']);
  });
});

describe('what a copy must NOT inherit', () => {
  const copy = duplicateRecipe(FULL);

  it('the production approval — a copy has not been approved (§9)', () => {
    expect(FULL.locked).toBe(true);
    expect(copy.locked).toBe(false);
  });

  it('the HACCP batch records — copying these would fabricate food-safety records', () => {
    expect(copy.batches).toBeUndefined();
  });

  it('the trial log, which is a record of what was actually baked', () => {
    expect(copy.trials).toBeUndefined();
  });

  it('the version history, which belongs to the recipe it happened to (§9)', () => {
    expect(copy.versions).toBeUndefined();
    expect(copy.versionOf).toBeNull();
    expect(copy.versionNote).toBe('');
  });

  it('the private note (§8) — a note about one bake is not about another', () => {
    expect(copy.privateNotes).toBeUndefined();
  });

  it('the group provenance (§11)', () => {
    expect(copy.savedFrom).toBeNull();
  });

  it('the creation date, which the database owns', () => {
    expect(copy.createdAt).toBeUndefined();
  });
});

describe('the original is never touched', () => {
  it('leaves every field on the source recipe as it was', () => {
    const before = JSON.stringify(FULL);
    duplicateRecipe(FULL);
    expect(JSON.stringify(FULL)).toBe(before);
  });

  it('deep-copies the arrays, so editing the copy cannot reach back', () => {
    const copy = duplicateRecipe(FULL);
    copy.ingredients![0]!.qty = 9999;
    copy.tags!.push('חדש');
    expect(FULL.ingredients![0]!.qty).toBe(1000);
    expect(FULL.tags).toEqual(['חג']);
  });

  it('deep-copies the pan', () => {
    const copy = duplicateRecipe(FULL);
    (copy.pan as { length: number }).length = 40;
    expect((FULL.pan as { length: number }).length).toBe(30);
  });
});

describe('the copy is a new recipe as far as the repository is concerned', () => {
  it('carries a `new-` id, which is the INSERT signal', () => {
    expect(duplicateRecipe(FULL).id.startsWith('new-')).toBe(true);
  });
});

describe('naming', () => {
  it('appends a copy marker', () => {
    expect(copyName('לחם כוסמין')).toBe('לחם כוסמין (עותק)');
  });

  it('counts up instead of stacking markers', () => {
    // "לחם (עותק) (עותק)" is what a naive implementation produces, and after
    // three duplications it is unreadable.
    expect(copyName('לחם (עותק)', ['לחם (עותק)'])).toBe('לחם (עותק 2)');
    expect(copyName('לחם (עותק 2)', ['לחם (עותק)', 'לחם (עותק 2)'])).toBe('לחם (עותק 3)');
  });

  it('skips a name already taken', () => {
    expect(copyName('לחם', ['לחם (עותק)'])).toBe('לחם (עותק 2)');
  });

  it('handles a nameless recipe without producing an empty name', () => {
    // The database rejects a blank name outright (a CHECK constraint), so this
    // has to produce something.
    expect(copyName('   ')).toBe('מתכון (עותק)');
  });

  it('picks a free name through the notebook the screen passes in', () => {
    const copy = duplicateRecipe(FULL, {
      existingNames: ['בריוש נאנטר', 'בריוש נאנטר (עותק)'],
    });
    expect(copy.name).toBe('בריוש נאנטר (עותק 2)');
  });
});
