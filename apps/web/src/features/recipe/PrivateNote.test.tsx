// §8 — the personal note, and the three ways a debounced save can lie.
//
// The isolation of the note (nobody else can read it) is proven where it is
// enforced, against real Postgres: `supabase/tests/private-notes.sql`. What is
// tested here is the behaviour of the box itself.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { memoryIdb, resetMemoryIdb } from '../../test/memoryIdb.js';

/* The unsaved-note draft lives in device storage, and jsdom has no
   IndexedDB — so the mirror's own code stays under test and only the store
   beneath it is replaced. */
vi.mock('idb-keyval', () => memoryIdb());
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTE_DEBOUNCE_MS, PrivateNote } from './PrivateNote.js';

beforeEach(() => {
  resetMemoryIdb();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('§8 the personal note', () => {
  it('says whose it is, where the typing happens (§12)', () => {
    render(
      <PrivateNote recipeId="r1" initial="" canWrite onSave={vi.fn(async () => undefined)} userId="u1" />,
    );
    expect(screen.getByText(/שמורה לחשבון שלכם בלבד/)).toBeInTheDocument();
    expect(screen.getByText(/אינה נוסעת איתו בשיתוף/)).toBeInTheDocument();
  });

  it('shows the note the account already has', () => {
    render(
      <PrivateNote
        recipeId="r1"
        initial="החמאה של תנובה עובדת טוב יותר"
        canWrite
        userId="u1"
        onSave={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue(
      'החמאה של תנובה עובדת טוב יותר',
    );
  });

  it('waits for the pause §8 asks for, then writes ONCE', async () => {
    const u = user();
    const onSave = vi.fn(async () => undefined);
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />);

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'הערה');
    // Four keystrokes, no write yet — the whole point of the debounce.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('מקליד…');

    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith('הערה');
  });

  it('does not say "נשמר" until the write has actually returned', async () => {
    const u = user();
    let release: (() => void) | null = null;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />);

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'א');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('שומר…'));
    expect(screen.getByRole('status')).not.toHaveTextContent('נשמר');

    release!();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('נשמר'));
  });

  it('reports a failed save instead of a false confirmation, and keeps the text', async () => {
    const u = user();
    const onSave = vi.fn(async () => {
      throw new Error('שמירת ההערה האישית נכשלה: אין חיבור');
    });
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />);

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'טקסט חשוב');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/נכשלה/),
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('נשמר');
    // Nothing the user typed is thrown away by the failure.
    expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue('טקסט חשוב');
  });

  it('flushes the pending text when the screen is left mid-timer', async () => {
    const u = user();
    const onSave = vi.fn(async () => undefined);
    const view = render(
      <PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />,
    );

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'כמעט נשמר');
    expect(onSave).not.toHaveBeenCalled();
    // Type, then press back. The timer never fires; the note must survive.
    view.unmount();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('כמעט נשמר'));
  });

  it('writes an emptied note too, because clearing it is an action', async () => {
    const u = user();
    const onSave = vi.fn(async () => undefined);
    render(<PrivateNote recipeId="r1" initial="יש כאן משהו" canWrite onSave={onSave} userId="u1" />);

    await u.clear(screen.getByLabelText('ההערה האישית שלי'));
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
  });

  it('does not overwrite live typing with a note that arrives late', async () => {
    const u = user();
    const onSave = vi.fn(async () => undefined);
    const view = render(
      <PrivateNote recipeId="r1" initial={null} canWrite onSave={onSave} userId="u1" />,
    );

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'מה שהקלדתי');
    // The read resolves only now, after the user has already typed.
    view.rerender(
      <PrivateNote recipeId="r1" initial="טקסט מהשרת" canWrite onSave={onSave} userId="u1" />,
    );
    expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue('מה שהקלדתי');
  });

  it('offers no box at all when there is no account to save it to', () => {
    render(
      <PrivateNote
        recipeId="r1"
        initial=""
        canWrite={false}
        userId="u1"
        onSave={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.queryByLabelText('ההערה האישית שלי')).not.toBeInTheDocument();
    expect(screen.getByText(/אין חיבור לשרת/)).toBeInTheDocument();
  });
});

/*
  ── STAGE 3, ITEM 2: THE FOUR GUARANTEES ABOUT A NOTE THAT DID NOT SAVE ───

  The audit found the hole: typing and leaving inside the debounce attempted
  the save from a component that was already gone, and the failure was
  swallowed. These hold what Ahmed asked for — no false "נשמר", the text
  recoverable after the screen is gone, a visible error with a retry, a draft
  per account and per recipe, and no silent overwrite of a newer version.
*/
describe('a note that could not be saved', () => {
  const failing = () =>
    vi.fn(async () => {
      throw new Error('השמירה נכשלה: אין חיבור.');
    });

  it('keeps the text, says it failed, and offers a retry that works', async () => {
    const u = user();
    let fail = true;
    const onSave = vi.fn(async () => {
      if (fail) throw new Error('אין חיבור.');
    });
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />);

    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'טקסט חדש');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('אין חיבור.'));
    // The text is still there — losing it is the thing this is about.
    expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue('טקסט חדש');

    fail = false;
    await u.click(screen.getByRole('button', { name: 'ניסיון חוזר' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('נשמר'));
    expect(onSave).toHaveBeenLastCalledWith('טקסט חדש');
  });

  it('never says "נשמר" for text the server has not confirmed', async () => {
    const u = user();
    render(
      <PrivateNote recipeId="r1" initial="מה שבחשבון" canWrite onSave={failing()} userId="u1" />,
    );
    // A note read from the account IS saved, and may say so.
    expect(screen.getByRole('status')).toHaveTextContent('נשמר');

    await u.type(screen.getByLabelText('ההערה האישית שלי'), ' ועוד');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('השמירה נכשלה'),
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('נשמר');
  });

  it('recovers the text on the next visit, per account and per recipe', async () => {
    const u = user();
    const onSave = failing();
    const first = render(
      <PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />,
    );
    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'לא נשמר');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('השמירה נכשלה'));
    first.unmount();

    // Back on the recipe: the text is in the box, with the failure and a way
    // to try again.
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue('לא נשמר'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('לא נשמרה בפעם הקודמת');
    expect(screen.getByRole('button', { name: 'ניסיון חוזר' })).toBeInTheDocument();
  });

  it('does not offer one account\'s draft to another, or one recipe\'s to another', async () => {
    const u = user();
    const onSave = failing();
    const first = render(
      <PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u1" />,
    );
    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'של חשבון א');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('השמירה נכשלה'));
    first.unmount();

    // Another account, same recipe.
    const other = render(
      <PrivateNote recipeId="r1" initial="" canWrite onSave={onSave} userId="u2" />,
    );
    await waitFor(() => expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue(''));
    other.unmount();

    // Same account, another recipe.
    render(<PrivateNote recipeId="r2" initial="" canWrite onSave={onSave} userId="u1" />);
    await waitFor(() => expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue(''));
  });

  it('does not post a stale draft over a newer note — it asks', async () => {
    const u = user();
    const onSave = failing();
    const first = render(
      <PrivateNote recipeId="r1" initial="הגרסה שהייתה" canWrite onSave={onSave} userId="u1" />,
    );
    await u.type(screen.getByLabelText('ההערה האישית שלי'), ' + מה שהקלדתי');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('השמירה נכשלה'));
    first.unmount();

    // Meanwhile another device saved something else, so the account's text is
    // no longer what the draft was written against.
    const saved = vi.fn(async () => undefined);
    render(
      <PrivateNote recipeId="r1" initial="גרסה חדשה ממכשיר אחר" canWrite onSave={saved} userId="u1" />,
    );
    const both = await screen.findByRole('group', { name: 'שתי גרסאות של ההערה' });
    expect(both).toHaveTextContent('הגרסה שהייתה + מה שהקלדתי');
    expect(both).toHaveTextContent('גרסה חדשה ממכשיר אחר');
    // Nothing was written by merely arriving here.
    expect(saved).not.toHaveBeenCalled();

    await u.click(screen.getByRole('button', { name: 'לשמור את הטקסט שהוקלד' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith('הגרסה שהייתה + מה שהקלדתי'),
    );
  });

  it('reports a failed unmount flush where it can still be seen', async () => {
    const u = user();
    const onFlushError = vi.fn();
    const view = render(
      <PrivateNote
        recipeId="r1"
        initial=""
        canWrite
        onSave={failing()}
        userId="u1"
        onFlushError={onFlushError}
      />,
    );
    await u.type(screen.getByLabelText('ההערה האישית שלי'), 'נכתב ונעלמתי');
    // Leave BEFORE the debounce fires — the case that used to lose the text.
    view.unmount();
    await waitFor(() => expect(onFlushError).toHaveBeenCalled());
    expect(String(onFlushError.mock.calls[0]?.[0])).toContain('נשמר על המכשיר');

    // And the text is recoverable on the way back.
    render(<PrivateNote recipeId="r1" initial="" canWrite onSave={vi.fn(async () => undefined)} userId="u1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('ההערה האישית שלי')).toHaveValue('נכתב ונעלמתי'),
    );
  });
});
