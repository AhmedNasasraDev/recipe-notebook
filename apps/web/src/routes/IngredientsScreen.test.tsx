// The ingredient centre screen (stage-7 requirements 1, 3, 5).

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngredientsScreen } from './IngredientsScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';
import type { CatalogItem } from '../features/pricing/catalog.js';
import type {
  PurchaseInput,
  PurchaseRecord,
} from '../features/pricing/purchases.js';

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'c1',
  key: 'חמאה 82%',
  name: 'חמאה 82%',
  purchaseUnit: 'g',
  packageQty: 200,
  packageCount: 1,
  purchaseTotal: 8.9,
  usablePct: null,
  supplier: 'תנובה',
  purchasedAt: '2026-09-01',
  priceUpdatedAt: new Date().toISOString(),
  note: '',
  purchasePrice: 44.5,
  price: 44.5,
  priceUnit: 'ק"ג',
  allergens: ['חלב'],
  ...over,
});

const show = (
  opts: {
    catalog?: CatalogItem[];
    canWrite?: boolean;
    onSave?(i: CatalogItem): void;
    onPurchase?(p: PurchaseInput): void;
    history?: PurchaseRecord[];
    pricingOn?: { id: string; name: string; rows: number; overridden: number }[];
  } = {},
) =>
  renderRoute(<IngredientsScreen />, {
    path: '/ingredients',
    route: '/ingredients',
    repository: fakeRepository({
      catalog: opts.catalog ?? [],
      canWrite: opts.canWrite ?? true,
      onSaveCatalogItem: opts.onSave,
      onRecordPurchase: opts.onPurchase,
      history: opts.history,
      pricingOn: opts.pricingOn,
    }),
  });

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 1 — one place per material', () => {
  it('lists each material with its derived unit price', async () => {
    show({ catalog: [item()] });
    const list = await screen.findByLabelText('רשימת חומרי הגלם');
    expect(within(list).getByText('חמאה 82%')).toBeInTheDocument();
    // the PER-KILO price, derived from a 200 g pack — not the package price
    expect(list).toHaveTextContent('44.5');
  });

  it('shows the package it came from, the supplier and how old the price is', async () => {
    show({ catalog: [item()] });
    const list = await screen.findByLabelText('רשימת חומרי הגלם');
    expect(list).toHaveTextContent('200 גרם ב-');
    expect(list).toHaveTextContent('תנובה');
    expect(list).toHaveTextContent('עודכן היום');
  });

  it('shows the declared allergens', async () => {
    show({ catalog: [item({ allergens: ['חלב', 'גלוטן'] })] });
    expect(await screen.findByText(/אלרגנים: חלב · גלוטן/)).toBeInTheDocument();
  });

  it('says "no price" rather than ₪0 for an unpriced material', async () => {
    show({ catalog: [item({ purchaseTotal: null, price: null, priceUnit: null })] });
    // The distinction the whole stage turns on. ₪0 would put it into every
    // recipe's cost as free.
    expect(await screen.findByLabelText('אין מחיר לחמאה 82%')).toBeInTheDocument();
    const list = screen.getByLabelText('רשימת חומרי הגלם');
    expect(list).not.toHaveTextContent('₪0');
  });

  it('explains the empty state instead of showing a blank page', async () => {
    show();
    expect(await screen.findByText(/אין עדיין חומרי גלם/)).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 3 — it asks what was bought', () => {
  it('derives the per-kilo price live, from a sack of flour', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));

    await user.type(screen.getByLabelText('שם חומר הגלם'), 'קמח לחם');
    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'kg');
    await user.type(screen.getByLabelText('כמות באריזה'), '25');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '110');

    // Shown while typing, before anything is saved: ₪4.40 a kilo.
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('4.4');
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('לק"ג');
  });

  it('derives a per-egg price from a tray of 30', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'ביצים');
    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'unit');
    await user.type(screen.getByLabelText('כמות באריזה'), '30');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '39');

    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('1.3');
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent("ליח'");
  });

  it('relabels the quantity field for the chosen purchase unit', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));

    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'kg');
    expect(screen.getByText('ק"ג באריזה')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('יחידת רכישה'), 'unit');
    expect(screen.getByText('יחידות באריזה')).toBeInTheDocument();
  });

  it('says there is no price yet rather than showing 0', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'מלח');
    await user.type(screen.getByLabelText('כמות באריזה'), '1');
    // no package price typed
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('אין עדיין מחיר');
    expect(screen.getByLabelText('מחיר מחושב מהרכישה')).toHaveTextContent('שדה ריק אינו אפס');
  });

  it('saves the purchase, not a per-kilo price', async () => {
    const user = userEvent.setup();
    const onPurchase = vi.fn();
    show({ onPurchase });
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'קמח לחם');
    await user.type(screen.getByLabelText('כמות באריזה'), '25');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '110');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    // A new material is a PURCHASE (requirement C), not a bare row: it goes
    // through `record_purchase`, so the history has it from the first day.
    await waitFor(() => expect(onPurchase).toHaveBeenCalled());
    expect(onPurchase.mock.calls[0]![0]).toMatchObject({
      key: 'קמח לחם',
      purchaseUnit: 'kg',
      packageCount: 1,
      packageQty: 25,
      purchaseTotal: 110,
      usablePct: null,
    });
  });

  it('keeps an empty price empty and a typed 0 as zero', async () => {
    const user = userEvent.setup();
    const onPurchase = vi.fn();
    show({ onPurchase });

    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'מלח');
    await user.type(screen.getByLabelText('כמות באריזה'), '1');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));
    await waitFor(() => expect(onPurchase).toHaveBeenCalledTimes(1));
    expect(onPurchase.mock.calls[0]![0].purchaseTotal).toBeNull();

    await user.click(screen.getByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'מים');
    await user.type(screen.getByLabelText('כמות באריזה'), '1');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '0');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));
    await waitFor(() => expect(onPurchase).toHaveBeenCalledTimes(2));
    expect(onPurchase.mock.calls[1]![0].purchaseTotal).toBe(0);
  });

  it('refuses a package of nothing, which has no unit price', async () => {
    const user = userEvent.setup();
    const onPurchase = vi.fn();
    show({ onPurchase });
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.type(screen.getByLabelText('שם חומר הגלם'), 'משהו');
    await user.type(screen.getByLabelText('כמות באריזה'), '0');
    await user.type(screen.getByLabelText('סך הכול ששולם'), '10');
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('גדולה מאפס');
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it('refuses a material with no name', async () => {
    const user = userEvent.setup();
    const onPurchase = vi.fn();
    show({ onPurchase });
    await user.click(await screen.findByRole('button', { name: 'הוספת חומר גלם' }));
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('שם');
    expect(onPurchase).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('requirement 5 — a price change says what it moves', () => {
  it('names the affected recipes when editing a material', async () => {
    const user = userEvent.setup();
    show({
      catalog: [item()],
      pricingOn: [
        { id: 'r1', name: 'בריוש', rows: 1, overridden: 0 },
        { id: 'r2', name: 'קרואסון', rows: 2, overridden: 0 },
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));

    const box = await screen.findByLabelText('מתכונים שהמחיר הזה משפיע עליהם');
    expect(box).toHaveTextContent('2 מתכונים מושפעים');
    expect(within(box).getByRole('link', { name: 'בריוש' })).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'קרואסון' })).toBeInTheDocument();
  });

  it('says which lines will NOT move because they have their own price', async () => {
    const user = userEvent.setup();
    show({
      catalog: [item()],
      pricingOn: [{ id: 'r1', name: 'בריוש', rows: 1, overridden: 1 }],
    });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));
    const box = await screen.findByLabelText('מתכונים שהמחיר הזה משפיע עליהם');
    // Claiming a line is affected when it overrides the central price would be
    // wrong, and the user would go looking for a change that never happened.
    expect(box).toHaveTextContent('שורה אחת שם עם מחיר משלה, שלא תשתנה');
  });

  it('says nothing when no recipe is affected', async () => {
    const user = userEvent.setup();
    show({ catalog: [item()], pricingOn: [] });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));
    await screen.findByLabelText('טופס חומר גלם: חמאה 82%');
    expect(
      screen.queryByLabelText('מתכונים שהמחיר הזה משפיע עליהם'),
    ).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('editing and removing', () => {
  it('loads the existing package into the form', async () => {
    const user = userEvent.setup();
    show({ catalog: [item()] });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));

    expect(screen.getByLabelText('שם חומר הגלם')).toHaveValue('חמאה 82%');
    expect(screen.getByLabelText('יחידת רכישה')).toHaveValue('g');
    expect(screen.getByLabelText('כמות באריזה')).toHaveValue('200');
    expect(screen.getByLabelText('סך הכול ששולם')).toHaveValue('8.9');
    expect(screen.getByLabelText('ספק')).toHaveValue('תנובה');
  });

  it('loads an unpriced material with EMPTY fields, not zeros', async () => {
    const user = userEvent.setup();
    show({ catalog: [item({ purchaseTotal: null, packageQty: null, price: null, priceUnit: null })] });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));
    expect(screen.getByLabelText('כמות באריזה')).toHaveValue('');
    expect(screen.getByLabelText('סך הכול ששולם')).toHaveValue('');
  });

  it('asks before removing, and says what happens to the recipes', async () => {
    const user = userEvent.setup();
    show({ catalog: [item()] });
    await user.click(await screen.findByRole('button', { name: 'מחיקת חמאה 82%' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'אישור מחיקת חמאה 82%' });
    // Not "the price becomes 0" — back to having no price, which is different.
    expect(dialog).toHaveTextContent('בלי מחיר לשורה הזאת — לא למחיר אפס');
  });

  it('adds and removes an allergen', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    show({ catalog: [item({ allergens: [] })], onSave });
    await user.click(await screen.findByRole('button', { name: 'עריכת חמאה 82%' }));

    // suggested from the name by the engine's own table
    await user.click(screen.getByRole('button', { name: 'הוספת האלרגן חלב' }));
    expect(screen.getByRole('button', { name: 'הסרת האלרגן חלב' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שמירת חומר הגלם' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].allergens).toEqual(['חלב']);
  });
});

describe('with no connection', () => {
  it('disables every write rather than failing when pressed', async () => {
    show({ catalog: [item()], canWrite: false });
    expect(await screen.findByRole('status')).toHaveTextContent('אין כרגע חיבור');
    expect(screen.getByRole('button', { name: 'הוספת חומר גלם' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'עריכת חמאה 82%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'מחיקת חמאה 82%' })).toBeDisabled();
  });
});

/*
  §10 of the handoff: "מחירים: חיפוש, יצירה ועריכה, יחידת מחיר ברורה". The
  screen had creation, editing and the unit; the search is new.
*/
describe('the search over the catalogue', () => {
  it('narrows the list to what the name contains, and says so when nothing does', async () => {
    const user = userEvent.setup();
    show({
      catalog: [
        item(),
        item({ id: 'c2', key: 'סוכר', name: 'סוכר', price: 2.5, priceUnit: 'ק"ג' }),
      ],
    });
    await screen.findByText('חמאה 82%');

    await user.type(screen.getByLabelText('חיפוש חומר גלם'), 'חמאה');
    expect(screen.getByText('חמאה 82%')).toBeInTheDocument();
    expect(screen.queryByText('סוכר')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('חיפוש חומר גלם'));
    await user.type(screen.getByLabelText('חיפוש חומר גלם'), 'זעפרן');
    expect(await screen.findByText(/אין חומר גלם שהשם שלו מכיל/)).toBeInTheDocument();
    // And the catalogue is still there, one clear away.
    await user.clear(screen.getByLabelText('חיפוש חומר גלם'));
    expect(await screen.findByText('חמאה 82%')).toBeInTheDocument();
  });
});
