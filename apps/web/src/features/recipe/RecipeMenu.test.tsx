// Spec §8.2 (stage 5): the ⋮ menu's behaviour, rule by rule.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RecipeMenu, type MenuAction } from './RecipeMenu.js';

function show(overrides: Partial<Record<string, () => void>> = {}, status: string | null = null) {
  const picked: string[] = [];
  const actions: MenuAction[] = [
    { id: 'edit', label: 'עריכה', to: '/recipe/r1/edit' },
    { id: 'copy', label: 'שכפול', onSelect: () => picked.push('copy') },
    { id: 'share', label: 'שיתוף', onSelect: overrides['share'] ?? (() => picked.push('share')) },
    { id: 'off', label: 'לא זמין', onSelect: () => picked.push('off'), disabled: true },
    { id: 'delete', label: 'מחיקה', onSelect: () => picked.push('delete'), danger: true },
  ];
  render(
    <MemoryRouter>
      <p>
        <button type="button">מחוץ לתפריט</button>
      </p>
      <RecipeMenu actions={actions} status={status} />
    </MemoryRouter>,
  );
  return { picked, button: screen.getByRole('button', { name: 'פעולות למתכון' }) };
}

describe('the ⋮ menu', () => {
  it('is one labelled button that announces a menu, closed until pressed', () => {
    const { button } = show();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on click with every action, delete last behind a separator, and focus on the first item', async () => {
    const user = userEvent.setup();
    const { button } = show();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['עריכה', 'שכפול', 'שיתוף', 'לא זמין', 'מחיקה']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(items[0]).toHaveFocus();
    // The one red item is the last one.
    expect(items[4]!.className).toMatch(/Danger/);
  });

  it('closes on a second click, and on a click outside', async () => {
    const user = userEvent.setup();
    const { button } = show();
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'מחוץ לתפריט' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes it and returns focus to the button', async () => {
    const user = userEvent.setup();
    const { button } = show();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('arrows move between the enabled items and wrap; Home and End jump', async () => {
    const user = userEvent.setup();
    const { button } = show();
    await user.click(button);
    const item = (name: string) => screen.getByRole('menuitem', { name });
    expect(item('עריכה')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('שכפול')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // "לא זמין" is skipped: a disabled item is not a stop.
    expect(item('מחיקה')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('עריכה')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('מחיקה')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('עריכה')).toHaveFocus();
  });

  it('Enter and Space activate the focused item and close the menu', async () => {
    const user = userEvent.setup();
    const { button, picked } = show();
    await user.click(button);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(picked).toEqual(['copy']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(button);
    await user.keyboard('{ArrowDown}{ArrowDown} ');
    expect(picked).toEqual(['copy', 'share']);
  });

  it('opens from the keyboard with ArrowDown on the button', async () => {
    const user = userEvent.setup();
    const { button } = show();
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('a disabled item cannot be activated', async () => {
    const user = userEvent.setup();
    const { button, picked } = show();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'לא זמין' }));
    expect(picked).toEqual([]);
  });

  it('a link item is a real link', async () => {
    const user = userEvent.setup();
    const { button } = show();
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'עריכה' })).toHaveAttribute('href', '/recipe/r1/edit');
  });

  it('says what a share did, under the button', () => {
    show({}, 'המתכון הועתק כטקסט');
    expect(screen.getByRole('status')).toHaveTextContent('המתכון הועתק כטקסט');
  });
});
