// THE KITCHEN SCREEN, MEASURED IN A BROWSER.
//
// Four things the unit tests cannot see, because they need layout, a real
// viewport and a real Fullscreen API:
//
//   1. THE LAST CARD IS WHOLE. At the bottom of the weighing list, the last
//      row's name, weight and checkbox are all inside the viewport and
//      nothing — bar, button or layer — is painted over them. This is the
//      defect Ahmed reported: a 24px wash of the surface colour, from the
//      pinned bar's box-shadow, dissolving the bottom of the last card.
//   2. LANDSCAPE. Turned on its side on a short screen, one step is shown,
//      the instruction gets the room, the numeral shrinks, and "הבא" and
//      "הקודם" stay large.
//   3. FULLSCREEN, HONESTLY. The control enters the focused mode; where a
//      real fullscreen is refused (an artifact page is an iframe without the
//      permission) the screen says so instead of claiming otherwise.
//   4. NOTHING IS LOST. Rotating the device and entering or leaving the mode
//      keep the step, the ticks and a running timer — and never start a
//      second one.
//
//   node artifact/scripts/fullscreen.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(process.env['PAGE'] ?? path.join(HERE, '..', 'app-page.html'), 'utf8');
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0;font:14px -apple-system,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`${HEAD}${PAGE}</body></html>`);
  }
  const file = path.join(DIST, url);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('no');
  }
  res.writeHead(200, {
    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8161, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8161/index.html';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

/** A recipe with enough rows that the list must scroll on a phone. */
const LONG = '/recipe/brioche/cook';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    r.request().url().startsWith('http://127.0.0.1:8161') ? r.continue() : r.abort(),
  );

  // ── 1. the last card, at the bottom of the scroll ──────────────────────
  await page.goto(`${BASE}?f=${Date.now()}#${LONG}`, { waitUntil: 'load' });
  await page.waitForTimeout(1300);

  const rows = page.locator('section[aria-label="הכנת חומרי גלם"] li');
  const n = await rows.count();
  check('the weighing list has the recipe\'s own rows', n >= 5, `${n} rows`);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);

  const last = await page.evaluate(() => {
    const items = [...document.querySelectorAll('section[aria-label="הכנת חומרי גלם"] li')];
    const el = items.at(-1);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const box = el.querySelector('input[type="checkbox"]')?.getBoundingClientRect() ?? null;
    const bar = document.querySelector('[class*="gateBar"]')?.getBoundingClientRect() ?? null;
    /*
      WHAT IS ACTUALLY ON TOP OF IT.

      `elementFromPoint` at the card's own corners answers the question the
      shadow made ambiguous: if anything else is painted there, this returns
      that element instead of the card.
      */
    const corner = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit ? (el.contains(hit) ? 'self' : `${hit.tagName}.${String(hit.className).slice(0, 24)}`) : 'none';
    };
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewport: document.documentElement.clientHeight,
      barTop: bar ? Math.round(bar.top) : null,
      boxBottom: box ? Math.round(box.bottom) : null,
      atBottomLeft: corner(r.left + 6, r.bottom - 6),
      atBottomRight: corner(r.right - 6, r.bottom - 6),
      // The fade, if it came back: a shadow on the bar itself.
      barShadow: bar
        ? getComputedStyle(document.querySelector('[class*="gateBar"]')).boxShadow
        : 'none',
    };
  });

  check(
    'the last card is fully inside the viewport at the end of the scroll',
    last !== null && last.bottom <= last.viewport + 1 && last.top >= 0,
    last ? `${last.top}–${last.bottom} of ${last.viewport}` : 'no rows',
  );
  check(
    'the pinned bar starts BELOW the last card, not over it',
    last !== null && last.barTop !== null && last.bottom <= last.barTop + 1,
    last ? `card ends ${last.bottom}, bar starts ${last.barTop}` : '',
  );
  check(
    'nothing is painted over the bottom corners of the last card',
    last !== null && last.atBottomLeft === 'self' && last.atBottomRight === 'self',
    last ? `${last.atBottomLeft} · ${last.atBottomRight}` : '',
  );
  check(
    'and the bar carries no shadow to wash over the list',
    last !== null && last.barShadow === 'none',
    last?.barShadow ?? '',
  );
  check(
    'the last checkbox is inside the viewport too',
    last !== null && last.boxBottom !== null && last.boxBottom <= last.viewport,
    last ? `checkbox ends ${last.boxBottom}` : '',
  );

  /*
    A SHORT LIST, MEASURED AT THE SAME MOMENT.
    The bar sits at the end of the sheet (margin-block-start: auto), so on a
    list that does not fill the screen it rests at the bottom of the viewport
    and a gap above it is correct, not a defect. What must hold on BOTH list
    lengths is the same thing: at the end of the scroll the last card is whole
    inside the viewport and nothing is painted over it. So measure it the way
    the long list is measured — after scrolling to the end.
  */
  await page.goto(`${BASE}?f=${Date.now()}#/recipe/pastrycream/cook`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const short = await page.evaluate(() => {
    const items = [...document.querySelectorAll('section[aria-label="הכנת חומרי גלם"] li')];
    const el = items.at(-1);
    const bar = document.querySelector('[class*="gateBar"]');
    if (!el || !bar) return null;
    const r = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const corner = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit ? (el.contains(hit) ? 'self' : `${hit.tagName}.${String(hit.className).slice(0, 24)}`) : 'none';
    };
    return {
      rows: items.length,
      gap: Math.round(b.top - r.bottom),
      bottom: Math.round(r.bottom),
      viewport: document.documentElement.clientHeight,
      atBottomLeft: corner(r.left + 6, r.bottom - 6),
      atBottomRight: corner(r.right - 6, r.bottom - 6),
      scrolls: document.body.scrollHeight > document.documentElement.clientHeight + 1,
    };
  });
  check(
    'a short list ends with its last card whole inside the viewport too',
    short !== null && short.bottom <= short.viewport + 1,
    short ? `${short.rows} rows, card ends ${short.bottom} of ${short.viewport}, scrolls: ${short.scrolls}` : '',
  );
  check(
    'and the bar stays below it there as well, painting nothing over it',
    short !== null && short.gap >= 0 && short.atBottomLeft === 'self' && short.atBottomRight === 'self',
    short ? `${short.gap}px below the card · ${short.atBottomLeft} · ${short.atBottomRight}` : '',
  );

  // ── 2 & 3. fullscreen, and what it honestly did ────────────────────────
  await page.goto(`${BASE}?f=${Date.now()}#${LONG}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const fsBtn = page.getByRole('button', { name: 'מסך מלא' });
  check('the weighing stage offers "מסך מלא"', (await fsBtn.count()) === 1);
  await fsBtn.click();
  await page.waitForTimeout(400);

  const afterEnter = await page.evaluate(() => ({
    pressed: document
      .querySelector('[class*="fsBtn"]')
      ?.getAttribute('aria-pressed'),
    label: document.querySelector('[class*="fsBtn"]')?.textContent?.trim(),
    focusClass: /focus/.test(document.querySelector('[class*="wrap"]')?.className ?? ''),
    real: document.fullscreenElement !== null,
    note: document.querySelector('[class*="fsNote"]')?.textContent?.trim() ?? null,
    stillCooking: document.querySelector('section[aria-label="הכנת חומרי גלם"]') !== null,
  }));
  check('pressing it turns the focused mode on', afterEnter.focusClass === true && afterEnter.pressed === 'true');
  check('and the control now offers the way out', afterEnter.label === 'יציאה ממסך מלא');
  check('it did not leave Cook Mode', afterEnter.stillCooking === true);
  /*
    An artifact page is an iframe without `allow="fullscreen"`, so a REAL
    fullscreen is refused here. The requirement is not that it succeeds — it
    is that the screen does not claim it did.
  */
  check(
    afterEnter.real
      ? 'a real fullscreen was granted'
      : 'a refused fullscreen is stated, not faked',
    afterEnter.real === true || (afterEnter.note !== null && afterEnter.note.includes('אינו זמין')),
    afterEnter.real ? 'real' : `note: ${afterEnter.note ?? 'MISSING'}`,
  );

  await page.getByRole('button', { name: 'יציאה ממסך מלא' }).click();
  await page.waitForTimeout(300);
  check(
    'leaving it returns to the normal screen, still in Cook Mode',
    (await page.getByRole('button', { name: 'מסך מלא' }).count()) === 1 &&
      (await page.locator('section[aria-label="הכנת חומרי גלם"]').count()) === 1,
  );

  // ── 4. landscape, and nothing lost on rotation ─────────────────────────
  // Into the steps, with a timer running and a step marked.
  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).click();
  await page.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }).click();
  await page.waitForTimeout(500);

  const timerBtn = page.getByRole('button', { name: /טיימר/ }).first();
  if (await timerBtn.count()) {
    await timerBtn.click();
    await page.waitForTimeout(500);
  }
  const before = await page.evaluate(() => ({
    step: document.querySelector('[class*="stepNum"]')?.textContent?.trim(),
    progress: document.querySelector('[role="status"]')?.textContent?.trim(),
    timers: document.querySelectorAll('section[aria-label="טיימרים"] [class*="timerClock"]').length,
    clock: document.querySelector('section[aria-label="טיימרים"] [class*="timerClock"]')?.textContent?.trim() ?? null,
  }));

  // The phone goes on its side. Nothing is rotated by CSS — the viewport is.
  await page.setViewportSize({ width: 720, height: 402 });
  await page.waitForTimeout(600);

  const land = await page.evaluate(() => {
    const num = document.querySelector('[class*="stepNum"]');
    const text = document.querySelector('[class*="stepText"]');
    const nav = [...document.querySelectorAll('nav[aria-label="ניווט בין שלבים"] button')];
    const de = document.documentElement;
    return {
      step: num?.textContent?.trim(),
      numPx: num ? Math.round(parseFloat(getComputedStyle(num).fontSize)) : null,
      textPx: text ? Math.round(parseFloat(getComputedStyle(text).fontSize)) : null,
      navHeights: nav.map((b) => Math.round(b.getBoundingClientRect().height)),
      overflowX: de.scrollWidth - de.clientWidth,
      progress: document.querySelector('[role="status"]')?.textContent?.trim(),
      timers: document.querySelectorAll('section[aria-label="טיימרים"] [class*="timerClock"]').length,
      stepsVisible: document.querySelectorAll('[class*="stepText"]').length,
    };
  });

  check('one step at a time in landscape', land.stepsVisible === 1, `${land.stepsVisible} shown`);
  check('the numeral gives up the height', land.numPx !== null && land.numPx <= 32, `${land.numPx}px`);
  check(
    'the instruction keeps a readable size',
    land.textPx !== null && land.textPx >= 20,
    `${land.textPx}px`,
  );
  check(
    '"הבא" and "הקודם" stay large',
    land.navHeights.length >= 2 && land.navHeights.every((h) => h >= 44),
    land.navHeights.join(' / '),
  );
  check('no horizontal scroll in landscape', land.overflowX <= 1, `${land.overflowX}px`);
  check('the step survived the rotation', land.step === before.step, `${before.step} → ${land.step}`);
  check('so did the marks', land.progress === before.progress, `${before.progress} → ${land.progress}`);
  check(
    'and the timer kept running — exactly one of it',
    land.timers === before.timers,
    `${before.timers} → ${land.timers}`,
  );

  // Fullscreen in landscape, and back, with the same state.
  await page.getByRole('button', { name: 'מסך מלא' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'יציאה ממסך מלא' }).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    step: document.querySelector('[class*="stepNum"]')?.textContent?.trim(),
    progress: document.querySelector('[role="status"]')?.textContent?.trim(),
    timers: document.querySelectorAll('section[aria-label="טיימרים"] [class*="timerClock"]').length,
  }));
  check('entering and leaving the mode loses nothing', after.step === land.step && after.progress === land.progress);
  check('and does not start a second timer', after.timers === land.timers, `${land.timers} → ${after.timers}`);

  /*
    ── 5. A SHORT SCREEN STARTS EACH STAGE AT ITS TOP ────────────────────
    Held sideways, the weighing list is taller than the viewport, so the gate
    is pressed at the END of a scrolled page — and React keeps that scroll.
    Measured before the fix: the steps opened with the header (the way out and
    the fullscreen control) at -71..-27 in a 402px-tall viewport. Pressing
    "הבא" left the same page part-scrolled. Both are measured here from a
    landscape viewport, not from a rotation.
  */
  /* Its OWN context: this run already finished the weighing list for this
     recipe, and the screen restores that from IndexedDB — in a shared context
     the sideways page would open on the steps and there would be no gate to
     press. */
  const wideCtx = await browser.newContext({ viewport: { width: 874, height: 402 } });
  const wide = await wideCtx.newPage();
  await wide.route('**/*', (r) =>
    r.request().url().startsWith('http://127.0.0.1:8161') ? r.continue() : r.abort(),
  );
  await wide.goto(`${BASE}?f=${Date.now()}#${LONG}`, { waitUntil: 'load' });
  await wide.waitForTimeout(1300);
  const wboxes = wide.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const wcount = await wboxes.count();
  for (let i = 0; i < wcount; i += 1) if (!(await wboxes.nth(i).isChecked())) await wboxes.nth(i).click();
  const scrolledAtGate = await wide.evaluate(() => Math.round(window.scrollY));
  check('the weighing list really does scroll on a sideways phone', scrolledAtGate > 0, `${scrolledAtGate}px`);
  await wide.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }).click();
  await wide.waitForTimeout(600);
  const headAfterGate = await wide.evaluate(() => {
    const h = document.querySelector('header[class*="head"]');
    const r = h?.getBoundingClientRect();
    return { top: r ? Math.round(r.top) : null, y: Math.round(window.scrollY) };
  });
  check(
    'the steps open at their top, with the way out on screen',
    headAfterGate.top !== null && headAfterGate.top >= 0 && headAfterGate.y === 0,
    `header at ${headAfterGate.top}, scrollY ${headAfterGate.y}`,
  );
  await wide.evaluate(() => window.scrollTo(0, 200));
  await wide.getByRole('button', { name: 'הבא' }).click();
  await wide.waitForTimeout(500);
  const afterNext = await wide.evaluate(() => ({
    y: Math.round(window.scrollY),
    step: document.querySelector('[class*="stepNum"]')?.textContent?.trim(),
  }));
  check(
    'and so does the next step, from wherever the last one was read',
    afterNext.y === 0 && afterNext.step === '2',
    `scrollY ${afterNext.y}, step ${afterNext.step}`,
  );
  /*
    The two step buttons stay on screen on a short sideways screen — at the
    top of the page and at the end of it — and the bar does not paint over the
    content it is pinned under.
  */
  const foot = await wide.evaluate(() => {
    const read = () => {
      const nav = document.querySelector('nav[aria-label="ניווט בין שלבים"]');
      const r = nav?.getBoundingClientRect();
      const h = document.documentElement.clientHeight;
      return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= h + 1 } : null;
    };
    const atTop = read();
    window.scrollTo(0, document.body.scrollHeight);
    const atEnd = read();
    const bar = document.querySelector('nav[aria-label="ניווט בין שלבים"]');
    const shadow = bar ? getComputedStyle(bar).boxShadow : 'none';
    // Whatever sits directly above the bar must be the page, not hidden under it.
    const r = bar?.getBoundingClientRect();
    const above = r ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top - 4)) : null;
    return { atTop, atEnd, shadow, above: above ? `${above.tagName}.${String(above.className).slice(0, 20)}` : 'none' };
  });
  check(
    'the step buttons are on screen in landscape, at the top and at the end',
    foot.atTop?.inView === true && foot.atEnd?.inView === true,
    `top ${foot.atTop?.top}..${foot.atTop?.bottom} · end ${foot.atEnd?.top}..${foot.atEnd?.bottom}`,
  );
  check(
    'and the pinned bar draws an edge rather than a shadow over the page',
    foot.shadow === 'none',
    `${foot.shadow} · above it: ${foot.above}`,
  );

  await wideCtx.close();

  check('no page error in the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} kitchen-screen checks passed`);
  for (const f of failed) console.log(`  FAILED  ${f.label} -- ${f.detail}`);
  await browser.close();
  server.close();
  process.exitCode = failed.length === 0 ? 0 : 1;
}
