// §21 "כלי המדידה שלי".
//
// The reason this screen exists is the reason for the first test: the
// onboarding promises "אפשר לשנות בכל רגע בהגדרות", and until this screen
// there was nowhere to keep that promise. A cup size is not cosmetic — every
// volume measurement in every recipe is converted through it.

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPrefs, type Calibration, type MeasurementPrefs } from '@recipe-notebook/engine';
import { ToolsScreen } from './ToolsScreen.js';
import { fakeRepository, renderRoute } from '../test/render.js';

const prefsAt = (cup: number) => ({
  ...defaultPrefs('pro'),
  done: true,
  tools: { cup, tbsp: 15, tsp: 5 },
});

function show(opts: {
  cup?: number;
  calibrations?: readonly Calibration[];
  onSavePrefs?(p: MeasurementPrefs): void;
  onSaveCalibrations?(list: readonly Calibration[]): void;
  canWrite?: boolean;
} = {}) {
  renderRoute(<ToolsScreen />, {
    path: '/tools',
    route: '/tools',
    repository: fakeRepository({
      prefs: prefsAt(opts.cup ?? 240),
      canWrite: opts.canWrite ?? true,
      ...(opts.calibrations ? { calibrations: opts.calibrations } : {}),
      ...(opts.onSavePrefs ? { onSavePrefs: opts.onSavePrefs } : {}),
      ...(opts.onSaveCalibrations ? { onSaveCalibrations: opts.onSaveCalibrations } : {}),
    }),
  });
}

describe('§21 the measuring tools can be changed after onboarding', () => {
  it('shows the size each tool is currently set to', async () => {
    show({ cup: 250 });
    /*
      The design pass moved the volume out of the heading and into the card,
      under "נפח הכלי" — §10 asks for the tool's own volume to be the fact the
      card leads with. So the heading is the tool's NAME and the volume is
      read from the card it belongs to.
    */
    const cup = await screen.findByRole('region', { name: 'כוס' });
    expect(cup).toHaveTextContent('נפח הכלי');
    expect(cup).toHaveTextContent('250');
    expect(screen.getByRole('region', { name: 'כף' })).toHaveTextContent('15');
    expect(screen.getByRole('region', { name: 'כפית' })).toHaveTextContent('5');
  });

  it('marks the size in use, so the screen is not just a list of options', async () => {
    show({ cup: 250 });
    await screen.findByRole('heading', { name: /כוס/ });
    const chosen = screen
      .getAllByRole('button', { pressed: true })
      .map((b) => b.textContent ?? '');
    expect(chosen.some((t) => t.includes('250'))).toBe(true);
    expect(chosen.some((t) => t.includes('240'))).toBe(false);
  });

  it('writes a new cup size to the account', async () => {
    const user = userEvent.setup();
    const saved: MeasurementPrefs[] = [];
    show({ cup: 240, onSavePrefs: (p) => saved.push(p) });
    await screen.findByRole('heading', { name: /כוס/ });

    const group = screen.getByRole('group', { name: 'גודל כוס' });
    const option = [...group.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('250'),
    )!;
    await user.click(option);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.tools?.cup).toBe(250);
    // The other two are untouched: this writes one tool, not the whole set.
    expect(saved[0]!.tools?.tbsp).toBe(15);
  });

  it('states the one conversion the app refuses to make (§4, §21)', async () => {
    show();
    expect(await screen.findByText(/oz הוא משקל/)).toBeInTheDocument();
    expect(screen.getByText(/לא מומרים זה לזה/)).toBeInTheDocument();
  });
});

describe('§21 the personal calibrations live here now', () => {
  const calib: Calibration[] = [
    {
      id: 'קקאו',
      name: 'קקאו',
      tool: 'cup',
      toolMl: 240,
      grams: 105,
      at: '2026-09-01',
    } as unknown as Calibration,
  ];

  it('explains what a calibration is when there are none', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'אין כיולים אישיים' })).toBeInTheDocument();
    expect(screen.getByText(/מקבל עדיפות על כל נתון בטבלה/)).toBeInTheDocument();
  });

  it('lists a calibration with the tool volume it was measured in', async () => {
    show({ calibrations: calib });
    expect(await screen.findByText('קקאו')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'כיול אישי אחד' })).toBeInTheDocument();
    // The volume matters: 105 g per 240 ml cup is a different density from
    // 105 g per 250 ml cup, and the list has to say which was measured.
    // Scoped to the calibration row, because "240" is also one of the cup
    // options above it.
    const row = screen.getByText('קקאו').closest('li')!;
    expect(row.textContent).toContain('105');
    expect(row.textContent).toContain('240');
  });

  it('removes one, by a button that names which', async () => {
    const user = userEvent.setup();
    const saved: Array<readonly Calibration[]> = [];
    show({ calibrations: calib, onSaveCalibrations: (l) => saved.push(l) });
    await screen.findByText('קקאו');

    await user.click(screen.getByRole('button', { name: 'הסרת הכיול של קקאו בכוס' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toHaveLength(0);
  });

  it('says where preferences are stored when there is no account', async () => {
    show({ canWrite: false });
    expect(await screen.findByRole('status')).toHaveTextContent(/על המכשיר הזה בלבד/);
  });
});
