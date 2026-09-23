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
//   2. CAPTIONS, painted into the recorded page itself, in a panel beside
//      the application. They were composited afterwards once, and that is
//      how the captions ended up describing the wrong screens — see the
//      layout note below. Burning them in with ffmpeg's `drawtext` was never
//      an option either: it has no bidi shaping, so Hebrew comes out
//      reversed.
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
const LAYOUT = { width: 1920, height: 1200 };
const APP_W = 1333;
const PANEL_W = LAYOUT.width - APP_W;
/*
  ── WHERE THE EXTRA PIXELS ACTUALLY COME FROM ─────────────────────────────

  Ahmed: "אם ניתן לייצא מחדש ממקור איכותי יותר, עשה זאת; אל תסתפק בהגדלת
  קובץ קיים ותציג אותה כשיפור בחדות."

  The first attempt asked Playwright to record a 1440×900 page into a
  2880×1800 file and called the result a 2880×1800 capture. It was not.
  Playwright fits the page into the video size and NEVER scales it up, so the
  frames held the page at 1440×900 in the top-left corner with grey padding
  over the other three quarters — measured by pulling a frame out of the take
  and looking at it. Encoding that to 1920×1200 would have been precisely the
  upscale-as-sharpness Ahmed ruled out.

  So the picture is genuinely bigger instead: the viewport is 1920×1200 and
  the application is laid out at the same 1000×900 CSS box as before with
  `zoom: 4/3` over it. The layout is identical — the same breakpoints, the
  same 760px frame, nothing reflows — and Chromium rasterises every glyph at
  the zoomed size, so the frames hold 1920×1200 of really drawn pixels. The
  encode is then 1:1 with the capture, with nothing resampled at all.
*/
const ZOOM = LAYOUT.width / 1440;
const SIZE = { ...LAYOUT };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-prefers-reduced-motion=false'],
});
const ctx = await browser.newContext({
  viewport: LAYOUT,
  /* Rendered at twice the viewport and downsampled into the video, which is
     supersampling: the same 1920×1200 frame, with finer edges on the type. */
  deviceScaleFactor: 2,
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
/*
  ── HOW LONG A LINE STAYS UP ──────────────────────────────────────────────

  Ahmed: "התאם את משך הסצנות לאורך ההקראה והשאר רגע להבנת התוצאה. אל תאיץ את
  הקול כדי להתאים אותו לסצנה קצרה. קצץ המתנות מיותרות."

  So the caption decides its own duration instead of every scene carrying a
  hand-tuned `wait`. 14 characters a second is an unhurried Hebrew reading
  pace, and the beat after it is the moment to take in what the screen just
  did. The floor stops a three-word line from flashing past; the ceiling
  stops a long one from stalling the film.

  This is also what makes the file ready for a voice track: each line's
  window is already at least as long as saying it takes.
*/
const READ_CPS = 14;
const holdFor = (text, kind) => {
  const read = (text.length / READ_CPS) * 1000;
  const beat = kind === 'title' ? 900 : 1100;
  return Math.round(Math.min(9500, Math.max(2600, read + beat)));
};

const say = async (text, opts = {}) => {
  if (opts.chapter) chapter = opts.chapter;
  if (!chapterOrder.includes(chapter)) chapterOrder.push(chapter);
  const kind = opts.kind ?? 'caption';
  const cue = {
    t: at(),
    chapter,
    text,
    kind,
    nth: chapterOrder.indexOf(chapter) + 1,
    count: `${String(cues.length + 1).padStart(2, '0')}`,
  };
  cues.push(cue);
  await pinPage();
  await page.evaluate((c) => window.__filmSay?.(c), cue);
  console.log(`${at().toFixed(1).padStart(6)}s  ${chapter} — ${text.slice(0, 66)}`);
  /* `hold: false` when something has to happen WHILE the line is up. */
  if (opts.hold !== false) await wait(holdFor(text, kind));
  cue.hold = opts.hold === false ? 0 : holdFor(text, kind);
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
  ([appW, panelW, zoom]) => {
    const build = () => {
      if (document.getElementById('film-panel')) return;

      const css = document.createElement('style');
      css.textContent = `
        html, body { overflow: hidden !important; }
        /* Laid out in the SAME CSS pixels as before and drawn a third
           bigger: zoom multiplies the raster, not the layout, so no
           breakpoint, column or frame width moves because the film got
           sharper. */
        #root {
          position: absolute !important;
          inset-block: 0 !important;
          left: 0 !important;
          inline-size: ${appW / zoom}px !important;
          zoom: ${zoom};
        }
        #film-panel {
          position: fixed;
          inset-block: 0;
          right: 0;
          zoom: ${zoom};
          inline-size: ${panelW / zoom}px;
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

    /*
      ── A GENTLE PUSH IN ON THE THING BEING TALKED ABOUT ──────────────────

      Ahmed: "הוסף תקריבים עדינים לשדות ולתוצאות שחשוב לקרוא, בלי לחתוך מידע
      נחוץ או את פאנל ההסבר."

      The transform is on `#root` — the application — and the caption panel is
      its sibling, so the panel can never be cropped by a zoom however far it
      goes. The origin is the centre of whatever is being shown, so the thing
      in question stays put while everything else grows around it.

      Up to 1.3, which is deliberately modest and is also the arithmetic
      limit below: a price field at 1.3 is comfortably readable and still
      leaves its row, its label and the rows either side in frame, which is
      what stops a close-up from hiding the context that makes the number
      mean something.
    */
    window.__filmZoom = ({ y, scale }) => {
      const root = document.getElementById('root');
      if (!root) return;
      root.style.transition = 'transform .7s cubic-bezier(.4,0,.2,1)';
      if (scale === 1 || y === null) {
        root.style.transform = '';
        return;
      }
      /*
        ── THE HORIZONTAL ORIGIN IS NOT NEGOTIABLE ────────────────────────

        A first cut put the origin on the centre of the element, both axes,
        and a 1.5× push on a price field slid the form's left column out of
        the picture — "בלי לחתוך מידע", which is the one thing a close-up
        must not do. So the origin's x is the middle of the app column and
        only the y follows the element: the card is 760 CSS px inside a 1000
        px column, so up to 1000/760 = 1.31× it grows symmetrically and every
        one of its edges stays in frame. Vertical cropping is all a zoom does
        here, and vertical cropping is what scrolling does anyway.

        Coordinates arrive in viewport pixels, measured by Playwright; the
        origin is read in the element's own unzoomed pixels, hence the divide.
      */
      const host = root.getBoundingClientRect();
      const capped = Math.min(scale, 1.3);
      root.style.transformOrigin = `${root.offsetWidth / 2}px ${(y - host.top) / zoom}px`;
      root.style.transform = `scale(${capped})`;
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
  [APP_W, PANEL_W, ZOOM],
);

const wait = (ms) => page.waitForTimeout(ms);

/**
 * Push in on one element; `zoomOut()` returns to the whole screen.
 *
 * The box is measured HERE, by Playwright, and only the centre point crosses
 * into the page — so a locator can use Playwright's own syntax and the
 * browser never has to parse it.
 */
const zoomTo = async (locator, scale = 1.25) => {
  const target = typeof locator === 'string' ? page.locator(locator) : locator;
  const box = await target.first().boundingBox().catch(() => null);
  if (!box) return false;
  await page.evaluate((a) => window.__filmZoom?.(a), {
    y: box.y + box.height / 2,
    scale,
  });
  await wait(800);
  return true;
};
const zoomOut = async () => {
  await page.evaluate((a) => window.__filmZoom?.(a), { y: null, scale: 1 });
  await wait(750);
};

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

/*
  ── A CONTROL THE WORDS DEPEND ON IS NOT OPTIONAL ─────────────────────────

  The price scene used to look for the save button by the text ON it —
  /שמירה|עדכון/ — inside an `if (count > 0)`. The button's accessible name is
  its aria-label, "שמירת חומר הגלם", which matches neither: the count was
  zero, the `if` skipped the click in silence, and the caption that follows
  it announced a saved price over an edit form that had never been saved.
  Found by pulling that frame out of the take and reading it.

  So anything a caption asserts is fetched through here, and a build that
  does not have it fails the take instead of narrating over it.
*/
async function need(locator, what) {
  const found = locator.first();
  if ((await found.count()) === 0) {
    throw new Error(`the film needs ${what}, and this build has none`);
  }
  return found;
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
/*
  ── THE FILM'S PAGE DOES NOT SCROLL; THE APPLICATION INSIDE IT DOES ────────

  `html` and `body` are `overflow: hidden` in the film page, and that stops a
  PERSON scrolling them — it does not stop the browser. When a save moves
  focus, Chromium scrolls the nearest scrollable ancestor to reveal the
  focused thing, and that ancestor is the document: measured at 400px after
  the wizard's save, which put the top of a recipe's photograph 293px above
  the frame while the caption said the photograph opens at the top of the
  page.

  So the document is pinned back to zero before every caption. Nothing the
  application does is affected — its own scroller is untouched.
*/
const pinPage = () =>
  page.evaluate(() => {
    const doc = document.scrollingElement;
    if (doc && doc.scrollTop !== 0) doc.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
  });

/** Back to the top of the screen — both scrollers, in one step. */
async function toTop() {
  await page.evaluate(() => {
    const main = document.querySelector('main[class*="content"]');
    if (main) main.scrollTop = 0;
    const doc = document.scrollingElement;
    if (doc) doc.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  await wait(500);
}

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
  /* ══ OPENING ═══════════════════════════════════════════════════════════
     Ahmed asked the opening to say who this is for and what it is worth,
     "בהתאם ליכולות שמודגמות בפועל" — so every claim below is demonstrated
     later in the film and nothing else is claimed. */
  await go('/home', /^בית$/);
  await say('מחברת מתכונים', { chapter: 'פתיחה', kind: 'title' });
  await say(
    'מערכת עבודה לקונדיטוריה מקצועית — לקונדיטור עצמאי, למאפייה ולבית ספר לקונדיטוריה.',
  );
  await say(
    'מתכון אחד שמחושב נכון בכל כמות: עלות אמיתית, המרות לפי הכלים של המטבח, ותהליך הכנה לצד התנור.',
  );
  await say('מה שרואים כאן הוא האפליקציה עצמה. כל לחיצה, הקלדה ושמירה מתרחשות באמת.');

  /* ══ א. HOME AND NAVIGATION ════════════════════════════════════════════ */
  /*
    ── A CHAPTER CARD COMES AFTER ITS SCREEN, NOT BEFORE IT ────────────────

    The first cut announced each chapter and THEN navigated, which put
    "שאר המערכת" in the panel for three and a half seconds while the food
    cost from the previous chapter was still on the left — measured by
    pulling that exact frame out of the take. Ahmed: "ודא שכל משפט נשמע בזמן
    שהכיתובית והפעולה שלו על המסך". So the screen arrives first and the title
    names what is already there.
  */
  await say('הבית והניווט', { chapter: 'א. הבית והניווט', kind: 'title' });
  await say('הבית פותח את יום העבודה: חיפוש, כניסות מהירות, וחזרה למה שהופסק באמצע.');
  await scroll(320);
  await say('הכניסות המהירות מובילות למחברת, לחומרי הגלם, לכלי המדידה, לקבוצות ולתכנון הייצור.');
  await scroll(360);
  await say('הקטגוריות מציגות כמה מתכונים יש בכל אחת, ומתכוני הבסיס מציגים את העלות לקילוגרם.');
  await scroll(-680, 10);
  await say('פס הניווט התחתון מחלק את המערכת לארבעה אזורים: בית, מחברת, קבוצות ועוד.');

  /* ══ ב. THE NOTEBOOK ═══════════════════════════════════════════════════ */
  await tap(page.locator('nav[aria-label="ניווט ראשי"] a[href="/notebook"]'));
  await expectScreen(/מחברת מתכונים/, 'the notebook tab');
  await say('מחברת המתכונים', { chapter: 'ב. המחברת', kind: 'title' });
  await say('המחברת מרכזת את כל המתכונים: תמונה, קטגוריה, תשואה ומשקל ליחידה.');

  await say('סינון לפי קטגוריה. הסינון נשמר, כך שחזרה לרשימה מחזירה אותה כפי שהייתה.', {
    hold: false,
  });
  await tap(page.getByRole('button', { name: 'בצקים', exact: true }));
  await wait(2200);
  await say('שלושה מתכוני בצקים.');
  await tap(page.getByRole('button', { name: 'הכל', exact: true }));

  await say('החיפוש סורק שמות, תגיות ורכיבים — ולא רק את שם המתכון.', { hold: false });
  await write(page.locator('#nb-search'), 'קרם');
  await wait(2600);
  await write(page.locator('#nb-search'), '');
  await wait(500);

  /* ══ ג. CREATING A RECIPE ══════════════════════════════════════════════ */
  await tap(page.getByRole('link', { name: 'מתכון חדש' }));
  await expectScreen(/מתכון חדש/, 'the editor');
  await say('יצירת מתכון', { chapter: 'ג. יצירת מתכון', kind: 'title' });
  await say('אשף בארבעה שלבים. שלב ראשון: שם, קטגוריה ותגיות.', { hold: false });
  await write(page.getByLabel('שם המתכון'), 'טארט לימון מרנג');
  await tap(page.locator('#r-category'), { settle: 300 });
  await page.selectOption('#r-category', { label: 'עוגות ועוגיות' }).catch(() => {});
  await wait(900);
  await say('הקטגוריה נבחרת מתוך הקטגוריות של המערכת.');
  await scroll(420);
  /*
    ── A REAL PHOTOGRAPH, THROUGH THE REAL INPUT ───────────────────────────

    The caption used to say a photo can be chosen here while nothing was
    chosen, and the recipe screen a minute later said "תמונת המתכון נפתחת
    בראש הדף" over a screen with no photograph on it — the demo repository
    seeds none. Caught by pulling the frame and looking at it.

    So the film picks one, through the product's own file input: the browser
    converts it to WebP and the first save uploads it, exactly as it would on
    a phone. Nothing here is staged — if the conversion or the save broke,
    the recording would show a recipe with no picture.
  */
  const photoInput = await need(
    page.locator('input[type="file"][accept="image/*"]'),
    "the editor's photo input",
  );
  {
    await photoInput.setInputFiles(
      /* The cream photograph, because the recipe being typed is a lemon
         meringue tart and the dough one would have been a picture of
         something else. */
      path.join(ROOT, 'apps', 'web', 'src', 'assets', 'categories', 'creams-640.webp'),
    );
  }
  await say('אפשר לבחור תמונה כבר בשלב הזה. במתכון חדש היא נשמרת יחד עם השמירה הראשונה.');

  await tap(page.getByRole('button', { name: /^שלב 2 / }));
  await say('שלב שני: חומרי הגלם. שם, כמות ויחידת מידה לכל שורה.', { hold: false });
  await write(page.getByLabel('שם הרכיב בשורה 1'), 'חמאה 82%');
  await write(page.getByLabel('כמות של חמאה 82%'), '180');
  await tap(page.getByRole('button', { name: 'הוספת רכיב' }));
  await write(page.getByLabel('שם הרכיב בשורה 2'), 'סוכר');
  await write(page.getByLabel('כמות של סוכר'), '150');
  await tap(page.getByRole('button', { name: 'הוספת רכיב' }));
  await write(page.getByLabel('שם הרכיב בשורה 3'), 'ביצים');
  await write(page.getByLabel('כמות של ביצים'), '4');
  await scroll(320);
  await say('המערכת מחשבת תוך כדי הקלדה: משקל כולל, ומה חסר כדי שהחישוב יהיה מלא.');

  await tap(page.getByRole('button', { name: /^שלב 3 / }));
  await say('שלב שלישי: אופן ההכנה — שלבים, זמנים וטמפרטורות.', { hold: false });
  const step1 = page.getByLabel(/הוראה בשלב 1/).first();
  if ((await step1.count()) > 0) {
    await write(step1, 'להקציף חמאה וסוכר עד בהיר ואוורירי.', { delay: 32 });
  }
  await wait(1200);

  await tap(page.getByRole('button', { name: /^שלב 4 / }));
  await say('שלב רביעי: סיכום לפני שמירה.');
  await tap(page.getByRole('button', { name: /שמירת ה(מתכון|שינויים)/ }), { settle: 1800 });
  await expectScreen(/טארט לימון מרנג/, 'the saved recipe');
  await say('המתכון נשמר ונפתח, עם כל מה שהוקלד בו.');
  /* The next line is about the photograph at the top of the page, and the
     save has just scrolled the page 400px down (see pinPage). Saying it over
     a cropped photograph is the kind of small dishonesty this film is not
     allowed. */
  await toTop();
  await say('התמונה שנבחרה הומרה, נשמרה ונפתחת בראש הדף, בגובה קבוע ובלי עיוות.');

  const focusBtn = page.getByRole('button', { name: 'התאמת מיקום התמונה' });
  if ((await focusBtn.count()) > 0) {
    await say('מי שמורשה לערוך יכול לקבוע איזו נקודה בתמונה תישאר במרכז.', { hold: false });
    await tap(focusBtn);
    const band = page.getByRole('button', {
      name: 'בחירת מיקום התמונה — לחיצה על הנקודה שתישאר במרכז',
    });
    const box = await band.boundingBox();
    if (box) {
      await point(box.x + box.width * 0.3, box.y + box.height * 0.28);
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.28);
      await wait(1200);
      await tap(page.getByRole('button', { name: 'שמירת המיקום' }), { settle: 1400 });
      await say('הנקודה שנבחרה נשמרת יחד עם התמונה.');
    }
  }
  await scroll(360);
  await wait(900);
  await scroll(-360, 8);

  /* ══ ד. WORKING WITH A RECIPE ══════════════════════════════════════════ */
  await go('/recipe/brioche', /בריוש נאנטר/);
  await say('עבודה עם מתכון', { chapter: 'ד. עבודה עם מתכון', kind: 'title' });

  await scroll(300);
  await say('כמה להכין: לפי מספר יחידות, לפי משקל סופי, או לפי המלאי שקיים בפועל.', {
    hold: false,
  });
  await tap(page.getByRole('button', { name: 'יחידות', exact: true }));
  const units = page.locator('input[inputmode="decimal"], input[type="number"]').first();
  if ((await units.count()) > 0) {
    await write(units, '24', { delay: 130 });
    await wait(900);
    await say('כל הכמויות במתכון מחושבות מחדש, יחד עם המשקל הכולל ומשקל היחידה.');
  }
  await scroll(360);
  await say('לכל שורה יש המרה — מגרמים לכוסות ובחזרה — לפי הכלים שנמדדו במערכת.', {
    hold: false,
  });
  /*
    The whole ingredient row is the button, and its accessible name is the
    row read out — "500 גר' קמח לחם 13% חלבון המר" — so /^המר/ matched
    nothing and the sheet never opened under a caption describing it. The
    flour row by name, and then the sheet itself, checked.
  */
  await tap(await need(page.getByRole('button', { name: /קמח לחם/ }), 'the flour row'));
  await need(page.getByRole('dialog', { name: 'המרת יחידה' }), 'the conversion sheet');
  await wait(2200);
  await scroll(420);
  await say('העלויות מחושבות לכל שורה, לכל האצווה, ליחידה ולקילוגרם.');
  await scroll(420);
  await say('האלרגנים נאספים אוטומטית מחומרי הגלם של המתכון.');
  await scroll(520);
  await say('ההערה האישית נשארת פרטית, ואינה חלק מהמתכון שמשותף עם אחרים.');

  /* ══ ה. THE FULL PREPARATION ═══════════════════════════════════════════ */
  await go('/recipe/brioche', /בריוש נאנטר/);
  await say('מצב הכנה', { chapter: 'ה. מצב הכנה', kind: 'title' });
  await scroll(240);
  await tap(page.getByRole('link', { name: 'מצב הכנה' }), { settle: 1600 });
  await expectScreen(/הכנת חומרי גלם/, 'cook mode');
  await say('מיז אן פלאס: כל חומרי הגלם בכמות של ההכנה הזאת, לשקילה ולסימון לפני שמתחילים.');
  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < Math.min(3, n); i += 1) {
    await tap(boxes.nth(i), { settle: 340 });
  }
  await say('המסך סופר כמה נותרו, ומאפשר להתחיל גם לפני שהכול סומן.');
  for (let i = 3; i < n; i += 1) {
    await tap(boxes.nth(i), { settle: 240 });
  }
  await say('הכול מוכן.');
  await tap(page.getByRole('button', { name: /מתחילים בהכנה/ }), { settle: 1600 });
  await say('שלבי העבודה מופיעים אחד בכל פעם, בטקסט גדול שנקרא מרחוק.');
  const timer = page.getByRole('button', { name: /טיימר|דקות/ }).first();
  if ((await timer.count()) > 0) {
    await tap(timer, { settle: 1400 });
    await say('טיימר לשלב, לפי הזמן שנרשם במתכון.');
  }
  await tap(page.getByRole('button', { name: 'הבא' }), { settle: 1000 });
  await tap(page.getByRole('button', { name: 'הבא' }), { settle: 1000 });
  await say('ההתקדמות נשמרת על המכשיר. אפשר לצאת ולחזור.', { hold: false });
  await tap(page.getByRole('button', { name: 'יציאה' }), { settle: 1400 });
  await scroll(240);
  await tap(page.getByRole('link', { name: 'מצב הכנה' }), { settle: 1700 });
  await say('החזרה ממשיכה מהשלב שבו ההכנה נעצרה.');

  /* ══ ו. INGREDIENTS AND COSTS ══════════════════════════════════════════
     REBUILT, because the first cut's words and its actions disagreed. It
     typed 52 into the PACKAGE COUNT field while the caption spoke about a
     price per kilogram, and the arithmetic in that caption was wrong as
     well. The fixture is 10 packages of 1 kg for 340 — 34 a kilogram — so
     the demonstration is now a supplier raising that total to 420, which is
     42 a kilogram, and the recipe's costs following it. */
  /*
    ── WHAT THE CENTRE ACTUALLY MOVES, AND WHAT IT DOES NOT ───────────────

    This scene was written to show a supplier's price changing and the
    recipe's cost following it. Then the check below — read the recipe's
    raw-material cost before and after — reported 19.21 → 19.21, twice, and
    the reason turned out to be by design rather than broken:

      · `features/pricing/catalog.ts`: a recipe row with a price OF ITS OWN
        keeps it. The centre is the source only for rows that have none.
      · every row in the demo data carries its own price — the brioche's
        butter says 38 a kilogram while the centre says 34 — so nothing in
        this dataset inherits, and nothing follows the centre.

    Ahmed's rule for exactly this case is "אם מתגלה באג בחישוב... תעד אותו
    והצג את הבעיה לפני שאתה משנה": so the calculation is untouched, the
    finding is written up for him, and the film says what is true instead of
    what the scene was hoping for. The price change in the centre is real and
    checked; the sentence about recipes states the rule rather than claiming
    a movement the viewer cannot see.
  */
  const openFoodCost = async () => {
    const summary = await need(
      page.locator('summary', { hasText: 'פרטים מקצועיים' }),
      'the professional-details disclosure',
    );
    await tap(summary, { settle: 1000 });
    const panel = await need(page.locator('[aria-label="פוד קוסט"]'), 'the food-cost panel');
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    await wait(600);
    return panel;
  };
  await go('/ingredients', /^חומרי גלם$/);
  await say('חומרי גלם ועלויות', { chapter: 'ו. חומרי גלם ועלויות', kind: 'title' });
  await say('מרכז חומרי הגלם: מחיר אחד לכל חומר, במקום אחד.');
  await say('בכל מסך פנימי יש חזרה, שמחזירה למסך הקודם.');
  await scroll(240);

  const butter = await need(page.locator('li', { hasText: 'חמאה 82%' }), 'the butter row');
  await butter.scrollIntoViewIfNeeded().catch(() => {});
  await zoomTo(butter, 1.3);
  await say('חמאה: עשר חבילות של קילוגרם, בשלוש מאות וארבעים שקלים. שלושים וארבעה שקלים לקילוגרם.');
  await zoomOut();

  await tap(await need(page.getByRole('button', { name: /^עריכת חמאה/ }), 'the edit button'), {
    settle: 900,
  });
  await say('הספק העלה מחיר. אותן עשר חבילות עולות עכשיו ארבע מאות ועשרים שקלים.', {
    hold: false,
  });
  /* The TOTAL PAID field, by its id — not "the first decimal input", which is
     how the first cut ended up editing the package count. */
  const total = await need(page.locator('#ic-total'), 'the total-paid field');
  await total.scrollIntoViewIfNeeded().catch(() => {});
  await zoomTo('#ic-total', 1.3);
  await write(total, '420', { delay: 180 });
  await wait(1800);
  await zoomOut();
  /* By the accessible name, which is the aria-label and not the word on the
     button — see `need`. */
  await tap(await need(page.getByRole('button', { name: 'שמירת חומר הגלם' }), 'the save button'), {
    settle: 1500,
  });

  /*
    THE SAVE EITHER HAPPENED OR THE FILM DOES NOT GET TO SAY IT DID.

    The row's own text is the evidence: thirty-four a kilogram before, forty-
    two after. Reading it back here is what turns the next caption from a
    claim into a description.
  */
  const updated = await need(page.locator('li', { hasText: 'חמאה 82%' }), 'the butter row');
  const rowText = (await updated.textContent()) ?? '';
  if (!/42[.,]00/.test(rowText)) {
    throw new Error(`the butter row still reads «${rowText.replace(/\s+/g, ' ').trim()}»`);
  }
  await zoomTo(updated, 1.3);
  await say('המחיר לקילוגרם עלה משלושים וארבעה לארבעים ושניים שקלים.');
  await zoomOut();

  /*
    ── THIS ONE NAVIGATION IS BY HAND, AND IT HAS TO BE ────────────────────

    `go()` loads the page again, and the demo repository lives in the
    bundle's memory: a reload puts every fixture back to its opening state.
    So the first cut of this scene saved a new butter price, reloaded into
    the recipe, and showed the OLD cost under a caption saying costs follow
    the new price — 19.21 before and 19.21 after, caught by the check below
    rather than by me watching it.

    Walking there through the tab bar is what a person does anyway, and it
    keeps the change that was just saved.
  */
  await tap(page.locator('nav[aria-label="ניווט ראשי"] a[href="/notebook"]'), { settle: 900 });
  await expectScreen(/מחברת מתכונים/, 'the notebook tab');
  await tap(page.getByRole('link', { name: /בריוש נאנטר/ }).first(), { settle: 1400 });
  await expectScreen(/בריוש נאנטר/, 'the brioche');
  await say('מחיר במרכז הוא המקור לכל שורת מתכון שלא הוזן בה מחיר משלה.', { hold: false });
  const foodCost = await openFoodCost();
  await zoomTo(foodCost, 1.3);
  /* Named for what is actually on the panel. An earlier caption ended with
     "ואחוז פוד קוסט", and the row beside it reads "—" with a note saying it
     cannot be worked out until a selling price is set. */
  await say('ובמתכון: עלות חומרי הגלם, עלות לקילוגרם ועלות ליחידה, מחושבות שורה אחר שורה.');
  await zoomOut();

  /* ══ ז. EVERY OTHER SCREEN ═════════════════════════════════════════════ */
  await go('/recipe/brioche/order', /פרטי ההזמנה/);
  await say('שאר המערכת', { chapter: 'ז. שאר המערכת', kind: 'title' });
  await say('דף הזמנה: מה להזמין לאצווה הזאת, בכמויות ובעלויות, מוכן להדפסה.');
  await scroll(420);
  await wait(1200);

  await go('/recipe/brioche/label', /בריוש נאנטר/);
  await say('תווית מוצר: רכיבים לפי סדר יורד, אלרגנים ומשקל.');

  await go('/tools', /כלי המדידה/);
  await say('כלי המדידה: הכוס והכף של המטבח הזה נמדדות פעם אחת.');
  await scroll(260);
  await say('כל המרה במערכת מחושבת לפי הכלים האלה, ולא לפי תקן כללי.');

  await go('/plans', /תכנון ייצור/);
  await say('תכנון ייצור: יום עבודה עם כמה מתכונים, ורשימת רכש אחת.');
  await tap(page.getByRole('link', { name: /יום ייצור/ }).first(), { settle: 1500 });
  await expectScreen(/יום ייצור/, 'one plan');
  await scroll(360);
  /* The purchase list is behind its own disclosure. Without this tap the
     caption below described it over the plan's recipe rows — the screen was
     showing targets per recipe, not a purchase list at all. */
  await tap(
    await need(
      page.getByRole('button', { name: /רשימת רכש ועלות צפויה/ }),
      'the purchase-list disclosure',
    ),
    { settle: 1000 },
  );
  const purchase = await need(page.locator('[aria-label="רשימת רכש"]'), 'the purchase list');
  await purchase.scrollIntoViewIfNeeded().catch(() => {});
  await wait(600);
  await say('רשימת הרכש מסכמת את חומרי הגלם של כל היום, ומסמנת מה שאין לו מחיר.');
  await scroll(420);
  await wait(1200);

  await go('/groups', /קבוצות וקורסים/);
  await say(
    'קבוצות וקורסים. המסכים וכללי ההרשאות הם קוד אמיתי, ובהדגמה הזאת הם רצים מקומית — בלי שרת ובלי משתמשים אחרים.',
  );
  await tap(page.getByRole('link', { name: /קורס קונדיטוריה/ }).first(), { settle: 1500 });
  await expectScreen(/קורס קונדיטוריה/, 'the course');
  await say('קורס עם שיעורים ועם המתכונים שהמדריך פרסם לתלמידים.');
  await tap(page.getByRole('tab', { name: /צ׳אט/ }), { settle: 1400 });
  await say('צ׳אט הקבוצה. בהדגמה מקומית ההודעה נשמרת במסך הזה בלבד, ואינה נשלחת לאיש.', {
    hold: false,
  });
  await write(page.locator('#chat-draft'), 'איזו חמאה להביא מחר?', { delay: 42 });
  await tap(page.getByRole('button', { name: 'שליחה' }), { settle: 1200 });
  await say('ההודעה מופיעה בשיחה.');

  await go('/group/group-team/perms', /חברים והרשאות/);
  await say('חברים והרשאות: תפקידים, דרגות, ומי רשאי לעשות מה בכל מתכון.');
  await scroll(420);
  await wait(1400);

  await go('/settings', /^הגדרות$/);
  await say('הגדרות: פרופיל עבודה, שפה וכיול הכלים.');
  await scroll(360);
  await wait(1200);

  await go('/more', /^עוד$/);
  await say('המסך ״עוד״ מרכז את כל מה שאינו מתכון.');

  /* ══ CLOSING ═══════════════════════════════════════════════════════════
     The demo-environment note first, plainly, and the value line after it —
     in that order, which is the order Ahmed asked for. */
  await go('/home', /^בית$/);
  await say('סביבת ההדגמה', { chapter: 'סיום', kind: 'title' });
  await say(
    'נתוני דוגמה, בלי שרת ובלי חשבון. המתכונים, החישובים, ההמרות, העלויות ומצב ההכנה פועלים כאן במלואם.',
  );
  await say(
    'הקבוצות והצ׳אט רצים מקומית בלבד. אין בהדגמה הזאת סנכרון בענן ואין עבודה משותפת בין משתמשים.',
  );
  await say('מתכון אחד שמחושב נכון בכל כמות — מהרעיון, דרך העלות, ועד ההכנה במטבח.', {
    kind: 'title',
  });
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
