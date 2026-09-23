// The timers behind Cook Mode (§14: "טיימרים מקבילים").
//
// WHY THE STATE IS A DEADLINE AND NOT A COUNTDOWN
//
// The obvious implementation keeps `secondsLeft` and subtracts one every
// second. It is also wrong in the one situation a kitchen timer exists for:
// the phone screen goes dark, the tab is backgrounded, `setInterval` is
// throttled to once a minute or stopped altogether, and the timer that was
// supposed to ring after 12 minutes is still showing 9 minutes left when the
// baker comes back. The bread is out by then.
//
// So a running timer stores the WALL-CLOCK instant it ends at, and the display
// is `endsAt - now`. The interval only decides how often the screen is
// repainted; it has no part in the arithmetic. A paused timer stores the
// remaining milliseconds instead, because a pause has no deadline.
//
// Everything here is pure and takes `now` as an argument, so the tests drive
// time rather than waiting for it.

export type TimerState =
  | { kind: 'running'; endsAt: number; totalMs: number }
  | { kind: 'paused'; leftMs: number; totalMs: number };

export interface TimerView {
  /** whole seconds remaining; never negative */
  leftSec: number;
  totalSec: number;
  running: boolean;
  /** has it reached zero? §14 marks these in red */
  done: boolean;
  /** 0…1, for the ring or bar */
  progress: number;
}

export const MINUTE_MS = 60_000;

export function startTimer(minutes: number, now: number): TimerState {
  const totalMs = Math.max(0, Math.round(minutes * MINUTE_MS));
  return { kind: 'running', endsAt: now + totalMs, totalMs };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.kind === 'paused') return t;
  return { kind: 'paused', leftMs: Math.max(0, t.endsAt - now), totalMs: t.totalMs };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  if (t.kind === 'running') return t;
  return { kind: 'running', endsAt: now + t.leftMs, totalMs: t.totalMs };
}

export function toggleTimer(t: TimerState, now: number): TimerState {
  return t.kind === 'running' ? pauseTimer(t, now) : resumeTimer(t, now);
}

export function viewTimer(t: TimerState, now: number): TimerView {
  const leftMs = t.kind === 'running' ? Math.max(0, t.endsAt - now) : t.leftMs;
  const leftSec = Math.ceil(leftMs / 1000);
  const totalSec = Math.round(t.totalMs / 1000);
  return {
    leftSec,
    totalSec,
    running: t.kind === 'running',
    // Zero is done whether it is running or was paused there.
    done: leftMs <= 0,
    progress: t.totalMs === 0 ? 1 : Math.min(1, 1 - leftMs / t.totalMs),
  };
}

/**
 * `mm:ss`, and `h:mm:ss` past an hour — an overnight proof is a real step and
 * "480:00" is not a time anyone reads.
 *
 * Always LTR digits; the caller puts it in an `.ltr` span (§15).
 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}
