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
       keeps the capture untouched. */
    '-vf', 'fps=25',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    out,
  ],
  { stdio: 'inherit' },
);

const bytes = fs.statSync(out).size;
const mmss = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/*
  ── THE TIMESTAMPS IN THIS LIST ARE HONEST ABOUT WHAT THEY ARE ────────────

  They come from the harness's own clock, and the drift described above means
  they are approximate against the file — good to a few seconds, not to the
  frame. The captions themselves are IN the picture, so nothing depends on
  these being exact; they are a table of contents, and that is what they are
  labelled as.
*/
const chapters = [...new Set(take.cues.map((c) => c.chapter))];
const lines = [
  '# מחברת מתכונים — סרטון הצגה',
  '',
  `משך: ${mmss(take.duration)} · ${chapters.length} פרקים · ${take.cues.length} כתוביות`,
  '',
  'הכתוביות מוטבעות בתמונה עצמה. הזמנים כאן הם תוכן עניינים ומדויקים לכמה שניות.',
  '',
  '## פרקים',
  '',
];
for (const name of chapters) {
  const first = take.cues.find((c) => c.chapter === name);
  lines.push(`- **${mmss(first.t)}** — ${name}`);
}
lines.push('', '## כל הכתוביות, לפי הסדר', '');
for (const cue of take.cues) {
  lines.push(`- \`${mmss(cue.t)}\` ${cue.text}`);
}
lines.push(
  '',
  '## מה אמיתי ומה סימולציה בהקלטה',
  '',
  '- **אמיתי** — כל המסכים, הניווט, האשף, חישוב הכמויות, ההמרות, העלויות,',
  '  האלרגנים, מצב ההכנה, הטיימר, שמירת ההתקדמות, כלי המדידה, תמונת המתכון',
  '  והתאמת המיקום שלה. זה קוד המוצר מחשב לעצמו.',
  '- **סימולציה מקומית** — הקבוצות, הצ׳אט, ההזמנות ותוכנית הייצור. הסכימה,',
  '  ההרשאות וה־RLS קיימים כמיגרציות, אבל אין שרת רץ בסביבה הזאת, ולכן',
  '  המשתמשים והמסירה מדומים. הכתוביות אומרות זאת במסכים האלה.',
  '- **לא מומש** — «פענוח חכם» של מתכון מודבק (דורש proxy עם מפתח בצד שרת),',
  '  ומצב הסקיילינג «נפח סופי». שניהם אינם מוצגים בסרטון.',
  '',
);
const chaptersFile = path.join(ROOT, 'WALKTHROUGH_CHAPTERS.md');
fs.writeFileSync(chaptersFile, `${lines.join('\n')}\n`);

console.log(`${out} — ${(bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(chaptersFile);
console.log(`${mmss(take.duration)} · ${chapters.length} chapters · ${take.cues.length} captions`);
