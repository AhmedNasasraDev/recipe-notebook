// Browser E2E — §14 Mise en place, in a real browser, at two sizes.
//
// WHY THIS EXISTS ALONGSIDE THE SCREEN TESTS
//
// `routes/CookScreen.test.tsx` proves the rule in jsdom: the steps are not on
// the page until every line is ticked. What jsdom cannot prove is the part
// that decides whether this is usable in a kitchen — that the checkbox is a
// real target under a thumb, that nothing scrolls sideways on a phone, that
// the gate is visibly inert, and that the same screen holds together on a
// desktop. Those need layout, so they need a browser.
//
// It runs against the DEMO build, with the Supabase env vars blank, for the
// same reason stage4 does: this sandbox's egress blocks *.supabase.co, and a
// build that cannot reach a project is the honest thing to test here. Cook
// Mode reads nothing from the server anyway — the recipe comes from the
// notebook and the progress from IndexedDB, which a real browser has, so the
// persistence half of the flow is exercised for real.
//
//   npm run e2e:build && node apps/web/e2e/stage14.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

await new Promise((r) => server.listen(8127, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

/** The whole flow, at one viewport. */
async function run(label, width, height, shot) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // See stage4: this sandbox's proxy breaks the Google Fonts request and
    // nothing else. Every other console error is a real failure.
    if (/ERR_CERT_AUTHORITY_INVALID|Failed to load resource|fonts\.(googleapis|gstatic)\.com/.test(m.text())) {
      return;
    }
    errors.push(`console: ${m.text()}`);
  });

  await page.goto('http://127.0.0.1:8127/notebook', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await finishOnboarding(page);

  // Into a demo recipe that has steps, the way a person gets there.
  await page.goto('http://127.0.0.1:8127/recipe/brioche', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const cook = page.getByRole('link', { name: 'מצב הכנה' });
  check(`${label}: the recipe offers מצב הכנה`, (await cook.count()) > 0);
  await cook.click();
  await page.waitForTimeout(700);

  /* ── the weighing list is what opens ─────────────────────────────────── */
  const heading = page.getByRole('heading', { name: 'הכנת חומרי גלם' });
  check(`${label}: Cook Mode opens on the weighing list`, await heading.isVisible());
  check(
    `${label}: with the instruction, not just a list`,
    (await page.locator('text=הכינו ושקלו את כל חומרי הגלם').count()) > 0,
  );

  const boxes = page.locator('input[type="checkbox"]');
  const count = await boxes.count();
  check(`${label}: one line per ingredient`, count > 0, `${count} lines`);

  /*
    §7: the weighing is a CHECKLIST, not a lock. The control reads
    "מעבר להכנה" while lines are unticked and "הכול מוכן — מתחילים בהכנה" once
    they are all ticked, and it is pressable either way — Ahmed changed the
    old rule explicitly. `name` matches on a substring, so this finds both.
  */
  const gate = page.getByRole('button', { name: 'מעבר להכנה' });
  const gateDone = page.getByRole('button', { name: 'הכול מוכן' });
  check(`${label}: the way through is there, and pressable`, await gate.isEnabled());

  /* ── the kitchen part: targets, and no sideways scroll ───────────────── */
  const box = await boxes.first().boundingBox();
  const row = await page.locator('label').first().boundingBox();
  check(
    `${label}: the tick is a real target`,
    box !== null && box.width >= 24 && box.height >= 24,
    box ? `${Math.round(box.width)}×${Math.round(box.height)}px` : 'no box',
  );
  check(
    `${label}: and the row it sits in is thumb-sized`,
    row !== null && row.height >= 56,
    row ? `${Math.round(row.height)}px tall` : 'no row',
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${label}: nothing scrolls sideways`, overflow <= 1, `${overflow}px`);
  const rtl = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="הכנת חומרי גלם"]');
    return el ? getComputedStyle(el).direction : 'none';
  });
  check(`${label}: right-to-left`, rtl === 'rtl', rtl);

  await page.screenshot({ path: `${OUT}/${shot}-01-mise-empty.png` });

  /* ── a partial list does not open anything ───────────────────────────── */
  await boxes.first().click();
  await page.waitForTimeout(250);
  const partial = (await page.locator('[role="status"]').first().textContent()) ?? '';
  check(
    `${label}: the count follows the ticks`,
    /1 מתוך/.test(partial),
    partial.trim(),
  );
  check(
    `${label}: it says how many lines are left`,
    (await page.locator('text=/נותרו/').count()) > 0,
    ((await page.locator('text=/נותרו/').first().textContent()) ?? '').trim().slice(0, 60),
  );
  check(
    `${label}: the steps are not on the page until it is pressed`,
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) === 0,
  );
  check(
    `${label}: and there is one way through, not a "skip"`,
    (await page.locator('text=/דלג|בכל זאת|התחל ללא/').count()) === 0,
  );
  await page.screenshot({ path: `${OUT}/${shot}-02-mise-partial.png` });

  /* ── complete it, and the steps begin ────────────────────────────────── */
  for (let i = 1; i < count; i += 1) {
    await boxes.nth(i).click();
    await page.waitForTimeout(120);
  }
  check(
    `${label}: 100% is reported in those words`,
    (await page.locator('text=Mise en place הושלם').count()) > 0,
  );
  check(
    `${label}: and the control now says the list is complete`,
    (await gateDone.count()) > 0 && (await gateDone.isEnabled()),
  );
  check(
    `${label}: with nothing left to count`,
    (await page.locator('text=/נותרו/').count()) === 0,
  );
  await page.screenshot({ path: `${OUT}/${shot}-03-mise-complete.png` });

  await gateDone.click();
  await page.waitForTimeout(500);
  check(
    `${label}: pressing it lands on the first step of the existing Cook Mode`,
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) > 0,
  );
  check(
    `${label}: the weighing list is behind us`,
    (await page.getByRole('heading', { name: 'הכנת חומרי גלם' }).count()) === 0,
  );
  check(
    `${label}: the step bar is there, one segment per step`,
    (await page.locator('nav[aria-label="שלבי ההכנה"] button').count()) > 0,
  );
  await page.screenshot({ path: `${OUT}/${shot}-04-step-one.png` });

  /* ── and a reload mid-bake does not ask for the weighing again ───────── */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  check(
    `${label}: a reload comes back to the steps, not to the scales`,
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) > 0 &&
      (await page.getByRole('heading', { name: 'הכנת חומרי גלם' }).count()) === 0,
  );

  check(`${label}: no page error in the whole flow`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

try {
  await run('phone 402', 402, 874, 'stage14-phone');
  await run('desktop 1440', 1440, 900, 'stage14-desktop');
} catch (e) {
  check(`the run itself: ${e.message}`, false);
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log(`  FAILED: ${f.label} ${f.detail}`);
  console.log(`screenshots in ${OUT}`);
  await browser.close();
  server.close();
  process.exitCode = failed.length === 0 ? 0 : 1;
}
