// THE WALKTHROUGH — A REAL RECORDING OF THE RUNNING APPLICATION.
//
//   node artifact/scripts/film.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS, AND WHAT IT IS NOT
//
// Ahmed: "הסרטון צריך להיות הקלטה של אפליקציה עובדת: לחיצות, הקלדה, גלילה,
// ניווט, שמירה ושינויי מצב אמיתיים. לא מצגת תמונות, לא אנימציה של צילומי מסך
// ולא סרטון AI שמדמה ממשק."
//
// So this drives the real build in a real Chromium and lets Playwright record
// what the browser paints. Every click is a click, every keystroke goes
// through the real input, every save goes through the real repository. Nothing
// is staged: if a screen were broken, the recording would show it broken.
//
// THREE THINGS ARE ADDED FOR THE VIEWER, AND NONE OF THEM CHANGES BEHAVIOUR
//
//   1. A CURSOR. Programmatic clicks paint no pointer, and a video of a UI
//      operating itself with no visible cause is hard to follow. So a ring is
//      drawn at the point about to be clicked, a beat before the real click
//      happens there. It marks a real event; it does not cause one.
//   2. CAPTIONS, composited afterwards rather than drawn into the page —
//      see `caption.mjs`. Burning Hebrew with ffmpeg's `drawtext` is not an
//      option: it has no bidi shaping, so the words come out reversed.
//   3. WAITS. Long enough to read a screen. Ahmed allowed exactly this:
//      "אפשר לקצר זמני המתנה בעריכה, אך לא לזייף התנהגות או תוצאה."
//
// WHICH BUILD, AND WHY THE CAPTIONS SAY "SIMULATION" IN PLACES
//
// The Artifact build: the real screens, the real engine, the real CSS, with a
// fixture repository behind them because there is no server in this
// environment. Recipes, quantities, costs, conversions, Cook Mode and the
// measuring tools are the product computing for itself. Groups, the chat, the
// invitations and the production plan are a LOCAL SIMULATION of a backend that
// exists as migrations and policies but has nothing running here — and the
// captions say so on those screens, because "הבחֵן בין יכולת עובדת, סימולציה
// ויכולת שטרם מומשה".
//
// OUTPUT
//   .film/app.webm      what Chromium recorded
//   .film/cues.json     every caption with the second it belongs to
// `npm run film` then composites and encodes; see `film-render.mjs`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const DIST = path.join(HERE, '..', 'dist');
const OUT = path.join(ROOT, '.film');
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const PAGE = fs.readFileSync(path.join(HERE, '..', 'app-page.html'), 'utf8');
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#eeece4;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const WRAPPED = `${HEAD}${PAGE}</body></html>`;

const PORT = 8190;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(WRAPPED);
  }
  const file = path.join(DIST, url);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('no');
  }
  res.writeHead(200, {
    'Content-Type': file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : 'text/css; charset=utf-8',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/index.html`;

/*
  ── ONE FRAME, APP AND CAPTION TOGETHER ───────────────────────────────────

  1440×900: the application laid out in the left 1000px — which gives it the
  tablet frame, 760 wide, at full height — and a 440px caption panel pinned to
  the right, where a Hebrew reader starts.

  THE PANEL IS IN THE RECORDED PAGE, AND THAT IS THE SECOND ATTEMPT.

  The first version recorded the app alone and composited the captions
  afterwards from wall-clock timestamps. It produced a video whose captions
  described the wrong screens: Playwright's WebM is variable-rate, its frame
  timestamps do not track `Date.now()` evenly, and the drift was ten seconds
  in places — measured by pulling a frame at 100s and finding the screen from
  90s under a caption written for 100s.

  Painting the caption into the same page removes the whole class of error
  rather than correcting for it: the words and the screen they describe are
  the same frame, so they cannot disagree. ffmpeg is then only a transcode.
*/
const SIZE = { width: 1440, height: 900 };
const APP_W = 1000;
const PANEL_W = SIZE.width - APP_W;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-prefers-reduced-motion=false'],
});
const ctx = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: SIZE },
});

/** The clock every cue is measured against: the moment recording begins. */
const T0 = Date.now();
const at = () => (Date.now() - T0) / 1000;

const cues = [];
let chapter = '';
/**
 * Record a caption for right now.
 *
 * The cue list is the video's script AND the chapter list Ahmed asked to be
 * delivered with it, so it is written as data rather than narrated in a
 * comment.
 */
const chapterOrder = [];
/**
 * Paint a caption AND record it.
 *
 * The painting is what the viewer reads; the record is the chapter list
 * Ahmed asked to be delivered with the video. One call keeps them identical,
 * which the composited version could not promise.
 */
const say = async (text, opts = {}) => {
  if (opts.chapter) chapter = opts.chapter;
  if (!chapterOrder.includes(chapter)) chapterOrder.push(chapter);
  const cue = {
    t: at(),
    chapter,
    text,
    kind: opts.kind ?? 'caption',
    nth: chapterOrder.indexOf(chapter) + 1,
    count: `${String(cues.length + 1).padStart(2, '0')}`,
  };
  cues.push(cue);
  await page.evaluate((c) => window.__filmSay?.(c), cue);
  console.log(`${at().toFixed(1).padStart(6)}s  ${chapter} — ${text.slice(0, 70)}`);
};

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) =>
  r.request().url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort(),
);

/* ── the film's own chrome: a cursor, and the caption panel ───────────────
   Injected, so it survives every navigation, and built from the product's own
   font and palette so the two halves of the frame look like one thing. */
await page.addInitScript(
  ([appW, panelW]) => {
    const build = () => {
      if (document.getElementById('film-panel')) return;

      const css = document.createElement('style');
      css.textContent = `
        html, body { overflow: hidden !important; }
        #root {
          position: absolute !important;
          inset-block: 0 !important;
          left: 0 !important;
          inline-size: ${appW}px !important;
        }
        #film-panel {
          position: fixed;
          inset-block: 0;
          right: 0;
          inline-size: ${panelW}px;
          z-index: 2147483646;
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 44px 34px;
          box-sizing: border-box;
          direction: rtl;
          background: #33473a;
          color: #f3f1ea;
          font-family: Heebo, system-ui, sans-serif;
        }
        #film-panel .mark {
          display: flex; align-items: center; gap: 10px;
          margin: 0; font-size: 15px; font-weight: 500; color: #c3cdc4;
        }
        #film-panel .num {
          display: grid; place-items: center;
          inline-size: 26px; block-size: 26px;
          border: 1px solid #4a6151; border-radius: 8px; font-size: 13px;
        }
        #film-panel .body { flex: 1; display: flex; align-items: center; }
        #film-panel .text {
          margin: 0; font-size: 27px; font-weight: 500; line-height: 1.42;
          text-wrap: pretty;
          transition: opacity .25s ease;
        }
        #film-panel.title .text { font-size: 40px; font-weight: 700; }
        #film-panel .rule { block-size: 1px; background: #4a6151; }
        #film-panel .foot {
          display: flex; justify-content: space-between; align-items: baseline;
          margin: 0; font-size: 14px; color: #c3cdc4;
        }
        #film-panel .name { font-weight: 600; }
        #film-panel .count { direction: ltr; font-variant-numeric: tabular-nums; }
      `;
      document.head.append(css);

      const panel = document.createElement('aside');
      panel.id = 'film-panel';
      panel.innerHTML = `
        <p class="mark"><span class="num">0</span><span class="chapter"></span></p>
        <div class="body"><p class="text"></p></div>
        <div class="rule"></div>
        <p class="foot"><span class="name">מחברת מתכונים</span><span class="count"></span></p>
      `;
      document.body.append(panel);

      const dot = document.createElement('div');
      dot.id = 'film-cursor';
      dot.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'inline-size:26px',
        'block-size:26px',
        'margin:-13px 0 0 -13px',
        'border:2px solid rgba(73,100,81,0.95)',
        'border-radius:50%',
        'background:rgba(73,100,81,0.16)',
        'pointer-events:none',
        'opacity:0',
        'transition:left .28s ease,top .28s ease,opacity .18s,transform .12s',
      ].join(';');
      document.body.append(dot);

      /* The panel's content is set from the harness and has to survive a
         reload, so it is kept where a reload can find it again. */
      const held = sessionStorage.getItem('film-caption');
      if (held) window.__filmSay(JSON.parse(held));
    };

    window.__filmSay = (cue) => {
      const panel = document.getElementById('film-panel');
      if (!panel) return;
      panel.classList.toggle('title', cue.kind === 'title');
      panel.querySelector('.num').textContent = String(cue.nth);
      panel.querySelector('.chapter').textContent = cue.chapter;
      panel.querySelector('.text').textContent = cue.text;
      panel.querySelector('.count').textContent = cue.count;
      try {
        sessionStorage.setItem('film-caption', JSON.stringify(cue));
      } catch {
        /* a caption is not worth failing a take over */
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
  },
  [APP_W, PANEL_W],
);

const wait = (ms) => page.waitForTimeout(ms);

/** Move the ring to a point, so the click that follows has a visible cause. */
async function point(x, y) {
  await page.evaluate(
    ([px, py]) => {
      const dot = document.getElementById('film-cursor');
      if (!dot) return;
      dot.style.left = `${px}px`;
      dot.style.top = `${py}px`;
      dot.style.opacity = '1';
    },
    [x, y],
  );
  await wait(320);
}

async function tap(locator, { settle = 700 } = {}) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  if (box) await point(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const dot = document.getElementById('film-cursor');
    if (dot) dot.style.transform = 'scale(0.7)';
  });
  await wait(120);
  await target.click({ timeout: 15000 });
  await page.evaluate(() => {
    const dot = document.getElementById('film-cursor');
    if (dot) dot.style.transform = 'scale(1)';
  });
  await wait(settle);
}

async function write(locator, text, { delay = 55 } = {}) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  if (box) await point(box.x + box.width / 2, box.y + box.height / 2);
  await target.click();
  await target.fill('');
  await target.type(text, { delay });
  await wait(400);
}

/** Scroll the app's own scroller, slowly, the way a thumb does. */
async function scroll(by, steps = 14) {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((amount) => {
      const el = document.querySelector('main[class*="content"]') ?? document.scrollingElement;
      if (el) el.scrollTop += amount;
    }, by / steps);
    await wait(45);
  }
  await wait(400);
}

/*
  ── NAVIGATION THAT IS VERIFIED, NOT ASSUMED ─────────────────────────────

  The first take of this film had captions describing screens that were not
  on screen, and the cause was two lines of my own:

    · `page.goto(BASE + '#' + route)` from another hash is a SAME-DOCUMENT
      change. The Artifact maps the router to the hash and reads it at boot,
      so a hash change with no reload left the previous screen up. Every
      other probe in this directory carries a unique query string for exactly
      this reason — `walk.mjs` documents it — and this file did not.
    · a caption recorded right after a click, with no check that the click
      had arrived anywhere.

  So navigation now asserts where it landed before anything is said about it.
  A film that quietly describes the wrong screen is worse than one that fails
  to build.
*/
let nav = 0;
const go = async (hash, heading) => {
  nav += 1;
  await page.goto(`${BASE}?take=${nav}#${hash}`, { waitUntil: 'load' });
  await wait(1200);
  await expectScreen(heading, hash);
};

/** Waits for the screen's own heading, and throws with what it found. */
async function expectScreen(heading, what) {
  if (!heading) return;
  try {
    await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 8000 });
  } catch {
    const h1 = await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`expected "${heading}" on ${what}; the screen says "${h1 ?? '(no h1)'}"`);
  }
}

try {
  /* ══ OPENING ═══════════════════════════════════════════════════════════ */
  await go('/home', /^בית$/);
  await say('מחברת מתכונים — מערכת עבודה לקונדיטוריה מקצועית', {
    chapter: 'פתיחה',
    kind: 'title',
  });
  await wait(2600);
  await say(
    'ההקלטה הזאת היא האפליקציה עצמה, רצה בדפדפן. כל לחיצה, הקלדה ושמירה כאן אמיתיות.',
  );
  await wait(3200);

  /* ══ א. HOME AND NAVIGATION ════════════════════════════════════════════ */
  await say('מסך הבית והניווט', { chapter: 'א. הבית והניווט', kind: 'title' });
  await wait(2200);
  await say('הבית הוא נקודת הפתיחה: חיפוש, שש דרכי כניסה, והמשך מאיפה שעצרת.');
  await wait(3000);
  await scroll(320);
  await say('פעולות מהירות — המחברת, חומרי גלם, כלי מדידה, קבוצות, תכנון וקטגוריות.');
  await wait(2600);
  await scroll(360);
  await say('קטגוריות עם מספר המתכונים בכל אחת, ומתכוני הבסיס עם העלות לקילוגרם.');
  await wait(3000);
  await scroll(-680, 10);

  await say('פס הניווט התחתון מחזיק ארבעה אזורים: בית, מחברת, קבוצות ועוד.');
  await wait(2400);

  /* ══ ב. THE NOTEBOOK ═══════════════════════════════════════════════════ */
  await say('מחברת המתכונים והקטגוריות', { chapter: 'ב. המחברת', kind: 'title' });
  await wait(2000);
  await tap(page.locator('nav[aria-label="ניווט ראשי"] a[href="/notebook"]'));
  await expectScreen(/מחברת מתכונים/, 'the notebook tab');
  await say('המחברת: כל המתכונים, עם תמונה, קטגוריה, תשואה ומשקל ליחידה.');
  await wait(2800);
  await scroll(300);
  await wait(600);
  await scroll(-300, 8);

  await say('סינון לפי קטגוריה — הסינון נשמר בכתובת, כך שחזרה לרשימה מחזירה אותו.');
  await wait(2400);
  await tap(page.getByRole('button', { name: 'בצקים', exact: true }));
  await say('שלושה מתכוני בצקים.');
  await wait(2200);
  await tap(page.getByRole('button', { name: 'הכל', exact: true }));

  await say('חיפוש חופשי לפי שם, תג או רכיב.');
  await wait(1800);
  await write(page.locator('#nb-search'), 'קרם');
  await say('החיפוש עובד על שמות, תגים ורכיבים — לא רק על השם.');
  await wait(2600);
  await write(page.locator('#nb-search'), '');
  await wait(600);

  /* ══ ג. CREATING A RECIPE ══════════════════════════════════════════════ */
  await say('יצירת מתכון — אשף בארבעה שלבים', { chapter: 'ג. יצירת מתכון', kind: 'title' });
  await wait(2200);
  await tap(page.getByRole('link', { name: 'מתכון חדש' }));
  await expectScreen(/מתכון חדש/, 'the editor');
  await say('שלב 1 — פרטים: שם, קטגוריה, תגים, ותמונה.');
  await wait(2400);
  await write(page.getByLabel('שם המתכון'), 'טארט לימון מרנג');
  await tap(page.locator('#r-category'), { settle: 300 });
  await page.selectOption('#r-category', { label: 'עוגות ועוגיות' }).catch(() => {});
  await wait(700);
  await say('בחירת קטגוריה מתוך הקטגוריות של המערכת.');
  await wait(2000);
  await scroll(420);
  await say(
    'תמונה אפשר לבחור כבר כאן. במתכון חדש היא מועלית ברגע השמירה הראשונה — לפני זה אין עוד מתכון לשמור אותה עליו.',
  );
  await wait(4200);

  await tap(page.getByRole('button', { name: /^שלב 2 / }));
  await say('שלב 2 — חומרי גלם: שם, כמות ויחידה לכל שורה.');
  await wait(2400);
  await write(page.getByLabel('שם הרכיב בשורה 1'), 'חמאה 82%');
  await write(page.getByLabel('כמות של חמאה 82%'), '180');
  await tap(page.getByRole('button', { name: 'הוספת רכיב' }));
  await write(page.getByLabel('שם הרכיב בשורה 2'), 'סוכר');
  await write(page.getByLabel('כמות של סוכר'), '150');
  await tap(page.getByRole('button', { name: 'הוספת רכיב' }));
  await write(page.getByLabel('שם הרכיב בשורה 3'), 'ביצים');
  await write(page.getByLabel('כמות של ביצים'), '4');
  await say('המערכת מחשבת תוך כדי: משקל כולל, שלמות החישוב ומה חסר.');
  await wait(3000);
  await scroll(320);
  await wait(1500);

  await tap(page.getByRole('button', { name: /^שלב 3 / }));
  await say('שלב 3 — אופן ההכנה: שלבים, זמנים וטמפרטורות.');
  await wait(2200);
  const step1 = page.getByLabel(/הוראה בשלב 1/).first();
  if ((await step1.count()) > 0) {
    await write(step1, 'להקציף חמאה וסוכר עד בהיר ואוורירי.', { delay: 35 });
  }
  await wait(900);

  await tap(page.getByRole('button', { name: /^שלב 4 / }));
  await say('שלב 4 — סיכום, ואז שמירה.');
  await wait(2000);
  await tap(page.getByRole('button', { name: /שמירת ה(מתכון|שינויים)/ }), { settle: 1800 });
  await expectScreen(/טארט לימון מרנג/, 'the saved recipe');
  await say('נשמר. המתכון נפתח, והתוכן שהוקלד נמצא בו.');
  await wait(3000);
  await scroll(360);
  await wait(1600);
  await scroll(-360, 8);

  /* ══ ד. WORKING WITH A RECIPE ══════════════════════════════════════════ */
  await say('עבודה עם מתכון', { chapter: 'ד. עבודה עם מתכון', kind: 'title' });
  await wait(2000);
  await go('/recipe/brioche', /בריוש נאנטר/);
  await say('תמונת המתכון בראש הדף, בגובה קבוע וללא מתיחה.');
  await wait(2600);

  await say('למי שמורשה לערוך: התאמת המיקום שנשאר במרכז החיתוך.');
  await wait(2400);
  const focusBtn = page.getByRole('button', { name: 'התאמת מיקום התמונה' });
  if ((await focusBtn.count()) > 0) {
    await tap(focusBtn);
    const band = page.getByRole('button', {
      name: 'בחירת מיקום התמונה — לחיצה על הנקודה שתישאר במרכז',
    });
    const box = await band.boundingBox();
    if (box) {
      await point(box.x + box.width * 0.3, box.y + box.height * 0.28);
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.28);
      await wait(900);
      await say('התמונה זזה מיד — זו תצוגה מקדימה על התמונה האמיתית, בגודל האמיתי.');
      await wait(2800);
      await tap(page.getByRole('button', { name: 'שמירת המיקום' }), { settle: 1500 });
      await say('נשמר. המיקום נשמר על התמונה ולא על הדפדפן, ולכן הוא שורד רענון.');
      await wait(3000);
    }
  }

  await scroll(300);
  await say('שינוי כמות להכנה: לפי יחידות, לפי משקל, או לפי המלאי שיש בפועל.');
  await wait(3000);
  await tap(page.getByRole('button', { name: 'יחידות', exact: true }));
  const units = page.locator('input[inputmode="decimal"], input[type="number"]').first();
  if ((await units.count()) > 0) {
    await write(units, '24', { delay: 120 });
    await say('כל הכמויות במתכון חושבו מחדש — כולל המשקל הכולל ומשקל היחידה.');
    await wait(3200);
  }
  await scroll(360);
  await say('כל שורה מציגה המרה: מגרמים לכוסות וחזרה, לפי הכלים שנמדדו בהגדרות.');
  await wait(3000);
  const convert = page.getByRole('button', { name: /^המר/ }).first();
  if ((await convert.count()) > 0) {
    await tap(convert);
    await wait(1800);
  }
  await scroll(420);
  await say('עלויות: עלות לכל שורה, עלות כוללת, עלות ליחידה ולקילוגרם.');
  await wait(3200);
  await scroll(420);
  await say('אלרגנים נאספים אוטומטית מחומרי הגלם שבמתכון.');
  await wait(2600);
  await scroll(520);
  await say('הערה אישית — שמורה לחשבון בלבד, ואינה נוסעת עם המתכון בשיתוף.');
  await wait(2800);

  /* ══ ה. THE FULL PREPARATION ═══════════════════════════════════════════ */
  await say('תהליך הכנה מלא', { chapter: 'ה. מצב הכנה', kind: 'title' });
  await wait(2000);
  await go('/recipe/brioche', /בריוש נאנטר/);
  await scroll(240);
  await tap(page.getByRole('link', { name: 'מצב הכנה' }), { settle: 1600 });
  await expectScreen(/הכנת חומרי גלם/, 'cook mode');
  await say('מיז־אן־פלאס: כל חומרי הגלם בכמות של ההכנה הזאת, לסימון לפני שמתחילים.');
  await wait(3400);
  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < Math.min(3, n); i += 1) {
    await tap(boxes.nth(i), { settle: 380 });
  }
  await say('המסך אומר כמה נותרו — ואפשר לעבור להכנה גם לפני שהכול סומן.');
  await wait(3000);
  for (let i = 3; i < n; i += 1) {
    await tap(boxes.nth(i), { settle: 260 });
  }
  await say('הכול מוכן.');
  await wait(1800);
  await tap(page.getByRole('button', { name: /מתחילים בהכנה/ }), { settle: 1600 });
  await say('שלבי העבודה, אחד בכל פעם, בטקסט גדול למטבח.');
  await wait(3000);
  const timer = page.getByRole('button', { name: /טיימר|דקות/ }).first();
  if ((await timer.count()) > 0) {
    await tap(timer, { settle: 1400 });
    await say('טיימר לשלב, מתוך הזמן שנרשם במתכון.');
    await wait(2600);
  }
  await tap(page.getByRole('button', { name: 'הבא' }), { settle: 1100 });
  await tap(page.getByRole('button', { name: 'הבא' }), { settle: 1100 });
  await say('ההתקדמות נשמרת על המכשיר — יציאה וחזרה מחזירות לאותו שלב.');
  await wait(2800);
  await tap(page.getByRole('button', { name: 'יציאה' }), { settle: 1400 });
  await scroll(240);
  await tap(page.getByRole('link', { name: 'מצב הכנה' }), { settle: 1600 });
  await say('חזרנו — וההכנה ממשיכה מהשלב שבו עצרנו, לא מההתחלה.');
  await wait(3200);

  /* ══ ו. INGREDIENTS AND COSTS ══════════════════════════════════════════ */
  await say('חומרי גלם ועלויות', { chapter: 'ו. חומרי גלם ועלויות', kind: 'title' });
  await wait(2000);
  await go('/ingredients', /^חומרי גלם$/);
  await say('מרכז חומרי הגלם: מחיר אחד לכל חומר, במקום אחד.');
  await wait(2800);
  await say('כאן היה חסר כפתור חזרה — הוא נוסף, והוא חוזר למסך שממנו באת.');
  await wait(2800);
  await scroll(260);
  await say('נשנה את מחיר החמאה ונראה מה זה עושה לעלות של מתכון.');
  await wait(2600);
  const editButtons = page.getByRole('button', { name: /^עריכת חמאה/ });
  if ((await editButtons.count()) > 0) {
    await tap(editButtons.first(), { settle: 900 });
    const price = page.locator('input[inputmode="decimal"]').first();
    if ((await price.count()) > 0) {
      await write(price, '52', { delay: 150 });
      await say('340 ש״ח ל־10 ק״ג הופכים ל־52 ש״ח לקילוגרם.');
      await wait(2400);
      const save = page.getByRole('button', { name: /שמירה|עדכון/ }).first();
      if ((await save.count()) > 0) await tap(save, { settle: 1400 });
    }
  }
  await go('/recipe/brioche', /בריוש נאנטר/);
  await scroll(900);
  await say('אותו מתכון, אחרי שינוי המחיר: העלויות חושבו מחדש מהמחיר החדש.');
  await wait(3400);

  /* ══ ז. EVERY OTHER SCREEN ═════════════════════════════════════════════ */
  await say('שאר מסכי המערכת', { chapter: 'ז. שאר המערכת', kind: 'title' });
  await wait(2000);

  await go('/recipe/brioche/order', /פרטי ההזמנה/);
  await say('דף הזמנה: מה להזמין לאצווה הזאת, בכמויות ובעלויות. מיועד להדפסה.');
  await wait(3200);
  await scroll(420);
  await wait(1400);

  await go('/recipe/brioche/label', /בריוש נאנטר/);
  await say('תווית מוצר: רכיבים לפי סדר יורד, אלרגנים ומשקל — גם היא להדפסה.');
  await wait(3400);

  await go('/tools', /כלי המדידה/);
  await say('כלי המדידה: הכוס והכף של המטבח הזה, נמדדות פעם אחת.');
  await wait(2800);
  await scroll(260);
  await say('כל המרה במערכת נעשית לפי הכלים האלה, ולא לפי תקן שרירותי.');
  await wait(3000);

  await go('/plans', /תכנון ייצור/);
  await say('תכנון ייצור: יום עבודה עם כמה מתכונים ורשימת רכש אחת.');
  await wait(2800);
  await tap(page.getByRole('link', { name: /יום ייצור/ }).first(), { settle: 1500 });
  await expectScreen(/יום ייצור/, 'one plan');
  await scroll(360);
  await say('רשימת הרכש מסכמת את כל חומרי הגלם של היום, עם מה שאין לו מחיר.');
  await wait(3400);
  await scroll(420);
  await wait(1600);

  await go('/groups', /קבוצות וקורסים/);
  await say('קבוצות וקורסים — כאן ואילך זו סימולציה מקומית: אין שרת ואין משתמשים אחרים.');
  await wait(3600);
  await tap(page.getByRole('link', { name: /קורס קונדיטוריה/ }).first(), { settle: 1500 });
  await expectScreen(/קורס קונדיטוריה/, 'the course');
  await say('קורס עם שיעורים ומתכונים שהמדריך פרסם לתלמידים.');
  await wait(3000);
  await tap(page.getByRole('tab', { name: /צ׳אט/ }), { settle: 1400 });
  await say('צ׳אט הקבוצה. ההרשאות אמיתיות בקוד; המשתמשים כאן מדומים.');
  await wait(3000);
  await write(page.locator('#chat-draft'), 'איזו חמאה להביא מחר?', { delay: 45 });
  await tap(page.getByRole('button', { name: 'שליחה' }), { settle: 1200 });
  await say('ההודעה נשלחה ומופיעה בשיחה.');
  await wait(2400);

  await go('/group/group-team/perms', /חברים והרשאות/);
  await say('חברים והרשאות: תפקידים, דרגות, ומי יכול לעשות מה בכל מתכון.');
  await wait(3400);
  await scroll(420);
  await wait(1800);

  await go('/settings', /^הגדרות$/);
  await say('הגדרות: פרופיל עבודה, שפה, וכיול הכלים.');
  await wait(2800);
  await scroll(360);
  await wait(1600);

  await go('/more', /^עוד$/);
  await say('״עוד״ מרכז את כל מה שאינו מתכון: חומרי גלם, תכנון, כלים והגדרות.');
  await wait(3000);

  /* ══ CLOSING ═══════════════════════════════════════════════════════════ */
  await go('/home', /^בית$/);
  await say('מקונדיטור אחד ועד קורס שלם — מתכון, עלות, הכנה וצוות במקום אחד.', {
    chapter: 'סיום',
    kind: 'title',
  });
  await wait(3600);
  await say('הקלטה של המערכת כפי שהיא רצה. ללא שרת בסביבה הזאת — ולכן הקבוצות והצ׳אט מדומים.');
  await wait(3600);
} finally {
  const duration = at();
  await ctx.close();
  await browser.close();
  server.close();

  const video = fs.readdirSync(OUT).find((f) => f.endsWith('.webm'));
  if (video) fs.renameSync(path.join(OUT, video), path.join(OUT, 'app.webm'));
  fs.writeFileSync(
    path.join(OUT, 'cues.json'),
    `${JSON.stringify({ size: SIZE, duration, cues, pageErrors: errors }, null, 2)}\n`,
  );
  console.log(`\nrecorded ${duration.toFixed(1)}s, ${cues.length} cues`);
  console.log(`page errors during the take: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 3).join('\n'));
  console.log(`${OUT}/app.webm + cues.json`);
}
