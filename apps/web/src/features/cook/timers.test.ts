// §14's parallel timers.
//
// The test that matters most is the last one: a timer whose tab was asleep.
// A countdown that subtracts a second per tick loses exactly as much time as
// the browser throttled away, and the bread is out by the time it rings.

import { describe, expect, it } from 'vitest';
import {
  MINUTE_MS,
  formatClock,
  pauseTimer,
  resumeTimer,
  startTimer,
  toggleTimer,
  viewTimer,
} from './timers.js';

const T0 = 1_700_000_000_000;

describe('a running timer', () => {
  it('starts at its full length', () => {
    const t = startTimer(12, T0);
    const v = viewTimer(t, T0);
    expect(v.leftSec).toBe(720);
    expect(v.totalSec).toBe(720);
    expect(v.running).toBe(true);
    expect(v.done).toBe(false);
    expect(v.progress).toBe(0);
  });

  it('counts down against the clock', () => {
    const t = startTimer(12, T0);
    expect(viewTimer(t, T0 + 5 * MINUTE_MS).leftSec).toBe(420);
    expect(viewTimer(t, T0 + 5 * MINUTE_MS).progress).toBeCloseTo(5 / 12, 6);
  });

  it('is done at zero, and does not go negative', () => {
    const t = startTimer(1, T0);
    const v = viewTimer(t, T0 + 90_000);
    expect(v.leftSec).toBe(0);
    expect(v.done).toBe(true);
    expect(v.progress).toBe(1);
  });

  it('rounds seconds UP, so 11.4s reads 12 and not 11', () => {
    // A timer that shows 0 while a second is still left has stopped being a
    // timer. Ceiling is the only rounding that never shows zero early.
    const t = startTimer(1, T0);
    expect(viewTimer(t, T0 + 48_600).leftSec).toBe(12);
  });
});

describe('pause and resume', () => {
  it('freezes what was left', () => {
    const t = startTimer(10, T0);
    const p = pauseTimer(t, T0 + 4 * MINUTE_MS);
    expect(viewTimer(p, T0 + 4 * MINUTE_MS).leftSec).toBe(360);
    // An hour later it still says the same thing. That is the point of a pause.
    expect(viewTimer(p, T0 + 64 * MINUTE_MS).leftSec).toBe(360);
    expect(viewTimer(p, T0 + 64 * MINUTE_MS).running).toBe(false);
  });

  it('resumes from where it stopped, not from where it would have been', () => {
    const t = startTimer(10, T0);
    const p = pauseTimer(t, T0 + 4 * MINUTE_MS);
    const r = resumeTimer(p, T0 + 60 * MINUTE_MS);
    expect(viewTimer(r, T0 + 60 * MINUTE_MS).leftSec).toBe(360);
    expect(viewTimer(r, T0 + 61 * MINUTE_MS).leftSec).toBe(300);
  });

  it('toggles both ways, and pausing twice changes nothing', () => {
    const t = startTimer(5, T0);
    const p = toggleTimer(t, T0 + MINUTE_MS);
    expect(p.kind).toBe('paused');
    expect(pauseTimer(p, T0 + 99 * MINUTE_MS)).toEqual(p);
    const r = toggleTimer(p, T0 + 2 * MINUTE_MS);
    expect(r.kind).toBe('running');
    expect(resumeTimer(r, T0 + 3 * MINUTE_MS)).toEqual(r);
  });
});

describe('a timer whose tab was asleep', () => {
  it('reports the real time that passed, not the ticks it missed', () => {
    // The screen went dark for eleven minutes of a twelve-minute bake. A
    // countdown driven by setInterval would have lost most of them.
    const t = startTimer(12, T0);
    expect(viewTimer(t, T0 + 11 * MINUTE_MS).leftSec).toBe(60);
    expect(viewTimer(t, T0 + 13 * MINUTE_MS).done).toBe(true);
  });
});

describe('formatClock', () => {
  it('writes minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9)).toBe('00:09');
    expect(formatClock(90)).toBe('01:30');
    expect(formatClock(720)).toBe('12:00');
  });

  it('adds hours for a long rest, because "480:00" is not a time', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(8 * 3600 + 125)).toBe('8:02:05');
  });

  it('never shows a negative clock', () => {
    expect(formatClock(-5)).toBe('00:00');
  });
});
