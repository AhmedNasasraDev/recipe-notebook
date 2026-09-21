// The shell's answer to the keyboard, tested in the shell rather than in the
// hook.
//
// `useSoftKeyboard.test.tsx` proves the DECISION — given a visual viewport and
// a focused element, is the keyboard open. This file proves the CONSEQUENCE,
// which is the thing Ahmed reported: the main navigation must not be on screen
// while the keyboard is, and it must be back afterwards. One line in AppShell
// joins the two, and a line like that is exactly what gets written backwards.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb } from '../test/memoryIdb.js';

vi.mock('idb-keyval', () => memoryIdb());

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppDataProvider } from '../app/AppDataProvider.js';
import { fakeRepository } from '../test/render.js';
import { AppShell } from './AppShell.js';

/** A stand-in for `window.visualViewport`, which jsdom does not implement. */
function installViewport() {
  const target = new EventTarget();
  const vv = {
    height: window.innerHeight,
    width: window.innerWidth,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  Object.defineProperty(window, 'visualViewport', {
    value: vv,
    configurable: true,
    writable: true,
  });
  return {
    resizeTo(next: number) {
      vv.height = next;
      act(() => {
        target.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(20);
      });
    },
  };
}

function Screen() {
  return (
    <form>
      <label htmlFor="msg">הודעה</label>
      <textarea id="msg" />
      <button type="submit">שליחה</button>
    </form>
  );
}

const nav = () => screen.queryByRole('navigation', { name: 'ניווט ראשי' });

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'visualViewport');
});

describe('the shell while the software keyboard is open', () => {
  it('takes the navigation away and gives it back, and never hides the composer', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const vp = installViewport();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <AppDataProvider repository={fakeRepository()}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/home" element={<Screen />} />
            </Route>
          </Routes>
        </AppDataProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(nav()).not.toBeNull());
    /* All four destinations, before anything is typed. */
    for (const name of ['בית', 'מחברת', 'קבוצות', 'עוד']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }

    screen.getByLabelText('הודעה').focus();
    vp.resizeTo(window.innerHeight - 320);

    /* The bar is GONE, not merely covered: it is not in the tree at all, so
       the scroller above it gets its height back. */
    expect(nav()).toBeNull();
    /* And the two things that must stay reachable, stayed. */
    expect(screen.getByLabelText('הודעה')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'שליחה' })).toBeTruthy();

    (screen.getByLabelText('הודעה') as HTMLTextAreaElement).blur();
    vp.resizeTo(window.innerHeight);

    expect(nav()).not.toBeNull();
    for (const name of ['בית', 'מחברת', 'קבוצות', 'עוד']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });
});
