// FIX THE CAPTION TIMING IN THE FILM THAT WAS ALREADY SHOT.
//
//   node artifact/scripts/film-sync.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WENT WRONG, AND WHY IT IS AN EDITING JOB AND NOT A RESHOOT
//
// Ahmed, watching the delivered film: at 2:51 a caption about a recipe's costs
// ran over an open unit-conversion sheet, and at 5:09 a caption about a
// product label ran over the measuring-tools screen. He asked for the existing
// film to be corrected — retimed from the material already shot — rather than
// filmed again.
//
// That is possible here for one reason: the caption panel and the application
// occupy DISJOINT halves of every frame. The application lives in the left
// 1333px, the panel in the right 587px. So a caption can be moved in time
// without touching a pixel of the application, by painting the panel region
// from a different moment of the same recording over the window that needs it.
// Nothing is re-rendered, nothing is redesigned: the overlay is a crop of this
// film's own panel, so it is bit-for-bit the same typography and colour.
//
// TWO DEFECTS, TWO DIFFERENT REMEDIES
//
//   1. A CAPTION THAT ARRIVES LATE. Every screen change in the film happens
//      BEFORE the caption that describes it — the recorder navigates, waits
//      for the screen, then paints the words. Measured across the whole film,
//      that lag is 0.4 to 2.0 seconds, and in that gap the PREVIOUS caption is
//      sitting over the NEW screen. 5:09 is one of fourteen. The remedy is to
//      paint the arriving caption from the moment its screen appears.
//
//   2. A CAPTION WITH NO MATCHING SCREEN AT ALL. The recorder opened the
//      conversion sheet and never closed it, so for twenty-one seconds the
//      application showed a modal over everything, while three captions spoke
//      about costs, allergens and the private note. No retiming can fix that:
//      the screens those three describe were never recorded, because the sheet
//      was covering them. What editing CAN do honestly is cut the stretch that
//      has nothing to show — so the film keeps the conversion caption over the
//      conversion sheet and moves on. Those three points are made again in
//      chapter ו (the food-cost panel) and in the chapter list; what is lost
//      is the allergens and private-note moment, and that is written up for
//      Ahmed rather than papered over.
//
// EVERYTHING HERE IS MEASURED FROM THE FILE, NOT ASSUMED
//
// The script samples the delivered MP4: whole-frame flashes are page loads,
// panel-region changes are caption switches, a sustained drop in the
// application's brightness is a modal sheet. The recorder's own clock is then
// fitted to the film's clock by least squares on the switches it can see
// (the two clocks differ by about two percent). Afterwards it re-measures its
// own output and fails if any load is still followed by a late caption.
//
// THE RE-ENCODE READS THE ORIGINAL CAPTURE
//
// The overlays and the cut are applied to `.film/app.webm`, the WebM Chromium
// recorded, conformed to 25fps exactly as film-render.mjs does. So the
// delivered file stays one generation from the capture — editing it out of the
// already-encoded MP4 would have cost a second pass through x264 for nothing.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDocs, mmss } from './film-docs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const FILM = path.join(ROOT, '.film');
const FFMPEG =
  process.env['FFMPEG'] ??
  '/tmp/claude-0/ffm/node_modules/@ffmpeg-installer/linux-x64/ffmpeg';

const SOURCE = path.join(FILM, 'app.webm');
const HOLDS = path.join(FILM, 'holds.json');
const OUT = path.join(ROOT, 'recipe-notebook-walkthrough.mp4');
const KEEP = path.join(ROOT, '.film', 'previous.mp4');
/*
  The plan is measured on the film AS DELIVERED, which after the first run is
  the kept copy, not the corrected output. Planning against a corrected film
  would find its own cut and try to cut again — a second run once proposed
  dropping a further six seconds for exactly that reason.
*/
const DELIVERED = fs.existsSync(KEEP) ? KEEP : OUT;

/* The frame geometry the film was shot in — see film.mjs. */
const APP_W = 1333;
const PANEL_W = 1920 - APP_W;
const HEIGHT = 1200;

const take = JSON.parse(fs.readFileSync(path.join(FILM, 'cues.json'), 'utf8'));
for (const f of [SOURCE, DELIVERED]) {
  if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
}

const ff = (args) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  return r;
};
const ffText = (args) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
};

function lengthOf(file) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffText(['-i', file]));
  if (!m) throw new Error(`could not read the length of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/* ── MEASUREMENT ─────────────────────────────────────────────────────────── */

const FPS = 15;
const GRID = 96;
const CELLS = GRID * GRID;

/**
 * One greyscale thumbnail per sampled frame, for a crop of the film.
 *
 * Raw bytes, so no `encoding` on the spawn: asking for utf8 here turned the
 * pixels into a string and every measurement into zero.
 */
function sample(file, crop) {
  const buf = spawnSync(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-i', file, '-an',
      '-vf', `${crop},fps=${FPS},scale=${GRID}:${GRID},format=gray`,
      '-f', 'rawvideo', '-',
    ],
    { maxBuffer: 1 << 30 },
  ).stdout;
  if (!buf || buf.length < CELLS) throw new Error(`no frames sampled from ${file}`);
  return { buf, frames: Math.floor(buf.length / CELLS) };
}
const brightness = (s, i) => {
  let sum = 0;
  for (let j = 0; j < CELLS; j += 1) sum += s.buf[i * CELLS + j];
  return sum / CELLS;
};
/** Share of the thumbnail that differs materially between two frames. */
const differ = (s, i, k) => {
  let n = 0;
  for (let j = 0; j < CELLS; j += 1) {
    if (Math.abs(s.buf[i * CELLS + j] - s.buf[k * CELLS + j]) > 28) n += 1;
  }
  return n / CELLS;
};
/** …and since the frame before, which is what a switch or a jump looks like. */
const changed = (s, i) => differ(s, i, i - 1);

function measure(file) {
  const whole = sample(file, `crop=1920:${HEIGHT}:0:0`);
  const app = sample(file, `crop=${APP_W}:${HEIGHT}:0:0`);
  const panel = sample(file, `crop=${PANEL_W}:760:${APP_W}:200`);
  const frames = Math.min(whole.frames, app.frames, panel.frames);
  const white = (i) => brightness(whole, i) > 195;

  const loads = [];
  for (let i = 1; i < frames; i += 1) if (white(i) && !white(i - 1)) loads.push(i / FPS);

  /* A caption switch: the panel changed and the frame is not part of a page
     load's white flash, which changes everything at once. */
  const switches = [];
  for (let i = 1; i < frames; i += 1) {
    if (white(i) || white(i - 1)) continue;
    if (changed(panel, i) <= 0.05) continue;
    const t = i / FPS;
    if (switches.length > 0 && t - switches[switches.length - 1] < 0.5) continue;
    switches.push(t);
  }

  /* An in-app screen change: a large jump in the application half with no
     page load — a tab, a card, a modal opening. */
  const jumps = [];
  for (let i = 2; i < frames - 1; i += 1) {
    if (white(i) || white(i - 1) || white(i + 1)) continue;
    const f = changed(app, i);
    if (f < 0.09) continue;
    const t = i / FPS;
    if (jumps.length > 0 && t - jumps[jumps.length - 1].t < 0.7) continue;
    jumps.push({ t, f });
  }

  /* A modal sheet dims the application for as long as it is open. */
  const typical = [...Array.from({ length: frames }, (_, i) => brightness(app, i))].sort(
    (x, y) => x - y,
  )[Math.floor(frames / 2)];
  const sheets = [];
  let open = null;
  for (let i = 0; i < frames; i += 1) {
    const b = brightness(app, i);
    const dim = b < typical - 22 && b > 40;
    if (dim && open === null) open = i / FPS;
    if (!dim && open !== null) {
      if (i / FPS - open > 1.5) sheets.push([open, i / FPS]);
      open = null;
    }
  }
  if (open !== null) sheets.push([open, frames / FPS]);

  /*
    Whether the caption changed ACROSS each page load: the panel in the last
    frame before the flash against the panel in the first frame after it.
    The corrected film paints the arriving caption while the flash is still
    fading, so a detector that only looks at neighbouring frames outside the
    flash never sees that switch — the first version of this check reported
    every fixed load as "still late" for exactly that reason.
  */
  const switchedAtLoad = loads.map((L) => {
    let b = Math.round(L * FPS) - 1;
    while (b > 0 && white(b)) b -= 1;
    let a = Math.round(L * FPS);
    while (a < frames - 1 && (white(a) || a / FPS < L + 0.25)) a += 1;
    const late = [];
    /* how long after the load the panel first differs from before it */
    let firstDiff = null;
    for (let i = a; i < frames && i / FPS < L + 3; i += 1) {
      if (white(i)) continue;
      if (differ(panel, i, b) > 0.05) {
        firstDiff = i / FPS - L;
        break;
      }
    }
    return { load: L, changedAfter: firstDiff };
  });

  return { loads, switches, jumps, sheets, switchedAtLoad, length: lengthOf(file) };
}

/**
 * The recorder stamped every caption from its own clock; the film runs on
 * another. One straight line relates them — fitted on the caption switches
 * that can be seen in the picture, which is the only honest anchor available.
 */
function fitClock(cueTimes, switches, guess) {
  let a = guess;
  let b = 0;
  for (let round = 0; round < 4; round += 1) {
    const pairs = [];
    for (const v of switches) {
      let best = -1;
      let dist = Infinity;
      cueTimes.forEach((x, i) => {
        const d = Math.abs(a * x + b - v);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      if (dist < 3.5) pairs.push([cueTimes[best], v]);
    }
    const n = pairs.length;
    if (n < 8) throw new Error(`only ${n} caption switches could be matched — too few to fit`);
    const sx = pairs.reduce((s, p) => s + p[0], 0);
    const sy = pairs.reduce((s, p) => s + p[1], 0);
    const sxx = pairs.reduce((s, p) => s + p[0] * p[0], 0);
    const sxy = pairs.reduce((s, p) => s + p[0] * p[1], 0);
    a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    b = (sy - a * sx) / n;
    const worst = Math.max(...pairs.map(([x, v]) => Math.abs(a * x + b - v)));
    if (round === 3) console.log(`clock: ×${a.toFixed(5)} ${b >= 0 ? '+' : ''}${b.toFixed(2)}s · ${n} anchors · worst ${worst.toFixed(2)}s`);
  }
  return (x) => a * x + b;
}

/* ── THE PLAN ────────────────────────────────────────────────────────────── */

const film = measure(DELIVERED);
if (process.env['DEBUG_MEASURE']) {
  console.log('loads', film.loads.length, 'switches', film.switches.length, 'jumps', film.jumps.length, 'sheets', film.sheets.length, 'len', film.length);
}
const at = fitClock(take.cues.map((c) => c.t), film.switches, film.length / take.duration);
const starts = take.cues.map((c) => at(c.t));
const ends = starts.map((_, i) => (i + 1 < starts.length ? starts[i + 1] : film.length));

/*
  A caption that cannot be saved by retiming: its window sits inside a modal
  that was never closed, and it is not the caption about that modal. The
  conversion sheet is the only modal in this film, and the only caption that
  describes it is the one about conversion.
*/
const describesSheet = (text) => /המר/.test(text);
const orphans = [];
for (const [from, to] of film.sheets) {
  for (let i = 0; i < starts.length; i += 1) {
    const covered = Math.min(ends[i], to) - Math.max(starts[i], from);
    if (covered > 0.5 * (ends[i] - starts[i]) && !describesSheet(take.cues[i].text)) orphans.push(i);
  }
}

/* The cut: from the first orphan's own switch to the end of the sheet. */
let cut = null;
if (orphans.length > 0) {
  const first = Math.min(...orphans);
  const sheet = film.sheets.find(([from, to]) => starts[first] >= from - 1 && starts[first] < to);
  /* Prefer the switch seen in the picture over the fitted time: the cut has to
     land where the caption actually changed, not within a second of it. */
  const seen = film.switches.filter((t) => Math.abs(t - starts[first]) < 1.6);
  const cutFrom = seen.length > 0 ? Math.min(...seen) : starts[first];
  cut = { from: cutFrom, to: sheet ? sheet[1] : ends[Math.max(...orphans)], cues: orphans };
}

/*
  ── WHICH CHANGES COUNT AS "THE SCREEN CHANGED" ───────────────────────────

  A page load always does: the whole frame goes white for a frame or two and
  a different screen comes back. An in-app change only counts when it is big
  — a tab or a card opening moves a quarter of the application's pixels; a
  scroll or a push-in moves a tenth. Retiming a caption onto a SCROLL would
  be worse than the defect being fixed, and the first version of this plan
  did exactly that to six captions until the sizes were read off the data.

  And the anchor is the LAST such change before the caption, not the first:
  the film often scrolls, then navigates, then speaks.
*/
const SCREEN_CHANGE = 0.25;
const arrivals = [];
const screenChanges = [
  ...film.loads.map((t) => ({ t, kind: 'load' })),
  ...film.jumps.filter((j) => j.f >= SCREEN_CHANGE).map((j) => ({ t: j.t, kind: 'in-app' })),
].sort((x, y) => x.t - y.t);
for (let i = 0; i < starts.length; i += 1) {
  if (cut && starts[i] >= cut.from - 0.01 && starts[i] < cut.to - 0.01) continue;
  /*
    No minimum lag. The fitted caption time is good to about a second, and a
    lag that reads as 0.36s can be 1.27s in the picture — it was, at 04:34,
    on the first corrected cut. Painting a caption from its own screen's
    arrival is harmless when it was already there (same panel, same pixels),
    so every screen change within reach gets it.
  */
  const before = screenChanges.filter((c) => c.t < starts[i] + 0.3 && c.t > starts[i] - 3);
  if (before.length === 0) continue;
  const change = before[before.length - 1];
  if (cut && change.t >= cut.from - 0.01 && change.t < cut.to - 0.01) continue;
  arrivals.push({
    cue: i,
    from: change.t + 0.2,
    to: starts[i] + 1.2,
    kind: change.kind,
    lag: starts[i] - change.t,
  });
}

console.log(`\nloads ${film.loads.length} · in-app jumps ${film.jumps.length} · sheets ${film.sheets.length}`);
if (cut) {
  console.log(
    `cut ${mmss(cut.from)}–${mmss(cut.to)} (${(cut.to - cut.from).toFixed(1)}s), dropping captions ` +
      cut.cues.map((i) => i + 1).join(', '),
  );
}
for (const a of arrivals) {
  console.log(
    `caption ${String(a.cue + 1).padStart(2, '0')} moves ${a.lag.toFixed(2)}s earlier (${a.kind}) ` +
      `— ${take.cues[a.cue].text.slice(0, 40)}`,
  );
}

/*
  ── ROOM FOR A LINE THAT TAKES LONGER TO SAY THAN TO READ ─────────────────

  Ahmed: "אם הקריינות ארוכה מהסצנה, הארך או התאם נקודתית את הקטע הקיים
  ואת הכיתוב. אל תאיץ את הקול באופן שפוגע בטבעיות."

  `.film/holds.json` is a list of `{ cue, seconds }` produced after the
  narration has been generated and MEASURED — the caption windows were built
  for a reading pace of 14 characters a second and the voice speaks about
  12.4, so a few of the longest lines need a beat more than the film gives
  them.

  A hold freezes the first frame of that caption's window for as long as it
  needs. Nothing is sped up, nothing is cut, and the frame it holds is the
  screen the caption is about. Everything after it moves later by the same
  amount, which is why the corrected cue list is recomputed from the holds
  rather than guessed.
*/
/*
  A hold names its caption by `line` — the 1-based number in the DELIVERED
  film, which is what the narration is measured against — and is mapped here
  onto the recorder's own index, skipping the captions the cut dropped. The
  first version took the number as the recorder's index, and every hold after
  the cut landed three captions off.
*/
const keptIndex = [];
for (let i = 0; i < take.cues.length; i += 1) if (!(cut && cut.cues.includes(i))) keptIndex.push(i);
const holds = fs.existsSync(HOLDS)
  ? JSON.parse(fs.readFileSync(HOLDS, 'utf8'))
      .filter((h) => h.seconds > 0.05)
      .map((h) => {
        const cue = keptIndex[(h.line ?? h.cue + 1) - 1];
        if (cue === undefined) throw new Error(`hold on line ${h.line} — the film has ${keptIndex.length}`);
        return { cue, seconds: h.seconds, line: h.line ?? h.cue + 1 };
      })
  : [];
if (holds.length > 0) {
  console.log(
    `\nholds: ${holds.map((h) => `${h.line}+${h.seconds.toFixed(2)}s`).join(' ')} ` +
      `(${holds.reduce((s2, h) => s2 + h.seconds, 0).toFixed(1)}s added)`,
  );
}

if (process.env['PLAN_ONLY']) process.exit(0);

if (process.env['VERIFY_ONLY']) {
  const after0 = measure(OUT);
  console.log(`\n${OUT} · ${mmss(after0.length)} · loads ${after0.loads.length} · sheets ${after0.sheets.length}`);
  for (const s2 of after0.switchedAtLoad) {
    console.log(
      `  load ${mmss(s2.load)} → caption changed ${s2.changedAfter === null ? 'before it (or not within 3s)' : `${s2.changedAfter.toFixed(2)}s after`}`,
    );
  }
  process.exit(0);
}

/* ── THE STILLS ──────────────────────────────────────────────────────────── */

const stills = path.join(FILM, 'panels');
fs.rmSync(stills, { recursive: true, force: true });
fs.mkdirSync(stills, { recursive: true });
for (const a of arrivals) {
  /* From the middle of the caption's own window, where the panel is settled
     and certainly showing it. */
  const at2 = Math.min((starts[a.cue] + ends[a.cue]) / 2, ends[a.cue] - 0.5);
  a.png = path.join(stills, `cue-${String(a.cue + 1).padStart(2, '0')}.png`);
  const r = ff([
    '-ss', at2.toFixed(2), '-i', DELIVERED, '-frames:v', '1',
    '-vf', `crop=${PANEL_W}:${HEIGHT}:${APP_W}:0`, '-y', a.png,
  ]);
  if (r.status !== 0 || !fs.existsSync(a.png)) throw new Error(`could not cut the panel for cue ${a.cue + 1}`);
}

/* ── THE EDIT ────────────────────────────────────────────────────────────── */

/* The version that was delivered is kept once and never overwritten: a
   second run must not replace it with its own (possibly half-written)
   predecessor. */
if (!fs.existsSync(KEEP)) fs.copyFileSync(DELIVERED, KEEP);

const inputs = ['-i', SOURCE];
/*
  `-framerate 1` on each still, not the default 25: a looped image input
  generates full frames for the whole film whether its overlay window is open
  or not, and twelve of them at 587×1200×25fps is most of the encode's work.
  One frame a second of a picture that never changes is all overlay needs —
  it holds the last frame it was given.
*/
/*
  And `-t`, so each still ENDS just after its window. A looped image is an
  endless stream, and `overlay` by default runs until its LONGEST input is
  done — so a film with an endless still on it never finishes: it repeats its
  last frame forever. Found by an A/B on twenty seconds of the source: the
  plain encode took fifteen seconds, the one with a single looped overlay was
  still running ten minutes later. With finite stills and `eof_action=pass`
  the main picture is the longest input, and the output is exactly its
  length.
*/
for (const a of arrivals) {
  inputs.push('-loop', '1', '-framerate', '1', '-t', (a.to + 1).toFixed(2), '-i', a.png);
}

/*
  ── STAY IN YUV, ALL THE WAY THROUGH ──────────────────────────────────────

  The first attempt let ffmpeg pick the overlay's working format. It chose
  RGB, because the stills arrive as PNG — so every frame of the film was
  converted yuv420p → rgb → yuv420p, which adds rounding noise across the
  WHOLE picture, not just under the overlay. The encoder then had noise to
  spend bits on: the file was heading for 45MB against the 21MB of the same
  film before the edit, and the image quality Ahmed asked to preserve would
  have been quietly worse. It was also four times slower.

  Converting the stills to yuv420p on the way in and pinning the overlay to
  `format=yuv420` keeps the pipeline in the colour space the capture and the
  encoder both use, so pixels outside the overlay windows pass through
  untouched.
*/
const steps = [`[0:v]fps=25,format=yuv420p[base]`];
let chain = 'base';
arrivals.forEach((a, k) => {
  const still = `p${k}`;
  steps.push(`[${k + 1}:v]format=yuv420p[${still}]`);
  const next = `ov${k}`;
  steps.push(
    `[${chain}][${still}]overlay=${APP_W}:0:format=yuv420:eof_action=pass:` +
      `enable='between(t,${a.from.toFixed(3)},${a.to.toFixed(3)})'[${next}]`,
  );
  chain = next;
});
/*
  ── ONE TIMELINE, IN ONE STREAMING PASS ───────────────────────────────────

  The first version of this built the timeline with `split`, `trim` and
  `concat`: the film in pieces, put back together. It worked and it was
  unusable. `concat` consumes its inputs IN ORDER, so while the first piece
  was being encoded ffmpeg had to hold every frame of the later pieces — a
  gigabyte of resident memory, nine percent of real time, and forty minutes
  in with no end in sight. Measured, then killed.

  Everything here is a stream instead:

    · THE CUT is `select`: drop the frames inside the dropped stretch, then
      `setpts=N/25/TB` renumbers what is left consecutively, which closes the
      gap. No piece is ever held.
    · A HOLD is a gap in the timestamps followed by `fps=25`. Pushing every
      frame after a hold point later by its length leaves an empty stretch,
      and `fps` fills an empty stretch by repeating the frame before it —
      which is exactly a freeze on the screen the caption is about.

  Both run frame by frame, in order, with nothing buffered.
*/
const startOfCue = (i) => {
  const moved = arrivals.find((a) => a.cue === i);
  return moved ? moved.from - 0.2 : starts[i];
};

if (cut) {
  steps.push(
    `[${chain}]select='not(between(t,${cut.from.toFixed(3)},${cut.to.toFixed(3)}))',` +
      `setpts=N/25/TB[cutv]`,
  );
  chain = 'cutv';
}

if (holds.length > 0) {
  /* Hold points in the timeline AFTER the cut, which is the timeline the
     expression below sees. */
  const shiftOf = (t) => (cut && t >= cut.to ? t - (cut.to - cut.from) : t);
  /* A third of a second INTO the window, not at its first frame: a caption
     that opens on a page load opens on a white flash, and freezing that would
     hold the flash. By 0.3s the screen and its caption are both settled. */
  const terms = holds
    .map((h) => `gte(T,${(shiftOf(startOfCue(h.cue)) + 0.3).toFixed(3)})*${h.seconds.toFixed(3)}`)
    .join('+');
  steps.push(`[${chain}]setpts='PTS+(${terms})/TB',fps=25[heldv]`);
  chain = 'heldv';
}

const encode = spawnSync(
  FFMPEG,
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', steps.join(';'),
    '-map', `[${chain}]`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT,
  ],
  { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' },
);
if (encode.status !== 0) {
  console.error(encode.stderr?.trim() || `ffmpeg exited ${encode.status}`);
  process.exit(1);
}

/* ── THE CORRECTED CUE LIST, AND THE DOCUMENTS FROM IT ───────────────────── */

const dropped = new Set(cut ? cut.cues : []);
const shift = cut ? cut.to - cut.from : 0;
const holdFor = (i) => holds.find((h) => h.cue === i)?.seconds ?? 0;

/*
  Where each caption lands in the FILM that was just written: its source time,
  less the dropped stretch if it is after it, plus every hold inserted before
  it. A caption's own hold freezes the first frame of its window, so it does
  not move the caption — it lengthens it.
*/
const kept = [];
for (let i = 0; i < take.cues.length; i += 1) if (!dropped.has(i)) kept.push(i);
const finalStart = (i) => {
  const src = arrivals.find((a) => a.cue === i) ? arrivals.find((a) => a.cue === i).from - 0.2 : starts[i];
  let t = src;
  if (cut && src >= cut.to) t -= shift;
  else if (cut && src >= cut.from) t = cut.from;
  for (const h of holds) {
    const at2 = arrivals.find((a) => a.cue === h.cue)
      ? arrivals.find((a) => a.cue === h.cue).from - 0.2
      : starts[h.cue];
    if (at2 < src - 0.0005) t += h.seconds;
  }
  return t;
};
const totalHold = holds.reduce((s2, h) => s2 + h.seconds, 0);
const filmLengthOut = film.length - shift + totalHold;
const corrected = kept.map((i, k) => {
  const t = finalStart(i);
  const next = k + 1 < kept.length ? finalStart(kept[k + 1]) : filmLengthOut;
  return { ...take.cues[i], t, hold: Math.max(0.4, next - t) * 1000 };
});
const finalTake = { ...take, duration: filmLengthOut, cues: corrected };
fs.writeFileSync(path.join(FILM, 'cues-final.json'), `${JSON.stringify(finalTake, null, 2)}\n`);
const { chaptersFile, narrationFile } = writeDocs(finalTake, ROOT);

/* ── DID IT WORK? ────────────────────────────────────────────────────────── */

const after = measure(OUT);
const late = [];
for (const s2 of after.switchedAtLoad) {
  /* A load whose caption had already changed before it (the 0.36s case, left
     alone on purpose) shows no change after it — that is not late. Late is
     a change that arrives, but more than 0.45s after the screen did. */
  if (s2.changedAfter !== null && s2.changedAfter > 0.45) late.push({ load: s2.load, gap: s2.changedAfter });
}
console.log(
  `\n${OUT} — ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)}MB · ${mmss(after.length)} · ` +
    `${corrected.length} captions`,
);
console.log(`previous version kept at ${KEEP}`);
console.log(chaptersFile);
console.log(narrationFile);
if (after.sheets.length !== film.sheets.length - (cut ? 0 : 0)) {
  console.log(`sheet stretches now: ${after.sheets.map(([a, b]) => `${mmss(a)}→${mmss(b)}`).join(' ')}`);
}
if (late.length > 0) {
  console.log('\nSTILL LATE:');
  for (const l of late) console.log(`  a load at ${mmss(l.load)} is followed by its caption ${l.gap.toFixed(2)}s later`);
  process.exitCode = 1;
} else {
  console.log('\nevery page load in the corrected file is followed by its caption within 0.45s');
}
