// A GENUINE MHTML ARCHIVE OF THE NOTEBOOK'S SCREENS, FOR VIEWING.
//
//   node artifact/scripts/export-mht.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS PRODUCES, AND WHAT IT DOES NOT
//
// One file, `exports/recipe-notebook-latest.mht`, written by Chromium itself
// through the DevTools protocol (`Page.captureSnapshot`, format mhtml): a
// real multipart/related web archive, the same thing "Save as… Webpage,
// Single File" writes. Not an HTML file with its extension renamed.
//
// An MHTML holds ONE document. The notebook is a single-page application, so
// its state at any moment is one screen, and no archive of the live page can
// hold sixteen screens at once. What is archived instead is a DOCUMENTATION
// PAGE, built here and separate from the application: every main screen,
// captured from the running bundle at phone width with its fonts and images
// loaded, laid out with a heading, its route and a line of what it is for.
// It is for looking at. Nothing in it is clickable, nothing computes, and the
// page says so at the top.
//
// The application is untouched: it is served from `artifact/dist`, exactly
// as built, and the only styling injected at capture time lets the inner
// scroller grow so a whole screen fits in one image. No data is added; the
// demo repository supplies what the screens show, and it contains nothing
// private.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const DIST = path.join(HERE, '..', 'dist');
const OUT_DIR = path.join(ROOT, 'exports');
const SHOTS = path.join(OUT_DIR, 'shots');
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const commit = git(['rev-parse', '--short', 'HEAD']);
const branch = git(['branch', '--show-current']);
const dirty = git(['status', '--porcelain']).length > 0;
const when = new Date();
const stamp = when.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/* ── the application, served as built ───────────────────────────────────── */
const PAGE = fs.readFileSync(path.join(HERE, '..', 'app-page.html'), 'utf8');
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#eeece4;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const APP = `${HEAD}${PAGE}</body></html>`;

let DOC = '';
const PORT = 8199;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const serve = (body, type) => {
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  };
  if (url === '/' || url === '/index.html') return serve(APP, 'text/html; charset=utf-8');
  if (url === '/doc.html') return serve(DOC, 'text/html; charset=utf-8');
  if (url.startsWith('/shots/')) {
    const f = path.join(SHOTS, path.basename(url));
    if (fs.existsSync(f)) return serve(fs.readFileSync(f), 'image/png');
  }
  const file = path.join(DIST, url);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('no');
  }
  serve(fs.readFileSync(file), file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

/* ── the screens ─────────────────────────────────────────────────────────── */
const SCREENS = [
  ['home', '/home', /^בית$/, 'בית', 'נקודת הפתיחה: חיפוש, כניסות מהירות, קטגוריות, והמשך מאיפה שעצרת.'],
  ['notebook', '/notebook', /מחברת מתכונים/, 'המחברת', 'כל המתכונים, עם סינון לפי קטגוריה וחיפוש בשמות, בתגיות וברכיבים.'],
  ['recipe', '/recipe/brioche', /בריוש נאנטר/, 'מתכון', 'כמה להכין, רכיבים עם המרות, אופן ההכנה, ופרטים מקצועיים כולל פוד קוסט.'],
  ['editor', '/recipe/new', /מתכון חדש/, 'יצירת מתכון', 'אשף בארבעה שלבים: פרטים, חומרי גלם, אופן ההכנה, סיכום.'],
  ['cook', '/recipe/brioche/cook', /./, 'מצב הכנה', 'מיז אן פלאס לפני ההתחלה, ואחריו שלב אחד בכל פעם בטקסט גדול.'],
  ['order', '/recipe/brioche/order', /פרטי ההזמנה/, 'דף הזמנה', 'מה להזמין לאצווה הזאת, בכמויות ובעלויות, מוכן להדפסה.'],
  ['label', '/recipe/brioche/label', /./, 'תווית מוצר', 'רכיבים לפי סדר יורד, אלרגנים ומשקל.'],
  ['ingredients', '/ingredients', /^חומרי גלם$/, 'חומרי גלם', 'מרכז המחירים: מחיר אחד לכל חומר, במקום אחד.'],
  ['tools', '/tools', /כלי המדידה/, 'כלי המדידה', 'הכוס והכף של המטבח הזה, נמדדות פעם אחת.'],
  ['plans', '/plans', /./, 'תכנון ייצור', 'ימי עבודה עם כמה מתכונים כל אחד.'],
  ['plan', '/plan/fixture-plan-1', /יום ייצור/, 'יום ייצור', 'כמויות יעד לכל מתכון, ורשימת רכש אחת לכל היום.'],
  ['groups', '/groups', /קבוצות וקורסים/, 'קבוצות וקורסים', 'בהדגמה הזאת — סימולציה מקומית, בלי שרת ובלי משתמשים אחרים.'],
  ['group', '/group/group-team', /./, 'קבוצה וצ׳אט', 'הודעות הקבוצה. בהדגמה נשמרות במסך בלבד ואינן נשלחות לאיש.'],
  ['perms', '/group/group-team/perms', /חברים והרשאות/, 'חברים והרשאות', 'תפקידים, דרגות, ומי רשאי לעשות מה בכל מתכון.'],
  ['course', '/group/group-course', /./, 'קורס', 'שיעורים והמתכונים שהמדריך פרסם לתלמידים.'],
  ['settings', '/settings', /^הגדרות$/, 'הגדרות', 'פרופיל עבודה, שפה וכיול הכלים.'],
  ['more', '/more', /^עוד$/, 'עוד', 'כל מה שאינו מתכון.'],
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

/* Let the inner scroller grow, so one image holds the whole screen. Capture
   time only; the bundle on disk is not touched. */
const GROW = `
  html, body, #root, #root > * { height: auto !important; max-height: none !important; min-height: 0 !important; }
  main[class*="content"] { overflow: visible !important; height: auto !important; max-height: none !important; }
  [class*="frame"], [class*="column"] { height: auto !important; max-height: none !important; }
`;

const settled = async () => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      Promise.all(
        [...document.images].map((img) =>
          img.complete ? null : new Promise((res) => img.addEventListener('load', res, { once: true })),
        ),
      ),
  );
  await page.waitForTimeout(600);
};

const captured = [];
let nav = 0;
for (const [key, route, heading, title, blurb] of SCREENS) {
  nav += 1;
  await page.goto(`${BASE}/index.html?take=${nav}#${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  /* h1 and h2 both: a recipe's order and label pages keep the recipe's name
     as their h1 and say what they are in the h2. */
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2')].map((el) => (el.textContent ?? '').trim()).filter(Boolean),
  );
  const h1 = heads[0] ?? '';
  if (!heads.some((h) => heading.test(h))) throw new Error(`${route}: expected ${heading}, found «${heads.join(' | ')}»`);
  await settled();
  const style = await page.addStyleTag({ content: GROW });
  await page.waitForTimeout(250);
  const file = path.join(SHOTS, `${key}.png`);
  await page.screenshot({ path: file, fullPage: true });
  /* The image's own size, read from the PNG header: measuring the document
     after the grow-style is removed reports the viewport, not the screen. */
  const png = fs.readFileSync(file);
  const width = png.readUInt32BE(16) / 2;
  const height = png.readUInt32BE(20) / 2;
  await style.evaluate((el) => el.remove());
  captured.push({ key, route, title, blurb, h1: h1.trim(), height });
  console.log(`${key.padEnd(12)} ${route.padEnd(28)} h1=«${h1.trim()}» ${width}×${height}`);
}

/* ── the documentation page ──────────────────────────────────────────────── */
const css = fs.readFileSync(path.join(DIST, 'assets', fs.readdirSync(path.join(DIST, 'assets')).find((f) => f.endsWith('.css'))), 'utf8');
const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
DOC = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>מחברת מתכונים — תיעוד מסכים</title>
<style>
${faces.join('\n')}
:root { color-scheme: light; }
body { margin: 0; background: #eeece4; color: #141413; font-family: Heebo, system-ui, sans-serif; line-height: 1.5; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 32px; margin: 0 0 6px; }
.meta { color: #5b5b57; font-size: 15px; margin: 0 0 20px; }
.notice { background: #fbf1d6; border: 1px solid #e3c98a; border-radius: 12px; padding: 14px 18px; margin: 0 0 28px; font-size: 16px; }
.toc { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 18px; margin: 0 0 36px; padding: 0; list-style: none; }
.toc a { color: #33473a; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
section.screen { margin: 0 0 52px; }
section.screen h2 { font-size: 24px; margin: 0 0 2px; }
section.screen .route { direction: ltr; text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 14px; color: #5b5b57; margin: 0 0 6px; }
section.screen p { margin: 0 0 14px; font-size: 16px; }
section.screen img { display: block; width: 430px; max-width: 100%; height: auto; border-radius: 22px; border: 1px solid #d9d6cb; box-shadow: 0 8px 28px rgba(20,20,19,.08); }
footer { color: #5b5b57; font-size: 14px; border-top: 1px solid #d9d6cb; padding-top: 16px; }
</style>
</head>
<body>
<div class="wrap">
<h1>מחברת מתכונים — תיעוד מסכים</h1>
<p class="meta">יוצא ב־${stamp} · ענף <code dir="ltr">${branch}</code> · קומיט <code dir="ltr">${commit}</code>${dirty ? ' · עם שינויים לא מקומיים' : ''} · ${captured.length} מסכים · רוחב טלפון, פי שניים ברזולוציה</p>
<div class="notice"><strong>זהו תיעוד לצפייה, לא האפליקציה.</strong> כל מסך כאן הוא צילום של האפליקציה הרצה, עם נתוני ההדגמה שלה. אין כאן לחיצות, חישובים או שמירה — לזה יש את האפליקציה עצמה.</div>
<ul class="toc">
${captured.map((c) => `<li><a href="#${c.key}">${esc(c.title)}</a></li>`).join('\n')}
</ul>
${captured
  .map(
    (c) => `<section class="screen" id="${c.key}">
<h2>${esc(c.title)}</h2>
<p class="route">${esc(c.route)}</p>
<p>${esc(c.blurb)}</p>
<img src="shots/${c.key}.png" alt="${esc(c.title)} — צילום מסך" width="430" height="${Math.round(c.height)}">
</section>`,
  )
  .join('\n')}
<footer>מחברת מתכונים · תיעוד מסכים לצפייה · ${stamp} · ${branch}@${commit}</footer>
</div>
</body>
</html>
`;

/* ── the archive, written by the browser ─────────────────────────────────── */
const doc = await ctx.newPage();
await doc.setViewportSize({ width: 1180, height: 900 });
await doc.goto(`${BASE}/doc.html`, { waitUntil: 'load' });
await doc.evaluate(() => document.fonts.ready);
await doc.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => i.addEventListener('load', r, { once: true }))))));
const cdp = await ctx.newCDPSession(doc);
const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
const out = path.join(OUT_DIR, 'recipe-notebook-latest.mht');
fs.writeFileSync(out, data);
await browser.close();
server.close();

const parts = (data.match(/^Content-Location: /gm) ?? []).length;
console.log(`\n${out} — ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)}MB · ${parts} parts · ${branch}@${commit} · ${stamp}`);
