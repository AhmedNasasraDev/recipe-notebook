// PUT A RECORDED NARRATION ONTO THE FILM.
//
//   node artifact/scripts/film-voice.mjs <folder-with-cue-01.wav …>
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS AND WHY IT IS NOT ALREADY RUN
//
// Ahmed asked for the walkthrough to be narrated in Hebrew, with the voice
// embedded in the video. The narration could not be produced in this
// environment, and the measurements behind that sentence are in NARRATION.md:
// outbound network reaches package registries and nothing else, so no neural
// voice can be fetched, and the one offline synthesiser available (espeak-ng)
// reads unvocalised Hebrew letter by letter.
//
// So the last step is written, tested as far as it can be without audio, and
// left ready: drop one file per caption into a folder and run this. It is one
// command, and it does the part that is actually easy to get wrong — putting
// each sentence where its caption really is.
//
// HOW EACH SENTENCE FINDS ITS PLACE
//
// `cues.json` stamps every line from the harness's clock, and the film's own
// clock runs about one and a half percent slower: 386.0 seconds of recording
// became a 391.8 second file. That is not drift in the damaging sense — it is
// a constant rate difference, and the proof is in this script. It finds the
// white flash that every full page load paints, and checks that each one
// lands in the fraction of a second before the caption that follows it. On
// the take this was written against, twelve flashes landed between 0.05 and
// 0.9 seconds before their caption, which is exactly the gap the recorder
// waits. One multiplication is therefore enough, and if a future take ever
// stops behaving that way this script says so and writes nothing.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const FILM = path.join(ROOT, '.film');
const FFMPEG =
  process.env['FFMPEG'] ??
  '/tmp/claude-0/ffm/node_modules/@ffmpeg-installer/linux-x64/ffmpeg';

const voiceDir = process.argv[2];
if (!voiceDir) {
  console.error('usage: node artifact/scripts/film-voice.mjs <folder-with-cue-01.wav …>');
  process.exit(2);
}

const video = path.join(ROOT, 'recipe-notebook-walkthrough.mp4');
const take = JSON.parse(fs.readFileSync(path.join(FILM, 'cues.json'), 'utf8'));
if (!fs.existsSync(video)) throw new Error(`no film at ${video}`);

/* Where the caption panel starts, in the recorded geometry: the flash check
   looks inside it, because the application to its left is busy all the time
   and the panel is a flat colour except when the page reloads. */
const PANEL = { x: 1333 };

/* Both streams, always: ffmpeg reports a file's length and the frame metadata
   this script reads on STDERR, and an exit code of zero would otherwise throw
   all of it away. */
const ff = (args) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'info', ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
};

/** The video's own length, which is what the harness clock is scaled to. */
function duration(file) {
  const text = ff(['-i', file, '-f', 'null', '-']);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error(`could not read the length of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Every moment the frame went white — one per full page load.
 *
 * Sampled small and grey on purpose: a whole-frame flash survives being
 * reduced to sixteen pixels a side, and nothing else in the panel's corner
 * comes near white, so there is no threshold to tune.
 */
function navigationFlashes() {
  const raw = spawnSync(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-i', video, '-an',
      '-vf', `crop=400:400:${PANEL.x + 67}:400,fps=12,scale=16:16,format=gray`,
      '-f', 'rawvideo', '-',
    ],
    { maxBuffer: 1 << 28 },
  ).stdout;
  const N = 16 * 16;
  const mean = (i) => {
    let sum = 0;
    for (let j = 0; j < N; j += 1) sum += raw[i * N + j];
    return sum / N;
  };
  const at = [];
  let prev = mean(0);
  for (let i = 1; i < Math.floor(raw.length / N); i += 1) {
    const now = mean(i);
    if (now > 180 && prev <= 180) at.push(i / 12);
    prev = now;
  }
  return at;
}

const filmLength = duration(video);
const rate = filmLength / take.duration;
const startOf = (i) => take.cues[i].t * rate;

/*
  ── THE CHECK THAT MAKES THE MULTIPLICATION TRUSTWORTHY ────────────────────

  Every flash is a page load, every page load is followed by a caption about
  the screen it loaded, and the recorder waits a beat in between. So each
  flash must sit just BEFORE its next caption — never after it, and never
  long before. If that holds for all of them, the mapping is right everywhere
  in the film, not only on average.
*/
const flashes = navigationFlashes();
const offsets = [];
for (const flash of flashes) {
  const i = take.cues.findIndex((_, n) => startOf(n) >= flash - 0.25);
  if (i < 0) continue;
  offsets.push({ flash, gap: startOf(i) - flash, text: take.cues[i].text });
}
const wrong = offsets.filter((o) => o.gap < -0.25 || o.gap > 2.5);
console.log(
  `film ${filmLength.toFixed(1)}s · recording ${take.duration.toFixed(1)}s · ` +
    `rate ${rate.toFixed(4)} · ${flashes.length} navigations checked`,
);
if (wrong.length > 0) {
  for (const o of wrong) {
    console.error(`· a page load at ${o.flash.toFixed(2)}s sits ${o.gap.toFixed(2)}s from «${o.text.slice(0, 32)}…»`);
  }
  console.error(
    'The film and the cue list no longer line up, so no narration was placed. Re-encode the\n' +
      'take (film-render.mjs) from the same recording that produced .film/cues.json.',
  );
  process.exit(1);
}

/* One file per caption, named for its number. A missing file is a silence,
   not a failure: a half-recorded narration should still produce something to
   listen to. */
const clips = [];
const tooLong = [];
for (const [i] of take.cues.entries()) {
  const nth = String(i + 1).padStart(2, '0');
  const found = ['wav', 'mp3', 'm4a', 'aac', 'opus', 'ogg']
    .map((ext) => path.join(voiceDir, `cue-${nth}.${ext}`))
    .find((f) => fs.existsSync(f));
  if (!found) continue;
  const start = startOf(i);
  const len = duration(found);
  const window = (i + 1 < take.cues.length ? startOf(i + 1) : filmLength) - start;
  if (len > window) tooLong.push({ nth, len, window, text: take.cues[i].text });
  clips.push({ file: found, start, len });
}

if (clips.length === 0) {
  console.error(`no cue-NN.wav files in ${voiceDir} — nothing to mux.`);
  process.exit(1);
}

for (const t of tooLong) {
  console.warn(
    `· ${t.nth} is ${t.len.toFixed(1)}s in a ${t.window.toFixed(1)}s window — it will run over ` +
      `the next caption: «${t.text.slice(0, 40)}…»`,
  );
}
if (tooLong.length > 0) {
  console.warn(
    'Re-record those lines rather than speeding them up: "אל תאיץ את הקול כדי להתאים אותו\n' +
      'לסצנה קצרה". Lengthening the caption is the other option — see holdFor in film.mjs.',
  );
}

/*
  ── WHY EVERY CLIP IS PADDED AND THE MIX IS TURNED BACK UP ─────────────────

  `amix` divides by the number of inputs, and it re-divides every time an
  input ends — so a narration mixed naively would be inaudible at the start
  and grow louder through the film. The `normalize=0` option that would say
  "don't" does not exist in this ffmpeg. Padding each clip with silence to the
  end instead means no input ever ends, the divisor stays at the number of
  clips, and multiplying by it afterwards restores exactly the level each line
  was recorded at. `-shortest` then cuts the endless audio at the last frame.
*/
const inputs = clips.flatMap((c) => ['-i', c.file]);
/* The delay is given once per channel rather than with `all=1`, which older
   ffmpeg builds — including the one installed here — do not accept. Two
   values cover mono and stereo; extra values are ignored. */
const delays = clips
  .map((c, i) => {
    const ms = Math.round(c.start * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms},apad[v${i}]`;
  })
  .join(';');
const mix =
  `${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length}[m];` +
  `[m]volume=${clips.length}[a]`;

const out = path.join(ROOT, 'recipe-notebook-walkthrough-voiced.mp4');
const muxed = spawnSync(
  FFMPEG,
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', video,
    ...inputs,
    '-filter_complex', `${delays};${mix}`,
    '-map', '0:v', '-map', '[a]',
    /* The picture is copied, not re-encoded: the film is already what it
       should be and a second pass through x264 would only cost it. */
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-shortest',
    out,
  ],
  { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' },
);
if (muxed.status !== 0) {
  /* The failing command is 65 file paths long; what is worth reading is what
     ffmpeg said about it. */
  console.error(muxed.stderr?.trim() || `ffmpeg exited ${muxed.status}`);
  process.exit(1);
}

console.log(`${out} — ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)}MB, ${clips.length} lines`);
console.log('Listen to it end to end before sending it anywhere.');
