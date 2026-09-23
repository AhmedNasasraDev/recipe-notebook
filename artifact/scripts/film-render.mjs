// WEBM → MP4, AND THE CHAPTER LIST.
//
//   node artifact/scripts/film-render.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THERE IS ALMOST NOTHING HERE
//
// The first version of this file rendered caption panels to PNGs and
// composited them onto the recording with ffmpeg, timed from wall-clock
// stamps. That produced a video whose captions described the wrong screens:
// Playwright's WebM is variable-rate and its frame timestamps do not track
// `Date.now()` evenly — measured at ten seconds of drift in places, by
// pulling a frame at 100s and finding the screen from 90s beneath a caption
// written for 100s.
//
// So the caption panel moved INTO the recorded page (see film.mjs), where it
// cannot disagree with the screen beside it, and this file went from a
// compositor to a transcode. The remaining job:
//
//   · VP8/WebM → H.264/MP4, `yuv420p` and `+faststart`, which is the
//     combination that plays in a browser, in QuickTime, in WhatsApp and
//     inside a slide
//   · the chapter list with timestamps, which Ahmed asked for alongside the
//     file
//
// Nothing is re-timed, cropped or cut. What Chromium painted is the film.

import { execFileSync } from 'node:child_process';
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

const take = JSON.parse(fs.readFileSync(path.join(FILM, 'cues.json'), 'utf8'));
const source = path.join(FILM, 'app.webm');
if (!fs.existsSync(source)) throw new Error(`no recording at ${source}`);

const out = path.join(ROOT, 'recipe-notebook-walkthrough.mp4');
execFileSync(
  FFMPEG,
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    /* The recording is variable-rate; a constant 25fps is what players and
       editors expect, and conforming it here rather than at capture time
       keeps the capture untouched. Nothing is RESIZED: the capture already
       holds 1920×1200 of drawn pixels (see film.mjs on how it got there), so
       resampling it could only cost sharpness. */
    '-vf', 'fps=25',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    out,
  ],
  { stdio: 'inherit' },
);

const bytes = fs.statSync(out).size;
const { chaptersFile, narrationFile, chapterCount } = writeDocs(take, ROOT);

console.log(`${out} — ${(bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(chaptersFile);
console.log(narrationFile);
console.log(`${mmss(take.duration)} · ${chapterCount} chapters · ${take.cues.length} captions`);
