// The end-of-timer alarm (QA 22.09.2026, finding 9).
//
// A timer that reaches zero used to turn red and nothing else, which from the
// other side of a kitchen is the same as no timer. Three things happen now,
// each one only where the device allows it:
//
//   • a sound, synthesised with the Web Audio API so no file has to load.
//     Browsers refuse to start audio without a user gesture, so the context
//     is created and resumed by `unlockAlarm()` on the press that starts a
//     timer — a page that never started one never rings.
//   • a vibration pattern, on devices that have a motor.
//   • the page title, so a backgrounded tab shows it in the tab strip.
//
// Nothing here throws: a browser without AudioContext, or one that keeps
// the context suspended, degrades to the visual state the screen already had.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a user gesture (the press that starts a timer). */
export function unlockAlarm(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

/** true when a sound could actually be started; false when only the visual state applies */
export function ringAlarm(): boolean {
  let rang = false;
  const c = context();
  if (c && c.state !== 'closed') {
    try {
      // Three groups of three short beeps — a kitchen timer, not a phone.
      const t0 = c.currentTime;
      for (let group = 0; group < 3; group++) {
        for (let i = 0; i < 3; i++) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'square';
          osc.frequency.value = 1760;
          const start = t0 + group * 1.2 + i * 0.25;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.4, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
          osc.connect(gain).connect(c.destination);
          osc.start(start);
          osc.stop(start + 0.2);
        }
      }
      rang = c.state === 'running';
    } catch {
      rang = false;
    }
  }
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* no motor */
  }
  return rang;
}

/** Puts a bell in the tab title while a timer has finished; returns the undo. */
export function markTitle(): () => void {
  const before = document.title;
  if (!before.startsWith('⏰')) document.title = `⏰ ${before}`;
  return () => {
    document.title = before;
  };
}
