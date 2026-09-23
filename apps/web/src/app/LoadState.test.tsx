// QA 22.09.2026 (acceptance, finding 1): the app rendered NOTHING while the
// notebook loaded and NOTHING when the load failed — no text, no tab bar, no
// way out. These tests pin the two screens that replaced the blank page, and
// that "ניסיון חוזר" actually loads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memoryIdb, resetMemoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { AppUnderTest, emptyDb, project } from '../test/appHarness.js';
import { newProfileRow, recipeRow, resetFakeIds, USER_A } from '../test/fakeSupabase.js';

beforeEach(() => {
  resetFakeIds();
  resetMemoryIdb();
});
afterEach(() => cleanup());

describe('the notebook says it is loading, and says when it could not load', () => {
  it('shows a loading message rather than a blank page before the data arrives', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    const { client } = project(db, USER_A);

    render(<AppUnderTest client={client} />);

    // Synchronously after the first render: nothing has resolved yet.
    // The auth gate resolves first ("רגע…"), then the data provider. Either
    // way the page is never empty.
    expect(document.body.textContent).not.toBe('');
    expect(await screen.findByText('המחברת ריקה.')).toBeInTheDocument();
  });

  it('shows the failure and a retry when the first load fails, and the retry loads', async () => {
    const db = emptyDb();
    db['profiles']!.push(newProfileRow(USER_A, { onboarding_done: true }));
    db['recipes']!.push(recipeRow('r1', USER_A, { name: 'חלה של אחמד' }));
    const { client, data } = project(db, USER_A);
    // Nothing in the offline mirror yet, so the network failure has nothing
    // to fall back on — the state the blank page was found in.
    data.setFailWith({ message: 'TypeError: Failed to fetch' });

    render(<AppUnderTest client={client} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('המחברת לא נטענה');
    expect(alert).toHaveTextContent('בדקו את החיבור לאינטרנט');
    // Not sent through the onboarding on a network failure.
    expect(screen.queryByText('איך נוח לכם לעבוד?')).not.toBeInTheDocument();

    data.setFailWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון חוזר' }));

    expect(await screen.findByText('חלה של אחמד')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
