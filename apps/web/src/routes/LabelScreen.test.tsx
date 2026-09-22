// §2 screen 8 — the product label.
//
// This is the only screen whose output is read by someone who cannot ask a
// question about it, so the tests are written against the ways a label can
// lie rather than against its layout. Three matter most:
//
//   · an unresolved weight must take EVERY percentage off the label
//   · the allergen line must never be blank
//   · a base recipe must be declared by its contents
//
// The composition arithmetic itself is held by
// features/recipe/labelComposition.test.ts; what is tested here is that the
// screen obeys it.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { defaultPrefs, type Batch, type Recipe } from '@recipe-notebook/engine';
import { LabelScreen } from './LabelScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';

const GANACHE: Recipe = {
  id: 'ganache',
  name: 'גנאש מריר',
  isSub: true,
  yieldActual: 1000,
  ingredients: [
    { id: 'g1', name: 'שוקולד מריר', qty: 600, unit: 'g' },
    { id: 'g2', name: 'שמנת מתוקה', qty: 400, unit: 'g' },
  ],
};

const TART: Recipe = {
  id: 'tart',
  name: 'טארט שוקולד',
  category: 'טארטים',
  unitWeight: 120,
  yieldUnits: 8,
  shelfLife: '3 ימים בקירור',
  storage: 'לשמור בקירור עד 4°C',
  privateNotes: 'סוד מקצועי שלי',
  ingredients: [
    { id: 't1', name: 'קמח לבן', qty: 300, unit: 'g' },
    { id: 't2', name: 'גנאש מריר', subId: 'ganache', qty: 500, unit: 'g' },
  ],
};

function show(opts: { recipes?: Recipe[]; id?: string; pro?: boolean } = {}) {
  return renderRoute(<LabelScreen />, {
    path: '/recipe/:recipeId/label',
    route: `/recipe/${opts.id ?? 'tart'}/label`,
    repository: fakeRepository({
      prefs: { ...defaultPrefs(opts.pro === false ? 'home' : 'pro'), done: true },
      recipes: opts.recipes ?? [GANACHE, TART],
      catalog: [],
    }),
  });
}

describe('the declaration', () => {
  it('lists the ingredients heaviest first, with shares', async () => {
    show();
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent('רכיבים:');
    // 300 g flour, and the 500 g of ganache resolve to 300 g chocolate and
    // 200 g cream — 800 g in all, so cream is 25% and is the lightest, which
    // puts it last.
    expect(label.textContent).toMatch(/שמנת מתוקה \(25\.0%\)/);
    expect(label).toHaveTextContent('קמח לבן (37.5%)');
    const decl = label.textContent ?? '';
    expect(decl.indexOf('שמנת מתוקה')).toBeGreaterThan(decl.indexOf('קמח לבן'));
  });

  it('declares a base recipe by its CONTENTS, not by its name', async () => {
    show();
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent('שוקולד מריר');
    expect(label).toHaveTextContent('שמנת מתוקה');
    // "גנאש מריר" is the recipe's own name in the heading, so the check has to
    // be about the declaration line and not the whole label.
    const decl = label.textContent ?? '';
    const after = decl.slice(decl.indexOf('רכיבים:'));
    expect(after).not.toContain('גנאש');
  });
});

describe('when a weight is not known', () => {
  const OPAQUE: Recipe = {
    id: 'opaque',
    name: 'עוגת מאצ׳ה',
    ingredients: [
      { id: 'o1', name: 'קמח לבן', qty: 500, unit: 'g' },
      // A cup of a powder with no reliable density: the engine refuses to
      // invent a weight, so the total is unknown.
      { id: 'o2', name: 'אבקת מאצ׳ה', qty: 1, unit: 'cup' },
    ],
  };

  it('prints no percentages at all — not even for the ingredients it does know', async () => {
    show({ recipes: [OPAQUE], id: 'opaque' });
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label.textContent).not.toContain('%');
  });

  it('explains why, and names what is missing', async () => {
    show({ recipes: [OPAQUE], id: 'opaque' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/האחוזים אינם מוצגים/);
    expect(alert).toHaveTextContent(/אבקת מאצ/);
    expect(screen.getByRole('link', { name: /להשלמת הנתונים/ })).toBeInTheDocument();
  });

  it('still names the ingredient it could not weigh, rather than omitting it', async () => {
    show({ recipes: [OPAQUE], id: 'opaque' });
    // It is absent from the declaration line (it has no weight to sort by) but
    // it is named on the screen, which is what stops it being forgotten.
    expect(await screen.findByRole('alert')).toHaveTextContent('אבקת מאצ׳ה');
  });
});

describe('allergens', () => {
  it('never leaves the line blank, because a blank reads as "there are none"', async () => {
    const plain: Recipe = {
      id: 'plain',
      name: 'סירופ סוכר',
      ingredients: [{ id: 'p1', name: 'סוכר', qty: 500, unit: 'g' }],
    };
    show({ recipes: [plain], id: 'plain' });
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent('מכיל: לא זוהו אלרגנים לפי שמות הרכיבים');
  });

  it('carries an allergen declared by hand on a BASE recipe', async () => {
    // The engine fix behind this is in packages/engine/src/compute.ts. The
    // base is named so the allergen table cannot recognise it, which is what
    // makes this a real test.
    const secret: Recipe = {
      id: 'secret',
      name: 'תערובת סודית',
      isSub: true,
      yieldActual: 1000,
      manualAllergens: ['אגוזים'],
      ingredients: [{ id: 's1', name: 'סוכר', qty: 1000, unit: 'g' }],
    };
    const product: Recipe = {
      id: 'product',
      name: 'מוצר',
      ingredients: [
        { id: 'r1', name: 'תערובת סודית', subId: 'secret', qty: 500, unit: 'g' },
      ],
    };
    show({ recipes: [secret, product], id: 'product' });
    expect(await screen.findByLabelText('תווית המוצר')).toHaveTextContent('אגוזים');
  });
});

describe('§13a the HACCP line', () => {
  const withBatch = (b: Batch): Recipe[] => [GANACHE, { ...TART, batches: [b] }];
  const allFour = { core: true, chill: true, clean: true, alrg: true };

  it('confirms a compliant batch, and names it', async () => {
    show({ recipes: withBatch({ code: 'L250917-01', date: '17.9', ccp: allFour, chillTemp: 4 }) });
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent('L250917-01');
    expect(label).toHaveTextContent('HACCP תקין');
    expect(label).toHaveTextContent('כל נקודות הבקרה תועדו לאצווה הזאת');
  });

  it('shows a cold-chain breach even when every control point is ticked', async () => {
    show({ recipes: withBatch({ code: 'L2', ccp: allFour, chillTemp: 7 }) });
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent('חריגה');
    expect(label).toHaveTextContent('לפני הדפסה יש להשלים את התיעוד');
    // And the number, off the label where it does not belong but on screen
    // where the person printing it will read it.
    expect(screen.getByRole('status')).toHaveTextContent(/7°C/);
  });

  it('does not print any status when the recipe has no batch', async () => {
    show();
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).not.toHaveTextContent('HACCP');
    expect(label).not.toHaveTextContent('לא תועד');
    // §13a's edge case, said out loud: no status is not "undocumented".
    expect(screen.getByText(/אינה מציגה מספר אצווה או סטטוס בטיחות מזון/)).toBeInTheDocument();
  });

  it('does not block printing on a missing record (§13a UX decision)', async () => {
    show({ recipes: withBatch({ code: 'L3' }) });
    expect(
      await screen.findByRole('button', { name: 'הדפסה / שמירה כ-PDF' }),
    ).toBeEnabled();
  });
});

describe('what a label must not carry', () => {
  it('has no private note on it (§8)', async () => {
    show();
    await screen.findByLabelText('תווית המוצר');
    expect(screen.queryByText('סוד מקצועי שלי')).not.toBeInTheDocument();
  });

  it('has no cost on it, even on a professional profile', async () => {
    show();
    await screen.findByLabelText('תווית המוצר');
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
  });

  it('is reachable on a home profile too — §3 locks no feature', async () => {
    show({ pro: false });
    expect(await screen.findByLabelText('תווית המוצר')).toBeInTheDocument();
  });
});

describe('the net weight says what it is the weight OF', () => {
  it('uses the per-unit weight when the recipe has one', async () => {
    show();
    expect(await screen.findByLabelText('תווית המוצר')).toHaveTextContent("משקל נטו 120 גר'");
  });

  it('says "תשואת האצווה" when the only weight known is a whole batch', async () => {
    // Otherwise the label would put a batch weight where a package weight
    // belongs, which is a true number about the wrong thing.
    const noUnit: Recipe = { ...TART, id: 'nounit', unitWeight: 0 };
    show({ recipes: [GANACHE, noUnit], id: 'nounit' });
    const label = await screen.findByLabelText('תווית המוצר');
    expect(label).toHaveTextContent(/תשואת האצווה/);
    expect(label).not.toHaveTextContent('משקל נטו');
  });
});

describe('the screen does not overclaim', () => {
  it('says it is not a regulator-approved label', async () => {
    show();
    expect(await screen.findByText(/זו אינה תווית מאושרת לרגולציה/)).toBeInTheDocument();
  });

  it('says so when the recipe is not in the notebook', async () => {
    show({ id: 'nope' });
    expect(await screen.findByText('המתכון הזה לא נמצא במחברת.')).toBeInTheDocument();
  });
});
