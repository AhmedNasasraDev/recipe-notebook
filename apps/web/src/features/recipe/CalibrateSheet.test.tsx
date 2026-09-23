// Personal calibration, at the UI level.
//
// The engine side is covered by packages/engine/test/calibration.test.ts. What
// these tests protect is the two things a UI can get wrong about it:
//
//   • B5 — the tool volume must be the one in force AT SAVE TIME, frozen into
//     the record. A sheet that stored the tool id and looked the volume up
//     later would re-break the bug the engine was fixed for.
//   • B4 — a related calibration must never be applied on its own. It may be
//     offered, and attaching it takes a click.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  compute,
  defaultPrefs,
  type Calibration,
  type MeasurementPrefs,
  type Recipe,
} from '@recipe-notebook/engine';
import { CalibrateSheet } from './CalibrateSheet.js';
import { calcState } from './completeness.js';

const prefsAt = (cupMl: number, calib: Calibration[] = []): MeasurementPrefs => ({
  ...defaultPrefs('pro'),
  done: true,
  tools: { cup: cupMl, tbsp: 15, tsp: 5 },
  calib,
});

function renderSheet(
  prefs: MeasurementPrefs,
  name = 'קקאו',
  onSave: (next: Calibration[]) => void = () => {},
) {
  return render(
    <CalibrateSheet
      ingredientName={name}
      prefs={prefs}
      onClose={() => {}}
      onSave={onSave}
    />,
  );
}

describe('taking a measurement', () => {
  it('names the ingredient and explains what to do', async () => {
    renderSheet(prefsAt(240));
    expect(await screen.findByRole('dialog', { name: 'כיול אישי' })).toBeInTheDocument();
    expect(screen.getByText('קקאו')).toBeInTheDocument();
    expect(screen.getByText(/מלאו כוס אחת/)).toBeInTheDocument();
  });

  it('states the tool volume it is about to freeze', async () => {
    renderSheet(prefsAt(250));
    // A user has to be able to see which measurement they are recording, and
    // this is also the line that makes B5 visible rather than implicit.
    expect(screen.getByLabelText('נפח הכלי שיישמר')).toHaveTextContent('250');
    expect(screen.getByLabelText('נפח הכלי שיישמר')).toHaveTextContent(
      /שינוי עתידי בהגדרות לא ישנה/,
    );
  });

  it('saves a calibration with the current cup size frozen into it (B5)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderSheet(prefsAt(250), 'קקאו', onSave);

    await user.type(screen.getByLabelText(/משקל כוס אחת/), '105');
    await user.click(screen.getByRole('button', { name: 'שמירת הכיול' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [list] = onSave.mock.calls[0] as [Calibration[]];
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('קקאו');
    expect(list[0]!.grams).toBe(105);
    expect(list[0]!.toolMl).toBe(250);
    expect(list[0]!.tool).toBe('cup');
  });

  it('records against the tool that was chosen, not always the cup', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderSheet(prefsAt(240), 'דבש', onSave);

    await user.click(screen.getByRole('button', { name: 'כף' }));
    await user.type(screen.getByLabelText(/משקל כף אחת/), '21');
    await user.click(screen.getByRole('button', { name: 'שמירת הכיול' }));

    const [list] = onSave.mock.calls[0] as [Calibration[]];
    expect(list[0]!.tool).toBe('tbsp');
    expect(list[0]!.toolMl).toBe(15);
  });

  it('refuses an empty or non-positive weight rather than storing nonsense', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderSheet(prefsAt(240), 'קקאו', onSave);

    await user.click(screen.getByRole('button', { name: 'שמירת הכיול' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('גדול מאפס');
    expect(onSave).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/משקל כוס אחת/), '0');
    await user.click(screen.getByRole('button', { name: 'שמירת הכיול' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says when it is about to replace an existing calibration', async () => {
    const existing: Calibration = {
      id: 'c1',
      ingredientKey: 'קקאו',
      name: 'קקאו',
      tool: 'cup',
      toolMl: 240,
      grams: 100,
      at: '2026-01-01',
    };
    renderSheet(prefsAt(240, [existing]));
    expect(screen.getByRole('status')).toHaveTextContent(/כבר יש כיול/);
    expect(screen.getByRole('status')).toHaveTextContent(/שמירה תחליף אותו/);
  });

  it('replaces rather than duplicating, one record per ingredient and tool', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const existing: Calibration = {
      id: 'c1',
      ingredientKey: 'קקאו',
      name: 'קקאו',
      tool: 'cup',
      toolMl: 240,
      grams: 100,
      at: '2026-01-01',
    };
    renderSheet(prefsAt(240, [existing]), 'קקאו', onSave);

    await user.type(screen.getByLabelText(/משקל כוס אחת/), '108');
    await user.click(screen.getByRole('button', { name: 'שמירת הכיול' }));

    const [list] = onSave.mock.calls[0] as [Calibration[]];
    expect(list).toHaveLength(1);
    expect(list[0]!.grams).toBe(108);
  });
});

describe('B4 — a related calibration is offered, never applied by itself', () => {
  const flourCalib: Calibration = {
    id: 'c-flour',
    ingredientKey: 'קמח',
    name: 'קמח',
    tool: 'cup',
    toolMl: 240,
    grams: 120,
    at: '2026-01-01',
  };

  it('lists a near-miss and says why it was not applied', async () => {
    renderSheet(prefsAt(240, [flourCalib]), 'קמח שקדים');
    // This is the exact pair the old substring matcher got wrong: a
    // calibration for "קמח" applied to "קמח שקדים" and badged as exact.
    expect(screen.getByText(/כיולים קרובים/)).toBeInTheDocument();
    expect(screen.getByText(/לא הוחלו אוטומטית/)).toBeInTheDocument();
    expect(screen.getByText(/זה לא אותו חומר גלם/)).toBeInTheDocument();
  });

  it('does NOT apply it to the calculation until it is attached', () => {
    const prefs = prefsAt(240, [flourCalib]);
    const recipe: Recipe = {
      id: 'r',
      name: 'x',
      ingredients: [{ id: 'i', name: 'קמח שקדים', qty: 1, unit: 'cup' }],
      steps: [],
    };
    const c = compute(recipe, [recipe], { prefs });
    // almond flour is a known data gap, and the flour calibration must not
    // answer for it
    expect(calcState(c).level).toBe('none');
  });

  it('attaches it under THIS ingredient\'s identity when asked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderSheet(prefsAt(240, [flourCalib]), 'קמח שקדים', onSave);

    await user.click(
      screen.getByRole('button', { name: 'להחיל את הכיול של קמח על קמח שקדים' }),
    );

    const [list] = onSave.mock.calls[0] as [Calibration[]];
    // The original stays; a second record is created for the new identity,
    // rather than one record being shared by two ingredients.
    expect(list).toHaveLength(2);
    const attached = list.find((c) => c.name === 'קמח שקדים');
    expect(attached).toBeDefined();
    expect(attached!.grams).toBe(120);
    // and the source's own frozen volume travels with the measurement
    expect(attached!.toolMl).toBe(240);
    expect(list.find((c) => c.name === 'קמח')).toBeDefined();
  });

  it('shows no related section when there is nothing related', async () => {
    renderSheet(prefsAt(240, [flourCalib]), 'סוכר');
    expect(screen.queryByText(/כיולים קרובים/)).not.toBeInTheDocument();
  });
});

describe('a calibration is the documented way out of a partial calculation', () => {
  it('turns "none" into "full" once it exists', () => {
    const recipe: Recipe = {
      id: 'r',
      name: 'x',
      ingredients: [{ id: 'i', name: 'קקאו', qty: 1, unit: 'cup' }],
      steps: [],
    };
    const before = compute(recipe, [recipe], { prefs: prefsAt(240) });
    expect(calcState(before).level).toBe('none');

    const after = compute(recipe, [recipe], {
      prefs: prefsAt(240, [
        {
          id: 'c',
          ingredientKey: 'קקאו',
          name: 'קקאו',
          tool: 'cup',
          toolMl: 240,
          grams: 105,
          at: '2026-03-01',
        },
      ]),
    });
    expect(calcState(after).level).toBe('full');
    expect(after.rows[0]!.g).toBeCloseTo(105, 5);
    // and it is labelled as the user's own measurement, not as a table value
    expect(after.rows[0]!.provenance.source).toBe('personal');
  });

  it('the three tool choices are all offered', async () => {
    renderSheet(prefsAt(240));
    const group = screen.getByRole('dialog', { name: 'כיול אישי' });
    for (const tool of ['כוס', 'כף', 'כפית']) {
      expect(within(group).getByRole('button', { name: tool })).toBeInTheDocument();
    }
  });
});
