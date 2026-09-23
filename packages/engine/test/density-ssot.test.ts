import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCEPTED,
  ACCEPTED_SINGLE_SOURCE,
  DENSITY_CONFLICTS,
  DENSITY_TABLE,
  FALLBACK_DIVERGENCES,
  KNOWN_DATA_GAPS,
  KNOWN_GAPS,
  LEGACY_CUP_ML,
  LEGACY_INVENTED_FALLBACKS,
  PENDING_FORM,
  PENDING_VERIFICATION,
  SPLIT_TABLE_ERRORS,
  SUSPECT_TERMS,
  conflictSummary,
  densityFor,
  densityUnavailableReason,
  lookupDensity,
  unvaluedEntries,
  valuedEntries,
} from '../src/index.js';
import { PROTOTYPE_DIR, prefsWithCup } from './helpers.js';

const P240 = prefsWithCup(240);

describe('B2 — one table, and nothing lost on the way in', () => {
  it('every row records where its numbers came from, or says it has none', () => {
    for (const e of DENSITY_TABLE) {
      const hasSources = Object.keys(e.sources).length > 0;
      if (!hasSources) {
        // only allowed for a declared form with no legacy measurement at all
        expect(e.resolution).toBe('pending-form');
        expect(e.needsReview).toBe(true);
      }
    }
  });

  it('every term from the legacy measure.TABLE still resolves to a row', () => {
    const src = readFileSync(join(PROTOTYPE_DIR, 'measure.js'), 'utf8');
    const block = src.slice(
      src.indexOf('const TABLE = ['),
      src.indexOf('function tableLookup'),
    );
    const groups = [...block.matchAll(/keys:\s*\[([^\]]+)\]/g)].map((m) =>
      [...m[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((t) =>
        t[1]!.replace(/\\'/g, "'"),
      ),
    );
    expect(groups.length).toBe(25);
    for (const group of groups) {
      for (const term of group) {
        expect(
          lookupDensity(term),
          `legacy term "${term}" no longer resolves`,
        ).not.toBeNull();
      }
    }
  });

  it('every legacy engine.CUP_DRY ingredient still resolves', () => {
    for (const term of [
      'קמח', 'סוכר חום', 'דמררה', 'אבקת סוכר', 'קקאו', 'סוכר', 'חמאה',
      'שקד', 'אגוז', 'פיסטוק', 'פקאן', 'אורז', 'מלח', 'שיבולת שועל',
      'קוואקר', 'שוקולד',
    ]) {
      expect(lookupDensity(term), `"${term}" missing`).not.toBeNull();
    }
  });

  it('every legacy engine.DENS liquid still resolves, including the two it alone had', () => {
    for (const term of [
      'שמן', 'קנולה', 'זית', 'חמניות', 'דבש', 'סילאן', 'גלוקוז', 'אינוורט',
      'מייפל', 'סירופ', 'מולסה', 'חלב', 'ביצה', 'ביצים', 'חלמון',
      'שמנת', 'קרם פרש', 'ליקר', 'רום', 'ברנדי', 'וודקה', 'מיץ', 'פירה', 'פולפה',
    ]) {
      expect(lookupDensity(term), `"${term}" missing`).not.toBeNull();
    }
    expect(lookupDensity('סירופ')?.key).toBe('syrup.thick');
    expect(lookupDensity('ביצים')?.key).toBe('egg.whole');
  });

  it('keys are unique, and every value that exists is a plausible g/100ml', () => {
    const keys = DENSITY_TABLE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of DENSITY_TABLE) {
      if (e.gPer100 == null) continue;
      expect(e.gPer100).toBeGreaterThan(0);
      expect(e.gPer100).toBeLessThan(250);
    }
  });

  it('every value in the table traces to a legacy source — nothing invented', () => {
    for (const e of valuedEntries()) {
      const values = Object.values(e.sources);
      expect(values.length, `${e.key} has a value but no source`).toBeGreaterThan(0);
      const matches = values.some(
        (v) => Math.abs(v - e.gPer100!) / e.gPer100! <= 0.031,
      );
      expect(matches, `${e.key}: ${e.gPer100} matches no recorded source`).toBe(true);
    }
  });

  it('lookup is order based, so specific terms beat general ones', () => {
    expect(lookupDensity('קמח מלא')?.key).toBe('flour.wholemeal');
    expect(lookupDensity('קמח לחם 13% חלבון')?.key).toBe('flour.white');
    expect(lookupDensity('סוכר חום בהיר')?.key).toBe('sugar.brown');
    expect(lookupDensity('אבקת סוכר')?.key).toBe('sugar.powdered');
    expect(lookupDensity('אבקת סוכר וניל')?.key).toBe('sugar.powdered');
  });
});

describe('resolution status of every row', () => {
  it('the summary adds up', () => {
    const s = conflictSummary();
    expect(s.rows).toBe(DENSITY_TABLE.length);
    expect(
      s.accepted + s.acceptedSingleSource + s.pendingVerification + s.pendingForm,
    ).toBe(DENSITY_TABLE.length);
    expect(s.tolerancePct).toBe(3);
  });

  it('accepted rows carry a value; pending rows do not', () => {
    for (const e of DENSITY_TABLE) {
      if (e.resolution === 'accepted' || e.resolution === 'accepted-single-source') {
        expect(e.gPer100, `${e.key} should have a value`).not.toBeNull();
      } else {
        expect(e.gPer100, `${e.key} must not have a value`).toBeNull();
      }
    }
  });

  it('every row needing review appears in the report, and only those', () => {
    const reviewed = DENSITY_TABLE.filter((e) => e.needsReview).map((e) => e.key);
    expect(DENSITY_CONFLICTS.map((c) => c.key).sort()).toEqual(reviewed.sort());
    for (const c of DENSITY_CONFLICTS) {
      expect(c.reviewNote.length, `${c.key} has no review note`).toBeGreaterThan(10);
    }
  });

  it('accepted rows are not in the report at all', () => {
    for (const key of ACCEPTED) {
      expect(DENSITY_CONFLICTS.find((c) => c.key === key)).toBeUndefined();
    }
    expect(ACCEPTED).toContain('flour.white');
    expect(ACCEPTED).toContain('sugar.powdered');
    expect(ACCEPTED).toContain('butter');
    expect(ACCEPTED).toContain('milk');
    expect(ACCEPTED).toContain('syrup.invert');
  });
});

describe('decision §5 — conflicting values: neither is adopted', () => {
  const keys = ['cocoa', 'rice', 'flour.wholemeal', 'alcohol.spirit', 'alcohol.liqueur'];

  it('all of them are pending verification with no value in use', () => {
    expect(PENDING_VERIFICATION.map((c) => c.key).sort()).toEqual(keys.slice().sort());
    for (const c of PENDING_VERIFICATION) {
      expect(c.resolved).toBeNull();
    }
  });

  it('both candidate values are kept on record for each', () => {
    const cocoa = PENDING_VERIFICATION.find((c) => c.key === 'cocoa')!;
    expect(cocoa.candidates.map((x) => x.source).sort()).toEqual([
      'engine.CUP_DRY',
      'measure.TABLE',
      'parser.DRY',
    ]);
    expect(cocoa.candidates.find((x) => x.source === 'measure.TABLE')?.gPer100).toBe(42);
    expect(
      cocoa.candidates.find((x) => x.source === 'engine.CUP_DRY')?.gPer100,
    ).toBeCloseTo(45.83, 2);
    expect(cocoa.maxDeltaPct).toBeCloseTo(9.1, 1);
  });

  it('the engine answers "unavailable" and explains the conflict', () => {
    expect(densityFor({ name: 'קקאו' }, P240, 'cup')).toBeNull();
    const why = densityUnavailableReason({ name: 'קקאו' });
    expect(why).toContain('נתונים סותרים');
    expect(why).toContain('42');
    expect(why).toContain('45.8');
    expect(why).toContain('כיול אישי');
  });

  it('rice and wholemeal flour behave the same way', () => {
    expect(densityFor({ name: 'אורז' }, P240, 'cup')).toBeNull();
    expect(densityFor({ name: 'קמח מלא' }, P240, 'cup')).toBeNull();
    expect(densityUnavailableReason({ name: 'אורז' })).toContain('נתונים סותרים');
  });

  it('a personal calibration still overrides a pending row', () => {
    const prefs = prefsWithCup(240, {
      calib: [
        { name: 'קקאו', tool: 'cup' as const, toolMl: 240, grams: 100, at: '2026-01-01' },
      ],
    });
    const d = densityFor({ name: 'קקאו' }, prefs, 'cup');
    expect(d?.source).toBe('personal');
    expect(d?.gPer100).toBeCloseTo(41.67, 2);
  });
});

describe('decision §2/§3/§4 — different forms become different entities', () => {
  it('nuts split into ground, chopped, whole and an explicit form-less row', () => {
    const keys = PENDING_FORM.map((c) => c.key);
    expect(keys).toContain('nuts.ground');
    expect(keys).toContain('nuts.chopped');
    expect(keys).toContain('nuts.whole');
    expect(keys).toContain('nuts.unspecified');
  });

  it('no nut form carries a value, and a form-less name never gets one', () => {
    for (const n of ['שקדים', 'אגוזים', 'פקאן', 'שקדים טחונים', 'שקדים שלמים', 'אגוזים קצוצים']) {
      expect(densityFor({ name: n }, P240, 'cup'), `"${n}"`).toBeNull();
    }
  });

  it('the form-less row routes to the right entity and explains the forms', () => {
    expect(lookupDensity('שקדים')?.key).toBe('nuts.unspecified');
    expect(lookupDensity('שקדים טחונים')?.key).toBe('nuts.ground');
    expect(lookupDensity('אבקת שקדים')?.key).toBe('nuts.ground');
    expect(lookupDensity('קמח שקדים')?.key).toBe('nuts.ground');
    expect(lookupDensity('אגוזים קצוצים')?.key).toBe('nuts.chopped');
    expect(lookupDensity('שקדים שלמים')?.key).toBe('nuts.whole');
    const why = densityUnavailableReason({ name: 'שקדים' });
    expect(why).toContain('נמדד אחרת בכל צורה');
    expect(why).toContain('כיול אישי');
  });

  it('each nut form keeps the candidate that belongs to it, and claims nothing', () => {
    const ground = PENDING_FORM.find((c) => c.key === 'nuts.ground')!;
    const whole = PENDING_FORM.find((c) => c.key === 'nuts.whole')!;
    const chopped = PENDING_FORM.find((c) => c.key === 'nuts.chopped')!;
    expect(ground.candidates).toEqual([{ source: 'measure.TABLE', gPer100: 42 }]);
    expect(whole.candidates.map((c) => c.gPer100)).toEqual([66.67, 66.67]);
    expect(chopped.candidates).toEqual([]);
    expect(ground.resolved).toBeNull();
    expect(whole.resolved).toBeNull();
    expect(chopped.resolved).toBeNull();
  });

  it('eggs split into whole, white and yolk, none carrying a density', () => {
    expect(lookupDensity('ביצים')?.key).toBe('egg.whole');
    expect(lookupDensity('חלבון')?.key).toBe('egg.white');
    expect(lookupDensity('חלמון')?.key).toBe('egg.yolk');
    for (const n of ['ביצה', 'ביצים', 'חלבון', 'חלמון', "מלנג'"]) {
      expect(densityFor({ name: n }, P240, 'cup'), `"${n}"`).toBeNull();
    }
  });

  it('"קמח לחם 13% חלבון" is still flour, not egg white', () => {
    expect(lookupDensity('קמח לחם 13% חלבון')?.key).toBe('flour.white');
    expect(densityFor({ name: 'קמח לחם 13% חלבון' }, P240, 'cup')?.gPer100).toBe(50);
  });

  it('eggs measured by the piece are unaffected — that is the normal case', () => {
    // count units never touch density, so the split costs nothing in practice
    expect(lookupDensity('ביצים')?.gPer100).toBeNull();
  });

  it('alcohol splits by type, and only wine has an uncontradicted source', () => {
    expect(lookupDensity('יין')?.key).toBe('alcohol.wine');
    expect(lookupDensity('רום')?.key).toBe('alcohol.spirit');
    expect(lookupDensity('ליקר')?.key).toBe('alcohol.liqueur');
    expect(densityFor({ name: 'יין לבן' }, P240, 'ml')?.gPer100).toBe(98);
    expect(densityFor({ name: 'רום כהה' }, P240, 'ml')).toBeNull();
    expect(densityFor({ name: 'ליקר תפוזים' }, P240, 'ml')).toBeNull();
  });

  it('wine is flagged because its only source is a lumped row', () => {
    const wine = ACCEPTED_SINGLE_SOURCE.find((c) => c.key === 'alcohol.wine')!;
    expect(wine.resolved).toBe(98);
    expect(wine.candidates).toEqual([{ source: 'measure.TABLE', gPer100: 98 }]);
    expect(wine.reviewNote).toContain('שורה מקובצת');
  });
});

describe('decision §6 — known data gaps stay unresolved', () => {
  it('the table refuses to answer, and says why', () => {
    for (const n of KNOWN_DATA_GAPS) {
      expect(densityFor({ name: n }, P240, 'cup'), `"${n}"`).toBeNull();
    }
    const why = densityUnavailableReason({ name: 'קמח קוקוס' });
    expect(why).toContain('חומר גלם שונה');
    expect(why).toContain('כיול אישי');
  });

  it('what the prototype used to answer is on record', () => {
    expect(KNOWN_GAPS).toHaveLength(KNOWN_DATA_GAPS.length);
    expect(KNOWN_GAPS.find((g) => g.name === 'קמח אורז')?.legacyAnswerGramsPerCup).toBe(120);
    expect(KNOWN_GAPS.find((g) => g.name === 'אבקת חלב')?.legacyAnswerGramsPerCup).toBe(150);
  });

  it('a user calibration or a recipe value still works for a gap', () => {
    const own = prefsWithCup(240, {
      calib: [
        { name: 'קמח קוקוס', tool: 'cup' as const, toolMl: 240, grams: 112, at: '2026-01-01' },
      ],
    });
    expect(densityFor({ name: 'קמח קוקוס' }, own, 'cup')?.source).toBe('personal');
    expect(densityFor({ name: 'קמח קוקוס', gPer100: 47 }, P240, 'cup')?.source).toBe('recipe');
  });
});

describe('decision §7 — the invented fallbacks are gone from the lookup path', () => {
  it('their values are preserved for the record', () => {
    expect(LEGACY_INVENTED_FALLBACKS.dryGramsPerCup).toBe(150);
    expect(LEGACY_INVENTED_FALLBACKS.liquidGPerMl).toBe(1.0);
    expect(LEGACY_INVENTED_FALLBACKS.waterPctDefault).toBe(100);
    expect(LEGACY_CUP_ML).toBe(240);
  });

  it('but nothing reaches them', () => {
    expect(lookupDensity('אבקת מאצ׳ה סינית')).toBeNull();
    expect(densityFor({ name: 'אבקת מאצ׳ה סינית' }, P240, 'cup')).toBeNull();
    expect(densityFor({ name: 'נוזל לא מזוהה' }, P240, 'ml')).toBeNull();
  });

  it('fallback divergences and split-table errors are documented', () => {
    expect(FALLBACK_DIVERGENCES.length).toBeGreaterThanOrEqual(6);
    const corn = FALLBACK_DIVERGENCES.find((f) => f.key === 'starch.corn')!;
    expect(corn.tableValue).toBe(50);
    expect(corn.legacyFallback).toBeCloseTo(62.5, 6);
    expect(corn.deltaPct).toBeCloseTo(25, 1);
    expect(SPLIT_TABLE_ERRORS).toHaveLength(3);
    expect(SPLIT_TABLE_ERRORS[0]?.factor).toBeCloseTo(2.27, 2);
    expect(SUSPECT_TERMS.map((s) => s.term)).toContain('אבקת סוכר וניל');
  });
});

describe('what is still open, counted', () => {
  it('unvalued rows are exactly the pending ones', () => {
    const unvalued = unvaluedEntries().map((e) => e.key).sort();
    const pending = [...PENDING_VERIFICATION, ...PENDING_FORM]
      .map((c) => c.key)
      .sort();
    expect(unvalued).toEqual(pending);
  });

  it('the counts are what the report says', () => {
    const s = conflictSummary();
    expect(s.rows).toBe(34);
    expect(s.accepted).toBe(14);
    expect(s.acceptedSingleSource).toBe(8);
    expect(s.pendingVerification).toBe(5);
    expect(s.pendingForm).toBe(7);
    expect(s.knownGaps).toBe(11);
  });
});

describe('whole-word matching for short terms', () => {
  it('"מים" does not swallow "שקדים שלמים"', () => {
    expect(lookupDensity('שקדים שלמים')?.key).toBe('nuts.whole');
    expect(lookupDensity('אגוזים שלמים')?.key).toBe('nuts.whole');
  });

  it('but water itself, and water with a Hebrew prefix, still resolve', () => {
    expect(lookupDensity('מים')?.key).toBe('water');
    expect(lookupDensity('מים קרים')?.key).toBe('water');
    expect(lookupDensity('במים')?.key).toBe('water');
  });

  it('"חלב" does not swallow "חלבון"', () => {
    expect(lookupDensity('חלבון')?.key).toBe('egg.white');
    expect(lookupDensity('חלבון ביצה')?.key).toBe('egg.white');
  });

  it('but milk itself still resolves', () => {
    expect(lookupDensity('חלב')?.key).toBe('milk');
    expect(lookupDensity('חלב 3%')?.key).toBe('milk');
    expect(lookupDensity('חלב מרוכז')?.key).toBe('milk');
  });

  it('this failure class existed in the legacy table too', () => {
    // measure.TABLE put 'מים' and 'חלב' early and matched by substring, so
    // "שקדים שלמים" resolved as water and "חלבון" as milk. It was invisible
    // only because engine.DENS gave milk and egg white the same 1.03.
    expect(lookupDensity('שקדים שלמים')?.key).not.toBe('water');
    expect(lookupDensity('חלבון')?.key).not.toBe('milk');
  });
});
