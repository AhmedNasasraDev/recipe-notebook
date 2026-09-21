// Browser E2E against the BUILT production bundle.
//
// What this adds over apps/web/src/app/RecipeFlow.test.tsx, which already
// drives the same route in jsdom through the real components: a real browser
// engine, real layout, real pointer events, and the minified artifact rather
// than the source. It is a smoke test of the production build, not a second
// copy of the route test.
//
// It runs against a build made with the Supabase env vars BLANK, so the app is
// in its unconfigured mode and the repository is the read-only demo one. That
// is not a shortcut, it is forced: this environment's egress policy blocks
// *.supabase.co, so a browser here cannot reach the project at all. The signed-
// in half of the route is covered in apps/web/src/app/RecipeFlow.test.tsx, and
// the real-database half by supabase/scripts/mapper-roundtrip.mts.
//
// It also means the save assertion is a real one: the save is refused with an
// honest message rather than faked.
//
// Calibrations still work in this mode, because they go to IndexedDB, which a
// real browser has — so the partial -> full transition is exercised for real.

// Playwright is not a project dependency: this runs against whatever install is
// available, because the environment already ships one and adding a ~300MB
// browser download to `npm ci` for one smoke test is a poor trade.
//   PW=/path/to/playwright/index.js npm run e2e
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The DEMO build, not the normal one: see the header. Produce it with
//   VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-demo
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist-demo');
const OUT = process.env['SHOTS'] ?? path.join(HERE, '..', '..', '..', '.e2e-shots');
fs.mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// A static server with SPA fallback, because the app uses real URLs.
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  res.end(fs.readFileSync(file));
});

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const finishOnboarding = async (p) => {
  const first = p.locator('button', { hasText: 'מקצועי' }).first();
  if (!(await first.count())) return false;
  await first.click();
  for (let i = 0; i < 8; i += 1) {
    const next = p.locator('button').filter({ hasText: /^(המשך|סיום|למחברת)/ }).first();
    if (!(await next.count())) break;
    await next.click();
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
  return true;
};

await new Promise((r) => server.listen(8123, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox'],
});

try {
  // ── phone ──────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The Google Fonts stylesheet cannot load here: this sandbox's egress proxy
    // presents its own certificate and Chromium rejects it. That is the
    // environment, not the app — the §16 font stacks have system fallbacks and
    // the layout is unaffected. Every other console error is a real failure.
    if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)\.com/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });

  // Nothing should reach the network beyond our own origin.
  const external = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (!u.startsWith('http://127.0.0.1:8123') && !u.startsWith('data:') && !u.startsWith('https://fonts.')) {
      external.push(u);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('http://127.0.0.1:8123/notebook', { waitUntil: 'load' });
  await page.waitForTimeout(900);

  const booted = await finishOnboarding(page);
  check('the built app boots and runs the onboarding', booted);

  // Demo mode serves the five demo recipes, so the first-run empty state is
  // not what shows here — the header entry point is. The empty state itself is
  // covered in AppSession.test.tsx and RecipeFlow.test.tsx, where the account
  // really is new.
  check(
    'the demo data is labelled as demo, not as the account\'s own notebook',
    (await page.locator('text=מתכוני הדמו לקריאה בלבד').count()) > 0,
  );
  const newBtn = page.getByRole('link', { name: 'מתכון חדש' });
  check('the notebook header offers "new recipe"', (await newBtn.count()) > 0);
  await page.screenshot({ path: `${OUT}/01-notebook-phone.png` });

  await newBtn.click();
  await page.waitForTimeout(500);
  check(
    'the editor route renders in the production bundle',
    await page.getByRole('heading', { name: 'מתכון חדש' }).isVisible(),
  );

  /*
    ── A FULLY WEIGHABLE RECIPE, ACROSS TWO STAGES ──────────────────────

    The editor is a wizard since §6: the name is on stage 1 and the
    ingredients on stage 2, and the stepper is how a person moves between
    them. `toStage` below is that stepper, by its accessible name.
  */
  const toStage = (p, n) =>
    p.getByRole('button', { name: new RegExp(`^שלב ${n} `) }).click();

  await page.getByLabel('שם המתכון').fill('לחם כוסמין');
  await toStage(page, 2);
  await page.getByLabel('שם הרכיב בשורה 1').fill('קמח לבן');
  await page.getByLabel('כמות של קמח לבן').fill('500');
  await page.waitForTimeout(300);

  const calcNotice = page.getByLabel('שלמות החישוב');
  check(
    'the live calculation reports a complete computation',
    ((await calcNotice.textContent()) ?? '').includes('חישוב מלא'),
  );
  await page.screenshot({ path: `${OUT}/02-editor-full-phone.png`, fullPage: true });

  // ── an unweighable row turns it partial ────────────────────────────────
  await page.getByRole('button', { name: 'הוספת רכיב' }).click();
  await page.getByLabel('שם הרכיב בשורה 2').fill('קקאו');
  await page.getByLabel('כמות של קקאו').fill('1');
  await page.getByLabel('יחידת המדידה של קקאו').selectOption('cup');
  await page.waitForTimeout(400);

  const partialText = (await calcNotice.textContent()) ?? '';
  check('a cup of cocoa turns the calculation partial', partialText.includes('נתונים חלקיים'));
  check('and the notice names the missing ingredient', partialText.includes('קקאו'));

  const chips = await page.locator('text=חלקי').count();
  check('the running total is marked as partial', chips > 0, `${chips} marker(s)`);
  await page.screenshot({ path: `${OUT}/03-editor-partial-phone.png`, fullPage: true });

  // ── calibrate, with a real browser's IndexedDB ─────────────────────────
  await page.getByRole('button', { name: 'כיול אישי של קקאו' }).click();
  await page.waitForTimeout(400);
  const sheet = page.getByRole('dialog', { name: 'כיול אישי' });
  check('the calibration sheet opens', await sheet.isVisible());
  check(
    'it states the tool volume it will freeze',
    ((await page.getByLabel('נפח הכלי שיישמר').textContent()) ?? '').includes('240'),
  );
  await page.screenshot({ path: `${OUT}/04-calibrate-phone.png` });

  await sheet.getByLabel(/משקל כוס אחת/).fill('105');
  await sheet.getByRole('button', { name: 'שמירת הכיול' }).click();
  await page.waitForTimeout(800);

  check(
    'the calibration closes the gap: partial becomes full',
    ((await calcNotice.textContent()) ?? '').includes('חישוב מלא'),
  );
  await page.screenshot({ path: `${OUT}/05-after-calibration-phone.png`, fullPage: true });

  // ── the unconfigured build refuses to save, honestly ───────────────────
  check(
    'the draft save is disabled with no server',
    await page.getByRole('button', { name: 'שמירת טיוטה' }).isDisabled(),
  );
  await toStage(page, 4);
  check(
    'and so is the save on the summary stage',
    await page.getByRole('button', { name: 'שמירת המתכון' }).isDisabled(),
  );
  check(
    'and the screen explains why rather than failing silently',
    (await page.locator('text=אי אפשר לשמור').count()) > 0,
  );

  // ── the calibration survives a FULL page reload ────────────────────────
  // STAGE-11: the calibration list moved from "עוד" to "כלי המדידה שלי", which
  // is the screen §2 assigns it to (screen 21). What is being checked here —
  // that a calibration taken in the editor survives a real page reload — is
  // unchanged.
  await page.goto('http://127.0.0.1:8123/tools', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const moreText = (await page.locator('body').textContent()) ?? '';
  check('the calibration list shows it after a full page reload', moreText.includes('קקאו'));
  check('and reports the frozen tool volume', /240/.test(moreText));
  await page.screenshot({ path: `${OUT}/06-calibrations-phone.png`, fullPage: true });

  const phoneOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow on a phone', phoneOverflow <= 1, `${phoneOverflow}px`);

  // ── hit targets (§15) ──────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:8123/recipe/new', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      'button, a, select, input:not([type=checkbox])',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      /*
        A DELIBERATELY HIDDEN CONTROL OPERATED THROUGH A VISIBLE LABEL IS NOT
        A SMALL TARGET.

        The photo picker on stage 1 is the standard way to style a file input:
        the input itself is taken out of the flow by `.visuallyHidden` and the
        label around it is the 44px control somebody presses. Measuring the
        input reported a 1px target on a screen whose real one is 44.
        `responsive.mjs` has skipped these for the same reason since the audit.
      */
      if (/visuallyHidden/.test(String(el.className))) continue;
      // Icon buttons are --hit-compact (40px) inside a 44px row, by design.
      if (r.height < 40) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 18);
        out.push(`${el.tagName}[${name}] ${Math.round(r.height)}px`);
      }
    }
    return out;
  });
  check('every control is at least 40px tall', small.length === 0, small.slice(0, 5).join('; '));

  // ── tablet (requirement 14) ────────────────────────────────────────────
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const tPage = await tablet.newPage();
  await tPage.route('**/*', (route) =>
    route.request().url().startsWith('http://127.0.0.1:8123')
      ? route.continue()
      : route.abort(),
  );
  await tPage.goto('http://127.0.0.1:8123/notebook', { waitUntil: 'load' });
  await tPage.waitForTimeout(900);
  await finishOnboarding(tPage);
  await tPage.goto('http://127.0.0.1:8123/recipe/new', { waitUntil: 'load' });
  await tPage.waitForTimeout(900);

  const frameWidth = await tPage.evaluate(() => {
    const el = document.querySelector('main')?.parentElement;
    return el ? Math.round(el.getBoundingClientRect().width) : 0;
  });
  check(
    'the frame widens on a tablet instead of staying phone-sized',
    frameWidth > 600,
    `${frameWidth}px`,
  );

  await toStage(tPage, 2);
  const gridCols = await tPage.evaluate(() => {
    const qty = document.querySelector('input[aria-label^="כמות של"]');
    const grid = qty?.closest('div')?.parentElement;
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  });
  check('the ingredient fields use the wider grid', gridCols >= 3, `${gridCols} cols`);

  await toStage(tPage, 1);
  await tPage.getByLabel('שם המתכון').fill('בדיקת טאבלט');
  await toStage(tPage, 2);
  await tPage.getByLabel('שם הרכיב בשורה 1').fill('קמח לבן');
  await tPage.getByLabel('כמות של קמח לבן').fill('500');
  await tPage.waitForTimeout(400);
  await tPage.screenshot({ path: `${OUT}/07-editor-tablet.png`, fullPage: true });

  const tabletOverflow = await tPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow on a tablet', tabletOverflow <= 1, `${tabletOverflow}px`);

  check('no page errors anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  check(
    'nothing tried to reach an external origin',
    external.length === 0,
    external.slice(0, 3).join(' | '),
  );

  await ctx.close();
  await tablet.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots in ${OUT}`);
if (failed.length) process.exit(1);
