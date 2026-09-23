// §7 — the pan card, on the screen.
//
// The arithmetic is tested in the engine (`pan.test.ts`). What is tested here
// is the part that can lie: what the card says when it does not know, and that
// "התאמה" scales by calculation rather than by editing.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Pan } from '@recipe-notebook/engine';
import { PanCard } from './PanCard.js';

const round20: Pan = { kind: 'round', diameter: 20 };

function show(pan: Pan | null, onAdapt = vi.fn(), yieldG = 1000) {
  render(<PanCard recipePan={pan} baselineYield={yieldG} onAdapt={onAdapt} />);
  return onAdapt;
}

describe('a recipe with no pan on record', () => {
  it('says so, and offers no picker — a control that cannot act is not rendered', () => {
    show(null);
    expect(screen.getByText(/לא נרשמה תבנית למתכון הזה/)).toBeInTheDocument();
    expect(screen.queryByLabelText('התבנית שלי')).not.toBeInTheDocument();
  });

  it('distinguishes "no pan recorded" from "this recipe uses no pan"', () => {
    show({ kind: 'none' });
    expect(screen.getByText(/מסומן כמתכון בלי תבנית/)).toBeInTheDocument();
  });
});

describe('a recipe whose pan is known', () => {
  it('states the recipe pan, and asks for the user\'s before saying anything', () => {
    show(round20);
    expect(screen.getByText('Ø20 ס"מ')).toBeInTheDocument();
    expect(screen.getByText(/אחרי בחירת התבנית שלכם/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'התאמה' })).not.toBeInTheDocument();
  });

  it('holds its tongue while the user\'s pan has no dimensions yet', async () => {
    const user = userEvent.setup();
    show(round20);
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    expect(screen.getByText(/חסרות מידות לתבנית שלכם/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'התאמה' })).not.toBeInTheDocument();
  });

  it('gives §7\'s sentence, with the factor, once both pans are known', async () => {
    const user = userEvent.setup();
    show(round20);
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '26');

    // Ø20 → Ø26 is 1.69 by area, the worked example in §7.
    const suggest = screen.getByText(/מומלץ/);
    expect(suggest).toHaveTextContent('1.69');
    expect(suggest).toHaveTextContent('בשטח');
    expect(suggest).toHaveTextContent('גדולה');
  });

  it('says "בנפח" only when both heights are known', async () => {
    const user = userEvent.setup();
    show({ kind: 'rect', width: 20, length: 20, height: 4 });
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'rect');
    await user.type(screen.getByLabelText('רוחב, ס"מ'), '20');
    await user.type(screen.getByLabelText('אורך, ס"מ'), '20');
    await user.type(screen.getByLabelText('גובה, ס"מ'), '8');
    expect(screen.getByText(/מומלץ/)).toHaveTextContent('בנפח');
    expect(screen.getByText(/מומלץ/)).toHaveTextContent('2.00');
  });

  it('reports a SMALLER pan as smaller, and not as a factor below one', async () => {
    const user = userEvent.setup();
    show({ kind: 'round', diameter: 26 });
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '20');
    const suggest = screen.getByText(/מומלץ/);
    expect(suggest).toHaveTextContent('קטנה');
    expect(suggest).toHaveTextContent('1.69');
    expect(suggest).toHaveTextContent('להקטין');
  });

  it('stays quiet when the two pans match within 2% (§7 threshold)', async () => {
    const user = userEvent.setup();
    show(round20);
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '20');
    expect(screen.getByText(/התבניות זהות בפועל/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'התאמה' })).not.toBeInTheDocument();
  });
});

describe('"התאמה" is a calculation, not an edit (§6, §7)', () => {
  it('asks for weight scaling at the adapted yield, and says so in words', async () => {
    const user = userEvent.setup();
    const onAdapt = show(round20, vi.fn(), 1000);
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '26');
    await user.click(screen.getByRole('button', { name: 'התאמה' }));

    expect(onAdapt).toHaveBeenCalledTimes(1);
    // 1000 g × 1.69 = 1690 g.
    expect(Math.round(onAdapt.mock.calls[0]![0] as number)).toBe(1690);
    expect(screen.getByText(/המתכון השמור אינו משתנה/)).toBeInTheDocument();
  });

  it('warns that an area-only comparison ignores the height', async () => {
    const user = userEvent.setup();
    show(round20);
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'round');
    await user.type(screen.getByLabelText('קוטר, ס"מ'), '26');
    expect(screen.getByText(/לפי שטח בלבד/)).toBeInTheDocument();
  });
});

describe('the picker asks only for what the chosen kind needs', () => {
  it('a GN pan is chosen from the table, not measured', async () => {
    const user = userEvent.setup();
    show({ kind: 'gn', gn: '1/2' });
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'gn');
    expect(screen.getByLabelText('מידת GN')).toBeInTheDocument();
    expect(screen.queryByLabelText('קוטר, ס"מ')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('מידת GN'), '1/1');
    expect(screen.getByText(/מומלץ/)).toHaveTextContent('גדולה');
  });

  it('a muffin tin is counted in cavities', async () => {
    const user = userEvent.setup();
    show({ kind: 'muffin', cavities: 12 });
    await user.selectOptions(screen.getByLabelText('התבנית שלי'), 'muffin');
    await user.type(screen.getByLabelText('מספר שקעים'), '24');
    expect(screen.getByText(/מומלץ/)).toHaveTextContent('2.00');
  });

  it('does not offer "בלי תבנית" as the user\'s own pan — it describes a recipe', async () => {
    show(round20);
    const select = screen.getByLabelText('התבנית שלי') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain('none');
  });
});
