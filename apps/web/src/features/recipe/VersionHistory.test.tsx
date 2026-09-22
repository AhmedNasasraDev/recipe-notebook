// The version-history UI (requirements 3-7).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs, type Recipe } from '@recipe-notebook/engine';
import type { StoredVersion } from '../../data/repository.js';
import { VersionHistory } from './VersionHistory.js';

const prefs = { ...defaultPrefs('pro'), done: true, tools: { cup: 240, tbsp: 15, tsp: 5 } };

const LIVE: Recipe = {
  id: 'r1',
  name: 'לחם כוסמין',
  ingredients: [
    { id: 'i1', name: 'קמח מלא', qty: 650, unit: 'g', flour: true, price: 4, priceUnit: 'ק"ג' },
    { id: 'i2', name: 'מים', qty: 450, unit: 'g', liquid: true, price: 0, priceUnit: 'ליטר' },
  ],
  steps: [{ id: 's1', text: 'ללוש' }],
} as unknown as Recipe;

const version = (over: Partial<StoredVersion> = {}): StoredVersion => ({
  id: 'v1',
  recipeId: 'r1',
  tag: 'V1',
  what: 'שונתה כמות: מים',
  createdAt: '2026-03-12T14:20:00Z',
  snapshot: {
    id: 'r1',
    name: 'לחם כוסמין',
    ingredients: [
      { id: 'i1', name: 'קמח מלא', qty: 600, unit: 'g', flour: true, price: 4, priceUnit: 'ק"ג' },
      { id: 'i2', name: 'מים', qty: 420, unit: 'g', liquid: true, price: 0, priceUnit: 'ליטר' },
    ],
    steps: [{ id: 's1', text: 'ללוש' }],
  } as unknown as Recipe,
  ...over,
});

function renderHistory(
  opts: {
    versions?: StoredVersion[];
    canRestore?: boolean;
    lockedReason?: string | null;
    onRestore?(v: StoredVersion): void;
    error?: string | null;
    busyId?: string | null;
  } = {},
) {
  const onRestore = vi.fn(opts.onRestore);
  render(
    <VersionHistory
      versions={opts.versions ?? [version()]}
      recipe={LIVE}
      recipes={[LIVE]}
      prefs={prefs}
      canRestore={opts.canRestore ?? true}
      lockedReason={opts.lockedReason ?? null}
      busyId={opts.busyId ?? null}
      error={opts.error ?? null}
      onRestore={onRestore}
    />,
  );
  return { onRestore };
}

describe('requirements 3 and 4 — the timeline', () => {
  it('lists the versions under a "current" entry (§9)', () => {
    renderHistory();
    const section = screen.getByLabelText('היסטוריית גרסאות');
    // §9: "V1…Vn + נוכחית"
    expect(within(section).getByText('נוכחית')).toBeInTheDocument();
    expect(within(section).getByText('גרסה 2')).toBeInTheDocument(); // the live one
    expect(within(section).getByText('גרסה 1')).toBeInTheDocument();
  });

  it('shows when each version was taken', () => {
    renderHistory();
    expect(screen.getByText('12.03.2026, 14:20')).toBeInTheDocument();
  });

  it('shows what changed', () => {
    renderHistory();
    expect(screen.getByText('שונתה כמות: מים')).toBeInTheDocument();
  });

  it('shows what the recipe WAS, which is what identifies it', () => {
    renderHistory();
    // 600 + 420 = 1020 g in the snapshot, versus 1100 g live
    expect(screen.getByText(/1.02 ק"ג/)).toBeInTheDocument();
    expect(screen.getByText(/1.1 ק"ג/)).toBeInTheDocument();
  });

  it('falls back to "שינויים קלים" for a version with no description', () => {
    renderHistory({ versions: [version({ what: '' })] });
    expect(screen.getByText('שינויים קלים')).toBeInTheDocument();
  });

  it('explains an empty history rather than showing a blank panel', () => {
    renderHistory({ versions: [] });
    expect(screen.getByText(/אין עוד היסטוריה/)).toBeInTheDocument();
    expect(screen.getByText(/כל שמירה.*תשמור קודם את המצב שלפניה/s)).toBeInTheDocument();
  });
});

describe('requirement 5 — viewing a version before restoring', () => {
  it('opens a viewer with the version\'s own ingredients and quantities', async () => {
    const user = userEvent.setup();
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'צפייה בגרסה 1' }));

    const dialog = await screen.findByRole('dialog', { name: 'גרסה 1' });
    const list = within(dialog).getByLabelText('רכיבי גרסה 1');
    // the SNAPSHOT's quantities, not the live ones
    expect(within(list).getByText(/600/)).toBeInTheDocument();
    expect(within(list).getByText(/420/)).toBeInTheDocument();
    expect(within(list).queryByText(/650/)).not.toBeInTheDocument();
  });

  it('runs the real engine on the snapshot, so the figures are what it produced', async () => {
    const user = userEvent.setup();
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'צפייה בגרסה 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'גרסה 1' });

    // 600 + 420 = 1020 g, which the shared formatter presents as kilograms
    // above a kilo — the same figure the live recipe page would show.
    const totalRow = within(dialog).getByText('סך המשקל').closest('div')!;
    expect(within(totalRow).getByText('1.02 ק"ג')).toBeInTheDocument();
  });

  it('shows a partial or non-computable snapshot honestly', async () => {
    const user = userEvent.setup();
    renderHistory({
      versions: [
        version({
          snapshot: {
            id: 'r1',
            name: 'גרסה חלקית',
            ingredients: [{ id: 'x', name: 'קקאו', qty: 1, unit: 'cup' }],
            steps: [],
          } as unknown as Recipe,
        }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'צפייה בגרסה 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'גרסה 1' });

    // A version may well be the one where a density was still missing, and
    // that is worth seeing before restoring it.
    expect(within(dialog).getByLabelText('שלמות החישוב של גרסה 1')).toHaveTextContent(
      'אי אפשר לחשב',
    );
    const totalRow = within(dialog).getByText('סך המשקל').closest('div')!;
    expect(within(totalRow).getByText('—')).toBeInTheDocument();
  });

  it('closes without restoring anything', async () => {
    const user = userEvent.setup();
    const { onRestore } = renderHistory();
    await user.click(screen.getByRole('button', { name: 'צפייה בגרסה 1' }));
    await user.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe('requirements 6 and 7 — restoring', () => {
  it('asks first, and says the current state will be kept', async () => {
    const user = userEvent.setup();
    const { onRestore } = renderHistory();
    await user.click(screen.getByRole('button', { name: 'שחזור גרסה 1' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'אישור שחזור גרסה 1' });
    // The part nobody expects, and the reason the button is safe to press.
    expect(dialog).toHaveTextContent('הגרסה הנוכחית תישמר בהיסטוריה');
    expect(dialog).toHaveTextContent('שום גרסה לא נמחקת');
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('restores once confirmed', async () => {
    const user = userEvent.setup();
    const { onRestore } = renderHistory();
    await user.click(screen.getByRole('button', { name: 'שחזור גרסה 1' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'אישור שחזור גרסה 1' }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]![0].tag).toBe('V1');
  });

  it('cancels without restoring', async () => {
    const user = userEvent.setup();
    const { onRestore } = renderHistory();
    await user.click(screen.getByRole('button', { name: 'שחזור גרסה 1' }));
    await user.click(screen.getByRole('button', { name: 'ביטול השחזור' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('can be reached from the viewer too', async () => {
    const user = userEvent.setup();
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'צפייה בגרסה 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'גרסה 1' });
    await user.click(within(dialog).getByRole('button', { name: 'שחזור גרסה 1' }));
    // the viewer closes and the confirmation takes over
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('when restore is unavailable', () => {
  it('disables it and says why, for a locked recipe (§9)', () => {
    renderHistory({
      canRestore: false,
      lockedReason: 'המתכון מסומן כנוסחה מאושרת לייצור, ולכן שחזור חסום עד ביטול הנעילה (§9).',
    });
    expect(screen.getByRole('button', { name: 'שחזור גרסה 1' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('נוסחה מאושרת לייצור');
    // viewing is still allowed — seeing is not changing
    expect(screen.getByRole('button', { name: 'צפייה בגרסה 1' })).toBeEnabled();
  });

  it('surfaces a failure instead of pretending the restore worked', () => {
    renderHistory({ error: 'השחזור נכשל: תת־המתכון המקושר אינו קיים' });
    expect(screen.getByRole('alert')).toHaveTextContent('תת־המתכון המקושר אינו קיים');
  });

  it('shows progress on the version being restored', () => {
    renderHistory({ busyId: 'v1' });
    expect(screen.getByRole('button', { name: 'שחזור גרסה 1' })).toHaveTextContent('משחזר…');
  });
});

describe('a snapshot with no content', () => {
  const broken = version({
    snapshot: { id: 'r1', name: '', ingredients: [], steps: [], snapshotUnavailable: true } as unknown as Recipe,
  });

  it('is listed and labelled rather than hidden', () => {
    renderHistory({ versions: [broken] });
    expect(screen.getByText(/אין תוכן, ולכן אי אפשר לצפות בו או לשחזר אותו/)).toBeInTheDocument();
  });

  it('cannot be viewed or restored', () => {
    renderHistory({ versions: [broken] });
    expect(screen.getByRole('button', { name: 'צפייה בגרסה 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'שחזור גרסה 1' })).toBeDisabled();
  });
});

describe('accessibility', () => {
  it('names every per-version control with its version', () => {
    renderHistory({ versions: [version(), version({ id: 'v2', tag: 'V2' })] });
    // Without the tag in the name, a screen-reader user navigating by name
    // gets a list of identical "צפייה" and "שחזור" buttons.
    for (const name of [
      'צפייה בגרסה 1',
      'שחזור גרסה 1',
      'צפייה בגרסה 2',
      'שחזור גרסה 2',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
