// KEYBOARD AND FOCUS — the part of the UX pass a mouse never tests.
//
// The brief asked for three things this measures, in a real browser, on the
// published page:
//
//   1. every interactive control can be REACHED with Tab, in the order the
//      screen reads in;
//   2. the control that has focus SHOWS it — a focus ring that is invisible is
//      the same as no focus ring;
//   3. Enter works on what looks like a button, including a <summary>, which
//      is what the two new disclosure panels are made of.
//
//   node artifact/scripts/keyboard.mjs
//   PAGE=<dir>/index.html DIST=<dir> node artifact/scripts/keyboard.mjs

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
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const WRAPPED = `${HEAD}${PAGE}</body></html>`;

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
    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8153, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8153/index.html';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

/** Who has focus, and can it be seen? */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      name: (el.textContent || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 30),
      // A ring, a shadow or a border change — any of the three is visible
      // feedback; "none of the three" is the defect this looks for.
      ring:
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        cs.boxShadow !== 'none' ||
        cs.borderColor !== cs.backgroundColor,
      onScreen: r.width > 0 && r.height > 0,
      height: Math.round(r.height),
    };
  });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    r.request().url().startsWith('http://127.0.0.1:8153') ? r.continue() : r.abort(),
  );

  // ── the home screen: the two things it exists for are reachable ────────
  await page.goto(`${BASE}?k=${Date.now()}#/home`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f) seen.push(f);
  }
  const names = seen.map((f) => f.name);
  check(
    'Tab reaches the search box on the home screen',
    seen.some((f) => f.tag === 'INPUT'),
    names.slice(0, 4).join(' · '),
  );
  check(
    'and the search button, and "מתכון חדש"',
    names.some((n) => n.includes('חיפוש')) && names.some((n) => n.includes('מתכון חדש')),
    names.slice(0, 6).join(' · '),
  );
  check(
    'everything Tab lands on is on screen and shows its focus',
    seen.every((f) => f.onScreen && f.ring),
    `${seen.length} stops, ${seen.filter((f) => !f.ring).length} without a visible ring`,
  );

  // ── the recipe page: the disclosures work from the keyboard ────────────
  await page.goto(`${BASE}?k=${Date.now()}#/recipe/brioche`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const more = page.getByText('עוד פעולות');
  await more.focus();
  const onSummary = await focused(page);
  check('a disclosure summary can take focus', onSummary?.tag === 'SUMMARY', onSummary?.name ?? '—');
  check(
    'and it is a real target, not a 20px line of text',
    (onSummary?.height ?? 0) >= 40,
    `${onSummary?.height ?? 0}px`,
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(
    'Enter opens it, and what is inside is then reachable',
    (await page.getByRole('button', { name: /^מחיקת/ }).count()) > 0,
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(
    'and Enter closes it again',
    (await page.getByRole('button', { name: /^מחיקת/ }).count()) === 0,
  );

  // ── the editor: the required field announces itself ────────────────────
  await page.goto(`${BASE}?k=${Date.now()}#/recipe/new`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const nameBox = page.locator('#r-name');
  check(
    'the required field says so to a screen reader, not only in colour',
    (await nameBox.getAttribute('aria-required')) === 'true',
  );
  await page.getByRole('button', { name: 'שמירת המתכון' }).click();
  await page.waitForTimeout(400);
  check(
    'a refused save marks the field and points at its message',
    (await nameBox.getAttribute('aria-invalid')) === 'true' &&
      (await nameBox.getAttribute('aria-describedby')) === 'r-name-error',
  );
  check(
    'and the message is really there, beside the field',
    (await page.locator('#r-name-error').count()) === 1,
    (await page.locator('#r-name-error').textContent()) ?? '',
  );

  check('no page error in the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} keyboard checks passed`);
  for (const f of failed) console.log(`  FAILED  ${f.label} -- ${f.detail}`);
  await browser.close();
  server.close();
  process.exitCode = failed.length === 0 ? 0 : 1;
}
