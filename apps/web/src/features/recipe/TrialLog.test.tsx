// Spec 5.1 "יומן ניסויים" (stage 3ב, A-6): a bake is recorded with its date,
// saved at once, and a failed save keeps what was typed and says so.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeTrial } from '@recipe-notebook/engine';
import { TrialLog, todayIso, trialDateLabel } from './TrialLog.js';

const LOG: RecipeTrial[] = [
  { id: 't2', date: '2026-09-20', note: 'קרום כהה מדי' },
  { id: 't1', date: '2026-09-12', note: 'תפיחה חלשה, חדר קר' },
];

describe('the trial log card', () => {
  it('lists the entries, newest first as given, with Hebrew dates', () => {
    render(<TrialLog trials={LOG} canWrite onSave={async (n) => n} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('20 בספטמבר 2026');
    expect(items[0]).toHaveTextContent('קרום כהה מדי');
  });

  it('says so when the log is empty', () => {
    render(<TrialLog trials={[]} canWrite onSave={async (n) => n} />);
    expect(screen.getByText('עדיין אין רשומות ביומן.')).toBeInTheDocument();
  });

  it('adds an entry with today as the default date, and clears the box after a real save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (n: readonly RecipeTrial[]) => n.map((t, i) => ({ ...t, id: t.id ?? `new-${i}` })));
    render(<TrialLog trials={LOG} canWrite onSave={onSave} />);
    expect(screen.getByLabelText('תאריך')).toHaveValue(todayIso());
    await user.type(screen.getByLabelText('מה קרה'), 'אפייה טובה');
    await user.click(screen.getByRole('button', { name: 'הוספה ליומן' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]![0];
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual({ date: todayIso(), note: 'אפייה טובה' });
    expect(await screen.findByRole('status')).toHaveTextContent('נשמר');
    expect(screen.getByLabelText('מה קרה')).toHaveValue('');
  });

  it('refuses an empty note and saves nothing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (n: readonly RecipeTrial[]) => n);
    render(<TrialLog trials={LOG} canWrite onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'הוספה ליומן' }));
    expect(screen.getByRole('status')).toHaveTextContent('כדי לרשום ניסוי צריך לכתוב מה קרה.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the text and says so when the save fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error('שמירת יומן הניסויים נכשלה');
    });
    render(<TrialLog trials={[]} canWrite onSave={onSave} />);
    await user.type(screen.getByLabelText('מה קרה'), 'נשרף');
    await user.click(screen.getByRole('button', { name: 'הוספה ליומן' }));
    expect(await screen.findByRole('status')).toHaveTextContent('שמירת יומן הניסויים נכשלה');
    expect(screen.getByLabelText('מה קרה')).toHaveValue('נשרף');
  });

  it('removes an entry only after asking, naming its date', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (n: readonly RecipeTrial[]) => n);
    render(<TrialLog trials={LOG} canWrite onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'הסרת הרשומה מ20 בספטמבר 2026' }));
    expect(screen.getByRole('group', { name: 'אישור הסרה' })).toHaveTextContent('להסיר את הרשומה מ20 בספטמבר 2026?');
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'כן, להסיר' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].map((t) => t.id)).toEqual(['t1']);
  });

  it('is read-only offline, and says why', () => {
    render(<TrialLog trials={LOG} canWrite={false} onSave={async (n) => n} />);
    expect(screen.getByRole('button', { name: 'הוספה ליומן' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('אין כרגע חיבור');
    expect(screen.queryByRole('button', { name: /הסרת הרשומה/ })).not.toBeInTheDocument();
  });

  it('formats a missing or odd date without inventing one', () => {
    expect(trialDateLabel(undefined)).toBe('ללא תאריך');
    expect(trialDateLabel('אתמול')).toBe('אתמול');
  });
});
