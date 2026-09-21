import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useSoftKeyboard } from './useSoftKeyboard.js';

/*
  ── THE BOTTOM BAR MUST NOT RIDE UP ON THE KEYBOARD ─────────────────────────

  Ahmed: "כשאני נכנס לשדה כתיבה והמקלדת נפתחת, הוא עולה למעלה… הסתר אותו בזמן
  שהמקלדת פתוחה והחזר אותו למקומו לאחר סגירתה."

  WHAT THIS FILE CAN AND CANNOT PROVE

  It can prove the DECISION: given a visual viewport of a certain height and a
  certain focused element, is the keyboard considered open? That is the whole
  of the logic, and it is where the two false positives live — a collapsing
  browser toolbar and a pinch-zoom both shrink the visual viewport without any
  keyboard. Both are asserted below.

  It cannot prove that a real iPhone reports the numbers this test feeds in.
  jsdom has no `visualViewport` at all, so one is installed here. What a real
  device does is in the report, under what is left for Ahmed to check on his
  own phone.
*/

/** A stand-in for `window.visualViewport`, which jsdom does not implement. */
function installViewport(height: number) {
  const target = new EventTarget();
  const vv = {
    height,
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
    /** Move the visual viewport, the way a keyboard or a toolbar does. */
    resizeTo(next: number) {
      vv.height = next;
      act(() => {
        target.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(20);
      });
    },
  };
}

function Probe() {
  const open = useSoftKeyboard();
  return <p>{open ? 'keyboard-open' : 'keyboard-closed'}</p>;
}

const state = () => screen.getByText(/keyboard-(open|closed)/).textContent;

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'visualViewport');
  document.body.innerHTML = '';
});

/** jsdom runs no animation frames on its own; one tick is enough. */
function useFrames() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
}

describe('useSoftKeyboard', () => {
  it('is closed while the visual viewport is the whole window', () => {
    useFrames();
    installViewport(window.innerHeight);
    render(<Probe />);
    act(() => void vi.advanceTimersByTime(20));
    expect(state()).toBe('keyboard-closed');
  });

  it('opens when the viewport shrinks under a focused text field', () => {
    useFrames();
    const vp = installViewport(window.innerHeight);
    const box = document.createElement('textarea');
    document.body.append(box);
    render(<Probe />);
    box.focus();
    vp.resizeTo(window.innerHeight - 320);
    expect(state()).toBe('keyboard-open');
  });

  it('closes again when the keyboard goes away', () => {
    useFrames();
    const vp = installViewport(window.innerHeight);
    const box = document.createElement('textarea');
    document.body.append(box);
    render(<Probe />);
    box.focus();
    vp.resizeTo(window.innerHeight - 320);
    expect(state()).toBe('keyboard-open');
    box.blur();
    vp.resizeTo(window.innerHeight);
    expect(state()).toBe('keyboard-closed');
  });

  it('is not fooled by a collapsing browser toolbar', () => {
    /* A toolbar takes a few dozen pixels. The threshold is 140, which is well
       under the smallest phone keyboard and well over any toolbar. */
    useFrames();
    const vp = installViewport(window.innerHeight);
    const box = document.createElement('input');
    document.body.append(box);
    render(<Probe />);
    box.focus();
    vp.resizeTo(window.innerHeight - 60);
    expect(state()).toBe('keyboard-closed');
  });

  it('is not fooled by a pinch-zoom with nothing focused', () => {
    /* A zoom shrinks the visual viewport too — hence the second condition. */
    useFrames();
    const vp = installViewport(window.innerHeight);
    render(<Probe />);
    vp.resizeTo(window.innerHeight - 400);
    expect(state()).toBe('keyboard-closed');
  });

  it('ignores a focused control that opens no keyboard', () => {
    useFrames();
    const vp = installViewport(window.innerHeight);
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    document.body.append(tick);
    render(<Probe />);
    tick.focus();
    vp.resizeTo(window.innerHeight - 320);
    expect(state()).toBe('keyboard-closed');
  });

  it('reports closed, without throwing, where the API does not exist', () => {
    /* Safari before 13, and jsdom. The bar renders, which is the behaviour
       the application had before this hook existed. */
    expect(window.visualViewport).toBeUndefined();
    render(<Probe />);
    expect(state()).toBe('keyboard-closed');
  });
});
